#!/usr/bin/env node
/**
 * PowersNexus stable 生产启用门禁检查。
 *
 * 推荐：
 *   bun packages/desktop/scripts/check-stable-production-gate.mjs
 *   bun packages/desktop/scripts/check-stable-production-gate.mjs --json
 */
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { existsSync } from "node:fs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(__dirname, "../../..")
const jsonMode = process.argv.includes("--json")

function splitCsv(value) {
  return (value || "")
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

const tsPath = path.join(repo, "packages/opencode/src/config/powersnexus.ts")
const mod = await import(pathToFileURL(tsPath).href)
const { evaluateStableProductionGate } = mod

const policy = process.env.POWERSNEXUS_UPDATE_POLICY || "bundled"
const releaseManifestUrls = splitCsv(process.env.POWERSNEXUS_RELEASE_MANIFEST_URLS)
const releaseAllowedHosts = splitCsv(process.env.POWERSNEXUS_RELEASE_ALLOWED_HOSTS)
const defaultKey = path.join(repo, "packages/desktop/resources/powersnexus-release-public-key.pem")
const publicKeyPath = process.env.POWERSNEXUS_RELEASE_PUBLIC_KEY || (existsSync(defaultKey) ? defaultKey : undefined)
const keyID = process.env.POWERSNEXUS_RELEASE_KEY_ID || ""

const report = evaluateStableProductionGate({
  policy,
  releaseManifestUrls,
  releaseAllowedHosts,
  publicKeyPath,
  keyID,
  allowLocalEndpoints: process.env.POWERSNEXUS_ALLOW_LOCAL_STABLE === "1",
})

if (jsonMode) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`[stable-gate] policy=${report.policy} effective=${report.effectivePolicy} ready=${report.ready}`)
  for (const check of report.checks) {
    console.log(`${check.ok ? "PASS" : "FAIL"} [${check.required ? "REQ" : "OPT"}] ${check.title} — ${check.detail}`)
  }
  if (report.blockers.length) {
    console.log("\n阻塞项：")
    for (const b of report.blockers) console.log(`- ${b}`)
  }
  console.log(
    report.ready
      ? "\n结论：生产 stable 配置门禁通过（仍需三平台升级 E2E 后灰度）。"
      : "\n结论：不得启用生产 stable，请保持 bundled。",
  )
}

process.exit(report.ready ? 0 : 2)
