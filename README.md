# PathToo PMO

A self-hosted PMO portal with a separate installation per customer, customer-managed users, and project access enforced by server-side APIs. Supports multiple portfolios, programs, projects, workstreams, tasks, RAID records, scoped dashboards, and CSV exports.

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
| Project manager | Create portfolios, programs and projects; edit their own portfolios/programs; read/write assigned projects and their plans. |
| Contributor | Read assigned projects; create/update their tasks and RAID records. |
| Viewer | Read-only access to assigned projects. |

Non-administrators receive no automatic project visibility. API requests independently enforce roles and project scope. There is no global vendor login. Each installation has independent account/session state and cookie names. See [customer deployment and migration](deploy/CUSTOMERS.md) for detailed permissions, isolated installations, recovery, and limitations.

## Visual theme

Executive Navy Blue uses sidebar `#0F172A`, primary typography `#1E3A5F`, buttons/links `#2563EB`, accent `#38BDF8`, and page background `#F8FAFC`. Navigation, forms, authentication, charts, schedules and financials share the palette. Green, amber and red remain distinct for completion, warnings and risks.

## Application workflows

- Create and edit portfolios and programs; assign projects to a portfolio and optionally a program.
- Portfolio Home shows a global overview of accessible projects, six summary boxes, and expandable portfolio/program/project lists. Portfolio/program selectors remain on project, work, report and directory pages; health/category filters remain available there.
- Per-project Schedule with automatic WBS numbering, nested subtasks, date/duration/progress fields, finish-to-start dependencies, milestones, summary rollups, automatic successor rescheduling, Gantt chart and schedule CSV exports.
- Projects, workstreams, task list/board, task completion, all six RAID types, financial summaries, filtered CSV exports.
- SQLite persistence with optimistic concurrency and authored audit events.
- Named users, salted scrypt password hashes, expiring HttpOnly sessions, CSRF protection and origin checks, single-use invitation/reset links, account/IP login throttles, immediate session invalidation on access changes, and last-admin protection.
- Responsive layout with keyboard focus, labeled forms and dialogs.

Task-count completion uses completed project tasks divided by all project tasks; no tasks displays a dash in the directory. Health evaluates critical issues, milestone slippage, cost exposure, overdue high-risk responses, and reporting age; missing required information is Unknown unless a known exception takes precedence. Currency totals are grouped in Reports and portfolio/program cards. Task owner text is descriptive and does not itself grant account access.

Existing projects remain **Unassigned** until edited to select a portfolio. Programs belong to one portfolio; a project can belong directly to a portfolio or to one of its programs. Move a program's projects out before changing its parent portfolio. Administrators manage all portfolios/programs; project managers create and edit their own. Other users see the ancestors of their assigned projects. Seeing a portfolio or program never grants access to its other projects. Fresh customer installations still start without portfolios, programs or sample data.

## Portfolio overview

Portfolio Home starts with a pinned, personalized Welcome section and has no portfolio or program filters. Its six summary boxes show Total Projects, Active Projects (status Active), Completed Projects (status Closed), Overall Health, Total Budget, and Projects Requiring Attention. Compact cards use one left-aligned row: Total Projects, Active Projects, Total Budget, Completed Projects, Overall Health and Projects Requiring Attention. On narrow screens the row scrolls horizontally. Project-count cards open the Projects directory with the matching All, Active, Closed or Requiring attention view, clearing earlier portfolio, program, search, health and category filters. The directory’s Project view selector and Reset filters button can change or clear that view. All figures use the signed-in user’s accessible projects regardless of scopes selected on other pages. Budgets and forecasts remain separated by currency. Intervention means an ongoing project is At risk, Needs attention, or has an overdue incomplete schedule milestone. Overall health uses the worst ongoing project health, treating missing data as Unknown unless a known exception takes precedence.

Each expandable portfolio row shows health trends, financial totals/variance, milestone delivery, capacity, risks and dependencies. Expand programs to see their projects; direct projects appear beneath the portfolio. Unassigned projects remain accessible in their own expandable group. Selecting a project opens its workspace. Opening a portfolio or program from its separate directory opens its scoped project directory.

Health history records the latest observed health per project per UTC day when an authorized user loads the workspace. The overview compares up to 14 observed days from the last 30 days for the currently accessible ongoing projects. Missing or insufficient history is labeled as collecting; older history is not invented. Snapshots persist in the customer database, with access enforced per project. Capacity counts open leaf tasks, descriptive task owners and unassigned work; staff availability and utilization are not recorded. Milestone delivery uses zero-duration leaf schedule tasks. Risks use unresolved RAID risks; dependencies show leaf-task predecessor links and unresolved RAID Dependency records. New customers still start empty.

## Financials Overview

Open **Financials Overview** from the sidebar. The fixed summary charts show approved budget, spent-to-date actuals and remaining budget across all accessible projects, including Unassigned projects. Each currency has its own horizontal stacked bar; currencies are never added together. The summary has a bottom border, and the table column headers stay visible while the rows scroll. Overspending shows a negative remaining balance and a budget-limit marker on the chart.

Expand a portfolio to see programs and direct projects; expand each program to see its projects. Every level uses Portfolio Name, Owner, Total Approved Budget, Actuals, Committed Costs, Estimate at Completion, Forecast Variance and Remaining Budget. Parent totals include each accessible project once, regardless of expansion. Clicking a project opens its workspace. Empty portfolios remain listed.

Project administrators and assigned project managers can enter **Actuals (spent to date)** and **Committed costs (outstanding)** through **Project → Financials → Edit financials** or Edit project. Enter cumulative amounts, not individual transactions; committed costs mean outstanding obligations and exclude amounts already recognized as actuals. Estimate at Completion uses the existing Forecast final cost field. Forecast Variance = Estimate at Completion − Total Approved Budget; a positive value is a projected overrun. Remaining Budget = Total Approved Budget − Actuals; it includes amounts reserved by outstanding commitments, which are shown separately.

