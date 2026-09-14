param([switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$phasesRoot = Split-Path -Parent $PSScriptRoot
if ((Split-Path -Leaf $phasesRoot) -ne 'project-manage-phases') { throw '只能在特性分期隔离 worktree 启动' }
Set-Location -LiteralPath $phasesRoot
$phasesPreview = Join-Path $phasesRoot '.preview'
$phasesConfig = Get-Content -LiteralPath "$phasesPreview/preview-env.json" -Raw | ConvertFrom-Json
if ($phasesConfig.HOST -ne '127.0.0.1' -or [int]$phasesConfig.PORT -ne 3260 -or $phasesConfig.SESSION_COOKIE_NAME -ne 'pm_phases_preview') { throw '预览地址或会话配置不匹配' }
foreach ($phasesField in @('DB_PATH', 'BACKUP_DIR')) {
  $phasesPath = [IO.Path]::GetFullPath($phasesConfig.$phasesField)
  if (!$phasesPath.StartsWith($phasesPreview + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw '数据库和备份必须位于 .preview 内' }
}
if (Get-NetTCPConnection -LocalPort 3260 -State Listen -ErrorAction SilentlyContinue) { throw '3260 已有服务，预览未启动' }
if (!$SkipBuild) {
  $phasesPreviousCodexHome = $env:CODEX_HOME
  try { $env:CODEX_HOME = "$phasesPreview/codex-home"; npm run build; if ($LASTEXITCODE -ne 0) { throw '构建失败' } }
  finally { $env:CODEX_HOME = $phasesPreviousCodexHome }
}
$phasesRevision = (git rev-parse --short HEAD).Trim()
$phasesRun = Join-Path $phasesPreview ('runs/' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $phasesRevision)
New-Item -ItemType Directory -Path $phasesRun -Force | Out-Null
Copy-Item -LiteralPath 'dist' -Destination "$phasesRun/web" -Recurse
Copy-Item -LiteralPath 'dist-server' -Destination "$phasesRun/server" -Recurse
Copy-Item -LiteralPath 'drizzle' -Destination "$phasesRun/drizzle" -Recurse
Copy-Item -LiteralPath 'package.json' -Destination $phasesRun
$phasesConfig | Add-Member -Force -NotePropertyName WEB_DIST_DIR -NotePropertyValue "$phasesRun/web"
[IO.File]::WriteAllText("$phasesRun/config.json", ($phasesConfig | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
@'
import fs from 'node:fs';
Object.assign(process.env, JSON.parse(fs.readFileSync(new URL('./config.json', import.meta.url), 'utf8')));
await import('./server/index.js');
'@ | Set-Content -LiteralPath "$phasesRun/start.mjs" -Encoding utf8
$phasesArguments = '"' + "$phasesRun/start.mjs" + '"'
$phasesProcess = Start-Process -FilePath (Get-Command node).Source -ArgumentList $phasesArguments -WorkingDirectory $phasesRun -WindowStyle Hidden -RedirectStandardOutput "$phasesRun/server.log" -RedirectStandardError "$phasesRun/server-error.log" -PassThru
@{ processId=$phasesProcess.Id; revision=$phasesRevision; runtime=$phasesRun; url='http://127.0.0.1:3260' } | ConvertTo-Json | Set-Content -LiteralPath "$phasesPreview/preview-runtime.json"
for ($phasesAttempt=0; $phasesAttempt -lt 20; $phasesAttempt++) {
  try { $phasesHealth = Invoke-RestMethod 'http://127.0.0.1:3260/health' -TimeoutSec 2; if ($phasesHealth.status -eq 'ok') { Write-Output '特性分期预览：http://127.0.0.1:3260'; exit 0 } }
  catch { Start-Sleep -Milliseconds 250 }
}
throw "预览未就绪，请检查 $phasesRun/server-error.log"
