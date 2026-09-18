# Windows 安装后打不开？Windows Defender 误报说明

> 适用范围：从 GitHub Release 下载 `novaway-desktop-win-x64-setup.exe` 安装到 Windows 10/11 后，双击桌面快捷方式/开始菜单图标出现 **"Windows 正在查找 NovaWay.exe"** 或 **"找不到快捷方式"** 的提示。

## 一眼判断是不是这个问题

打开安装目录（默认 `%LocalAppData%\Programs\NovaWay`）：

| 看到                                                                                 | 说明                                                    |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| 只有 `locales/`、`resources/`、`chrome_*.pak`、`icudtl.dat`、`Uninstall NovaWay.exe` | **中招了**：Defender 把 `NovaWay.exe` 和所有 DLL 隔离了 |
| 完整列出 `NovaWay.exe`、`ffmpeg.dll`、`*.dll`、`v8_context_snapshot.bin` 等          | 不是这个问题，去看 [故障排查](#其他情况)                |

## 为什么会这样

NovaWay 桌面端是基于 Electron 的应用，CI 出包时如果**没有正式的代码签名证书**（仓库目前未配置 `AZURE_TRUSTED_SIGNING_*`），产出的 `NovaWay.exe` 是**自签证书签名**或**未签名**状态。

Windows Defender / SmartScreen 对"未签名 + 新出现的 + 来自互联网下载的"exe 非常敏感，**安装过程中会主动把 `NovaWay.exe` 和它旁边的 DLL 隔离**（注意：它不会动 `*.pak`、`icudtl.dat`、NSIS 自带的卸载器 —— 这就是为什么你看到的目录里只剩这些东西的原因）。

这不是病毒，但 Defender 没法区分。

## 三步解决

### 第 1 步：恢复被隔离的文件

1. 打开 **Windows 安全中心** → **病毒和威胁防护** → **保护历史记录**
2. 找到最近一次针对 `NovaWay.exe` 的"已隔离"记录
3. 选中条目 → 点击 **还原**（或"允许在设备上"）
4. 对 `ffmpeg.dll`、`libGLESv2.dll`、`vulkan-1.dll` 等同样被隔离的 DLL 重复上述操作

> 💡 如果"保护历史记录"里没有显示，Defender 可能用的是另一种隔离方式。试试第 2 步。

### 第 2 步：把安装目录加入 Defender 白名单（避免以后再被拦）

1. 打开 **Windows 安全中心** → **病毒和威胁防护** → **管理设置**
2. 往下找到 **排除项** → **添加或删除排除项**
3. 添加 **文件夹** 排除，路径填：

   ```
   %LocalAppData%\Programs\NovaWay
   ```

   （如果是 perMachine 安装，路径是 `C:\Program Files\NovaWay`）

### 第 3 步：用"仍要运行"绕过 SmartScreen 弹窗

第一次双击 `NovaWay.exe` 时，SmartScreen 会弹蓝屏：

```
Windows 已保护你的电脑
Microsoft Defender SmartScreen 阻止了无法识别的应用启动...
```

点 **"更多信息"** → **"仍要运行"** 即可。

> 这一步在你点过"仍要运行"或已经把目录加入排除项之后就不会再弹。

## 验证修复成功

桌面双击 **NovaWay** 快捷方式，应该在 3-5 秒内弹出主窗口。如果还是打不开：

1. 打开 `%LocalAppData%\Programs\NovaWay`，确认 `NovaWay.exe` 文件存在且**没有黄色盾牌图标**叠加（黄色盾牌 = 已被 SmartScreen 标记）
2. 右键 → **属性** → 底部应该没有"此文件来自其他计算机，可能不安全"的提示框
3. 如果有，点 **"取消阻止"** → **确定**，再试一次

## 为什么我们暂时不签正式证书

| 方案                                         | 优点                                                  | 缺点                                                          | 状态              |
| -------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------- | ----------------- |
| **自签证书**（当前 CI 行为）                 | 零成本，立竿见影让大多数 Defender 不再主动 quarantine | 部分企业环境 / 严格 Defender 策略仍会拦；SmartScreen 仍弹蓝屏 | ✅ 已加           |
| **Azure Trusted Signing**                    | 微软官方 EV 替代，SmartScreen 即时获信誉              | 需 Azure 订阅 + 三组 Secret；个人项目成本偏高                 | 📋 路线图         |
| **传统 EV 代码签名证书**（DigiCert/Sectigo） | 行业标准，所有环境都认                                | 年费 $300-500，需硬件 token；个人开发者门槛高                 | 📋 路线图         |
| **把整个安装目录加 NSIS 脚本杀软排除**       | 用户零操作                                            | 仍可能被 SmartScreen 拦；不能跨杀软                           | ❌ 不做（不可靠） |

短期方案让用户用上面三步自处理；正式证书等团队决定预算后再上。

## 其他情况

按上面三步处理后仍然打不开，收集以下信息后到 [GitHub Issues](https://github.com/anomalyco/novaway/issues) 报 bug：

1. 安装目录截图（用 `dir "%LocalAppData%\Programs\NovaWay"` 输出）
2. Windows 安全中心 → 保护历史记录 截图
3. `NovaWay.exe` 右键 → 属性 截图
4. Windows 版本（`winver` 命令）
5. Defender 版本（Windows 安全中心 → 关于）

## 相关链接

- [electron-builder 代码签名文档](https://www.electron.build/code-signing.html)
- [Microsoft SmartScreen 行为说明](https://learn.microsoft.com/windows/security/identity-protection/virus-and-threat-protection/microsoft-defender-smartscreen/)
- [Azure Trusted Signing 申请](https://learn.microsoft.com/azure/trusted-signing/overview)

## 已知架构:Windows ARM64 用户的额外说明

如果你是 **Surface Pro 11 / Snapdragon X Elite / Copilot+ PC** 等 Windows ARM64 设备,下载 `novaway-desktop-win-x64.exe` 会弹出 **"此应用无法在你的电脑上运行"**(PE 头不匹配),因为该包是 x64 架构,x64 包在 ARM64 上靠 Prism 转译运行,但 Electron 42 + 自签未签名 + 新设备的多重组合下,部分 ARM64 设备直接拒绝启动。

**下载对应的 ARM64 包**:`novaway-desktop-win-arm64.exe`(CI 已从 2026-09 起同时出 x64 和 arm64 两份 Release 资产)。

如何确认自己是不是 ARM64:

- `设置` → `系统` → `系统信息` → `系统类型` 看是"基于 x64 的电脑"还是"基于 ARM 的电脑"
- 或在 PowerShell 跑:`(Get-CimInstance Win32_Processor).Architecture`,9 = x64,12 = ARM64
