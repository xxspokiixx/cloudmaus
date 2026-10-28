#!/usr/bin/env bash
# GitHub-hosted ubuntu images keep several SDKs the full-app jobs never use.
# The Node cross build needs about 20 GB free and previously died at 7.6 GB RAM.
set -euo pipefail
echo "=== disk before cleanup ==="
df -h /
sudo rm -rf \
  /usr/share/dotnet \
  /usr/local/lib/android \
  /opt/ghc \
  /usr/local/share/boost \
  /usr/share/swift \
  /usr/local/share/powershell \
  /usr/share/miniconda \
  /opt/hostedtoolcache/CodeQL \
  /usr/local/share/chromium \
  /usr/local/share/vcpkg \
  /opt/microsoft \
  /usr/local/share/google-cloud-sdk \
  /usr/local/.ghcup \
  /usr/local/julia* \
  || true
sudo apt-get clean
if [[ "${FULL_APP_DROP_TOOLCACHE:-}" == "1" ]]; then
  sudo rm -rf /opt/hostedtoolcache || true
fi
if [[ "${SKIP_SWAP:-}" != "1" ]] && ! swapon --show | grep -q '/swapfile'; then
  if ! sudo fallocate -l 8G /swapfile; then
    sudo dd if=/dev/zero of=/swapfile bs=1M count=8192
  fi
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
fi
echo "=== disk and memory after cleanup ==="
df -h /
free -h
swapon --show
