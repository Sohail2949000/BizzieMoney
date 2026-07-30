# Regional preferences

Schema version 10 stores one regional-preference record per owner in
`app_settings`. Authenticated clients read and partially update it through:

- `GET /api/settings/preferences`
- `PATCH /api/settings/preferences`

The supported date formats are `MMM d, yyyy`, `dd/MM/yyyy`, `MM/dd/yyyy`, and
`yyyy-MM-dd`. Supported number formats are `1,234.56`, `1.234,56`, and
`1 234,56`. Currency codes are validated against the runtime's ISO 4217 data,
and time zones against its IANA time-zone data. An empty patch or unsupported
value is rejected. Successful changes append
`settings.preferences_updated` with changed field names only.

## Money behavior

Changing the default currency never converts, rewrites, or hides historical
money. New expenses, subscriptions, and debts use the saved default. Payments
retain their parent record's currency. Expense and debt summaries return
currency groups ordered with the default first and other codes alphabetically;
amounts from different currencies are never added together.

## Dates and schedules

PostgreSQL `date` values are calendar dates and are formatted without applying
a time-zone shift. Timestamps, “today,” and current-month boundaries use the
saved time zone. Subscription reminders and debt overdue maintenance compare
against the owner-local date.

Backup schedules are computed with Temporal in the saved IANA zone using
`disambiguation: "compatible"` across skipped and repeated local times. A time
zone change recomputes a future scheduled run; an already-due or queued job is
left intact.
