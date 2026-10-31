#!/usr/bin/env node
/**
 * postinstall：修 node-pty 预编译产物的可执行位。
 *
 * 原来这一步写的是 `bun run --cwd packages/novaway fix-node-pty`（一个 .ts 脚本）。
 * 既然要让 pnpm / npm 也能装依赖，postinstall 就不能依赖 bun —— 纯 Node 实现，
 * 两个包管理器跑完安装都会走同一条路。
 */
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

// 与旧脚本一致：node-pty 装在 packages/novaway/node_modules 下。
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "packages", "novaway")
const prebuilds = path.join(root, "node_modules", "node-pty", "prebuilds")

if (process.platform !== "win32") {
  const entries = await fs.readdir(prebuilds, { withFileTypes: true }).catch(() => [])
  const files = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(prebuilds, entry.name, "spawn-helper"))
  const fixed = []
  for (const file of files) {
    const stat = await fs.stat(file).catch(() => undefined)
    if (!stat) continue
    if ((stat.mode & 0o111) === 0o111) continue
    await fs.chmod(file, stat.mode | 0o755)
    fixed.push(file)
  }
  if (fixed.length > 0) {
    console.log(`fixed node-pty permissions for ${fixed.length} helper${fixed.length === 1 ? "" : "s"}`)
  }
}
