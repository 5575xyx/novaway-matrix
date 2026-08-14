param(
  [string]$ArtifactJson,
  [string]$OutputDir,
  [string]$Voice = "",
  [int]$Rate = 0
)

$ErrorActionPreference = "Stop"
if (-not $ArtifactJson -or -not (Test-Path -LiteralPath $ArtifactJson)) {
  throw "需要提供 ArtifactJson 文件路径"
}

$artifact = Get-Content -LiteralPath $ArtifactJson -Raw -Encoding UTF8 | ConvertFrom-Json
$outputPath = [System.IO.Path]::GetFullPath($OutputDir)
New-Item -ItemType Directory -Force -Path $outputPath | Out-Null

Add-Type -AssemblyName System.Speech
$speech = New-Object System.Speech.Synthesis.SpeechSynthesizer
$speech.Rate = $Rate
$selectedVoice = $null
foreach ($candidate in $speech.GetInstalledVoices()) {
  $info = $candidate.VoiceInfo
  if ($Voice -and $info.Name -eq $Voice) {
    $selectedVoice = $info
    break
  }
  if (-not $Voice -and $info.Culture.Name -like "zh*") {
    $selectedVoice = $info
    break
  }
}
if (-not $selectedVoice) {
  $selectedVoice = $speech.GetInstalledVoices() | Select-Object -First 1
  if (-not $selectedVoice) {
    $speech.Dispose()
    throw "本机没有可用的 Windows 语音引擎"
  }
  $selectedVoice = $selectedVoice.VoiceInfo
}
$speech.SelectVoice($selectedVoice.Name)

$slides = @()
foreach ($slide in @($artifact.slides)) {
  $text = [string]$slide.notes
  if (-not $text.Trim()) {
    $text = [string]$slide.content
  }
  if (-not $text.Trim()) {
    continue
  }
  $safeTitle = ([string]$slide.title -replace '[\\/:*?"<>|]', "-") -replace "\s+", "-"
  $stem = ("{0:D2}_{1}" -f [int]$slide.index, $safeTitle)
  $wavPath = Join-Path $outputPath "$stem.wav"

  $speech.SetOutputToWaveFile($wavPath)
  $speech.Speak($text)
  $speech.SetOutputToNull()

  $bytes = [System.IO.File]::ReadAllBytes($wavPath)
  $dataSize = [BitConverter]::ToInt32($bytes, 40)
  $byteRate = [BitConverter]::ToInt32($bytes, 28)
  $durationMs = if ($byteRate -gt 0) { [Math]::Max(1000, [Math]::Round(($dataSize / $byteRate) * 1000)) } else { 10000 }
  $totalSeconds = [int][Math]::Ceiling($durationMs / 1000)
  $end = "00:00:{0:D2},000" -f $totalSeconds

  $srtPath = Join-Path $outputPath "$stem.srt"
  @(
    "1",
    "00:00:00,000 --> $end",
    $text
  ) | Set-Content -LiteralPath $srtPath -Encoding UTF8

  $slides += [ordered]@{
    slide = [int]$slide.index
    title = [string]$slide.title
    file = "$stem.wav"
    subtitle = "$stem.srt"
    durationMs = $durationMs
    text = $text
  }
}

$manifest = [ordered]@{
  version = 1
  provider = "windows-sapi"
  language = $selectedVoice.Culture.Name
  voice = $selectedVoice.Name
  rate = $Rate
  generatedAt = (Get-Date).ToString("o")
  slides = $slides
}
$manifestPath = Join-Path $outputPath "manifest.json"
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
$speech.Dispose()

Write-Output $manifestPath
