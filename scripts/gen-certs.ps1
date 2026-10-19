# gen-certs.ps1 - generate a trusted local TLS certificate for Noor AI via mkcert.
# One-time prerequisite (interactive, run yourself):
#     winget install FiloSottile.mkcert
#     mkcert -install        # approves the local root CA (Windows security dialog)
# Then run this script to produce the cert/key used by dev:https and uvicorn.
# ASCII-only by project convention.

$ErrorActionPreference = 'Stop'
$root    = Split-Path -Parent $PSScriptRoot
$certDir = Join-Path $root 'frontend\certs'

$mkcert = Get-Command mkcert -ErrorAction SilentlyContinue
if (-not $mkcert) {
    Write-Host 'mkcert is not on PATH.' -ForegroundColor Yellow
    Write-Host 'Install it once, then re-run this script:'
    Write-Host '    winget install FiloSottile.mkcert'
    Write-Host '    mkcert -install    # approves the local root CA (security dialog)'
    exit 1
}

if (-not (Test-Path $certDir)) {
    New-Item -ItemType Directory -Path $certDir | Out-Null
}

$key  = Join-Path $certDir 'localhost-key.pem'
$cert = Join-Path $certDir 'localhost.pem'

Write-Host "Generating trusted cert into $certDir ..."
& $mkcert.Source -key-file $key -cert-file $cert 127.0.0.1 localhost ::1
if ($LASTEXITCODE -ne 0) { Write-Host 'mkcert failed.' -ForegroundColor Red; exit $LASTEXITCODE }

Write-Host ''
Write-Host 'Done. Trusted cert ready:' -ForegroundColor Green
Write-Host "  key : $key"
Write-Host "  cert: $cert"
Write-Host ''
Write-Host 'Next:'
Write-Host '  1) Backend  : scripts\run-backend-https.ps1'
Write-Host '  2) Frontend : cd frontend ; npm run dev:https'
Write-Host '  3) In frontend\.env.local switch NEXT_PUBLIC_NOOR_API_BASE to the https line.'
Write-Host '  4) Open https://127.0.0.1:3000'
