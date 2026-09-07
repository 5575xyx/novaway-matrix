#!/usr/bin/env bun
import { $ } from "bun"
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs"
import { join } from "node:path"

import { resolveChannel } from "./utils"

const tmp = join(process.cwd(), ".tmp")
mkdirSync(tmp, { recursive: true })
process.env.TMP = tmp
process.env.TEMP = tmp
process.env.TMPDIR = tmp

const channel = resolveChannel()
const resourcesDir = join(process.cwd(), "resources")
await $`bun ./scripts/copy-icons.ts ${channel}`
await $`bun ./scripts/copy-metainfo.ts ${channel}`

// 小心大小写:包目录是 packages/novaway(小写 n)。写 ../NovaWay 在 Windows/macOS 的
// 大小写不敏感文件系统上碰巧能跑,在 Linux CI 上会直接 cd 失败。
await $`cd ../novaway && bun script/build-node.ts`

// 浏览器自动化 MCP 随安装包分发，避免打包后的桌面端依赖系统 npx 或联网拉取。
const playwrightMcpDir = join(resourcesDir, "playwright-mcp")
const playwrightMcpCli = join(playwrightMcpDir, "node_modules", "@playwright", "mcp", "cli.js")
if (!existsSync(playwrightMcpCli)) {
  console.log("Installing bundled Playwright MCP")
  await $`bun install --cwd ${playwrightMcpDir}`
}

// DBX MCP Server(数据库面板的 MCP 后端)整个 resources/dbx-mcp 不进 git —— 本地 vendor 的
// node_modules 有 400+ MB(整仓依赖搬进来的),没法当源码提交。CI 全新 checkout 上这个目录
// 不存在,所以从 npm 还原同版本的官方 tarball,再只装运行时依赖;better-sqlite3/keytar 等
// 原生模块由下方 rebuildNativeModules 按随包分发的 Node.js ABI 重新编译。
const DBX_MCP_VERSION = "0.4.21"
const dbxMcpDir = join(resourcesDir, "dbx-mcp")
const dbxMcpEntry = join(dbxMcpDir, "dist", "index.js")
const dbxMcpTarballName = `dbx-app-mcp-server-${DBX_MCP_VERSION}.tgz`
if (!existsSync(dbxMcpEntry)) {
  console.log(`Vendoring bundled DBX MCP server @${DBX_MCP_VERSION} from npm`)
  await $`mkdir -p ${dbxMcpDir}`
  await $`npm pack @dbx-app/mcp-server@${DBX_MCP_VERSION} --pack-destination ${dbxMcpDir}`
  // Windows 的 GNU tar 会把 "D:\..." 开头的绝对路径当成 remote-host:path 解释
  // (报 "Cannot connect to D: resolve failed")，所以必须 cd 进目录用相对文件名解包。
  await $`cd ${dbxMcpDir} && tar -xzf ${dbxMcpTarballName} --strip-components=1`
  await $`cd ${dbxMcpDir} && rm -f ${dbxMcpTarballName}`
  await $`npm install --omit=dev --no-audit --no-fund`.cwd(dbxMcpDir)
}

// 打包环境下 DBX MCP Server 需要独立的 Node.js 运行时，避免 Electron ABI 与
// better-sqlite3/keytar 等原生模块不匹配。下面下载与当前构建机同版本的 Node.js
// 二进制分发版，将其放入 resources/node 并随 Electron 应用一起分发；同时用该
// Node.js 重新编译 dbx-mcp 的原生模块，确保 ABI 一致。
const NODE_VERSION = (await $`node --version`.text()).trim().slice(1)

const NODE_TARGETS: Array<{ platform: string; arch: string; nodeArch: string }> = [
  { platform: "darwin", arch: "arm64", nodeArch: "darwin-arm64" },
  { platform: "darwin", arch: "x64", nodeArch: "darwin-x64" },
  { platform: "win32", arch: "arm64", nodeArch: "win-arm64" },
  { platform: "win32", arch: "x64", nodeArch: "win-x64" },
  { platform: "linux", arch: "arm64", nodeArch: "linux-arm64" },
  { platform: "linux", arch: "x64", nodeArch: "linux-x64" },
]

