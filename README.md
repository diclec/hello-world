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
- Portfolio Home shows a global overview of accessible projects, four pie-chart summaries, and an expandable portfolio/program/project table. Portfolios, Programs and Projects use the same table-only directory format with pinned headers; first columns are Portfolio Name, Program Name and Project Name respectively.
- Per-project Schedule with automatic WBS numbering, nested subtasks, date/duration/progress fields, finish-to-start dependencies, milestones, summary rollups, automatic successor rescheduling, Gantt chart and schedule CSV exports.
- Projects, workstreams, task list/board, task completion, all six RAID types, financial summaries, filtered CSV exports.
- SQLite persistence with optimistic concurrency and authored audit events.
- Named users, salted scrypt password hashes, expiring HttpOnly sessions, CSRF protection and origin checks, single-use invitation/reset links, account/IP login throttles, immediate session invalidation on access changes, and last-admin protection.
- Responsive layout with keyboard focus, labeled forms and dialogs.

Task-count completion uses completed project tasks divided by all project tasks; no tasks displays a dash in task-progress views. Health evaluates critical issues, milestone slippage, cost exposure, overdue high-risk responses, and reporting age; missing required information is Unknown unless a known exception takes precedence. Currency totals are grouped in Reports and portfolio/program/project tables. Task account assignments do not grant project access. Legacy Owner text is matched only to a unique active project member name or email for My Work; ambiguous names are not guessed.

Existing projects remain **Unassigned** until edited to select a portfolio. Programs belong to one portfolio; a project can belong directly to a portfolio or to one of its programs. Move a program's projects out before changing its parent portfolio. Administrators manage all portfolios/programs; project managers create and edit their own. Other users see the ancestors of their assigned projects. Seeing a portfolio or program never grants access to its other projects. Fresh customer installations still start without portfolios, programs or sample data.

## Portfolio overview

Portfolio Home has a fixed Welcome section and exactly four pie-chart summary boxes above a divider. The project chart partitions all accessible projects into Active (status Active), Closed (status Closed), and Other so the slices add to Total Projects. Total, Active and Closed counts still open the matching Projects directory view and clear earlier portfolio/program/search/health/category filters. Opening Projects from the sidebar resets any previous scope or status filter. Portfolios and Programs have no filter controls or creation sections; Projects includes a Portfolio Name filter; new records can be created from Portfolio Home.

The Total Budget chart shows approved budget in its center and partitions it into outstanding committed costs and remaining budget. Use the Budget currency selector when multiple currencies are present; currencies are not added together. On this page, **Remaining Budget = approved budget − outstanding committed costs**, reflecting the requested commitment allocation view. Actual spending is shown separately on Financials Overview, where remaining budget means approved budget minus actuals. Zero is a recorded value; missing commitments remain unrecorded, with an unreconciled segment and unknown remaining balance. Overcommitments show a negative remaining balance without drawing a negative slice.

Below the fixed divider, an expandable table uses Portfolio Name, Owner, Target Completion Date, Total Approved Budget, Committed Budget, Remaining Budget and Portfolio Health. Projects use their Target date; program and portfolio rows use the latest accessible project target date. Missing targets display Not set, and partial rollups flag unrecorded targets. All headers except Portfolio Name are centered and stay pinned while rows scroll. Expand portfolios for programs and direct projects, then expand programs for their projects. Unassigned projects have their own expandable group. Parent totals include each accessible project once. Risk and issue count columns are omitted from Portfolio Home. Health uses the worst ongoing project health, retaining Unknown where required data is missing. Empty portfolios remain listed; new customers start empty.

Observed project health history remains stored in the customer database and restricted by project access. The table displays current health.

The Projects directory starts with **Portfolio Name**, **Project Name**, and **Project Health**, followed by Owner, Target Completion Date and budget columns. Portfolio Health and the risk/issue count columns are omitted. Its **Portfolio Name** filter supports individual portfolios, Unassigned and All portfolios. The filter combines with project-status shortcuts from Portfolio Home; opening Projects from the sidebar resets it. Other directory and Portfolio Home columns remain unchanged.

