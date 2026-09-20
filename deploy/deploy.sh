#!/usr/bin/env bash
# One command from the local checkout to the live site (Task 5.3), on a host
# that runs Coolify's Traefik proxy on ports 80/443.
#
#   DEPLOY_HOST=mauplus DOMAIN=computation.169.58.62.79.sslip.io ./deploy/deploy.sh
#
#   1. reference self-check and engine tests locally (refuses to deploy on a failure)
#   2. rsync the source to the host
#   3. docker build on the host (the image runs the tests again, builds the web
#      app and writes version.json with the commit hash)
#   4. replace the running container; Traefik picks it up by label and issues
#      the certificate; the SQLite file lives in a named volume, never in the image
#   5. check version.json, robots.txt and the API health over HTTPS
set -euo pipefail

HOST="${DEPLOY_HOST:?set DEPLOY_HOST (an ssh host alias or user@host)}"
DOMAIN="${DOMAIN:?set DOMAIN}"
NAME="${CONTAINER_NAME:-computation}"
SRC="${REMOTE_SRC:-/opt/computation/src}"
NETWORK="${TRAEFIK_NETWORK:-coolify}"

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo 'no-git')"
[ -n "$(git status --porcelain 2>/dev/null)" ] && echo "!! working tree not clean; deploying ${COMMIT} plus local changes" >&2

echo "== 1. reference self-check and engine tests"
( cd reference && python3 export_vectors.py --verify )
( cd web && npm test --silent )

echo "== 2. rsync source to ${HOST}:${SRC}"
ssh "$HOST" "mkdir -p ${SRC}"
rsync -az --delete \
  --exclude node_modules --exclude dist --exclude dist-single --exclude venv \
  --exclude '__pycache__' --exclude '*.sqlite3*' --exclude '.git' \
  "$ROOT/" "${HOST}:${SRC}/"

echo "== 3. build image on the host"
ssh "$HOST" "cd ${SRC} && docker build --build-arg COMMIT=${COMMIT} -t ${NAME}:${COMMIT} -t ${NAME}:latest ."

echo "== 4. replace the container"
ssh "$HOST" "
  docker volume create ${NAME}-data >/dev/null
  docker rm -f ${NAME} >/dev/null 2>&1 || true
  docker run -d --name ${NAME} --restart unless-stopped \
    --network ${NETWORK} \
    -v ${NAME}-data:/var/lib/computation \
    -e COMPUTATION_ORIGIN=https://${DOMAIN} \
    --label traefik.enable=true \
    --label 'traefik.http.middlewares.redirect-to-https.redirectscheme.scheme=https' \
    --label 'traefik.http.routers.${NAME}-http.entryPoints=http' \
    --label 'traefik.http.routers.${NAME}-http.rule=Host(\`${DOMAIN}\`)' \
    --label 'traefik.http.routers.${NAME}-http.middlewares=redirect-to-https' \
    --label 'traefik.http.routers.${NAME}-https.entryPoints=https' \
    --label 'traefik.http.routers.${NAME}-https.rule=Host(\`${DOMAIN}\`)' \
    --label 'traefik.http.routers.${NAME}-https.tls=true' \
    --label 'traefik.http.routers.${NAME}-https.tls.certresolver=letsencrypt' \
    --label 'traefik.http.services.${NAME}.loadbalancer.server.port=80' \
    ${NAME}:latest >/dev/null
  docker image prune -f --filter label=none >/dev/null 2>&1 || true
  sleep 3; docker ps --filter name=${NAME} --format '{{.Names}} {{.Status}}'
"

echo "== 5. verify over HTTPS (the first certificate can take up to a minute)"
for i in $(seq 1 12); do
  if curl -fsS --max-time 10 "https://${DOMAIN}/version.json" 2>/dev/null; then break; fi
  sleep 5
  [ "$i" = 12 ] && { echo "!! site not reachable over HTTPS yet; check: ssh ${HOST} docker logs coolify-proxy" >&2; exit 1; }
done
curl -fsS "https://${DOMAIN}/feedback/health" && echo
curl -fsS "https://${DOMAIN}/robots.txt"
echo "== deployed ${COMMIT} to https://${DOMAIN}"
