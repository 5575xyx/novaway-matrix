/**
 * RapidOCR 一键安装。
 *
 * 设计目标：用户只需要点一次按钮。
 * - 优先复用本机 Python；没有 Python 时自动下载 uv（约 30MB 的单文件工具），
 *   由 uv 拉取托管的 CPython 并建环境，用户不需要自己去装 Python；
 * - 不污染系统 Python：依赖装进 NovaWay 数据目录下的 `ocr/venv` 独立虚拟环境；
 * - 网络不好时自动换国内 PyPI 镜像重试；
 * - 全程可取消，并可把日志尾部回传给 UI。
 */
import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { Archive } from "@/util/archive"
import { Process } from "@/util/process"
import {
  ocrRoot,
  pipIndexes,
  pythonCandidates,
  pythonInstallMirror,
  RAPID_MODULES,
  RAPID_PACKAGE,
  UV_PYTHON,
  uvBinary,
  uvDownloadUrl,
  venvPython,
} from "./ocr-paths"

const exec = promisify(execFile)

export type InstallPhase = "detect" | "venv" | "pip" | "verify" | "done"

export type InstallProgress = {
  phase: InstallPhase
  message: string
  /** 累计日志（只保留尾部，避免 job 记录膨胀）。 */
  log: string
}

export type InstallResult = {
  ok: boolean
  python?: string
  module?: string
  error?: string
  /** 给用户看的下一步建议。 */
  hint?: string
}

const LOG_LIMIT = 8000
const VENV_TIMEOUT = 5 * 60 * 1000
const PIP_TIMEOUT = 15 * 60 * 1000
const UV_TIMEOUT = 5 * 60 * 1000

type Runner = (input: {
  command: string
  args: string[]
  timeout: number
  signal?: AbortSignal
  env?: Record<string, string>
}) => Promise<string>

const defaultRunner: Runner = async (input) => {
  const result = await exec(input.command, input.args, {
    timeout: input.timeout,
    maxBuffer: 32 * 1024 * 1024,
    signal: input.signal,
    windowsHide: true,
    env: {
      ...process.env,
      ...input.env,
      PYTHONIOENCODING: "utf-8",
      PIP_DISABLE_PIP_VERSION_CHECK: "1",
    },
  })
  return [result.stdout ?? "", result.stderr ?? ""].filter(Boolean).join(String.fromCharCode(10))
}

function trim(log: string) {
  return log.length > LOG_LIMIT ? log.slice(-LOG_LIMIT) : log
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

/** 判断失败是不是网络问题：是的话值得换镜像重试。 */
export function looksLikeNetworkError(log: string) {
  const lower = log.toLowerCase()
  return [
    "connection",
    "timed out",
    "timeout",
    "read timed out",
    "temporary failure",
    "network is unreachable",
    "ssl",
    "proxy",
    "no matching distribution",
    "could not find a version",
  ].some((item) => lower.includes(item))
}

/** 从 pip 输出里挑一句最有用的错误，避免把整段日志糊到 UI 上。 */
export function summarizeFailure(log: string): string {
  const lines = log
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const preferred = lines.filter((line) => /error|failed|no matching|could not/i.test(line))
  const picked = preferred.slice(-3)
  return picked.length > 0 ? picked.join(" / ") : lines.slice(-2).join(" / ") || "安装失败"
}

export type InstallInput = {
  signal?: AbortSignal
  onProgress?: (progress: InstallProgress) => void
  /** 测试注入 */
  runner?: Runner
  root?: string
  /** 允许联网下载 uv / Python 运行时；测试里关掉。 */
  allowDownload?: boolean
  /** 测试注入的 uv 可执行文件。 */
  uv?: string
  /** 重新安装：先删掉旧环境，避免半损坏的环境反复失败。 */
  reinstall?: boolean
}

/** 在目录里（含一层子目录）找 uv 可执行文件。 */
async function locateUv(dir: string): Promise<string | undefined> {
  const name = process.platform === "win32" ? "uv.exe" : "uv"
  const direct = path.join(dir, name)
  if (
    await fs
      .access(direct)
      .then(() => true)
      .catch(() => false)
  )
    return direct
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const nested = await locateUv(path.join(dir, entry.name))
    if (nested) return nested
  }
  return undefined
}

