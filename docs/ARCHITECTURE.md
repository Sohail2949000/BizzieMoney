# BizzieMoney Architecture

## Phase 1 decision record

BizzieMoney starts as a single-owner application but keeps ownership boundaries
explicit. Phase 1 creates a singleton owner without making later domain code
depend on “there is only one row.”

## Runtime topology

```text
Browser
  |
  v
apps/web (React + Vite)
  |
  v
apps/api (Fastify)
  |
  +----------------------+
  |                      |
  v                      v
PostgreSQL          Private storage adapter
  ^
  |
apps/worker
```

- `web` owns accessible presentation and local interaction state.
- `api` owns authentication, validation, authorization, and domain
  transactions.
- `worker` claims durable PostgreSQL-backed jobs with row locking.
- PostgreSQL is the source of truth.
- Attachment bytes live outside PostgreSQL behind a local or S3-compatible
  storage adapter. Only metadata and opaque object keys are stored in the
  database.

No Redis, public registration, analytics, or external telemetry is introduced.

## Workspace boundaries

| Workspace           | Responsibility                                      | Must not own                       |
| ------------------- | --------------------------------------------------- | ---------------------------------- |
| `apps/web`          | Routes, responsive shell, forms, query presentation | Secrets, SQL, server authorization |
| `apps/api`          | HTTP boundary and request lifecycle                 | Scheduled execution                |
| `apps/worker`       | Durable background execution                        | Browser-facing endpoints           |
| `packages/database` | Pooling, SQL types, migrations                      | HTTP semantics                     |
| `packages/shared`   | Stable cross-service constants/contracts            | Environment secrets                |
| `packages/storage`  | Private local/S3 object operations                  | HTTP authorization                 |
| `packages/ui`       | Design tokens and tiny reusable primitives          | Product data fetching              |
| `packages/config`   | Shared compiler configuration                       | Runtime configuration              |

Dependencies point inward to focused packages; app packages do not import each
other.

## Phase 2 expense boundary

Expenses are implemented as a focused vertical slice. The web app owns form
and query presentation, the API owns validation and authorization, and the
PostgreSQL repository owns durable filtering, ordering, pagination, and
transactions. No browser-supplied owner identifier is accepted.

Expense queries use server-side category/date/search filters and stable keyset
cursors. Money crosses HTTP boundaries as decimal strings and is stored as
`numeric(19,4)`.

Creates require a UUID `Idempotency-Key`. PostgreSQL records the key, a
canonical request hash, and the resulting expense inside one transaction.
Replaying the same request returns the original expense; reusing a key with a
different body is rejected.

CSV imports use a separate preview/commit workflow. The preview parser handles
RFC 4180 quoting, validates bounded rows against active owner options, and
does not write. Commit re-parses the original text, refuses partial success,
and records the idempotency journal, all expenses, normalized tags, and one
safe audit event in a single PostgreSQL transaction.

Deletes are soft deletes. Category and payment-method archival preserves
historical display values while keeping archived options out of new-expense
forms.

Permanent category deletion is a separate guarded workflow. The API locks the
source and active replacement, reassigns every expense and subscription, writes
an audit event, and removes the source category in one transaction.

## Phase 3 attachment boundary

The browser queues files locally and displays upload progress, but the API is
the authority for size, type, ownership, and object keys. Uploads are staged
with restrictive permissions, hashed, validated across the complete stream,
and written to private storage before immutable metadata and the expense link
are committed. A UUID idempotency record makes retries safe.

The storage package exposes the same write, read, delete, and connection-test
contract for local disk and S3-compatible providers. User file names are
display metadata only; generated keys are partitioned by owner and cannot
escape the configured prefix or local root.

Image uploads create a small WebP thumbnail beside the original object. The
thumbnail is a derived cache, so missing thumbnails can be regenerated from
the original without changing financial or attachment metadata.

Deleting an attachment or its expense commits the logical deletion and cleanup
jobs for the original and derived thumbnail together. The worker claims ready
jobs with `FOR UPDATE SKIP LOCKED`, deletes the physical objects, and records
completion or a bounded backoff retry. An upload whose database transaction
fails also attempts immediate object cleanup and falls back to the same durable
queue.

## Phase 4 subscription boundary

