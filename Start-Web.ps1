$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot 'apps\web')
if (!(Test-Path 'package.json')) { throw 'Web directory is missing.' }
& npm.cmd ci
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Read the error above.' }
if (!(Test-Path '.env.local')) { Copy-Item '.env.local.example' '.env.local' }
& npm.cmd run dev
