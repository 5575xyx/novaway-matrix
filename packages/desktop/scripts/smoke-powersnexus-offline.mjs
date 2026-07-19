import { existsSync, readdirSync, readFileSync, statSync, mkdtempSync, rmSync, mkdirSync } from "node:fs"
import { createHash } from "node:crypto"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import os from "node:os"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const resources = path.join(root, "dist/win-unpacked/resources")
const offlineRoot = process.env.POWERSNEXUS_OFFLINE_TMP || "E:\\tmp\\pn-offline"
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

mkdirSync(offlineRoot, { recursive: true })

const pre = spawnSync(process.execPath, [path.join(root, "scripts/verify-powersnexus-packaging.mjs")], {
  cwd: root,
  encoding: "utf8",
})
if (pre.status !== 0) {
  fail("packaging preflight failed")
  console.log(pre.stdout)
  console.error(pre.stderr)
} else ok("packaging preflight")

if (!existsSync(resources)) {
  fail("missing dist/win-unpacked/resources — run package:win first")
} else {
  const key = path.join(resources, "powersnexus-release-public-key.pem")
  const pn = path.join(resources, "powersnexus")
  if (!existsSync(key)) fail("missing public key in package")
  else ok("package public key")
  if (!existsSync(pn)) fail("missing powersnexus in package")
  else {
    const versions = readdirSync(pn).filter((n) => statSync(path.join(pn, n)).isDirectory())
    if (!versions.length) fail("no packaged baseline")
    else {
      ok(`packaged baseline ${versions.join(",")}`)
      for (const version of versions) {
        const zipName = readdirSync(path.join(pn, version)).find((n) => n.endsWith(".zip"))
        if (!zipName) {
          fail(`${version} missing zip`)
          continue
        }
        const bytes = readFileSync(path.join(pn, version, zipName))
        const digest = sha256(bytes)
        if (digest !== "4c1915d9506492b71a7026c013849e32223201e2aeba121c0aadaeffae72afd2") fail(`unexpected digest ${digest}`)
        else ok(`offline digest match ${digest.slice(0, 12)}…`)

        const tmp = mkdtempSync(path.join(offlineRoot, "run-"))
        try {
          const zipPath = path.join(pn, version, zipName)
          const extract = spawnSync("tar", ["-xf", zipPath, "-C", tmp], { encoding: "utf8" })
          if (extract.status !== 0) {
            const ps = spawnSync(
              "powershell",
              ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${tmp}' -Force`],
              { encoding: "utf8" },
            )
            if (ps.status !== 0) fail(`extract failed: ${extract.stderr || ps.stderr}`)
            else ok("offline extract via Expand-Archive")
          } else ok("offline extract via tar")

          const walk = (dir, depth = 0) => {
            if (depth > 6) return null
            for (const name of readdirSync(dir)) {
              const full = path.join(dir, name)
              const st = statSync(full)
              if (st.isDirectory()) {
                const hit = walk(full, depth + 1)
                if (hit) return hit
              } else if (name === "powersnexus-cli.js") return full
            }
            return null
          }
          const cli = walk(tmp)
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
}

console.log(notes.join("\n"))
if (errors.length) {
  console.error("\nWindows offline smoke FAILED:\n" + errors.map((e) => `- ${e}`).join("\n"))
  process.exit(1)
}
console.log("\nWindows offline smoke PASSED")