Subscriptions are another focused vertical slice. The browser owns form and
query state; the API owns lifecycle validation, authorization, schedule
calculation, and atomic payment conversion; PostgreSQL owns durable filtering,
keyset pagination, reminders, and idempotency.

Frequency advancement is calendar-safe: month-end and leap-day schedules clamp
to the last valid day instead of accumulating JavaScript date drift. Recording
a payment locks the subscription row before writing history and advancing the
next date. Expense creation remains an explicit user action. A separate
idempotency journal guarantees that retries cannot create a second expense.

The worker serializes reminder maintenance with a PostgreSQL advisory lock,
marks due reminders ready, completes stale reminders, and ends subscriptions
whose configured end date has passed. It never creates financial transactions.

## Phase 5 loans and debts boundary

Loans and debts use beginner-facing directions: `i_owe` and `owed_to_me`.
Payments are stored separately from the record. List, summary, and upcoming
queries calculate paid, remaining, and overpaid amounts from active payment
rows; the browser never supplies a remaining balance.

Payment create and edit lock the parent debt before comparing the database
payment total with the original amount. Overpayments are rejected unless the
request carries explicit confirmation, and payment creation has an
idempotency journal. Completing and reopening a record append audit events.
The worker maintains active/overdue state without creating payments.

## Phase 6 backup and restore boundary

Backup configuration and jobs are durable PostgreSQL records. The API validates
and redacts configuration, seals S3 credentials and optional archive
passwords, and only enqueues idempotent work. The worker claims jobs with
`FOR UPDATE SKIP LOCKED`, emits progress, and writes artifacts through the
local/S3 storage contract.

Every archive contains a data-only PostgreSQL logical dump, a manifest with
application/schema versions and table counts, attachment metadata, and
per-file SHA-256 checksums. Attachment bytes are optional. The worker uploads
to a temporary local object and completes atomically, verifies the stored
checksum, records the artifact, and only then applies retention.

A restore preview verifies the artifact and reports its manifest without
changing data. Restore is password-gated at the API, creates a verified safety
backup first, restores the selected business tables in one PostgreSQL
transaction, and automatically reapplies the safety backup if the target
restore fails.

## Database foundation

The database package uses Kysely as a typed SQL builder over `pg`. Pool defaults
are intentionally bounded:

- 10 API connections
- 2 worker connections
- 5 second connection timeout
- 15 second statement timeout
- 30 second idle timeout

The migration runner serializes work with a PostgreSQL advisory lock, verifies
SHA-256 checksums, and applies each ordered migration in its own transaction.
Applied migration files are immutable; corrections require a new migration.

`0001_foundation.sql` creates application/schema version metadata.
`0002_owner_auth.sql` creates the owner, settings, sessions, durable login-rate
limits, and append-only audit events.
`0003_expenses.sql` creates owner-scoped categories, payment methods, tags,
expenses, tag links, and create-request idempotency records.
`0004_attachments.sql` creates attachment metadata, owner-safe expense links,
upload idempotency records, and durable object-cleanup jobs.
`0005_subscriptions.sql` creates recurring schedules, payment and conversion
idempotency records, durable reminders, and owner-safe subscription attachment
links.
`0006_debts.sql` creates loans/debts, separate payment history, payment-create
idempotency, due-date indexes, and owner-safe record/payment attachment links.
`0007_backups.sql` creates owner-scoped backup configuration, durable jobs,
verified artifacts, and restore previews.
`0008_backup_worker_heartbeat.sql` adds durable backup-worker liveness state.
`0009_hardening.sql` adds the indexes required by the target-scale query-plan
gate.
`0010_regional_preferences.sql` adds constrained number formatting and upgrades
the application metadata to version 0.9.0/schema 10.
`0011_expense_csv_import.sql` adds the bulk-import idempotency journal and
upgrades the application metadata to version 0.10.0/schema 11.
`0012_portable_data_management.sql` adds the financial-purge idempotency
journal and upgrades the application metadata to version 0.11.0/schema 12.
`0013_attachment_storage_settings.sql` adds owner-configurable attachment
storage and retained S3/R2 profiles.
`0014_category_deletion.sql` adds guarded category reassignment and permanent
deletion.
`0015_restore_trigger_hardening.sql` makes owner-validation triggers portable
across backup restore search paths.
`0016_initial_public_release.sql` records application version 1.0.0/schema 16
without changing financial records.

