$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $ProjectRoot
$env:NODE_ENV = "production"
do {
  & node (Join-Path $ProjectRoot "dist-server\index.js")
  $ExitCode = $LASTEXITCODE
  # 64：启动检查未通过，尚未打开数据库，不触发数据库恢复。
  if ($ExitCode -ne 0 -and $ExitCode -ne 75 -and $ExitCode -ne 64) {
    & node (Join-Path $ProjectRoot "dist-server\index.js") --recover-database-swap
    if ($LASTEXITCODE -eq 0) { $ExitCode = 75 }
  }
} while ($ExitCode -eq 75)
exit $ExitCode
