# Testing

## Test layers

- Unit tests cover password policy, authentication, expense CSV parsing,
  subscription, debt, and backup service behavior, calendar-safe schedules,
  session checks, cursor validation, idempotency, attachment validation and
  storage, cleanup retries, reminder maintenance, and safe error semantics.
- API tests exercise health, readiness, setup-state, and request protections.
- The PostgreSQL integration test covers setup, login, persistence, session
  revocation, logout, and password change against the real schema.
- The expense integration test covers defaults, create replay, conflicting
  idempotency keys, read/update/search/export/delete, atomic mixed-currency CSV
  preview/import/replay/rollback, attachment
  upload/list/stream/filter/delete, cleanup queuing, and owner isolation.
- Backup tests cover schedule calculation, secret sealing, blank-key fallback,
  verified-before-retention ordering, upload-verification failure, safety
  backup creation, restore rollback, and current-password gating.
- The subscription integration test covers CRUD, search, owner isolation,
  attachments, upcoming renewals, idempotent payment recording, atomic
  conversion, payment history, lifecycle controls, reminders, and deletion.
- The debt integration test covers creation/search/isolation, partial and full
  payments, idempotent replay, overpayment protection and confirmation,
  payment correction, completion/reopening, summaries, record/payment
  attachments, and cleanup.
- React component tests cover setup, login, authenticated shell, live overview,
  expense, subscription, and money-owed empty states, settings, and theme
  behavior, plus regional format helpers, preference editing, and CSV import
  preview/commit states.
- Playwright checks first-run setup, returning-owner login, application shell,
  appearance controls, expense create/edit/search/delete, and attachment
  upload management and CSV import validation/commit in Chromium
  desktop/mobile and WebKit, plus Firefox on compatible hosts. Debt coverage
  creates and edits records in both directions, exercises pause/resume, records
  a partial payment, verifies remaining balances, searches, and deletes.
  Settings coverage edits regional preferences, verifies persistence, and
  exercises guarded category reassignment and deletion.
- Hardening browser coverage checks recoverable API errors, retry, native modal
  centering and focus containment, Escape dismissal, 44-pixel touch controls,
  and no horizontal overflow at 320 pixels.
- The isolated performance runner verifies target-scale query plans and index
  selection without writing fixtures to the owner schema.

## Required phase gate

```powershell
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
pnpm performance:verify
```

Set `TEST_DATABASE_URL` to include the integration test in the normal Vitest
run. Without it, the integration file is reported as skipped rather than
silently using a developer database.

The database-backed preference integration coverage verifies migration
defaults, partial updates, changed-field audit metadata, future backup
rescheduling, and mixed USD/EUR records whose totals remain separate.

Browser tests mock their API boundary and use isolated fixtures. They must not
depend on or mutate the owner or financial data in a developer installation.

Firefox is excluded from the default Windows matrix because Mozilla's headless
software compositor can hang before the first page opens on affected Windows
hosts. Set `PLAYWRIGHT_FIREFOX=true` only on a Windows runner that has verified
headless Firefox support. Firefox remains enabled by default on other hosts.

The Phase 7 acceptance gate also exercises the real Docker stack in a browser:
local destination testing, schedule saving, manual backup, live progress,
verified history, restore preview, worker status, desktop/mobile layout, and
console-error inspection. It additionally builds the production image targets,
checks container health and security headers, and runs the target-scale
PostgreSQL benchmark. Actual restore is tested with isolated fixtures and must
not mutate a developer's live database during browser QA.
