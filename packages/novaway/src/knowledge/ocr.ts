/**
 * 知识库 OCR。
 *
 * 四个后端，按「精度 → 开箱即用」排序自动探测：
 * 1. `rapid`：RapidOCR（PP-OCR 系列 ONNX 模型）。优先走本机 Python 的
 *    `rapidocr_onnxruntime` / `rapidocr`（自带 det/cls/rec 三件套模型，中文远超 tesseract），
 *    没有 Python 时回退到 Node 侧 `@gutenye/ocr-node`。
 * 2. `tesseract` CLI：用户本机已安装时零成本可用。
 * 3. `tesseract.js`：纯 WASM，可通过 NOVAWAY_OCR_DATA_DIR 指向本地语言包离线运行。
 * 4. `vision`：以上都没有时，交给支持图片输入的多模态模型（由调用方注入回调）。
 *
 * 环境变量：
 *   NOVAWAY_OCR=auto|off|rapid|cli|wasm     默认 auto
 *   NOVAWAY_OCR_LANGS=chi_sim+eng           默认简中 + 英文
 *   NOVAWAY_OCR_PYTHON=/usr/bin/python3     指定 Python 解释器（默认 python / python3）
 *   NOVAWAY_OCR_RAPID_CONFIG=/path/ocr.yaml RapidOCR v2+ 的自定义模型配置
 *   NOVAWAY_OCR_DATA_DIR=/path/to/tessdata  tesseract.js 的本地语言包目录
 */
import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { pythonCandidates, RAPID_MODULES, venvPython } from "./ocr-paths"

const run = promisify(execFile)

export type OcrKind = "rapid" | "cli" | "wasm" | "vision" | "none"
export type OcrMode = "auto" | "off" | "rapid" | "cli" | "wasm"

export type OcrBackend = {
  kind: OcrKind
  label: string
  /** 探测到/配置的语言，供 UI 展示。 */
  languages: string[]
}

export type OcrResult = {
  text: string
  backend: OcrKind
  /** 失败原因（用于导入汇总，不抛异常打断批量导入）。 */
  error?: string
}

const CLI_TIMEOUT_MS = 120_000

export function ocrSettings() {
  const raw = (process.env.NOVAWAY_OCR ?? "auto").trim().toLowerCase()
  const modes: OcrMode[] = ["off", "rapid", "cli", "wasm"]
  const mode: OcrMode = modes.includes(raw as OcrMode) ? (raw as OcrMode) : "auto"
  const languages = (process.env.NOVAWAY_OCR_LANGS ?? "chi_sim+eng")
    .split(/[,\s+]+/)
    .map((item) => item.trim())
    .filter(Boolean)
  return { mode, languages: languages.length > 0 ? languages : ["eng"] }
}

// 用变量说明符做可选依赖：没安装时不会在构建期报模块缺失，
// 运行时按需加载，缺失就回退到其他后端。
async function importOptional(parts: string[]): Promise<any> {
  return import(parts.join("."))
}

let cached: { at: number; backend: OcrBackend } | undefined
const CACHE_MS = 30_000

/** tesseract 语言代码 → RapidOCR 模型语言。RapidOCR 目前提供中/英两套模型。 */
function rapidLanguages(languages: readonly string[]) {
  const hasChinese = languages.some((item) => item.startsWith("chi") || item === "zh")
  return hasChinese ? ["ch"] : ["en"]
}

// ---------------------------------------------------------------------------
// RapidOCR：Python（自带 PP-OCR 模型，精度最高）
// ---------------------------------------------------------------------------
// 助手脚本在运行时写到临时目录，避免打包时漏拷 .py 资源。
// 兼容两代 API：
//   rapidocr_onnxruntime（v1）: engine(img) -> (result, elapse)，result 是 [[box, text, score], ...]
//   rapidocr（v2/v3）: engine(img) -> result，带 .txts / .boxes / .scores
const RAPID_HELPER = [
  "import sys",
  "import json",
  "",
  "def collect(result):",
  "    lines = []",
  "    if isinstance(result, tuple) and len(result) >= 1:",
  "        result = result[0]",
  "    txts = getattr(result, 'txts', None)",
  "    if txts is not None:",
  "        boxes = getattr(result, 'boxes', None)",
  "        scores = getattr(result, 'scores', None)",
  "        for index, text in enumerate(txts):",
  "            box = boxes[index].tolist() if boxes is not None and index < len(boxes) else []",
  "            score = float(scores[index]) if scores is not None and index < len(scores) else 0.0",
  "            lines.append({'text': str(text), 'score': score, 'box': box})",
  "        return lines",
  "    if isinstance(result, list):",
  "        for item in result:",
  "            if isinstance(item, dict):",
  "                lines.append({'text': str(item.get('text', '')), 'score': float(item.get('score', 0) or 0), 'box': item.get('box') or []})",
  "                continue",
  "            if isinstance(item, (list, tuple)) and len(item) >= 2:",
  "                box = item[0]",
  "                if hasattr(box, 'tolist'):",
  "                    box = box.tolist()",
  "                lines.append({'text': str(item[1]), 'score': float(item[2]) if len(item) > 2 else 0.0, 'box': box})",
  "    return lines",
  "",
  "def main():",
  "    path = sys.argv[1]",
  "    module = sys.argv[2]",
  "    import importlib",
  "    engine_cls = importlib.import_module(module).RapidOCR",
  "    try:",
  "        engine = engine_cls()",
  "    except TypeError:",
  "        engine = engine_cls",
  "    import numpy as np",
  "    import cv2",
  "    data = np.frombuffer(open(path, 'rb').read(), np.uint8)",
  "    image = cv2.imdecode(data, cv2.IMREAD_COLOR)",
  "    lines = collect(engine(image))",
  "    sys.stdout.write(json.dumps({'engine': module, 'lines': lines}, ensure_ascii=False))",
  "",
  "if __name__ == '__main__':",
  "    main()",
].join(String.fromCharCode(10))

