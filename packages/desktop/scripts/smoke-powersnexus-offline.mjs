#!/usr/bin/env node
/**
 * Windows 离线冒烟兼容入口 → 可移植脚本
 */
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const target = path.join(here, "smoke-powersnexus-package-offline.mjs")
const r = spawnSync(process.execPath, [target, "--platform=win32", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
})
process.exit(r.status ?? 1)
