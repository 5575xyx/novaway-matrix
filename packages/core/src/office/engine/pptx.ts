/**
 * PPTX 引擎：布局模型一律用 **pt**，只在读写 XML 时换成 EMU。
 *
 * 这是对 Weave 那条「宿主 + 编辑器适配」思路的落地：渲染器只负责画，
 * 编辑定位靠原始 XML 里的 `p:cNvPr@id`，写回只重写目标 slide XML，
 * 其它 zip 条目逐字节拷贝。
 */

import {
  editPptx,
  readPptxDocument,
  type PptxLayoutNode,
  type PptxTextStyle,
} from "../pptx-edit"
import type { ApplyOutcome, OfficeEngine, OfficeOp, OfficeResult } from "./contract"
import { fail, ok } from "./contract"
import { boxEmuToPt, boxPtToEmu, emuToPt, type BoxPt } from "./units"

/** UI / Agent 看到的节点：几何是 pt。 */
export type PptxNodePt = Omit<PptxLayoutNode, "box" | "cells"> & {
  box?: BoxPt
  cells?: Array<Omit<NonNullable<PptxLayoutNode["cells"]>[number], "box"> & { box?: BoxPt }>
}

export type PptxState = {
  /** 页面尺寸，pt（16:9 通常是 960×540）。 */
  size: { w: number; h: number }
  nodes: PptxNodePt[]
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

export const pptxEngine: OfficeEngine<PptxState> = {
  format: "pptx",

  async open(bytes) {
    try {
      const doc = await readPptxDocument(bytes)
      return ok({
        size: { w: emuToPt(doc.size.w), h: emuToPt(doc.size.h) },
        nodes: doc.nodes.map(toPt),
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
    const applied: unknown[] = []

    for (const op of ops) {
      switch (op.op) {
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
        default:
          return fail("unsupported_format", `${op.op} 不适用于 PPTX`)
      }
    }

    try {
      const result = await editPptx({
        bytes,
        textEdits,
        shapeEdits,
        imageEdits,
      })
      const next = await pptxEngine.open(result.bytes)
      if (!next.ok) return next
      return ok({
        state: next.data,
        bytes: result.bytes,
        changed: result.changed,
        applied: [...applied, ...result.textApplied, ...result.shapeApplied, ...result.imageApplied],
      })
    } catch (error) {
      return fail("engine", error instanceof Error ? error.message : "PPTX 写入失败")
    }
  },
}
