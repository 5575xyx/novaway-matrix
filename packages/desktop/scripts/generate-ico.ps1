# NovaWay Icon Generator Script
# 用于生成桌面应用所需的 ICO 和 PNG 图标文件

Write-Host "NovaWay 图标生成工具" -ForegroundColor Cyan
Write-Host "======================" -ForegroundColor Cyan
Write-Host ""

# 检查 SVG 文件是否存在
$svgPath = Join-Path $PSScriptRoot "..\icons\novaway-icon.svg"
if (-not (Test-Path $svgPath)) {
    Write-Host "错误: 找不到 SVG 源文件: $svgPath" -ForegroundColor Red
    exit 1
}

Write-Host "找到 SVG 源文件: $svgPath" -ForegroundColor Green

# 检查是否有 ImageMagick
$magick = Get-Command magick -ErrorAction SilentlyContinue
if (-not $magick) {
    $magick = Get-Command convert -ErrorAction SilentlyContinue
}

if ($magick) {
    Write-Host "检测到 ImageMagick，正在生成图标..." -ForegroundColor Green
    
    $iconsDir = Join-Path $PSScriptRoot "..\icons\dev"
    Set-Location $iconsDir
    
    # 生成不同尺寸的 PNG
    $sizes = @(16, 32, 48, 64, 128, 256, 512)
    foreach ($size in $sizes) {
        Write-Host "生成 ${size}x${size} PNG..." -ForegroundColor Yellow
        magick convert $svgPath -resize "${size}x${size}" "${size}x${size}.png"
    }
    
    # 生成主 PNG
    Write-Host "生成 icon.png (256x256)..." -ForegroundColor Yellow
    magick convert $svgPath -resize "256x256" "icon.png"
    
    Write-Host ""
    Write-Host "PNG 图标生成完成！" -ForegroundColor Green
    Write-Host ""
    Write-Host "下一步操作:" -ForegroundColor Cyan
    Write-Host "1. 使用在线工具 https://cloudconvert.com/png-to-ico 将 256x256.png 转换为 icon.ico" -ForegroundColor White
    Write-Host "2. 使用 Image2Icon (macOS) 将 PNG 转换为 icon.icns" -ForegroundColor White
    Write-Host "3. 将生成的文件复制到 dev/, beta/, prod/ 目录" -ForegroundColor White
} else {
    Write-Host ""
    Write-Host "未检测到 ImageMagick。" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "请使用以下方法之一生成图标:" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "方法 1: 在线工具 (推荐)" -ForegroundColor Green
    Write-Host "1. 访问 https://cloudconvert.com/svg-to-png" -ForegroundColor White
    Write-Host "2. 上传 novaway-icon.svg" -ForegroundColor White
    Write-Host "3. 设置尺寸为 512x512" -ForegroundColor White
    Write-Host "4. 下载 PNG 文件" -ForegroundColor White
    Write-Host ""
    Write-Host "5. 访问 https://cloudconvert.com/png-to-ico" -ForegroundColor White
    Write-Host "6. 上传 PNG 文件" -ForegroundColor White
    Write-Host "7. 选择尺寸: 16, 32, 48, 64, 128, 256" -ForegroundColor White
    Write-Host "8. 下载 ICO 文件" -ForegroundColor White
    Write-Host ""
    Write-Host "方法 2: 安装 ImageMagick" -ForegroundColor Green
    Write-Host "Windows: https://imagemagick.org/script/download.php" -ForegroundColor White
    Write-Host "然后重新运行此脚本" -ForegroundColor White
    Write-Host ""
    Write-Host "方法 3: 使用 PowerShell + System.Drawing" -ForegroundColor Green
    Write-Host "将生成简化版本的图标" -ForegroundColor White
}

Write-Host ""
Write-Host "生成的 PNG 文件将位于: packages/desktop/icons/dev/" -ForegroundColor Cyan
Write-Host "SVG 源文件位置: packages/desktop/icons/novaway-icon.svg" -ForegroundColor Cyan
Write-Host ""
