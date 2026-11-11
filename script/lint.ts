import { readdir, stat } from "node:fs/promises"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
const args = Bun.argv.slice(2)
const roots: string[] = []

async function scan(dir: string, depth: number): Promise<void> {
  if (depth < 0) return
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "node_modules" || entry.name === ".git") continue
    const candidate = path.join(dir, entry.name)
    if (await Bun.file(path.join(candidate, "package.json")).exists()) roots.push(candidate)
    else await scan(candidate, depth - 1)
  }
}

await scan(path.join(root, "packages"), 3)
roots.push(...[".novaway", "github", "script"].map((name) => path.join(root, name)))
const codeFile = /\.(?:cjs|js|mjs|ts|tsx)$/
async function hasLintFiles(target: string, depth = 2): Promise<boolean> {
  const fileStat = await stat(target)
  if (fileStat.isFile()) return codeFile.test(target) && !target.endsWith(".d.ts")
  if (depth < 0) return false
  for (const entry of await readdir(target, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist" || entry.name === "public") continue
    if (await hasLintFiles(path.join(target, entry.name), depth - 1)) return true
  }
  return false
}

const rootFiles = (await readdir(root, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && !entry.name.endsWith(".d.ts") && codeFile.test(entry.name))
  .map((entry) => path.join(root, entry.name))
const targets: string[] = [...rootFiles]
for (const target of roots.sort()) {
  if (path.relative(root, target) !== path.join("packages", "app")) {
    if (await hasLintFiles(target)) targets.push(target)
    continue
  }

  // The app's single TypeScript project is too large for tsgolint on Windows.
  // Keep type-aware linting enabled, but feed oxlint one app subtree at a time.
  for (const entry of await readdir(target, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist" || entry.name === "public") continue
    const candidate = path.join(target, entry.name)
    if (entry.name !== "src" || !entry.isDirectory()) {
      if (await hasLintFiles(candidate)) targets.push(candidate)
      continue
    }
    for (const source of await readdir(candidate, { withFileTypes: true })) {
      if (source.name.startsWith(".")) continue
      const sourceTarget = path.join(candidate, source.name)
      if (await hasLintFiles(sourceTarget)) targets.push(sourceTarget)
    }
  }
}
let failed = false
for (const target of targets) {
  console.log(`\n== oxlint ${path.relative(root, target) || "."} ==`)
  const result = Bun.spawnSync(["bunx", "oxlint", ...args, target], { cwd: root, stdout: "inherit", stderr: "inherit" })
  if (result.exitCode !== 0) {
    console.error(`oxlint failed for ${path.relative(root, target) || "."} with exit code ${result.exitCode}`)
    failed = true
  }
}
process.exit(failed ? 1 : 0)
