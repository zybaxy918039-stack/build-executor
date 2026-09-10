$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $projectRoot
try {
  if (-not (Test-Path -LiteralPath ".env")) { throw "Missing .env. Copy .env.example to .env first." }
  npm start
} finally { Pop-Location }
