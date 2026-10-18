#!/usr/bin/env bash
# Interactive Ring login (email, password, 2FA code). Saves the refresh token
# to .token and starts the recorder. Only needed once, or if the token is revoked.
set -euo pipefail
cd "$(dirname "$0")"

npx --no-install ring-auth-cli
echo
read -rp "Paste the refresh token printed above (the long string, without quotes): " token
token=${token//\"/}
if [[ ${#token} -lt 50 ]]; then
  echo "That doesn't look like a refresh token; nothing saved." >&2
  exit 1
fi

umask 077
printf '%s' "$token" > .token
echo "Saved token to $(pwd)/.token"

sudo systemctl restart doorbell.service
sleep 8
systemctl --no-pager status doorbell.service | head -15
echo "Follow logs with: journalctl -u doorbell -f"
