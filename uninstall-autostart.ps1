$Task = Get-ScheduledTask -TaskName "ProjectManageLocal" -ErrorAction SilentlyContinue
if ($Task) {
  Unregister-ScheduledTask -TaskName "ProjectManageLocal" -Confirm:$false
  Write-Host "已移除开机自启动"
} else {
  Write-Host "未发现开机自启动任务"
}
