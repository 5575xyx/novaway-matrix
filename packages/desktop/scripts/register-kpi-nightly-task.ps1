# Register Windows Scheduled Task for PowersNexus KPI nightly baseline
param(
  [string]$RepoRoot = "",
  [string]$TaskName = "NovaWay-PowersNexus-KPI-Nightly",
  [string]$Time = "02:15",
  [switch]$Force
)

$ErrorActionPreference = "Stop"

if (-not $RepoRoot) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
}

$wrapper = Join-Path $RepoRoot "packages\desktop\scripts\run-kpi-nightly-task.ps1"
if (-not (Test-Path -LiteralPath $wrapper)) {
  throw "Wrapper not found: $wrapper"
}

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing -and -not $Force) {
  Write-Host "Task already exists: $TaskName"
  Write-Host "Use -Force to recreate"
  Get-ScheduledTask -TaskName $TaskName | Format-List TaskName, State
  exit 0
}

if ($existing -and $Force) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

$ps = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$arg = "-NoProfile -ExecutionPolicy Bypass -File `"$wrapper`" -RepoRoot `"$RepoRoot`""

$action = New-ScheduledTaskAction -Execute $ps -Argument $arg -WorkingDirectory $RepoRoot
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description "NovaWay PowersNexus 7-day KPI nightly baseline" | Out-Null

Write-Host "Registered scheduled task: $TaskName"
Write-Host "Daily at $Time (local timezone)"
Write-Host "Repo: $RepoRoot"
Write-Host "Wrapper: $wrapper"
Write-Host ""
Write-Host "Run now:"
Write-Host "  schtasks /Run /TN `"$TaskName`""
Write-Host "Or:"
Write-Host "  powershell -NoProfile -ExecutionPolicy Bypass -File `"$wrapper`" -RepoRoot `"$RepoRoot`""
Write-Host ""
Write-Host "Summary:"
Write-Host "  bun packages/desktop/scripts/run-kpi-nightly-baseline.mjs --summary-only"
