import { mkdir, readdir, writeFile } from "node:fs/promises"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
const osName = process.platform === "win32" ? "windows" : process.platform
const binaryAbi = process.env.NOVAWAY_BINARY_ABI === "musl" ? "-musl" : ""
const binary = path.join(
  root,
  "dist",
  `xymt-novaway-${osName}-${process.arch}${binaryAbi}`,
  "bin",
  `novaway${process.platform === "win32" ? ".exe" : ""}`,
)

const file = Bun.file(binary)
if (!(await file.exists())) throw new Error(`production binary not found: ${binary}`)
const hash = new Bun.CryptoHasher("sha256")
hash.update(await file.arrayBuffer())
const migrationRoot = path.join(root, "migration")
const migrations = (await readdir(migrationRoot, { withFileTypes: true })).filter(
  (entry) => entry.isDirectory() && /^\d{14}/.test(entry.name),
).length
const result = {
  commit: process.env.GITHUB_SHA ?? process.env.CI_COMMIT_SHA ?? "local",
  platform: process.platform,
  arch: process.arch,
  abi: process.env.NOVAWAY_BINARY_ABI === "musl" ? "musl" : "glibc",
  binary: path.relative(root, binary).replaceAll("\\", "/"),
  sha256: hash.digest("hex"),
  migrationCount: migrations,
  createdAt: new Date().toISOString(),
}
const output = path.join(root, "test-results", "production-artifact-attestation.json")
await mkdir(path.dirname(output), { recursive: true })
await writeFile(output, JSON.stringify(result, null, 2) + "\n")
console.log(JSON.stringify(result))
