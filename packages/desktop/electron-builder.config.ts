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
    signtoolOptions: {
      sign: signWindows,
    },
    target: ["nsis"],
    verifyUpdateCodeSignature: false,
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    perMachine: false,
    installerIcon: `resources/icons/icon.ico`,
    installerHeaderIcon: `resources/icons/icon.ico`,
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
