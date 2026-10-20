#!/bin/bash
set -euo pipefail
# No arguments upgrades the original installation. Optional: CUSTOMER_SLUG HTTPS_ORIGIN PORT.
[[ $EUID -eq 0 ]] || { echo 'Run with sudo bash deploy/install-pi.sh.' >&2; exit 1; }
[[ $(dpkg --print-architecture) == arm64 ]] || { echo '64-bit Raspberry Pi OS (arm64) is required by this installer.' >&2; exit 1; }
customer_slug=${1:-}
public_origin=${2:-}
app_port=${3:-3000}
[[ -z $customer_slug || $customer_slug =~ ^[a-z][a-z0-9-]{0,19}$ ]] || { echo 'Use a lowercase customer slug, up to 20 letters/digits/hyphens.' >&2; exit 1; }
[[ $app_port =~ ^[0-9]{4,5}$ && $app_port -ge 1024 && $app_port -le 65535 ]] || { echo 'Choose a port from 1024 to 65535.' >&2; exit 1; }
[[ -z $customer_slug || -n $public_origin ]] || { echo 'New customer installs require an HTTPS origin. See deploy/CUSTOMERS.md.' >&2; exit 1; }
service_name=pathtoo
[[ -z $customer_slug ]] || service_name="pathtoo-$customer_slug"
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
app_dir="/opt/$service_name"
data_dir="/var/lib/$service_name"
env_file="/etc/$service_name.env"
[[ "$source_dir" != "$app_dir" ]] || { echo 'Use a staging checkout, not the installed application directory.' >&2; exit 1; }
command -v tailscale >/dev/null || { echo 'Install and sign into Tailscale first.' >&2; exit 1; }
node_bin=/opt/pathtoo-node/bin/node
[[ -x $node_bin ]] || { echo 'First run: sudo bash deploy/install-node-pi.sh' >&2; exit 1; }
"$node_bin" --input-type=module -e "import 'node:sqlite'; if(Number(process.versions.node.split('.')[0])<24)process.exit(1)"
if [[ -n $public_origin ]]; then
 "$node_bin" --input-type=module -e 'const u=new URL(process.argv[1]);if(u.origin!==process.argv[1]||u.protocol!=="https:"||u.username||u.password)process.exit(1)' "$public_origin" || { echo 'Use an HTTPS origin without path or trailing slash.' >&2; exit 1; }
fi
# Preflight existing settings before stopping an existing service. Values are not logged.
if [[ -e $env_file ]]; then
 "$node_bin" --input-type=module - "$env_file" "$data_dir" "$app_port" "$public_origin" <<'JS'
import { readFileSync } from 'node:fs';
const [file,dataDir,port,origin]=process.argv.slice(2);
const config=Object.fromEntries(readFileSync(file,'utf8').split('\n').filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1)];}));
if(config.HOST!=='127.0.0.1'||config.PORT!==port||config.DATA_DIR!==dataDir)throw Error('Existing HOST, PORT or DATA_DIR differs. Use matching installation parameters; settings were not overwritten.');
if(origin&&config.PUBLIC_ORIGIN&&config.PUBLIC_ORIGIN!==origin)throw Error('Existing PUBLIC_ORIGIN differs. Review the environment file before changing destinations.');
JS
fi
(cd "$source_dir" && "$node_bin" --test tests/*.test.js)
if ! id "$service_name" >/dev/null 2>&1; then useradd --system --user-group --home-dir "$data_dir" --shell /usr/sbin/nologin "$service_name"; fi
install -d -o root -g root -m 0755 "$app_dir" "$app_dir/public"
install -d -o "$service_name" -g "$service_name" -m 0700 "$data_dir"
if systemctl is-active --quiet "$service_name"; then systemctl stop "$service_name"; fi
# Do not let another customer's listener satisfy our readiness check.
"$node_bin" --input-type=module -e 'import {createServer} from "node:net";const s=createServer();s.on("error",()=>{console.error("Application port is occupied; choose another port. No application files were replaced.");process.exit(1)});s.listen(Number(process.argv[1]),"127.0.0.1",()=>s.close());' "$app_port"
# Back up the stopped SQLite database and settings before additive account migrations.
if [[ -f "$data_dir/pmo.sqlite" ]]; then
 install -d -o root -g root -m 0700 /var/backups/pathtoo
 backup_dir=$(mktemp -d "/var/backups/pathtoo/$service_name-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")
 cp -a "$data_dir/." "$backup_dir/"
 [[ ! -f $env_file ]] || install -m 0600 "$env_file" "$backup_dir/environment.env"
 echo "Pre-upgrade backup: $backup_dir"
fi
if [[ ! -e $env_file ]]; then
 (umask 077; "$node_bin" --input-type=module - "$app_port" "$data_dir" "$public_origin" <<'JS' > "$env_file"
import { randomBytes } from 'node:crypto';
const [port,dataDir,origin]=process.argv.slice(2);
console.log(`HOST=127.0.0.1\nPORT=${port}\nDATA_DIR=${dataDir}\nPMO_ACCESS_TOKEN=${randomBytes(32).toString('hex')}\nSEED_DEMO=false${origin?'\nPUBLIC_ORIGIN='+origin:''}`);
JS
 )
elif [[ -n $public_origin ]] && ! grep -q '^PUBLIC_ORIGIN=' "$env_file"; then
 printf '\nPUBLIC_ORIGIN=%s\n' "$public_origin" >> "$env_file"
fi
chown root:root "$env_file"; chmod 0600 "$env_file"
install -m 0644 "$source_dir/server.js" "$source_dir/auth.js" "$source_dir/manage.js" "$source_dir/package.json" "$app_dir/"
install -m 0644 "$source_dir/public/index.html" "$source_dir/public/app.js" "$source_dir/public/identity.js" "$source_dir/public/styles.css" "$app_dir/public/"
sed "s/@SERVICE@/$service_name/g" "$source_dir/deploy/pathtoo.service" > "/etc/systemd/system/$service_name.service"
chmod 0644 "/etc/systemd/system/$service_name.service"
systemctl daemon-reload
systemctl enable --now "$service_name"
"$node_bin" --input-type=module - "$app_port" "$data_dir" <<'JS'
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
const [port,dataDir]=process.argv.slice(2);let ready=false;
for(let n=0;n<20;n++){
 try{const r=await fetch(`http://127.0.0.1:${port}/api/auth/status`);const data=await r.json();if(r.ok&&typeof data.setupRequired==='boolean'){const db=new DatabaseSync(path.join(dataDir,'pmo.sqlite'),{readOnly:true});const expected=db.prepare('SELECT instance_id FROM customer WHERE id=1').get()?.instance_id;db.close();if(!expected||data.instanceId!==expected)throw Error('Customer instance mismatch');ready=true;console.log(data.setupRequired?'Create the first administrator in the browser using your existing setup code.':'Customer accounts are configured. Sign in with your email and password.');break;}}catch{}
 await new Promise(resolve=>setTimeout(resolve,500));
}
if(!ready)throw Error('Readiness failed; inspect the systemd service logs');
const denied=await fetch(`http://127.0.0.1:${port}/api/workspace`);if(denied.status!==401)throw Error('Unauthenticated workspace access was not blocked');
console.log('Application and access-denial readiness checks passed.');
JS
printf '%s\n' "Service: $service_name; settings: $env_file; data: $data_dir" 'Next: configure Tailscale Serve and complete customer setup. See deploy/CUSTOMERS.md.'
