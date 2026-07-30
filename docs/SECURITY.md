# Security

## Authentication model

BizzieMoney permits exactly one owner. First-run setup is enabled only while no
owner exists; there is no public registration route, seeded account, or default
password. Passwords are hashed with Argon2id using 64 MiB of memory, three
iterations, and one lane.

Successful authentication creates independent, 32-byte random session and CSRF
tokens. Raw session tokens are never stored in PostgreSQL or application logs.
The server stores keyed HMAC-SHA-256 digests derived from `SESSION_SECRET`.

## Browser protections

- The session cookie is `HttpOnly`, `SameSite=Strict`, and path-scoped to `/`.
- The CSRF cookie is readable by the client but also `SameSite=Strict`.
- Every unsafe authenticated request must present the CSRF value in both the
  cookie and `x-csrf-token` header.
- The API validates the digest held by the active database session.
- Unsafe requests must carry an origin exactly listed in
  `APP_ALLOWED_ORIGINS`; `APP_URL` is always included as the primary origin.
- Cross-origin credentials are accepted only from those normalized, exact
  application origins. Wildcards, malformed origins, and URL paths are
  rejected at startup.
- Authentication and bootstrap responses use `Cache-Control: no-store`.
- All authenticated API responses use `Cache-Control: no-store`.
- Authentication cookies receive the `Secure` attribute for requests from an
  allowed HTTPS origin or an HTTPS-forwarded tunnel, while HTTP localhost
  remains usable for development.

## Expense authorization and safety

- Every expense, category, payment-method, tag, summary, and export query is
  scoped with the owner ID resolved from the active server session.
- Composite owner foreign keys provide a second database-level IDOR boundary.
- POST, PATCH, and DELETE routes require both CSRF validation and the exact
  configured origin.
- Category deletion requires a different owner-scoped active replacement and
  commits expense/subscription reassignment, audit logging, and deletion in
  one transaction.
- Expense creates require UUID idempotency keys and reject a reused key when
  the request body differs.
- Amounts, dates, currency, text lengths, filters, sorts, cursors, icons,
  colors, and tag counts are validated at the API boundary.
- Deletes are recoverable soft deletes and financial mutations append safe
  audit metadata.
- CSV cells that begin with spreadsheet formula characters are escaped.
- CSV import is bounded to 2 MB and 1,000 rows, previews field-level failures,
  exact-matches active owner options, and revalidates before an all-or-nothing
  transaction. Commit retries use a UUID idempotency key.
- Search and filters are parameterized through Kysely; input is not
  concatenated into SQL.

## Abuse and disclosure controls

Login is limited to five failed attempts in a rolling 15-minute window. The
limit is durable in PostgreSQL and keyed by HMAC digests of both the submitted
email and source address. Login failures return a generic message so callers
cannot enumerate the owner email. Security events append safe metadata to
`audit_events`; a database trigger prevents mutation or deletion.

API error responses expose a safe description and request ID, while diagnostic
details remain in structured server logs. Health endpoints do not reveal
configuration, database credentials, or owner data.

## Attachment controls

- Upload, list, preview, download, and delete operations derive the owner from
  the active server session; no browser-supplied owner ID is trusted.
- UUID idempotency keys make upload retries safe without duplicating metadata
  or storage objects.
- Size limits are enforced while streaming. PDF, PNG, JPEG, WebP, TXT, and CSV
  content is checked against its signature or complete UTF-8 stream,
  extension, and browser-declared MIME type.
- Original names are normalized and sanitized for display only. Storage keys
  are generated server-side and local paths are checked against the configured
  root.
- Local staging files use restrictive permissions and are removed on success
  or failure. Storage objects are private and are streamed only after a fresh
  authorization check with `nosniff` and explicit content disposition.
- Logical deletion and cleanup jobs are committed atomically. The worker
  retries failed physical deletion without restoring user-visible metadata.

## Subscription controls

- Every subscription, payment, reminder, and conversion query is scoped with
  the owner ID resolved from the active session.
- Composite owner foreign keys prevent cross-owner categories, payments,
  converted expenses, reminders, and attachments.
- Payment and conversion writes require UUID idempotency keys; keys reused
  with a different request body are rejected.
- Recording, schedule advancement, lifecycle changes, reminder maintenance,
  and conversion use short database transactions with state checks.
- Expense conversion is explicit and creates exactly one linked expense.
  Reminder processing never creates financial records.
