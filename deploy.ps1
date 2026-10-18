# Deploy from Windows to the Optiplex and install/start the service.
# Prompts for the SSH password twice, then sudo password, then (first run) Ring login.
$ErrorActionPreference = 'Stop'
$Server = 'amol@192.168.50.71'
$Stage = '/tmp/doorbell-deploy-' + (Get-Date -Format 'yyyyMMddHHmmss')

Write-Host '==> Copying project to the Optiplex (SSH password)'
scp -r -q "$PSScriptRoot" "${Server}:$Stage"
if ($LASTEXITCODE -ne 0) { throw 'scp failed' }

Write-Host '==> Installing (SSH password, then sudo password)'
$remote = "set -e; mkdir -p ~/projects/doorbell; cp -r $Stage/. ~/projects/doorbell/; rm -rf $Stage; cd ~/projects/doorbell; bash install.sh; if [ ! -f .token ]; then bash auth.sh; fi"
ssh -t $Server $remote
