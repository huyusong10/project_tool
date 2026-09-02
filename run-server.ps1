$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $ProjectRoot
$env:NODE_ENV = "production"
do {
  & node (Join-Path $ProjectRoot "dist-server\index.js")
  $ExitCode = $LASTEXITCODE
} while ($ExitCode -eq 75)
exit $ExitCode
