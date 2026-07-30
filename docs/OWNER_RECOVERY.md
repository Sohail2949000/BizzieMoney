# Owner password recovery

BizzieMoney has no browser password-reset bypass, recovery email, default
password, or second owner. An administrator with database and deployment
access can run the bundled offline recovery command.

Recovery changes only the owner password hash, revokes every session, and
appends an `auth.password_recovery` audit event. It does not read, export,
delete, or rewrite financial records.

## Before recovery

1. Take an infrastructure-level PostgreSQL snapshot and verify that attachment
   and backup storage remain available.
2. Work from the trusted deployment host, not through the public tunnel.
3. Stop the web, API, and worker so no application connection can mutate data:

   ```powershell
   docker compose --env-file .env -f docker/compose.prod.yml stop web api worker
   ```

The command refuses to continue while it can see a `bizziemoney-api` or
`bizziemoney-worker` PostgreSQL connection.

## Docker recovery

Run the production image as a one-off container. The prompt does not echo the
new password:

```powershell
$env:BIZZIEMONEY_RECOVERY_CONFIRM = "RESET_OWNER_PASSWORD"
docker compose --env-file .env -f docker/compose.prod.yml run --rm --no-deps `
  -e BIZZIEMONEY_RECOVERY_CONFIRM api `
  node dist/recover-owner.js
Remove-Item Env:BIZZIEMONEY_RECOVERY_CONFIRM
```

Use a unique password containing 12 to 128 characters. Enter it twice.

For a non-interactive secret-file workflow, provide exactly two matching lines
on standard input. Protect and securely remove that file according to the host
operating system's secret-handling policy.

## Restart and verify

```powershell
docker compose --env-file .env -f docker/compose.prod.yml up -d
docker compose --env-file .env -f docker/compose.prod.yml ps
```

Sign in with the owner email and new password. Check **Settings → Active
sessions**: only the new session should exist. Verify the latest backup and
inspect the `auth.password_recovery` audit event through the administrator's
normal database-audit process.

If recovery fails, leave the application stopped, retain the error and database
snapshot, and diagnose the database connection. Never edit `password_hash`
manually or place a plaintext password in SQL, shell history, Compose, source
control, logs, or a support message.
