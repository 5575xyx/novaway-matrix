#!/usr/bin/env node
/**
 * 本地签名 stable 发布联调入口。
 * - 不修改生产默认 bundled 策略
 * - 使用临时密钥，禁止当作生产发布
 *
 * 用法：
 *   node packages/desktop/scripts/run-stable-local-harness.mjs
 *   或：cd packages/opencode && bun run test:stable-local
 */
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { existsSync, mkdirSync } from "node:fs"

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const exportRoot = process.env.POWERSNEXUS_STABLE_LOCAL_ROOT || path.join("E:\\tmp", "powersnexus-stable-local")
mkdirSync(exportRoot, { recursive: true })

function resolveBun() {
  if (process.env.BUN_PATH && existsSync(process.env.BUN_PATH)) return process.env.BUN_PATH
  const home = process.env.USERPROFILE || process.env.HOME || ""
  const win = process.platform === "win32"
  const candidates = [
    path.join(home, ".bun", "bin", win ? "bun.exe" : "bun"),
    path.join(home, "AppData", "Local", "bun", "bin", win ? "bun.exe" : "bun"),
  ]
  for (const item of candidates) {
    if (existsSync(item)) return item
  }
  return "bun"
}

const bun = resolveBun()
const env = {
  ...process.env,
  POWERSNEXUS_STABLE_LOCAL_ROOT: exportRoot,
  TEMP: process.env.TEMP || "E:\\tmp\\opencode-temp",
  TMP: process.env.TMP || "E:\\tmp\\opencode-temp",
}

console.log(`[stable-local] bun=${bun}`)
console.log(`[stable-local] exportRoot=${exportRoot}`)
console.log("[stable-local] running harness tests...")

const result = spawnSync(
  bun,
  ["test", "test/powersnexus/stable-local-harness.test.ts", "--timeout", "60000"],
  {
    cwd: path.join(repo, "packages/opencode"),
    env,
    encoding: "utf8",
    shell: false,
  },
)

if (result.stdout) process.stdout.write(result.stdout)
if (result.stderr) process.stderr.write(result.stderr)

if (result.error) {
  console.error("[stable-local] spawn error:", result.error.message || result.error)
  console.error("[stable-local] 请手动执行：")
  console.error(`  cd packages/opencode`)
  console.error(`  $env:POWERSNEXUS_STABLE_LOCAL_ROOT="${exportRoot}"`)
  console.error(`  bun run test:stable-local`)
  process.exit(1)
}

if (result.status !== 0) {
  console.error("[stable-local] FAILED status=", result.status)
  process.exit(result.status || 1)
}

console.log("[stable-local] PASSED")
console.log(`[stable-local] 产物目录: ${exportRoot}`)
console.log("[stable-local] 提醒: 生产默认策略仍为 bundled；真实 stable 需 HTTPS 签名端点与独立私钥。")
