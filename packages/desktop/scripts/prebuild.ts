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

await $`cd ../opencode && bun script/build-node.ts`

// 浏览器自动化 MCP 随安装包分发，避免打包后的桌面端依赖系统 npx 或联网拉取。
const playwrightMcpDir = join(resourcesDir, "playwright-mcp")
const playwrightMcpCli = join(playwrightMcpDir, "node_modules", "@playwright", "mcp", "cli.js")
if (!existsSync(playwrightMcpCli)) {
  console.log("Installing bundled Playwright MCP")
  await $`bun install --cwd ${playwrightMcpDir}`
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
  if (isWin) {
    await $`tar -xf ${archivePath} -C ${extractDir}`
  } else {
    await $`tar -xzf ${archivePath} -C ${extractDir}`
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

const nodeTarget = getNodeTarget()
await downloadNodeBinary(nodeTarget)
await rebuildNativeModules()