function getNodeTarget() {
  const target = NODE_TARGETS.find((t) => t.platform === process.platform && t.arch === process.arch)
  if (!target) throw new Error(`Unsupported platform for bundled Node.js: ${process.platform}/${process.arch}`)
  return target
}

async function downloadNodeBinary(target: ReturnType<typeof getNodeTarget>) {
  const nodeDir = join(resourcesDir, "node")
  const tmpDir = join(process.cwd(), ".tmp", "node-download")

  mkdirSync(tmpDir, { recursive: true })
  if (existsSync(nodeDir)) rmSync(nodeDir, { recursive: true, force: true })

  const isWin = process.platform === "win32"
  const ext = isWin ? "zip" : "tar.gz"
  const filename = `node-v${NODE_VERSION}-${target.nodeArch}.${ext}`
  const url = `https://nodejs.org/dist/v${NODE_VERSION}/${filename}`
  const archivePath = join(tmpDir, filename)

  console.log(`Downloading Node.js ${NODE_VERSION} for ${target.nodeArch} from ${url}`)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`)

  const buffer = await response.arrayBuffer()
  await Bun.write(archivePath, buffer)

  const extractDir = join(tmpDir, "extracted")
  mkdirSync(extractDir, { recursive: true })
  // Windows 的 GNU tar 把 "D:\..." 绝对路径当 remote-host:path 解释(报 Cannot connect
  // to D:)，所以 cd 进解压目录、用相对路径指向上一层压缩包；bsdtar/GNU tar 都适用。
  if (isWin) {
    await $`cd ${extractDir} && tar -xf ${`../${filename}`}`
  } else {
    await $`cd ${extractDir} && tar -xzf ${`../${filename}`}`
  }

  const entries = readdirSync(extractDir).filter((entry) => entry.startsWith(`node-v${NODE_VERSION}`))
  if (entries.length !== 1) throw new Error(`Unexpected Node.js archive contents: ${entries.join(", ")}`)

  renameSync(join(extractDir, entries[0]), nodeDir)
  rmSync(tmpDir, { recursive: true, force: true })

  console.log(`Node.js ${NODE_VERSION} extracted to ${nodeDir}`)
}

async function rebuildNativeModules() {
  const resourcesDir = join(process.cwd(), "resources")
  const nodeDir = join(resourcesDir, "node")
  const dbxMcpDir = join(resourcesDir, "dbx-mcp")

  const isWin = process.platform === "win32"
  const nodeBin = isWin ? join(nodeDir, "node.exe") : join(nodeDir, "bin", "node")
  const npmCli = isWin
    ? join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js")
    : join(nodeDir, "lib", "node_modules", "npm", "bin", "npm-cli.js")

  if (!existsSync(nodeBin)) throw new Error(`Bundled Node.js binary not found: ${nodeBin}`)
  if (!existsSync(npmCli)) throw new Error(`Bundled npm-cli.js not found: ${npmCli}`)

  console.log("Rebuilding better-sqlite3 and keytar for bundled Node.js ABI")
  await $`${nodeBin} ${npmCli} rebuild better-sqlite3 keytar --prefix ${dbxMcpDir}`
  console.log("Native modules rebuilt")
}

// 随包分发的 Node.js 默认取构建机自身平台;CI 上在 arm64 mac 交叉打 x64 包时
// (Intel runner 已收费),用 NOVAWAY_DESKTOP_NODE_ARCH=x64 指定目标架构,
// 下面的 rebuildNativeModules 会用这个 x64 Node 重编出 x64 的原生模块。
const nodeTarget = (() => {
  const override = process.env.NOVAWAY_DESKTOP_NODE_ARCH
  if (!override) return getNodeTarget()
  const target = NODE_TARGETS.find((t) => t.platform === process.platform && t.arch === override)
  if (!target) throw new Error(`Unsupported NOVAWAY_DESKTOP_NODE_ARCH: ${override}`)
  return target
})()

await downloadNodeBinary(nodeTarget)
await rebuildNativeModules()
