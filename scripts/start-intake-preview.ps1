$ErrorActionPreference = 'Stop'
$intakeRoot = Split-Path -Parent $PSScriptRoot
if ((Split-Path -Leaf $intakeRoot) -ne 'project-manage-intake') { throw '只能启动隔离工作区' }
Set-Location -LiteralPath $intakeRoot
if (-not (Test-Path -LiteralPath '.env')) { throw '先运行 node scripts/setup-intake-preview.mjs' }
$intakeConfig = Get-Content -LiteralPath '.env'
foreach ($intakeRequired in @('HOST=127.0.0.1','PORT=3240','VITE_PORT=5176','SESSION_COOKIE_NAME=pm_intake_3240','DB_PATH=./.preview/intake.db','BACKUP_DIR=./.preview/backups')) {
  if ($intakeConfig -notcontains $intakeRequired) { throw '隔离配置不匹配，拒绝启动' }
}
if (-not (Test-Path -LiteralPath 'dist-server/index.js')) { throw '先运行 npm run build' }
foreach ($intakePort in @(3240,5176)) {
  if (Get-NetTCPConnection -LocalPort $intakePort -State Listen -ErrorAction SilentlyContinue) { throw "端口 $intakePort 已占用，未启动任何进程" }
}
$intakeNode = (Get-Command node).Source
$intakeServer = Start-Process -FilePath $intakeNode -ArgumentList "$intakeRoot/dist-server/index.js" -WorkingDirectory $intakeRoot -WindowStyle Hidden -RedirectStandardOutput "$intakeRoot/.preview/server.out.log" -RedirectStandardError "$intakeRoot/.preview/server.err.log" -PassThru
$intakeServer.Id | Set-Content -LiteralPath '.preview/server.pid'
$intakeVite = Start-Process -FilePath $intakeNode -ArgumentList "$intakeRoot/node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5176 --strictPort" -WorkingDirectory $intakeRoot -WindowStyle Hidden -RedirectStandardOutput "$intakeRoot/.preview/vite.out.log" -RedirectStandardError "$intakeRoot/.preview/vite.err.log" -PassThru
$intakeVite.Id | Set-Content -LiteralPath '.preview/vite.pid'
for ($intakeAttempt=0; $intakeAttempt -lt 30; $intakeAttempt++) {
  try {
    $intakeHealth=Invoke-RestMethod 'http://127.0.0.1:3240/health' -TimeoutSec 2
    $intakePage=Invoke-WebRequest 'http://127.0.0.1:5176' -TimeoutSec 2
    if ($intakeHealth.status -eq 'ok' -and $intakePage.StatusCode -eq 200) { Write-Output '试用服务：http://127.0.0.1:3240；开发前端：http://127.0.0.1:5176'; exit 0 }
  } catch { Start-Sleep -Milliseconds 300 }
}
throw '启动未完成，请查看 .preview 下的服务日志'
