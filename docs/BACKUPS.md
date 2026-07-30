# Backups

BizzieMoney can create a backup immediately or on a daily, weekly, or monthly
schedule. Open **Settings > Automatic backups** to choose the destination,
retention count, attachment-file policy, and optional archive password.

## What an artifact contains

- A PostgreSQL data-only logical dump of BizzieMoney business tables.
- Application settings and financial records.
- Attachment metadata and a manifest in every backup.
- Attachment file bytes when **Include attachment files** is enabled.
- Application version, schema version, creation time, table counts, and
  SHA-256 checksums.

Owner credentials, active sessions, rate-limit state, audit history, and backup
queue records are installation state and are not replaced by a financial-data
restore.

## Destinations

Local backups are stored below `BACKUP_LOCAL_PATH` in the configured safe
subfolder. Docker Compose maps the default `/data/backups` root to the host's
`.data/backups`; recreating containers does not delete it.

S3 mode supports private AWS S3, Cloudflare R2, MinIO, and compatible
endpoints. Enter bucket, region, optional endpoint, prefix, path-style choice,
and credentials in Settings. Use **Test destination** before saving.

## Verification and retention

The worker stages the archive, uploads it, reads it back, and verifies its
SHA-256 before marking it successful. Retention runs only after that verified
artifact is recorded. A failed backup never deletes an older valid artifact.

Retention counts normal verified backups per owner. Safety backups created for
restore are preserved outside normal retention so they remain available for
recovery.

## Operations

Keep the API, worker, PostgreSQL, and configured storage available. Settings
shows worker heartbeat, active progress, next scheduled run, job failures, and
verified artifact history. Monitor host storage capacity and separately copy
critical backups off the application host.
