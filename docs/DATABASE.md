# Database

PostgreSQL is BizzieMoney’s source of truth. The database package provides
bounded connection pools, typed query support, and checksum-protected,
transactional migrations.

## Configuration

Set one connection string:

```dotenv
DATABASE_URL=postgresql://user:password@host:5432/bizziemoney
```

Inside Docker on Windows, use `host.docker.internal` when PostgreSQL runs on the
host. Use `postgres` only when the optional Compose `local-db` profile is active.

## Migrations

Migration files follow `NNNN_lowercase_name.sql` and are applied in lexical
order. Run:

```powershell
pnpm db:migrate
```

The `schema_migrations` journal is infrastructure owned by the migration runner.
Each domain change remains in a versioned SQL file. Do not edit a migration
after it has been applied; the checksum guard will stop the run.

## Phase 1 schema

| Table               | Purpose                                                     |
| ------------------- | ----------------------------------------------------------- |
| `schema_migrations` | Migration version, name, checksum, and application time     |
| `app_meta`          | Singleton application and schema version metadata           |
| `app_users`         | Singleton owner identity and Argon2id password digest       |
| `app_settings`      | Owner locale, time zone, currency, and appearance settings  |
| `sessions`          | Hashed opaque sessions, CSRF digests, expiry and revocation |
| `auth_rate_limits`  | Durable, windowed login-attempt counters                    |
| `audit_events`      | Append-only security event metadata                         |

The owner constraint is enforced with `owner_slot = 1` and a primary key on
that column. Session and rate-limit lookups have purpose-built indexes.
`audit_events` rejects update and delete operations through a database trigger.
Expired sessions are ignored even before a later maintenance job removes them.

## Phase 2 expense schema

| Table                       | Purpose                                           |
| --------------------------- | ------------------------------------------------- |
| `categories`                | Owner-defined categories with icon/color metadata |
| `payment_methods`           | Owner-defined payment methods                     |
| `tags`                      | Normalized owner-scoped expense tags              |
| `expenses`                  | Soft-deletable expenses with decimal money        |
| `expense_tags`              | Owner-safe expense/tag links                      |
| `expense_creation_requests` | Idempotent create request/result journal          |
| `expense_import_requests`   | Idempotent atomic CSV-import result journal       |

- Composite foreign keys include `owner_id`, preventing cross-owner category,
  payment-method, expense, and tag references.
- Amounts use `numeric(19,4)` and must be positive.
- Expense dates use PostgreSQL `date`; the Node driver returns the stored
  calendar date without applying a time-zone conversion.
- Search uses a generated weighted `tsvector` over description, merchant, and
  notes, backed by a GIN index.
- Owner/date, category/date, payment/date, amount, updated-time, tag, and
  idempotency lookups have focused indexes.
- Soft-deleted expenses are excluded from repository queries and summaries.
- Default categories and payment methods are added per owner, but no financial
  transactions are seeded.
- CSV import commits its request record, expense rows, tags, and audit event in
  one transaction. A validation error or database failure rolls back the
  complete batch.

## Phase 3 attachment schema

| Table                        | Purpose                                         |
| ---------------------------- | ----------------------------------------------- |
| `attachments`                | Immutable file metadata and opaque storage keys |
| `entity_attachments`         | Owner-safe expense/attachment links             |
| `attachment_upload_requests` | Idempotent upload request/result journal        |
| `attachment_cleanup_jobs`    | Durable physical object deletion with retries   |

- Attachment rows store provider, key, verified MIME type, size, SHA-256,
  safe display names, scan state, and lifecycle timestamps; file bytes remain
  outside PostgreSQL.
- Composite owner foreign keys prevent cross-owner links, and a validation
  trigger requires the target expense to exist and belong to the same owner.
- Deleting an expense soft-deletes its attachment metadata, removes its links,
  and queues cleanup in the same transaction.
- Cleanup claims use `FOR UPDATE SKIP LOCKED`, recover stale locks, and retry
  failed object deletion with bounded exponential backoff.
- Focused partial indexes cover active owner lists, entity links, upload
  idempotency, and ready cleanup jobs.

## Phase 4 subscription schema

| Table                              | Purpose                                   |
| ---------------------------------- | ----------------------------------------- |
| `subscriptions`                    | Recurring schedules and lifecycle state   |
| `subscription_payments`            | Immutable scheduled-payment history       |
| `subscription_payment_requests`    | Idempotent payment request/result journal |
| `subscription_conversion_requests` | Idempotent expense-conversion journal     |
| `subscription_reminders`           | Durable pending/ready reminder state      |

- Money uses `numeric(19,4)` and schedule fields use PostgreSQL `date`.
- Composite owner foreign keys prevent cross-owner category, payment, expense,
  reminder, and attachment references.
- Partial and composite indexes cover active due-date scans, filtered lists,
  search, payment history, foreign keys, and ready reminder claims.
