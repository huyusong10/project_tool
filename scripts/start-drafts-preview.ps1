$ErrorActionPreference = 'Stop'
$draftRoot = Split-Path -Parent $PSScriptRoot
if ((Split-Path -Leaf $draftRoot) -ne 'project-manage-drafts') { throw '只能启动个人草稿隔离工作区' }
Set-Location -LiteralPath $draftRoot
if (-not (Test-Path -LiteralPath '.env')) { throw '先运行 node scripts/setup-drafts-preview.mjs' }
$draftConfig = Get-Content -LiteralPath '.env'
foreach ($draftRequired in @('HOST=127.0.0.1','PORT=3242','VITE_PORT=5177','SESSION_COOKIE_NAME=pm_drafts_3242','DB_PATH=./.preview/drafts.db','BACKUP_DIR=./.preview/backups','SKIP_CODEX_SKILL_SYNC=1')) {
  if ($draftConfig -notcontains $draftRequired) { throw '隔离配置不匹配，拒绝启动' }
}
if (-not (Test-Path -LiteralPath 'dist-server/index.js')) { throw '先运行 npm run build' }
foreach ($draftPort in @(3242,5177)) {
  if (Get-NetTCPConnection -LocalPort $draftPort -State Listen -ErrorAction SilentlyContinue) { throw "端口 $draftPort 已占用，未启动任何进程" }
}
$draftNode = (Get-Command node).Source
$draftServer = Start-Process -FilePath $draftNode -ArgumentList "$draftRoot/dist-server/index.js" -WorkingDirectory $draftRoot -WindowStyle Hidden -RedirectStandardOutput "$draftRoot/.preview/server.out.log" -RedirectStandardError "$draftRoot/.preview/server.err.log" -PassThru
$draftServer.Id | Set-Content -LiteralPath '.preview/server.pid'
$draftVite = Start-Process -FilePath $draftNode -ArgumentList "$draftRoot/node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5177 --strictPort" -WorkingDirectory $draftRoot -WindowStyle Hidden -RedirectStandardOutput "$draftRoot/.preview/vite.out.log" -RedirectStandardError "$draftRoot/.preview/vite.err.log" -PassThru
$draftVite.Id | Set-Content -LiteralPath '.preview/vite.pid'
for ($draftAttempt=0; $draftAttempt -lt 30; $draftAttempt++) {
  try {
    $draftHealth=Invoke-RestMethod 'http://127.0.0.1:3242/health' -TimeoutSec 2
    $draftPage=Invoke-WebRequest 'http://127.0.0.1:5177' -TimeoutSec 2
    if ($draftHealth.status -eq 'ok' -and $draftPage.StatusCode -eq 200) { Write-Output '试用服务：http://127.0.0.1:3242；开发前端：http://127.0.0.1:5177'; exit 0 }
  } catch { Start-Sleep -Milliseconds 300 }
}
throw '启动未完成，请查看 .preview 下的服务日志'
