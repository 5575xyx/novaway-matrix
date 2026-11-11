import { describe, expect, test } from "bun:test"
import { toOfficeOp } from "../../src/office/ops-schema"

describe("文档操作 schema", () => {
  test("段落文字 / 富文本整段替换", () => {
    const paragraph = toOfficeOp({ op: "setParagraphText", paragraph: 3, text: "新" })
    expect(paragraph.ok).toBe(true)
    if (paragraph.ok) expect(paragraph.op).toEqual({ op: "setParagraphText", paragraph: 3, text: "新" })

    const span = toOfficeOp({ op: "setSpanText", paragraph: 1, text: "整篇" })
    expect(span.ok).toBe(true)
    if (span.ok) expect(span.op.op).toBe("setSpanText")
  })

  test("缺字段时给可读错误，而不是静默失败", () => {
    const result = toOfficeOp({ op: "setParagraphText", paragraph: 1 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain("text")
  })

  test("富文本块操作校验枚举", () => {
    expect(toOfficeOp({ op: "setBlockType", block: 1, tag: "h2" }).ok).toBe(true)
    expect(toOfficeOp({ op: "setBlockType", block: 1, tag: "video" }).ok).toBe(false)
    expect(toOfficeOp({ op: "setBlockAlign", block: 1, align: "center" }).ok).toBe(true)
    expect(toOfficeOp({ op: "setBlockAlign", block: 1, align: "middle" }).ok).toBe(false)
  })

  test("行内格式区间可省略", () => {
    const all = toOfficeOp({ op: "formatRange", block: 2, patch: { bold: true } })
    expect(all.ok).toBe(true)
    if (all.ok) expect(all.op).toEqual({ op: "formatRange", block: 2, patch: { bold: true } })

    const part = toOfficeOp({ op: "formatRange", block: 2, start: 1, end: 4, patch: { italic: true } })
    expect(part.ok).toBe(true)
    if (part.ok) expect(part.op).toEqual({ op: "formatRange", block: 2, start: 1, end: 4, patch: { italic: true } })
  })

  test("段落格式按 DOCX 契约透传", () => {
    const result = toOfficeOp({ op: "setParagraphStyle", paragraph: 2, style: { bold: true, size: 18, align: "ctr" } })
    expect(result.ok).toBe(true)
    if (result.ok && result.op.op === "setParagraphStyle") {
      expect(result.op.style).toEqual({ bold: true, size: 18, align: "ctr" })
    }
  })

  test("文本行命令与未知操作", () => {
    expect(toOfficeOp({ op: "sortLines", descending: true }).ok).toBe(true)
    expect(toOfficeOp({ op: "formatJson", indent: "  " }).ok).toBe(true)
    expect(toOfficeOp({ op: "replaceImage" }).ok).toBe(false)
  })

  test("标题 / 列表 / 引用必须给出明确的行的范围", () => {
    const heading = toOfficeOp({ op: "setHeading", level: 2, start: 0, end: 4 })
    expect(heading.ok).toBe(true)
    if (heading.ok) expect(heading.op).toEqual({ op: "setHeading", level: 2, start: 0, end: 4 })

    const list = toOfficeOp({ op: "toggleList", kind: "ordered", start: 0, end: 4 })
    expect(list.ok).toBe(true)
    if (list.ok) expect(list.op).toEqual({ op: "toggleList", kind: "ordered", start: 0, end: 4 })

    // 省略 kind 默认无序列表。
    const bullet = toOfficeOp({ op: "toggleList", start: 0, end: 4 })
    expect(bullet.ok).toBe(true)
    if (bullet.ok && bullet.op.op === "toggleList") expect(bullet.op.kind).toBe("bullet")

    expect(toOfficeOp({ op: "toggleQuote", start: 0, end: 4 }).ok).toBe(true)
    expect(toOfficeOp({ op: "toggleTask", start: 0, end: 4 }).ok).toBe(true)
    // 不给范围就拒绝：整篇变标题几乎不可能是本意。
    expect(toOfficeOp({ op: "setHeading", level: 2 }).ok).toBe(false)
    expect(toOfficeOp({ op: "setHeading", level: 7, start: 0, end: 1 }).ok).toBe(false)
    expect(toOfficeOp({ op: "toggleList", kind: "grid", start: 0, end: 1 }).ok).toBe(false)
    expect(toOfficeOp({ op: "toggleQuote", start: 4, end: 1 }).ok).toBe(false)
  })

  test("大小写与缩进转换", () => {
    expect(toOfficeOp({ op: "changeCase", mode: "upper" })).toEqual({
      ok: true,
      op: { op: "changeCase", mode: "upper" },
    })
    expect(toOfficeOp({ op: "changeCase", mode: "title", start: 2, end: 6 }).ok).toBe(true)
    expect(toOfficeOp({ op: "changeCase", mode: "shout" }).ok).toBe(false)
    expect(toOfficeOp({ op: "changeCase" }).ok).toBe(false)

    expect(toOfficeOp({ op: "convertIndent", toTabs: true })).toEqual({
      ok: true,
      op: { op: "convertIndent", toTabs: true },
    })
    expect(toOfficeOp({ op: "convertIndent", toTabs: false, width: 4 }).ok).toBe(true)
    expect(toOfficeOp({ op: "convertIndent", toTabs: false, width: 0 }).ok).toBe(false)
    expect(toOfficeOp({ op: "convertIndent" }).ok).toBe(false)
  })
})

describe("设计视图保存", () => {
  test("setBlockHtml 走和行内格式化同一条校验", () => {
    const ok = toOfficeOp({ op: "setBlockHtml", block: 1, html: "<strong>改</strong>" })
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.op).toEqual({ op: "setBlockHtml", block: 1, html: "<strong>改</strong>" })
    expect(toOfficeOp({ op: "setBlockHtml", block: 1 }).ok).toBe(false)
  })
})

describe("富文本列表", () => {
  test("setBlockList 校验类型", () => {
    const bullet = toOfficeOp({ op: "setBlockList", block: 2, kind: "ul" })
    expect(bullet.ok).toBe(true)
    if (bullet.ok) expect(bullet.op).toEqual({ op: "setBlockList", block: 2, kind: "ul" })
    expect(toOfficeOp({ op: "setBlockList", block: 2, kind: "none" }).ok).toBe(true)
    expect(toOfficeOp({ op: "setBlockList", block: 2, kind: "grid" }).ok).toBe(false)
    expect(toOfficeOp({ op: "setBlockList", block: 2 }).ok).toBe(false)
  })
})

describe("表格操作", () => {
  test("A1 单元格与公式", () => {
    const value = toOfficeOp({ op: "setCellValue", sheet: "Sheet1", cell: "B2", value: 42 })
    expect(value.ok).toBe(true)
    if (value.ok) {
      expect(value.op).toEqual({ op: "setCellValue", sheet: "Sheet1", ref: { row: 1, col: 1 }, value: 42 })
    }
    const formula = toOfficeOp({ op: "setCellValue", sheet: "Sheet1", cell: "C3", value: { formula: "SUM(A1:A2)" } })
    expect(formula.ok).toBe(true)
  })

  test("区域可以省略终点，非法单元格明确报错", () => {
    const single = toOfficeOp({
      op: "setCellStyle",
      sheet: "Sheet1",
      range: "B2",
      cellStyle: { bold: true },
    })
    expect(single.ok).toBe(true)
    if (single.ok && single.op.op === "setCellStyle") {
      expect(single.op.range).toEqual({ start: { row: 1, col: 1 }, end: { row: 1, col: 1 } })
    }
    expect(toOfficeOp({ op: "setCellValue", sheet: "Sheet1", cell: "2B", value: 1 }).ok).toBe(false)
    expect(toOfficeOp({ op: "setCellStyle", sheet: "Sheet1", range: "A1:", cellStyle: {} }).ok).toBe(false)
  })

  test("行列插入与删除", () => {
    const insert = toOfficeOp({ op: "insertRows", sheet: "Sheet1", at: 3, count: 2 })
    expect(insert.ok).toBe(true)
    if (insert.ok) expect(insert.op).toEqual({ op: "insertRows", sheet: "Sheet1", at: 3, count: 2 })

    const remove = toOfficeOp({ op: "deleteColumns", sheet: "Sheet1", at: 1 })
    expect(remove.ok).toBe(true)
    if (remove.ok) expect(remove.op).toEqual({ op: "deleteColumns", sheet: "Sheet1", at: 1 })

    expect(toOfficeOp({ op: "insertRows", sheet: "Sheet1" }).ok).toBe(false)
    expect(toOfficeOp({ op: "insertRows", sheet: "Sheet1", at: 0 }).ok).toBe(false)
    expect(toOfficeOp({ op: "insertRows", sheet: "Sheet1", at: 2, count: 0 }).ok).toBe(false)
  })

  test("工作表的增删改名", () => {
    const added = toOfficeOp({ op: "addSheet", name: "汇总" })
    expect(added.ok).toBe(true)
    if (added.ok) expect(added.op).toEqual({ op: "addSheet", name: "汇总" })

    const renamed = toOfficeOp({ op: "renameSheet", sheet: "Sheet1", name: "数据" })
    expect(renamed.ok).toBe(true)
    if (renamed.ok) expect(renamed.op).toEqual({ op: "renameSheet", sheet: "Sheet1", name: "数据" })

    const removed = toOfficeOp({ op: "deleteSheet", sheet: "Sheet2" })
    expect(removed.ok).toBe(true)
    if (removed.ok) expect(removed.op).toEqual({ op: "deleteSheet", sheet: "Sheet2" })

    expect(toOfficeOp({ op: "addSheet" }).ok).toBe(false)
    expect(toOfficeOp({ op: "renameSheet", sheet: "Sheet1" }).ok).toBe(false)
    expect(toOfficeOp({ op: "deleteSheet" }).ok).toBe(false)
  })

  test("幻灯片备注 / 隐藏 / 形状改名", () => {
    const notes = toOfficeOp({ op: "setSlideNotes", slide: 2, text: "讲者提示" })
    expect(notes.ok).toBe(true)
    if (notes.ok) expect(notes.op).toEqual({ op: "setSlideNotes", slide: 2, text: "讲者提示" })

    const hidden = toOfficeOp({ op: "setSlideHidden", slide: 2, hidden: true })
    expect(hidden.ok).toBe(true)
    if (hidden.ok) expect(hidden.op).toEqual({ op: "setSlideHidden", slide: 2, hidden: true })
    expect(toOfficeOp({ op: "setSlideHidden", slide: 2 }).ok).toBe(false)

    const renamed = toOfficeOp({ op: "renameShape", slide: 1, shapeId: "7", name: "标题" })
    expect(renamed.ok).toBe(true)
    if (renamed.ok) expect(renamed.op).toEqual({ op: "renameShape", slide: 1, shapeId: "7", name: "标题" })
    // 没有 shapeId / shapeName 就不知道该改哪个形状。
    expect(toOfficeOp({ op: "renameShape", slide: 1, name: "标题" }).ok).toBe(false)
  })

  test("清空单元格区域", () => {
    const cleared = toOfficeOp({ op: "clearCells", sheet: "Sheet1", range: "A1:B2" })
    expect(cleared.ok).toBe(true)
    if (cleared.ok)
      expect(cleared.op).toEqual({
        op: "clearCells",
        sheet: "Sheet1",
        range: { start: { row: 0, col: 0 }, end: { row: 1, col: 1 } },
      })
    expect(toOfficeOp({ op: "clearCells", sheet: "Sheet1" }).ok).toBe(false)
  })

  test("工作表标签颜色", () => {
    const colored = toOfficeOp({ op: "setSheetTabColor", sheet: "Sheet1", color: "4472C4" })
    expect(colored.ok).toBe(true)
    if (colored.ok) expect(colored.op).toEqual({ op: "setSheetTabColor", sheet: "Sheet1", color: "4472C4" })
    // 不给颜色就是去掉颜色：op 里不带 color 字段。
    const cleared = toOfficeOp({ op: "setSheetTabColor", sheet: "Sheet1" })
    expect(cleared.ok).toBe(true)
    if (cleared.ok) expect(cleared.op).toEqual({ op: "setSheetTabColor", sheet: "Sheet1" })
    expect(toOfficeOp({ op: "setSheetTabColor" }).ok).toBe(false)
  })

  test("演示删页与调序", () => {
    const remove = toOfficeOp({ op: "deleteSlide", slide: 3 })
    expect(remove.ok).toBe(true)
    if (remove.ok) expect(remove.op).toEqual({ op: "deleteSlide", slide: 3 })

    const move = toOfficeOp({ op: "moveSlide", from: 3, to: 1 })
    expect(move.ok).toBe(true)
    if (move.ok) expect(move.op).toEqual({ op: "moveSlide", from: 3, to: 1 })

    expect(toOfficeOp({ op: "deleteSlide" }).ok).toBe(false)
    expect(toOfficeOp({ op: "deleteSlide", slide: 0 }).ok).toBe(false)
    expect(toOfficeOp({ op: "moveSlide", from: 1 }).ok).toBe(false)
    expect(toOfficeOp({ op: "moveSlide", from: 1, to: 0 }).ok).toBe(false)
  })

  test("演示复制页", () => {
    const copy = toOfficeOp({ op: "duplicateSlide", slide: 2 })
    expect(copy.ok).toBe(true)
    if (copy.ok) expect(copy.op).toEqual({ op: "duplicateSlide", slide: 2 })
    expect(toOfficeOp({ op: "duplicateSlide" }).ok).toBe(false)
    expect(toOfficeOp({ op: "duplicateSlide", slide: 0 }).ok).toBe(false)
  })

  test("合并单元格走 cellStyle.merge", () => {
    const merge = toOfficeOp({
      op: "setCellStyle",
      sheet: "Sheet1",
      range: "A1:C1",
      cellStyle: { merge: true },
    })
    expect(merge.ok).toBe(true)
    if (merge.ok) {
      expect(merge.op).toEqual({
        op: "setCellStyle",
        sheet: "Sheet1",
        range: { start: { row: 0, col: 0 }, end: { row: 0, col: 2 } },
        style: { merge: true },
      })
    }
  })

  test("缺 sheet / value 时给出可读提示", () => {
    const missingSheet = toOfficeOp({ op: "setCellValue", cell: "A1", value: 1 })
    expect(missingSheet.ok).toBe(false)
    if (!missingSheet.ok) expect(missingSheet.message).toContain("sheet")
    const missingValue = toOfficeOp({ op: "setCellValue", sheet: "Sheet1", cell: "A1" })
    expect(missingValue.ok).toBe(false)
  })
})

describe("段落结构", () => {
  test("插入与删除", () => {
    const insert = toOfficeOp({ op: "insertParagraph", after: 2, text: "新段", style: { bold: true } })
    expect(insert.ok).toBe(true)
    if (insert.ok) {
      expect(insert.op).toEqual({ op: "insertParagraph", after: 2, text: "新段", style: { bold: true } })
    }
    expect(toOfficeOp({ op: "deleteParagraph", paragraph: 3 }).ok).toBe(true)
    expect(toOfficeOp({ op: "insertParagraph", text: "缺 after" }).ok).toBe(false)
  })
})

describe("富文本结构", () => {
  test("插入与删除整块", () => {
    const insert = toOfficeOp({ op: "insertBlock", after: 1, html: "<em>新</em>", tag: "h2" })
    expect(insert.ok).toBe(true)
    if (insert.ok) expect(insert.op).toEqual({ op: "insertBlock", after: 1, html: "<em>新</em>", tag: "h2" })

    const text = toOfficeOp({ op: "insertBlock", after: 0, text: "开头" })
    expect(text.ok).toBe(true)
    if (text.ok) expect(text.op).toEqual({ op: "insertBlock", after: 0, text: "开头" })

    expect(toOfficeOp({ op: "insertBlock", after: 1 }).ok).toBe(false)
    expect(toOfficeOp({ op: "insertBlock", html: "缺 after" }).ok).toBe(false)
    expect(toOfficeOp({ op: "insertBlock", after: 1, html: "x", tag: "table" }).ok).toBe(false)
    expect(toOfficeOp({ op: "deleteBlock", block: 2 }).ok).toBe(true)
    expect(toOfficeOp({ op: "deleteBlock" }).ok).toBe(false)
  })
})

describe("PDF / DOCX 结构操作", () => {
  test("PDF 页面操作", () => {
    expect(toOfficeOp({ op: "deletePage", page: 2 }).ok).toBe(true)
    expect(toOfficeOp({ op: "deletePage" }).ok).toBe(false)
    const rotated = toOfficeOp({ op: "rotatePage", page: 1, degrees: 90 })
    expect(rotated.ok).toBe(true)
    if (rotated.ok) expect(rotated.op).toEqual({ op: "rotatePage", page: 1, degrees: 90 })
    expect(toOfficeOp({ op: "movePage", from: 1, to: 3 }).ok).toBe(true)
    expect(toOfficeOp({ op: "insertBlankPage", after: 0 }).ok).toBe(true)
    const inserted = toOfficeOp({ op: "insertPdfPages", after: 0, dataBase64: "JVBER", pages: [1, 3] })
    expect(inserted.ok).toBe(true)
    if (inserted.ok) {
      expect(inserted.op).toEqual({ op: "insertPdfPages", after: 0, dataBase64: "JVBER", pages: [1, 3] })
    }
    expect(toOfficeOp({ op: "insertPdfPages", after: 0 }).ok).toBe(false)
  })

  test("PDF 图片框调整", () => {
    const moved = toOfficeOp({
      op: "setPageImageBox",
      page: 1,
      index: 2,
      x: 10,
      y: 20,
      width: 30,
      height: 40,
      rotation: 90,
    })
    expect(moved.ok).toBe(true)
    if (moved.ok) {
      expect(moved.op).toEqual({
        op: "setPageImageBox",
        page: 1,
        index: 2,
        x: 10,
        y: 20,
        width: 30,
        height: 40,
        rotation: 90,
      })
    }
    expect(toOfficeOp({ op: "setPageImageBox", page: 1 }).ok).toBe(true)
  })

  test("PDF 叠加与批注", () => {
    const text = toOfficeOp({ op: "addPageText", page: 1, text: "OK", x: 10, y: 20, fontSize: 12 })
    expect(text.ok).toBe(true)
    if (text.ok) expect(text.op).toEqual({ op: "addPageText", page: 1, text: "OK", x: 10, y: 20, size: 12 })

    const annotate = toOfficeOp({
      op: "annotatePage",
      page: 2,
      annotation: "highlight",
      x: 1,
      y: 2,
      width: 3,
      height: 4,
      contents: "核对",
    })
    expect(annotate.ok).toBe(true)
    expect(toOfficeOp({ op: "annotatePage", page: 1, annotation: "sparkle", x: 1, y: 2, width: 3, height: 4 }).ok).toBe(
      false,
    )
  })

  test("PDF 表单填写", () => {
    const filled = toOfficeOp({
      op: "fillForm",
      fields: [
        { name: "name", value: "Alice" },
        { name: "agree", value: true },
      ],
    })
    expect(filled.ok).toBe(true)
    if (filled.ok)
      expect(filled.op).toEqual({
        op: "fillForm",
        fields: [
          { name: "name", value: "Alice" },
          { name: "agree", value: true },
        ],
      })
    expect(toOfficeOp({ op: "fillForm", fields: [] }).ok).toBe(false)
  })

  test("DOCX 表格 / 分页 / 图片 / 页面设置", () => {
    const table = toOfficeOp({ op: "addTable", after: 2, rows: [["a", "b"]] })
    expect(table.ok).toBe(true)
    if (table.ok) expect(table.op).toEqual({ op: "addTable", after: 2, rows: [["a", "b"]] })
    expect(toOfficeOp({ op: "addTable", after: 2, rows: [] }).ok).toBe(false)
    expect(toOfficeOp({ op: "addPageBreak", after: 1 }).ok).toBe(true)
    expect(toOfficeOp({ op: "addImage", after: 1, mime: "image/png" }).ok).toBe(false)
    const setup = toOfficeOp({ op: "setPageSetup", orientation: "landscape", margins: { top: 20 } })
    expect(setup.ok).toBe(true)
    expect(toOfficeOp({ op: "setPageSetup" }).ok).toBe(false)
  })

  test("Markdown 属性操作", () => {
    const set = toOfficeOp({ op: "setProperty", key: "tags", property: ["a", "b"] })
    expect(set.ok).toBe(true)
    if (set.ok) expect(set.op).toEqual({ op: "setProperty", key: "tags", value: ["a", "b"] })
    expect(toOfficeOp({ op: "setProperty", key: "x" }).ok).toBe(false)
    expect(toOfficeOp({ op: "deleteProperty", key: "x" }).ok).toBe(true)
  })
})
