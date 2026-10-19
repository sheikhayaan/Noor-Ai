# run-backend-https.ps1 - start the Noor AI FastAPI backend over TLS using the
# mkcert cert produced by scripts\gen-certs.ps1. ASCII-only by project convention.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$py   = Join-Path $root '.venv\Scripts\python.exe'
$key  = Join-Path $root 'frontend\certs\localhost-key.pem'
$cert = Join-Path $root 'frontend\certs\localhost.pem'

if (-not (Test-Path $py))   { Write-Host "venv python not found at $py" -ForegroundColor Red; exit 1 }
if (-not (Test-Path $cert)) { Write-Host 'Cert missing. Run scripts\gen-certs.ps1 first.' -ForegroundColor Yellow; exit 1 }

Set-Location $root
& $py -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --ssl-keyfile $key --ssl-certfile $cert
