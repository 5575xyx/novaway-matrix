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
const GH_RELEASE_PATH = `${GITHUB_REPO}/releases/download/v${VERSION}`

// 国内自建下载源（腾讯云静态服务器，文件平铺，命名与 GitHub Release 一致）
const CN_MIRROR = "http://119.29.157.227/novaway"

// 镜像源配置（按优先级排序，任一失败自动切换下一个）
const MIRROR_SOURCES = [
  // 1. 环境变量自定义源（最高优先级，便于临时切换）
  process.env.NOVAWAY_MIRROR_URL,
  // 2. 国内自建镜像（首选，直连快）
  CN_MIRROR,
  // 3. GitHub 加速镜像（公共代理，稳定性不保证，仅作兜底；已实测响应的两个）
  `https://ghfast.top/https://github.com/${GH_RELEASE_PATH}`,
  `https://gh-proxy.com/https://github.com/${GH_RELEASE_PATH}`,
  // 4. GitHub 官方源（最后兜底）
  `https://github.com/${GH_RELEASE_PATH}`,
].filter(Boolean)

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

function formatBytes(bytes) {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + " " + sizes[i]
}

function downloadBinary(packageName) {
  return new Promise(async (resolve, reject) => {
    const isWindows = platform === "windows"
    const ext = isWindows ? "zip" : "tar.gz"
    const filename = `${packageName}-${VERSION}.${ext}`

    console.log(`\n[>] Downloading novaway binary for ${platform}-${arch}...`)

    // 尝试所有镜像源
    for (let i = 0; i < MIRROR_SOURCES.length; i++) {
      const baseUrl = MIRROR_SOURCES[i]
      const url = `${baseUrl}/${filename}`

      console.log(
        `\n[*] 尝试源 ${i + 1}/${MIRROR_SOURCES.length}: ${
          i === 0 && process.env.NOVAWAY_MIRROR_URL
            ? "自定义源(NOVAWAY_MIRROR_URL)"
            : baseUrl === CN_MIRROR
              ? "国内自建镜像(直连)"
              : baseUrl.includes("/https://github.com/")
                ? "GitHub加速镜像"
                : "GitHub官方"
        }`,
      )

      try {
        await tryDownload(url, isWindows, packageName)
        resolve()
        return
      } catch (error) {
        console.log(`[x] 下载失败: ${error.message}`)
        if (i === MIRROR_SOURCES.length - 1) {
          reject(new Error(`所有镜像源均下载失败。请检查网络连接或稍后重试。\n\n如需手动下载：\n1. 访问 https://github.com/${GITHUB_REPO}/releases/download/v${VERSION}/${filename}\n2. 解压到 ${path.dirname(targetBinary)}`))
        }
      }
    }
  })
}

function tryDownload(url, isWindows, packageName) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : require('http')

    const request = protocol.get(url, { timeout: 30000 }, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow redirect
        return protocol.get(response.headers.location, { timeout: 30000 }, (res) =>
          handleResponse(res, resolve, reject, isWindows, packageName)
        ).on('error', reject)
      }
      handleResponse(response, resolve, reject, isWindows, packageName)
    })

    request.on('error', reject)
    request.on('timeout', () => {
      request.destroy()
      reject(new Error('下载超时'))
    })
  })
}

function handleResponse(response, resolve, reject, isWindows, packageName) {
  if (response.statusCode !== 200) {
    return reject(new Error(`Download failed with status ${response.statusCode}`))
  }

  const totalBytes = parseInt(response.headers["content-length"], 10)
  let downloadedBytes = 0
  let lastUpdate = Date.now()

  const tempFile = path.join(os.tmpdir(), `novaway-download-${Date.now()}${isWindows ? ".zip" : ".tar.gz"}`)
  const fileStream = fs.createWriteStream(tempFile)

  if (totalBytes) {
    console.log(`[>] Total size: ${formatBytes(totalBytes)}`)
  }

  response.on("data", (chunk) => {
    downloadedBytes += chunk.length
    const now = Date.now()

    // Update progress every 500ms
    if (now - lastUpdate > 500 || downloadedBytes === totalBytes) {
      const percent = totalBytes ? ((downloadedBytes / totalBytes) * 100).toFixed(1) : "?"
      const downloaded = formatBytes(downloadedBytes)
      const bar = "=".repeat(Math.floor(percent / 2)) + ">".padEnd(50 - Math.floor(percent / 2), "-")

      process.stdout.write(`\r[${bar}] ${percent}% (${downloaded})`)
      lastUpdate = now
    }
  })

  response.pipe(fileStream)

  fileStream.on("finish", () => {
    process.stdout.write("\n")
    console.log("[✓] Download complete!")
    console.log("[>] Extracting binary...\n")

    fileStream.close()
    extractBinary(tempFile, isWindows)
      .then(() => {
        fs.unlinkSync(tempFile)
        resolve()
      })
      .catch(reject)
  })

  fileStream.on("error", (err) => {
    try {
      fs.unlinkSync(tempFile)
    } catch {}
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
