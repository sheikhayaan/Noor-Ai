# verify_all.ps1 - one-shot LOCAL verification of the Noor security / performance /
# concurrency work. Runs the automated suites across both repos and prints a single
# consolidated result. Nothing here calls an external API or needs a server left
# running - each suite is self-contained (temp DBs, mocked model calls).
#
#   powershell -ExecutionPolicy Bypass -File scripts\verify_all.ps1
#
# The one exception is the "gateway wiring" suite: it probes the LIVE gateway.
# When :8080 is down that suite is SKIPPED (not failed) so the offline suites
# still give a verdict; pass -RequireGateway to make a missing gateway fatal.
#
# Optional: point at a gateway checked out elsewhere:
#   powershell -ExecutionPolicy Bypass -File scripts\verify_all.ps1 -GatewayPath "D:\code\noor gateway"

param(
    [string]$GatewayPath = $(if ($env:NOOR_GATEWAY_DIR) { $env:NOOR_GATEWAY_DIR } else { "C:\Users\sheik\Documents\noor gateway" }),
    [switch]$RequireGateway
)

$ErrorActionPreference = "Continue"

$NoorAi = Split-Path -Parent $PSScriptRoot          # this repo (noor ai)
$Py     = Join-Path $NoorAi ".venv\Scripts\python.exe"
$results = @()

function Run-Suite($name, $dir, $exe, $argList) {
    Write-Host ""
    Write-Host ("=" * 72) -ForegroundColor DarkCyan
    Write-Host "  $name" -ForegroundColor Cyan
    Write-Host "  dir: $dir" -ForegroundColor DarkGray
    Write-Host ("=" * 72) -ForegroundColor DarkCyan
    if (-not (Test-Path $dir)) {
        Write-Host "  FAILED - path not found: $dir" -ForegroundColor Red
        $script:results += [pscustomobject]@{ Suite = $name; Status = "FAIL (missing path)" }
        return
    }
    Push-Location $dir
    & $exe @argList
    $code = $LASTEXITCODE
    Pop-Location
    # Exit code 2 = "the dependency this suite needs is not running" (gateway down).
    $status = if ($code -eq 0) { "PASS" } elseif ($code -eq 2) { "SKIP (gateway down)" } else { "FAIL (exit $code)" }
    $script:results += [pscustomobject]@{ Suite = $name; Status = $status }
}

function Test-GatewayHealth {
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:8080/health" -TimeoutSec 2 -UseBasicParsing
        return ($response.StatusCode -eq 200)
    } catch {
        return $false
    }
}

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host ("=" * 72) -ForegroundColor DarkCyan
Write-Host "  PREFLIGHT" -ForegroundColor Cyan
Write-Host ("=" * 72) -ForegroundColor DarkCyan

if (-not (Test-Path $Py)) {
    Write-Host "  !! venv python not found at $Py - run the backend setup first." -ForegroundColor Red
} else {
    Write-Host "  python  : $Py" -ForegroundColor DarkGray
}

$gatewayUp = Test-GatewayHealth
if ($gatewayUp) {
    Write-Host "  gateway : http://127.0.0.1:8080 UP" -ForegroundColor Green
} else {
    $color = if ($RequireGateway) { "Red" } else { "Yellow" }
    Write-Host "  gateway : http://127.0.0.1:8080 DOWN - live-wiring checks will be skipped" -ForegroundColor $color
    Write-Host "            start it with: powershell -ExecutionPolicy Bypass -File scripts\start_gateway.ps1" -ForegroundColor $color
}
Write-Host "  gateway repo: $GatewayPath $(if (Test-Path $GatewayPath) { '(found)' } else { '(NOT FOUND)' })" -ForegroundColor DarkGray

# ---------------------------------------------------------------------------
# Suites
# ---------------------------------------------------------------------------
Run-Suite "Gateway  : security gates 1/2/4/7 (51 checks)"      $GatewayPath "node" @("scripts/verify_security.mjs")
Run-Suite "Noor AI  : gateway wiring, live (:8080)"            $NoorAi      $Py   @("scripts/check_gateway.py", "--gateway-dir", $GatewayPath)
Run-Suite "Noor AI  : auth / IDOR / web-vitals (30 checks)"    $NoorAi      $Py   @("scripts/verify_auth.py")
Run-Suite "Noor AI  : LIVE smoke, real HTTP+cookies (15)"      $NoorAi      $Py   @("scripts/smoke_live.py")
Run-Suite "Noor AI  : enforce flag read from .env (8 checks)"  $NoorAi      $Py   @("scripts/confirm_enforce_env.py")

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host ("=" * 72) -ForegroundColor DarkCyan
Write-Host "  SUMMARY" -ForegroundColor Cyan
Write-Host ("=" * 72) -ForegroundColor DarkCyan
$results | Format-Table -AutoSize | Out-String | Write-Host

# @(...) is required: in Windows PowerShell 5.1 .Count on a single PSCustomObject
# (e.g. exactly one skipped suite) is $null, not 1.
$failed  = @($results | Where-Object { $_.Status -like "FAIL*" }).Count
$skipped = @($results | Where-Object { $_.Status -like "SKIP*" }).Count
$passed  = @($results | Where-Object { $_.Status -eq "PASS" }).Count

if ($failed -eq 0 -and $RequireGateway -and -not $gatewayUp) {
    Write-Host "FAILED - -RequireGateway was set but the gateway is not answering on :8080." -ForegroundColor Red
    exit 1
}
if ($failed -eq 0) {
    $summary = "ALL GREEN - $passed passed"
    if ($skipped -gt 0) {
        $summary += ", $skipped skipped (gateway down - start it with scripts\start_gateway.ps1 and re-run for full coverage)"
    }
    Write-Host "$summary." -ForegroundColor Green
    exit 0
} else {
    Write-Host "$failed suite(s) did not pass - see output above." -ForegroundColor Red
    exit 1
}
