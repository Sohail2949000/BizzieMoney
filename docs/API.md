# API

The API is served under `/api`. Authenticated routes use the opaque
session cookie created by the owner login flow. Unsafe routes also require the
CSRF cookie value in `x-bm-csrf` and an exact configured application origin.

Money values are decimal strings. Dates are `YYYY-MM-DD`. Error responses
contain a safe message, code, and request ID.

## Owner account

| Method | Route                       | Purpose                              |
| ------ | --------------------------- | ------------------------------------ |
| GET    | `/api/auth/bootstrap`       | Read setup/authenticated owner state |
| PATCH  | `/api/auth/profile`         | Update owner name and login email    |
| GET    | `/api/auth/sessions`        | List active owner sessions           |
| POST   | `/api/auth/change-password` | Change the owner password            |

Profile changes require an authenticated session, matching CSRF proof, the
configured application origin, and the current owner password. The update is
written with an append-only audit event; secrets and the supplied password are
never included in audit metadata.

## Regional preferences

| Method | Route                       | Purpose                                |
| ------ | --------------------------- | -------------------------------------- |
| GET    | `/api/settings/preferences` | Read the complete owner preference set |
| PATCH  | `/api/settings/preferences` | Partially update regional preferences  |

PATCH accepts one or more of `defaultCurrency`, `numberFormat`, `dateFormat`,
`firstDayOfWeek`, and `timeZone`. Values are validated against supported ISO
currency codes, the documented format sets, weekday range `0–6`, and IANA time
zones. Successful changes write an audit event containing only changed field
names.

## Expense options

| Method | Route                                                  | Purpose                                  |
| ------ | ------------------------------------------------------ | ---------------------------------------- |
| GET    | `/api/expense-options`                                 | List categories/payment methods          |
| POST   | `/api/expense-categories`                              | Create a category                        |
| PATCH  | `/api/expense-categories/:categoryId`                  | Edit, archive, or restore                |
| GET    | `/api/expense-categories/:categoryId/deletion-preview` | Count usage and list replacements        |
| DELETE | `/api/expense-categories/:categoryId`                  | Reassign records and delete the category |
| POST   | `/api/payment-methods`                                 | Create a payment method                  |
| PATCH  | `/api/payment-methods/:paymentMethodId`                | Edit, archive, or restore                |

Pass `includeArchived=true` to the options route for the Settings managers.
Archived options stay attached to historical expenses but are excluded from
new-expense selection.

Category deletion accepts `{ "replacementCategoryId": "<uuid>" }`. The
replacement must be a different active category owned by the current owner.
Expenses and subscriptions, including retained soft-deleted rows, are updated
and the source category is deleted in one transaction. The audit event records
only category IDs and reassignment counts.

## Expenses

| Method | Route                          | Purpose                                 |
| ------ | ------------------------------ | --------------------------------------- |
| GET    | `/api/expenses`                | Search/filter/sort/paginate expenses    |
| GET    | `/api/expenses/:expenseId`     | Read one expense                        |
| POST   | `/api/expenses`                | Create an expense                       |
| PATCH  | `/api/expenses/:expenseId`     | Update an expense                       |
| DELETE | `/api/expenses/:expenseId`     | Soft-delete an expense                  |
| GET    | `/api/expenses/summary`        | Month total, categories, and recent     |
| GET    | `/api/expenses/export.csv`     | Export the filtered result as CSV       |
| POST   | `/api/expenses/import/preview` | Parse and validate a CSV without writes |
| POST   | `/api/expenses/import`         | Atomically import a validated CSV       |

Create requires an `Idempotency-Key` header containing a UUID. A replay with
the same body returns the original result; a different body with the same key
returns a conflict.

CSV commit also requires a UUID `Idempotency-Key`. Preview and commit accept
`{ "csvText": "..." }`. Files are limited to 2 MB and 1,000 non-empty rows.
`Date`, `Description`, and `Amount` headers are required. Currency, category,
payment method, merchant, notes, and semicolon-separated tags are optional;
blank optional values use the saved default currency and active `Other`
options. The application export format can be imported directly. Every row is
revalidated at commit time, and one invalid row prevents all database writes.

List and export accept:

- `categoryId`
- `dateFrom` and `dateTo` as inclusive dates
- `search` for description, merchant, and notes
- `hasAttachments`: `true` or `false`
- `sort`: `date_desc`, `date_asc`, `amount_desc`, `amount_asc`, or
  `updated_desc`

