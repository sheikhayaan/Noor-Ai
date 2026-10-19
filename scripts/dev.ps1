<#
  dev.ps1 - bring up the whole Noor stack with one command:

      gateway  : http://127.0.0.1:8080   (noor gateway repo, node gateway/server.mjs)
      backend  : http://127.0.0.1:8000   (FastAPI, uvicorn --reload)
      frontend : http://127.0.0.1:3000   (Next.js dev)

  Each service gets its own PowerShell window so logs stay readable and Ctrl+C
  in one window does not kill the others. Services already listening are left
  alone. Waits until gateway + backend answer /health before printing the URLs.

      powershell -ExecutionPolicy Bypass -File scripts\dev.ps1
      powershell -ExecutionPolicy Bypass -File scripts\dev.ps1 -GatewayPath "D:\code\noor gateway"
      powershell -ExecutionPolicy Bypass -File scripts\dev.ps1 -NoFrontend

  Prefer explicit terminals? Run these three by hand instead:
      scripts\start_gateway.ps1
      scripts\start_backend.ps1
      cd frontend; npm.cmd run dev
#>
param(
    [string]$GatewayPath = $(if ($env:NOOR_GATEWAY_DIR) { $env:NOOR_GATEWAY_DIR } else { "C:\Users\sheik\Documents\noor gateway" }),
    [switch]$NoFrontend
)

$ErrorActionPreference = "Stop"
$NoorAi = Split-Path -Parent $PSScriptRoot
$Frontend = Join-Path $NoorAi "frontend"

function Test-Health([string]$Url) {
    try {
        $response = Invoke-WebRequest -Uri $Url -TimeoutSec 2 -UseBasicParsing
        return ($response.StatusCode -eq 200)
    } catch {
        return $false
    }
}

function Start-ServiceWindow([string]$Title, [string]$WorkingDirectory, [string]$Command) {
    $script = "`$Host.UI.RawUI.WindowTitle = '$Title'; Set-Location '$WorkingDirectory'; $Command"
    Start-Process -FilePath "powershell" -ArgumentList @(
        "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $script
    ) | Out-Null
    Write-Host "  started : $Title" -ForegroundColor DarkGray
}

function Wait-Health([string]$Url, [int]$Seconds) {
    for ($i = 0; $i -lt ($Seconds * 2); $i++) {
        if (Test-Health $Url) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

Write-Host "Noor AI dev stack" -ForegroundColor Cyan
Write-Host ("=" * 68) -ForegroundColor DarkCyan

# --- gateway ---------------------------------------------------------------
if (Test-Health "http://127.0.0.1:8080/health") {
    Write-Host "  already up: Noor Gateway :8080" -ForegroundColor Green
} else {
    Start-ServiceWindow "Noor Gateway :8080" $NoorAi `
        "powershell -ExecutionPolicy Bypass -File '$PSScriptRoot\start_gateway.ps1' -GatewayPath '$GatewayPath'"
}

# --- backend ---------------------------------------------------------------
if (Test-Health "http://127.0.0.1:8000/health") {
    Write-Host "  already up: Backend :8000" -ForegroundColor Green
} else {
    Start-ServiceWindow "Noor AI Backend :8000" $NoorAi `
        "powershell -ExecutionPolicy Bypass -File '$PSScriptRoot\start_backend.ps1'"
}

# --- frontend --------------------------------------------------------------
if (-not $NoFrontend) {
    if (Test-Health "http://127.0.0.1:3000") {
        Write-Host "  already up: Frontend :3000" -ForegroundColor Green
    } else {
        Start-ServiceWindow "Noor AI Frontend :3000" $Frontend "npm.cmd run dev"
    }
}

Write-Host ""
Write-Host "Waiting for the APIs to answer /health ..." -ForegroundColor DarkGray
$gatewayUp = Wait-Health "http://127.0.0.1:8080/health" 60
$backendUp = Wait-Health "http://127.0.0.1:8000/health" 60

Write-Host ("=" * 68) -ForegroundColor DarkCyan
Write-Host ("  gateway  :8080  " + $(if ($gatewayUp) { "UP" } else { "NOT UP - see its window" })) -ForegroundColor $(if ($gatewayUp) { "Green" } else { "Red" })
Write-Host ("  backend  :8000  " + $(if ($backendUp) { "UP" } else { "NOT UP - see its window" })) -ForegroundColor $(if ($backendUp) { "Green" } else { "Red" })
if (-not $NoFrontend) { Write-Host  "  frontend :3000  http://127.0.0.1:3000" -ForegroundColor DarkGray }
Write-Host ""

if (-not $gatewayUp) {
    Write-Host "Chat will fail until the gateway is up (Noor AI routes every model call through it)." -ForegroundColor Yellow
    Write-Host "Diagnose with: .venv\Scripts\python.exe scripts\check_gateway.py" -ForegroundColor Yellow
    exit 1
}

Write-Host "Wiring check: .venv\Scripts\python.exe scripts\check_gateway.py --chat" -ForegroundColor DarkGray
exit 0
