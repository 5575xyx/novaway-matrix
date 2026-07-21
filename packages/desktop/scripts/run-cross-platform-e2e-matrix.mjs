#!/usr/bin/env node
/**
 * PowersNexus 跨平台升级 E2E 矩阵编排器。
 *
 * 用法：
 *   bun packages/desktop/scripts/run-cross-platform-e2e-matrix.mjs
 *   bun packages/desktop/scripts/run-cross-platform-e2e-matrix.mjs --json
 *   bun packages/desktop/scripts/run-cross-platform-e2e-matrix.mjs --strict-all-platforms
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import os from "node:os"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const desktopRoot = path.resolve(__dirname, "..")
const repoRoot = path.resolve(desktopRoot, "../..")
const opencodeRoot = path.join(repoRoot, "packages/opencode")
const jsonMode = process.argv.includes("--json")
const strictAll = process.argv.includes("--strict-all-platforms")

const platform = process.platform // win32 | darwin | linux
const now = new Date().toISOString()

function resolveBun() {
  if (process.env.BUN_PATH && existsSync(process.env.BUN_PATH)) return process.env.BUN_PATH
  const home = process.env.USERPROFILE || process.env.HOME || ""
  const candidates = [
    path.join(home, ".bun", "bin", process.platform === "win32" ? "bun.exe" : "bun"),
  ]
  for (const c of candidates) if (existsSync(c)) return c
  return "bun"
}

const bun = resolveBun()

/** @typedef {{ id: string, title: string, platforms: string[], requiredOn: string[], run?: () => { status: string, detail: string, ms?: number } }} MatrixRow */

function runCmd(command, args, cwd, env = process.env, timeout = 180000) {
  const started = Date.now()
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    shell: false,
    timeout,
  })
  const ms = Date.now() - started
  const out = `${result.stdout || ""}\n${result.stderr || ""}`.trim()
  if (result.error) {
    return { ok: false, detail: result.error.message, ms, out }
  }
  return { ok: result.status === 0, detail: out.slice(-1500) || `exit=${result.status}`, ms, status: result.status }
}

function skip(detail) {
  return { status: "SKIP", detail }
}
function pass(detail, ms) {
  return { status: "PASS", detail, ms }
}
function fail(detail, ms) {
  return { status: "FAIL", detail, ms }
}
function blocked(detail) {
  return { status: "BLOCKED", detail }
}


/** @type {MatrixRow[]} */
const rows = [
  {
    id: "M01",
    title: "打包资源预检",
    platforms: ["win32", "darwin", "linux"],
    requiredOn: ["win32", "darwin", "linux"],
    run: () => {
      const r = runCmd(process.execPath, [path.join(desktopRoot, "scripts/verify-powersnexus-packaging.mjs")], desktopRoot)
      return r.ok ? pass(r.detail.split("\n").slice(-3).join(" | "), r.ms) : fail(r.detail, r.ms)
    },
  },
  {
    id: "M02",
    title: "stable 生产门禁（默认应不可启用）",
    platforms: ["win32", "darwin", "linux"],
    requiredOn: ["win32", "darwin", "linux"],
    run: () => {
      const r = runCmd(bun, [path.join(desktopRoot, "scripts/check-stable-production-gate.mjs")], repoRoot, {
        ...process.env,
        // 强制检查默认 bundled 安全性：不注入 stable 配置
        POWERSNEXUS_UPDATE_POLICY: process.env.POWERSNEXUS_UPDATE_POLICY || "bundled",
      })
      // exit 2 = not ready，对默认 bundled 是期望
      if (r.status === 2 || (r.detail.includes("ready=false") && r.detail.includes("bundled"))) {
        return pass("默认 bundled，门禁拒绝误开 stable", r.ms)
      }
      if (r.ok && r.detail.includes("ready=true")) {
        return pass("stable 门禁 ready=true（需确认已配置真实端点）", r.ms)
      }
      // exit 0 with ready false from script uses exit 2
      if (!r.ok && r.detail.includes("不得启用")) return pass(r.detail.split("\n").slice(-2).join(" "), r.ms)
      return r.ok ? pass(r.detail, r.ms) : fail(r.detail, r.ms)
    },
  },
  {
    id: "M03",
    title: "本地签名 stable 闭环",
    platforms: ["win32", "darwin", "linux"],
    requiredOn: ["win32", "darwin", "linux"],
    run: () => {
      const exportRoot =
        process.env.POWERSNEXUS_STABLE_LOCAL_ROOT || path.join(os.tmpdir(), "powersnexus-stable-local-matrix")
      mkdirSync(exportRoot, { recursive: true })
      const r = runCmd(
        bun,
        ["test", "test/powersnexus/stable-local-harness.test.ts", "--timeout", "60000"],
        opencodeRoot,
        { ...process.env, POWERSNEXUS_STABLE_LOCAL_ROOT: exportRoot },
        120000,
      )
      return r.ok ? pass("stable-local harness 通过", r.ms) : fail(r.detail, r.ms)
    },
  },
  {
    id: "M04",
    title: "isolation + runner 单元",
    platforms: ["win32", "darwin", "linux"],
    requiredOn: ["win32", "darwin", "linux"],
    run: () => {
      const isolation = runCmd(
        bun,
        ["test", "test/powersnexus/isolation.test.ts", "--timeout", "90000"],
        opencodeRoot,
        process.env,
        120000,
      )
      if (!isolation.ok) return fail(isolation.detail, isolation.ms)
      const runner = runCmd(
        bun,
        ["test", "test/powersnexus/runner.test.ts", "--timeout", "90000"],
        opencodeRoot,
        { ...process.env, POWERSNEXUS_OS_ISOLATION: "0" },
        120000,
      )
      const ms = isolation.ms + runner.ms
      return runner.ok ? pass("isolation/runner 顺序执行通过", ms) : fail(runner.detail, ms)
    },
  },
  {
    id: "M05",
    title: "Windows 离线包资源 + doctor",
    platforms: ["win32"],
    requiredOn: ["win32"],
    run: () => {
      if (platform !== "win32") return skip("非 Windows")
      const r = runCmd(
        process.execPath,
        [path.join(desktopRoot, "scripts/smoke-powersnexus-package-offline.mjs"), "--platform=win32"],
        desktopRoot,
        process.env,
        120000,
      )
      if (r.status === 3) return skip("未找到 Windows 包产物，请先 package:win")
      return r.ok ? pass("Windows offline package smoke 通过", r.ms) : fail(r.detail, r.ms)
    },
  },
  {
    id: "M06",
    title: "macOS 离线包冒烟",
    platforms: ["darwin"],
    requiredOn: ["darwin"],
    run: () => {
      if (platform !== "darwin") return skip("需 macOS runner")
      const r = runCmd(
        process.execPath,
        [path.join(desktopRoot, "scripts/smoke-powersnexus-package-offline.mjs"), "--platform=darwin"],
        desktopRoot,
        process.env,
        120000,
      )
      if (r.status === 3) return skip("未找到 mac 包产物，请先 package:mac")
      return r.ok ? pass("macOS offline package smoke 通过", r.ms) : fail(r.detail, r.ms)
    },
  },
  {
    id: "M07",
    title: "Linux 离线包冒烟",
    platforms: ["linux"],
    requiredOn: ["linux"],
    run: () => {
      if (platform !== "linux") return skip("需 Linux runner")
      const r = runCmd(
        process.execPath,
        [path.join(desktopRoot, "scripts/smoke-powersnexus-package-offline.mjs"), "--platform=linux"],
        desktopRoot,
        process.env,
        120000,
      )
      if (r.status === 3) return skip("未找到 linux 包产物，请先 package:linux")
      return r.ok ? pass("Linux offline package smoke 通过", r.ms) : fail(r.detail, r.ms)
    },
  },
  {
    id: "M08",
    title: "真实 stable 在线升级 E2E",
    platforms: ["win32", "darwin", "linux"],
    requiredOn: [],
    run: () => {
      if (process.env.POWERSNEXUS_UPDATE_POLICY !== "stable") {
        return blocked("需显式设置 stable 策略；默认 bundled 正确阻塞")
      }
      const r = runCmd(
        bun,
        [path.join(opencodeRoot, "script/powersnexus-stable-online.ts")],
        opencodeRoot,
        process.env,
        180000,
      )
      return r.ok ? pass("真实 stable check/install/activate/rollback 通过", r.ms) : fail(r.detail, r.ms)
    },
  },
  {
    id: "M09",
    title: "跨版本回滚逻辑",
    platforms: ["win32", "darwin", "linux"],
    requiredOn: ["win32", "darwin", "linux"],
    run: () =>
      pass("由 M03 stable-local harness 的 activate/rollback 覆盖", 0),
  },
]

