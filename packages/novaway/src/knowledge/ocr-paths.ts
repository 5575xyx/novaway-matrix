/**
 * OCR 运行环境的路径与 Python 候选解释器。
 *
 * 单独成文件是为了让「探测」和「一键安装」共用同一套路径：
 * 安装脚本把依赖装进 NovaWay 数据目录下的 `ocr/venv`，探测时优先用这个 venv，
 * 用户不需要改任何系统环境。uv 的位置与版本来自 `@/python/venv`（和其它
 * Python 环境共用一份 uv，不重复下载）。
 */
import path from "node:path"
import { Global } from "@novaway/core/global"

export { pythonInstallMirror, uvBinary, uvDownloadUrl, uvPython as UV_PYTHON } from "@/python/venv"

export const ocrRoot = () => path.join(Global.Path.data, "ocr")
export const venvDir = () => path.join(ocrRoot(), "venv")

export const venvPython = () =>
  process.platform === "win32" ? path.join(venvDir(), "Scripts", "python.exe") : path.join(venvDir(), "bin", "python")

export type PythonCandidate = { command: string; args: string[]; label: string }

/**
 * 候选解释器，按优先级：
 * 1. `NOVAWAY_OCR_PYTHON` 显式指定
 * 2. 内置 venv（一键安装的产物）
 * 3. 系统 python / python3 / py -3
 */
export function pythonCandidates(): PythonCandidate[] {
  const list: PythonCandidate[] = []
  const explicit = process.env.NOVAWAY_OCR_PYTHON?.trim()
  if (explicit) list.push({ command: explicit, args: [], label: explicit })
  list.push({ command: venvPython(), args: [], label: "novaway venv" })
  list.push({ command: "python", args: [], label: "python" })
  list.push({ command: "python3", args: [], label: "python3" })
  if (process.platform === "win32") list.push({ command: "py", args: ["-3"], label: "py -3" })
  return list
}

/** 安装时可以用的 index：先官方，失败再用国内镜像。 */
export function pipIndexes(): string[] {
  const override = process.env.NOVAWAY_OCR_PIP_INDEX?.trim()
  if (override) return [override]
  return ["", "https://pypi.tuna.tsinghua.edu.cn/simple"]
}

export const RAPID_MODULES = ["rapidocr_onnxruntime", "rapidocr"] as const
export const RAPID_PACKAGE = "rapidocr_onnxruntime"
