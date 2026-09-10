$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $projectRoot
try {
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "Node.js/npm is required." }
  if (-not (Test-Path -LiteralPath ".env")) { Copy-Item ".env.example" ".env" }
  npm install
  Write-Host "Dependencies installed. Run 'npm start' to start the service."
} finally { Pop-Location }
