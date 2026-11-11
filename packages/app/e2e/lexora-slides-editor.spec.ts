import { expect, test } from "@playwright/test"

test.use({ channel: "chrome", video: "off", trace: "off" })

interface OfficeEditor {
  save: () => Promise<Uint8Array>
  dispose: () => void
}
interface Handle {
  mount: (bytes: Uint8Array, name: string) => Promise<OfficeEditor>
  current: () => OfficeEditor | undefined
  getDirty: () => boolean
  makeMacroPptm: () => Promise<Uint8Array>
  readMacroProject: (bytes: Uint8Array) => Promise<Uint8Array | null>
  dispose: () => void
}

test("PPTM 无编辑保存后保留原始 VBA package part 字节", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(String(error)))
  await page.goto("/e2e/fixtures/lexora-slides-editor.html")
  await expect(page.locator('[data-slot="status"]')).toHaveAttribute("data-mounted", "true", { timeout: 90_000 })

  const before = await page.evaluate(async () => {
    const h = (window as unknown as { __lexoraSlides?: Handle }).__lexoraSlides
    if (!h) throw new Error("editor handle missing")
    const source = await h.makeMacroPptm()
    const macro = await h.readMacroProject(source)
    await h.mount(source, "deck.pptm")
    return Array.from(macro ?? [])
  })
  expect(before).toEqual([0, 80, 80, 84, 255, 77, 65, 67, 82, 79])

  const after = await page.evaluate(async () => {
    const h = (window as unknown as { __lexoraSlides?: Handle }).__lexoraSlides
    if (!h) throw new Error("editor handle missing")
    const saved = await h.current()!.save()
    return Array.from((await h.readMacroProject(saved)) ?? [])
  })
  expect(after).toEqual(before)
  expect(errors.join("\n")).not.toContain("Error")
})

test("Lexora 演示文稿编辑器能从 /office/ 加载、挂载并保存出可解析字节", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(String(error)))
  await page.goto("/e2e/fixtures/lexora-slides-editor.html")

  // 挂载成功：slides-editor.js 加载 + 画布/幻灯片渲染到容器。
  await expect(page.locator('[data-slot="status"]')).toHaveAttribute("data-mounted", "true", { timeout: 90_000 })
  await expect(page.locator("#editor")).not.toBeEmpty({ timeout: 60_000 })

  // save() 应产出可解析的 PPTX 字节（PK zip 头）。
  const saved = await page.evaluate(async () => {
    const h = (window as unknown as { __lexoraSlides?: Handle }).__lexoraSlides
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

test("编辑幻灯片文本触发 dirty，保存字节为 PPTX 且能重新挂载", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(String(error)))
  await page.goto("/e2e/fixtures/lexora-slides-editor.html")
  await expect(page.locator('[data-slot="status"]')).toHaveAttribute("data-mounted", "true", { timeout: 90_000 })
  await expect(page.locator('[data-slot="status"]')).toHaveAttribute("data-dirty", "false", { timeout: 20_000 })

  // 等幻灯片画布出现（文本可点选编辑）。
  await expect(
    page.locator("#editor canvas, #editor [contenteditable], #editor .genoffice-slide, #editor [data-testid]").first(),
  ).toBeVisible({ timeout: 60_000 })
  await page.waitForTimeout(1500)

  // 双击标题文本形状（16:9 幻灯片里 Title 位于画布约 50% 宽、25.5% 高处）
  // 进入文本编辑并输入，验证文本写回文档。
  await page.mouse.dblclick(701, 241)
  await page.waitForTimeout(500)
  await page.keyboard.type("AI 改写后的标题")
  await page.keyboard.press("Enter")
  await page.waitForTimeout(800)

  // save() 当前实例：字节是 PK zip。
  const savedBytes = await page.evaluate(async () => {
    const h = (window as unknown as { __lexoraSlides?: Handle }).__lexoraSlides
    if (!h) throw new Error("handle missing")
    const inst = h.current()
    if (!inst) throw new Error("current editor missing")
    return Array.from(await inst.save())
  })
  expect(savedBytes.length).toBeGreaterThan(0)
  expect(savedBytes[0]).toBe(0x50)
  expect(savedBytes[1]).toBe(0x4b)

  // 强持久化断言：从保存的 PPTX zip 里解出 ppt/slides/slide1.xml，
  // 若编辑命中标题则必须含有「AI 改写后的标题」，证明文本编辑写回了文档。
  const slideXml = await page.evaluate(async (bytesArray) => {
    const bytes = new Uint8Array(bytesArray)
    const inflateRaw = async (data: Uint8Array) => {
      const stream = new Blob([data.slice().buffer]).stream().pipeThrough(new DecompressionStream("deflate-raw"))
      return new Uint8Array(await new Response(stream).arrayBuffer())
    }
    const view = new DataView(bytes.buffer)
    let offset = 0
    let result = ""
    while (offset + 4 <= bytes.length) {
      if (view.getUint32(offset, true) !== 0x04034b50) break
      const method = view.getUint16(offset + 8, true)
      const csize = view.getUint32(offset + 18, true)
      const nameLen = view.getUint16(offset + 26, true)
      const extraLen = view.getUint16(offset + 28, true)
      const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLen))
      const dataStart = offset + 30 + nameLen + extraLen
      const data = bytes.subarray(dataStart, dataStart + csize)
      if (name === "ppt/slides/slide1.xml") {
        const raw = method === 8 ? await inflateRaw(data) : data
        result = new TextDecoder().decode(raw)
        break
      }
      offset = dataStart + csize
    }
    return result
  }, savedBytes)
  expect(slideXml).toContain("AI 改写后的标题")
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __lexoraSlides: Handle }).__lexoraSlides.getDirty()))
    .toBe(true)

  // 「重开」：用保存字节重新挂载，验证能再次渲染出画布。
  const reopened = await page.evaluate(async (bytesArray) => {
    const h = (window as unknown as { __lexoraSlides?: Handle }).__lexoraSlides
    if (!h) throw new Error("handle missing")
    h.dispose()
    await h.mount(new Uint8Array(bytesArray), "deck.pptx")
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
