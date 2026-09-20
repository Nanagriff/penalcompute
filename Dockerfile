# One container: nginx serves the built site and proxies /feedback to uvicorn
# inside the same container. TLS is terminated by the host's Traefik proxy.
#
#   docker build -t computation .
#   docker run -p 8080:80 -v computation-data:/var/lib/computation computation

# ---- stage 1: build the web app -------------------------------------------
FROM node:22-bookworm-slim AS web
WORKDIR /src
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci --no-audit --no-fund
COPY web ./web
COPY vectors ./vectors
ARG COMMIT=no-git
RUN cd web && npm test --silent && npm run build --silent \
 && node -e 'const fs=require("fs");const p="dist/version.json";const d=JSON.parse(fs.readFileSync(p));d.commit=process.argv[1];fs.writeFileSync(p,JSON.stringify(d,null,2)+"\n")' "$COMMIT"

# ---- stage 2: nginx + uvicorn ----------------------------------------------
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends nginx curl \
 && rm -rf /var/lib/apt/lists/* /etc/nginx/sites-enabled/default
WORKDIR /opt/computation/api
COPY api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY api/main.py api/to_vectors.py ./
COPY --from=web /src/web/dist /var/www/computation
COPY deploy/nginx.container.conf /etc/nginx/conf.d/computation.conf
COPY deploy/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && useradd --system --home /opt/computation --shell /usr/sbin/nologin computation \
 && mkdir -p /var/lib/computation && chown computation:computation /var/lib/computation
ENV COMPUTATION_DB=/var/lib/computation/feedback.sqlite3 \
    COMPUTATION_ORIGIN=https://computation.example.org \
    COMPUTATION_RATE=30
VOLUME /var/lib/computation
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD curl -fsS http://127.0.0.1/feedback/health || exit 1
ENTRYPOINT ["/entrypoint.sh"]
