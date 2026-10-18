# doorbell

Saves Ring Battery Doorbell Pro motion and doorbell-press clips to local disk
without a Ring Protect subscription. It listens for Ring push events and records
the live stream with ffmpeg via the unofficial
[ring-client-api](https://github.com/dgreif/ring).

Runs on the Optiplex at `/home/amol/projects/doorbell` as the `doorbell`
systemd service, enabled at boot.

## Limitations
- The first ~2–4 s of each event is missed while the live stream starts.
- Every clip is a live-view session, so the doorbell battery drains faster.
- Unofficial API: Ring can break it at any time.

## Install (on the Optiplex)
```bash
cd ~/projects/doorbell
./install.sh      # packages, npm deps, systemd units (enabled at boot)
./auth.sh         # one-time Ring login (email, password, 2FA) -> .token, starts service
```

## Network storage (router USB drive)
```bash
sudo bash scripts/setup-nas.sh                 # asks for the router share login once
sudo bash scripts/setup-nas.sh --reset-login   # change the stored login
```
Mounts `//192.168.50.1/optiplex` at `/mnt/nas` (on first access, `nofail` so boot
never waits on it) and creates `doorbell/frontdoor` and `doorbell/patio`. The login
is kept in `/etc/doorbell-nas.cred` (root-only).

Each clip is recorded to the local `clips/` folder, then moved to
`/mnt/nas/doorbell/<camera>/`. If the share is down or the copy fails, the clip
stays in `clips/<date>/`, and every `SWEEP_MINUTES` (default 5) the recorder retries
any clips left there, moving them once the share is back. `npm test` covers this.

## Operate
```bash
journalctl -u doorbell -f              # live log
sudo systemctl restart doorbell        # after editing /etc/doorbell.env
ls ~/projects/doorbell/clips/          # clips, one folder per day
```

Settings live in `doorbell.env`, installed to `/etc/doorbell.env` (SELinux blocks
systemd reading env files under /home). Edit the repo copy and redeploy, or edit
`/etc/doorbell.env` directly with sudo (clip length, motion/ding toggles, retention).
`doorbell-cleanup.timer` deletes clips older than `KEEP_DAYS` daily at 03:30.

## Deploy changes from Windows
Source: https://github.com/amolj2007/doorbell (private). The Optiplex copy is a git
checkout of this repo (bare repo `~/repos/doorbell.git`,
remote `optiplex` here). Commit, then:
```powershell
.\deploy.ps1            # push + pull + restart recorder (no sudo)
.\deploy.ps1 -Install   # also re-run install.sh: systemd units, /etc/doorbell.env (sudo)
```
