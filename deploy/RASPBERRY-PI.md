# Private Raspberry Pi deployment

This deployment uses Raspberry Pi OS **64-bit (arm64)**, systemd, Node 24, SQLite, and Tailscale Serve. The app listens only on `127.0.0.1:3000`. Tailscale Serve provides private HTTPS access under the Pi's tailnet hostname. Do not enable Funnel or router port forwarding for this portal.

The installer is prepared and shell syntax checked in the development environment. It has not been executed on your Pi; architecture, systemd, HTTPS, and Tailscale connectivity must be validated there. No remote deployment or GitHub push has been performed.

## 1. Get the code onto the Pi

From a terminal on the Pi, you can download the GitHub branch directly:

```sh
sudo apt-get update
sudo apt-get install -y git ca-certificates curl xz-utils
git clone --branch pathtoo-pmo --single-branch https://github.com/diclec/hello-world.git pathtoo-pmo
cd pathtoo-pmo
dpkg --print-architecture
```

The architecture must be `arm64`. If the repository is private, use your normal authorized GitHub access on the Pi; do not send credentials in chat.

From inside the cloned directory, continue with:

```sh
sudo bash deploy/install-node-pi.sh
sudo bash deploy/install-pi.sh
```

Then proceed directly to **3. Set up private HTTPS** below. Cloning this code does not transfer the development database.

### Alternative: transfer an archive

Download `pathtoo-pi.tar.gz` from this chat, then copy it to your Pi. For example, from your computer, replacing both placeholders:

```sh
scp pathtoo-pi.tar.gz PI_USER@PI_TAILSCALE_HOSTNAME:~/
ssh PI_USER@PI_TAILSCALE_HOSTNAME
```

Normal SSH must be enabled and authorized on your Pi, or Tailscale SSH configured for your user. Alternatively download the archive directly using a browser on the Pi and open a local terminal; SSH is not required for local installation.

If you have real data in the development instance, this code-only archive does not contain it. Stop the development app, copy the complete `.data` directory including SQLite sidecars, and preserve a separate backup. On the Pi, stop `pathtoo` before copying those files into `/var/lib/pathtoo`, set their owner to `pathtoo:pathtoo`, and restart the service. Never overwrite an existing Pi database without a backup. A new install starts with fictional demonstration records.

## 2. Install on the Pi

```sh
dpkg --print-architecture
```

It must report `arm64`. This installer does not support 32-bit Raspberry Pi OS. A Pi already running 32-bit OS needs a separate migration plan; do not reinstall or erase its storage just to proceed.

From the directory containing the downloaded archive:

```sh
mkdir -p ~/pathtoo-release
tar -xzf pathtoo-pi.tar.gz -C ~/pathtoo-release
cd ~/pathtoo-release
sudo apt-get update
sudo apt-get install -y ca-certificates curl xz-utils
sudo bash deploy/install-node-pi.sh
sudo bash deploy/install-pi.sh
```

The Node installer downloads the latest official Node 24 ARM64 release using verified HTTPS and checks its SHA-256 against Node's HTTPS release manifest before extraction. It installs a dedicated runtime into `/opt/pathtoo-node`; your existing system Node is left intact. This is a separate checksum fetch over verified HTTPS, not independent release-signature verification.

The app installer runs the API tests, installs root-owned code under `/opt/pathtoo`, creates a dedicated `pathtoo` service account, and enables automatic startup. It generates a random workspace token in root-only `/etc/pathtoo.env` on first installation. Subsequent installations preserve that file and `/var/lib/pathtoo`. Existing processes on port 3000 must be resolved before installation. On failure inspect `sudo journalctl -u pathtoo -n 50` before retrying.

## 3. Set up private HTTPS

First inspect the Pi's current configuration to avoid replacing another service:

```sh
tailscale status
sudo tailscale serve status
sudo tailscale funnel status
```

Confirm the Pi is signed in, and that HTTPS port 443 is available for this portal. If it serves another application, stop here and choose a separate Serve port or hostname. If Funnel is already enabled on that port, disable that specific Funnel endpoint before using it for the portal. Do not reset or delete unrelated routes.

For an unused port 443:

```sh
sudo tailscale serve --bg http://127.0.0.1:3000
sudo tailscale serve status
```

If Tailscale asks you to enable HTTPS certificates, follow the displayed account link, then repeat the command. Serve requires a current Tailscale version supporting `serve --bg`. `--bg` persists the route across reboots, provided `tailscaled` starts normally.

Open the **HTTPS URL printed by Tailscale** from a device connected to your tailnet. Do not use the Pi's public address. Tailnet policy must allow your device/user to reach the Pi on TCP 443; restrict that permission to your own devices/users as appropriate. This cloud workspace is not connected to your tailnet, so it cannot verify the remote address.

The portal displays an unlock dialog. View `/etc/pathtoo.env` locally using `sudo nano /etc/pathtoo.env`, copy the `PMO_ACCESS_TOKEN` value into that dialog, then close the editor without changing the file. Do not share the token in chat or commit it to Git. It is a single-owner access token, not shared-user identity or role enforcement.

## 4. Validate on the actual Pi

```sh
systemctl is-active pathtoo
systemctl is-enabled pathtoo
sudo ss -ltnp '( sport = :3000 )'
sudo tailscale serve status
sudo tailscale funnel status
```

Check that the application listener is `127.0.0.1:3000`, Serve reports tailnet-only access, and Funnel is not enabled for the portal endpoint. Never publish port 3000 on `0.0.0.0` or add router forwarding.

From the tailnet HTTPS URL, unlock the portal, create a project and task, reload, update the task, and confirm it persists. Verify this **write** operation as well as reads so proxy/origin errors are detected. Reboot the Pi when convenient and verify the service, Tailscale route, and saved records still work. An off-tailnet device should be unable to connect. These checks remain outstanding until performed on your Pi.

## Operations

Logs: `sudo journalctl -u pathtoo -n 50`.

Restart: `sudo systemctl restart pathtoo`.

Stop: `sudo systemctl stop pathtoo`.

The database lives in `/var/lib/pathtoo`, outside the application code. Before an upgrade, stop the service and make a root-only backup of that entire directory. Keep `/etc/pathtoo.env` securely backed up separately. Restart the service after backup; test restoration into a separate directory before relying on a recovery plan. No automated backup schedule or production recovery guarantee is configured.

For updates, extract a new release into a staging directory and rerun `sudo bash deploy/install-pi.sh`; it preserves existing data and token. The installer does not copy your development `.data` directory. Save older releases for code rollback. Future schema migrations may require additional rollback procedures.