Portfolio names in the Home, Portfolios, Projects and Financials Overview tables include a stoplight beneath the name. It uses the existing portfolio health rollup: red for At risk, amber for Needs attention, green for On track, and neutral for Unknown or No active delivery. The text label and accessible description accompany the colour. Only accessible projects contribute to the rollup.

## Project register actions

The Projects list has only its portfolio filter, with no register-creation buttons. Open a project to use **+RAID Item** in **RAID & Decisions**, **+Change Order** in **Financials**, or **+Latest Status** in **Status**. Forms default to the current project. The change-order record list, editing controls and creation button are in Financials. Existing change-order page links redirect there. The newest status entry (by its report date) appears in a collapsed **Latest status** disclosure beneath that project’s name in the Projects table; click to expand or collapse it without opening the project. Every row starts collapsed, and the status-age icon stays visible; earlier entries remain in the project’s **Status** page. The status form requires a report date and update text, with no Title field. Status is a two-column table of every report for that project (**Date**, then **Status**), sorted by report date newest first; click a date to edit a report when your role permits it; entries on the same date use submission time as the tie-breaker. Existing reports without a report date use their original submission date. Editing an earlier entry does not make it the newest unless its report date is changed. Status-age icons appear to the right of project names in the Projects list and beside the Status page title: green check through 7 days, yellow exclamation over 7 but under 14 days, red X at 14 days and beyond, and a neutral dash when no report exists. Age uses the newest report date in calendar days and refreshes every minute while the page is open.

Change orders capture a title, requested change/reason, review status (Draft, Submitted, Approved or Rejected), budget impact in the project currency, and schedule impact in whole days. Negative impacts represent savings or fewer days. The project’s **Financials** page retains these records. Approval is a recorded review state; it does not automatically alter the approved budget or task schedule. RAID uses the existing RAID register. Viewers can read records but cannot submit or edit them; project membership and closed-project restrictions are enforced by the server. Fresh customers still start with no records.

Portfolio Home places **Projects per Portfolio** between Projects and Total Budget. Each portfolio has a coloured segment and count, with Unassigned projects included separately. **Budget by Portfolio** follows Total Budget and splits approved project budgets by portfolio in the selected currency. Both budget charts share the currency selection. Use **Portfolio charts** to collapse or expand all four charts, giving the table more room. Counts use all projects accessible to the signed-in account, and the legend scrolls for longer portfolio lists.

## Individual project pages

Opening any project goes directly to **Status**, the first item in the project toolbar. The separate overview/landing page is removed. Old project-root and overview links redirect to Status. Latest status remains beneath project names in the Projects list, and full history remains in Status.

Status, Schedule, RAID & Decisions, Transparencies, Escalations, Workstreams, Financials and Resources each have a separate page address under `#/projects/<project-id>/<section>`, opening in the same browser tab. Links support refresh, bookmarks and browser Back/Forward; each section includes **Back to projects**. The default project page is `#/projects/<project-id>/status-updates`. Every section keeps the section toolbar visible at the top for direct navigation. The larger project header is collapsed into **Project details**, with **← Back to projects** available to return to the list. Section pages preserve project context and existing permissions; schedule scrolling still keeps the project heading, section navigation and schedule column headers fixed. Links resolve only against projects accessible to the signed-in account.

## User workstream field

Add customer user and Edit user access include an optional **Workstream** selector. Non-administrators can choose workstreams only from their assigned projects; administrators can choose any project’s workstream. Options include project names to distinguish identically named streams. The assignment is saved with the user and is available after invitation acceptance and restart. It does not grant project access or restrict existing role permissions. Removing project access clears an existing assignment when it is no longer eligible. Existing users default to no workstream; the additional mapping table is created automatically on upgrade.

## Resources, Transparencies and Escalations

