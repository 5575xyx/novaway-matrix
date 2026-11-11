/**
 * PPTX 引擎：布局模型一律用 **pt**，只在读写 XML 时换成 EMU。
 *
 * 这是「宿主 + 编辑器适配」思路的落地：渲染器只负责画，
 * 编辑定位靠原始 XML 里的 `p:cNvPr@id`，写回只重写目标 slide XML，
 * 其它 zip 条目逐字节拷贝。
 */

import {
  editPptx,
  editPptxMeta,
  editPptxSlides,
  readPptxDocument,
  type PptxLayoutNode,
  type PptxShapeOp,
  type PptxSlideMeta,
  type PptxSlideOp,
  type PptxTextStyle,
} from "../pptx-edit"
import type { ApplyOutcome, OfficeEngine, OfficeOp, OfficeResult } from "./contract"
import { fail, ok } from "./contract"
import { slidesToHtml, slidesToMarkdown, slidesToText, type PlainSlide } from "./export"
import { boxEmuToPt, boxPtToEmu, emuToPt, type BoxPt } from "./units"
import { printToPdf, type PrintSlideImage } from "../pdf/print"
import { inflateEntry, readZip } from "./zip"

/** UI / Agent 看到的节点：几何是 pt。 */
export type PptxNodePt = Omit<PptxLayoutNode, "box" | "cells"> & {
  box?: BoxPt
  cells?: Array<Omit<NonNullable<PptxLayoutNode["cells"]>[number], "box"> & { box?: BoxPt }>
}

export type PptxState = {
  /** 页面尺寸，pt（16:9 通常是 960×540）。 */
  size: { w: number; h: number }
  nodes: PptxNodePt[]
  /** 页数：空页没有可编辑对象，不在这里就没法在面板里选到它。 */
  slideCount: number
  /** 可选版式：新建页时可以让用户挑一张。 */
  layouts: Array<{ index: number; name: string; part: string }>
  /** 每页的备注与隐藏标记（按演示顺序）。 */
  slides: PptxSlideMeta[]
}

function toPt(node: PptxLayoutNode): PptxNodePt {
  const { box, cells, ...rest } = node
  return {
    ...rest,
    ...(box ? { box: boxEmuToPt(box) } : {}),
    ...(cells
      ? {
          cells: cells.map((cell) => {
            const { box: cellBox, ...cellRest } = cell
            return { ...cellRest, ...(cellBox ? { box: boxEmuToPt(cellBox) } : {}) }
          }),
        }
      : {}),
  }
}

const TITLE_NAME = /^\s*(title|标题)/i

const linesOf = (node: PptxNodePt): string[] =>
  node.paragraphs.map((paragraph) => paragraph.trim()).filter((paragraph) => paragraph.length > 0)

/**
 * 状态 → 逐页的纯文字大纲。
 *
 * 标题靠形状名认（PowerPoint / WPS / Keynote 都会写「Title」或「标题」）；
 * 认不出来时退一步拿页上第一段文字当标题 —— 导出的文本至少保持「页 + 要点」的形状，
 * 不会因为占位符没命名就整页糊成一段。
 */
export function toPlainSlides(state: PptxState): PlainSlide[] {
  const bySlide = new Map<number, PptxNodePt[]>()
  for (const node of state.nodes) {
    const list = bySlide.get(node.slide) ?? []
    list.push(node)
    bySlide.set(node.slide, list)
  }

  return [...bySlide.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([, nodes]) => {
      // 组合块会把子形状的文字一起带出来；子形状已经单独出现了，
      // 这里跳过它，否则同一段话会在导出里出现两遍。
      const childIds = new Set(nodes.map((node) => node.parentId).filter(Boolean))
      const own = nodes.filter((node) => !(node.kind === "group" && childIds.has(node.shapeId)))
      const titleNode = own.find((node) => node.kind !== "picture" && TITLE_NAME.test(node.shapeName ?? ""))
      const title = titleNode ? linesOf(titleNode).join(" ") : undefined
      const lines: string[] = []
      for (const node of own) {
        if (node === titleNode) continue
        if (node.kind === "table" && node.cells) {
          // 表格按单元格一行一行摊开：导出的是内容，不是版式。
          for (const cell of node.cells) {
            const text = cell.paragraphs
              .map((paragraph) => paragraph.trim())
              .filter(Boolean)
              .join(" ")
            if (text) lines.push(text)
          }
          continue
        }
        lines.push(...linesOf(node))
      }
      const index = nodes[0]!.slide
      if (title === undefined && lines.length > 0) return { index, title: lines.shift()!, lines }
      return { index, title, lines }
    })
}

