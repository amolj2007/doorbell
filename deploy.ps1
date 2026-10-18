# Deploy committed changes to the Optiplex via git.
#   .\deploy.ps1            push, pull, npm install, restart the recorder (no sudo)
#   .\deploy.ps1 -Install   same, then install.sh (systemd units, /etc/doorbell.env; asks for sudo)
# Uncommitted changes are NOT deployed: commit first.
param([switch]$Install)
$ErrorActionPreference = 'Stop'
$Server = 'amol@192.168.50.71'
Set-Location $PSScriptRoot

if (git status --porcelain) { Write-Warning 'Uncommitted changes will not be deployed.' }

Write-Host '==> Pushing to GitHub and the Optiplex'
git push origin main
if ($LASTEXITCODE -ne 0) { Write-Warning 'GitHub push failed; deploying anyway' }
git push optiplex main
if ($LASTEXITCODE -ne 0) { throw 'git push failed' }

$pull = 'set -e; cd ~/projects/doorbell; git pull --ff-only -q origin main; git log --oneline -1; npm install --omit=dev --no-audit --no-fund --silent'
if ($Install) {
    ssh -t $Server "$pull; bash install.sh"
} else {
    # Stopping the process is enough: systemd restarts it (RestartSec=30) without sudo
    ssh $Server "$pull; kill `$(systemctl show -p MainPID --value doorbell) && echo 'recorder restarting (about 30s)'"
}
if ($LASTEXITCODE -ne 0) { throw 'remote deploy failed' }
