/**
 * RapidOCR 一键安装。
 *
 * 设计目标：用户只需要点一次按钮。
 * - 优先复用本机 Python；没有 Python 时自动下载 uv（约 30MB 的单文件工具），
 *   由 uv 拉取托管的 CPython 并建环境，用户不需要自己去装 Python；
 * - 不污染系统 Python：依赖装进 NovaWay 数据目录下的 `ocr/venv` 独立虚拟环境；
 * - 网络不好时自动换国内 PyPI 镜像重试；
 * - 全程可取消，并可把日志尾部回传给 UI。
 *
 * 通用流程在 `@/python/venv`：带 Python 脚本的技能扩展走的是同一套探测 / venv / pip，
 * 这里只负责把 OCR 自己的包名、模块名和路径填进去。
 */
import fs from "node:fs/promises"
import path from "node:path"
import { ensureVenv, type Runner } from "@/python/venv"
import { ocrRoot, pipIndexes, pythonCandidates, RAPID_MODULES, RAPID_PACKAGE, venvPython } from "./ocr-paths"

export { looksLikeNetworkError, summarizeFailure } from "@/python/venv"
export type { Runner }

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

/**
 * 执行安装。
 *
 * 中途失败会带着 hint 返回，不抛异常（调用方是后台任务）。
 */
export async function installRapidOcr(input: InstallInput = {}): Promise<InstallResult> {
  const root = input.root ?? ocrRoot()
  const result = await ensureVenv({
    root,
    candidates: pythonCandidates(),
    packages: [RAPID_PACKAGE],
    modules: RAPID_MODULES,
    // 两个模块名是不同版本的同一个包，任一个能 import 就算装好。
    moduleMode: "any",
    label: "RapidOCR",
    indexes: pipIndexes(),
    hints: {
      noPython:
        "联网后重试会自动准备运行环境；也可以手动安装 Python 3.9+（勾选 Add to PATH），或设置 NOVAWAY_OCR_PYTHON 指向解释器。",
      venv: "创建虚拟环境失败。确认 Python 自带 venv 模块（Debian/Ubuntu 需 apt install python3-venv）。",
      pip: "安装依赖失败。可检查网络/代理，或设置 NOVAWAY_OCR_PIP_INDEX 指向可用镜像。",
      verify: "可能是 Python 版本过低（需要 3.9+）或磁盘空间不足，可查看日志后重试。",
    },
    signal: input.signal,
    onProgress: input.onProgress,
    runner: input.runner,
    uv: input.uv,
    allowDownload: input.allowDownload,
    reinstall: input.reinstall,
  })

  if (!result.ok) return { ok: false, error: result.error, hint: result.hint }
  return { ok: true, python: result.python, module: RAPID_MODULES[0] }
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
