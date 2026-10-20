# Customer installations and account migration

PathToo now uses named customer accounts. Each installation has its **own database, administrator, users, project memberships, sessions, invitations, setup code, and audit history**. Customers do not register themselves into a shared global database. No vendor-wide administrator or cross-customer login is provided.

Customer administrators manage their own users from **Administration → Users & access**. Add a user, choose their role and assigned projects, and share the generated invitation link privately. The recipient chooses a password. Links are single-use and expire after 48 hours; password reset links expire after one hour. Email delivery is not configured, so no email is sent. Administrators can regenerate links, disable users, update roles and project access, and view the most recent 100 audit events. Older events remain stored. Accounts are disabled rather than deleted, preserving authorship and audit references. Email addresses are identifiers, not verified email ownership; share links only with the intended person through a trusted channel.

## Roles

| Role | Access |
| --- | --- |
| Administrator | All projects and workspace administration, including users and organization name. |
| Project manager | Read/write assigned projects and workstreams; create projects and automatically gain access to those projects. |
| Contributor | Read assigned projects; create/update tasks and RAID records within them. Cannot change project plans or administer users. |
| Viewer | Read-only access to assigned projects, including their reports and costs. |

Non-administrators have no access until projects are assigned. Merely appearing in a task's owner text does not grant access. Users cannot grant themselves access by changing that text. Financial data follows project access; separate field-level commercial permissions are not implemented. User changes revoke all of that user's sessions and outstanding invitation/reset links; enforcement takes effect on the next request. At least one active administrator must remain. All administrators are equally privileged within their own installation.

## Upgrade your existing Raspberry Pi installation

Your current projects are preserved. The old `PMO_ACCESS_TOKEN` stops being a login credential and becomes a **one-time first-administrator setup code**. Once setup completes, even that code cannot unlock the workspace or create another administrator. Existing anonymous/shared-token browser sessions must sign in using accounts.

1. On the Pi, enter your source checkout (normally `~/pathtoo-pmo`). Verify that it has no uncommitted changes, then update the branch:

   ```sh
   cd ~/pathtoo-pmo
   git status --short
   git pull --ff-only origin pathtoo-pmo
   ```

   Preserve any local edits before pulling. Do not run `git reset --hard`.

2. Note the exact HTTPS address from `sudo tailscale serve status`. Run the installer using that **origin**, with no trailing slash or path. This example is a placeholder—replace it with your actual address:

   ```sh
   sudo bash deploy/install-pi.sh "" "https://YOUR-PI.YOUR-TAILNET.ts.net" 3000
   ```

   The empty first argument targets the original `pathtoo` service, existing `/etc/pathtoo.env`, and existing `/var/lib/pathtoo` data. Do not supply a customer slug for this upgrade: a slug creates a separate empty installation. If `PUBLIC_ORIGIN` already has a different value, the installer stops for review instead of replacing it. Existing nondefault ports must be passed instead of 3000.

   The installer tests the code before stopping the old service, then backs up the stopped database and settings to a new root-only directory under `/var/backups/pathtoo/`. It prints that directory's path. Keep the previous source commit for rollback. Installation does not reset Tailscale Serve routes, and no new forwarding is required for an existing working route.

3. Open the usual portal HTTPS address. Complete **Set up your workspace** using your previous unlock code from `/etc/pathtoo.env`, your organization name, your name, email, and a new password of at least 12 characters. Read the setup code locally with `sudo nano /etc/pathtoo.env`; never paste it in chat.

4. Check your existing projects and tasks, sign out, sign back in, and create a test user. Confirm its project access and that disabling it blocks its next request. Verify the application and Tailscale route again after a planned reboot.

5. After setup succeeds, the old `PMO_ACCESS_TOKEN` value may be removed from the environment file. It is ignored for login and cannot re-enable setup. Do not remove the database or `customer` row to try to reset passwords.

Migration adds account tables; it does not rewrite existing project records or their revisions. The first administrator can see all legacy projects. No other user gains access until assigned. An automated integration test verifies migration from an existing legacy database without altering its project JSON.

## Deploy a fresh customer

Use the same GitHub source checkout with **fresh configuration and an empty data directory**, not a copy of another customer's database. New installations start without fictional data. Prefer a separate Raspberry Pi, VM, or server and HTTPS hostname for each customer. Separate installations on one host share that host's root operator and resources; they are not containers or hardware isolation.

For a new customer named `acme`, on a 64-bit Raspberry Pi with Tailscale already signed in:

```sh
sudo apt-get update
sudo apt-get install -y git ca-certificates curl xz-utils
git clone --branch pathtoo-pmo --single-branch https://github.com/diclec/hello-world.git pathtoo-pmo
cd pathtoo-pmo
sudo bash deploy/install-node-pi.sh
sudo bash deploy/install-pi.sh acme "https://YOUR-PI.YOUR-TAILNET.ts.net" 3000
```

Use your actual HTTPS origin. If the checkout exists already, update it without overwriting local changes. The installer creates:

