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

## Operate
```bash
journalctl -u doorbell -f              # live log
sudo systemctl restart doorbell        # after editing doorbell.env
ls ~/projects/doorbell/clips/          # clips, one folder per day
```

Settings live in `doorbell.env` (clip length, motion/ding toggles, retention).
`doorbell-cleanup.timer` deletes clips older than `KEEP_DAYS` daily at 03:30.

## Deploy changes from Windows
```bash
scp record.mjs package.json doorbell.env install.sh auth.sh amol@192.168.50.71:projects/doorbell/
scp systemd/* amol@192.168.50.71:projects/doorbell/systemd/
ssh -t amol@192.168.50.71 'cd ~/projects/doorbell && ./install.sh'
```