// ---------------------------------------------------------------------------
// 导出用：把每页的图片读成字节
// ---------------------------------------------------------------------------

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
}

/** slide rels 的 Target（相对 ppt/slides）→ 包内部件名。 */
function mediaPartOf(target: string): string {
  if (target.startsWith("/")) return target.slice(1)
  const stack = ["ppt", "slides"]
  for (const piece of target.split("/")) {
    if (piece === "" || piece === ".") continue
    if (piece === "..") stack.pop()
    else stack.push(piece)
  }
  return stack.join("/")
}

/** 读出所有图片节点的媒体字节；读不出来的跳过，不影响文字排版。 */
async function pptxPrintImages(bytes: Uint8Array, state: PptxState): Promise<PrintSlideImage[]> {
  const pictures = state.nodes.filter((node) => node.kind === "picture" && node.image?.target)
  if (pictures.length === 0) return []
  const images: PrintSlideImage[] = []
  try {
    const zip = await readZip(bytes)
    for (const node of pictures) {
      const part = mediaPartOf(node.image!.target)
      const entry = zip.entries.find((item) => item.name === part)
      if (!entry) continue
      const ext = part.slice(part.lastIndexOf(".") + 1).toLowerCase()
      const mime = IMAGE_MIME[ext]
      if (!mime) continue
      images.push({
        slide: node.slide,
        data: await inflateEntry(zip, entry),
        mime,
        ...(node.box ? { box: node.box } : {}),
      })
    }
  } catch {
    return []
  }
  return images
}

