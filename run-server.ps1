$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $ProjectRoot
$env:NODE_ENV = "production"
& node (Join-Path $ProjectRoot "scripts\run-server.mjs")
exit $LASTEXITCODE
