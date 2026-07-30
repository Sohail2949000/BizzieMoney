# Production deployment

BizzieMoney ships separate production images for the web application, API, and
worker. The production Compose file deliberately does not create PostgreSQL.
Use a maintained external PostgreSQL server and keep its data outside the
application containers.

For a complete first installation with PostgreSQL and named persistent
volumes, use the repository-root `compose.yml`:

```powershell
Copy-Item .env.example .env
docker compose up -d --build
```

The remainder of this guide describes the external-PostgreSQL production
topology in `docker/compose.prod.yml`.

## Prepare the host

1. Install Docker Desktop or Docker Engine with Compose v2.
2. Create a PostgreSQL database and a dedicated BizzieMoney database user.
3. Copy `.env.example` to `.env` and set at minimum:
   - `APP_URL` to the exact public origin;
   - `APP_ALLOWED_ORIGINS` to the exact trusted browser origins;
   - `DATABASE_URL`;
   - a random `SESSION_SECRET` containing at least 32 characters;
   - `ATTACHMENT_HOST_PATH` and `BACKUP_HOST_PATH`.
4. Create the two host directories before starting the services. They must be
   writable by UID/GID `1000:1000` on Linux.

When PostgreSQL runs directly on a Windows host, use
`host.docker.internal` rather than `localhost` in `DATABASE_URL`.

For a local production-image smoke test:

```dotenv
APP_URL=http://localhost:8080
APP_ALLOWED_ORIGINS=http://localhost:8080
WEB_PORT=8080
DATABASE_URL=postgresql://bizziemoney:password@host.docker.internal:5432/bizziemoney
ATTACHMENT_HOST_PATH=../.data/attachments
BACKUP_HOST_PATH=../.data/backups
```

## Migrate and start

Build the immutable images, apply migrations once, and start the services:

```powershell
docker compose --env-file .env -f docker/compose.prod.yml build
docker compose --env-file .env -f docker/compose.prod.yml run --rm api node node_modules/@bizziemoney/database/dist/cli.js
docker compose --env-file .env -f docker/compose.prod.yml up -d
```

For an internet-exposed deployment, enable fail-closed attachment malware
scanning by setting `ATTACHMENT_MALWARE_SCANNER=clamav` and starting the
optional service profile:

```powershell
docker compose --env-file .env -f docker/compose.prod.yml --profile malware-scan up -d
```

Open `APP_URL`. Only the web gateway is published. It serves the React build
and proxies `/api` to the private API service.

Check service health with:

```powershell
docker compose --env-file .env -f docker/compose.prod.yml ps
Invoke-RestMethod http://localhost:8080/health
```

The API container has its own readiness check, and the worker heartbeat is
visible in Settings.

## TLS and reverse proxies

For an internet-accessible installation, terminate TLS in a trusted reverse
proxy and set `APP_URL` to the exact `https://` origin. Forward the original
`Host`, `Origin`, and protocol. Do not publish the API container directly.

BizzieMoney validates unsafe-request origins exactly, uses secure cookies for
HTTPS requests, and applies CSP and other security headers in production.

## Updating without deleting data

1. Create and verify a manual backup from Settings.
2. Pull or copy the new source release.
3. Build the new images.
4. Run the migration command.
5. Start the updated services.
6. Confirm `/health`, API readiness, worker status, and the last verified
   backup.

Never remove the PostgreSQL database, attachment host directory, or backup host
directory during an update. Migrations are checksum-verified, serialized with
an advisory lock, and applied transactionally.

## Container hardening

- API and worker run as the non-root `node` user.
- The web image uses unprivileged Nginx on port `8080`.
- Runtime filesystems are read-only except for bounded `/tmp` mounts and the
  explicit attachment/backup mounts.
- Containers drop privilege escalation with `no-new-privileges`.
- `tini` forwards shutdown signals to the Node services.
- PostgreSQL client tools are present only where backup and restore need them.
- Expired sessions and stale login-rate records are pruned after the configured
  retention window.
- The optional official ClamAV service scans staged uploads before storage.

## Ports

- Production web gateway: `8080` by default (`WEB_PORT`)
- API: private container port `3000`
- PostgreSQL: determined by the external `DATABASE_URL`

The development Compose file keeps its existing defaults of web `5173`, API
`3001` on the host, and optional PostgreSQL `5432`.
