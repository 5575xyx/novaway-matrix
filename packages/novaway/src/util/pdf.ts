// PDF 读取的两条路径，对齐 CC（src/utils/pdf.ts / pdfUtils.ts）：
//
// 1. 直接内联：整份 PDF 作为附件交给模型（体积小、页数少时最省事）。
// 2. 分页渲染：用 poppler 的 pdftoppm 把指定页渲染成 JPEG 再作为图片附件，
//    用于大文件、页数过多、或模型不支持 PDF document block 的情况。
//
// 页数查询用 pdfinfo。两者都来自 poppler-utils，缺失时给出可执行的安装提示，
// 而不是抛一个看不懂的 spawn 错误。

import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

/** 单次 pages 参数最多渲染的页数。 */
export const MAX_PAGES_PER_READ = 20
/** 页数超过该值时不整份内联，提示模型改用 pages。 */
export const INLINE_PAGE_THRESHOLD = 10
/** 超过该体积时改为分页渲染，避免整份 base64 撑爆请求。 */
export const EXTRACT_SIZE_THRESHOLD = 3 * 1024 * 1024
/** 分页渲染路径能接受的最大文件体积。 */
export const MAX_EXTRACT_SIZE = 100 * 1024 * 1024

export type PdfError = {
  reason: "empty" | "too_large" | "password_protected" | "corrupted" | "unknown" | "unavailable"
  message: string
}

export type PdfResult<T> = { ok: true; data: T } | { ok: false; error: PdfError }

/** 解析 "5" / "1-10" / "3-" 。1-indexed，非法输入返回 undefined。 */
export function parsePageRange(input: string): { firstPage: number; lastPage: number } | undefined {
  const trimmed = input.trim()
  if (!trimmed) return undefined

  if (trimmed.endsWith("-")) {
    const first = Number.parseInt(trimmed.slice(0, -1), 10)
    if (!Number.isFinite(first) || first < 1) return undefined
    return { firstPage: first, lastPage: Number.POSITIVE_INFINITY }
  }

  const dash = trimmed.indexOf("-")
  if (dash === -1) {
    const page = Number.parseInt(trimmed, 10)
    if (!Number.isFinite(page) || page < 1) return undefined
    return { firstPage: page, lastPage: page }
  }

  const first = Number.parseInt(trimmed.slice(0, dash), 10)
  const last = Number.parseInt(trimmed.slice(dash + 1), 10)
  if (!Number.isFinite(first) || !Number.isFinite(last) || first < 1 || last < 1 || last < first) return undefined
  return { firstPage: first, lastPage: last }
}

/** pages 参数的完整校验，和 CC 的报错文案保持一致。 */
export function validatePageRange(input: string): string | undefined {
  const parsed = parsePageRange(input)
  if (!parsed) {
    return `Invalid pages parameter: "${input}". Use formats like "1-5", "3", or "10-20". Pages are 1-indexed.`
  }
  const size =
    parsed.lastPage === Number.POSITIVE_INFINITY ? MAX_PAGES_PER_READ + 1 : parsed.lastPage - parsed.firstPage + 1
  if (size > MAX_PAGES_PER_READ) {
    return `Page range "${input}" exceeds maximum of ${MAX_PAGES_PER_READ} pages per request. Please use a smaller range.`
  }
  return undefined
}

type Exec = { code: number; stdout: string; stderr: string }

function run(command: string, args: string[], timeoutMs: number): Promise<Exec> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
    let stdout = ""
    let stderr = ""
    let settled = false
    const finish = (result: Exec) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => {
      child.kill()
      finish({
        code: 124,
        stdout,
        stderr: `${stderr}
${command} timed out after ${timeoutMs}ms`,
      })
    }, timeoutMs)
    child.stdout?.on("data", (chunk) => (stdout += chunk.toString()))
    child.stderr?.on("data", (chunk) => (stderr += chunk.toString()))
    child.on("error", (error) => finish({ code: 127, stdout: "", stderr: String(error) }))
    child.on("close", (code) => finish({ code: code ?? 1, stdout, stderr }))
  })
}

const installed = new Map<string, boolean>()

async function available(binary: string) {
  const cached = installed.get(binary)
  if (cached !== undefined) return cached
  // pdftoppm -v 把版本写到 stderr 并可能以 99 退出，所以只看有没有输出。
  const result = await run(binary, ["-v"], 5_000)
  // spawn 失败（ENOENT）时 stderr 里也有内容，必须先把这种情况排除。
  const missing = result.code === 127 || /ENOENT|not found|Executable not found/i.test(result.stderr)
  const ok = !missing && (result.code === 0 || result.stderr.length > 0 || result.stdout.length > 0)
  installed.set(binary, ok)
  return ok
}

