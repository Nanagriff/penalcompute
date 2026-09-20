#!/bin/sh
# uvicorn as the unprivileged user in the background, nginx in the foreground.
set -e
chown computation:computation /var/lib/computation
su -s /bin/sh computation -c "cd /opt/computation/api && exec python -m uvicorn main:app --host 127.0.0.1 --port 8001 --workers 1 --no-server-header --proxy-headers --forwarded-allow-ips 127.0.0.1" &
trap 'kill 0' TERM INT
exec nginx -g 'daemon off;'