/** 找一个可用的 uv：PATH 里的优先，其次是一键安装留下的副本。 */
async function findUv(run: Runner, signal?: AbortSignal) {
  for (const candidate of ["uv", uvBinary()]) {
    try {
      await run({ command: candidate, args: ["--version"], timeout: 15_000, signal })
      return candidate
    } catch {
      // 换下一个
    }
  }
  return undefined
}

/** 下载 uv（单文件工具），用来自动准备 Python 运行时。 */
async function downloadUv(input: {
  signal?: AbortSignal
  onMessage: (message: string) => void
  onLog: (text: string) => void
}) {
  const url = uvDownloadUrl()
  const dir = path.dirname(uvBinary())
  await fs.mkdir(dir, { recursive: true })
  input.onMessage("正在准备内置运行环境（首次约 30MB）")
  const response = await fetch(url, { signal: input.signal })
  if (!response.ok) throw new Error("下载 uv 失败：" + response.status + " " + response.statusText)
  const asset = url.endsWith(".zip") ? "uv.zip" : "uv.tar.gz"
  const file = path.join(dir, asset)
  await fs.writeFile(file, Buffer.from(await response.arrayBuffer()))
  input.onLog("downloaded " + url)
  if (asset.endsWith(".zip")) await Archive.extractZip(file, dir)
  else await Process.run(["tar", "-xzf", file, "-C", dir])
  await fs.rm(file, { force: true })
  const found = await locateUv(dir)
  if (!found) throw new Error("uv 下载完成但没有找到可执行文件")
  if (found !== uvBinary()) {
    await fs.rm(uvBinary(), { force: true })
    await fs.rename(found, uvBinary())
  }
  if (process.platform !== "win32") await fs.chmod(uvBinary(), 0o755).catch(() => undefined)
  return uvBinary()
}

/**
 * 执行安装。
 *
 * 步骤：探测 Python →（没有则下载 uv + 托管 Python）→ 建 venv → 装 rapidocr_onnxruntime → 导入验证。
 * 中途失败会带着 hint 返回，不抛异常（调用方是后台任务）。
 */