- Frequency, status, amount, currency, dates, reminder days, search, sort, and
  cursor inputs are validated at the API boundary.

## Loans and debts controls

- Every debt, payment, summary, upcoming-payment, and attachment query is
  owner-scoped from the authenticated session.
- Composite owner foreign keys and attachment validation prevent cross-owner
  references.
- Payment create/edit locks the debt row, aggregates active payments in
  PostgreSQL, and rejects an excess total without explicit confirmation.
- Payment creation uses a UUID idempotency key and request hash. Completion,
  reopening, correction, deletion, and overpayment consent append safe audit
  metadata.
- The client cannot submit a remaining balance. Amounts, directions, statuses,
  dates, installment fields, search, sort, and cursors are validated at the API
  boundary.

## Backup and restore controls

- Backup config, status, history, preview, and restore are owner-scoped from
  the active session. Unsafe actions require CSRF and exact-origin validation.
- Saved S3 credentials and optional archive passwords are sealed with
  AES-256-GCM under `BACKUP_SECRETS_KEY`, or `SESSION_SECRET` when the separate
  key is blank. They are never returned by the API.
- Local subfolders and generated object keys are validated and confined below
  `BACKUP_LOCAL_PATH`. S3 objects remain private.
- Archive contents are path-checked before extraction. Stored artifacts and
  included files are SHA-256 verified before use.
- Restore requires the current owner password and a ready, unexpired,
  single-use preview. The worker creates a safety backup before mutation and
  attempts automatic rollback on failure.
- Errors sent to the browser are allow-listed and omit command output,
  connection strings, credentials, object keys, and physical paths.

## Portable export and purge controls

- Portable export requires an authenticated owner session and is generated in
  a private temporary directory. Attachment bytes are verified against stored
  size and SHA-256 before the complete archive is returned.
- Export records exclude password/session/CSRF hashes, rate-limit state,
  request journals, audit logs, backup secrets, jobs, artifacts, object keys,
  and physical storage roots.
- Financial purge requires current-password verification, matching CSRF
  cookie/header, an exact configured origin, a UUID idempotency key, and the
  exact `DELETE ALL DATA` phrase.
- Purge is all-or-nothing and refuses to race queued or processing backup or
  restore jobs. It records only aggregate deletion counts in the append-only
  audit stream.
- Backups are intentionally not erased by financial purge and may contain
  older data. The confirmation dialog makes that retention explicit.

## Attachment storage settings

- The local attachment root is deployment-managed and never returned to the
  browser.
- S3/R2 credentials are accepted only over an authenticated, CSRF-protected,
  exact-origin request and are sealed with AES-256-GCM before persistence.
- Read APIs return only `hasCredentials`; access and secret keys are never
  returned, logged, or included in audit metadata.
- Candidate endpoints must be exact HTTP(S) origins without credentials,
  paths, queries, or fragments. Bucket, region, and object-prefix inputs are
  bounded and validated.
- Saving verifies the selected destination before activation. Audit events
  contain changed field names only.
- Historical S3 profiles are retained so existing private objects and cleanup
  jobs remain addressable after the active location changes.

## Secrets and deployment

Generate `SESSION_SECRET` independently for each installation, keep it outside
source control, and do not rotate it without expecting all sessions to become
invalid. Terminate TLS before exposing BizzieMoney outside a trusted local
network. Configure only exact trusted values in `APP_ALLOWED_ORIGINS` and
`VITE_ALLOWED_HOSTS`; never use wildcards. When Cloudflare Tunnel publishes the
development server, put Cloudflare Access in front of the hostname because the
application contains private financial data. Production enables an API Content
Security Policy, and the Nginx gateway adds CSP, framing, MIME-sniffing,
permissions, and referrer protections.

Never log or back up plaintext passwords, session tokens, CSRF tokens,
connection strings, or application secrets.

## Operational protections

- There is intentionally no browser password-recovery bypass. The supported
  [offline owner recovery procedure](OWNER_RECOVERY.md) refuses to run while
  API or worker connections are active, hashes the replacement with Argon2id,
  revokes all sessions, and records an audit event.
- The worker prunes expired/revoked sessions and stale login-rate records only
  after the configured retention window. Expiry enforcement remains immediate.
- Optional ClamAV scanning is fail-closed and occurs before storage. Internet-
  exposed deployments should enable the `malware-scan` Compose profile;
  signature freshness and container health remain operator responsibilities.
- Spreadsheet formula prefixes are neutralized during CSV export and restored
  only for the matching exported text pattern during import.
