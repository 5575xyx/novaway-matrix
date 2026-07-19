# PowersNexus KPI nightly task wrapper (called by Task Scheduler)
param(
  [string]$RepoRoot = "",
  [switch]$SummaryOnly
)

$ErrorActionPreference = "Stop"

if (-not $RepoRoot) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
}

Set-Location -LiteralPath $RepoRoot

$kpiDir = Join-Path $RepoRoot ".codex\powersnexus-kpi"
$logDir = Join-Path $kpiDir "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$preferredTemp = "E:\tmp\opencode-temp"
if (Test-Path "E:\tmp") {
  New-Item -ItemType Directory -Force -Path $preferredTemp | Out-Null
  $env:TEMP = $preferredTemp
  $env:TMP = $preferredTemp
  $env:TMPDIR = $preferredTemp
}

$stamp = (Get-Date).ToString("yyyyMMdd-HHmmss")
$logFile = Join-Path $logDir ("kpi-" + $stamp + ".log")
$outFile = Join-Path $logDir ("kpi-" + $stamp + ".out.txt")
$errFile = Join-Path $logDir ("kpi-" + $stamp + ".err.txt")

function Resolve-BunPath {
  if ($env:BUN_PATH -and (Test-Path -LiteralPath $env:BUN_PATH)) {
    return $env:BUN_PATH
  }
  $cand = Join-Path $env:USERPROFILE ".bun\bin\bun.exe"
  if (Test-Path -LiteralPath $cand) {
    return $cand
  }
  $cmd = Get-Command bun -ErrorAction SilentlyContinue
  if ($cmd) {
    return $cmd.Source
  }
  throw "bun not found. Install bun or set BUN_PATH."
}

$bun = Resolve-BunPath
$scriptRel = "packages\desktop\scripts\run-kpi-nightly-baseline.mjs"
$script = Join-Path $RepoRoot $scriptRel
if (-not (Test-Path -LiteralPath $script)) {
  throw "KPI script not found: $script"
}

$argList = @($scriptRel)
if ($SummaryOnly) {
  $argList += "--summary-only"
}

$header = "[{0}] repo={1} bun={2} args={3}" -f (Get-Date).ToString("o"), $RepoRoot, $bun, ($argList -join " ")
Add-Content -LiteralPath $logFile -Value $header -Encoding UTF8

$p = Start-Process -FilePath $bun -ArgumentList $argList -WorkingDirectory $RepoRoot -NoNewWindow -Wait -PassThru `
  -RedirectStandardOutput $outFile `
  -RedirectStandardError $errFile

$footer = "[{0}] exit={1}" -f (Get-Date).ToString("o"), $p.ExitCode
Add-Content -LiteralPath $logFile -Value $footer -Encoding UTF8

Copy-Item -LiteralPath $logFile -Destination (Join-Path $logDir "latest.log") -Force
if (Test-Path -LiteralPath $outFile) {
  Copy-Item -LiteralPath $outFile -Destination (Join-Path $logDir "latest.out.txt") -Force
}
if (Test-Path -LiteralPath $errFile) {
  Copy-Item -LiteralPath $errFile -Destination (Join-Path $logDir "latest.err.txt") -Force
}

exit $p.ExitCode