## Owner and session boundary

`app_users.owner_slot` is constrained to `1`, so PostgreSQL—not an application
race—enforces the single-owner rule. The owner’s ID remains the authorization
boundary passed to repositories and will become the foreign key on financial
records.

The browser receives an opaque random session token in an `HttpOnly`,
`SameSite=Strict` cookie. PostgreSQL stores only its HMAC-SHA-256 digest.
Unsafe requests also require a readable CSRF cookie, matching request header,
stored CSRF digest, and exact application origin. No JWT or authentication
credential is stored in browser storage.

The React application starts with one bootstrap request that returns setup or
authenticated state. It does not chain separate setup, user, and session
requests. The owner menu and settings page use the authenticated state from
that boundary.

## Data integrity rules

- Money uses `numeric(19,4)`, never floating point.
- Currency is stored on every financial record; aggregates are grouped by
  currency and never converted or combined.
- Timestamps are stored in UTC.
- Calendar dates remain date-only values; owner-local boundaries and schedules
  use the saved IANA time zone.
- Multi-record domain changes use database transactions.
- Idempotency keys protect externally repeatable writes.
- Remaining debt amounts are calculated and validated on the server.
- Critical events are appended to the audit stream.
- Search, sorting, filtering, and pagination stay server-side.
- User-provided file names never become storage object keys.

## UI system

The app shell is an original BizzieMoney layout built from the brief’s neutral
palette, not a copy of the supplied inspiration:

- desktop sidebar, tablet icon rail, and five-item mobile bottom navigation;
- 8–12px radii, subtle borders, and one small shadow token;
- no gradients, glass effects, decorative motion, or large chart surfaces;
- native system font stack;
- light, dark, and system preferences;
- visible focus rings and at least 44px mobile targets;
- truthful em-dash/no-data states rather than seeded financial data.

The dashboard remains an intentional onboarding empty state. Domain screens
replace it incrementally as their phases become functional.

## Operational posture

Phase 7 production uses three immutable image targets:

- unprivileged Nginx serves the web build and proxies same-origin `/api`;
- a non-root API image owns HTTP authorization and database access;
- a non-root worker image owns scheduled and recovery work.

The production Compose file does not create PostgreSQL. Attachment and backup
directories are explicit host mounts, runtime roots are read-only, and only
the web gateway publishes a host port. Performance validation runs in a
generated PostgreSQL schema and never seeds the owner schema.

Production connects to PostgreSQL through `DATABASE_URL`; the main runtime does
not require a database container. Development Compose optionally provides
PostgreSQL under the `local-db` profile.

Host-mounted paths or external object storage hold attachments and backup
artifacts. Container layers and anonymous volumes are never data or backup
destinations.

Graceful shutdown hooks close HTTP listeners and PostgreSQL pools. Public
`/health` and `/ready` endpoints disclose only coarse service state. API errors
return safe messages and request IDs; server logs retain diagnostic detail.
The worker publishes a database heartbeat, processes attachment cleanup,
maintains subscription reminders and end-date state, synchronizes debt overdue
status, and publishes backup queue heartbeat/progress.

Portable exports are assembled by the API in a private temporary directory.
The database snapshot uses a read-only repeatable-read transaction, while
attachment bytes are streamed from private storage into a USTAR/gzip archive
and checked against their recorded size and SHA-256 before the file is sent.
Temporary files are removed when the response closes.

Financial purge is a separate idempotent database transaction. It refuses to
race queued or active backup/restore work, journals the completed aggregate
result, appends a safe audit event, and queues original and thumbnail objects
for the existing cleanup worker. Owner identity, active authentication,
preferences, categories, payment methods, and backup artifacts are outside the
purge set.

Attachment storage selection is owner-scoped and resolved at operation time.
Environment configuration remains the fallback and supplies the protected
local host path. Saved S3/R2 configurations are sealed under
`BACKUP_SECRETS_KEY` (or `SESSION_SECRET`) and mirrored into retained
root-specific profiles. Uploads use the current profile; reads, portable
exports, restores, and cleanup jobs resolve the profile recorded on each
attachment. Provider changes never move existing bytes implicitly.
