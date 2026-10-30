import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import type { Configuration } from "electron-builder"

const execFileAsync = promisify(execFile)
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const signScript = path.join(rootDir, "script", "sign-windows.ps1")

async function signWindows(configuration: { path: string }) {
  if (process.platform !== "win32") return
  if (process.env.GITHUB_ACTIONS !== "true") return

  // 关键: 签名失败不能让整个 electron-builder build fail,否则用户连 setup.exe 都拿不到。
  // 签名失败时只 warn,继续走 NSIS 打包 —— 然后由 CI 后置 Verify 步骤和人工反馈闭环。
  // 用 stderr inherit 让 PowerShell 的真实错误信息(signing status, cert 错误等)直接
  // 出现在 GitHub Actions 日志里,方便排查。
  try {
    await execFileAsync(
      "pwsh",
      ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", signScript, configuration.path],
      { cwd: rootDir, stdio: "inherit" },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[signWindows] signing failed for ${configuration.path} — continuing without signature`)
    console.warn(`[signWindows] error: ${message}`)
  }
}

const channel = (() => {
  // fork 改名后统一用 NOVAWAY_CHANNEL;保留对旧 OPENCODE_CHANNEL 的兼容。
  const raw = process.env.NOVAWAY_CHANNEL ?? process.env.OPENCODE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "dev"
})()

// macOS 签名与公证只在配置了 APPLE_CERTIFICATE 时进行(工作流把对应 Secret 注入进来);
// 没有证书却强制 notarize 会让 electron-builder 在 CI 上直接失败。未签名包用户首次打开
// 需右键 → 打开(或系统设置里放行),功能不受影响。
const signMac = !!process.env.APPLE_CERTIFICATE

// 在 GitHub Actions 里构建时,自动更新源指向当前仓库(fork),而不是写死的上游 anomalyco/*;
// 工作流会把 electron-builder 生成的 latest*.yml 和安装包一起上传到同一份 Release,
// 这样桌面端的"检查更新"才能真的找到新版本。
const selfPublish = (() => {
  const repo = process.env.GITHUB_REPOSITORY
  if (!repo) return undefined
  const [owner, name] = repo.split("/")
  return { provider: "github" as const, owner, repo: name, channel: "latest" }
})()

const getBase = (): Configuration => ({
  artifactName: "novaway-desktop-${os}-${arch}.${ext}",
  directories: {
    output: "dist",
    buildResources: "resources",
  },
  files: [
    // 只打构建产物。`resources/**` 一律通过 extraResources 分发，运行时也只从
    // process.resourcesPath 读取（见 src/main/index.ts、windows.ts）；
    // 再把 resources 塞进 asar 等于把 node.exe（87 MB）和 MCP 依赖原样复制一份。
    "out/**/*",
    "!out/**/*.map",
    "!node_modules/**/*.map",
    // effect 的 TS 源码只在开发时用得到，运行走 dist。
    "!node_modules/effect/src{,/**/*}",
    // 只保留本架构的 node-pty 预编译包；asar 里带着四个平台的 `.node` + conpty。
    "!node_modules/@lydell/node-pty-darwin-arm64{,/**/*}",
    "!node_modules/@lydell/node-pty-darwin-x64{,/**/*}",
    "!node_modules/@lydell/node-pty-linux-arm64{,/**/*}",
    "!node_modules/@lydell/node-pty-linux-x64{,/**/*}",
    ...((process.env.NOVAWAY_DESKTOP_NODE_ARCH ?? process.arch) === "arm64"
      ? ["!node_modules/@lydell/node-pty-win32-x64{,/**/*}"]
      : ["!node_modules/@lydell/node-pty-win32-arm64{,/**/*}"]),
  ],
  // NSIS 用 LZMA，maximum 能再省几个百分点；构建慢一点但只在发布时跑。
  compression: "maximum",
  extraResources: [
    {
      from: "native/",
      to: "native/",
      filter: ["index.js", "index.d.ts", "build/Release/mac_window.node", "swift-build/**"],
    },
    {
      from: "resources/icons/",
      to: "icons/",
    },
    {
      from: "resources/playwright-mcp/",
      to: "playwright-mcp/",
      filter: ["**/*", "!**/*.map", "!**/*.pdb", "!**/*.iobj", "!**/*.ipdb", "!**/*.obj", "!**/*.lib"],
    },
    // 离线可用的 ripgrep：sidecar 通过 NOVAWAY_RG_PATH 直接用它，不再联网下载。
    // 仓库里只有 Windows 的 rg.exe，其它平台走系统 rg 或首次使用时的下载。
    ...(process.platform === "win32" ? [{ from: "resources/ripgrep/", to: "ripgrep/" }] : []),
    {
      from: "resources/node/",
      to: "node/",
      filter: ["**/*"],
    },
  ],
  asarUnpack: [],
  afterPack: async (context) => {
    const playwrightMcpSrc = path.join(context.packager.projectDir, "resources", "playwright-mcp")
    const playwrightMcpDest = path.join(context.appOutDir, "resources", "playwright-mcp")
    // bun 装出来的 playwright-mcp 是一堆符号链接，必须 dereference 拷实体文件；
    // 同时跳过 sourcemap 与原生构建中间产物，否则 extraResources 的 filter 等于白写。
    const skip = /\.(map|pdb|iobj|ipdb|obj|lib)$/i
    fs.cpSync(playwrightMcpSrc, playwrightMcpDest, {
      recursive: true,
      dereference: true,
      force: true,
      filter: (source) => !skip.test(source),
    })
  },
  mac: {
    category: "public.app-category.developer-tools",
    icon: `resources/icons/icon.icns`,
    target: ["dmg", "zip"],
    ...(signMac
      ? {
          hardenedRuntime: true,
          gatekeeperAssess: false,
          entitlements: "resources/entitlements.plist",
          entitlementsInherit: "resources/entitlements.plist",
          notarize: true,
        }
      : {}),
  },
  dmg: {
    sign: signMac,
  },
  protocols: {
    name: "NovaWay",
    schemes: ["novaway"],
  },
  win: {
    icon: `resources/icons/icon.ico`,
    // 显式 executableName,避免不同 channel(beta/prod)下 productName 漂移导致
    // 安装目录里既没有 NovaWay.exe 也没有 NovaWay Beta.exe 的"装完找不到入口"问题
    executableName: "NovaWay",
    signtoolOptions: {
      sign: signWindows,
    },
    target: ["nsis"],
    verifyUpdateCodeSignature: false,
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    // perMachine=true 时安装到 Program Files,UAC 提权让 Defender 走更宽松策略;
    // perMachine=false 装到 %LocalAppData%\Programs 是 Defender 重点盯防区
    perMachine: false,
    // electron-builder 26 已移除 nsis.requestedExecutionLevel;UAC 现在由
    // perMachine + allowElevation 自动控制:perMachine=false + allowElevation=true
    // 会让 NSIS 在用户机器上请求提权,用户同意后装到 Program Files(x86)/NovaWay
    allowElevation: true,
    installerIcon: `resources/icons/icon.ico`,
    installerHeaderIcon: `resources/icons/icon.ico`,
    // 安装器视觉:自绘的深色品牌图(164×314 侧栏/150×57 页头)。不配的话
    // electron-builder 会用 NSIS 自带的 nsis3-metro 灰蓝图,观感很老。
    installerSidebar: `resources/installer/installerSidebar.bmp`,
    installerHeader: `resources/installer/installerHeader.bmp`,
    // 自定义脚本:更新时跳过"为哪位用户安装"页并沿用上次模式、装完直接重启。
    // 详见 resources/installer/installer.nsh 顶部注释。
    include: `resources/installer/installer.nsh`,
    // 卸载时清干净,避免旧版本残留导致用户重装时 Defender 把旧 exe 拉黑名单后
    // 把新装的也连带干掉
    deleteAppDataOnUninstall: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
  },
  linux: {
    // 包名是 @novaway/desktop，electron-builder 默认从包名推 executableName 会得到
    // "@novawaydesktop"，AppImage 直接拒收(路径非法字符 @)，必须显式指定干净的名字。
    executableName: "novaway",
    icon: `resources/icons`,
    category: "Development",
    target: ["AppImage", "deb", "rpm"],
  },
})

function getConfig() {
  const base = getBase()

  switch (channel) {
    case "dev": {
      return {
        ...base,
        appId: "ai.novaway.desktop.dev",
        productName: "NovaWay",
        rpm: { packageName: "novaway-dev" },
      }
    }
    case "beta": {
      return {
        ...base,
        appId: "ai.novaway.desktop.beta",
        productName: "NovaWay Beta",
        protocols: { name: "NovaWay Beta", schemes: ["novaway"] },
        publish: selfPublish ?? { provider: "github", owner: "anomalyco", repo: "novaway-beta", channel: "latest" },
        rpm: { packageName: "novaway-beta" },
      }
    }
    case "prod": {
      return {
        ...base,
        appId: "ai.novaway.desktop",
        productName: "NovaWay",
        protocols: { name: "NovaWay", schemes: ["novaway"] },
        publish: selfPublish ?? { provider: "github", owner: "anomalyco", repo: "novaway", channel: "latest" },
        rpm: { packageName: "novaway" },
      }
    }
  }
}

export default getConfig()
