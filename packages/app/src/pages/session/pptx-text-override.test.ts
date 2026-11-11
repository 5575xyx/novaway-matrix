import { describe, expect, it } from "bun:test"
import type { SlideNode, TextBody } from "@aiden0z/pptx-renderer/browser"
import { pptxApplyOverrides, pptxSetParagraph, pptxShapeKey, type PptxTextOverride } from "./pptx-text-override"

/** textBody 逐段拼成纯文本，方便断言覆盖结果。 */
function bodyText(body: TextBody | undefined): string[] {
  if (!body) return []
  return body.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join(""))
}

const shapeNode = (paragraphs: Array<Array<{ text: string; bold?: boolean }>>): SlideNode =>
  ({
    nodeType: "shape",
    id: "5",
    textBody: { paragraphs: paragraphs.map((runs) => ({ runs, level: 0 })) },
  }) as unknown as SlideNode

describe("pptxShapeKey", () => {
  it("按页 + 形状 id 归组", () => {
    expect(pptxShapeKey(2, "5")).toBe("2:5")
  })
})

describe("pptxSetParagraph", () => {
  it("保留首个 run 的字体属性，其余 run 清空", () => {
    const body = { paragraphs: [{ runs: [{ text: "旧", bold: true }, { text: "尾巴" }], level: 0 }] } as TextBody
    const next = pptxSetParagraph(body, 0, "你好")
    expect(bodyText(next)).toEqual(["你好"])
    const firstRun = next.paragraphs[0]?.runs[0] as { text: string; bold?: boolean }
    expect(firstRun.bold).toBe(true)
    expect(firstRun.text).toBe("你好")
  })

  it("目标段落原本是空 run 时补一条", () => {
    const body = { paragraphs: [{ runs: [], level: 0 }] } as TextBody
    expect(bodyText(pptxSetParagraph(body, 0, "新内容"))).toEqual(["新内容"])
  })

  it("段落不存在时在该位置新建一段", () => {
    const body = { paragraphs: [{ runs: [{ text: "第一段" }], level: 0 }] } as TextBody
    expect(bodyText(pptxSetParagraph(body, 1, "第二段"))).toEqual(["第一段", "第二段"])
  })
})

describe("pptxApplyOverrides", () => {
  it("空覆盖直接返回同一节点", () => {
    const node = shapeNode([[{ text: "旧" }]])
    expect(pptxApplyOverrides(node, [])).toBe(node)
  })

  it("形状：只改命中的段落，其余不动", () => {
    const node = shapeNode([[{ text: "标题" }], [{ text: "副标题" }]])
    const list: PptxTextOverride[] = [{ paragraph: 1, text: "改了" }]
    const out = pptxApplyOverrides(node, list) as Extract<SlideNode, { nodeType: "shape" }>
    expect(bodyText(out.textBody)).toEqual(["标题", "改了"])
  })

  it("表格：只改指定格子的段落", () => {
    const node = {
      nodeType: "table",
      id: "9",
      rows: [
        {
          height: 1,
          cells: [
            { gridSpan: 1, rowSpan: 1, textBody: { paragraphs: [{ runs: [{ text: "A1" }], level: 0 }] } },
            { gridSpan: 1, rowSpan: 1, textBody: { paragraphs: [{ runs: [{ text: "B1" }], level: 0 }] } },
          ],
        },
        {
          height: 1,
          cells: [
            { gridSpan: 1, rowSpan: 1, textBody: { paragraphs: [{ runs: [{ text: "A2" }], level: 0 }] } },
            { gridSpan: 1, rowSpan: 1, textBody: { paragraphs: [{ runs: [{ text: "B2" }], level: 0 }] } },
          ],
        },
      ],
    } as unknown as SlideNode
    const list: PptxTextOverride[] = [{ paragraph: 0, text: "改过", row: 1, col: 1 }]
    const out = pptxApplyOverrides(node, list) as Extract<SlideNode, { nodeType: "table" }>
    expect(bodyText(out.rows[0]?.cells[1]?.textBody)).toEqual(["B1"])
    expect(bodyText(out.rows[1]?.cells[1]?.textBody)).toEqual(["改过"])
    expect(bodyText(out.rows[1]?.cells[0]?.textBody)).toEqual(["A2"])
  })

  it("图片等无文字节点原样返回", () => {
    const node = { nodeType: "picture", id: "3" } as unknown as SlideNode
    const list: PptxTextOverride[] = [{ paragraph: 0, text: "不该出现" }]
    expect(pptxApplyOverrides(node, list)).toBe(node)
  })
})