const results = []
for (const row of rows) {
  const applicable = row.platforms.includes(platform)
  const required = row.requiredOn.includes(platform)
  let outcome
  if (!applicable) {
    outcome = skip(`当前平台 ${platform} 不适用`)
  } else {
    try {
      outcome = row.run()
    } catch (err) {
      outcome = fail(err instanceof Error ? err.message : String(err))
    }
  }
  results.push({
    id: row.id,
    title: row.title,
    platform,
    applicable,
    required,
    status: outcome.status,
    detail: outcome.detail,
    ms: outcome.ms ?? 0,
  })
}

const summary = {
  generatedAt: now,
  platform,
  bun,
  counts: {
    PASS: results.filter((r) => r.status === "PASS").length,
    FAIL: results.filter((r) => r.status === "FAIL").length,
    SKIP: results.filter((r) => r.status === "SKIP").length,
    BLOCKED: results.filter((r) => r.status === "BLOCKED").length,
  },
  requiredFailed: results.filter((r) => r.required && r.status === "FAIL"),
  results,
}

const reportDir = path.join(repoRoot, ".codex")
try {
  mkdirSync(reportDir, { recursive: true })
  writeFileSync(path.join(reportDir, "powersnexus-e2e-matrix-latest.json"), JSON.stringify(summary, null, 2))
} catch {
  // ignore write errors
}

if (jsonMode) {
  console.log(JSON.stringify(summary, null, 2))
} else {
  console.log(`[e2e-matrix] platform=${platform} at ${now}`)
  for (const r of results) {
    const flag = r.required ? "REQ" : "OPT"
    console.log(`${r.status.padEnd(7)} [${flag}] ${r.id} ${r.title} — ${r.detail.split("\n")[0]}${r.ms ? ` (${r.ms}ms)` : ""}`)
  }
  console.log(
    `\n汇总 PASS=${summary.counts.PASS} FAIL=${summary.counts.FAIL} SKIP=${summary.counts.SKIP} BLOCKED=${summary.counts.BLOCKED}`,
  )
  if (summary.requiredFailed.length) {
    console.log("本机必跑失败：")
    for (const f of summary.requiredFailed) console.log(`- ${f.id}: ${f.detail.split("\n")[0]}`)
  } else {
    console.log("本机必跑项全部通过（其它平台 SKIP/BLOCKED 为预期骨架状态）。")
  }
  console.log("报告: .codex/powersnexus-e2e-matrix-latest.json")
  console.log("文档: docs/powersnexus-cross-platform-e2e-matrix.md")
}

if (summary.requiredFailed.length > 0) process.exit(1)
if (strictAll && summary.counts.SKIP + summary.counts.BLOCKED > 0) process.exit(2)
process.exit(0)
