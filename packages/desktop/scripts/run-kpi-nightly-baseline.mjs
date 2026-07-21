#!/usr/bin/env node
/**
 * PowersNexus 7 天 KPI 夜间基线
 *
 * 用法：
 *   bun packages/desktop/scripts/run-kpi-nightly-baseline.mjs
 *   bun packages/desktop/scripts/run-kpi-nightly-baseline.mjs --summary-only
 *   bun packages/desktop/scripts/run-kpi-nightly-baseline.mjs --json
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { spawnSync } from "node:child_process"
import os from "node:os"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const desktopRoot = path.resolve(__dirname, "..")
const repoRoot = path.resolve(desktopRoot, "../..")
const opencodeRoot = path.join(repoRoot, "packages/opencode")
const kpiDir = path.join(repoRoot, ".codex", "powersnexus-kpi")

const summaryOnly = process.argv.includes("--summary-only")
const jsonMode = process.argv.includes("--json")
const day = (process.env.POWERSNEXUS_KPI_DAY || new Date().toISOString().slice(0, 10)).slice(0, 10)

function resolveBun() {
  if (process.env.BUN_PATH && existsSync(process.env.BUN_PATH)) return process.env.BUN_PATH
  const home = process.env.USERPROFILE || process.env.HOME || ""
  const p = path.join(home, ".bun", "bin", process.platform === "win32" ? "bun.exe" : "bun")
  return existsSync(p) ? p : "bun"
}

const bun = resolveBun()

function run(command, args, cwd, timeout = 300000, env = process.env) {
  const started = Date.now()
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env, timeout, shell: false })
  const ms = Date.now() - started
  const detail = `${result.stdout || ""}\n${result.stderr || ""}`.trim()
  if (result.error) return { ok: false, ms, detail: result.error.message, code: -1 }
  return { ok: result.status === 0, ms, detail: detail.slice(-2000), code: result.status ?? 1 }
}

function probe(id, title, kpi, required, fn) {
  const started = Date.now()
  try {
    const r = fn()
    return {
      id,
      title,
      kpi,
      required,
      ok: !!r.ok,
      skipped: !!r.skipped,
      ms: r.ms ?? Date.now() - started,
      detail: r.detail || "",
      code: r.code,
    }
  } catch (err) {
    return {
      id,
      title,
      kpi,
      required,
      ok: false,
      skipped: false,
      ms: Date.now() - started,
      detail: err instanceof Error ? err.message : String(err),
    }
  }
}

async function runDayProbes() {
  const probes = []

  probes.push(
    probe("P01", "打包资源预检", "powersnexus_load_success", true, () => {
      const r = run(process.execPath, [path.join(desktopRoot, "scripts/verify-powersnexus-packaging.mjs")], desktopRoot, 60000)
      return { ok: r.ok, ms: r.ms, detail: r.ok ? "packaging preflight ok" : r.detail, code: r.code }
    }),
  )

  probes.push(
    probe("P02", "stable 门禁默认 bundled 安全", "stable_gate_safe_default", true, () => {
      const r = run(bun, [path.join(desktopRoot, "scripts/check-stable-production-gate.mjs")], repoRoot, 60000)
      // exit 2 = not ready for stable under bundled → expected success for safety KPI
      const safe = r.code === 2 || (r.detail.includes("ready=false") && r.detail.includes("bundled"))
      return { ok: safe || r.ok, ms: r.ms, detail: safe ? "default bundled gate rejects stable" : r.detail, code: r.code }
    }),
  )

  probes.push(
    probe("P03", "本地 stable 闭环 harness", "e2e_local_delivery_success", true, () => {
      const exportRoot = path.join(os.tmpdir(), "powersnexus-kpi-stable-local")
      mkdirSync(exportRoot, { recursive: true })
      const r = run(
        bun,
        ["test", "test/powersnexus/stable-local-harness.test.ts", "--timeout", "60000"],
        opencodeRoot,
        120000,
      )
      return { ok: r.ok, ms: r.ms, detail: r.ok ? "stable-local pass" : r.detail, code: r.code }
    }),
  )

  probes.push(
    probe("P04", "isolation + runner 对抗/恢复", "permission_and_recovery", true, () => {
      const isolation = run(
        bun,
        ["test", "test/powersnexus/isolation.test.ts", "--timeout", "90000"],
        opencodeRoot,
        120000,
      )
      if (!isolation.ok) return isolation
      const runner = run(
        bun,
        ["test", "test/powersnexus/runner.test.ts", "--timeout", "90000"],
        opencodeRoot,
        120000,
        { ...process.env, POWERSNEXUS_OS_ISOLATION: "0" },
      )
      return {
        ok: runner.ok,
        ms: isolation.ms + runner.ms,
        detail: runner.ok ? "isolation/runner sequential pass" : runner.detail,
        code: runner.code,
      }
    }),
  )

  probes.push(
    probe("P05", "本机离线包 smoke（可移植）", "powersnexus_load_success", false, () => {
      const r = run(
        process.execPath,
        [path.join(desktopRoot, "scripts/smoke-powersnexus-package-offline.mjs"), `--platform=${process.platform}`],
        desktopRoot,
        120000,
      )
      if (r.code === 3) return { ok: true, skipped: true, ms: r.ms, detail: "no package artifacts (skip)", code: 3 }
      return { ok: r.ok, ms: r.ms, detail: r.ok ? "package offline smoke pass" : r.detail, code: r.code }
    }),
  )

  probes.push(
    probe("P06", "config 门禁单测", "stable_gate_safe_default", true, () => {
      const r = run(bun, ["test", "test/powersnexus/config-release-urls.test.ts", "--timeout", "30000"], opencodeRoot, 60000)
      return { ok: r.ok, ms: r.ms, detail: r.ok ? "config gate tests pass" : r.detail, code: r.code }
    }),
  )

  // performance micro probe
  let gateMs = null
  try {
    const mod = await import(pathToFileURL(path.join(opencodeRoot, "src/config/powersnexus.ts")).href)
    const t0 = Date.now()
    mod.evaluateStableProductionGate({ policy: "bundled" })
    gateMs = Date.now() - t0
    probes.push({
      id: "P07",
      title: "门禁评估耗时",
      kpi: "perf_gate_eval",
      required: false,
      ok: gateMs < 200,
      skipped: false,
      ms: gateMs,
      detail: `evaluateStableProductionGate wall=${gateMs}ms (threshold 200ms local)`,
    })
  } catch (err) {
    probes.push({
      id: "P07",
      title: "门禁评估耗时",
      kpi: "perf_gate_eval",
      required: false,
      ok: false,
      skipped: false,
      ms: 0,
      detail: err instanceof Error ? err.message : String(err),
    })
  }

  const required = probes.filter((p) => p.required)
  const requiredFailed = required.filter((p) => !p.ok && !p.skipped)
  const dayRecord = {
    day,
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    bun,
    probes,
    kpis: {
      powersnexus_load_success: rate(probes.filter((p) => p.kpi === "powersnexus_load_success")),
      severe_permission_violations: probes.some((p) => p.id === "P04" && !p.ok) ? 1 : 0,
      e2e_local_delivery_success: rate(probes.filter((p) => p.kpi === "e2e_local_delivery_success")),
      stable_gate_safe_default: rate(probes.filter((p) => p.kpi === "stable_gate_safe_default")),
      permission_and_recovery: rate(probes.filter((p) => p.kpi === "permission_and_recovery")),
      unattended_handoff_proxy: requiredFailed.length === 0 ? 1 : 0,
    },
    day_pass: requiredFailed.length === 0,
    totals: {
      pass: probes.filter((p) => p.ok && !p.skipped).length,
      fail: probes.filter((p) => !p.ok && !p.skipped).length,
      skip: probes.filter((p) => p.skipped).length,
      required_fail: requiredFailed.length,
    },
  }
  return dayRecord
}

function rate(items) {
  const usable = items.filter((i) => !i.skipped)
  if (!usable.length) return null
  return usable.filter((i) => i.ok).length / usable.length
}

function loadDay(dayKey) {
  const file = path.join(kpiDir, `${dayKey}.json`)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, "utf8"))
  } catch {
    return null
  }
}

function listDays() {
  if (!existsSync(kpiDir)) return []
  return readdirSync(kpiDir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.replace(/\.json$/, ""))
    .sort()
}

function lastNDays(n, endDay = day) {
  const end = new Date(endDay + "T00:00:00.000Z")
  const out = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(end)
    d.setUTCDate(end.getUTCDate() - i)
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

function summarize7d(endDay = day) {
  const days = lastNDays(7, endDay)
  const records = days.map((d) => ({ day: d, record: loadDay(d) }))
  const present = records.filter((r) => r.record)
  const missing_days = records.filter((r) => !r.record).map((r) => r.day)

  const avg = (getter) => {
    const vals = present.map((r) => getter(r.record)).filter((v) => typeof v === "number")
    if (!vals.length) return null
    return vals.reduce((a, b) => a + b, 0) / vals.length
  }

  const dayPassRate = present.length
    ? present.filter((r) => r.record.day_pass).length / present.length
    : null

  const thresholds = {
    powersnexus_load_success: 1.0,
    e2e_local_delivery_success: 0.85,
    permission_and_recovery: 1.0,
    stable_gate_safe_default: 1.0,
    unattended_handoff_proxy: 0.9,
    severe_permission_violations_max: 0,
  }

  const kpiAverages = {
    powersnexus_load_success: avg((r) => r.kpis.powersnexus_load_success),
    e2e_local_delivery_success: avg((r) => r.kpis.e2e_local_delivery_success),
    permission_and_recovery: avg((r) => r.kpis.permission_and_recovery),
    stable_gate_safe_default: avg((r) => r.kpis.stable_gate_safe_default),
    unattended_handoff_proxy: avg((r) => r.kpis.unattended_handoff_proxy),
    severe_permission_violations: avg((r) => r.kpis.severe_permission_violations),
    day_pass_rate: dayPassRate,
  }

  const meets = {
    powersnexus_load_success:
      kpiAverages.powersnexus_load_success == null
        ? null
        : kpiAverages.powersnexus_load_success >= thresholds.powersnexus_load_success,
    e2e_local_delivery_success:
      kpiAverages.e2e_local_delivery_success == null
        ? null
        : kpiAverages.e2e_local_delivery_success >= thresholds.e2e_local_delivery_success,
    permission_and_recovery:
      kpiAverages.permission_and_recovery == null
        ? null
        : kpiAverages.permission_and_recovery >= thresholds.permission_and_recovery,
    stable_gate_safe_default:
      kpiAverages.stable_gate_safe_default == null
        ? null
        : kpiAverages.stable_gate_safe_default >= thresholds.stable_gate_safe_default,
    unattended_handoff_proxy:
      kpiAverages.unattended_handoff_proxy == null
        ? null
        : kpiAverages.unattended_handoff_proxy >= thresholds.unattended_handoff_proxy,
    severe_permission_violations:
      kpiAverages.severe_permission_violations == null
        ? null
        : kpiAverages.severe_permission_violations <= thresholds.severe_permission_violations_max,
  }

  const known = Object.values(meets).filter((v) => v !== null)
  const allKnownMet = known.length > 0 && known.every(Boolean)

  return {
    generatedAt: new Date().toISOString(),
    window_days: days,
    present_days: present.map((r) => r.day),
    missing_days,
    thresholds,
    kpiAverages,
    meets,
    ready_for_release_proxy: allKnownMet && missing_days.length === 0,
    note:
      missing_days.length > 0
        ? "近 7 天有缺测日，不得宣称 7 日 KPI 达标"
        : allKnownMet
          ? "近 7 天代理 KPI 达标（仍需真实样本集补强）"
          : "近 7 天代理 KPI 未全部达标",
  }
}

function writeSummaryMarkdown(summary) {
  const lines = [
    `# PowersNexus KPI 近 7 日汇总`,
    ``,
    `生成时间：${summary.generatedAt}`,
    ``,
    `窗口：${summary.window_days[0]} ~ ${summary.window_days[summary.window_days.length - 1]}`,
    ``,
    `有数据日：${summary.present_days.join(", ") || "（无）"}`,
    ``,
    `缺测日：${summary.missing_days.join(", ") || "（无）"}`,
    ``,
    `| KPI 代理 | 均值 | 门槛 | 是否达标 |`,
    `|----------|------|------|----------|`,
  ]
  const rows = [
    ["powersnexus_load_success", summary.kpiAverages.powersnexus_load_success, "100%", summary.meets.powersnexus_load_success],
    ["e2e_local_delivery_success", summary.kpiAverages.e2e_local_delivery_success, "≥85%", summary.meets.e2e_local_delivery_success],
    ["permission_and_recovery", summary.kpiAverages.permission_and_recovery, "100%", summary.meets.permission_and_recovery],
    ["stable_gate_safe_default", summary.kpiAverages.stable_gate_safe_default, "100%", summary.meets.stable_gate_safe_default],
    ["unattended_handoff_proxy", summary.kpiAverages.unattended_handoff_proxy, "≥90%", summary.meets.unattended_handoff_proxy],
    ["severe_permission_violations", summary.kpiAverages.severe_permission_violations, "0", summary.meets.severe_permission_violations],
    ["day_pass_rate", summary.kpiAverages.day_pass_rate, "趋势", null],
  ]
  for (const [name, val, thr, meet] of rows) {
    const v = val == null ? "n/a" : typeof val === "number" ? (name.includes("violations") ? String(val) : `${(val * 100).toFixed(1)}%`) : String(val)
    const m = meet == null ? "-" : meet ? "YES" : "NO"
    lines.push(`| ${name} | ${v} | ${thr} | ${m} |`)
  }
  lines.push(``)
  lines.push(`结论：${summary.note}`)
  lines.push(``)
  lines.push(`ready_for_release_proxy=${summary.ready_for_release_proxy}`)
  return lines.join("\n")
}

mkdirSync(kpiDir, { recursive: true })

let dayRecord = loadDay(day)
if (!summaryOnly) {
  dayRecord = await runDayProbes()
  writeFileSync(path.join(kpiDir, `${day}.json`), JSON.stringify(dayRecord, null, 2))
}

const summary = summarize7d(day)
writeFileSync(path.join(kpiDir, "summary-7d-latest.json"), JSON.stringify(summary, null, 2))
const md = writeSummaryMarkdown(summary)
writeFileSync(path.join(kpiDir, "summary-7d-latest.md"), md)

if (jsonMode) {
  console.log(JSON.stringify({ day: dayRecord, summary }, null, 2))
} else {
  if (!summaryOnly && dayRecord) {
    console.log(`[kpi-nightly] day=${day} platform=${process.platform}`)
    for (const p of dayRecord.probes) {
      const st = p.skipped ? "SKIP" : p.ok ? "PASS" : "FAIL"
      const req = p.required ? "REQ" : "OPT"
      console.log(`${st} [${req}] ${p.id} ${p.title} — ${String(p.detail).split("\n")[0]} (${p.ms}ms)`)
    }
    console.log(
      `day_pass=${dayRecord.day_pass} pass=${dayRecord.totals.pass} fail=${dayRecord.totals.fail} skip=${dayRecord.totals.skip}`,
    )
  }
  console.log("\n" + md)
  console.log(`\n记录目录: ${kpiDir}`)
}

if (!summaryOnly && dayRecord && !dayRecord.day_pass) process.exit(1)
process.exit(0)
