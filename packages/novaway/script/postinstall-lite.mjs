#!/usr/bin/env node

import childProcess from "child_process"
import fs from "fs"
import os from "os"
import path from "path"
import https from "https"
import { createRequire } from "module"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8"))

const GITHUB_REPO = "5575xyx/novaway-matrix"
const VERSION = packageJson.version

const platformMap = {
  darwin: "darwin",
  linux: "linux",
  win32: "windows",
}
const archMap = {
  x64: "x64",
  arm64: "arm64",
}

const platform = platformMap[os.platform()] ?? os.platform()
const arch = archMap[os.arch()] ?? os.arch()
const targetBinary = path.join(__dirname, "bin", "novaway.exe")

function supportsAvx2() {
  if (arch !== "x64") return false

  if (platform === "linux") {
    try {
      return /(^|\s)avx2(\s|$)/i.test(fs.readFileSync("/proc/cpuinfo", "utf8"))
    } catch {
      return false
    }
  }

  if (platform === "darwin") {
    try {
      const result = childProcess.spawnSync("sysctl", ["-n", "hw.optional.avx2_0"], {
        encoding: "utf8",
        timeout: 1500,
      })
      if (result.status !== 0) return false
      return (result.stdout || "").trim() === "1"
    } catch {
      return false
    }
  }

  if (platform === "windows") {
    const command =
      '(Add-Type -MemberDefinition "[DllImport(""kernel32.dll"")] public static extern bool IsProcessorFeaturePresent(int ProcessorFeature);" -Name Kernel32 -Namespace Win32 -PassThru)::IsProcessorFeaturePresent(40)'

    for (const executable of ["powershell.exe", "pwsh.exe", "pwsh", "powershell"]) {
      try {
        const result = childProcess.spawnSync(executable, ["-NoProfile", "-NonInteractive", "-Command", command], {
          encoding: "utf8",
          timeout: 3000,
          windowsHide: true,
        })
        if (result.status !== 0) continue
        const output = (result.stdout || "").trim().toLowerCase()
        if (output === "true" || output === "1") return true
        if (output === "false" || output === "0") return false
      } catch {
        continue
      }
    }
  }

  return false
}

function isMusl() {
  if (platform !== "linux") return false

  try {
    if (fs.existsSync("/etc/alpine-release")) return true
  } catch {}

  try {
    const result = childProcess.spawnSync("ldd", ["--version"], { encoding: "utf8" })
    return `${result.stdout || ""}${result.stderr || ""}`.toLowerCase().includes("musl")
  } catch {
    return false
  }
}

function getPackageNames() {
  const baseline = arch === "x64" && !supportsAvx2()
  const base = `novaway-${platform}-${arch}`

  if (platform === "linux") {
    if (isMusl()) {
      if (arch === "x64")
        return baseline
          ? [`${base}-baseline-musl`, `${base}-musl`, `${base}-baseline`, base]
          : [`${base}-musl`, `${base}-baseline-musl`, base, `${base}-baseline`]
      return [`${base}-musl`, base]
    }

    if (arch === "x64")
      return baseline
        ? [`${base}-baseline`, base, `${base}-baseline-musl`, `${base}-musl`]
        : [base, `${base}-baseline`, `${base}-musl`, `${base}-baseline-musl`]
    return [base, `${base}-musl`]
  }

  if (arch === "x64") return baseline ? [`${base}-baseline`, base] : [base, `${base}-baseline`]
  return [base]
}

function downloadBinary(packageName) {
  return new Promise((resolve, reject) => {
    const isWindows = platform === "windows"
    const ext = isWindows ? "zip" : "tar.gz"
    const url = `https://github.com/${GITHUB_REPO}/releases/download/v${VERSION}/${packageName}-${VERSION}.${ext}`

    console.log(`Downloading ${packageName} from ${url}...`)

    https
      .get(url, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          // Follow redirect
          return https.get(response.headers.location, (res) => handleResponse(res, resolve, reject, isWindows))
        }
        handleResponse(response, resolve, reject, isWindows)
      })
      .on("error", reject)
  })
}

function handleResponse(response, resolve, reject, isWindows) {
  if (response.statusCode !== 200) {
    return reject(new Error(`Download failed with status ${response.statusCode}`))
  }

  const tempFile = path.join(os.tmpdir(), `novaway-download-${Date.now()}${isWindows ? ".zip" : ".tar.gz"}`)
  const fileStream = fs.createWriteStream(tempFile)

  response.pipe(fileStream)

  fileStream.on("finish", () => {
    fileStream.close()
    extractBinary(tempFile, isWindows)
      .then(() => {
        fs.unlinkSync(tempFile)
        resolve()
      })
      .catch(reject)
  })

  fileStream.on("error", (err) => {
    fs.unlinkSync(tempFile)
    reject(err)
  })
}

function extractBinary(archivePath, isWindows) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(targetBinary), { recursive: true })

    if (isWindows) {
      // Extract zip
      const result = childProcess.spawnSync("tar", ["-xf", archivePath, "-C", path.dirname(targetBinary)], {
        stdio: "inherit",
        windowsHide: true,
      })
      if (result.status !== 0) {
        return reject(new Error("Failed to extract zip"))
      }
    } else {
      // Extract tar.gz
      const result = childProcess.spawnSync("tar", ["-xzf", archivePath, "-C", path.dirname(targetBinary)], {
        stdio: "inherit",
      })
      if (result.status !== 0) {
        return reject(new Error("Failed to extract tar.gz"))
      }
    }

    // Make binary executable on Unix
    if (!isWindows) {
      fs.chmodSync(targetBinary, 0o755)
    }

    resolve()
  })
}

function verifyBinary() {
  try {
    const result = childProcess.spawnSync(targetBinary, ["--version"], {
      encoding: "utf8",
      stdio: "ignore",
      windowsHide: true,
    })
    return result.status === 0
  } catch {
    return false
  }
}

async function main() {
  const packageNames = getPackageNames()

  for (const packageName of packageNames) {
    try {
      await downloadBinary(packageName)
      if (verifyBinary()) {
        console.log(`✅ Successfully installed ${packageName}`)
        return
      }
    } catch (error) {
      console.warn(`⚠️  Failed to download ${packageName}: ${error.message}`)
      continue
    }
  }

  throw new Error(
    `Failed to download novaway binary for your platform (${platform}-${arch}). ` +
      `Tried: ${packageNames.join(", ")}`
  )
}

try {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
