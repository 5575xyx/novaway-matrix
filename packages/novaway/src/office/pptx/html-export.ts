import path from "node:path"
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises"
import JSZip from "jszip"
import { fingerprintHtmlSlides } from "./html-review"
import { runPptxWorker } from "./node-worker"
import { isRecord } from "@/util/record"

export type HtmlPptxExportOptions = {
  deckDir: string
  output?: string
  force?: boolean
  browserChannel?: string
}

export type HtmlPptxPostflight = {
  status: "passed" | "passed-with-warnings"
  slideCount: number
  editableTextRuns: number
  shapeNodes: number
  pictureNodes: number
  warnings: string[]
}

export type HtmlPptxExportResult = {
  output: string
  report: string
  bytes: number
  pages: number
  converted: number
  failed: number
  failures: Array<{ path: string; message: string }>
  postflight: HtmlPptxPostflight
}

const pagePattern = /^page_(\d+)\.html$/i
const acceptedReviewStatuses = new Set(["pass", "passed", "approved", "ready", "通过", "已通过"])
const blockedReviewPattern = /block|blocked|fail|failed|reject|rejected|needs[-_ ]?fix|阻塞|失败|退回|不可交付/i
const remoteAssetPattern = /(?:src|href)\s*=\s*["']https?:\/\/|url\(\s*["']?https?:\/\//i

export async function exportHtmlDeckToPptx(options: HtmlPptxExportOptions): Promise<HtmlPptxExportResult> {
  const deckDir = path.resolve(options.deckDir)
  const pagesDir = path.join(deckDir, "pages")
  const htmlFiles = await listHtmlSlides(pagesDir)
  const warnings = await validateReview(deckDir, htmlFiles, options.force === true)
  await validateLocalAssets(htmlFiles)

  const output = resolveOutput(deckDir, options.output)
  const value = await runPptxWorker({
    mode: "export",
    deckDir,
    htmlFiles,
    output,
    browserChannel: options.browserChannel,
  })
  const build = asBuildResult(value)
  if (build.failCount) {
    const details = build.failures.map((failure) => `${path.basename(failure.path)}: ${failure.message}`)
    throw new Error(`PPTX 构建失败：\n- ${details.join("\n- ")}`)
  }

  const info = await stat(output)
  if (!info.isFile() || info.size === 0) throw new Error("PPTX 构建结束但未生成有效文件")

  const postflight = await inspectPptx(output, htmlFiles.length, warnings)
  const report = path.join(deckDir, "validation", "pptx-export-report.json")
  const result = {
    output,
    report,
    bytes: info.size,
    pages: build.totalPages,
    converted: build.successCount,
    failed: build.failCount,
    failures: build.failures,
    postflight,
  } satisfies HtmlPptxExportResult

  await mkdir(path.dirname(report), { recursive: true })
  await writeFile(
    report,
    `${JSON.stringify(
      {
        schema: "novaway.office-pptx-export-report.v1",
        generatedAt: new Date().toISOString(),
        source: { deckDir, htmlFiles },
        ...result,
      },
      null,
      2,
    )}\n`,
    "utf8",
  )

  return result
}

function asBuildResult(value: unknown): {
  successCount: number
  failCount: number
  totalPages: number
  failures: Array<{ path: string; message: string }>
} {
  if (
    !isRecord(value) ||
    typeof value.successCount !== "number" ||
    typeof value.failCount !== "number" ||
    typeof value.totalPages !== "number" ||
    !Array.isArray(value.failures)
  ) {
    throw new Error("PPT 导出进程返回了无效结果")
  }
  return {
    successCount: value.successCount,
    failCount: value.failCount,
    totalPages: value.totalPages,
    failures: value.failures.filter(
      (item): item is { path: string; message: string } =>
        isRecord(item) && typeof item.path === "string" && typeof item.message === "string",
    ),
  }
}

export async function listHtmlSlides(pagesDir: string) {
  const entries = await readdir(pagesDir, { withFileTypes: true }).catch(() => [])
  const files = entries
    .filter((entry) => entry.isFile() && pagePattern.test(entry.name))
    .map((entry) => ({ name: entry.name, page: Number(pagePattern.exec(entry.name)?.[1] ?? 0) }))
    .toSorted((a, b) => a.page - b.page || a.name.localeCompare(b.name))
    .map((entry) => path.join(pagesDir, entry.name))
  if (!files.length) throw new Error(`PPT 工作区中没有 page_*.html：${pagesDir}`)
  return files
}

export function resolveOutput(deckDir: string, output?: string) {
  const requested = output?.trim() || `${path.basename(deckDir)}.pptx`
  const target = path.isAbsolute(requested) ? requested : path.join(deckDir, requested)
  return path.resolve(target.toLowerCase().endsWith(".pptx") ? target : `${target}.pptx`)
}

export async function validateReview(deckDir: string, htmlFiles: string[], force: boolean) {
  const jsonPath = path.join(deckDir, "review.json")
  const markdownPath = path.join(deckDir, "review.md")
  const json = await readFile(jsonPath, "utf8").catch(() => undefined)
  const markdown = await readFile(markdownPath, "utf8").catch(() => undefined)
  const missing = !json && !markdown
  if (missing && force) return ["缺少视觉审查报告，已通过 --force 明确跳过"]
  if (missing) throw new Error("缺少 review.json 或 review.md；视觉审查通过后才能导出")

  if (json) {
    const review = parseReview(json, jsonPath)
    const status = reviewStatus(review)
    if (blockedReviewPattern.test(status)) throw new Error(`视觉审查未通过：${status}`)
    if (acceptedReviewStatuses.has(status.toLowerCase())) {
      const fingerprint = typeof review.sourceFingerprint === "string" ? review.sourceFingerprint : undefined
      const current = await fingerprintHtmlSlides(htmlFiles)
      if (fingerprint === current) return []
      if (force) return ["视觉审查报告缺少当前页面指纹或已经过期，已通过 --force 明确跳过"]
      throw new Error("视觉审查报告与当前 HTML 页面不匹配，请重新执行 --review-only")
    }
    if (force) return [`视觉审查状态无法确认（${status || "未填写"}），已通过 --force 明确跳过`]
    throw new Error(`review.json 必须明确标记为 passed/approved/通过，当前状态：${status || "未填写"}`)
  }

  const status = markdown?.match(/(?:status|状态)\s*[:：]\s*([^\n]+)/i)?.[1]?.trim() ?? ""
  if (blockedReviewPattern.test(`${status}\n${markdown}`))
    throw new Error(`视觉审查未通过：${status || "review.md 含阻断项"}`)
  if (acceptedReviewStatuses.has(status.toLowerCase())) return []
  if (force) return [`review.md 未给出可识别的通过状态，已通过 --force 明确跳过`]
  throw new Error("review.md 必须包含 status: passed 或 状态：通过")
}

function parseReview(input: string, filename: string): Record<string, unknown> {
  const value = JSON.parse(input) as unknown
  if (!isRecord(value)) throw new Error(`无效的视觉审查报告：${filename}`)
  return value
}

function reviewStatus(review: Record<string, unknown>) {
  for (const key of ["status", "result", "decision"]) {
    const value = review[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return ""
}

async function validateLocalAssets(htmlFiles: string[]) {
  const remote = (
    await Promise.all(htmlFiles.map(async (file) => ({ file, content: await readFile(file, "utf8") })))
  ).filter((item) => remoteAssetPattern.test(item.content))
  if (!remote.length) return
  throw new Error(
    `PPT 页面仍引用远程资源，请先下载到工作区：${remote.map((item) => path.basename(item.file)).join("、")}`,
  )
}

export async function inspectPptx(
  output: string,
  expectedSlides: number,
  warnings: string[],
): Promise<HtmlPptxPostflight> {
  const bytes = await readFile(output)
  const zip = await JSZip.loadAsync(bytes)
  const entries = Object.keys(zip.files)
  if (!entries.includes("[Content_Types].xml") || !entries.includes("ppt/presentation.xml")) {
    throw new Error("PPTX 后检失败：缺少必要的 OOXML 包文件")
  }

  const slides = entries
    .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry))
    .toSorted((a, b) => slideNumber(a) - slideNumber(b))
  if (slides.length !== expectedSlides) {
    throw new Error(`PPTX 后检失败：预期 ${expectedSlides} 页，实际 ${slides.length} 页`)
  }

  const xml = await Promise.all(
    slides.map((slide) => {
      const entry = zip.file(slide)
      return entry ? entry.async("string") : Promise.resolve("")
    }),
  )
  const editableTextRuns = xml.reduce((total, slide) => total + count(slide, "<a:t>"), 0)
  const shapeNodes = xml.reduce((total, slide) => total + count(slide, "<p:sp>"), 0)
  const pictureNodes = xml.reduce((total, slide) => total + count(slide, "<p:pic>"), 0)
  if (!shapeNodes || !editableTextRuns) {
    throw new Error("PPTX 后检失败：未检测到可编辑文本和原生形状，拒绝交付扁平化空壳")
  }

  return {
    status: warnings.length ? "passed-with-warnings" : "passed",
    slideCount: slides.length,
    editableTextRuns,
    shapeNodes,
    pictureNodes,
    warnings,
  }
}

function count(input: string, token: string) {
  return input.split(token).length - 1
}

function slideNumber(input: string) {
  return Number(input.match(/slide(\d+)\.xml$/)?.[1] ?? 0)
}
