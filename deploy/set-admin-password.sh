#!/usr/bin/env bash
# Set or change the shared password for /admin on the live site.
#
#   ./deploy/set-admin-password.sh            asks for the password, twice, without showing it
#
# The password goes over ssh to the running container, which keeps only a
# salted scrypt hash of it, in the data volume beside the database. Nothing is
# written on this machine or in the repository. No redeploy is needed, and the
# password survives redeploys. Anyone signed in stays signed in until their
# session runs out (12 hours) or the container restarts.
set -euo pipefail

HOST="${DEPLOY_HOST:-mauplus}"
NAME="${CONTAINER_NAME:-computation}"

if [ ! -t 0 ]; then
  echo "Run this in a terminal of your own, so the password can be typed without being shown." >&2
  exit 2
fi

read -r -s -p "New admin password (at least 10 characters): " first; echo
read -r -s -p "The same password again: " second; echo
[ "$first" = "$second" ] || { echo "The two do not match. Nothing was changed." >&2; exit 1; }
[ "${#first}" -ge 10 ] || { echo "Too short. Nothing was changed." >&2; exit 1; }

printf '%s\n' "$first" | ssh "$HOST" "docker exec -i -u computation ${NAME} python admin.py set-password"
unset first second
echo "Sign in at /admin on the site."
