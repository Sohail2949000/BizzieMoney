# Security Policy

BizzieMoney stores authentication material, financial records, and private
attachments. Please report suspected vulnerabilities privately and do not
include sensitive data in public issues.

## Supported versions

| Version                      | Supported |
| ---------------------------- | --------- |
| 1.0.x                        | Yes       |
| Earlier development versions | No        |

Security fixes are provided for the current release line. Operators should
keep PostgreSQL, Docker, the host operating system, reverse proxy, and optional
ClamAV service patched independently.

## Reporting a vulnerability

Send a private report to **info@national-inks.net** with:

- A concise description and affected component.
- Reproduction steps or a proof of concept using disposable data.
- The expected and observed security boundary.
- Potential impact.
- Any suggested mitigation.

If GitHub private vulnerability reporting is enabled, it may also be used at:

`https://github.com/Sohail2949000/BizzieMoney/security/advisories/new`

Do **not** publish a vulnerability, suspected credential exposure, or private
financial data as a GitHub issue, discussion, or pull request.

Reports will be acknowledged when they are received. Remediation and
disclosure timing depend on severity, reproducibility, and release impact. Do
not access data that is not yours, degrade a service, or perform destructive
testing.

## Deployment responsibility

Self-hosting operators are responsible for:

- Using HTTPS and an exact trusted origin.
- Protecting the public hostname with an appropriate access layer.
- Generating strong unique database, session, and storage secrets.
- Keeping `.env`, PostgreSQL, attachments, and backup artifacts private.
- Enabling malware scanning when the threat model requires uploaded-file
  scanning.
- Testing backups and restore procedures.
- Restricting database and API network exposure.

See [docs/SECURITY.md](docs/SECURITY.md) and
[docs/HARDENING.md](docs/HARDENING.md) for implementation details.
