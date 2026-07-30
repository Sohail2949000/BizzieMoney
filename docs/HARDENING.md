# Phase 7 hardening

Phase 7 turns the existing feature tests into repeatable operational gates.
Hardening work does not reset the owner database or alter stored attachment
keys.

## Performance and PostgreSQL

- A target-scale fixture runner creates a random `bm_perf_*` schema, applies
  every migration, inserts up to 1,000,000 expenses, 100,000 subscriptions,
  100,000 debts, and payment history, runs `EXPLAIN (ANALYZE, BUFFERS)`, then
  drops the schema in `finally`.
- The runner refuses to execute without `PERFORMANCE_DATABASE_URL` or
  `TEST_DATABASE_URL`.
- Query-plan gates verify the indexes used by recent expenses, expense search,
  upcoming subscriptions, subscription amount/update sorts, and debt due-date
  pages.
- Migration `0009_hardening.sql` adds the indexes found missing during review.

Run it with:

```powershell
$env:PERFORMANCE_DATABASE_URL='postgresql://...'
pnpm performance:verify
```

Optional fixture-count environment variables exist for fast local iterations,
but the acceptance run uses the target defaults.

### Acceptance result — July 28, 2026

The target run loaded 1,000,000 expenses, 100,000 subscriptions, 100,000
debts, and bounded payment history. The verified plans were:

| Scenario                   | Execution | Required index                           |
| -------------------------- | --------: | ---------------------------------------- |
| Recent expense page        |  0.498 ms | `expenses_owner_date_id_active_idx`      |
| Expense full-text search   | 16.425 ms | `expenses_search_idx`                    |
| Upcoming subscription page |  0.576 ms | `subscriptions_owner_next_active_idx`    |
| Subscription amount sort   |  0.269 ms | `subscriptions_owner_amount_active_idx`  |
| Subscription update sort   |  0.578 ms | `subscriptions_owner_updated_active_idx` |
| Money owed due-date page   |  0.054 ms | `debts_owner_direction_due_active_idx`   |

All were below the 1,500 ms safety ceiling. The generated schema was removed
after the run, and the owner schema remained untouched.

## Security and failure boundaries

- Production API responses use a restrictive Content Security Policy.
- The Nginx gateway adds CSP, framing, MIME-sniffing, permissions, and referrer
  protections.
- Exact-origin, CSRF, opaque session, password, upload, archive path, and owner
  authorization protections remain covered by automated tests.
- Unexpected API errors return a request ID and a generic message without a
  stack trace or database details.
- Archive traversal is rejected before extraction.
- PostgreSQL restore uses `ON_ERROR_STOP` and one transaction.
- Restore failure preserves the verified safety artifact and attempts
  automatic rollback.

## Accessibility and mobile

- Restore preview now uses a centered native modal dialog, including focus
  containment and Escape handling.
- All mobile buttons have a minimum 44-pixel touch height.
- Browser regressions check restore-dialog centering, horizontal overflow at
  320 pixels, recoverable error state, retry behavior, modal focus, and
  keyboard dismissal.
- Existing dialogs use native modal focus handling, labelled headings, alert
  or status semantics, and visible focus indicators.

## Production images

`docker/Dockerfile` provides separate multi-stage `web`, `api`, and `worker`
targets. `docker/compose.prod.yml` validates the non-root, read-only,
host-mounted deployment path with external PostgreSQL.

See [DEPLOYMENT.md](DEPLOYMENT.md) and [STORAGE.md](STORAGE.md).

## Remaining environment-specific checks

- Test a real S3/R2 bucket before switching production storage.
- Validate the chosen TLS reverse proxy and certificate renewal.
- Repeat responsive visual QA in Safari and Firefox when those browsers are
  part of the deployment’s support policy.