The project toolbar places Transparencies and Escalations immediately after RAID & Decisions and replaces the former Change Orders link with Resources. All three sections have project-scoped tables and create/edit forms, preserving the compact project header and visible toolbar.

The resource form and list use Project Name, Workstream Name, Resource Name, Roles and Responsibilities, Assignment Start Date and Assignment End Date, in that order. The workstream selector follows the chosen project, and the server rejects cross-project links and end dates before start dates. Owner and Status are omitted from the form; existing metadata is retained. Existing assignment end dates remain available. Transparencies and Escalations contain a title, details, owner and optional due date; transparency statuses are Open/In progress/Closed and escalation statuses are Open/In progress/Resolved. Resource records are a roster and do not create login accounts or change access. The server enforces project membership, viewer restrictions, revisions and closed-project protection; fresh customer registers remain empty.

## Workstreams and linked registers

The Workstreams page shows the project’s workstream count beside **Project workstreams**. Create or edit a stream using **Workstream Name**. A single table groups linked Milestones, Risks, Issues, Dependencies, Actions, Change Requests and Financials under each workstream. Columns are Register, Record, Status / Type, Date, Owner and Amount. Workstreams with no linked records remain visible. Milestones include tasks marked Major milestone and zero-day leaf tasks; change requests use the existing Change Orders register.

Select an optional **Workstream** when adding or editing a schedule task, RAID item, change order or financial record. Each record links to one workstream in its own project; the server rejects cross-project links. Click a listed record to open its existing editor. Only records matching both the project and workstream are shown. Existing role and project-access restrictions apply, including read-only viewers.

The project Financials page now includes **Financial records** with a **+Financial Record** form. Record a title, type (Budget, Actual, Committed or Forecast), date, nonnegative amount in the project currency, optional notes and workstream. These individual records are stored separately from cumulative project totals; they do not automatically alter approved budget, actuals, commitments or forecast in Edit financials. Existing totals and customer records are preserved, and fresh customers remain empty. Financial records are available through `/api/financialEntries` with the same project access, revision and audit checks as other registers.

## My Work

My Work uses the same table-only layout and fixed column headers as the Projects directory. It shows only tasks assigned to the signed-in account, grouped into expandable **Portfolio → Program → Project → Task** rows. Direct portfolio projects skip the program level; unassigned projects have their own group. Empty portfolios/programs/projects and other users’ task rows are omitted. Completed tasks remain visible with grey strikethrough; the sidebar badge counts only your unfinished assignments.

Task columns are Task Name, Owner, Target Completion Date, Status, Percent Complete, Start Date, Finish Date, Duration and Depends On. A task’s target completion is its scheduled finish or unscheduled due date. Group dates and average completion use only your assigned tasks; group status prioritizes blocked/in-progress work. No project budgets are attributed to individual tasks. Clicking an editable task opens its existing task editor; viewer roles remain read-only.

The task editor’s **Assign to user** selector lists only active accounts that already have project access. Assignments use stable user IDs and update Owner text. Selecting no linked account allows free-text ownership; clear Owner to leave a task unassigned. Legacy tasks without an account ID match a unique active project member’s name or email, ignoring case and outer whitespace. Duplicate names are omitted until explicitly assigned, rather than shown to both users. Assignments never grant project membership. Removing project access immediately removes those tasks from My Work.

The server returns assignment IDs with the authorized workspace and provides `/api/my-work` for the current account’s tasks and their required hierarchy, plus `/api/projects/:id/assignees` for permitted assignment choices. Existing projects/tasks are preserved; no assignment backfill is performed merely by reading the workspace. New customer installations remain empty. Both Pi deployment installers include the assignment service and My Work page.

Currency summaries, charts and register tables display rounded whole amounts without cents. Stored values and financial calculations retain their precision.

## Financials Overview

