# PathToo PMO

A private PMO portal implementing the foundation increment from the product specification: portfolio visibility, projects, workstreams, tasks, and RAID records. Includes fictional Northstar Health projects.

## Run

Requires Node.js 22.13+ (tested on Node 24.19). No external runtime dependencies.

```sh
npm start
```

The server listens on loopback port 3000 by default. `PORT` changes the port. SQLite data lives in `.data/pmo.sqlite`; `DATA_DIR` can select another directory. Data survives server restarts. The application does not require a cloud service or API key.

For external hosting set `HOST` to the appropriate interface and configure `PMO_ACCESS_TOKEN` with a private random token of at least 16 characters. Supply the token through your hosting platform's secret settings, never source control. The browser prompts for it and retains it only in session storage. Use an HTTPS reverse proxy. This is single-owner token access; multi-user identity and project roles are not implemented. Loopback mode trusts access to the machine and must not be exposed through an unauthenticated proxy.

## Features

- Portfolio health, budget and forecast summaries, project directory, search and health/category filters.
- Create/edit projects, workstreams, tasks and all six RAID types; task list and board views.
- Project overview, work plan, workstreams, RAID and financial summary.
- SQLite persistence, project-reference validation, revision conflicts, server-side input validation and private access option.
- CSV portfolio export using current project filters.
- Demo removal preserves user records; demo parents referenced by user records are retained and converted to user records.
- Responsive layout, labeled controls, keyboard focus, accessible dialogs, and status text alongside colors.

Task-count completion uses completed tasks divided by all project tasks. Projects without tasks show a dash. Health prioritizes critical issues, milestone slippage, cost exposure, and reporting age; missing budget or published status produces Unknown unless an exception is known. Costs are grouped by currency in Reports. The home budget card summarizes USD only. Demo report dates are fictional; publishing new status snapshots is not in this increment.

## Validate

```sh
npm test
```

API integration tests use a temporary database and separate server to check access, persistence across restarts, health, invalid input, stale-write conflicts, and safe demo removal.

## Scope and deployment

Approvals and Templates describe the next increments rather than simulating approved governance. Charters, baselines, change control, process coverage, dependency scheduling, reports as fixed snapshots, imports, closure, audit history, shared user identity/roles, and integrations are not implemented. This is a foundation pilot, not the complete 49-process product or a production-certified system. Demonstrate backup restoration and complete security/accessibility/performance verification before production rollout. External font loading is optional; the UI has local font fallbacks.

Before backups, stop the server and preserve the entire data directory, including SQLite sidecar files. No credentials should be stored in project records.

## Raspberry Pi / Tailscale hosting

See [private Raspberry Pi deployment](deploy/RASPBERRY-PI.md) for the 64-bit Pi installer, systemd startup, persistent data paths, and Tailscale Serve access. This is separate from publishing a cloud environment snapshot.
