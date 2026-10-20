#!/bin/bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run with sudo bash deploy/install-pi.sh.' >&2; exit 1; }
[[ $(dpkg --print-architecture) == arm64 ]] || { echo '64-bit Raspberry Pi OS (arm64) is required by this installer.' >&2; exit 1; }
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
[[ "$source_dir" != /opt/pathtoo ]] || { echo 'Extract the release into a staging directory, not /opt/pathtoo.' >&2; exit 1; }
command -v tailscale >/dev/null || { echo 'Install and sign into Tailscale first.' >&2; exit 1; }
[[ -x /opt/pathtoo-node/bin/node ]] || { echo 'First run: sudo bash deploy/install-node-pi.sh' >&2; exit 1; }
node_bin=/opt/pathtoo-node/bin/node
"$node_bin" --input-type=module -e "import 'node:sqlite'; if(Number(process.versions.node.split('.')[0])<24)process.exit(1)"
(cd "$source_dir" && "$node_bin" --test tests/*.test.js)
if ! id pathtoo >/dev/null 2>&1; then useradd --system --user-group --home-dir /var/lib/pathtoo --shell /usr/sbin/nologin pathtoo; fi
install -d -o root -g root -m 0755 /opt/pathtoo /opt/pathtoo/public
install -d -o pathtoo -g pathtoo -m 0700 /var/lib/pathtoo
# Do not overwrite an existing token or application database.
if [[ ! -e /etc/pathtoo.env ]]; then
  (umask 077; "$node_bin" --input-type=module - <<'JS' > /etc/pathtoo.env
import { randomBytes } from 'node:crypto';
console.log('HOST=127.0.0.1\nPORT=3000\nDATA_DIR=/var/lib/pathtoo\nPMO_ACCESS_TOKEN='+randomBytes(32).toString('hex'));
JS
  )
fi
chown root:root /etc/pathtoo.env
chmod 0600 /etc/pathtoo.env
if systemctl is-active --quiet pathtoo; then systemctl stop pathtoo; fi
install -m 0644 "$source_dir/server.js" "$source_dir/package.json" /opt/pathtoo/
install -m 0644 "$source_dir/public/index.html" "$source_dir/public/app.js" "$source_dir/public/styles.css" /opt/pathtoo/public/
install -m 0644 "$source_dir/deploy/pathtoo.service" /etc/systemd/system/pathtoo.service
systemctl daemon-reload
systemctl enable --now pathtoo
# Check an authenticated functional response without printing credentials.
"$node_bin" --input-type=module - <<'JS'
import { readFileSync } from 'node:fs';
const config=Object.fromEntries(readFileSync('/etc/pathtoo.env','utf8').trim().split('\n').filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1)];}));
if(config.HOST!=='127.0.0.1'||config.PORT!=='3000'||!config.PMO_ACCESS_TOKEN)throw Error('Expected localhost port 3000 with a configured workspace token');
let ready=false;
for(let n=0;n<20;n++){
  try{const r=await fetch('http://127.0.0.1:3000/api/workspace',{headers:{Authorization:'Bearer '+config.PMO_ACCESS_TOKEN}});const data=await r.json();if(r.ok&&Array.isArray(data.projects)&&Array.isArray(data.tasks)&&Array.isArray(data.raid)&&Array.isArray(data.workstreams)){ready=true;break;}}catch{}
  await new Promise(resolve=>setTimeout(resolve,500));
}
if(!ready)throw Error('Readiness failed. Inspect: sudo journalctl -u pathtoo -n 50');
const denied=await fetch('http://127.0.0.1:3000/api/workspace');if(denied.status!==401)throw Error('Unauthenticated API access was not blocked');
console.log('Portal is running privately on localhost; authenticated readiness and access checks passed.');
JS
printf '%s\n' 'Next: review existing Tailscale Serve/Funnel routes, then follow deploy/RASPBERRY-PI.md.'
