param([string]$Password)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Password) {
  $SecurePassword = Read-Host "请设置用户密码（至少10位）" -AsSecureString
  $Password = ConvertFrom-SecureString -SecureString $SecurePassword -AsPlainText
}
if ($Password.Length -lt 10) { throw "密码至少需要10个字符" }
$env:PROJECT_MANAGE_NEW_PASSWORD = $Password
try {
  & node (Join-Path $ProjectRoot "scripts\configure.mjs")
  if ($LASTEXITCODE -ne 0) { throw "配置失败" }
} finally {
  Remove-Item Env:PROJECT_MANAGE_NEW_PASSWORD -ErrorAction SilentlyContinue
}
