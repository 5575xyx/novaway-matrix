import { expect, test } from "@playwright/test"

test.use({ channel: "chrome", video: "off", trace: "off" })

interface SheetsEditor {
  save: () => Promise<Uint8Array>
  dispose: () => void
}
interface Handle {
  mount: (bytes: Uint8Array, name: string) => Promise<SheetsEditor>
  current: () => SheetsEditor | undefined
  getDirty: () => boolean
  makeMacroXlsm: () => Promise<Uint8Array>
  readMacroProject: (bytes: Uint8Array) => Promise<Uint8Array | null>
  dispose: () => void
}

test("XLSM 显示宏支持边界，未编辑保存不应悄悄丢弃 VBA package part", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(String(error)))
  await page.goto("/e2e/fixtures/lexora-sheets-editor.html")
  await expect(page.locator('[data-slot="status"]')).toHaveAttribute("data-mounted", "true", { timeout: 90_000 })

  const before = await page.evaluate(async () => {
    const h = (window as unknown as { __lexoraSheets?: Handle }).__lexoraSheets
    if (!h) throw new Error("editor handle missing")
    const source = await h.makeMacroXlsm()
    const macroBytes = await h.readMacroProject(source)
    await h.mount(source, "sales.xlsm")
    return Array.from(macroBytes ?? [])
  })
  expect(before).toEqual([0, 88, 76, 83, 255, 77, 65, 67, 82, 79])

  // XLSM 显示为受限格式：不要把合成宏 ZIP 条目测试误报成真实 VBA 编辑能力。
  await expect(page.locator("#editor")).toContainText("此文件包含宏；本插件仅编辑无宏的 .xlsx 工作簿")
  const after = await page.evaluate(async () => {
    const h = (window as unknown as { __lexoraSheets?: Handle }).__lexoraSheets
    if (!h) throw new Error("editor handle missing")
    const saved = await h.current()!.save()
    return Array.from((await h.readMacroProject(saved)) ?? [])
  })
  expect(after).toEqual(before)
  expect(errors.join("\n")).not.toContain("Error")
})

test("Lexora 表格编辑器能从 /office/ 加载、挂载并保存出可解析字节", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(String(error)))
  await page.goto("/e2e/fixtures/lexora-sheets-editor.html")

  // 挂载成功：sheets-editor.js 加载 + Univer 网格渲染到容器。
  await expect(page.locator('[data-slot="status"]')).toHaveAttribute("data-mounted", "true", { timeout: 90_000 })
  await expect(page.locator("#editor")).not.toBeEmpty({ timeout: 60_000 })

  // save() 应产出可解析的 XLSX 字节（PK zip 头）。
  const saved = await page.evaluate(async () => {
    const h = (window as unknown as { __lexoraSheets?: Handle }).__lexoraSheets
    if (!h) throw new Error("handle missing")
    const inst = h.current()
    if (!inst) throw new Error("current editor missing")
    const bytes = await inst.save()
    return { length: bytes.length, isZip: bytes[0] === 0x50 && bytes[1] === 0x4b }
  })
  expect(saved.length).toBeGreaterThan(0)
  expect(saved.isZip).toBe(true)

  expect(errors.join("\n")).not.toContain("Error")
})

test("编辑单元格触发 dirty，保存字节为 XLSX 且能重新挂载", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(String(error)))
  await page.goto("/e2e/fixtures/lexora-sheets-editor.html")
  await expect(page.locator('[data-slot="status"]')).toHaveAttribute("data-mounted", "true", { timeout: 90_000 })
  await expect(page.locator('[data-slot="status"]')).toHaveAttribute("data-dirty", "false", { timeout: 20_000 })

  // 等网格出现（Univer 单元格编辑器）。
  await expect(
    page.locator("#editor .univer-editor-container, #editor [contenteditable], #editor input").first(),
  ).toBeVisible({
    timeout: 60_000,
  })

  // 网格数据 canvas 是最大的那个（本夹具约 1280×579，在 y≈125 之下）；
  // 双击真实单元格（A2，绝对坐标约 x=60,y=155）进入编辑并输入。
  await page.waitForTimeout(1500)
  await page.mouse.dblclick(60, 155, { timeout: 20_000 })
  await page.keyboard.type("改过的值")
  await page.keyboard.press("Enter")

  // 输入触发 dirty = true。
  await expect(page.locator('[data-slot="status"]')).toHaveAttribute("data-dirty", "true", { timeout: 15_000 })

  // save() 当前实例：字节是 PK zip。
  const savedBytes = await page.evaluate(async () => {
    const h = (window as unknown as { __lexoraSheets?: Handle }).__lexoraSheets
    if (!h) throw new Error("handle missing")
    const inst = h.current()
    if (!inst) throw new Error("current editor missing")
    return Array.from(await inst.save())
  })
  expect(savedBytes.length).toBeGreaterThan(0)
  expect(savedBytes[0]).toBe(0x50)
  expect(savedBytes[1]).toBe(0x4b)

  // 强持久化断言：从保存的 XLSX zip 里解出 xl/worksheets/sheet1.xml，
  // 必须真的含有「改过的值」，证明单元格编辑写回了文档，而非仅 re-mount 非空。
  const sheetXml = await page.evaluate(async (bytesArray) => {
    const bytes = new Uint8Array(bytesArray)
    const inflateRaw = async (data: Uint8Array) => {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))
      return new Uint8Array(await new Response(stream).arrayBuffer())
    }
    const view = new DataView(bytes.buffer)
    let offset = 0
    let entry: { name: string; method: number; data: Uint8Array } | undefined
    while (offset + 4 <= bytes.length) {
      if (view.getUint32(offset, true) !== 0x04034b50) break
      const method = view.getUint16(offset + 8, true)
      const csize = view.getUint32(offset + 18, true)
      const nameLen = view.getUint16(offset + 26, true)
      const extraLen = view.getUint16(offset + 28, true)
      const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLen))
      const dataStart = offset + 30 + nameLen + extraLen
      const data = bytes.subarray(dataStart, dataStart + csize)
      if (name === "xl/worksheets/sheet1.xml") {
        entry = { name, method, data: method === 8 ? await inflateRaw(data) : data }
        break
      }
      offset = dataStart + csize
    }
    return entry ? new TextDecoder().decode(entry.data) : ""
  }, savedBytes)
  expect(sheetXml).toContain("改过的值")

  // 「重开」：用保存字节重新挂载，验证能再次渲染出网格。
  const reopened = await page.evaluate(async (bytesArray) => {
    const h = (window as unknown as { __lexoraSheets?: Handle }).__lexoraSheets
    if (!h) throw new Error("handle missing")
    h.dispose()
    await h.mount(new Uint8Array(bytesArray), "sales.xlsx")
    const deadline = Date.now() + 20_000
    let nonEmpty = false
    while (Date.now() < deadline) {
      const editor = document.querySelector("#editor")
      if (editor && editor.textContent && editor.textContent.trim().length > 0) {
        nonEmpty = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
    return nonEmpty
  }, savedBytes)
  expect(reopened).toBe(true)

  expect(errors.join("\n")).not.toContain("Error")
})