- Recording a payment locks the subscription row, records one scheduled date,
  advances the schedule, and maintains reminders in one short transaction.
- Conversion creates exactly one expense and links it to the payment in the
  same transaction. Idempotency journals make retries safe.
- `entity_attachments` accepts active `expense` and `subscription` targets and
  validates both through the owner-safe trigger.

## Phase 5 loans and debts schema

| Table                   | Purpose                                   |
| ----------------------- | ----------------------------------------- |
| `debts`                 | Direction, terms, schedule, and lifecycle |
| `debt_payments`         | Editable, soft-deletable payment history  |
| `debt_payment_requests` | Idempotent payment-create request journal |

- Directions are `i_owe` and `owed_to_me`; lifecycle status supports active,
  paid, overdue, paused, and cancelled.
- Original and payment amounts use `numeric(19,4)`. Remaining and overpaid
  values are calculated from active payments in server queries.
- Payment create/edit locks the debt row and validates the aggregate inside the
  same transaction. An excess total requires explicit overpayment consent.
- Partial/composite indexes cover owner, direction, status, due date, updated
  time, search, payment history, foreign keys, and idempotency cleanup.
- `entity_attachments` also accepts active `debt` and `debt_payment` targets;
  the validation trigger checks owner and soft-delete state.

## Phase 6 backup schema

| Table               | Purpose                                      |
| ------------------- | -------------------------------------------- |
| `backup_configs`    | Redacted schedule/destination configuration  |
| `backup_jobs`       | Durable backup, preview, and restore queue   |
| `backup_artifacts`  | Verified immutable artifact metadata         |
| `restore_previews`  | Expiring verification and confirmation state |
| `worker_heartbeats` | Coarse backup-worker liveness                |

- Partial indexes cover ready queue claims, one active owner job, verified
  artifact history, due schedules, and unused restore previews.
- Job claims use row locks with `SKIP LOCKED`; stale processing work is failed
  with a safe error instead of being silently abandoned.
- Idempotency keys are unique per owner. Restore previews are owner-bound,
  expiring, single-use records.
- Credentials and archive passwords are authenticated-encryption ciphertext;
  no plaintext backup secret is stored.
- Backup artifacts record SHA-256, size, storage identity, application/schema
  versions, attachment inclusion, and verification time.

## Phase 7 query verification

Migration `0009_hardening.sql` adds subscription amount/update ordering,
unfiltered debt due-date ordering, and active backup-job indexes.

`packages/database/src/performance.ts` creates a random isolated schema,
applies every migration, inserts the target synthetic volumes, and runs
`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` for representative list and search
queries. It asserts the expected indexes and bounded execution time, then drops
the schema in `finally`. It never seeds the owner schema.

## Phase 9 portable data management

| Table                      | Purpose                                      |
| -------------------------- | -------------------------------------------- |
| `financial_purge_requests` | Idempotent completed financial-purge journal |

- The `(owner_id, idempotency_key)` primary key serializes retries, while
  `request_hash` rejects reuse with a different operation.
- `result` and `completed_at` are both null before completion or both present
  afterward, so a committed request always has a replayable aggregate result.
- Purge locks queued/processing backup jobs before deleting any financial row,
  queues attachment originals and thumbnails, removes dependent records in
  foreign-key order, appends one audit event, and completes the journal in one
  transaction.
- Migration `0012_portable_data_management.sql` upgrades the application to
  version 0.11.0 and schema 12.

## Phase 10 attachment storage settings

| Table                            | Purpose                                      |
| -------------------------------- | -------------------------------------------- |
| `attachment_storage_configs`     | Current owner provider and redacted S3 setup |
| `attachment_storage_s3_profiles` | Retained encrypted historical S3 locations   |

- S3 credentials are AES-256-GCM ciphertext and never stored as plaintext.
- Each S3 bucket/prefix root has an owner-scoped profile. Switching the active
  provider or root therefore does not make older attachment rows unreadable.
- Local storage remains deployment-managed through `ATTACHMENT_LOCAL_PATH`;
  physical host paths are not stored in owner-editable settings or returned to
  the browser.
- Migration `0013_attachment_storage_settings.sql` upgrades the application to
  version 0.12.0 and schema 13.

## Phase 11 category deletion

- Category deletion locks the source and replacement category rows.
- The replacement must be different, active, and owned by the same owner.
- Every referencing expense and subscription is reassigned before the source
  category is removed, all within one transaction.
- `category.deleted` audit metadata contains only source/replacement IDs and
  reassignment counts.
- Migration `0014_category_deletion.sql` upgrades the application to version
  0.13.0 and schema 14.

## Restore hardening and initial public release

- Migration `0015_restore_trigger_hardening.sql` preserves the migration
  schema in the attachment-owner validation function so restored databases do
  not depend on a caller's default `search_path`.
- Migration `0016_initial_public_release.sql` records application version
  1.0.0 and schema 16. It changes release metadata only and does not rewrite
  financial records.
