# Deploy

The Contabo host runs Coolify, whose Traefik proxy owns ports 80 and 443
and issues Let's Encrypt certificates. So the site is one Docker container
on the host's `coolify` network with Traefik labels: nginx serves the built
site and proxies `/feedback` to uvicorn inside the same container. The
SQLite file lives in the named volume `computation-data`, never in the
image and never under the web root.

## Every deploy

```sh
DEPLOY_HOST=mauplus DOMAIN=computation.169.58.62.79.sslip.io ./deploy/deploy.sh
```

`DEPLOY_HOST` is an ssh alias or `user@host`. The script refuses to deploy
if the reference self-check or the engine tests fail, and the image build
runs the tests again on the host.

To move to a real domain: point an A record at the host, then rerun the
script with `DOMAIN=your.domain`. Traefik requests the certificate on first
request.

## Checks after a deploy

- `https://<domain>/` loads, and still loads with the network disabled once the service worker has installed.
- `https://<domain>/robots.txt` returns `Disallow: /`.
- `https://<domain>/feedback/health` returns `{"status":"ok"}`.
- `https://<domain>/feedback.sqlite3` is 404 or 403.
- `docker ps` shows `computation` healthy; it restarts on failure and on reboot (`--restart unless-stopped`).

## Pulling reviewer disagreements into the test suite

```sh
ssh mauplus 'docker exec computation python to_vectors.py --db /var/lib/computation/feedback.sqlite3' > vectors/reviewer.json
cd web && npm test
```

Each reviewer case fails until the engine or the reviewer is shown to be
right. Review the comments before committing the file.

## Local container run

```sh
docker build -t computation . && docker run --rm -p 8080:80 computation
```

## Coolify instead

The Dockerfile at the repository root also works as a Coolify "Dockerfile"
application from the GitHub repo: set the domain in Coolify, add a
persistent volume at `/var/lib/computation`, and set
`COMPUTATION_ORIGIN=https://<domain>`. Then Coolify, not this script,
owns the container.
