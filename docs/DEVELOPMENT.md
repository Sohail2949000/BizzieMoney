# Development Guide

## Install

```powershell
Copy-Item .env.example .env
pnpm install
```

Use `pnpm dev:web` when working only on the shell. The API and worker validate a
real PostgreSQL connection during startup and therefore require `DATABASE_URL`.

## Commands

| Command           | Purpose                            |
| ----------------- | ---------------------------------- |
| `pnpm dev`        | Run web, API, and worker together  |
| `pnpm dev:web`    | Run Vite without PostgreSQL        |
| `pnpm db:migrate` | Apply pending versioned SQL        |
| `pnpm format`     | Check repository formatting        |
| `pnpm lint`       | Run strict ESLint checks           |
| `pnpm typecheck`  | Type-check every workspace         |
| `pnpm test`       | Run unit, API, and component tests |
| `pnpm build`      | Produce all distributable builds   |
| `pnpm test:e2e`   | Run desktop and mobile journeys    |

## Authentication development

Set these variables for the API:

```dotenv
APP_URL=http://localhost:5173
APP_ALLOWED_ORIGINS=http://localhost:5173
SESSION_SECRET=replace-with-at-least-32-random-characters
SESSION_TTL_HOURS=168
```

The setup route works only while no owner exists. To repeat first-run testing,
use a disposable database instead of deleting rows from a database you care
about.

## Cloudflare Tunnel development

The development server supports localhost and an explicitly configured
Cloudflare Tunnel while keeping browser API calls same-origin:

```dotenv
APP_URL=http://localhost:5173
APP_ALLOWED_ORIGINS=http://localhost:5173,https://money.example.com
VITE_ALLOWED_HOSTS=money.example.com
VITE_API_PROXY_TARGET=http://localhost:3001
```

Development Compose overrides `VITE_API_PROXY_TARGET` with
`http://api:3000`, which is reachable inside the Compose network. Restart the
affected services after changing the allowlists:

```powershell
docker compose --env-file .env -f docker/compose.dev.yml --profile local-db up -d --force-recreate web api
```

Configure the Cloudflare Tunnel public hostname to use
`http://localhost:5173` as its origin service. Cloudflare WebSocket forwarding
must remain enabled so Vite HMR can use the hostname currently open in the
browser; no public HMR hostname is hardcoded.

Both origin lists are exact. Do not use wildcards, URL paths, or
`allowedHosts: true`. Add any temporary `trycloudflare.com` hostname explicitly
to both variables before using it. Because BizzieMoney contains private
financial data, protect the public hostname with Cloudflare Access rather than
relying on the application login as the only internet-facing boundary.

The PostgreSQL integration test is intentionally opt-in:

```powershell
$env:TEST_DATABASE_URL = "postgresql://user:password@localhost:5432/bizziemoney"
pnpm --filter @bizziemoney/api test -- src/auth/auth.integration.test.ts
```

The authentication, expense, and subscription integration files create
randomly named schemas, exercise their complete lifecycles, and drop those
schemas when finished. To run all three:

```powershell
$env:TEST_DATABASE_URL = "postgresql://user:password@localhost:5432/bizziemoney"
pnpm --filter @bizziemoney/api test
```

## Attachment storage development

Local development defaults to private files under the configured
`ATTACHMENT_LOCAL_PATH`. Compose maps that path to `.data/attachments` on the
host, so recreating the API or worker container does not discard uploaded
files.

Set `MAX_UPLOAD_SIZE_MB` and `ATTACHMENT_ALLOWED_MIME_TYPES` to narrow the
upload policy. For S3-compatible storage, set
`ATTACHMENT_STORAGE_PROVIDER=s3` and configure the bucket, region, endpoint,
prefix, path-style option, and credentials documented in `.env.example`.
Never commit real credentials. The Settings page reports only safe status and
can run an authenticated connection test.

## Subscription worker development

`SUBSCRIPTION_REMINDER_INTERVAL_MS` controls how often the worker maintains
ready reminders and end-date state. The development default is 60 seconds and
the value must be at least 1000. Maintenance is non-overlapping, serialized by
a PostgreSQL advisory lock, and safe to run in more than one worker process.

## Backup worker development

`BACKUP_JOB_INTERVAL_MS` controls how often the worker schedules and claims
backup jobs; `WORKER_HEARTBEAT_INTERVAL_MS` controls its liveness record.
Compose binds `BACKUP_LOCAL_PATH=/data/backups` to `.data/backups` on the host.
The image includes `pg_dump`, `psql`, and `tar`.

Configure schedules and local/S3-compatible destinations in Settings. Keep a
stable `SESSION_SECRET`, or set a separate stable `BACKUP_SECRETS_KEY`, because
changing the sealing key makes saved S3 credentials and archive passwords
unreadable. See `BACKUPS.md` and `RESTORE.md` before testing recovery.

## Adding code

- Keep apps independently runnable.
- Put cross-runtime product contracts in `packages/shared`.
- Keep HTTP details out of `packages/database`.
- Add schema changes as new SQL migrations.
- Validate all environment input at process boundaries.
- Never add demo finance records to normal startup.
- Keep test fixtures inside isolated tests.
- Do not log secrets, connection strings, session tokens, or storage keys.
- Keep search, filtering, sorting, pagination, and authorization on the server.
- Send decimal money values over JSON as strings.

## Phase gate

Before calling a phase complete, run formatting, linting, type checks, tests, a
production build, and relevant browser checks. A later phase must not weaken or
disable earlier tests to pass.
