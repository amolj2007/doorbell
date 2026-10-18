#!/usr/bin/env bash
# One-time: mount the router's USB drive share at /mnt/nas (at boot, on demand)
# and create doorbell/<camera> folders. Prompts for the router share login.
#   sudo bash scripts/setup-nas.sh
set -euo pipefail

SHARE=//192.168.50.1/optiplex
MNT=/mnt/nas
CRED=/etc/doorbell-nas.cred
OWNER=amol

[[ $EUID -eq 0 ]] || { echo "Run with sudo" >&2; exit 1; }

if [[ ! -s $CRED ]] || [[ ${1:-} == --reset-login ]]; then
  read -rp  "Router share username: " user
  read -rsp "Router share password: " pass; echo
  umask 077
  printf 'username=%s\npassword=%s\n' "$user" "$pass" > "$CRED"
  chmod 600 "$CRED"
  unset pass
fi

mkdir -p "$MNT"
# The ASUS router only speaks SMB 2.0.2 (and SMB1); vers=2.1+ fails with EINVAL
opts="credentials=$CRED,uid=$OWNER,gid=$OWNER,file_mode=0664,dir_mode=0775,vers=2.0,soft,_netdev,nofail,x-systemd.automount,x-systemd.mount-timeout=15"
line="$SHARE $MNT cifs $opts 0 0"

# Replace any previous entry for this mount point
sed -i "\#[[:space:]]$MNT[[:space:]]#d" /etc/fstab
echo "$line" >> /etc/fstab
systemctl daemon-reload
systemctl restart remote-fs.target

# Touching the path triggers the automount
if ! ls "$MNT" >/dev/null 2>&1; then
  echo "Mount failed. Check the login (re-run with --reset-login) and: journalctl -b | grep -i cifs" >&2
  exit 1
fi

sudo -u "$OWNER" mkdir -p "$MNT/doorbell/frontdoor" "$MNT/doorbell/patio"
findmnt "$MNT" -t cifs -o TARGET,SOURCE,FSTYPE
ls -la "$MNT/doorbell"
echo "NAS ready."
