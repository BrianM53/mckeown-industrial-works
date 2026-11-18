#!/usr/bin/env bash
# Deploy to GitHub Pages WITHOUT GitHub Actions: build the site and force-push the prebuilt
# output to the `gh-pages` branch (repo Settings → Pages → "Deploy from a branch": gh-pages, /).
# GitHub's own Pages builder then publishes it (~1 minute).
#
#   npm run deploy:pages
#
# Override REPO_URL / BASE_PATH / SITE_URL for forks or custom domains (use BASE_PATH=/ there).
set -euo pipefail
cd "$(dirname "$0")/.."
REPO_URL="${REPO_URL:-$(git remote get-url origin)}"
BASE_PATH="${BASE_PATH:-/mckeown-industrial-works/}"
SITE_URL="${SITE_URL:-https://brianm53.github.io/mckeown-industrial-works/}"
OUT_DIR="dist-pages"
SHA="$(git rev-parse --short HEAD)"

if [ -n "$(git status --porcelain)" ]; then
  echo "warning: working tree has uncommitted changes; they will be deployed too." >&2
fi

rm -rf "$OUT_DIR"
npm run typecheck
BASE_PATH="$BASE_PATH" SITE_URL="$SITE_URL" OUT_DIR="$OUT_DIR" npx vite build
BASE_PATH="$BASE_PATH" SITE_URL="$SITE_URL" OUT_DIR="$OUT_DIR" COMMIT_SHA="$SHA" npx tsx scripts/prerender.tsx
touch "$OUT_DIR/.nojekyll" # serve files verbatim (no Jekyll processing)

NAME="$(git config user.name || echo deploy)"
EMAIL="$(git config user.email || echo deploy@localhost)"
(
  cd "$OUT_DIR"
  git init -q -b gh-pages
  git add -A
  git -c user.name="$NAME" -c user.email="$EMAIL" commit -q -m "deploy: $SHA"
  git push -q -f "$REPO_URL" gh-pages
)
echo "Pushed $SHA to gh-pages. GitHub Pages will publish $SITE_URL shortly."
echo "Verify with: npm run smoke -- $SITE_URL && node scripts/livecheck.mjs $SITE_URL shots/live.png"
