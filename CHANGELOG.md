# Changelog

All notable changes to BizzieMoney are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - 2026-07-30

### Added

- Single-owner setup, login, profile, password, and active-session management.
- Responsive overview, expense, subscription, loan/debt, and settings screens.
- Expense CRUD, searching, filtering, sorting, monthly summaries, CSV export,
  and atomic CSV import with preview.
- Subscription schedules, lifecycle controls, reminders, payment history, and
  explicit expense conversion.
- Loans and debts in both directions with partial payments, lifecycle state,
  overdue maintenance, and currency-separated balances.
- Private attachments with authenticated previews, image thumbnails, local or
  S3-compatible storage, and optional ClamAV scanning.
- Regional currency, number, date, weekday, and IANA time-zone preferences.
- Manual and scheduled verified PostgreSQL backups, local or S3-compatible
  destinations, restore preview, safety backup, and retention controls.
- Portable owner-data export and password-confirmed financial-data purge.
- Docker Compose deployments, PostgreSQL migrations, background worker,
  health checks, and release automation.

### Security

- Argon2 password hashing, opaque server-side sessions, `HttpOnly` cookies,
  exact-origin validation, CSRF protection, login rate limiting, owner-scoped
  queries, encrypted saved storage credentials, and append-only audit events.

[Unreleased]: https://github.com/Sohail2949000/BizzieMoney/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Sohail2949000/BizzieMoney/releases/tag/v1.0.0