export async function installRapidOcr(input: InstallInput = {}): Promise<InstallResult> {
  const run = input.runner ?? defaultRunner
  const root = input.root ?? ocrRoot()
  const venv = path.join(root, "venv")
  const python = input.root
    ? process.platform === "win32"
      ? path.join(venv, "Scripts", "python.exe")
      : path.join(venv, "bin", "python")
    : venvPython()

  let log = ""
  const progress = (phase: InstallPhase, message: string) => {
    input.onProgress?.({ phase, message, log: trim(log) })
  }
  const append = (text: string) => {
    if (text) log += text.endsWith(String.fromCharCode(10)) ? text : text + String.fromCharCode(10)
  }

  if (input.reinstall) {
    progress("detect", "正在清理旧的运行环境")
    await fs.rm(venv, { recursive: true, force: true }).catch(() => undefined)
  }

  // 1) 找一个能用的系统 Python（venv 里的 Python 不能用来建 venv）。
  progress("detect", "正在检测运行环境")
  let system: { command: string; args: string[] } | undefined
  for (const candidate of pythonCandidates()) {
    if (candidate.command === venvPython()) continue
    try {
      const output = await run({
        command: candidate.command,
        args: [...candidate.args, "-c", "import sys; print(sys.version_info[:2])"],
        timeout: 15_000,
        signal: input.signal,
      })
      log += "python: " + candidate.label + " -> " + output.trim() + String.fromCharCode(10)
      system = candidate
      break
    } catch (error) {
      log += "skip " + candidate.label + ": " + errorText(error) + String.fromCharCode(10)
    }
  }

  // 2) 没有系统 Python 时用 uv 自动准备（这是「一键」的关键：
  //    用户机器上完全没装过 Python 也能装完）。
  let uv: string | undefined
  const env: Record<string, string> = {}
  const mirror = pythonInstallMirror()
  if (mirror) env.UV_PYTHON_INSTALL_MIRROR = mirror
  if (!system) {
    progress("detect", "未找到 Python，正在准备内置运行环境")
    uv = input.uv ?? (await findUv(run, input.signal))
    if (!uv && input.allowDownload !== false) {
      try {
        uv = await downloadUv({
          signal: input.signal,
          onMessage: (message) => progress("detect", message),
          onLog: append,
        })
        append("uv: " + uv)
      } catch (error) {
        append("download uv: " + errorText(error))
      }
    }
    if (!uv) {
      return {
        ok: false,
        error: "没有找到可用的 Python 运行环境",
        hint: "联网后重试会自动准备运行环境；也可以手动安装 Python 3.9+（勾选 Add to PATH），或设置 NOVAWAY_OCR_PYTHON 指向解释器。",
      }
    }
  }

  // 3) 建独立 venv。
  progress("venv", uv && !system ? "正在下载 Python 并创建独立环境" : "正在创建独立运行环境")
  try {
    const output =
      uv && !system
        ? await run({
            command: uv,
            args: ["venv", "--python", UV_PYTHON, venv],
            timeout: VENV_TIMEOUT,
            signal: input.signal,
            env,
          })
        : await run({
            command: system!.command,
            args: [...system!.args, "-m", "venv", venv],
            timeout: VENV_TIMEOUT,
            signal: input.signal,
          })
    append(output)
  } catch (error) {
    // 已存在的 venv 会报错，检查一下是否可用再决定是否失败。
    const usable = await fs
      .access(python)
      .then(() => true)
      .catch(() => false)
    if (!usable) {
      return {
        ok: false,
        error: summarizeFailure(log + errorText(error)),
        hint: uv
          ? "创建虚拟环境失败。可检查网络/代理后重试，或设置 NOVAWAY_OCR_PYTHON_MIRROR 指向 Python 运行时镜像。"
          : "创建虚拟环境失败。确认 Python 自带 venv 模块（Debian/Ubuntu 需 apt install python3-venv）。",
      }
    }
  }
  await fs.mkdir(root, { recursive: true }).catch(() => undefined)

  // 4) 安装依赖，失败时换镜像重试。
  progress("pip", "正在安装 RapidOCR 与模型依赖")
  let installed = false
  let lastLog = ""
  for (const index of pipIndexes()) {
    try {
      const output = uv
        ? await run({
            command: uv,
            args: ["pip", "install", "--python", python, RAPID_PACKAGE, ...(index ? ["--index-url", index] : [])],
            timeout: PIP_TIMEOUT,
            signal: input.signal,
            env,
          })
        : await run({
            command: python,
            args: ["-m", "pip", "install", "--upgrade", RAPID_PACKAGE, ...(index ? ["-i", index] : [])],
            timeout: PIP_TIMEOUT,
            signal: input.signal,
          })
      append(output)
      installed = true
      break
    } catch (error) {
      lastLog = log + errorText(error)
      log = lastLog
      if (input.signal?.aborted) break
      // 只有网络类错误才值得换镜像；依赖冲突换镜像也没用。
      if (!looksLikeNetworkError(lastLog)) break
      progress("pip", index ? "安装失败，正在更换镜像重试" : "网络不稳定，正在更换国内镜像重试")
    }
  }
  if (!installed) {
    if (input.signal?.aborted) return { ok: false, error: "安装已取消" }
    return {
      ok: false,
      error: summarizeFailure(lastLog),
      hint: "安装依赖失败。可检查网络/代理，或设置 NOVAWAY_OCR_PIP_INDEX 指向可用镜像。",
    }
  }

  // 5) 导入验证。
  progress("verify", "正在验证安装结果")
  for (const module of RAPID_MODULES) {
    try {
      await run({ command: python, args: ["-c", "import " + module], timeout: 120_000, signal: input.signal })
      progress("done", "RapidOCR 已可用")
      return { ok: true, python, module }
    } catch (error) {
      log += "verify " + module + ": " + errorText(error) + String.fromCharCode(10)
    }
  }

  return {
    ok: false,
    error: "安装完成但无法导入 RapidOCR",
    hint: "可能是 Python 版本过低（需要 3.9+）或磁盘空间不足，可查看日志后重试。",
  }
}

/** 检查内置 venv 是否已存在。 */
export async function installedInfo(): Promise<{ python: string; exists: boolean }> {
  const python = venvPython()
  const exists = await fs
    .access(python)
    .then(() => true)
    .catch(() => false)
  return { python, exists }
}
