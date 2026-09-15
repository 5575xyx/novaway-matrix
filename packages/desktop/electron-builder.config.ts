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

  await execFileAsync(
    "pwsh",
    ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", signScript, configuration.path],
    { cwd: rootDir },
  )
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
    "out/**/*",
    "resources/**/*",
    "!resources/dbx-mcp/node_modules{,/**/*}",
    "!resources/playwright-mcp/node_modules{,/**/*}",
  ],
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
      from: "resources/dbx-mcp/",
      to: "dbx-mcp/",
      filter: ["**/*", "!**/*.map"],
    },
    {
      from: "resources/playwright-mcp/",
      to: "playwright-mcp/",
      filter: ["**/*", "!**/*.map"],
    },
    {
      from: "resources/node/",
      to: "node/",
      filter: ["**/*"],
    },
  ],
  asarUnpack: [
    "resources/dbx-mcp/node_modules/better-sqlite3/**/*.node",
    "resources/dbx-mcp/node_modules/keytar/**/*.node",
  ],
  afterPack: async (context) => {
    const dbxMcpSrc = path.join(context.packager.projectDir, "resources", "dbx-mcp")
    const dbxMcpDest = path.join(context.appOutDir, "resources", "dbx-mcp")
    fs.cpSync(dbxMcpSrc, dbxMcpDest, { recursive: true, dereference: true, force: true })
    const playwrightMcpSrc = path.join(context.packager.projectDir, "resources", "playwright-mcp")
    const playwrightMcpDest = path.join(context.appOutDir, "resources", "playwright-mcp")
    fs.cpSync(playwrightMcpSrc, playwrightMcpDest, { recursive: true, dereference: true, force: true })
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
      // 把 Electron 自带的 ffmpeg.dll / vulkan-1.dll 等也签名,未签名 DLL 同样是
      // Windows Defender 隔离目标 —— 自签 + SHA256 + 时间戳即可大幅降低误报
      signDlls: true,
    },
    target: ["nsis"],
    verifyUpdateCodeSignature: false,
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    // perMachine=true 时安装到 Program Files,系统对该目录下的未签名 exe/DLL
    // 信任度仍低于已签名,但 UAC 提权的安装过程会让 Defender 走更宽松的策略;
    // 同时 perMachine=false 装到 %LocalAppData%\Programs 是 Defender 重点盯防区
    perMachine: false,
    allowElevation: true,
    // installer 申请管理员权限,确保能写到 Program Files / 写 HKLM 注册表项;
    // 非管理员运行时 NSIS 会自动请求提权,失败则提示用户
    requestedExecutionLevel: "requireAdministrator",
    installerIcon: `resources/icons/icon.ico`,
    installerHeaderIcon: `resources/icons/icon.ico`,
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
