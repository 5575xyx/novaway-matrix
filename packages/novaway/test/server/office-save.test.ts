import { afterEach, describe, expect, test } from "bun:test"
import * as Log from "@novaway/core/util/log"
import { createDocument } from "@novaway/core/office/create"
import { Server } from "../../src/server/server"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

/** 浏览器内编辑器整字节保存 → HTTP 通道 → 撤销栈 → 原子写盘，整条链路。 */
describe("office document save", () => {
  test("写回编辑器字节会落盘并进入宿主撤销栈", async () => {
    await using tmp = await tmpdir()
    const docx = createDocument("report.docx", { title: "标题", body: "第一段\n第二段" })
    await Bun.write(`${tmp.path}/report.docx`, docx.bytes)

    // 模拟浏览器内编辑器改好字节：用引擎改一段文字，得到新的完整 docx 字节。
    const { editDocumentFile } = await import("../../src/office/document-sessions")
    const format = (await import("@novaway/core/office/engine/registry")).officeFormatOf("report.docx")!
    const edited = await editDocumentFile(`${tmp.path}/report.docx`, format, [
      { op: "setParagraphText", paragraph: 2, text: "编辑器的整字节保存" },
    ])
    if (!edited.ok) throw new Error(edited.error.message)

    const response = await Server.Default().app.request("/office/document-save", {
      method: "POST",
      headers: { "x-novaway-directory": tmp.path, "content-type": "application/json" },
      body: JSON.stringify({
        path: "report.docx",
        contentBase64: Buffer.from(edited.data.bytes).toString("base64"),
      }),
    })
    const text = await response.text()
    expect(response.status).toBe(200)
    const json = JSON.parse(text)
    expect(json.bytes).toBeGreaterThan(0)
    expect(json.canUndo).toBe(true)

    const after = new Uint8Array(await Bun.file(`${tmp.path}/report.docx`).arrayBuffer())
    const { readZip, inflateEntry } = await import("@novaway/core/office/engine/zip")
    const zip = await readZip(after)
    const entry = zip.entries.find((item) => item.name === "word/document.xml")!
    const xml = new TextDecoder().decode(await inflateEntry(zip, entry))
    expect(xml).toContain("编辑器的整字节保存")
  })

  test("空 base64 返回 400 且不改盘", async () => {
    await using tmp = await tmpdir()
    const docx = createDocument("report.docx", { title: "标题", body: "正文" })
    await Bun.write(`${tmp.path}/report.docx`, docx.bytes)

    const response = await Server.Default().app.request("/office/document-save", {
      method: "POST",
      headers: { "x-novaway-directory": tmp.path, "content-type": "application/json" },
      body: JSON.stringify({ path: "report.docx", contentBase64: "   " }),
    })
    expect(response.status).toBe(400)

    const after = new Uint8Array(await Bun.file(`${tmp.path}/report.docx`).arrayBuffer())
    expect(after).toEqual(new Uint8Array(docx.bytes))
  })

  test("路径越界返回 400", async () => {
    await using tmp = await tmpdir()
    const response = await Server.Default().app.request("/office/document-save", {
      method: "POST",
      headers: { "x-novaway-directory": tmp.path, "content-type": "application/json" },
      body: JSON.stringify({ path: "../escape.docx", contentBase64: Buffer.from([1, 2, 3]).toString("base64") }),
    })
    expect(response.status).toBe(400)
  })
})
