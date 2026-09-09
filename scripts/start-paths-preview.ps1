$ErrorActionPreference = 'Stop'
$pathsRoot = Split-Path -Parent $PSScriptRoot
if ((Split-Path -Leaf $pathsRoot) -ne 'project-manage-paths') { throw '只能启动隔离工作区' }
Set-Location -LiteralPath $pathsRoot
if (-not (Test-Path -LiteralPath '.env')) { throw '请先运行 node scripts/setup-paths-preview.mjs' }
$pathsConfig = Get-Content -LiteralPath '.env'
foreach ($pathsRequired in @('HOST=127.0.0.1','PORT=3220','SESSION_COOKIE_NAME=pm_paths_3220','DB_PATH=./.preview/paths.db','BACKUP_DIR=./.preview/backups')) {
  if ($pathsConfig -notcontains $pathsRequired) { throw '隔离配置不匹配，拒绝启动' }
}
if (-not (Test-Path -LiteralPath 'dist-server/index.js')) { throw '请先在此目录运行 npm run build' }
$pathsListener = Get-NetTCPConnection -LocalPort 3220 -State Listen -ErrorAction SilentlyContinue
if ($pathsListener) {
  $pathsCommand = (Get-CimInstance Win32_Process -Filter "ProcessId=$($pathsListener[0].OwningProcess)").CommandLine.Replace('\','/')
  if ($pathsCommand -notlike '*D:/tools/project-manage-paths/dist-server/index.js*') { throw '3220 已被其他进程占用' }
  Write-Output '试用服务已运行：http://127.0.0.1:3220'
  exit 0
}
$pathsNode = (Get-Command node).Source
$pathsProcess = Start-Process -FilePath $pathsNode -ArgumentList "$pathsRoot/dist-server/index.js" -WorkingDirectory $pathsRoot -WindowStyle Hidden -RedirectStandardOutput "$pathsRoot/.preview/server.out.log" -RedirectStandardError "$pathsRoot/.preview/server.err.log" -PassThru
Set-Content -LiteralPath "$pathsRoot/.preview/server.pid" -Value $pathsProcess.Id
for ($pathsAttempt=0; $pathsAttempt -lt 20; $pathsAttempt++) {
  try { $pathsHealth=Invoke-RestMethod 'http://127.0.0.1:3220/health' -TimeoutSec 2; if ($pathsHealth.status -eq 'ok') { Write-Output '试用服务已运行：http://127.0.0.1:3220'; exit 0 } } catch { Start-Sleep -Milliseconds 250 }
}
throw '启动尚未完成，请检查 .preview/server.err.log'