The list route also accepts `limit` and an opaque `cursor`. Cursors are tied to
the chosen sort and provide stable keyset pagination; clients must not inspect
or modify them.

Summary requires `month=YYYY-MM` and returns `defaultCurrency`, `count`,
`recent`, and `currencyGroups`. Each group has `currencyCode`, `totalAmount`,
and its own category breakdown. CSV export uses the same filter and sort
contract as the list route, includes the attachment count, and escapes
formula-like spreadsheet cells.

## Attachments

| Method | Route                                            | Purpose                           |
| ------ | ------------------------------------------------ | --------------------------------- |
| GET    | `/api/expenses/:expenseId/attachments`           | List an expense's attachments     |
| POST   | `/api/expenses/:expenseId/attachments`           | Upload one multipart file         |
| GET    | `/api/subscriptions/:subscriptionId/attachments` | List subscription attachments     |
| POST   | `/api/subscriptions/:subscriptionId/attachments` | Upload a subscription file        |
| GET    | `/api/debts/:debtId/attachments`                 | List loan/debt attachments        |
| POST   | `/api/debts/:debtId/attachments`                 | Upload agreement or receipt       |
| GET    | `/api/debt-payments/:paymentId/attachments`      | List payment proof                |
| POST   | `/api/debt-payments/:paymentId/attachments`      | Upload payment proof              |
| GET    | `/api/attachments/:attachmentId/content`         | Stream an authorized file         |
| GET    | `/api/attachments/:attachmentId/thumbnail`       | Stream a small image thumbnail    |
| DELETE | `/api/attachments/:attachmentId`                 | Delete metadata and queue cleanup |

Upload requires a UUID `Idempotency-Key`, a multipart `file` field, CSRF
validation, and the configured application origin. The server enforces the
configured byte limit, validates the entire stream, checks signatures,
extension, and declared MIME type, computes SHA-256, generates an opaque object
key, and then stores immutable metadata.

Pass `disposition=inline` or `disposition=attachment` to the content route for
preview or download. Files never receive a public storage URL; every list,
content, and delete operation is owner-scoped through the authenticated
session.

PNG, JPEG, and WebP uploads receive a bounded 160-pixel WebP thumbnail. The
thumbnail route is authenticated, uses private caching, and regenerates the
derived object from the original if an older installation or restored backup
does not already contain it.

## Attachment storage

| Method | Route                          | Purpose                               |
| ------ | ------------------------------ | ------------------------------------- |
| GET    | `/api/attachment-storage`      | Read redacted config and usage status |
| PATCH  | `/api/attachment-storage`      | Test and save the active provider     |
| POST   | `/api/attachment-storage/test` | Test a local or S3/R2 candidate       |

`PATCH` and `POST /test` accept `provider` plus optional S3-compatible bucket,
region, endpoint, prefix, path-style flag, and a credential pair. Leaving both
credential fields blank keeps saved credentials; `removeCredentials` clears
them for role-based deployments. Unsafe calls require the authenticated
session, exact origin, and CSRF protection.

Responses include the non-secret bucket configuration needed to edit Settings,
but deliberately omit credential values and physical local paths. Saving first
tests the selected destination and appends an audit event containing only
changed field names.

## Subscriptions

| Method | Route                                           | Purpose                            |
| ------ | ----------------------------------------------- | ---------------------------------- |
| GET    | `/api/subscriptions`                            | Search/filter/sort/paginate        |
| POST   | `/api/subscriptions`                            | Create a subscription              |
| GET    | `/api/subscriptions/:subscriptionId`            | Read one subscription              |
| PATCH  | `/api/subscriptions/:subscriptionId`            | Update schedule and details        |
| DELETE | `/api/subscriptions/:subscriptionId`            | Soft-delete a subscription         |
| POST   | `/api/subscriptions/:subscriptionId/pause`      | Pause an active renewal            |
| POST   | `/api/subscriptions/:subscriptionId/resume`     | Resume a paused renewal            |
| POST   | `/api/subscriptions/:subscriptionId/cancel`     | Cancel an active or paused renewal |
| GET    | `/api/subscriptions/:subscriptionId/payments`   | Read payment history               |
| POST   | `/api/subscriptions/:subscriptionId/payments`   | Record one scheduled payment       |
| POST   | `/api/subscription-payments/:paymentId/convert` | Convert one payment to one expense |
| GET    | `/api/subscriptions/upcoming`                   | Read the bounded upcoming window   |
| GET    | `/api/subscription-reminders`                   | Read ready in-app reminders        |
| DELETE | `/api/subscription-reminders/:reminderId`       | Dismiss one reminder               |

