#!/usr/bin/env node

import childProcess from "child_process"
import fs from "fs"
import os from "os"
import path from "path"
import { createRequire } from "module"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8"))

const platformMap = {
  darwin: "darwin",
  linux: "linux",
  win32: "windows",
}
const archMap = {
  x64: "x64",
  arm64: "arm64",
  arm: "arm",
}

const platform = platformMap[os.platform()] ?? os.platform()
const arch = archMap[os.arch()] ?? os.arch()
// 平台包名 = `${主包名}-<os>-<arch>`。从本包 package.json 的 name 派生，自动适配
// xymt-novaway 或 novaway（切换账号发布时无需改此脚本）。
const base = `${packageJson.name}-${platform}-${arch}`
const sourceBinary = platform === "windows" ? "novaway.exe" : "novaway"
const targetBinary = path.join(__dirname, "bin", "novaway.exe")

// 只发布 4 个标准平台包（无 baseline/musl 变体），所以直接用单一平台包名。
function packageNames() {
  return [base]
}

function resolveBinary(name) {
  const packageJsonPath = require.resolve(`${name}/package.json`)
  const binaryPath = path.join(path.dirname(packageJsonPath), "bin", sourceBinary)
  if (!fs.existsSync(binaryPath)) throw new Error(`Binary not found at ${binaryPath}`)
  return binaryPath
}

function installPackage(name) {
  const version = packageJson.optionalDependencies?.[name]
  if (!version) return

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-install-"))
  try {
    const result = childProcess.spawnSync(
      "npm",
      ["install", "--ignore-scripts", "--no-save", "--loglevel=error", "--prefix", temp, `${name}@${version}`],
      { stdio: "inherit", windowsHide: true },
    )
    if (result.status !== 0) return
    const packageDir = path.join(temp, "node_modules", name)
    copyBinary(path.join(packageDir, "bin", sourceBinary), targetBinary)
    return true
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
}

function copyBinary(source, target) {
  if (!fs.existsSync(source)) throw new Error(`Binary not found at ${source}`)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  if (fs.existsSync(target)) fs.unlinkSync(target)
  try {
    fs.linkSync(source, target)
  } catch {
    fs.copyFileSync(source, target)
  }
  fs.chmodSync(target, 0o755)
}

function verifyBinary() {
  const result = childProcess.spawnSync(targetBinary, ["--version"], {
    encoding: "utf8",
    stdio: "ignore",
    windowsHide: true,
  })
  return result.status === 0
}

function main() {
  for (const name of packageNames()) {
    try {
      copyBinary(resolveBinary(name), targetBinary)
      if (verifyBinary()) return
    } catch {
      if (installPackage(name) && verifyBinary()) return
    }
  }

  throw new Error(
    `It seems your package manager failed to install the right novaway CLI package. Try manually installing ${packageNames()
      .map((name) => JSON.stringify(name))
      .join(" or ")}.`,
  )
}

try {
  main()
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
