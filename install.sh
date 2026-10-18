#!/usr/bin/env bash
# One-time install on the Optiplex (Fedora). Run from /home/amol/projects/doorbell:
#   ./install.sh
# Safe to re-run after pulling changes.
set -euo pipefail
cd "$(dirname "$0")"

echo "==> Installing system packages (nodejs, ffmpeg)"
pkgs=()
command -v node   >/dev/null || pkgs+=(nodejs npm)
command -v ffmpeg >/dev/null || pkgs+=(ffmpeg-free)
if ((${#pkgs[@]})); then sudo dnf install -y "${pkgs[@]}"; fi
node --version
ffmpeg -version | sed -n 1p   # not head: its early exit is SIGPIPE under pipefail

echo "==> Installing node dependencies"
npm install --omit=dev --no-audit --no-fund

mkdir -p clips
chmod +x auth.sh

echo "==> Installing systemd units"
sudo install -m 644 doorbell.env                 /etc/doorbell.env
sudo install -m 644 systemd/doorbell.service         /etc/systemd/system/
sudo install -m 644 systemd/doorbell-cleanup.service /etc/systemd/system/
sudo install -m 644 systemd/doorbell-cleanup.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable doorbell.service doorbell-cleanup.timer
sudo systemctl start doorbell-cleanup.timer

if [[ -f .token ]]; then
  sudo systemctl restart doorbell.service
  echo "==> Restarted; recent log:"
  sleep 15
  systemctl is-active doorbell.service || true
  journalctl -u doorbell.service -n 15 --no-pager -o short-iso || true
  echo "Follow logs with: journalctl -u doorbell -f"
else
  echo
  echo "==> Installed and enabled at boot. One step left - log in to Ring:"
  echo "      ./auth.sh"
fi
