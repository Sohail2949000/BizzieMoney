# Attachment storage

Attachment bytes never live in PostgreSQL. PostgreSQL stores authorization and
integrity metadata while a storage adapter holds the private object.

## Local host-folder storage

Local storage is the default. In Docker:

- the container path is `/data/attachments`;
- production binds `ATTACHMENT_HOST_PATH` to that path;
- development binds `.data/attachments`.

The directory is important application data. Keep it on durable host storage,
include it in infrastructure backups when attachment-inclusive BizzieMoney
backups are not enabled, and never replace it with an anonymous volume.

The API creates stable generated object keys. User-provided filenames are
sanitized for display only and never become filesystem paths.

## S3-compatible storage

AWS S3, Cloudflare R2, MinIO, and compatible providers use the same private
adapter. Open **Settings → File storage**, choose **S3 / Cloudflare R2**, and
enter the bucket, region, endpoint when required, object prefix, and optional
credential pair. Test the connection before saving; saving also repeats the
test before activating the destination.

The environment remains a deployment-default interface:

```dotenv
ATTACHMENT_STORAGE_PROVIDER=s3
ATTACHMENT_S3_BUCKET=
ATTACHMENT_S3_REGION=auto
ATTACHMENT_S3_ENDPOINT=
ATTACHMENT_S3_PREFIX=bizziemoney
ATTACHMENT_S3_FORCE_PATH_STYLE=false
ATTACHMENT_S3_ACCESS_KEY_ID=
ATTACHMENT_S3_SECRET_ACCESS_KEY=
```

Cloudflare R2 normally uses the account endpoint, region `auto`, and path-style
access disabled. Grant only the object permissions needed for the configured
bucket and prefix.

Credentials saved through Settings are sealed with AES-256-GCM under
`BACKUP_SECRETS_KEY`, falling back to `SESSION_SECRET`. The API returns only a
`hasCredentials` flag; credential values are never returned, logged, included
in audit metadata, or bundled into the frontend.

Changing the active provider affects new uploads only. Each attachment records
its provider and root. BizzieMoney retains an encrypted S3 profile for every
previously selected bucket/prefix so reads, exports, restores, and cleanup jobs
can continue using the original location. It does not move attachment objects
between providers automatically.

For Cloudflare R2:

- use `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` as the endpoint;
- keep region as `auto`;
- keep path-style requests off;
- create a private bucket and a token limited to object access for that bucket;
- use a dedicated prefix such as `bizziemoney`.

## Upload safety

The initial allowlist is PDF, PNG, JPEG, WebP, plain text, and CSV. Every upload
has:

- a configurable bounded size;
- extension and detected MIME checks;
- executable-format rejection;
- a SHA-256 checksum;
- a generated object key;
- owner and entity authorization;
- idempotent finalization;
- optional fail-closed ClamAV scanning through the `clamd` streaming protocol.

Preview and download use authenticated API endpoints. Permanent public URLs
are not stored.

PNG, JPEG, and WebP uploads also receive a 160-by-160 WebP thumbnail. Image
decoding is pixel-bounded, orientation is normalized, and the browser loads
the small derived object instead of the full-resolution original. Thumbnails
are caches: they are regenerated from the authorized original after restoring
an older backup or when the derived object is missing.

Deletion first updates PostgreSQL transactionally and then queues retryable
cleanup for the original and any derived thumbnail. A temporary storage
failure cannot silently resurrect an attachment or expose it to another owner.

## Connection and usage status

Settings shows the active provider, configuration source, allowed types, file
count, total bytes, upload limit, and malware-scanner state. **Test
connection** performs a server-side adapter check without returning
credentials or local paths.

Backup storage is configured separately. See [BACKUPS.md](BACKUPS.md).

## Malware scanning

Scanning is disabled by default for local-only development. To enable the
official ClamAV service in Compose, set:

```dotenv
ATTACHMENT_MALWARE_SCANNER=clamav
CLAMAV_HOST=clamav
CLAMAV_PORT=3310
CLAMAV_TIMEOUT_MS=30000
```

Then include the optional profile:

```powershell
docker compose --env-file .env -f docker/compose.prod.yml --profile malware-scan up -d
```

Uploads are streamed to `clamd` before any object is written to local or S3/R2
storage. A detected signature returns `ATTACHMENT_MALWARE_BLOCKED`. A timeout,
connection failure, or invalid scanner response fails closed with
`ATTACHMENT_SCANNER_UNAVAILABLE`; the unscanned file is not stored.

The image tag is pinned to the maintained ClamAV 1.4 patch line. Its signature
database lives in the `bizziemoney_clamav_data` volume and must be allowed to
update. Monitor scanner/container health and signature freshness as part of
deployment operations.