export type RapidLine = { text: string; score: number; box: number[][] }

/** 把助手脚本的 JSON 输出解析成按阅读顺序排好的行。 */
export function parseRapidOutput(raw: string): { engine: string; lines: RapidLine[] } {
  const value = JSON.parse(raw) as { engine?: string; lines?: RapidLine[] }
  const lines = Array.isArray(value.lines) ? value.lines : []
  const cleaned = lines
    .filter((line) => typeof line?.text === "string" && line.text.trim().length > 0)
    .map((line) => ({
      text: line.text.trim(),
      score: Number.isFinite(line.score) ? line.score : 0,
      box: Array.isArray(line.box) ? line.box : [],
    }))
  // RapidOCR 多数情况下已按阅读顺序返回；这里再按「上 → 左」兜底排序，
  // 避免多栏混排时顺序错乱。
  const top = (line: RapidLine) => (line.box[0]?.[1] ?? 0) as number
  const left = (line: RapidLine) => (line.box[0]?.[0] ?? 0) as number
  cleaned.sort((a, b) => top(a) - top(b) || left(a) - left(b))
  return { engine: value.engine ?? "", lines: cleaned }
}

type RapidPython = { python: string; module: string }

// undefined = 尚未探测；null = 明确不可用。
let rapidPython: RapidPython | null | undefined
let helperPathPromise: Promise<string> | undefined

async function rapidHelper() {
  if (!helperPathPromise) {
    helperPathPromise = (async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "novaway-rapid-"))
      const file = path.join(dir, "rapid_ocr.py")
      await fs.writeFile(file, RAPID_HELPER, "utf8")
      return file
    })().catch((error) => {
      helperPathPromise = undefined
      throw error
    })
  }
  return helperPathPromise
}

/** 用某个解释器执行一段 Python 代码，成功返回 stdout。 */
async function runPython(candidate: { command: string; args: string[] }, code: string, timeout: number) {
  const result = await run(candidate.command, [...candidate.args, "-c", code], { timeout })
  return result.stdout ?? ""
}

export async function probeRapidPython(): Promise<RapidPython | undefined> {
  if (rapidPython !== undefined) return rapidPython ?? undefined
  const venv = venvPython()
  for (const candidate of pythonCandidates()) {
    // 内置 venv 不存在时不用尝试，省 8 秒超时。
    if (candidate.command === venv) {
      try {
        await fs.access(venv)
      } catch {
        continue
      }
    }
    for (const module of RAPID_MODULES) {
      try {
        await runPython(candidate, "import " + module, 30_000)
        rapidPython = { python: candidate.command, module }
        return rapidPython
      } catch {
        // 换下一个模块名 / 解释器
      }
    }
  }
  rapidPython = null
  return undefined
}

async function rapidNodeAvailable(): Promise<boolean> {
  try {
    const mod = await importOptional(["@gutenye", "ocr-node"])
    return typeof (mod?.default?.load ?? mod?.load) === "function"
  } catch {
    return false
  }
}

