# Restore

Restore is intentionally a two-step, owner-confirmed operation.

1. In **Settings > Automatic backups**, choose **Preview restore** on a
   verified artifact.
2. Wait while the worker downloads, checksum-verifies, safely extracts, and
   reads the manifest.
3. Review creation time, versions, table counts, attachment policy, and any
   compatibility warnings.
4. Enter the current owner password and explicitly confirm restore.

The preview expires and can be used only once. A backup from a schema newer
than the running application cannot be restored.

## Safety behavior

Before applying the selected artifact, the worker creates and verifies a full
safety backup including attachment files. It then restores the selected
business tables with `psql --single-transaction`. If database or attachment
application fails, the worker attempts to reapply the safety backup and keeps
that artifact for manual recovery.

Never stop PostgreSQL or the worker while restore is processing. Do not change
the configured storage destination or secret-sealing key between preview and
restore.

## Manual recovery

If the UI reports `RESTORE_RECOVERY_FAILED`, stop normal writes, preserve
`.data/backups` or the S3 bucket, and inspect the worker's administrator logs.
Do not delete the safety artifact. Restore it in an isolated PostgreSQL
instance first, verify its manifest and attachment paths, then use the same
`psql --single-transaction` procedure under operator supervision.
