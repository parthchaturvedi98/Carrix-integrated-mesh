# Carrix demo launcher (Windows / PowerShell).
# Starts the Python backend (mocks + orchestrator API) on :8000 and the React command centre
# on :5173, each in its own window. No installs required — the backend runs on the standard
# library + httpx, and the UI deps are already vendored in ui/node_modules.

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

# Pick a Python that has httpx (the only backend dependency).
$python = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $python) { throw "python not found on PATH" }

# Ensure Node is reachable (installed via winget under Program Files).
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
            [System.Environment]::GetEnvironmentVariable("Path","User")

Write-Host "Starting Carrix backend (mocks + API) on http://127.0.0.1:8000 ..." -ForegroundColor Cyan
$backendCmd = "`$env:PYTHONPATH='$root'; & '$python' -m api.server"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendCmd

Start-Sleep -Seconds 2

Write-Host "Starting React command centre on http://127.0.0.1:5173 ..." -ForegroundColor Cyan
$uiPath = Join-Path $root "ui"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$uiPath'; npm run dev"

Write-Host ""
Write-Host "Open the command centre:  http://127.0.0.1:5173" -ForegroundColor Green
Write-Host "Backend API + mock systems: http://127.0.0.1:8000" -ForegroundColor Green
Write-Host ""
Write-Host "LLM mode is 'fallback' unless ANTHROPIC_API_KEY is set in carrix-demo\.env"
