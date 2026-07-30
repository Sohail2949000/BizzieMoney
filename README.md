# BizzieMoney

**Private, self-hosted money management without accounting jargon.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/Sohail2949000/BizzieMoney/actions/workflows/ci.yml/badge.svg)](https://github.com/Sohail2949000/BizzieMoney/actions/workflows/ci.yml)
[![Docker publish](https://github.com/Sohail2949000/BizzieMoney/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/Sohail2949000/BizzieMoney/actions/workflows/docker-publish.yml)
[![Latest release](https://img.shields.io/github/v/release/Sohail2949000/BizzieMoney)](https://github.com/Sohail2949000/BizzieMoney/releases)
[![Docker image](https://img.shields.io/docker/v/sohail29490/bizziemoney?sort=semver&label=Docker)](https://hub.docker.com/r/sohail29490/bizziemoney)
[![Docker pulls](https://img.shields.io/docker/pulls/sohail29490/bizziemoney)](https://hub.docker.com/r/sohail29490/bizziemoney)

## Overview

BizzieMoney is a responsive, single-owner personal finance application for
tracking everyday expenses, recurring subscriptions, and money owed in either
direction. It is designed for people who want understandable financial
records without adopting accounting software or sending private data to a
hosted finance provider.

The application runs on PostgreSQL and includes a React web interface, a
Fastify API, and a background worker. It can be used locally, on a private
server, or behind a trusted HTTPS reverse proxy.

Typical uses include:

- Recording and searching household or personal expenses.
- Monitoring recurring subscriptions and scheduled payments.
- Tracking loans, informal debts, and partial repayments.
- Keeping receipts and agreements with their financial records.
- Maintaining verified local or S3-compatible backups.
- Exporting a portable copy of owner data.

## Why BizzieMoney was created

Many financial tools are either spreadsheet-heavy, tied to a hosted vendor, or
designed around accounting terminology. BizzieMoney focuses on a smaller set
of practical workflows:

- Make common money records understandable at a glance.
- Keep deployment and data ownership under the user's control.
- Avoid cross-currency totals that imply an exchange rate was applied.
- Provide backups, restore verification, and portable exports as first-class
  features.
- Offer a clear interface without public registration, advertising, or
  analytics.

## Features

### Overview and regional preferences

- At-a-glance spending, upcoming subscriptions, debts, and backup status.
- Default ISO currency, number format, date format, first weekday, and IANA
  time-zone preferences.
- Currency-separated summaries; BizzieMoney does not perform exchange-rate
  conversion.
- Light, dark, and system themes.

### Expenses

- Create, edit, duplicate, search, filter, sort, paginate, and soft-delete
  expenses.
- Month navigation and category summaries grouped by currency.
- CSV export and an atomic CSV import workflow with validation preview.
- Owner-managed categories and payment methods.
- Formula-safe CSV output.

### Subscriptions

- Weekly, monthly, quarterly, semiannual, yearly, and custom-day schedules.
- Pause, resume, cancel, search, sort, and month filtering.
- In-application reminders and payment history.
- Explicit conversion of a recorded subscription payment into an expense.

### Loans and debts

- Separate **Money I owe** and **Money owed to me** views.
- Partial payments, remaining balances, overpayment confirmation, and payment
  corrections.
- Active, paused, overdue, completed, cancelled, and reopened lifecycle
  states.
- Currency-separated debt summaries and due-date filtering.

### Attachments and storage

- Private attachments for expenses, subscriptions, debts, and debt payments.
- Authenticated previews and downloads; storage objects never receive public
  URLs.
- Bounded WebP thumbnails for PNG, JPEG, and WebP files.
- Deployment-managed local storage or private AWS S3, Cloudflare R2, MinIO,
  and compatible S3 services.
- Encrypted saved storage credentials and optional fail-closed ClamAV
  scanning.

### Backups and data management

- Manual and scheduled daily, weekly, or monthly PostgreSQL backups.
- Local or S3-compatible backup destinations with retention controls.
- Manifest, table-count, attachment, and SHA-256 verification.
- Password-confirmed restore preview with an automatic safety backup.
- Portable owner-data export with checksum-verified attachments.
- Password- and phrase-confirmed financial-data purge.

### Authentication and security

- First-run creation of one owner account; no default credentials or public
  registration.
- Argon2 password hashing, opaque server-side sessions, `HttpOnly` cookies,
  CSRF protection, exact-origin validation, and login rate limiting.
- Owner profile editing, password changes, active-session management, and
  append-only audit events.
- Security headers and same-origin API proxying in the production web gateway.

### Self-hosting

- Multi-stage, non-root production images for web, API, and worker roles.
- A complete Docker Compose installation with PostgreSQL and persistent named
  volumes.
- An external-PostgreSQL production Compose option.
- Responsive desktop, tablet, and mobile layouts.

BizzieMoney is intentionally single-owner in version 1.0.0. It does not
provide bank synchronization, income accounting, budgeting forecasts, email
delivery, multi-user workspaces, or exchange-rate conversion.

## Why use BizzieMoney?

- **Data ownership:** PostgreSQL, attachments, and backups remain in storage
  selected by the operator.
- **Private deployment:** run locally or behind a private reverse proxy or
  access gateway.
- **Portable operation:** Docker Compose brings up the application and its
  required services.
- **Clear boundaries:** the browser never receives storage credentials or
  direct object-storage URLs.
- **Recoverability:** scheduled backups, restore previews, safety backups, and
  portable exports are built in.
- **Open-source customization:** the MIT license permits inspection and
  adaptation.

## Comparison with alternatives

| Area                     | BizzieMoney                             | Hosted finance applications                     | Spreadsheet tracking                       | Other self-hosted finance tools |
| ------------------------ | --------------------------------------- | ----------------------------------------------- | ------------------------------------------ | ------------------------------- |
| Self-hosting             | Yes                                     | Usually no                                      | Local files or cloud drive                 | Usually                         |
| Data ownership           | Operator-controlled                     | Provider-controlled infrastructure              | File owner-controlled                      | Operator-controlled             |
| Source availability      | MIT licensed                            | Usually proprietary                             | Depends on spreadsheet software            | Varies                          |
| Customization            | Source and deployment can be changed    | Usually limited                                 | High formula flexibility                   | Varies by project               |
| Setup effort             | Docker and basic server administration  | Low                                             | Low to moderate                            | Moderate                        |
| Subscription requirement | None from BizzieMoney                   | Often                                           | Depends on software                        | Varies                          |
| Intended audience        | One owner wanting guided money tracking | Users wanting managed services and integrations | Users comfortable building their own model | Depends on the project          |
| Managed bank feeds       | No                                      | Often available                                 | Usually manual                             | Varies                          |

No category is universally better. Choose based on required integrations,
hosting skills, privacy expectations, and financial workflows.

## Screenshots

Private development data is deliberately not used for public screenshots. See
[docs/screenshots/README.md](docs/screenshots/README.md) for the required
capture list and redaction rules.

### Dashboard

Expected file: `docs/screenshots/dashboard.png`

### Expenses

Expected file: `docs/screenshots/expenses.png`

### Subscriptions

Expected file: `docs/screenshots/subscriptions.png`

### Loans and debts

Expected file: `docs/screenshots/debts.png`

### Settings

Expected file: `docs/screenshots/settings.png`

### Mobile view

Expected file: `docs/screenshots/mobile.png`

## Demo

- Demo URL: [bizzie-money-demo.vercel.app](https://bizzie-money-demo.vercel.app)
- Test account: demo@bizziemoney.com, admin11223344
- 

The hosted instance demonstrates the deployment and owner-account flow; it is
not an anonymous shared sandbox and does not publish reusable credentials.
**Never enter real financial, identity, password, receipt, or other sensitive
information into a public demo.** A disposable test account should be used for
public demonstrations, and its data may be reset without notice.

## Requirements

- Docker Engine or Docker Desktop with Compose v2, or:
- Node.js 24 or newer.
- pnpm 11.17.0 or a compatible pnpm 11 release.
- PostgreSQL 18 for the documented Compose workflow.

Redis and an email service are not required.

## Installation

### 1. Docker Compose

Clone the repository and create local configuration:

```bash
git clone https://github.com/Sohail2949000/BizzieMoney.git
cd BizzieMoney
cp .env.example .env
```

Set at least these values in `.env`:

```dotenv
APP_URL=http://localhost:8080
APP_ALLOWED_ORIGINS=http://localhost:8080
POSTGRES_PASSWORD=replace-with-a-long-url-safe-password
SESSION_SECRET=replace-with-at-least-32-random-characters
WEB_PORT=8080
```

Build and start the complete stack:

```bash
docker compose up -d --build
```

Open `http://localhost:8080`, create the owner account, and immediately
configure and verify backups.

For an internet-facing deployment, use HTTPS, set the exact public origin in
`APP_URL` and `APP_ALLOWED_ORIGINS`, and place the service behind a trusted
reverse proxy or access gateway.

### 2. Published Docker images

BizzieMoney uses separate web, API, and worker image roles. A single
`docker run` command would omit PostgreSQL or the worker and is therefore not
a supported installation.

The release workflow publishes these tags from one Docker Hub repository:

```bash
docker pull sohail29490/bizziemoney:latest
docker pull sohail29490/bizziemoney:latest-api
docker pull sohail29490/bizziemoney:latest-worker
```

Set the image repository in `.env`, then use Compose:

```dotenv
BIZZIEMONEY_IMAGE=sohail29490/bizziemoney
BIZZIEMONEY_VERSION=latest
```

```bash
docker compose pull
docker compose up -d
```

Versioned releases use `1.0.0`, `1.0.0-api`, and `1.0.0-worker` tags.

### 3. Installation from source

Configure a PostgreSQL database and `.env`, then:

```bash
corepack enable
corepack prepare pnpm@11.17.0 --activate
pnpm install --frozen-lockfile
pnpm db:migrate
NODE_ENV=production pnpm build
```

The production processes are:

```bash
NODE_ENV=production pnpm --filter @bizziemoney/api start
NODE_ENV=production pnpm --filter @bizziemoney/worker start
```

Serve `apps/web/dist` behind a web server that proxies same-origin `/api` to
the API. The supported production implementation is the unprivileged Nginx
`web` target in `docker/Dockerfile`.

Do not place `NODE_ENV=development` in the root `.env` when producing a manual
release build. Docker and CI exclude local `.env` files and set production
runtime mode explicitly.

### 4. Development setup

```bash
cp .env.example .env
pnpm install
pnpm db:migrate
pnpm dev
```

Default development ports are web `5173`, API `3001`, and optional PostgreSQL
`5432`. For Docker-based development, see
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Docker usage

The root [compose.yml](compose.yml) includes:

- PostgreSQL 18.
- A one-shot migration service.
- Fastify API.
- Background worker.
- Unprivileged Nginx web gateway.
- Persistent PostgreSQL, attachment, and backup volumes.
- Optional ClamAV under the `malware-scan` profile.

Start with malware scanning enabled:

```bash
docker compose --profile malware-scan up -d --build
```

For a maintained external PostgreSQL server and host-mounted attachment and
backup directories, use:

```bash
docker compose --env-file .env -f docker/compose.prod.yml build
docker compose --env-file .env -f docker/compose.prod.yml run --rm api node node_modules/@bizziemoney/database/dist/cli.js
docker compose --env-file .env -f docker/compose.prod.yml up -d
```

## Configuration

Never commit `.env`. Examples below are non-secret placeholders.

| Variable                            | Status                                               | Description                                                              | Safe example                                     | Default                          |
| ----------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------ | -------------------------------- |
| `APP_URL`                           | Required in production                               | Exact primary browser origin; no path or wildcard                        | `https://money.example.com`                      | Compose: `http://localhost:8080` |
| `APP_ALLOWED_ORIGINS`               | Optional                                             | Comma-separated additional exact origins                                 | `https://money.example.com`                      | Includes `APP_URL`               |
| `DATABASE_URL`                      | Required outside root Compose                        | PostgreSQL connection URL                                                | `postgresql://user:password@db:5432/bizziemoney` | None                             |
| `POSTGRES_PASSWORD`                 | Required by root Compose/local-db profile            | Password for the bundled PostgreSQL user; use URL-safe random characters | `replace-with-a-long-random-value`               | None                             |
| `POSTGRES_PORT`                     | Optional, development                                | Host port for optional development PostgreSQL                            | `5432`                                           | `5432`                           |
| `SESSION_SECRET`                    | Required                                             | Session-HMAC key, minimum 32 characters                                  | `replace-with-32-plus-random-characters`         | None                             |
| `SESSION_TTL_HOURS`                 | Optional                                             | Owner session lifetime                                                   | `168`                                            | `168`                            |
| `API_HOST`                          | Optional                                             | API bind address                                                         | `0.0.0.0`                                        | `0.0.0.0`                        |
| `API_PORT`                          | Optional                                             | API listener/host development port                                       | `3001`                                           | API `3000`; dev host `3001`      |
| `WEB_PORT`                          | Optional                                             | Published web port                                                       | `8080`                                           | Production `8080`; dev `5173`    |
| `NODE_ENV`                          | Optional                                             | Runtime mode                                                             | `production`                                     | `development`                    |
| `LOG_LEVEL`                         | Optional                                             | Fastify log threshold                                                    | `info`                                           | `info`                           |
| `TZ`                                | Optional                                             | Container process time zone                                              | `UTC`                                            | Compose `UTC`                    |
| `VITE_ALLOWED_HOSTS`                | Optional, development                                | Exact extra Vite hostnames, comma-separated                              | `dev-money.example.com`                          | Empty                            |
| `VITE_API_PROXY_TARGET`             | Optional, development                                | Server-side Vite `/api` proxy target                                     | `http://localhost:3001`                          | `http://localhost:3001`          |
| `VITE_API_URL`                      | Optional, build-time                                 | Explicit browser API base; same-origin empty value is recommended        | `https://money.example.com`                      | Same origin                      |
| `BIZZIEMONEY_IMAGE`                 | Optional                                             | Docker image repository used by Compose                                  | `example/bizziemoney`                            | `bizziemoney`                    |
| `BIZZIEMONEY_VERSION`               | Optional                                             | Release tag used by Compose                                              | `1.0.0`                                          | `1.0.0`                          |
| `MAX_UPLOAD_SIZE_MB`                | Optional                                             | Maximum attachment size, 1–100 MB                                        | `20`                                             | `20`                             |
| `ATTACHMENT_ALLOWED_MIME_TYPES`     | Optional                                             | Comma-separated accepted MIME types                                      | `application/pdf,image/png`                      | PDF, PNG, JPEG, WebP, text, CSV  |
| `ATTACHMENT_STORAGE_PROVIDER`       | Optional                                             | Deployment-default storage: `local` or `s3`                              | `local`                                          | `local`                          |
| `ATTACHMENT_LOCAL_PATH`             | Optional                                             | Container-local attachment root                                          | `/data/attachments`                              | `/data/attachments`              |
| `ATTACHMENT_HOST_PATH`              | Required for `docker/compose.prod.yml` local storage | Durable host attachment directory                                        | `/srv/bizziemoney/attachments`                   | `../.data/attachments`           |
| `ATTACHMENT_S3_BUCKET`              | Required for environment-default S3                  | Private bucket name                                                      | `private-bizziemoney`                            | Empty                            |
| `ATTACHMENT_S3_REGION`              | Optional                                             | S3 region                                                                | `auto`                                           | `auto`                           |
| `ATTACHMENT_S3_ENDPOINT`            | Optional                                             | S3-compatible endpoint URL                                               | `https://account.r2.cloudflarestorage.com`       | AWS default                      |
| `ATTACHMENT_S3_PREFIX`              | Optional                                             | Object-key prefix                                                        | `bizziemoney`                                    | `bizziemoney`                    |
| `ATTACHMENT_S3_FORCE_PATH_STYLE`    | Optional                                             | Enable path-style S3 requests                                            | `false`                                          | `false`                          |
| `ATTACHMENT_S3_ACCESS_KEY_ID`       | Optional secret                                      | S3 access-key ID; configure with secret key                              | `set-in-private-env`                             | Empty                            |
| `ATTACHMENT_S3_SECRET_ACCESS_KEY`   | Optional secret                                      | S3 secret access key                                                     | `set-in-private-env`                             | Empty                            |
| `ATTACHMENT_CLEANUP_INTERVAL_MS`    | Optional                                             | Worker cleanup polling interval                                          | `5000`                                           | `5000`                           |
| `ATTACHMENT_MALWARE_SCANNER`        | Optional                                             | `disabled` or fail-closed `clamav`                                       | `clamav`                                         | `disabled`                       |
| `CLAMAV_HOST`                       | Optional                                             | ClamAV hostname                                                          | `clamav`                                         | `clamav`                         |
| `CLAMAV_PORT`                       | Optional                                             | ClamAV port                                                              | `3310`                                           | `3310`                           |
| `CLAMAV_TIMEOUT_MS`                 | Optional                                             | Scanner timeout                                                          | `30000`                                          | `30000`                          |
| `BACKUP_LOCAL_PATH`                 | Optional                                             | Container-local backup root                                              | `/data/backups`                                  | `/data/backups`                  |
| `BACKUP_HOST_PATH`                  | Required for `docker/compose.prod.yml` local backups | Durable host backup directory                                            | `/srv/bizziemoney/backups`                       | `../.data/backups`               |
| `BACKUP_JOB_INTERVAL_MS`            | Optional                                             | Backup-queue polling interval                                            | `5000`                                           | `5000`                           |
| `BACKUP_SECRETS_KEY`                | Optional secret                                      | Separate key for saved storage/archive secrets; minimum 32 characters    | `set-in-private-env`                             | Derived from `SESSION_SECRET`    |
| `WORKER_HEARTBEAT_INTERVAL_MS`      | Optional                                             | Worker heartbeat interval                                                | `30000`                                          | `30000`                          |
| `SUBSCRIPTION_REMINDER_INTERVAL_MS` | Optional                                             | Subscription/debt maintenance interval                                   | `60000`                                          | `60000`                          |
| `SESSION_MAINTENANCE_INTERVAL_MS`   | Optional                                             | Expired-session cleanup interval                                         | `21600000`                                       | `21600000`                       |
| `SESSION_RETENTION_DAYS`            | Optional                                             | Expired/revoked session retention                                        | `30`                                             | `30`                             |

Test and maintenance commands additionally recognize `TEST_DATABASE_URL`,
`PERFORMANCE_DATABASE_URL`, `PERFORMANCE_MAX_QUERY_MS`, and the guarded
`BIZZIEMONEY_RECOVERY_CONFIRM` value described in
[docs/OWNER_RECOVERY.md](docs/OWNER_RECOVERY.md).

## Database setup

BizzieMoney uses PostgreSQL. Migrations live in
`packages/database/migrations` and are serialized with an advisory lock,
checksum-verified, and applied transactionally:

```bash
pnpm db:migrate
```

The root Compose workflow runs the same migration command automatically before
the API and worker start. Initial category and payment-method defaults are
created when the owner account is set up; no demo financial seed data is
included.

Before upgrading:

1. Create and verify a manual backup in Settings.
2. Back up PostgreSQL independently according to the database operator's
   policy.
3. Preserve attachment and backup volumes or host directories.
4. Apply migrations once.
5. Start the updated services and confirm health and worker status.

See [docs/DATABASE.md](docs/DATABASE.md),
[docs/BACKUPS.md](docs/BACKUPS.md), and
[docs/RESTORE.md](docs/RESTORE.md).

## Usage

After deployment:

1. Open BizzieMoney and create the one owner account.
2. Set currency, date, number, week, and time-zone preferences.
3. Review categories and payment methods.
4. Add the first expense, subscription, or loan/debt.
5. Configure attachment storage if local storage is not appropriate.
6. Configure automatic backups and verify a manual backup.
7. Review active sessions and protect the public hostname with an access
   gateway when appropriate.

## Updating

For published images:

```bash
docker compose pull
docker compose run --rm migrate
docker compose up -d
```

The root Compose file also runs the migration dependency automatically during
`up`. Running it explicitly makes failures visible before services are
replaced.

For source deployments, check out the intended release, run
`pnpm install --frozen-lockfile`, `pnpm build`, and `pnpm db:migrate`, then
restart API, worker, and web services. Never delete persistent volumes as part
of an update.

## Release publishing

The Docker workflow runs when a GitHub release is published and can also be
started manually. It builds Linux `amd64` and `arm64` images for the `web`,
`api`, and `worker` Dockerfile targets.

Before publishing:

1. Create the `bizziemoney` repository in the intended Docker Hub namespace.
2. In Docker Hub, open **Account settings > Personal access tokens** and create
   a token with permission to push that repository.
3. In GitHub, open **Repository > Settings > Secrets and variables > Actions**.
4. Add:
   - `DOCKERHUB_USERNAME`
   - `DOCKERHUB_TOKEN`
5. Publish a GitHub release with a semantic tag such as `v1.0.0`.

Stable releases receive full, minor, major, and `latest` tags. Prereleases
receive only their full version tags and never replace `latest`. The workflow
fails before login when either required secret is missing.

## Development

```bash
corepack enable
corepack prepare pnpm@11.17.0 --activate
pnpm install --frozen-lockfile
cp .env.example .env
pnpm db:migrate
pnpm dev
```

Quality commands:

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm performance:verify
```

PostgreSQL integration tests run when `TEST_DATABASE_URL` points to an
isolated database. See [docs/TESTING.md](docs/TESTING.md).

## Project structure

```text
apps/
  web/       React 19 + Vite interface
  api/       Fastify API and domain services
  worker/    Scheduled maintenance, cleanup, and backup processing
packages/
  config/    Shared TypeScript configuration
  database/  Kysely/pg client, migrations, and performance verification
  shared/    Cross-service contracts and date/format helpers
  storage/   Local and S3-compatible private object storage
  ui/        Design tokens and small shared UI utilities
docker/      Production/development images, Compose files, and Nginx gateway
docs/        Architecture, deployment, security, storage, and operations
tests/e2e/   Playwright browser tests
```

## Roadmap

These are possible directions, not delivery commitments:

- Add redacted public screenshots captured from a disposable dataset.
- Expand automated accessibility and physical-device browser verification.
- Add more import formats while preserving preview and atomic validation.
- Improve operator observability without introducing external telemetry.
- Continue restore drills across additional S3-compatible providers.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## Security

Read [SECURITY.md](SECURITY.md). Do not report vulnerabilities or suspected
data exposure in a public issue.

## License

BizzieMoney is available under the [MIT License](LICENSE).

## Acknowledgements

BizzieMoney depends on open-source projects including React, Vite, Fastify,
PostgreSQL, Kysely, Zod, TanStack Query, React Hook Form, Temporal,
Playwright, Vitest, Sharp, the AWS SDK, Nginx, and ClamAV.
