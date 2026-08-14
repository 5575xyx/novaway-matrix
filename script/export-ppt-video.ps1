param(
  [Parameter(Mandatory = $true)][string]$PptxPath,
  [Parameter(Mandatory = $true)][string]$OutputMp4,
  [int]$DefaultSlideSeconds = 5,
  [int]$VerticalResolution = 720,
  [int]$FramesPerSecond = 24,
  [int]$Quality = 75
)

$ErrorActionPreference = "Stop"
$deckPath = [System.IO.Path]::GetFullPath($PptxPath)
$videoPath = [System.IO.Path]::GetFullPath($OutputMp4)
$outputDir = [System.IO.Path]::GetDirectoryName($videoPath)
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
if (-not (Test-Path -LiteralPath $deckPath)) {
  throw "PPTX not found: $deckPath"
}

$powerpoint = $null
try {
  $powerpoint = New-Object -ComObject PowerPoint.Application
  $deck = $null
  try {
    $deck = $powerpoint.Presentations.Open($deckPath, $true, $false, $false)
    $deck.CreateVideo($videoPath, $true, $DefaultSlideSeconds, $VerticalResolution, $FramesPerSecond, $Quality)
    $deadline = (Get-Date).AddMinutes(10)
    while ((Get-Date) -lt $deadline) {
      Start-Sleep -Seconds 2
      if (Test-Path -LiteralPath $videoPath) {
        break
      }
      if ($deck.CreateVideoStatus -eq 0) {
        throw "PowerPoint video creation failed"
      }
    }
    $deck.Close()
    $deck = $null
  } finally {
    if ($deck) {
      try { $deck.Close() } catch {}
    }
  }
} finally {
  if ($powerpoint) {
    try { $powerpoint.Quit() } catch {}
  }
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($powerpoint) | Out-Null
}

if (-not (Test-Path -LiteralPath $videoPath)) {
  throw "PowerPoint did not create video: $videoPath"
}
Write-Output $videoPath
