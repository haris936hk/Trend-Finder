# Starts the backend (uvicorn) and frontend (vite) dev servers, each in its
# own window, from the project root. Assumes `backend/.venv` and
# `frontend/node_modules` are already set up (see README.md).

$root = Split-Path -Parent $MyInvocation.MyCommand.Path

Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "Set-Location '$root\backend'; .\.venv\Scripts\Activate.ps1; uvicorn app.main:app --reload"
)

Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "Set-Location '$root\frontend'; npm run dev"
)

Write-Host "Backend starting at http://127.0.0.1:8000"
Write-Host "Frontend starting at http://localhost:5173"
