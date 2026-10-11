$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot 'apps\api')
if (!(Test-Path 'requirements.txt')) { throw 'API directory is missing.' }
if (!(Test-Path '.venv\Scripts\python.exe')) {
    & py -3.11 -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw 'Python 3.11 was not found. Install Python 3.11 or create .venv manually with Python 3.12.' }
}
& .\.venv\Scripts\python.exe -m pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Read the error above.' }
if (!(Test-Path '.env')) { Copy-Item '.env.example' '.env' }
& .\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
