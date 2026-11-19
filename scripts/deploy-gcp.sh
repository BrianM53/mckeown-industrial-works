#!/usr/bin/env bash
# Deploy to Google Cloud Run: build the site locally, bake it into an nginx image
# (deploy/cloudrun/), test that image locally, push it to Artifact Registry and roll it out.
#
#   npm run deploy:gcp                 # build, test locally, push, deploy, smoke-test the live URL
#   LOCAL_ONLY=1 npm run deploy:gcp    # build + test the image on http://127.0.0.1:8088/ only
#
# Needs: gcloud (logged in), Docker, and a GCP project with billing linked.
# Overrides: GCP_PROJECT, GCP_REGION, GCP_SERVICE, SITE_URL (public URL; defaults to the custom domain
# below; set SITE_URL=run.app to build for the service's own https://SERVICE-NUMBER.REGION.run.app/ URL).
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT="${GCP_PROJECT:-mckeown-industrial-works}"
REGION="${GCP_REGION:-us-central1}"
SERVICE="${GCP_SERVICE:-mckeown-industrial-works}"
REPO="site"
OUT_DIR="dist-gcp"
LOCAL_PORT="${LOCAL_PORT:-8088}"
SHA="$(git rev-parse --short HEAD)"
IMAGE="$REGION-docker.pkg.dev/$PROJECT/$REPO/web:$SHA"

if [ -n "$(git status --porcelain)" ]; then
  echo "warning: working tree has uncommitted changes; they will be deployed too." >&2
fi

# Custom domain (mapped with `gcloud beta run domain-mappings`; www.* redirects to it in nginx.conf).
SITE_URL="${SITE_URL:-https://brianmckeown.us/}"
# Cloud Run's deterministic service URL: https://SERVICE-PROJECT_NUMBER.REGION.run.app/
if [ "$SITE_URL" = "run.app" ]; then
  NUM="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
  SITE_URL="https://$SERVICE-$NUM.$REGION.run.app/"
fi
echo "▶ Building $SHA for $SITE_URL"

rm -rf "$OUT_DIR"
npm run typecheck
BASE_PATH=/ SITE_URL="$SITE_URL" OUT_DIR="$OUT_DIR" npx vite build
BASE_PATH=/ SITE_URL="$SITE_URL" OUT_DIR="$OUT_DIR" COMMIT_SHA="$SHA" npx tsx scripts/prerender.tsx

STAGE="$(mktemp -d)"
CID=""
cleanup() { rm -rf "$STAGE"; [ -n "$CID" ] && docker rm -f "$CID" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cp deploy/cloudrun/Dockerfile deploy/cloudrun/nginx.conf "$STAGE/"
cp -r "$OUT_DIR" "$STAGE/site"
docker build -q -t "$IMAGE" "$STAGE"

echo "▶ Testing the image locally on http://127.0.0.1:$LOCAL_PORT/"
CID="$(docker run -d --rm -p "127.0.0.1:$LOCAL_PORT:8080" "$IMAGE")"
node scripts/smoke.mjs "http://127.0.0.1:$LOCAL_PORT/"
if [ -n "${LOCAL_ONLY:-}" ]; then
  echo "LOCAL_ONLY set: not pushing. Image: $IMAGE"
  exit 0
fi

echo "▶ Pushing $IMAGE"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com --project "$PROJECT"
if ! gcloud artifacts repositories describe "$REPO" --project "$PROJECT" --location "$REGION" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$REPO" --project "$PROJECT" --location "$REGION" \
    --repository-format docker --description "McKeown Industrial Works site images"
fi
gcloud auth configure-docker "$REGION-docker.pkg.dev" --quiet >/dev/null
docker push -q "$IMAGE"

echo "▶ Deploying to Cloud Run ($SERVICE, $REGION)"
gcloud run deploy "$SERVICE" --project "$PROJECT" --region "$REGION" --image "$IMAGE" \
  --allow-unauthenticated --port 8080 --cpu 1 --memory 256Mi --concurrency 200 \
  --min-instances 0 --max-instances 3 --quiet

node scripts/smoke.mjs "$SITE_URL"
echo "Deployed $SHA → $SITE_URL"
echo "Browser check: node scripts/livecheck.mjs $SITE_URL shots/live-gcp.png"
