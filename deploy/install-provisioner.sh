#!/bin/bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run with sudo bash deploy/install-provisioner.sh' >&2; exit 1; }
[[ $(dpkg --print-architecture) == arm64 ]] || { echo '64-bit Raspberry Pi OS is required.' >&2; exit 1; }
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
node_bin=/opt/pathtoo-node/bin/node
[[ -x $node_bin ]] || { echo 'First run sudo bash deploy/install-node-pi.sh' >&2; exit 1; }
for program in /usr/bin/tailscale /usr/sbin/runuser /usr/bin/flock /usr/sbin/visudo /usr/bin/sudo; do [[ -x $program ]] || { echo "Missing prerequisite: $program" >&2; exit 1; }; done
(cd "$source_dir" && "$node_bin" --test tests/*.test.js)
# Source is copied explicitly, never including .data, .env, .git or another customer's records.
install -d -o root -g root -m 0755 /opt/pathtoo-provisioner /opt/pathtoo-provisioner/releases
release=$(mktemp -d /opt/pathtoo-provisioner/releases/release-XXXXXXXX)
chmod 0755 "$release"
for dir in public deploy deploy/automation tests n8n n8n/code; do install -d -o root -g root -m 0755 "$release/$dir"; done
install -m 0644 "$source_dir/"{server.js,auth.js,manage.js,package.json} "$release/"
install -m 0644 "$source_dir/public/"{index.html,app.js,identity.js,styles.css} "$release/public/"
install -m 0644 "$source_dir/deploy/"{install-pi.sh,pathtoo.service} "$release/deploy/"
install -m 0644 "$source_dir/deploy/automation/"*.mjs "$release/deploy/automation/"
install -m 0644 "$source_dir/tests/"*.test.js "$release/tests/"
install -m 0644 "$source_dir/n8n/"*.json "$release/n8n/"
install -m 0644 "$source_dir/n8n/code/"*.code "$release/n8n/code/"
if ! id pathtoo-automation >/dev/null 2>&1; then useradd --system --user-group --home-dir /var/lib/pathtoo-worker --shell /usr/sbin/nologin pathtoo-automation; fi
install -d -o root -g root -m 0700 /var/lib/pathtoo-provision /var/lib/pathtoo-provision/requests
install -d -o pathtoo-automation -g pathtoo-automation -m 0700 /var/lib/pathtoo-worker
if [[ ! -e /etc/pathtoo-provisioner.json ]]; then
 (umask 077; printf '%s\n' '{"maxCustomers":10,"appStart":3300,"httpsStart":8443,"portCount":30}' > /etc/pathtoo-provisioner.json)
fi
chown root:root /etc/pathtoo-provisioner.json; chmod 0600 /etc/pathtoo-provisioner.json
# A root-owned fixed wrapper; automation cannot select an executable, source path, or shell command.
install -d -o root -g root -m 0755 /usr/local/sbin
cat > /usr/local/sbin/pathtoo-provision <<'SH'
#!/bin/sh
exec /usr/bin/flock -n -E 75 /var/lib/pathtoo-provision/provision.lock /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/root LANG=C.UTF-8 /opt/pathtoo-node/bin/node /opt/pathtoo-provisioner/current/deploy/automation/provision-cli.mjs "$@"
SH
chown root:root /usr/local/sbin/pathtoo-provision; chmod 0755 /usr/local/sbin/pathtoo-provision
sudo_file=$(mktemp)
trap 'rm -f "$sudo_file"' EXIT
printf '%s\n' 'pathtoo-automation ALL=(root) NOPASSWD: /usr/local/sbin/pathtoo-provision ""' > "$sudo_file"
/usr/sbin/visudo -cf "$sudo_file"
install -o root -g root -m 0440 "$sudo_file" /etc/sudoers.d/pathtoo-provision
# Stop an old worker cleanly before switching code. Existing customer services are not restarted.
if systemctl is-active --quiet pathtoo-worker; then systemctl stop pathtoo-worker; fi
if [[ -L /opt/pathtoo-provisioner/current.new ]]; then
 case "$(readlink /opt/pathtoo-provisioner/current.new)" in
  /opt/pathtoo-provisioner/releases/release-*) rm -- /opt/pathtoo-provisioner/current.new ;;
  *) echo 'Unexpected staging symlink; operator review required.' >&2; exit 1 ;;
 esac
elif [[ -e /opt/pathtoo-provisioner/current.new ]]; then
 echo 'Unexpected staging path; operator review required.' >&2; exit 1
fi
ln -s "$release" /opt/pathtoo-provisioner/current.new
mv -Tf /opt/pathtoo-provisioner/current.new /opt/pathtoo-provisioner/current
install -m 0644 "$source_dir/deploy/automation/pathtoo-worker.service" /etc/systemd/system/pathtoo-worker.service
if [[ ! -e /etc/pathtoo-worker.env ]]; then
 (umask 077; printf '%s\n' 'PMO_QUEUE_URL=https://YOUR-N8N-HOST/webhook/pathtoo-worker' 'PMO_WORKER_KEY=REPLACE_WITH_YOUR_PRIVATE_HEADER_AUTH_KEY' 'PMO_WORKER_ID=pi-ny-db1' 'PMO_POLL_SECONDS=300' > /etc/pathtoo-worker.env)
fi
chown root:root /etc/pathtoo-worker.env; chmod 0600 /etc/pathtoo-worker.env
systemctl daemon-reload
printf '%s\n' 'Provisioner installed. Existing customers were not changed.' 'Configure the n8n workflows and /etc/pathtoo-worker.env, then run: sudo systemctl enable --now pathtoo-worker' 'See deploy/AUTOMATION.md. Do not enable public SSH or Tailscale Funnel.'
