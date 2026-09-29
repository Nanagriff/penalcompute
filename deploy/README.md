# Deploy

The Contabo host runs Coolify, whose Traefik proxy owns ports 80 and 443
and issues Let's Encrypt certificates. So the site is one Docker container
on the host's `coolify` network with Traefik labels: nginx serves the built
site and proxies `/feedback`, `/usage` and `/admin` to uvicorn inside the
same container. The
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
- `https://<domain>/admin` shows the sign-in form, and `https://<domain>/admin/api/reports` returns 401 to a browser that has not signed in.
- `https://<domain>/admin.hash` is 404 or 403.
- `docker ps` shows `computation` healthy; it restarts on failure and on reboot (`--restart unless-stopped`).

## The admin page

`https://<domain>/admin` shows how the tool is used and every report, behind
one shared password. Set the password once, and again whenever it should
change, from a terminal of your own:

```sh
./deploy/set-admin-password.sh
```

It asks for the password twice without showing it and sends it over ssh to
the running container, which keeps only a salted scrypt hash in the data
volume (`/var/lib/computation/admin.hash`). Nothing is written on this
machine or in the repository, no redeploy is needed, and the password
survives redeploys. Until it is set, the page says so and refuses every
sign-in.

- A session lasts 12 hours. A redeploy signs everyone out, because the key
  that signs sessions is made fresh when the container starts.
- Ten wrong passwords from one address in an hour, or sixty from everywhere,
  lock sign-in for the rest of that hour.
- To take the page away, delete the hash:
  `ssh mauplus docker exec computation rm /var/lib/computation/admin.hash`.
- A browser that has used the tool before keeps the old service worker until
  the officer accepts the update. If `/admin` shows the tool instead of the
  sign-in form, open the tool, accept the update, and try again.

Usage is counted from the build that introduced it (engine 1.1.0, late
September 2026). A device on an older build keeps working and is not counted
until it updates. What is counted is the kind of computation, the time, the
version, whether the app was installed and whether the device was offline.
The endpoint has no field for a date or a sentence.

## Pulling reviewer disagreements into the test suite

```sh
./deploy/reports.sh > vectors/reviewer.json
cd web && npm test
```

`deploy/reports.sh` runs `to_vectors.py` inside the container over ssh
(`DEPLOY_HOST` picks the host, default `mauplus`). Run it with no redirect
to read the reports on screen.

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
