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

// 包目录是 packages/novaway(小写 n)。写 ../NovaWay 在 Windows/macOS 的
// 大小写不敏感文件系统上碰巧能跑,在 Linux CI 上会直接 cd 失败。
// --env-file 显式指到仓库根的 .env.local(相对 packages/novaway 就是 ../../.env.local):
// bun 的 .env 自动加载是按 cwd 找的,cd 进 packages/novaway 后够不到根目录的 .env.local,
// 导致 NOVAWAY_GATEWAY_EMBED_URL/KEY 为空、内置提供商不注册(Auto 模式失效)。
// CI 上该文件不存在也无妨:--env-file 找不到文件不报错,secrets 走 env 传入。
await $`cd ../novaway && bun --env-file=../../.env.local script/build-node.ts`

// 浏览器自动化 MCP 随安装包分发，避免打包后的桌面端依赖系统 npx 或联网拉取。
const playwrightMcpDir = join(resourcesDir, "playwright-mcp")
const playwrightMcpCli = join(playwrightMcpDir, "node_modules", "@playwright", "mcp", "cli.js")
if (!existsSync(playwrightMcpCli)) {
  console.log("Installing bundled Playwright MCP")
  await $`bun install --cwd ${playwrightMcpDir}`
}

// 随包的 Playwright MCP 与插件 CLI 需要一个独立的 Node.js 运行时（Electron 自带的
// Node 是另一个进程模型，不能直接复用）。这里下载与构建机同版本的官方分发版放进
// resources/node，供 config/defaults 里的 MCP 命令当解释器使用。
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
  // Windows 有两个坑:Git Bash 的 GNU tar 把 "D:\..." 绝对路径当 remote-host:path
  // (Cannot connect to D:)，而且它解不了 zip —— Node 的 win 分发包恰恰是 .zip。
  // System32 自带的 tar 是 bsdtar，zip 和冒号都没问题，显式指过去。
  if (isWin) {
    await $`cd ${extractDir} && ${"C:/Windows/System32/tar.exe"} -xf ${`../${filename}`}`
  } else {
    await $`cd ${extractDir} && tar -xzf ${`../${filename}`}`
  }

  const entries = readdirSync(extractDir).filter((entry) => entry.startsWith(`node-v${NODE_VERSION}`))
  if (entries.length !== 1) throw new Error(`Unexpected Node.js archive contents: ${entries.join(", ")}`)

  renameSync(join(extractDir, entries[0]), nodeDir)
  rmSync(tmpDir, { recursive: true, force: true })

  console.log(`Node.js ${NODE_VERSION} extracted to ${nodeDir}`)
}

/**
 * 剪掉随包 Node.js 里用不到的部分。
 *
 * npm / npx 以前被删掉（约 13 MB），只把 Node 当解释器用。但用户机器上常常
 * 没有 Node，默认 MCP 服务器（context7 / memory / sequential-thinking）都写成
 * `npx -y <pkg>`，删了 npm 它们就全部连不上。现在保留 npm/npx，只删 corepack：
 * 内核在 MCP 启动时用内置 Node 跑 `npm/bin/npx-cli.js`（见 src/mcp/runtime.ts），
 * 用户自己的 npx 仍然优先。
 */
function trimNodeRuntime() {
  const nodeDir = join(resourcesDir, "node")
  const isWin = process.platform === "win32"
  const npmDir = isWin ? join(nodeDir, "node_modules") : join(nodeDir, "lib", "node_modules")
  const drop = (target: string) => {
    if (!existsSync(target)) return
    rmSync(target, { recursive: true, force: true })
  }
  drop(join(npmDir, "corepack"))
  drop(join(nodeDir, "corepack"))
  drop(join(nodeDir, "corepack.cmd"))
  drop(join(nodeDir, "bin", "corepack"))
  const npmKept = existsSync(join(npmDir, "npm", "bin", "npx-cli.js"))
  console.log(
    npmKept
      ? "Trimmed bundled Node.js runtime (removed corepack; kept npm/npx for MCP fallback)"
      : "WARNING: bundled Node.js has no npm/npx; local MCP servers using npx will need a system Node.js",
  )
}

// 随包分发的 Node.js 默认取构建机自身平台;CI 上在 arm64 mac 交叉打 x64 包时
// (Intel runner 已收费),用 NOVAWAY_DESKTOP_NODE_ARCH=x64 指定目标架构,
// 这样下载到的 node.exe 才是目标架构。
const nodeTarget = (() => {
  const override = process.env.NOVAWAY_DESKTOP_NODE_ARCH
  if (!override) return getNodeTarget()
  const target = NODE_TARGETS.find((t) => t.platform === process.platform && t.arch === override)
  if (!target) throw new Error(`Unsupported NOVAWAY_DESKTOP_NODE_ARCH: ${override}`)
  return target
})()

await downloadNodeBinary(nodeTarget)
trimNodeRuntime()
