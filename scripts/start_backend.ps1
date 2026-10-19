$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$PythonPath = Join-Path $ProjectRoot ".venv\Scripts\python.exe"

Set-Location $ProjectRoot
& $PythonPath -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --reload