Open **Financials Overview** from the sidebar. The fixed summary charts show approved budget, spent-to-date actuals and remaining budget across all accessible projects, including Unassigned projects. Use **Budget summary** to collapse or expand the charts and legend; the choice is retained while navigating the portal. Each currency has its own green pie chart for spent versus remaining budget; currencies are never added together. Missing actuals use an unreconciled pattern rather than claiming the balance is known. The summary has a bottom border, and the table column headers stay visible while the rows scroll. Overspending shows an over-budget amount and a fully spent pie rather than a negative slice. Project Financials retains its existing stacked bars.

Expand a portfolio to see programs and direct projects; expand each program to see its projects. Every level uses Portfolio Name, Owner, Total Approved Budget, Actuals, Committed Costs, Estimate at Completion, Forecast Variance and Remaining Budget. Parent totals include each accessible project once, regardless of expansion. Clicking a project opens its workspace. Empty portfolios remain listed.

Project administrators and assigned project managers can enter **Actuals (spent to date)** and **Committed costs (outstanding)** through **Project → Financials → Edit financials** or Edit project. Enter cumulative amounts, not individual transactions; committed costs mean outstanding obligations and exclude amounts already recognized as actuals. Estimate at Completion uses the existing Forecast final cost field. Forecast Variance = Estimate at Completion − Total Approved Budget; a positive value is a projected overrun. Remaining Budget = Total Approved Budget − Actuals; it includes amounts reserved by outstanding commitments, which are shown separately.

Actuals and committed costs are optional and must be nonnegative when entered. Zero means a recorded zero; blank means unrecorded. Existing projects retain their data and have unrecorded costs until entered. Partial totals identify how many projects are unrecorded. Remaining Budget stays unknown if actuals are incomplete; the chart marks the unspent portion as unreconciled. Contributors and viewers can read financials only for their assigned projects and cannot edit project cost fields. No sample financial data is created for fresh customers. The Pi and n8n installers include the page automatically.

## Project schedules

Open a project and select **Schedule**. It opens at the top of the workspace with the top bar and large project header collapsed to give more height to task rows. The section toolbar remains visible at the top. Use **Project details** to reveal the header, or **← Back to projects** to return to the project list. Every task with subtasks has an expand/collapse arrow; it hides or reveals all descendants in both the table and Gantt chart. Nested collapse choices are retained while navigating within the portal. Gantt-only view supports clicking the parent label or using Enter/Space. **Expand all** and **Collapse all** apply to the current project. Collapsing does not change WBS IDs, calculated dates/progress, dependencies or the complete CSV export. Use **Add task** or a row’s **＋ Subtask** action. Click a task description to edit or reparent it. The table includes WBS ID, Task Description, Start Date, Finish Date, Duration, Percent Complete, and Depends On. Top-level tasks are bold; tasks at 100% completion appear grey with strikethrough. Schedule headers are uppercase, bold and navy blue. Select **Major milestone** when creating or editing a task to show a highlighted cyan diamond with a navy outline at its finish on the Gantt chart, plus a label in the task table. The flag preserves duration and dependencies; use duration 0 for a point-in-time milestone. Undated milestones appear on the chart once scheduled. CSV exports include the Major Milestone flag. WBS is generated from creation order within each parent and stays stable when dates or progress change; adding, removing or reparenting tasks can renumber siblings.

Durations use whole **calendar days**, with both start and finish included; zero days creates a milestone. Changing start or duration calculates finish; changing finish in the editor calculates duration. A task can remain unscheduled. A linked task starts on the same date as its latest predecessor finishes, including milestones. While dependencies are present, they control Start Date instead of a manually entered date. Moving predecessors recalculates successor dates in either direction. Existing linked schedules are recalculated on upgrade restart, with new revisions and system audit entries only where values change. Multiple predecessors are supported. Links must stay within the project and cannot be circular. Link leaf tasks or milestones, rather than summary tasks.

