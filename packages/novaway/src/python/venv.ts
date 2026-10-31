/**
 * 通用 Python 运行环境准备。
 *
 * 一个函数干三件事：探测本机 Python →（没有就下载 uv + 托管 CPython）→
 * 在 NovaWay 数据目录下建独立 venv 并装依赖。从不污染系统 Python。
 *
 * OCR 的「一键安装」和各种带 Python 脚本的扩展都走这里，避免两份几乎一样的流程：
 * - 依赖可以给包名列表，也可以给 `requirements.txt` 路径；
 * - 装完可以指定要能 import 的模块，验证失败就如实返回失败；
 * - 网络类错误才换镜像，依赖冲突换镜像没有意义。
 */
import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { Archive } from "@/util/archive"
import { Process } from "@/util/process"
import { Global } from "@novaway/core/global"
import { withGithubMirrors } from "@novaway/core/util/github"

const exec = promisify(execFile)

export type Runner = (input: {
  command: string
  args: string[]
  timeout: number
  signal?: AbortSignal
  env?: Record<string, string>
}) => Promise<string>

export const defaultRunner: Runner = async (input) => {
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

const LOG_LIMIT = 8000
const VENV_TIMEOUT = 5 * 60 * 1000
const PIP_TIMEOUT = 20 * 60 * 1000
const NL = String.fromCharCode(10)

export function trimLog(log: string) {
  return log.length > LOG_LIMIT ? log.slice(-LOG_LIMIT) : log
}

export function errorText(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * 判断失败是不是网络问题：是的话值得换镜像重试。
 *
 * 覆盖各家工具的实际措辞：pip 的 `Read timed out`、uv 的
 * `client error (Connect)` / `tls handshake eof` / `Request failed after 3 retries`，
 * 以及 DNS、证书、代理这类链路问题。依赖冲突（版本不兼容）不在此列 —— 换镜像没用。
 */
export function looksLikeNetworkError(log: string) {
  const lower = log.toLowerCase()
  return [
    "connection",
    "connect",
    "timed out",
    "timeout",
    "read timed out",
    "temporary failure",
    "network is unreachable",
    "unreachable",
    "no route to host",
    "failed to fetch",
    "request failed",
    "tls handshake",
    "tls",
    "certificate",
    "dns",
    "ssl",
    "proxy",
    "eof",
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

/** venv 里的解释器路径：Windows 在 Scripts，其它平台在 bin。 */
export function venvPythonAt(root: string) {
  const venv = path.join(root, "venv")
  return process.platform === "win32" ? path.join(venv, "Scripts", "python.exe") : path.join(venv, "bin", "python")
}

/** 在目录里（含子目录）找 uv 可执行文件。 */
export async function locateUv(dir: string): Promise<string | undefined> {
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
export async function findUv(run: Runner, uvPath: string, signal?: AbortSignal) {
  for (const candidate of ["uv", uvPath]) {
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
export async function downloadUv(input: {
  url: string
  target: string
  signal?: AbortSignal
  onMessage: (message: string) => void
  onLog: (text: string) => void
}) {
  const dir = path.dirname(input.target)
  await fs.mkdir(dir, { recursive: true })
  input.onMessage("正在准备内置运行环境（首次约 30MB）")
  const response = await fetch(input.url, { signal: input.signal })
  if (!response.ok) throw new Error("下载 uv 失败：" + response.status + " " + response.statusText)
  const asset = input.url.endsWith(".zip") ? "uv.zip" : "uv.tar.gz"
  const file = path.join(dir, asset)
  await fs.writeFile(file, Buffer.from(await response.arrayBuffer()))
  input.onLog("downloaded " + input.url)
  if (asset.endsWith(".zip")) await Archive.extractZip(file, dir)
  else await Process.run(["tar", "-xzf", file, "-C", dir])
  await fs.rm(file, { force: true })
  const found = await locateUv(dir)
  if (!found) throw new Error("uv 下载完成但没有找到可执行文件")
  // 用 resolve 比较：Windows 上同一个文件可能写成 `E:/x` 和 `E:\x`，
  // 直接比字符串会误判成「需要重命名」，然后把刚解出来的二进制删掉。
  if (path.resolve(found) !== path.resolve(input.target)) {
    await fs.rm(input.target, { force: true })
    await fs.rename(found, input.target)
  }
  if (process.platform !== "win32") await fs.chmod(input.target, 0o755).catch(() => undefined)
  return input.target
}

/** uv 的安装位置：和 ripgrep、LSP 等二进制共用 Global.Path.bin。 */
export const uvBinary = () => path.join(Global.Path.bin, process.platform === "win32" ? "uv.exe" : "uv")

/** 由 uv 托管的 Python 版本。用户机器上完全没有 Python 时也能一键装好。 */
export function uvPython() {
  return process.env.NOVAWAY_UV_PYTHON?.trim() || process.env.NOVAWAY_OCR_PYTHON_VERSION?.trim() || "3.12"
}

/** Python 运行时镜像：uv 下载 CPython 时使用，国内网络可指向镜像。 */
export function pythonInstallMirror() {
  return process.env.NOVAWAY_UV_MIRROR?.trim() || process.env.NOVAWAY_OCR_PYTHON_MIRROR?.trim() || undefined
}

/**
 * uv 官方 release 资源。
 * 可通过 NOVAWAY_UV_URL（旧的 NOVAWAY_OCR_UV_URL 仍然生效）指向内网/镜像地址。
 */
export function uvDownloadUrl(): string {
  const override = process.env.NOVAWAY_UV_URL?.trim() || process.env.NOVAWAY_OCR_UV_URL?.trim()
  if (override) return override
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64"
  const asset =
    process.platform === "win32"
      ? "uv-" + arch + "-pc-windows-msvc.zip"
      : process.platform === "darwin"
        ? "uv-" + arch + "-apple-darwin.tar.gz"
        : "uv-" + arch + "-unknown-linux-gnu.tar.gz"
  return "https://github.com/astral-sh/uv/releases/latest/download/" + asset
}

/** uv 的下载候选：直连 GitHub，被墙时依次走镜像（见 `@novaway/core/util/github`）。 */
export function uvDownloadUrls(): string[] {
  return withGithubMirrors(uvDownloadUrl())
}

/**
 * 托管 Python 运行时的下载镜像（uv 自己从 python-build-standalone 拉 CPython）。
 *
 * 没配 `NOVAWAY_UV_MIRROR` 时仍会先直连；直连失败后再用这里的 GitHub 镜像重试一次。
 */
export function pythonInstallMirrorCandidates(): string[] {
  const configured = pythonInstallMirror()
  if (configured) return [configured]
  return withGithubMirrors("https://github.com/astral-sh/python-build-standalone/releases/download").slice(1)
}

export type PythonCandidate = { command: string; args: string[]; label: string }

/**
 * 能用的最低 Python 版本。
 *
 * ppt-master 的依赖（python-pptx / skia-pathops / uharfbuzz）早已不提供 3.8 的
 * 轮子，3.8 上 pip 会去现场编译然后失败。遇到这种机器，按「没有 Python」处理，
 * 交给 uv 装托管版本，比让用户看一屏编译日志好。
 */
export const MIN_PYTHON: readonly [number, number] = [3, 9]

/** 从 `python -c "print(sys.version_info[:2])"` 的输出里读版本；读不出来就返回 undefined。 */
function pythonVersion(output: string): [number, number] | undefined {
  const hit = /\((\d+),\s*(\d+)\)/.exec(output)
  if (!hit) return undefined
  return [Number(hit[1]), Number(hit[2])]
}

function olderThan(version: [number, number], min: readonly [number, number]) {
  return version[0] < min[0] || (version[0] === min[0] && version[1] < min[1])
}

export type VenvPhase = "detect" | "venv" | "pip" | "verify" | "done"

export type VenvProgress = {
  phase: VenvPhase
  message: string
  /** 累计日志（只保留尾部，避免 job 记录膨胀）。 */
  log: string
}

export type VenvInput = {
  /** venv 建在 root/venv。 */
  root: string
  /** 候选解释器，按优先级排列；venv 自己的解释器会被自动跳过。 */
  candidates: PythonCandidate[]
  /** 要装的包（pip 参数里的位置参数）。 */
  packages?: string[]
  /** 要装的 requirements.txt；和 packages 同时给时两边都装。 */
  requirements?: string
  /** 装完要能 import 的模块名；为空则只验证解释器能启动。 */
  modules?: readonly string[]
  /**
   * modules 的语义：
   * - "all"（默认）：每个模块都要能 import —— 技能扩展的依赖缺一个就是没装好；
   * - "any"：任一能 import 就算成功 —— OCR 的模块名在不同版本之间变过。
   */
  moduleMode?: "all" | "any"
  /** 进度文案里的名字，例如 "RapidOCR" / "PPT Master"。 */
  label: string
  /** pip index 候选：空字符串表示官方源，失败后按顺序换。 */
  indexes: string[]
  /** 失败时给用户看的下一步建议。 */
  hints?: { noPython?: string; venv?: string; pip?: string; verify?: string }
  signal?: AbortSignal
  onProgress?: (progress: VenvProgress) => void
  /** 测试注入 */
  runner?: Runner
  uv?: string
  /** 允许联网下载 uv / Python 运行时；测试里关掉。 */
  allowDownload?: boolean
  /** 重新安装：先删掉旧环境，避免半损坏的环境反复失败。 */
  reinstall?: boolean
  timeout?: { venv?: number; pip?: number }
}

export type VenvResult = {
  ok: boolean
  python?: string
  error?: string
  hint?: string
  log: string
}

/**
 * 执行环境准备。
 *
 * 步骤：探测 Python →（没有则下载 uv + 托管 Python）→ 建 venv → 装依赖 → 验证。
 * 中途失败会带着 hint 返回，不抛异常（调用方通常是后台任务）。
 */
export async function ensureVenv(input: VenvInput): Promise<VenvResult> {
  const run = input.runner ?? defaultRunner
  const python = venvPythonAt(input.root)
  const venv = path.join(input.root, "venv")
  const venvTimeout = input.timeout?.venv ?? VENV_TIMEOUT
  const pipTimeout = input.timeout?.pip ?? PIP_TIMEOUT

  let log = ""
  const progress = (phase: VenvPhase, message: string) => {
    input.onProgress?.({ phase, message, log: trimLog(log) })
  }
  const append = (value: string) => {
    if (value) log += value.endsWith(NL) ? value : value + NL
  }

  if (input.reinstall) {
    progress("detect", "正在清理旧的运行环境")
    await fs.rm(venv, { recursive: true, force: true }).catch(() => undefined)
  }

  // 1) 找一个能用的系统 Python（venv 里的 Python 不能用来建 venv）。
  progress("detect", "正在检测运行环境")
  let system: { command: string; args: string[] } | undefined
  for (const candidate of input.candidates) {
    if (candidate.command === python) continue
    try {
      const output = await run({
        command: candidate.command,
        args: [...candidate.args, "-c", "import sys; print(sys.version_info[:2])"],
        timeout: 15_000,
        signal: input.signal,
      })
      const version = pythonVersion(output)
      if (version && olderThan(version, MIN_PYTHON)) {
        append(
          "skip " + candidate.label + ": Python " + version.join(".") + " 太旧（需要 " + MIN_PYTHON.join(".") + "+）",
        )
        continue
      }
      append("python: " + candidate.label + " -> " + output.trim())
      system = candidate
      break
    } catch (error) {
      append("skip " + candidate.label + ": " + errorText(error))
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
    uv = input.uv ?? (await findUv(run, uvBinary(), input.signal))
    if (!uv && input.allowDownload !== false) {
      for (const candidate of uvDownloadUrls()) {
        try {
          uv = await downloadUv({
            url: candidate,
            target: uvBinary(),
            signal: input.signal,
            onMessage: (message) => progress("detect", message),
            onLog: append,
          })
          append("uv: " + uv)
          break
        } catch (error) {
          if (input.signal?.aborted) break
          append("download uv (" + candidate + "): " + errorText(error))
        }
      }
    }
    if (!uv) {
      return {
        ok: false,
        error: "没有找到可用的 Python 运行环境",
        hint: input.hints?.noPython ?? "联网后重试会自动准备运行环境；也可以手动安装 Python 3.9+（勾选 Add to PATH）。",
        log: trimLog(log),
      }
    }
  }

  // 3) 建独立 venv。
  progress("venv", uv && !system ? "正在下载 Python 并创建独立环境" : "正在创建独立运行环境")
  try {
    if (uv && !system) {
      // uv 自己要从 GitHub 拉托管 CPython：直连失败时逐个换 Python 运行时镜像再试。
      const mirrors = pythonInstallMirror() ? [] : pythonInstallMirrorCandidates()
      const attempts: Array<Record<string, string>> = [
        env,
        ...mirrors.map((value) => ({ ...env, UV_PYTHON_INSTALL_MIRROR: value })),
      ]
      let lastError: unknown
      let done = false
      for (const attemptEnv of attempts) {
        try {
          append(
            await run({
              command: uv,
              args: ["venv", "--python", uvPython(), venv],
              timeout: venvTimeout,
              signal: input.signal,
              env: attemptEnv,
            }),
          )
          done = true
          break
        } catch (error) {
          lastError = error
          append(errorText(error))
          if (input.signal?.aborted) break
          if (attemptEnv.UV_PYTHON_INSTALL_MIRROR) progress("venv", "Python 运行时下载失败，正在更换镜像重试")
        }
      }
      if (!done) throw lastError instanceof Error ? lastError : new Error(String(lastError))
    } else {
      append(
        await run({
          command: system!.command,
          args: [...system!.args, "-m", "venv", venv],
          timeout: venvTimeout,
          signal: input.signal,
        }),
      )
    }
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
        hint:
          input.hints?.venv ??
          (uv
            ? "创建虚拟环境失败。可检查网络/代理后重试，或设置 NOVAWAY_UV_MIRROR 指向 Python 运行时镜像。"
            : "创建虚拟环境失败。确认 Python 自带 venv 模块（Debian/Ubuntu 需 apt install python3-venv）。"),
        log: trimLog(log),
      }
    }
  }
  await fs.mkdir(input.root, { recursive: true }).catch(() => undefined)

  // 4) 安装依赖，网络类失败时换镜像重试。
  const targets: string[] = [...(input.packages ?? [])]
  if (input.requirements) targets.push("-r", input.requirements)
  if (targets.length === 0) {
    return { ok: false, error: "没有可安装的依赖", hint: input.hints?.pip, log: trimLog(log) }
  }

  progress("pip", "正在安装 " + input.label + " 依赖")
  let installed = false
  let lastLog = ""
  for (const index of input.indexes) {
    try {
      const output = uv
        ? await run({
            command: uv,
            args: ["pip", "install", "--python", python, ...targets, ...(index ? ["--index-url", index] : [])],
            timeout: pipTimeout,
            signal: input.signal,
            env,
          })
        : await run({
            command: python,
            args: ["-m", "pip", "install", "--upgrade", ...targets, ...(index ? ["-i", index] : [])],
            timeout: pipTimeout,
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
    if (input.signal?.aborted) return { ok: false, error: "安装已取消", log: trimLog(log) }
    return {
      ok: false,
      error: summarizeFailure(lastLog),
      hint: input.hints?.pip ?? "安装依赖失败。可检查网络/代理，或设置 NOVAWAY_UV_INDEX 指向可用镜像。",
      log: trimLog(log),
    }
  }

  // 5) 验证。
  progress("verify", "正在验证安装结果")
  const mode = input.moduleMode ?? "all"
  const modules = input.modules && input.modules.length > 0 ? input.modules : ["sys"]
  let verified = 0
  for (const module of modules) {
    try {
      await run({ command: python, args: ["-c", "import " + module], timeout: 120_000, signal: input.signal })
      verified += 1
      // "any" 只要一个能 import 就够了，不必再跑剩下的。
      if (mode === "any") break
    } catch (error) {
      append("verify " + module + ": " + errorText(error))
      // "all" 缺一个就是没装好，后面的失败不会让结论变好。
      if (mode === "all") break
    }
  }
  if (verified === modules.length || (mode === "any" && verified > 0)) {
    progress("done", input.label + " 已可用")
    return { ok: true, python, log: trimLog(log) }
  }

  return {
    ok: false,
    error: "安装完成但无法导入 " + input.label,
    hint: input.hints?.verify ?? "可能是 Python 版本过低（需要 3.9+）或磁盘空间不足，可查看日志后重试。",
    log: trimLog(log),
  }
}