Payment recording and conversion require a UUID `Idempotency-Key`. A replay
with the same body returns the original result; a different body with the same
key returns a conflict. Recording a payment advances the next date using
calendar-safe weekly, monthly, quarterly, semiannual, yearly, or custom-day
rules. Conversion is always explicit and atomic; recording a payment alone
never creates an expense.

## Loans and debts

| Method | Route                           | Purpose                               |
| ------ | ------------------------------- | ------------------------------------- |
| GET    | `/api/debts`                    | Search/filter/sort/paginate one tab   |
| POST   | `/api/debts`                    | Create a loan or debt                 |
| GET    | `/api/debts/:debtId`            | Read one record and server balance    |
| PATCH  | `/api/debts/:debtId`            | Update details and schedule           |
| DELETE | `/api/debts/:debtId`            | Soft-delete record, payments, files   |
| POST   | `/api/debts/:debtId/:action`    | Pause/resume/cancel/complete/reopen   |
| GET    | `/api/debts/:debtId/payments`   | Read separate payment history         |
| POST   | `/api/debts/:debtId/payments`   | Record an idempotent partial/full pay |
| PATCH  | `/api/debt-payments/:paymentId` | Correct a payment                     |
| DELETE | `/api/debt-payments/:paymentId` | Soft-delete a payment and proof       |
| GET    | `/api/debts/summary`            | Remaining totals in both directions   |
| GET    | `/api/debts/upcoming`           | Bounded installments/repayments due   |

Lists require `direction=i_owe` or `direction=owed_to_me` and accept `search`,
`status`, `sort`, `limit`, and an opaque keyset `cursor`. Payment creation
requires a UUID `Idempotency-Key`. `allowOverpayment` defaults to `false`; the
API rejects an excess payment until the user explicitly confirms and retries
with it set to `true`.

Debt summary returns `defaultCurrency` and `currencyGroups`. Each group
contains `currencyCode`, `iOwe`, and `owedToMe`; currencies are never converted
or combined.

## Portable data management

| Method | Route              | Purpose                                  |
| ------ | ------------------ | ---------------------------------------- |
| GET    | `/api/data/export` | Download a portable owner-data `.tar.gz` |
| POST   | `/api/data/purge`  | Permanently remove live financial data   |

The export is authenticated and returns `manifest.json`, `README.txt`,
`records.ndjson`, and checksum-verified attachment binaries. Authentication
secrets, sessions, rate limits, audit logs, request journals, backup
credentials, jobs, and artifacts are deliberately excluded.

Purge requires CSRF, exact-origin validation, a UUID `Idempotency-Key`,
`currentPassword`, and the exact confirmation string `DELETE ALL DATA`. It
deletes expenses, subscriptions, debts, their payment history, tags, and live
attachment metadata in one transaction, then queues physical attachment
objects for cleanup. It preserves the owner account, current session,
preferences, categories, payment methods, security/audit history, and backup
configuration/history. A queued or processing backup/restore job blocks purge
with `409 DATA_OPERATION_ACTIVE`.

## Backups and restore

| Method | Route                                        | Purpose                              |
| ------ | -------------------------------------------- | ------------------------------------ |
| GET    | `/api/backups/status`                        | Read safe worker/job/last-run status |
| GET    | `/api/backups/config`                        | Read the redacted backup config      |
| PATCH  | `/api/backups/config`                        | Save schedule and destination        |
| POST   | `/api/backups/test-destination`              | Test local or S3-compatible storage  |
| GET    | `/api/backups/history`                       | List jobs and verified artifacts     |
| POST   | `/api/backups/run`                           | Queue a manual backup                |
| POST   | `/api/backups/artifacts/:artifactId/preview` | Queue a restore preview              |
| GET    | `/api/backups/previews/:previewId`           | Poll preview verification            |
| POST   | `/api/backups/restore`                       | Queue a confirmed safe restore       |

All routes are owner-authenticated. Unsafe routes require CSRF and exact-origin
checks; job creation also requires a UUID `Idempotency-Key`. Responses never
return archive passwords, S3 credentials, database URLs, or physical local
paths. Restore additionally requires `currentPassword` and an unused,
unexpired, ready preview.