/** 测试里重置二进制探测缓存。 */
export function resetProbeCache() {
  installed.clear()
}

function failure(reason: PdfError["reason"], message: string): PdfResult<never> {
  return { ok: false, error: { reason, message } }
}

function describe(exec: Exec) {
  return exec.stderr.trim() || exec.stdout.trim() || `exit code ${exec.code}`
}

/** 用 pdfinfo 取页数；缺失或解析失败时返回 undefined（调用方按未知处理）。 */
export async function pageCount(filePath: string): Promise<number | undefined> {
  if (!(await available("pdfinfo"))) return undefined
  const result = await run("pdfinfo", [filePath], 10_000)
  if (result.code !== 0) return undefined
  const match = /^Pages:\s+(\d+)/m.exec(result.stdout)
  if (!match) return undefined
  const count = Number.parseInt(match[1]!, 10)
  return Number.isNaN(count) ? undefined : count
}

/**
 * 整份 PDF 内联。会先验空、验体积、验 %PDF- 魔数。
 * 魔数校验很关键：把假 PDF（例如改了后缀的 HTML）放进上下文后，
 * 之后每一次 API 调用都会 400，会话只能靠 /clear 恢复。
 */
export async function readWhole(filePath: string, size: number): Promise<PdfResult<{ base64: string; size: number }>> {
  if (size === 0) return failure("empty", `PDF file is empty: ${filePath}`)
  if (size > MAX_EXTRACT_SIZE) {
    return failure("too_large", `PDF file exceeds maximum allowed size of ${formatSize(MAX_EXTRACT_SIZE)}.`)
  }
  let bytes: Buffer
  try {
    bytes = await fs.readFile(filePath)
  } catch (error) {
    return failure("unknown", error instanceof Error ? error.message : String(error))
  }
  if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
    return failure("corrupted", `File is not a valid PDF (missing %PDF- header): ${filePath}`)
  }
  return { ok: true, data: { base64: bytes.toString("base64"), size: bytes.length } }
}

/**
 * 用 pdftoppm 把页面渲染成 JPEG。渲染结果读进内存后立刻删掉临时目录，
 * 不在磁盘上留垃圾。
 */
export async function extractPages(
  filePath: string,
  size: number,
  range?: { firstPage: number; lastPage: number },
): Promise<PdfResult<{ images: { mime: string; base64: string }[]; count: number; size: number }>> {
  if (size === 0) return failure("empty", `PDF file is empty: ${filePath}`)
  if (size > MAX_EXTRACT_SIZE) {
    return failure(
      "too_large",
      `PDF file exceeds maximum allowed size for text extraction (${formatSize(MAX_EXTRACT_SIZE)}).`,
    )
  }
  if (!(await available("pdftoppm"))) {
    return failure(
      "unavailable",
      "pdftoppm is not installed. Install poppler-utils (e.g. `brew install poppler` or `apt-get install poppler-utils`) to enable PDF page rendering.",
    )
  }

  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), `pdf-${randomUUID().slice(0, 8)}-`))
  try {
    const prefix = path.join(outputDir, "page")
    const args = ["-jpeg", "-r", "100"]
    if (range?.firstPage) args.push("-f", String(range.firstPage))
    if (range && range.lastPage !== Number.POSITIVE_INFINITY) args.push("-l", String(range.lastPage))
    args.push(filePath, prefix)

    const result = await run("pdftoppm", args, 120_000)
    if (result.code !== 0) {
      const detail = describe(result)
      if (/password/i.test(detail)) {
        return failure("password_protected", "PDF is password-protected. Please provide an unprotected version.")
      }
      if (/damaged|corrupt|invalid/i.test(detail)) return failure("corrupted", "PDF file is corrupted or invalid.")
      return failure("unknown", `pdftoppm failed: ${detail}`)
    }

    const entries = (await fs.readdir(outputDir)).filter((name) => /\.jpe?g$/i.test(name))
    entries.sort((a, b) => {
      const left = Number.parseInt(a.match(/\d+/)![0]!, 10)
      const right = Number.parseInt(b.match(/\d+/)![0]!, 10)
      return left - right
    })
    const images = await Promise.all(
      entries.map(async (name) => ({
        mime: "image/jpeg",
        base64: (await fs.readFile(path.join(outputDir, name))).toString("base64"),
      })),
    )
    return { ok: true, data: { images, count: images.length, size } }
  } catch (error) {
    return failure("unknown", error instanceof Error ? error.message : String(error))
  } finally {
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {})
  }
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`
}