| Item | Customer `acme` |
| --- | --- |
| systemd service / Linux account | `pathtoo-acme` |
| Application | `/opt/pathtoo-acme` |
| Database and runtime files | `/var/lib/pathtoo-acme` |
| Root-only settings and setup code | `/etc/pathtoo-acme.env` |

Review existing Serve/Funnel routes first. For an unused HTTPS port 443, configure private access:

```sh
sudo tailscale serve --bg http://127.0.0.1:3000
sudo tailscale serve status
```

Follow any Tailscale HTTPS enablement link shown. Open the displayed address and complete first-administrator setup. Share the setup code only with the intended initial customer administrator; after setup, it no longer grants access. There are no default user passwords and no public self-registration. Every user also needs network access through the customer's tailnet policy; creating an app account does not join someone to Tailscale.

### Several customer services on the same Pi

Use a distinct slug and unused application port for each installation. Supply a distinct matching HTTPS origin and configure the corresponding Tailscale Serve port. For example, after checking that both ports are unused:

```sh
sudo bash deploy/install-pi.sh beta "https://YOUR-PI.YOUR-TAILNET.ts.net:8443" 3001
sudo tailscale serve --bg --https=8443 http://127.0.0.1:3001
```

Each installation has a distinct cookie name so signing in on one does not replace another's session cookie. For customer-owned or adversarial isolation, use separate hosts/hostnames and tailnets: the same machine still has a common trusted system administrator. Tailscale grants must allow each intended customer/user to reach only their endpoint. Do not enable Funnel or public router forwarding to achieve private access.

## Sessions and password recovery

Passwords are stored as salted scrypt hashes. Browser login uses HttpOnly SameSite=Strict cookies and server-side sessions, not bearer tokens in browser storage. Cookies are Secure for configured HTTPS origins; direct loopback development supports HTTP. Sessions expire after 12 hours or one hour of inactivity. Password changes revoke all sessions and pending reset links, then sign the current browser into a new session. Authentication attempts are rate-limited per account and connection IP over a 15-minute window. A reverse proxy may make the IP limit shared by users; all customer traffic still needs HTTPS and trusted network policy.

Set `PUBLIC_ORIGIN` to the exact public HTTPS origin when using Tailscale Serve or another reverse proxy. This preserves correct cookie and origin behavior even if the proxy changes the upstream Host header. A mismatch can produce a cross-origin error; fix the configured origin and restart only that customer's service.

Users can change their own passwords from the profile button → **My account**. Administrators can issue private reset links. If all administrators lose their passwords, a trusted server operator can recover an existing active administrator locally, without creating a shared backdoor password:

```sh
sudo -u pathtoo env DATA_DIR=/var/lib/pathtoo /opt/pathtoo-node/bin/node /opt/pathtoo/manage.js reset-admin ADMIN_EMAIL
```

For a named customer replace `pathtoo` in all three locations with its service name, e.g. `pathtoo-acme`. The command writes a one-time recovery link to a new mode-0600 file in the customer's data directory and prints **only the filename**. It revokes that administrator's sessions, expires prior links, and audits the operator recovery. View the file locally with `sudo nano FILE_PATH`. If it starts with `/#accept=`, prepend the customer's exact HTTPS origin. Delete the private file after use. This cannot recover a nonexistent or disabled administrator or add a vendor user to another customer's workspace.

## Operations and rollback

Application upgrades must be done separately for each installed customer, using the same slug, origin and port. Updating the source checkout alone does not update installed services. The Node runtime is shared on a single host, so coordinate runtime upgrades across customers.

- Logs: `sudo journalctl -u pathtoo-acme -n 50`.
- Restart: `sudo systemctl restart pathtoo-acme`.
- Settings: `/etc/pathtoo-acme.env` (never commit or share its contents).
- Backups: stop the specific service; back up its entire data directory and root-only environment file; restart it. A database contains customer data and credential/session hashes, so protect backups as sensitive.
- Rollback: stop the service, restore the pre-upgrade backup and matching old code with the correct service-account ownership, restore matching settings, and restart. Do not run the old shared-token version against the upgraded database as a shortcut: it does not enforce the new permissions.

The installer creates a pre-upgrade backup, but a scheduled off-device backup and demonstrated restoration are still required for a production recovery commitment. Do not copy an initialized database as a new customer template: it contains that customer's users, keys, sessions, and records.

## Release boundaries

Integration and browser tests cover customer separation, setup, invitations, sessions, CSRF, roles, project boundaries, migration, and admin operations. Raspberry Pi systemd installation, Tailscale routing/policies, reboot behavior, and backup restoration still require verification on the target hardware. No deployment to an existing customer happens merely by pushing the branch.

This is a self-hosted account-management release, not a complete hosted SaaS control plane. SSO, MFA, verified email and automated mail delivery, billing, quotas, automated customer provisioning, central vendor administration, field-level commercial permissions, and production recovery certification are not included. Existing governance/approval features remain outside this increment.
