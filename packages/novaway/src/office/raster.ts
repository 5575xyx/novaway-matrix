/**
 * PDF → PNG 栅格化（导出的「看一眼」通道）。
 *
 * `export in.pdf page1.png --page 1` 和 `export deck.pptx slide2.png --page 2`
 * 都落在同一条路上：先把文档排成 PDF（引擎的 printToPdf），再逐页画成位图。
 * 这里补上后半段：pdf.js 负责解释页面内容，@napi-rs/canvas 负责真正的像素。
 *
 * 两个依赖都是懒加载：
 *   - 只导出文本的调用完全不会碰到它们；
 *   - 面板（浏览器）里不会打包原生 canvas，PNG 导出统一走服务端这条通道。
 */
import path from "node:path"
import { createRequire } from "node:module"
import type { PDFDocumentProxy } from "pdfjs-dist"

export type RasterPage = {
  /** 1 起的页码。 */
  page: number
  width: number
  height: number
  png: Uint8Array
}

export type RasterOptions = {
  /** 要画哪几页（1 起）；省略时画全部。 */
  pages?: readonly number[]
  /** 缩放倍数（1 = 72 dpi）；默认 2，屏幕上看足够清楚。 */
  scale?: number
}

export class RasterError extends Error {
  constructor(
    message: string,
    readonly code: "unsupported_format" | "invalid_params" | "open_failed" | "engine" = "engine",
  ) {
    super(message)
    this.name = "RasterError"
  }
}

type CanvasModule = typeof import("@napi-rs/canvas")

let canvas: CanvasModule | undefined

/**
 * 用 pdf.js 自己的解析路径来取 canvas。
 *
 * pdf.js 在 Node 里用 `createRequire(import.meta.url)("@napi-rs/canvas")` 建画布；
 * 如果我们自己再 `import` 一份，解析结果可能落在不同目录（两个原生模块副本），
 * 画带图片的页面时两边各自持有 skia 上下文，进程会直接段错误。
 * 跟着它的加载器走，才能保证全程只有一份原生扩展。
 */
function canvasLoader() {
  const require = createRequire(import.meta.url)
  try {
    return createRequire(require.resolve("pdfjs-dist/legacy/build/pdf.mjs"))
  } catch {
    return require
  }
}

async function loadCanvas(): Promise<CanvasModule> {
  if (canvas) return canvas
  try {
    canvas = canvasLoader()("@napi-rs/canvas") as CanvasModule
  } catch (error) {
    throw new RasterError(
      "当前环境缺少位图渲染器（@napi-rs/canvas），没法把 PDF 转成 PNG：" +
        (error instanceof Error ? error.message : String(error)),
      "unsupported_format",
    )
  }
  // pdf.js 在 Node 里画字和图形要靠 DOM 风格的这几个全局对象。
  const scope = globalThis as Record<string, unknown>
  scope.DOMMatrix ??= canvas.DOMMatrix
  scope.ImageData ??= canvas.ImageData
  scope.Path2D ??= canvas.Path2D
  return canvas
}

/**
 * pdf.js 的同包资源目录（cmaps / standard_fonts）。
 * 打包成单文件二进制时可能找不到 node_modules，这时退回 undefined：
 * 西文照常画，CJK 会缺字形而不是整页失败。
 */
let pdfjsRoot: string | undefined | null = null

function pdfjsBase(): string | undefined {
  if (pdfjsRoot !== null) return pdfjsRoot
  try {
    const require = createRequire(import.meta.url)
    pdfjsRoot = path.dirname(require.resolve("pdfjs-dist/package.json")) + path.sep
  } catch {
    pdfjsRoot = undefined
  }
  return pdfjsRoot
}

/** 打开一份 PDF（调用方负责先解密）。 */
async function openDocument(bytes: Uint8Array) {
  // legacy 构建才带 Node 需要的 canvas / 二进制读取兜底；类型声明是官方的，
  // 但 DocumentInitParameters 里暂时没有 isEvalSupported，用一次断言补上。
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as typeof import("pdfjs-dist")
  const getDocument = pdfjs.getDocument as (source: Record<string, unknown>) => { promise: Promise<PDFDocumentProxy> }
  // pdf.js 会「接管」传进去的缓冲区，复制一份，别让调用方的字节被 detach。
  const data = new Uint8Array(bytes.length)
  data.set(bytes)
  try {
    const base = pdfjsBase()
    return await getDocument({
      data,
      useSystemFonts: true,
      isEvalSupported: false,
      // 中文 / 日文这类 CID 字体要靠 CMap 才能对上字形；标准字体数据是内置 14 字体的兜底。
      ...(base ? { cMapUrl: base + "cmaps/", cMapPacked: true, standardFontDataUrl: base + "standard_fonts/" } : {}),
    }).promise
  } catch (error) {
    throw new RasterError("无法解析 PDF：" + (error instanceof Error ? error.message : String(error)), "open_failed")
  }
}

/** 把 PDF 的指定页画成 PNG。pages 省略时画全部；返回顺序与页码一致。 */
export async function rasterizePdf(bytes: Uint8Array, options: RasterOptions = {}): Promise<RasterPage[]> {
  const canvasModule = await loadCanvas()
  const document: PDFDocumentProxy = await openDocument(bytes)
  try {
    const total = document.numPages
    if (total === 0) throw new RasterError("这份 PDF 里没有页面", "open_failed")
    const pages = options.pages?.length ? options.pages : Array.from({ length: total }, (_, index) => index + 1)
    for (const page of pages) {
      if (!Number.isInteger(page) || page < 1 || page > total) {
        throw new RasterError(`页码超出范围：${page}（共 ${total} 页）`, "invalid_params")
      }
    }
    const scale = options.scale !== undefined && options.scale > 0 ? options.scale : 2
    const rendered: RasterPage[] = []
    for (const number of pages) {
      const page = await document.getPage(number)
      const viewport = page.getViewport({ scale })
      const width = Math.max(1, Math.ceil(viewport.width))
      const height = Math.max(1, Math.ceil(viewport.height))
      const target = canvasModule.createCanvas(width, height)
      const context = target.getContext("2d")
      // 白底：PDF 页面默认是纸，透明底在聊天窗口里会变成黑/灰。
      context.fillStyle = "#ffffff"
      context.fillRect(0, 0, width, height)
      await page.render({ canvasContext: context as never, viewport, canvas: target as never }).promise
      rendered.push({ page: number, width, height, png: new Uint8Array(await target.encode("png")) })
      page.cleanup()
    }
    return rendered
  } finally {
    await document.destroy()
  }
}
