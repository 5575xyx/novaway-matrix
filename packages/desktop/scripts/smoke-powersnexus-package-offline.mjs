#!/usr/bin/env node
/**
 * 可移植 PowersNexus 离线包冒烟：校验包内公钥/基线 digest，解压 ZIP 并跑 doctor。
 *
 * 用法：
 *   bun packages/desktop/scripts/smoke-powersnexus-package-offline.mjs
 *   bun packages/desktop/scripts/smoke-powersnexus-package-offline.mjs --platform=win32
 *   bun packages/desktop/scripts/smoke-powersnexus-package-offline.mjs --resources=<path>
 *
 * 退出码：0 通过；1 失败；3 未找到本机包产物（可被矩阵解释为 SKIP）
 */
import { existsSync, readdirSync, readFileSync, statSync, mkdtempSync, rmSync, mkdirSync } from "node:fs"
import { createHash } from "node:crypto"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import os from "node:os"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const desktopRoot = path.resolve(__dirname, "..")
const EXPECTED_DIGEST = "4c1915d9506492b71a7026c013849e32223201e2aeba121c0aadaeffae72afd2"

const args = process.argv.slice(2)
const argPlatform = args.find((a) => a.startsWith("--platform="))?.slice("--platform=".length)
const argResources = args.find((a) => a.startsWith("--resources="))?.slice("--resources=".length)
const platform = argPlatform || process.platform

const offlineRoot =
  process.env.POWERSNEXUS_OFFLINE_TMP || path.join(os.tmpdir(), "pn-offline-package")
const notes = []
const errors = []
const ok = (m) => notes.push(`PASS ${m}`)
const fail = (m) => {
  errors.push(m)
  notes.push(`FAIL ${m}`)
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex")
}

function walkFind(dir, predicate, depth = 0, maxDepth = 8) {
  if (!existsSync(dir) || depth > maxDepth) return null
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return null
  }
  for (const name of entries) {
    const full = path.join(dir, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (predicate(full, name, st)) return full
    if (st.isDirectory()) {
      // 跳过巨大无关目录
      if (["node_modules", ".git", "locales"].includes(name)) continue
      const hit = walkFind(full, predicate, depth + 1, maxDepth)
      if (hit) return hit
    }
  }
  return null
}

/** 按平台解析包内 resources 目录 */
function resolvePackageResources(targetPlatform) {
  if (argResources) {
    return existsSync(argResources) ? path.resolve(argResources) : null
  }
  const dist = path.join(desktopRoot, "dist")
  if (!existsSync(dist)) return null

  const candidates = []
  if (targetPlatform === "win32") {
    candidates.push(path.join(dist, "win-unpacked", "resources"))
  } else if (targetPlatform === "darwin") {
    // electron-builder 常见输出
    for (const dir of ["mac", "mac-arm64", "mac-universal", "mac-x64"]) {
      const base = path.join(dist, dir)
      if (!existsSync(base)) continue
      // 寻找 *.app/Contents/Resources
      try {
        for (const name of readdirSync(base)) {
          if (name.endsWith(".app")) {
            candidates.push(path.join(base, name, "Contents", "Resources"))
          }
        }
      } catch {
        // ignore
      }
    }
  } else if (targetPlatform === "linux") {
    candidates.push(path.join(dist, "linux-unpacked", "resources"))
    candidates.push(path.join(dist, "linux-arm64-unpacked", "resources"))
  }

  for (const c of candidates) {
    if (existsSync(path.join(c, "powersnexus")) || existsSync(path.join(c, "powersnexus-release-public-key.pem"))) {
      return c
    }
  }

  // 仅当未指定 --platform（或显式允许跨平台搜索）时，才在 dist 全局搜索
  // 避免在 Windows 上对 --platform=darwin 误命中 win-unpacked
  if (!argPlatform || process.env.POWERSNEXUS_SMOKE_CROSS_SEARCH === "1") {
    const key = walkFind(
      dist,
      (_full, name) => name === "powersnexus-release-public-key.pem",
      0,
      6,
    )
    if (key) return path.dirname(key)
  }
  return null
}