Tasks with subtasks automatically use the earliest subtask Start Date and latest subtask Finish Date, including nested subtasks. Duration spans those dates; if no subtasks are scheduled, the parent dates are blank. Top-level tasks without subtasks keep their own dates. Summary completion comes from all leaf descendants, weighted by duration (unscheduled tasks and milestones use weight one). Their dates, status and completion are read-only. Finish dates synchronize to task due dates, while existing unscheduled due dates remain available. Recalculated records receive new revisions and audit entries; stale edits return a refresh message. Startup also refreshes saved parent dates in projects without dependencies; unchanged schedules retain their revisions.

Choose **Table & Gantt**, **Task table**, or **Gantt chart**, and use Days/Weeks/Months for the timeline scale. The project title, project tabs, schedule controls, column headers and timeline date headers stay fixed while task rows scroll. The task table and Gantt panes synchronize vertical scrolling in split view. Each pane scrolls horizontally to expose all columns or dates. Compact screens prioritize the title, tabs and schedule controls. Bars show completed portions, summary spans, milestone diamonds and predecessor arrows. Export schedule produces CSV. Assigned contributors can edit tasks and their schedules; viewers can read and export. Deleting a task requires confirmation and is blocked until its subtasks and successor links are removed or moved. The schedule supports up to 1500 tasks per project and 30 nesting levels.

This scheduling increment uses finish-to-start links and calendar days. Working-day/holiday calendars, other link types and lag, resource leveling, critical-path analysis, baselines, drag-to-reschedule, and Microsoft Project file import/export are not included. See [customer upgrades](deploy/CUSTOMERS.md) to install it on an existing Pi without resetting data.

## Validate

```sh
npm test
```

The tests launch isolated servers on free local ports and temporary databases. They check setup, legacy migration, persistence across restarts, invitations, sessions, CSRF, permissions, account disable/reset, last-admin protection, separate customer databases/cookies, hierarchy validation and visibility, project moves, schedule date calculations, dependency cycles and rollups, audit records, and throttling. They never use the running customer's data directory.

An optional browser workflow test is included in `tests/browser-smoke.cjs`. It starts its own temporary customer server/database and checks setup, portfolio/program/project creation, shared directory tables and fixed headers, project moves, schedule editing/rescheduling/Gantt/export, invitations, viewer controls, disabling, mobile overflow, logout and sign-in. Install Playwright separately in your development environment, then run `node tests/browser-smoke.cjs`. `PLAYWRIGHT_MODULE` may point to an external Playwright package; `CHROMIUM_PATH` may select an installed Chromium. No browser dependency is needed to run the portal or API suite.

## Raspberry Pi deployment and upgrades

Use [customer installation and migration instructions](deploy/CUSTOMERS.md). The installer supports the original `pathtoo` service and separately named customers, preserves data and settings, and backs up a stopped existing database before upgrade. Tailscale Serve keeps the endpoint private. Every user still needs access through the tailnet's own policy in addition to an app account.

## Scope

This release adds customer-owned accounts to the foundation portal. It does not implement a shared SaaS database, automated billing, SSO/MFA, verified email delivery, or a vendor-wide customer control plane. Charters, approval gates, baselines, change control, advanced scheduling, immutable report snapshots, imports, and controlled closure remain later increments. Audit events are retained in the local database; they are not an external tamper-proof audit system.

Validate systemd startup, Tailscale access policies, reboot persistence, recovery, accessibility and expected workload on target infrastructure before production rollout. Pre-upgrade backups are created, but an off-device backup schedule and demonstrated restore are still operational requirements. External font loading is optional; local font fallbacks are provided.

## Automated customer provisioning with n8n Cloud

Use [the automation setup guide](deploy/AUTOMATION.md) to install an outbound Pi worker and import the workflows in `n8n/`. A private agent collects only customer name and the first administrator's name/email. The Pi allocates folders/services/ports, starts an empty customer database, creates a single-use administrator activation link, verifies private HTTPS, and returns the links through n8n. No public Pi webhook, public SSH, or administrator password in the agent is required. See [agent instructions](n8n/AGENT-INSTRUCTIONS.md).
