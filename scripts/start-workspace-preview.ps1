param([switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path -Parent $PSScriptRoot
if ((Split-Path -Leaf $workspaceRoot) -ne 'project-manage-workspace') { throw '只能在项目工作区隔离 worktree 启动' }
Set-Location -LiteralPath $workspaceRoot
$workspacePreview = Join-Path $workspaceRoot '.preview'
$workspaceConfig = Get-Content -LiteralPath "$workspacePreview/preview-env.json" -Raw | ConvertFrom-Json
if ($workspaceConfig.HOST -ne '127.0.0.1' -or [int]$workspaceConfig.PORT -ne 3270 -or $workspaceConfig.SESSION_COOKIE_NAME -ne 'pm_workspace_3270') { throw '预览地址或会话配置不匹配' }
foreach ($workspaceField in @('DB_PATH', 'BACKUP_DIR')) {
  $workspacePath = [IO.Path]::GetFullPath($workspaceConfig.$workspaceField)
  if (!$workspacePath.StartsWith($workspacePreview + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw '数据库和备份必须位于 .preview 内' }
}
if (Get-NetTCPConnection -LocalPort 3270 -State Listen -ErrorAction SilentlyContinue) { throw '3270 已有服务，预览未启动' }
if (!$SkipBuild) {
  $workspacePreviousCodexHome = $env:CODEX_HOME
  try { $env:CODEX_HOME = "$workspacePreview/codex-home"; npm run build; if ($LASTEXITCODE -ne 0) { throw '构建失败' } }
  finally { $env:CODEX_HOME = $workspacePreviousCodexHome }
}
$workspaceRevision = (git rev-parse --short HEAD).Trim()
$workspaceRun = Join-Path $workspacePreview ('runs/' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $workspaceRevision)
New-Item -ItemType Directory -Path $workspaceRun -Force | Out-Null
Copy-Item -LiteralPath 'dist' -Destination "$workspaceRun/web" -Recurse
Copy-Item -LiteralPath 'dist-server' -Destination "$workspaceRun/server" -Recurse
Copy-Item -LiteralPath 'drizzle' -Destination "$workspaceRun/drizzle" -Recurse
Copy-Item -LiteralPath 'package.json' -Destination $workspaceRun
$workspaceConfig | Add-Member -Force -NotePropertyName WEB_DIST_DIR -NotePropertyValue "$workspaceRun/web"
[IO.File]::WriteAllText("$workspaceRun/config.json", ($workspaceConfig | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
@'
import fs from 'node:fs';
Object.assign(process.env, JSON.parse(fs.readFileSync(new URL('./config.json', import.meta.url), 'utf8')));
await import('./server/index.js');
'@ | Set-Content -LiteralPath "$workspaceRun/start.mjs" -Encoding utf8
$workspaceArguments = '"' + "$workspaceRun/start.mjs" + '"'
$workspaceProcess = Start-Process -FilePath (Get-Command node).Source -ArgumentList $workspaceArguments -WorkingDirectory $workspaceRun -WindowStyle Hidden -RedirectStandardOutput "$workspaceRun/server.log" -RedirectStandardError "$workspaceRun/server-error.log" -PassThru
@{ processId=$workspaceProcess.Id; revision=$workspaceRevision; runtime=$workspaceRun; url='http://127.0.0.1:3270' } | ConvertTo-Json | Set-Content -LiteralPath "$workspacePreview/preview-runtime.json"
for ($workspaceAttempt=0; $workspaceAttempt -lt 20; $workspaceAttempt++) {
  try { $workspaceHealth = Invoke-RestMethod 'http://127.0.0.1:3270/health' -TimeoutSec 2; if ($workspaceHealth.status -eq 'ok') { Write-Output '项目工作区预览：http://127.0.0.1:3270'; exit 0 } }
  catch { Start-Sleep -Milliseconds 250 }
}
throw "预览未就绪，请检查 $workspaceRun/server-error.log"

