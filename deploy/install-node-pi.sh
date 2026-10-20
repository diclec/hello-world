#!/bin/bash
set -euo pipefail
# Install a verified official Node 24 ARM64 binary without replacing system Node.
[[ $EUID -eq 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
[[ $(dpkg --print-architecture) == arm64 ]] || { echo 'This installer requires 64-bit Raspberry Pi OS (arm64).' >&2; exit 1; }
for tool in curl sha256sum tar xz; do command -v "$tool" >/dev/null || { echo "Install prerequisite: $tool" >&2; exit 1; }; done
if [[ -e /opt/pathtoo-node ]]; then
  /opt/pathtoo-node/bin/node --input-type=module -e "import 'node:sqlite'; if(Number(process.versions.node.split('.')[0])<24)process.exit(1)"
  echo 'Existing PathToo Node runtime verified.'
  exit 0
fi
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
cd "$stage"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt -o SHASUMS256.txt
artifact=$(awk '$2 ~ /^node-v24\.[0-9]+\.[0-9]+-linux-arm64\.tar\.xz$/ {print $2}' SHASUMS256.txt)
[[ $artifact =~ ^node-v24\.[0-9]+\.[0-9]+-linux-arm64\.tar\.xz$ ]] || { echo 'Unexpected Node release manifest.' >&2; exit 1; }
version=${artifact#node-}; version=${version%-linux-arm64.tar.xz}
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 "https://nodejs.org/dist/$version/$artifact" -o "$artifact"
awk -v file="$artifact" '$2==file' SHASUMS256.txt > selected.sha256
sha256sum --check selected.sha256
mkdir runtime
tar -xJf "$artifact" --strip-components=1 -C runtime
runtime/bin/node --input-type=module -e "import 'node:sqlite'"
install -d /opt
mv runtime /opt/pathtoo-node
chown -R root:root /opt/pathtoo-node
chmod -R go-w /opt/pathtoo-node
/opt/pathtoo-node/bin/node --version
