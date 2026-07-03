# NovaWay 图标生成 - 快速指南

## 问题
桌面应用图标仍然是旧的 OpenCode 图标，而不是新的 NovaWay 图标。

## 解决方案

### 步骤 1: 生成 PNG 图标

访问在线工具 **https://cloudconvert.com/svg-to-png**：

1. 上传文件: `packages/desktop/icons/novaway-icon.svg`
2. 设置尺寸: **512x512**
3. 点击转换并下载 PNG

### 步骤 2: 生成 Windows ICO 文件

访问在线工具 **https://cloudconvert.com/png-to-ico**：

1. 上传步骤 1 生成的 PNG
2. 选择尺寸: **16, 32, 48, 64, 128, 256**
3. 点击转换并下载 ICO 文件

### 步骤 3: 替换图标文件

将下载的文件复制到以下位置：

```
packages/desktop/icons/dev/icon.png    ← 256x256 PNG
packages/desktop/icons/dev/icon.ico   ← Windows ICO
packages/desktop/icons/beta/icon.png  ← 256x256 PNG  
packages/desktop/icons/beta/icon.ico  ← Windows ICO
packages/desktop/icons/prod/icon.png  ← 256x256 PNG
packages/desktop/icons/prod/icon.ico  ← Windows ICO
```

### 步骤 4: 生成 macOS ICNS 文件（仅 macOS 开发需要）

macOS 用户可以使用 Image2Icon 工具：
1. 下载: https://img2icnsapp.com/
2. 选择 "Big Sur Icon" 预设
3. 导入 512x512 PNG
4. 导出为 ICNS
5. 复制到 dev/, beta/, prod/ 目录

## 图标源文件

SVG 源文件位于: `packages/desktop/icons/novaway-icon.svg`

此文件包含完整的 NovaWay N+W 融合设计，使用科技蓝渐变配色。

## 重新构建应用

生成新图标后，重新构建桌面应用即可看到新图标：

```bash
cd packages/desktop
bun run build
bun run package
```

## 技术说明

NovaWay 图标设计：
- **N+W 融合**: 字母 N 和 W 的几何组合
- **渐变配色**: #0ea5e9 (浅蓝) → #38bdf8 (天蓝)
- **背景色**: #0f172a (深蓝黑)
- **科技感**: 添加了发光效果和菱形装饰

## 详细文档

完整的图标生成说明请查看：
- `packages/desktop/README-ICONS.md`
- `packages/desktop/scripts/generate-ico.ps1`
