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

/** 面板双击段落 → HTTP 通道 → 引擎 → 写盘，整条链路的冒烟测试。 */
describe("office document edit", () => {
  test("改一段文字会写回磁盘并返回撤销栈状态", async () => {
    await using tmp = await tmpdir()
    const docx = createDocument("report.docx", { title: "标题", body: "第一段\n第二段" })
    await Bun.write(`${tmp.path}/report.docx`, docx.bytes)

    const response = await Server.Default().app.request("/office/document-edit", {
      method: "POST",
      headers: { "x-novaway-directory": tmp.path, "content-type": "application/json" },
      body: JSON.stringify({
        path: "report.docx",
        ops: [{ op: "setParagraphText", paragraph: 2, text: "改过的段落" }],
      }),
    })
    const text = await response.text()
    expect(response.status).toBe(200)
    const json = JSON.parse(text)
    expect(json.applied).toBe(1)
    expect(json.canUndo).toBe(true)
    expect(json.changed).toContain("word/document.xml")

    const after = new Uint8Array(await Bun.file(`${tmp.path}/report.docx`).arrayBuffer())
    const { readZip, inflateEntry } = await import("@novaway/core/office/engine/zip")
    const zip = await readZip(after)
    const entry = zip.entries.find((item) => item.name === "word/document.xml")!
    const xml = new TextDecoder().decode(await inflateEntry(zip, entry))
    expect(xml).toContain("改过的段落")
  })
  test("uses the active builtin plugin office engine for a custom extension", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/notes.foo`, "before")

    const response = await Server.Default().app.request("/office/document-edit", {
      method: "POST",
      headers: { "x-novaway-directory": tmp.path, "content-type": "application/json" },
      body: JSON.stringify({
        path: "notes.foo",
        ops: [{ op: "replaceDocumentText", find: "before", replace: "after" }],
      }),
    })

    expect(response.status).toBe(200)
    const edited = await response.json()
    expect(edited.applied).toBe(1)
    expect(edited.changed).toContain("foo")
    expect(await Bun.file(`${tmp.path}/notes.foo`).text()).toBe("after")
  })
})
