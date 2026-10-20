# PathToo PMO

A self-hosted PMO portal with a separate installation per customer, customer-managed users, and project access enforced by server-side APIs. Supports projects, workstreams, tasks, RAID records, portfolio dashboards, and CSV exports.

## Local development

Requires Node.js 22.13+; tested with Node 24. No external runtime dependencies.

```sh
npm start
```

The server binds to `127.0.0.1:3000`; `PORT` and `DATA_DIR` can select an unused port and separate data directory. For a fresh development database, a private first-admin setup code is generated in `.data/setup-token` unless `PMO_ACCESS_TOKEN` is configured. Read that file locally and complete the browser setup form. Never commit it or share it in chat. Existing customer projects are preserved. New installations start empty. Optional `SEED_DEMO=true` seeds fictional projects only into a genuinely new, uninitialized database.

Do not copy an initialized database as a customer template. Reuse code; provision unique settings, first-admin setup code, and an empty database for every new customer. Customer identity and account state live in that database. If serving through a reverse proxy, configure the exact HTTPS `PUBLIC_ORIGIN` (no trailing slash or path). There is no shared-token login after first-admin setup.

## Customer administration

The first administrator names the organization and creates their email/password account. They can then add users, assign roles/projects, disable accounts, regenerate invitation links, issue reset links, rename the workspace, and inspect audit history. Links are manually shared; no email is sent. Users choose their own passwords and can sign out or change them from My account.

| Role | Permissions |
| --- | --- |
| Administrator | All customer projects, user administration, settings and audit history. |
| Project manager | Create projects; read/write assigned projects and their plans. |
| Contributor | Read assigned projects; create/update their tasks and RAID records. |
| Viewer | Read-only access to assigned projects. |

Non-administrators receive no automatic project visibility. API requests independently enforce roles and project scope. There is no global vendor login. Each installation has independent account/session state and cookie names. See [customer deployment and migration](deploy/CUSTOMERS.md) for detailed permissions, isolated installations, recovery, and limitations.

## Application workflows

- Portfolio dashboards, project search and health/category filters.
- Projects, workstreams, task list/board, task completion, all six RAID types, financial summaries, filtered CSV exports.
- SQLite persistence with optimistic concurrency and authored audit events.
- Named users, salted scrypt password hashes, expiring HttpOnly sessions, CSRF protection and origin checks, single-use invitation/reset links, account/IP login throttles, immediate session invalidation on access changes, and last-admin protection.
- Responsive layout with keyboard focus, labeled forms and dialogs.

Task-count completion uses completed project tasks divided by all project tasks; no tasks displays a dash in the directory. Health evaluates critical issues, milestone slippage, cost exposure, overdue high-risk responses, and reporting age; missing required information is Unknown unless a known exception takes precedence. Currency totals are grouped in Reports; the home budget card totals USD only. Task owner text is descriptive and does not itself grant account access.

## Validate

```sh
npm test
```

The tests launch isolated servers on free local ports and temporary databases. They check setup, legacy migration, persistence across restarts, invitations, sessions, CSRF, permissions, account disable/reset, last-admin protection, separate customer databases/cookies, audit records, and throttling. They never use the running customer's data directory.

An optional browser workflow test is included in `tests/browser-smoke.cjs`. It starts its own temporary customer server/database and checks setup, invitations, viewer controls, disabling, mobile overflow, logout and sign-in. Install Playwright separately in your development environment, then run `node tests/browser-smoke.cjs`. `PLAYWRIGHT_MODULE` may point to an external Playwright package; `CHROMIUM_PATH` may select an installed Chromium. No browser dependency is needed to run the portal or API suite.

## Raspberry Pi deployment and upgrades

Use [customer installation and migration instructions](deploy/CUSTOMERS.md). The installer supports the original `pathtoo` service and separately named customers, preserves data and settings, and backs up a stopped existing database before upgrade. Tailscale Serve keeps the endpoint private. Every user still needs access through the tailnet's own policy in addition to an app account.

## Scope

This release adds customer-owned accounts to the foundation portal. It does not implement a shared SaaS database, automated billing/provisioning, SSO/MFA, verified email delivery, or a vendor-wide customer control plane. Charters, approval gates, baselines, change control, dependency scheduling, immutable report snapshots, imports, and controlled closure remain later increments. Audit events are retained in the local database; they are not an external tamper-proof audit system.

Validate systemd startup, Tailscale access policies, reboot persistence, recovery, accessibility and expected workload on target infrastructure before production rollout. Pre-upgrade backups are created, but an off-device backup schedule and demonstrated restore are still operational requirements. External font loading is optional; local font fallbacks are provided.
