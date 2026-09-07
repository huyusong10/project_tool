$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $ProjectRoot
$env:NODE_ENV = "production"
do {
  & node (Join-Path $ProjectRoot "dist-server\index.js")
  $ExitCode = $LASTEXITCODE
  if ($ExitCode -ne 0 -and $ExitCode -ne 75) {
    & node (Join-Path $ProjectRoot "dist-server\index.js") --recover-database-swap
    if ($LASTEXITCODE -eq 0) { $ExitCode = 75 }
  }
} while ($ExitCode -eq 75)
exit $ExitCode