async function ocrWithRapidPython(buffer: Buffer, rapid: RapidPython): Promise<string> {
  const helper = await rapidHelper()
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "novaway-ocr-"))
  const file = path.join(dir, "input.img")
  try {
    await fs.writeFile(file, buffer)
    const result = await run(rapid.python, [helper, file, rapid.module], {
      timeout: CLI_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    })
    return parseRapidOutput(result.stdout ?? "")
      .lines.map((line) => line.text)
      .join(String.fromCharCode(10))
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function probeCli(): Promise<boolean> {
  try {
    const result = await run("tesseract", ["--version"], { timeout: 5_000 })
    return (result.stdout || result.stderr).toLowerCase().includes("tesseract")
  } catch {
    return false
  }
}

async function probeWasm(): Promise<boolean> {
  try {
    const mod = await importOptional(["tesseract", "js"])
    return typeof (mod?.createWorker ?? mod?.default?.createWorker) === "function"
  } catch {
    return false
  }
}

export async function detectOcr(): Promise<OcrBackend> {
  const { mode, languages } = ocrSettings()
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.backend

  let backend: OcrBackend
  const rapid = mode === "off" || mode === "cli" || mode === "wasm" ? undefined : await probeRapidPython()
  if (mode === "off") {
    backend = { kind: "none", label: "OCR 已关闭", languages }
  } else if (mode === "rapid") {
    if (rapid) backend = { kind: "rapid", label: "RapidOCR (" + rapid.module + ")", languages }
    else if (await rapidNodeAvailable())
      backend = { kind: "rapid", label: "RapidOCR (ONNX, @gutenye/ocr-node)", languages }
    else
      backend = {
        kind: "none",
        label: "未安装 RapidOCR（pip install rapidocr_onnxruntime）",
        languages,
      }
  } else if (mode === "cli") {
    backend = (await probeCli())
      ? { kind: "cli", label: "tesseract CLI", languages }
      : { kind: "none", label: "未找到 tesseract CLI", languages }
  } else if (mode === "wasm") {
    backend = (await probeWasm())
      ? { kind: "wasm", label: "tesseract.js (WASM)", languages }
      : { kind: "none", label: "未安装 tesseract.js", languages }
  } else if (rapid) {
    // auto：RapidOCR（PP-OCR 模型）精度最好，优先。
    backend = { kind: "rapid", label: "RapidOCR (" + rapid.module + ")", languages }
  } else if (await rapidNodeAvailable()) {
    backend = { kind: "rapid", label: "RapidOCR (ONNX, @gutenye/ocr-node)", languages }
  } else if (await probeCli()) {
    backend = { kind: "cli", label: "tesseract CLI", languages }
  } else if (await probeWasm()) {
    backend = { kind: "wasm", label: "tesseract.js (WASM)", languages }
  } else {
    backend = { kind: "none", label: "未检测到 OCR 引擎", languages }
  }

  cached = { at: Date.now(), backend }
  return backend
}

/** 手动重置探测结果（用户刚装完引擎时可以立即生效）。 */
export function resetOcrDetection() {
  cached = undefined
  // 一键安装完成后必须同时清掉解释器缓存，否则仍会报「未安装」。
  rapidPython = undefined
}

async function ocrWithCli(buffer: Buffer, languages: string[]): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "novaway-ocr-"))
  const file = path.join(dir, "input.img")
  try {
    await fs.writeFile(file, buffer)
    const result = await run("tesseract", [file, "stdout", "-l", languages.join("+")], {
      timeout: CLI_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
    })
    return result.stdout ?? ""
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function ocrWithWasm(buffer: Buffer, languages: string[]): Promise<string> {
  const mod = await importOptional(["tesseract", "js"])
  const createWorker = mod?.createWorker ?? mod?.default?.createWorker
  const worker = await createWorker(languages.join("+"))
  try {
    const result = await worker.recognize(buffer)
    return result?.data?.text ?? ""
  } finally {
    await worker.terminate().catch(() => undefined)
  }
}

// RapidOCR 的初始化比较重（加载 ONNX 模型），进程内复用同一个实例。
let rapidPromise: Promise<any> | undefined

async function rapidEngine(languages: readonly string[]) {
  if (!rapidPromise) {
    rapidPromise = (async () => {
      const mod = await importOptional(["@gutenye", "ocr-node"])
      const load = mod?.default?.load ?? mod?.load
      return load({ lang: rapidLanguages(languages) })
    })().catch((error) => {
      rapidPromise = undefined
      throw error
    })
  }
  return rapidPromise
}

async function ocrWithRapid(buffer: Buffer, languages: string[]): Promise<string> {
  const engine = await rapidEngine(languages)
  const worker = await engine
  // 引擎 API：ocr(buffer) → [{ text, ... }] 或 { text }
  const result = await worker.ocr(buffer)
  if (typeof result === "string") return result
  if (Array.isArray(result))
    return result
      .map((item: any) => item?.text ?? "")
      .filter(Boolean)
      .join("\n")
  return result?.text ?? ""
}

/** 识别一张图片（PNG/JPEG/WebP/TIFF）。 */
export async function ocrImage(buffer: Buffer, languages?: string[]): Promise<OcrResult> {
  const backend = await detectOcr()
  const langs = languages ?? backend.languages
  if (backend.kind === "none" || backend.kind === "vision") {
    return { text: "", backend: backend.kind, error: backend.label }
  }
  try {
    const rapid = backend.kind === "rapid" ? await probeRapidPython() : undefined
    const text = rapid
      ? await ocrWithRapidPython(buffer, rapid)
      : backend.kind === "rapid"
        ? await ocrWithRapid(buffer, langs)
        : backend.kind === "cli"
          ? await ocrWithCli(buffer, langs)
          : await ocrWithWasm(buffer, langs)
    return { text: text.replace(/\r\n?/g, "\n").trim(), backend: backend.kind }
  } catch (error) {
    return {
      text: "",
      backend: backend.kind,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
