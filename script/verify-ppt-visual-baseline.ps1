param(
  [Parameter(Mandatory = $true)][string]$TemplateDir,
  [Parameter(Mandatory = $true)][string]$GeneratedPptx,
  [Parameter(Mandatory = $true)][string]$OutputDir,
  [double]$MaxRmse = 60.0,
  [int]$MaxDhash = 14
)

$ErrorActionPreference = "Stop"
$templatePath = [System.IO.Path]::GetFullPath($TemplateDir)
$deckPath = [System.IO.Path]::GetFullPath($GeneratedPptx)
$outputPath = [System.IO.Path]::GetFullPath($OutputDir)
New-Item -ItemType Directory -Force -Path $outputPath | Out-Null

if (-not (Test-Path -LiteralPath $templatePath)) {
  throw "Template preview directory not found: $templatePath"
}
if (-not (Test-Path -LiteralPath $deckPath)) {
  throw "Generated PPTX not found: $deckPath"
}

$templateRoles = @("cover", "overview", "content", "cards", "data", "closing")
$templatePreviews = @(
  Get-ChildItem -LiteralPath $templatePath -Filter "*.jpg" -File |
    Sort-Object {
      $index = [Array]::IndexOf($templateRoles, [System.IO.Path]::GetFileNameWithoutExtension($_.Name))
      if ($index -lt 0) { 999 } else { $index }
    }
)
if ($templatePreviews.Count -eq 0) {
  throw "Template preview directory has no JPG files"
}

$powerpoint = $null
try {
  $powerpoint = New-Object -ComObject PowerPoint.Application
  $deck = $null
  try {
    $deck = $powerpoint.Presentations.Open($deckPath, $true, $false, $false)
    $deck.Export($outputPath, "JPG", 1280, 720)
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
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($powerpoint) | Out-Null
  }
}

$generatedPreviews = @(
  Get-ChildItem -LiteralPath $outputPath -Filter "*.jpg" -File |
    Sort-Object { [int][regex]::Match($_.BaseName, "\d+").Value }
)
if ($generatedPreviews.Count -eq 0) {
  throw "PowerPoint export produced no JPG previews"
}
$compareCount = [Math]::Min($templatePreviews.Count, $generatedPreviews.Count)

$compareDir = Join-Path $outputPath "compare"
New-Item -ItemType Directory -Force -Path $compareDir | Out-Null
Get-ChildItem -LiteralPath $compareDir -File -ErrorAction SilentlyContinue | Remove-Item -Force
for ($index = 0; $index -lt $compareCount; $index++) {
  Copy-Item -LiteralPath $generatedPreviews[$index].FullName -Destination (Join-Path $compareDir $templatePreviews[$index].Name)
}

$report = Join-Path $outputPath "report.json"
& python script/visual-benchmark-ppt.py `
  --template-dir $templatePath `
  --generated-dir $compareDir `
  --output $report `
  --max-rmse $MaxRmse `
  --max-dhash $MaxDhash `
  --allow-partial
if ($LASTEXITCODE -ne 0) {
  throw "Visual baseline acceptance failed. Report: $report"
}
Write-Output "Visual baseline accepted. Report: $report"
