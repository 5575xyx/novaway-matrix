param(
  [string]$Root = "packages/app/public/assets/office-ppt-templates/pptx"
)

$ErrorActionPreference = "Stop"
$rootPath = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $Root))
$roles = @("cover", "overview", "content", "cards", "data", "closing")

if (-not (Test-Path -LiteralPath $rootPath)) {
  throw "找不到真实 PPTX 模板目录: $rootPath"
}

$powerpoint = $null
try {
  $powerpoint = New-Object -ComObject PowerPoint.Application
  Get-ChildItem -LiteralPath $rootPath -Directory | Sort-Object Name | ForEach-Object {
    $templateDir = $_.FullName
    $templateFile = Join-Path $templateDir "template.pptx"
    if (-not (Test-Path -LiteralPath $templateFile)) {
      Write-Warning "跳过缺少 template.pptx 的目录: $templateDir"
      return
    }

    $previewDir = Join-Path $templateDir "preview"
    New-Item -ItemType Directory -Force -Path $previewDir | Out-Null
    Get-ChildItem -LiteralPath $previewDir -File -ErrorAction SilentlyContinue | Remove-Item -Force

    $deck = $null
    try {
      $deck = $powerpoint.Presentations.Open($templateFile, $true, $false, $false)
      $deck.Export($previewDir, "JPG", 1280, 720)
      $deck.Close()
      $deck = $null
    } finally {
      if ($deck) {
        try { $deck.Close() } catch {}
      }
    }

    $slides = Get-ChildItem -LiteralPath $previewDir -File | Sort-Object { [int]([regex]::Match($_.BaseName, "\d+").Value) }
    if ($slides.Count -lt $roles.Count) {
      throw "$templateFile 预览导出不足: 期望 $($roles.Count) 页，实际 $($slides.Count) 页"
    }

    for ($i = 0; $i -lt $roles.Count; $i++) {
      $target = Join-Path $previewDir "$($roles[$i]).jpg"
      if ((Test-Path -LiteralPath $target)) {
        Remove-Item -LiteralPath $target -Force
      }
      Move-Item -LiteralPath $slides[$i].FullName -Destination $target
    }
    Get-ChildItem -LiteralPath $previewDir -File | Where-Object { $_.Extension -ne ".jpg" } | Remove-Item -Force
    Write-Output "$($_.Name) 预览已生成"
  }
} finally {
  if ($powerpoint) {
    try { $powerpoint.Quit() } catch {}
  }
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($powerpoint) | Out-Null
}
