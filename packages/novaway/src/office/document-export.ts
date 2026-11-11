/**
 * 按路径的文档导出：右侧面板和 Agent 共用的一条只读通道。
 *
 * 和编辑不同，导出不写回原文件、不动会话状态，只把当前内容换成另一种格式。
 * 目标格式用扩展名/别名表示（`csv` / `md` / `txt` / `html`），
 * 引擎说不认识就原样把错误交给上层（带一句「支持哪些」）。
 */
import type { OfficeEngineOptions, OfficeFormat } from "@novaway/core/office/engine/contract"
import { fail, ok, type OfficeResult } from "@novaway/core/office/engine/contract"
import { engineFor } from "@novaway/core/office/engine/registry"
import { openPdfBytes } from "@novaway/core/office/pdf/engine"
import { RasterError, rasterizePdf } from "./raster"
import { runtimeEngineFor, type RuntimeOfficeRegistry } from "./runtime"

export type DocumentExportResult = {
  /** 导出后的完整内容。 */
  bytes: Uint8Array
  /** 规范化后的目标格式（不带点）。 */
  target: string
  mime: string
}

const MIME: Record<string, string> = {
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  html: "text/html",
  htm: "text/html",
  md: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
  text: "text/plain",
  json: "application/json",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  png: "image/png",
}

/** 二进制目标（docx/xlsx/pptx）没法塞进 UTF-8 字符串，HTTP 层要按 base64 传。 */
export function isBinaryExportTarget(target: string): boolean {
  const mime = MIME[target]
  return mime !== undefined && !mime.startsWith("text/") && mime !== "application/json"
}

export function normalizeExportTarget(input: string): string {
  const value = input.trim().toLowerCase().replace(/^\./, "")
  return value === "markdown" ? "md" : value === "text" ? "txt" : value
}

/** PNG 是一张图：一次只出一页，面板 / 工具里按 `page` 指定（默认第 1 页）。 */
export type DocumentExportOptions = OfficeEngineOptions & {
  registry?: RuntimeOfficeRegistry
  page?: number
  /** 位图缩放（1 = 72 dpi）；默认 2。 */
  scale?: number
}

export async function exportDocumentAs(
  bytes: Uint8Array,
  format: OfficeFormat | undefined,
  target: string,
  options: DocumentExportOptions = {},
): Promise<OfficeResult<DocumentExportResult>> {
  if (!format) return fail("unsupported_format", "暂不支持导出这种文件")
  const engine = runtimeEngineFor(format, options.registry) ?? engineFor(format)
  if (!engine) return fail("unsupported_format", "暂不支持 " + format + " 文件")
  if (!engine.export) {
    return fail("unsupported_format", format + " 暂不支持导出", "可以先在右栏里打开它，再复制内容")
  }

  const kind = normalizeExportTarget(target)
  if (!kind) return fail("invalid_params", "没有指定导出格式")

  // 导出读的是「解析后的状态」（段落 / 工作表 / 块），所以先按同一条 open 解析一次。
  const opened = await (
    engine as { open: (input: Uint8Array, options?: OfficeEngineOptions) => Promise<OfficeResult<unknown>> }
  ).open(bytes, options)
  if (!opened.ok) return opened

  // PNG：先排成 PDF（PDF 源文件本身就直接用），再交给位图渲染器画一页。
  // `export <file> out.png --page N` 走这条路：一次一张图。
  if (kind === "png") {
    // 加密 PDF：先按密码解出一份普通字节，位图渲染器只认未加密的 PDF。
    const pdfBytes =
      format === "pdf" ? await plainPdfBytes(bytes, options.password) : await toPdfBytes(engine, opened.data, bytes)
    if (!pdfBytes.ok) return pdfBytes
    const page = options.page ?? 1
    try {
      const [rendered] = await rasterizePdf(pdfBytes.data, {
        pages: [page],
        ...(options.scale === undefined ? {} : { scale: options.scale }),
      })
      if (!rendered) return fail("engine", "没有画出页面 " + page)
      return ok({ bytes: rendered.png, target: "png", mime: MIME.png })
    } catch (error) {
      if (error instanceof RasterError) return fail(error.code, error.message, "PNG 导出需要本机可用的位图渲染器")
      return fail("engine", "PNG 导出失败：" + (error instanceof Error ? error.message : String(error)))
    }
  }

  const result = await engine.export(opened.data, kind, bytes)
  if (!result.ok) return result
  return ok({ bytes: result.data, target: kind, mime: MIME[kind] ?? "application/octet-stream" })
}

async function plainPdfBytes(bytes: Uint8Array, password?: string): Promise<OfficeResult<Uint8Array>> {
  const opened = await openPdfBytes(bytes, password)
  if (!opened.ok) return opened
  return ok(opened.data.bytes)
}

/** 把解析后的状态排成 PDF 字节（PNG 的中间产物；PDF 源文件跳过这一步）。 */
async function toPdfBytes(
  engine: { export?: (state: unknown, target: string, bytes: Uint8Array) => Promise<OfficeResult<Uint8Array>> },
  state: unknown,
  bytes: Uint8Array,
): Promise<OfficeResult<Uint8Array>> {
  if (!engine.export) return fail("unsupported_format", "这种格式不能排成 PDF", "可以先导出成 docx / html 再转")
  return engine.export(state, "pdf", bytes)
}
