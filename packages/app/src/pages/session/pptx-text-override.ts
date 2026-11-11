import type { SlideNode, TextBody } from "@aiden0z/pptx-renderer/browser"

/** 原地编辑的一条文字覆盖：段落序号 + 新文本；表格再带格子行列。 */
export type PptxTextOverride = { paragraph: number; text: string; row?: number; col?: number }

/** 文字覆盖按「页 + 形状 id」归组；与渲染层 clearing 用的 `item.id === shapeId` 同一套匹配。 */
export function pptxShapeKey(slide: number, shapeId: string) {
  return `${slide}:${shapeId}`
}

/** 一段文字写进 textBody 的第 index 段：保留首个 run 的字体属性，其余 run 清空。 */
export function pptxSetParagraph(body: TextBody, index: number, text: string): TextBody {
  const paragraphs = [...body.paragraphs]
  const current = paragraphs[index]
  if (!current) {
    paragraphs[index] = { runs: [{ text }], level: 0 }
  } else if (current.runs.length > 0) {
    paragraphs[index] = {
      ...current,
      runs: [{ ...current.runs[0], text }, ...current.runs.slice(1).map((run) => ({ ...run, text: "" }))],
    }
  } else {
    paragraphs[index] = { ...current, runs: [{ text }] }
  }
  return { ...body, paragraphs }
}

/** 把覆盖落到渲染节点上：形状改整块段落，表格改指定格子。 */
export function pptxApplyOverrides(node: SlideNode, list: PptxTextOverride[]): SlideNode {
  if (list.length === 0) return node
  if (node.nodeType === "shape") {
    const body = node.textBody
    if (!body) return node
    let next = body
    for (const item of list) next = pptxSetParagraph(next, item.paragraph, item.text)
    return { ...node, textBody: next }
  }
  if (node.nodeType === "table") {
    let changed = false
    const rows = node.rows.map((row, rowIndex) => ({
      ...row,
      cells: row.cells.map((cell, colIndex) => {
        const cellList = list.filter((item) => item.row === rowIndex && item.col === colIndex)
        if (cellList.length === 0 || !cell.textBody) return cell
        changed = true
        let body = cell.textBody
        for (const item of cellList) body = pptxSetParagraph(body, item.paragraph, item.text)
        return { ...cell, textBody: body }
      }),
    }))
    return changed ? { ...node, rows } : node
  }
  return node
}
