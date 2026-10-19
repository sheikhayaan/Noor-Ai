<#
  start_gateway.ps1 - start Noor Gateway (:8080), the infrastructure layer that
  every Noor AI chat / embedding call is routed through.

      powershell -ExecutionPolicy Bypass -File scripts\start_gateway.ps1
      powershell -ExecutionPolicy Bypass -File scripts\start_gateway.ps1 -GatewayPath "D:\code\noor gateway"

  Runs in the FOREGROUND (Ctrl+C to stop), like start_backend.ps1 - one
  terminal per service. If the gateway is already answering on the port it says
  so and exits 0, so this is safe to call repeatedly / from dev.ps1.

  Path resolution: -GatewayPath, else $env:NOOR_GATEWAY_DIR, else the default
  checkout below.
#>
param(
    [string]$GatewayPath = $(if ($env:NOOR_GATEWAY_DIR) { $env:NOOR_GATEWAY_DIR } else { "C:\Users\sheik\Documents\noor gateway" }),
    [int]$Port = $(if ($env:NOOR_GATEWAY_PORT) { [int]$env:NOOR_GATEWAY_PORT } else { 8080 })
)

$ErrorActionPreference = "Stop"
$HealthUrl = "http://127.0.0.1:$Port/health"

function Test-GatewayHealth {
    try {
        $response = Invoke-WebRequest -Uri $HealthUrl -TimeoutSec 2 -UseBasicParsing
        return ($response.StatusCode -eq 200)
    } catch {
        return $false
    }
}

# Already running? Nothing to do.
if (Test-GatewayHealth) {
    Write-Host "Noor Gateway is already answering on $HealthUrl - nothing to start." -ForegroundColor Green
    exit 0
}

if (-not (Test-Path $GatewayPath)) {
    Write-Host "!! Noor Gateway checkout not found: $GatewayPath" -ForegroundColor Red
    Write-Host "   Pass it explicitly:" -ForegroundColor Yellow
    Write-Host "     powershell -ExecutionPolicy Bypass -File scripts\start_gateway.ps1 -GatewayPath `"D:\code\noor gateway`"" -ForegroundColor Yellow
    Write-Host "   or set NOOR_GATEWAY_DIR once:" -ForegroundColor Yellow
    Write-Host "     [Environment]::SetEnvironmentVariable('NOOR_GATEWAY_DIR', 'D:\code\noor gateway', 'User')" -ForegroundColor Yellow
    exit 1
}

$Server = Join-Path $GatewayPath "gateway\server.mjs"
if (-not (Test-Path $Server)) {
    Write-Host "!! Gateway entrypoint missing: $Server" -ForegroundColor Red
    exit 1
}

$Node = Get-Command node -ErrorAction SilentlyContinue
if (-not $Node) {
    Write-Host "!! 'node' not found on PATH - install Node.js 20+ to run the gateway." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path (Join-Path $GatewayPath ".env"))) {
    Write-Host "!! No .env in $GatewayPath - the gateway will fall back to its code defaults" -ForegroundColor Yellow
    Write-Host "   (dev key ngw_sk_dev, mock providers). Copy .env.example to .env to configure providers." -ForegroundColor Yellow
}

# A non-gateway process holding the port would fail confusingly further on.
$listening = $false
try {
    $client = New-Object System.Net.Sockets.TcpClient
    $client.Connect("127.0.0.1", $Port)
    $listening = $true
} catch {
    $listening = $false
} finally {
    if ($client) { $client.Close() }
}
if ($listening -and -not (Test-GatewayHealth)) {
    Write-Host "!! Port $Port is held by another process that is not answering $HealthUrl" -ForegroundColor Red
    Write-Host "   Find it with:  netstat -ano | findstr :$Port" -ForegroundColor Yellow
    exit 1
}

Write-Host "Starting Noor Gateway" -ForegroundColor Cyan
Write-Host "  repo : $GatewayPath" -ForegroundColor DarkGray
Write-Host "  port : $Port  ($HealthUrl)" -ForegroundColor DarkGray
Write-Host "  node : $($Node.Source)" -ForegroundColor DarkGray
Write-Host "  Noor AI expects it at http://127.0.0.1:$Port (NOOR_GATEWAY_BASE_URL in noor ai\.env)" -ForegroundColor DarkGray
Write-Host ""

Set-Location $GatewayPath
& $Node.Source "gateway\server.mjs"