Actuals and committed costs are optional and must be nonnegative when entered. Zero means a recorded zero; blank means unrecorded. Existing projects retain their data and have unrecorded costs until entered. Partial totals identify how many projects are unrecorded. Remaining Budget stays unknown if actuals are incomplete; the chart marks the unspent portion as unreconciled. Contributors and viewers can read financials only for their assigned projects and cannot edit project cost fields. No sample financial data is created for fresh customers. The Pi and n8n installers include the page automatically.

## Project schedules

Open a project and select **Schedule**. Use **Add task** or a row’s **＋ Subtask** action. Click a task description to edit or reparent it. Schedule and Work plan share the same task records. The table includes WBS ID, Task Description, Start Date, Finish Date, Duration, Percent Complete, and Depends On. Top-level tasks are bold; tasks at 100% completion appear grey with strikethrough. Schedule headers are uppercase, bold and navy blue. WBS is generated from creation order within each parent and stays stable when dates or progress change; adding, removing or reparenting tasks can renumber siblings.

Durations use whole **calendar days**, with both start and finish included; zero days creates a milestone. Changing start or duration calculates finish; changing finish in the editor calculates duration. A task can remain unscheduled. A linked task starts on the same date as its latest predecessor finishes, including milestones. While dependencies are present, they control Start Date instead of a manually entered date. Moving predecessors recalculates successor dates in either direction. Existing linked schedules are recalculated on upgrade restart, with new revisions and system audit entries only where values change. Multiple predecessors are supported. Links must stay within the project and cannot be circular. Link leaf tasks or milestones, rather than summary tasks.

Summary tasks derive dates from dated descendants and completion from all leaf descendants, weighted by duration (unscheduled tasks and milestones use weight one). Their dates, status and completion are read-only. Finish dates synchronize to task due dates, while existing unscheduled due dates remain available. Work-plan completion buttons and schedule percentages stay synchronized. Recalculated records receive new revisions and audit entries; stale edits return a refresh message.

Choose **Table & Gantt**, **Task table**, or **Gantt chart**, and use Days/Weeks/Months for the timeline scale. The project title, project tabs, schedule controls, column headers and timeline date headers stay fixed while task rows scroll. The task table and Gantt panes synchronize vertical scrolling in split view. Each pane scrolls horizontally to expose all columns or dates. Compact screens prioritize the title, tabs and schedule controls. Bars show completed portions, summary spans, milestone diamonds and predecessor arrows. Export schedule produces CSV. Assigned contributors can edit tasks and their schedules; viewers can read and export. Deleting a task requires confirmation and is blocked until its subtasks and successor links are removed or moved. The schedule supports up to 1500 tasks per project and 30 nesting levels.

This scheduling increment uses finish-to-start links and calendar days. Working-day/holiday calendars, other link types and lag, resource leveling, critical-path analysis, baselines, drag-to-reschedule, and Microsoft Project file import/export are not included. See [customer upgrades](deploy/CUSTOMERS.md) to install it on an existing Pi without resetting data.

## Validate

```sh
npm test
```

The tests launch isolated servers on free local ports and temporary databases. They check setup, legacy migration, persistence across restarts, invitations, sessions, CSRF, permissions, account disable/reset, last-admin protection, separate customer databases/cookies, hierarchy validation and visibility, project moves, schedule date calculations, dependency cycles and rollups, audit records, and throttling. They never use the running customer's data directory.

An optional browser workflow test is included in `tests/browser-smoke.cjs`. It starts its own temporary customer server/database and checks setup, portfolio/program/project creation, scope switching, project moves, schedule editing/rescheduling/Gantt/export, invitations, viewer controls, disabling, mobile overflow, logout and sign-in. Install Playwright separately in your development environment, then run `node tests/browser-smoke.cjs`. `PLAYWRIGHT_MODULE` may point to an external Playwright package; `CHROMIUM_PATH` may select an installed Chromium. No browser dependency is needed to run the portal or API suite.

## Raspberry Pi deployment and upgrades

Use [customer installation and migration instructions](deploy/CUSTOMERS.md). The installer supports the original `pathtoo` service and separately named customers, preserves data and settings, and backs up a stopped existing database before upgrade. Tailscale Serve keeps the endpoint private. Every user still needs access through the tailnet's own policy in addition to an app account.

## Scope

This release adds customer-owned accounts to the foundation portal. It does not implement a shared SaaS database, automated billing, SSO/MFA, verified email delivery, or a vendor-wide customer control plane. Charters, approval gates, baselines, change control, advanced scheduling, immutable report snapshots, imports, and controlled closure remain later increments. Audit events are retained in the local database; they are not an external tamper-proof audit system.

Validate systemd startup, Tailscale access policies, reboot persistence, recovery, accessibility and expected workload on target infrastructure before production rollout. Pre-upgrade backups are created, but an off-device backup schedule and demonstrated restore are still operational requirements. External font loading is optional; local font fallbacks are provided.

## Automated customer provisioning with n8n Cloud

Use [the automation setup guide](deploy/AUTOMATION.md) to install an outbound Pi worker and import the workflows in `n8n/`. A private agent collects only customer name and the first administrator's name/email. The Pi allocates folders/services/ports, starts an empty customer database, creates a single-use administrator activation link, verifies private HTTPS, and returns the links through n8n. No public Pi webhook, public SSH, or administrator password in the agent is required. See [agent instructions](n8n/AGENT-INSTRUCTIONS.md).
