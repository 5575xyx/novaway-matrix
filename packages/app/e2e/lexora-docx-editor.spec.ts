import { expect, test } from "@playwright/test"

test.use({ channel: "chrome", video: "off", trace: "off" })

interface DocxEditor {
  save: () => Promise<Uint8Array>
  dispose: () => void
}
interface Handle {
  mount: (bytes: Uint8Array, name: string) => Promise<DocxEditor>
  current: () => DocxEditor | undefined
  getDirty: () => boolean
  makeMacroDocm: () => Promise<Uint8Array>
  readMacroProject: (bytes: Uint8Array) => Promise<Uint8Array | null>
  dispose: () => void
}

function readEditorPaint(page: import("@playwright/test").Page) {
  return page.locator("#editor").evaluate((root) =>
    Array.from(root.querySelectorAll<HTMLElement>("*"))
      .filter((element) => {
        const rect = element.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0
      })
      .map((element) => {
        const style = getComputedStyle(element)
        return `${style.color}|${style.backgroundColor}|${style.borderColor}`
      })
      .filter((paint) => paint !== "rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)|rgb(0, 0, 0)")
      .sort(),
  )
}

test("DOCX 编辑器的控件跟随 Host 浅／深色方案", async ({ page }) => {
  await page.goto("/e2e/fixtures/lexora-docx-editor.html")
  const status = page.locator('[data-slot="status"]')
  await expect(status).toHaveAttribute("data-mounted", "true", { timeout: 60_000 })
  const light = await readEditorPaint(page)
  expect(light.length).toBeGreaterThan(0)

  await page.evaluate(() => {
    document.documentElement.dataset.colorScheme = "dark"
    document.documentElement.classList.add("dark")
  })
  await expect(status).toHaveAttribute("data-color-scheme", "dark")
  await expect.poll(() => readEditorPaint(page)).not.toEqual(light)
})
test("DOCM 编辑并保存后保留原始 VBA package part 字节", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(String(error)))
  await page.goto("/e2e/fixtures/lexora-docx-editor.html")
  await expect(page.locator('[data-slot="status"]')).toHaveAttribute("data-mounted", "true", { timeout: 60_000 })

  const before = await page.evaluate(async () => {
    const h = (window as unknown as { __lexoraDocx?: Handle }).__lexoraDocx
    if (!h) throw new Error("editor handle missing")
    const source = await h.makeMacroDocm()
    const macroBytes = await h.readMacroProject(source)
    await h.mount(source, "report.docm")
    return Array.from(macroBytes ?? [])
  })
  expect(before).toEqual([0, 1, 2, 255, 86, 66, 65, 0, 127])

  const editable = page.locator("#editor [contenteditable]")
  await expect(editable.first()).toBeVisible({ timeout: 30_000 })
  await editable.first().click()
  await page.keyboard.press("ControlOrMeta+a")
  await page.keyboard.type("DOCM 编辑后仍需保留宏项目")
  await expect(page.locator('[data-slot="status"]')).toHaveAttribute("data-dirty", "true", { timeout: 10_000 })

  const after = await page.evaluate(async () => {
    const h = (window as unknown as { __lexoraDocx?: Handle }).__lexoraDocx
    if (!h) throw new Error("editor handle missing")
    const saved = await h.current()!.save()
    return Array.from((await h.readMacroProject(saved)) ?? [])
  })
  expect(after).toEqual(before)
  expect(errors.join("\n")).not.toContain("Error")
})

test("Lexora DOCX 编辑器能从 /office/ 加载、挂载并保存出可解析字节", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(String(error)))
  await page.goto("/e2e/fixtures/lexora-docx-editor.html")

  // 挂载成功：docx-editor.js 加载 + GenOffice 文档页渲染到容器。
  await expect(page.locator('[data-slot="status"]')).toHaveAttribute("data-mounted", "true", { timeout: 60_000 })
  await expect(page.locator("#editor")).not.toBeEmpty({ timeout: 30_000 })

  // save() 应产出可解析的 DOCX 字节（长度 > 0 且以 PK zip 头开始）。
  const saved = await page.evaluate(async () => {
    const h = (window as unknown as { __lexoraDocx?: Handle }).__lexoraDocx
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

test("编辑一段文字触发 dirty，保存字节变化且用保存结果重开能读到新内容", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(String(error)))
  await page.goto("/e2e/fixtures/lexora-docx-editor.html")
  await expect(page.locator('[data-slot="status"]')).toHaveAttribute("data-mounted", "true", { timeout: 60_000 })

  // 初始未编辑：dirty 为 false。
  await expect(page.locator('[data-slot="status"]')).toHaveAttribute("data-dirty", "false", { timeout: 10_000 })

  // 找到内容可编辑区（GenOffice 文档页段落），点进第一段并全选替换。
  const editable = page.locator("#editor [contenteditable]")
  await expect(editable.first()).toBeVisible({ timeout: 30_000 })
  const first = editable.first()
  await first.click()
  await page.keyboard.press("ControlOrMeta+a")
  await page.keyboard.type("AI 改写后的段落内容")

  // 输入触发 dirty = true。
  await expect(page.locator('[data-slot="status"]')).toHaveAttribute("data-dirty", "true", { timeout: 10_000 })

  // save() 当前实例：字节是 PK zip。
  const savedBytes = await page.evaluate(async () => {
    const h = (window as unknown as { __lexoraDocx?: Handle }).__lexoraDocx
    if (!h) throw new Error("handle missing")
    const inst = h.current()
    if (!inst) throw new Error("current editor missing")
    const bytes = await inst.save()
    return Array.from(bytes)
  })
  expect(savedBytes.length).toBeGreaterThan(0)
  expect(savedBytes[0]).toBe(0x50)
  expect(savedBytes[1]).toBe(0x4b)

  // 「重开」：用保存字节重新挂载（dispose 旧实例 + 新容器），验证渲染出新内容。
  const reopenedText = await page.evaluate(async (bytesArray) => {
    const h = (window as unknown as { __lexoraDocx?: Handle }).__lexoraDocx
    if (!h) throw new Error("handle missing")
    h.dispose()
    await h.mount(new Uint8Array(bytesArray), "report.docx")
    // 等 GenOffice 文档页渲染出正文（contenteditable 出现），最多 ~20s。
    const deadline = Date.now() + 20_000
    let text = ""
    while (Date.now() < deadline) {
      const editable = Array.from(document.querySelectorAll("#editor [contenteditable]"))
      text = editable.map((el) => (el as HTMLElement).textContent ?? "").join(" ")
      if (text.includes("AI 改写后的段落内容")) break
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
    return text
  }, savedBytes)
  // 新内容应包含我们写入的文字（GenOffice 会把文本放进 contenteditable）。
  expect(reopenedText).toContain("AI 改写后的段落内容")

  expect(errors.join("\n")).not.toContain("Error")
})
