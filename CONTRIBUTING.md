# Contributing to BizzieMoney

Thank you for helping improve BizzieMoney. Contributions should preserve its
privacy-first, single-owner architecture and make financial behavior explicit.

## Before opening an issue

- Search existing issues and release notes.
- Use the bug-report template for reproducible defects.
- Use the feature-request template for product proposals.
- Do not post credentials, database contents, receipts, backup archives,
  request logs containing private data, or security vulnerabilities.

Security concerns must follow [SECURITY.md](SECURITY.md).

## Development setup

Requirements are Node.js 24+, pnpm 11+, and PostgreSQL 18 for integration
tests.

```bash
corepack enable
corepack prepare pnpm@11.17.0 --activate
pnpm install --frozen-lockfile
cp .env.example .env
pnpm db:migrate
pnpm dev
```

Use only disposable development data. Never point tests or development tools
at a production database.

## Branches

Create a focused branch from an up-to-date `main` branch:

```bash
git switch main
git pull --ff-only
git switch -c fix/short-description
```

Common prefixes include `fix/`, `feat/`, `docs/`, `test/`, and `chore/`.

## Code style

- Follow the existing TypeScript, React, Fastify, and SQL patterns.
- Keep browser, API, worker, database, and storage responsibilities separated.
- Preserve exact owner scoping, CSRF/origin validation, idempotency, and
  transactional behavior.
- Treat money as decimal strings/numeric values, not floating point.
- Treat date-only values as calendar dates.
- Never edit an applied SQL migration; add a new numbered migration.
- Do not add public storage URLs, default passwords, public registration, or
  telemetry without an explicit security and product review.

Run formatting rather than manually reformatting unrelated files:

```bash
pnpm format:write
```

## Testing expectations

Before opening a pull request, run the checks relevant to the change:

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Run PostgreSQL integration tests with `TEST_DATABASE_URL` configured for an
isolated database. Interface changes should also run:

```bash
pnpm test:e2e
```

Database-query changes should run `pnpm performance:verify` against an isolated
PostgreSQL database. Docker or deployment changes should build all three
production targets and smoke-test `compose.yml`.

Add or update tests for changed behavior. Do not weaken validation or security
controls simply to satisfy a test.

## Commits

Use concise, imperative commits. Conventional Commit prefixes are encouraged:

```text
feat: add ...
fix: prevent ...
docs: clarify ...
test: cover ...
chore: update ...
```

Keep unrelated formatting, dependency, and product changes in separate
commits. Never commit `.env`, local databases, attachments, backups, generated
build output, or test artifacts.

## Pull requests

1. Describe the problem and the chosen solution.
2. Link related issues.
3. List tests and manual checks performed.
4. Call out migrations, breaking changes, configuration changes, data
   retention implications, and security considerations.
5. Include redacted screenshots for visible interface changes.
6. Update documentation and `.env.example` when configuration changes.
7. Confirm no secrets or private financial data are included.

Maintainers may request smaller commits, additional tests, a migration plan, or
a threat-model update before merging.