function extractZip(zipPath, dest) {
  const tar = spawnSync("tar", ["-xf", zipPath, "-C", dest], { encoding: "utf8" })
  if (tar.status === 0) return { ok: true, method: "tar" }
  if (process.platform === "win32") {
    const ps = spawnSync(
      "powershell",
      ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force`],
      { encoding: "utf8" },
    )
    if (ps.status === 0) return { ok: true, method: "Expand-Archive" }
    return { ok: false, detail: tar.stderr || ps.stderr || "extract failed" }
  }
  // mac/linux: unzip 兜底
  const unzip = spawnSync("unzip", ["-o", zipPath, "-d", dest], { encoding: "utf8" })
  if (unzip.status === 0) return { ok: true, method: "unzip" }
  return { ok: false, detail: tar.stderr || unzip.stderr || "extract failed" }
}

mkdirSync(offlineRoot, { recursive: true })

// 可选预检（不阻断「无包产物」语义）
const pre = spawnSync(process.execPath, [path.join(desktopRoot, "scripts/verify-powersnexus-packaging.mjs")], {
  cwd: desktopRoot,
  encoding: "utf8",
})
if (pre.status === 0) ok("packaging preflight")
else notes.push(`WARN packaging preflight skipped/failed: ${(pre.stderr || pre.stdout || "").split("\n")[0]}`)

const resources = resolvePackageResources(platform)
if (!resources) {
  notes.push(`SKIP no package resources for platform=${platform} under dist/`)
  console.log(notes.join("\n"))
  console.log(`\nOffline package smoke SKIPPED (no artifacts for ${platform})`)
  process.exit(3)
}

ok(`resources root ${resources}`)

const key = path.join(resources, "powersnexus-release-public-key.pem")
const pn = path.join(resources, "powersnexus")
if (!existsSync(key)) fail("missing powersnexus-release-public-key.pem in package resources")
else ok("package public key")
if (!existsSync(pn)) fail("missing powersnexus/ in package resources")
else {
  const versions = readdirSync(pn).filter((n) => {
    try {
      return statSync(path.join(pn, n)).isDirectory()
    } catch {
      return false
    }
  })
  if (!versions.length) fail("packaged powersnexus has no version dirs")
  else {
    ok(`packaged baseline ${versions.join(",")}`)
    for (const version of versions) {
      const zipName = readdirSync(path.join(pn, version)).find((n) => n.endsWith(".zip"))
      if (!zipName) {
        fail(`${version} missing zip`)
        continue
      }
      const zipPath = path.join(pn, version, zipName)
      const bytes = readFileSync(zipPath)
      const digest = sha256(bytes)
      if (digest !== EXPECTED_DIGEST) fail(`${version} unexpected digest ${digest}`)
      else ok(`${version} digest match ${digest.slice(0, 12)}…`)

      const tmp = mkdtempSync(path.join(offlineRoot, `run-${platform}-`))
      try {
        const extracted = extractZip(zipPath, tmp)
        if (!extracted.ok) fail(`extract failed: ${extracted.detail}`)
        else ok(`offline extract via ${extracted.method}`)

        const cli = walkFind(tmp, (_full, name, st) => !st.isDirectory() && name === "powersnexus-cli.js", 0, 6)
        if (!cli) fail("extracted artifact missing powersnexus-cli.js")
        else {
          ok(`offline CLI ${path.relative(tmp, cli)}`)
          const cwd = path.resolve(cli, "..", "..", "..")
          const doctor = spawnSync(process.execPath, [cli, "doctor"], {
            cwd,
            encoding: "utf8",
            env: {
              ...process.env,
              TMP: offlineRoot,
              TEMP: offlineRoot,
              TMPDIR: offlineRoot,
              NO_PROXY: "*",
              HTTP_PROXY: "",
              HTTPS_PROXY: "",
              ALL_PROXY: "",
            },
            timeout: 30000,
          })
          if (doctor.status === 0) ok("offline doctor exit=0")
          else fail(`offline doctor failed: ${(doctor.stderr || doctor.stdout || "").slice(0, 500)}`)
        }
      } finally {
        rmSync(tmp, { recursive: true, force: true })
      }
    }
  }
}

console.log(notes.join("\n"))
if (errors.length) {
  console.error(`\nPortable offline package smoke FAILED (${platform}):\n` + errors.map((e) => `- ${e}`).join("\n"))
  process.exit(1)
}
console.log(`\nPortable offline package smoke PASSED (${platform})`)
process.exit(0)
