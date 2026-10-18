# One-time: authorize this PC's SSH key on the Optiplex (asks for the password once).
$ErrorActionPreference = 'Stop'
$Server = 'amol@192.168.50.71'
$PubKey = (Get-Content "$env:USERPROFILE\.ssh\id_ed25519.pub" -Raw).Trim()

ssh $Server "umask 077; mkdir -p ~/.ssh; grep -qxF '$PubKey' ~/.ssh/authorized_keys 2>/dev/null || echo '$PubKey' >> ~/.ssh/authorized_keys; restorecon -R ~/.ssh 2>/dev/null; echo KEY_INSTALLED"
