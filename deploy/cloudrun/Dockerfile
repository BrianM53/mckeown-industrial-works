# Static site image for Google Cloud Run: nginx serving the prebuilt site.
# Built by scripts/deploy-gcp.sh from a staging folder that holds this file, nginx.conf and site/
# (the output of `npm run build`), so the image contains exactly what was tested locally.
FROM nginx:1.29-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY site/ /usr/share/nginx/html/
EXPOSE 8080
