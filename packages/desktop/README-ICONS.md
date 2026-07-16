# NovaWay 图标生成指南

## 概述

NovaWay 桌面应用需要多种格式的图标文件来支持不同的平台：

- **Windows**: ICO 格式
- **macOS**: ICNS 格式
- **Linux**: PNG 格式
- **Android**: APK 图标

## 生成步骤

### 1. 准备工具

您需要安装以下工具之一：

**ImageMagick** (推荐，跨平台)

```bash
# macOS
brew install imagemagick

# Ubuntu/Debian
sudo apt-get install imagemagick

# Windows
# 从 https://imagemagick.org 下载安装
```

**或使用在线工具**

- [CloudConvert](https://cloudconvert.com/svg-to-ico) - SVG 转 ICO
- [CloudConvert](https://cloudconvert.com/svg-to-png) - SVG 转 PNG
- [Image2Icon](https://img2icnsapp.com/) (macOS) - PNG 转 ICNS

### 2. 生成 Windows ICO 文件

使用 ImageMagick:

```bash
cd packages/desktop/icons

# 将 SVG 转换为多种尺寸的 PNG，然后打包成 ICO
magick convert novaway-icon.svg -resize 16x16 16x16.png
magick convert novaway-icon.svg -resize 32x32 32x32.png
magick convert novaway-icon.svg -resize 48x48 48x48.png
magick convert novaway-icon.svg -resize 64x64 64x64.png
magick convert novaway-icon.svg -resize 128x128 128x128.png
magick convert novaway-icon.svg -resize 256x256 256x256.png

# 打包成 ICO (需要安装 icotool 或使用在线工具)
magick convert 16x16.png 32x32.png 48x48.png 64x64.png 128x128.png 256x256.png icon.ico

# 清理临时文件
rm -f 16x16.png 32x32.png 48x48.png 64x64.png 128x128.png 256x256.png
```

或者使用 PowerShell 和 .NET:

```powershell
# 使用 PowerShell 脚本将 SVG 保存为不同尺寸的 PNG
Add-Type -AssemblyName System.Drawing

$sizes = @(16, 32, 48, 64, 128, 256)
$svg = [xml](Get-Content "novaway-icon.svg")

foreach ($size in $sizes) {
    $bitmap = New-Object System.Drawing.Bitmap($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

    # 这里需要SVG渲染库，实际使用时建议用在线工具转换

    $bitmap.Save("$size`x$size.png", [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose()
    $bitmap.Dispose()
}
```

### 3. 生成 macOS ICNS 文件

使用 Image2Icon:

1. 下载 [Image2Icon](https://img2icnsapp.com/)
2. 打开 Image2Icon，选择 "Big Sur Icon" 预设
3. 导入 512x512 或 1024x1024 的 PNG 图片
4. 导出为 ICNS 格式

命令行方式:

```bash
# 使用 iconutil (macOS 内置)
mkdir -p NovaWay.iconset
sips -z 16 16 novaway-icon.png --out NovaWay.iconset/icon_16x16.png
sips -z 32 32 novaway-icon.png --out NovaWay.iconset/icon_16x16@2x.png
sips -z 32 32 novaway-icon.png --out NovaWay.iconset/icon_32x32.png
sips -z 64 64 novaway-icon.png --out NovaWay.iconset/icon_32x32@2x.png
sips -z 128 128 novaway-icon.png --out NovaWay.iconset/icon_128x128.png
sips -z 256 256 novaway-icon.png --out NovaWay.iconset/icon_128x128@2x.png
sips -z 256 256 novaway-icon.png --out NovaWay.iconset/icon_256x256.png
sips -z 512 512 novaway-icon.png --out NovaWay.iconset/icon_256x256@2x.png
sips -z 512 512 novaway-icon.png --out NovaWay.iconset/icon_512x512.png
sips -z 1024 1024 novaway-icon.png --out NovaWay.iconset/icon_512x512@2x.png
iconutil -c icns NovaWay.iconset
mv NovaWay.icns icon.icns
rm -rf NovaWay.iconset
```

### 4. 复制图标到各个环境

```bash
# 复制 ICO 到 dev, beta, prod 目录
cp icon.ico dev/
cp icon.ico beta/
cp icon.ico prod/

# 复制 ICNS 到 dev, beta, prod 目录
cp icon.icns dev/
cp icon.icns beta/
cp icon.icns prod/

# 复制到 resources/icons (构建时使用)
mkdir -p ../../../resources/icons
cp -r dev/* ../../../resources/icons/
```

## 快速生成脚本

我已经为您创建了自动化脚本：

```bash
cd packages/desktop
bun run scripts/generate-icons.ts
```

## 在线转换工具

如果您不想安装任何软件，可以使用以下在线工具：

1. **SVG 转 PNG**: https://cloudconvert.com/svg-to-png
   - 上传 `packages/desktop/icons/novaway-icon.svg`
   - 设置尺寸为 512x512
   - 下载 PNG 文件

2. **PNG 转 ICO**: https://cloudconvert.com/png-to-ico
   - 上传上一步生成的 PNG
   - 选择多种尺寸 (16, 32, 48, 64, 128, 256)
   - 下载 ICO 文件

3. **PNG 转 ICNS** (macOS): 使用 Image2Icon 应用

## 验证图标

生成完图标后，确保以下文件存在：

```
packages/desktop/icons/
├── novaway-icon.svg          # 源文件 (512x512)
├── dev/
│   ├── icon.ico              # Windows 图标
│   ├── icon.icns             # macOS 图标
│   ├── icon.png              # 256x256 PNG
│   ├── 128x128.png
│   └── ...
├── beta/
│   └── (同上)
└── prod/
    └── (同上)
```

## 注意事项

- 图标必须是正方形
- ICO 和 ICNS 文件需要包含多个尺寸
- PNG 文件建议使用 PNG-24 格式以获得最佳质量
- SVG 源文件使用深色背景 (#0f172a)，渐变色为 #0ea5e9 → #38bdf8