export const pptxEngine: OfficeEngine<PptxState> = {
  format: "pptx",

  async open(bytes) {
    try {
      const doc = await readPptxDocument(bytes)
      return ok({
        size: { w: emuToPt(doc.size.w), h: emuToPt(doc.size.h) },
        nodes: doc.nodes.map(toPt),
        slideCount: doc.slideCount,
        layouts: doc.layouts,
        slides: doc.slides,
      })
    } catch (error) {
      return fail("open_failed", error instanceof Error ? error.message : "无法解析 PPTX")
    }
  },

  async apply(state, ops, bytes): Promise<OfficeResult<ApplyOutcome<PptxState>>> {
    type EditInput = Parameters<typeof editPptx>[0]
    type TextEdit = NonNullable<EditInput["textEdits"]>[number]
    type ShapeEdit = NonNullable<EditInput["shapeEdits"]>[number]
    type ImageEdit = NonNullable<EditInput["imageEdits"]>[number]
    const textEdits: TextEdit[] = []
    const shapeEdits: ShapeEdit[] = []
    const imageEdits: ImageEdit[] = []
    const shapeOps: PptxShapeOp[] = []
    const slideOps: PptxSlideOp[] = []
    const metaOps: Array<
      | { op: "setSlideNotes"; slide: number; text: string }
      | { op: "setSlideHidden"; slide: number; hidden: boolean }
      | { op: "setSlideLayout"; slide: number; layout: string }
    > = []
    const applied: unknown[] = []

    for (const op of ops) {
      switch (op.op) {
        // 页面结构操作只改 presentation.xml，和「按页/形状 id 定位」的内容操作
        // 混在一批里会互相错位，所以要求分两次调用。
        case "deleteSlide":
        case "moveSlide":
        case "duplicateSlide":
          if (!Number.isInteger(op.op === "moveSlide" ? op.from : op.slide)) {
            return fail("invalid_params", "页码必须是整数")
          }
          slideOps.push(op)
          applied.push(op)
          break
        case "addSlide":
          if (op.after !== undefined && (!Number.isInteger(op.after) || op.after < 0)) {
            return fail("invalid_params", "插入位置必须是非负整数（0 = 最前面）")
          }
          slideOps.push(op)
          applied.push(op)
          break
        case "addTextBox":
          if (!Number.isInteger(op.slide) || op.slide < 1) return fail("invalid_params", "addTextBox 必须给页码")
          shapeOps.push({
            op: "addTextBox",
            slide: op.slide,
            ...(op.box ? { box: boxPtToEmu(op.box) } : {}),
            text: op.text,
            ...(op.style ? { style: op.style as PptxTextStyle } : {}),
          })
          applied.push(op)
          break
        case "addShape":
          if (!Number.isInteger(op.slide) || op.slide < 1) return fail("invalid_params", "addShape 必须给页码")
          shapeOps.push({
            op: "addShape",
            slide: op.slide,
            kind: op.kind,
            ...(op.box ? { box: boxPtToEmu(op.box) } : {}),
            ...(op.fill ? { fill: op.fill } : {}),
            ...(op.line ? { line: op.line } : {}),
            ...(op.text ? { text: op.text } : {}),
            ...(op.style ? { style: op.style as PptxTextStyle } : {}),
          })
          applied.push(op)
          break
        case "deleteShape":
          if (!Number.isInteger(op.slide) || op.slide < 1) return fail("invalid_params", "deleteShape 必须给页码")
          if (!op.shapeId && !op.shapeName) return fail("invalid_params", "deleteShape 需要 shapeId 或 shapeName")
          shapeOps.push({
            op: "deleteShape",
            slide: op.slide,
            ...(op.shapeId ? { shapeId: op.shapeId } : {}),
            ...(op.shapeName ? { shapeName: op.shapeName } : {}),
          })
          applied.push(op)
          break
        case "setParagraphText":
          if (!op.slide || !op.shapeId) return fail("invalid_params", "PPTX 改段落文字必须给 slide 和 shapeId")
          textEdits.push({
            slide: op.slide,
            shapeId: op.shapeId,
            paragraph: op.paragraph,
            text: op.text,
          })
          applied.push(op)
          break
        case "setParagraphStyle":
          if (!op.slide || !op.shapeId) return fail("invalid_params", "PPTX 改段落格式必须给 slide 和 shapeId")
          textEdits.push({
            slide: op.slide,
            shapeId: op.shapeId,
            paragraph: op.paragraph,
            style: op.style as PptxTextStyle,
          })
          applied.push(op)
          break
        case "setShapeBox":
          shapeEdits.push({ slide: op.slide, shapeId: op.shapeId, box: boxPtToEmu(op.box) })
          applied.push(op)
          break
        case "rotateShape":
          shapeEdits.push({ slide: op.slide, shapeId: op.shapeId, rotation: op.degrees })
          applied.push(op)
          break
        case "replaceImage":
          imageEdits.push({
            slide: op.slide,
            shapeId: op.shapeId,
            data: op.data,
            mime: op.mime,
          })
          applied.push(op)
          break
        case "renameShape":
          if (!Number.isInteger(op.slide) || op.slide < 1) return fail("invalid_params", "renameShape 必须给页码")
          if (!op.shapeId && !op.shapeName) return fail("invalid_params", "renameShape 需要 shapeId 或 shapeName")
          if (!op.name.trim()) return fail("invalid_params", "形状名字不能为空")
          shapeOps.push({
            op: "renameShape",
            slide: op.slide,
            ...(op.shapeId ? { shapeId: op.shapeId } : {}),
            ...(op.shapeName ? { shapeName: op.shapeName } : {}),
            name: op.name,
          })
          applied.push(op)
          break
        case "setSlideNotes":
        case "setSlideHidden":
          if (!Number.isInteger(op.slide) || op.slide < 1) return fail("invalid_params", "页码从 1 开始")
          metaOps.push(op)
          applied.push(op)
          break
        case "setSlideLayout":
          if (!Number.isInteger(op.slide) || op.slide < 1) return fail("invalid_params", "页码从 1 开始")
          if (!op.layout.trim()) return fail("invalid_params", "版式名不能为空")
          metaOps.push({ op: "setSlideLayout", slide: op.slide, layout: op.layout })
          applied.push(op)
          break
        default:
          return fail("unsupported_format", `${op.op} 不适用于 PPTX`)
      }
    }

    if (
      slideOps.length > 0 &&
      (textEdits.length > 0 ||
        shapeEdits.length > 0 ||
        imageEdits.length > 0 ||
        shapeOps.length > 0 ||
        metaOps.length > 0)
    ) {
      return fail(
        "invalid_params",
        "增删页/调序/复制页不能和改内容放在同一次调用里",
        "先做页面操作，再按新的页码改文字/形状",
      )
    }

    try {
      // 备注 / 隐藏页先做：它们只动页部件和备注部件，改完再按同一批里的页码改内容。
      let working = bytes
      const metaChanged: string[] = []
      if (metaOps.length > 0) {
        const meta = await editPptxMeta(working, metaOps)
        working = meta.bytes
        metaChanged.push(...meta.changed)
      }

      // 页面结构：只重写 presentation.xml 和它的 rels，页面部件原样保留。
      if (slideOps.length > 0) {
        const structure = await editPptxSlides(working, slideOps)
        const next = await pptxEngine.open(structure.bytes)
        if (!next.ok) return next
        return ok({
          state: next.data,
          bytes: structure.bytes,
          changed: structure.changed,
          // `applied` 里已经按顺序记过这些页面操作，别重复。
          applied,
        })
      }

      const result = await editPptx({
        bytes: working,
        textEdits,
        shapeEdits,
        imageEdits,
        shapeOps,
      })
      const next = await pptxEngine.open(result.bytes)
      if (!next.ok) return next
      const shapeApplied = result.shapeApplied.map(({ previous, box, ...shape }) => ({
        ...shape,
        ...(previous ? { previous: boxEmuToPt(previous) } : {}),
        ...(box ? { box: boxEmuToPt(box) } : {}),
      }))
      return ok({
        state: next.data,
        bytes: result.bytes,
        changed: [...new Set([...metaChanged, ...result.changed])],
        applied: [...applied, ...result.textApplied, ...shapeApplied, ...result.imageApplied],
      })
    } catch (error) {
      return fail("engine", error instanceof Error ? error.message : "PPTX 写入失败")
    }
  },

  /** 导出：md 保留「一页一节 + 要点」的层级，txt 只留文字。只读，不动原文件。 */
  async export(state, target, bytes) {
    const kind = target.toLowerCase().replace(/^\./, "")
    const encoder = new TextEncoder()
    const slides = toPlainSlides(state)
    if (kind === "md" || kind === "markdown") return ok(encoder.encode(slidesToMarkdown(slides)))
    if (kind === "txt" || kind === "text") return ok(encoder.encode(slidesToText(slides)))
    if (kind === "html" || kind === "htm") return ok(encoder.encode(slidesToHtml(slides)))
    if (kind === "pdf") {
      // 幻灯片上的图片也要画出来：节点里已经记了媒体关系，按页补齐字节和框。
      const images = bytes ? await pptxPrintImages(bytes, state) : []
      return ok(await printToPdf("pptx", state, images.length > 0 ? { slideImages: images } : {}))
    }
    return fail("unsupported_format", "PPTX 不能导出成 " + target, "支持 pdf / md / txt / html")
  },
}
