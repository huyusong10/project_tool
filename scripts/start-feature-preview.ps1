param([switch]$SkipBuild)

$ErrorActionPreference = 'Stop'
$featureRoot = Split-Path -Parent $PSScriptRoot
if ((Split-Path -Leaf $featureRoot) -ne 'project-manage-overview') { throw '只能启动特性规划的隔离 worktree' }
Set-Location -LiteralPath $featureRoot
$featurePreview = Join-Path $featureRoot '.preview'
$featureConfig = Get-Content -LiteralPath "$featurePreview/preview-env.json" -Raw | ConvertFrom-Json
if ($featureConfig.HOST -ne '127.0.0.1' -or [int]$featureConfig.PORT -ne 3250 -or $featureConfig.SESSION_COOKIE_NAME -ne 'pm_overview_preview') {
  throw '预览监听或会话配置不匹配'
}
foreach ($featureField in @('DB_PATH', 'BACKUP_DIR')) {
  $featurePath = [IO.Path]::GetFullPath($featureConfig.$featureField)
  if (!$featurePath.StartsWith($featurePreview + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw '数据库和备份必须位于 .preview 内' }
}
if (Get-NetTCPConnection -LocalPort 3250,3251 -State Listen -ErrorAction SilentlyContinue) { throw '3250 或 3251 已占用；请先停止对应的预览进程' }

if (!$SkipBuild) {
  $featurePreviousCodexHome = $env:CODEX_HOME
  try {
    $env:CODEX_HOME = "$featurePreview/codex-home"
    npm run build
    if ($LASTEXITCODE -ne 0) { throw '构建失败，预览未启动' }
  } finally { $env:CODEX_HOME = $featurePreviousCodexHome }
}
foreach ($featureArtifact in @('dist/index.html', 'dist-server/index.js', 'drizzle/meta/_journal.json')) {
  if (!(Test-Path -LiteralPath $featureArtifact)) { throw "缺少构建产物：$featureArtifact" }
}

# Each process reads one fixed web/server/migration snapshot. Later builds cannot mix versions.
$featureRevision = (git rev-parse --short HEAD).Trim()
$featureRun = Join-Path $featurePreview ('runs/' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $featureRevision)
New-Item -ItemType Directory -Path $featureRun -Force | Out-Null
Copy-Item -LiteralPath 'dist' -Destination "$featureRun/web" -Recurse
Copy-Item -LiteralPath 'dist-server' -Destination "$featureRun/server" -Recurse
Copy-Item -LiteralPath 'drizzle' -Destination "$featureRun/drizzle" -Recurse
Copy-Item -LiteralPath 'package.json' -Destination $featureRun
$featureConfig | Add-Member -Force -NotePropertyName WEB_DIST_DIR -NotePropertyValue "$featureRun/web"
$featureConfig | Add-Member -Force -NotePropertyName SEED_DEMO -NotePropertyValue '0'
[IO.File]::WriteAllText("$featureRun/preview-config.json", ($featureConfig | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
@'
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
// Explicit preview settings also override any inherited shell configuration.
Object.assign(process.env, JSON.parse(readFileSync(new URL('./preview-config.json', import.meta.url), 'utf8')));
await import('./server/index.js');
// Keep the previously delivered preview URL usable without a second application or database.
createServer((request, response) => {
  response.writeHead(307, { location: 'http://127.0.0.1:3250' + (request.url || '/') });
  response.end();
}).listen(3251, '127.0.0.1');
'@ | Set-Content -LiteralPath "$featureRun/start.mjs" -Encoding utf8

$featureArguments = '"' + "$featureRun/start.mjs" + '"'
$featureProcess = Start-Process -FilePath (Get-Command node).Source -ArgumentList $featureArguments -WorkingDirectory $featureRun -WindowStyle Hidden -RedirectStandardOutput "$featureRun/server.log" -RedirectStandardError "$featureRun/server-error.log" -PassThru
$featureProcess.Id | Set-Content -LiteralPath "$featurePreview/preview-server.pid"
@{ processId=$featureProcess.Id; revision=$featureRevision; runtime=$featureRun; url='http://127.0.0.1:3250'; alias='http://127.0.0.1:3251' } | ConvertTo-Json | Set-Content -LiteralPath "$featurePreview/preview-runtime.json"
for ($featureAttempt=0; $featureAttempt -lt 20; $featureAttempt++) {
  try {
    $featureHealth = Invoke-RestMethod 'http://127.0.0.1:3250/health' -TimeoutSec 2
    if ($featureHealth.status -eq 'ok') { Write-Output '特性预览：http://127.0.0.1:3250/paths（3251 自动跳转）'; exit 0 }
  } catch { Start-Sleep -Milliseconds 250 }
}
throw "启动未完成，请检查 $featureRun/server-error.log"
