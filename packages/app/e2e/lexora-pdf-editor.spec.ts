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
  dispose: () => void
}

test("Lexora PDF 编辑器能从 /office/ 加载、挂载并保存出可解析字节", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(String(error)))
  await page.goto("/e2e/fixtures/lexora-pdf-editor.html")

  // 挂载成功：pdf-editor.js 加载 + pdfjs 画布渲染到容器。
  await expect(page.locator('[data-slot="status"]')).toHaveAttribute("data-mounted", "true", { timeout: 90_000 })
  await expect(page.locator("#editor")).not.toBeEmpty({ timeout: 60_000 })

  // save() 应产出可解析的 PDF 字节（%PDF 头）。
  const saved = await page.evaluate(async () => {
    const h = (window as unknown as { __lexoraPdf?: Handle }).__lexoraPdf
    if (!h) throw new Error("handle missing")
    const inst = h.current()
    if (!inst) throw new Error("current editor missing")
    const bytes = await inst.save()
    const head = new TextDecoder("latin1").decode(bytes.slice(0, 8))
    return { length: bytes.length, isPdf: head.startsWith("%PDF") }
  })
  expect(saved.length).toBeGreaterThan(0)
  expect(saved.isPdf).toBe(true)

  expect(errors.join("\n")).not.toContain("Error")
})

test("PDF 保存字节为 %PDF 且能重新挂载", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(String(error)))
  await page.goto("/e2e/fixtures/lexora-pdf-editor.html")
  await expect(page.locator('[data-slot="status"]')).toHaveAttribute("data-mounted", "true", { timeout: 90_000 })

  // save() 当前实例：字节是 %PDF。
  const savedBytes = await page.evaluate(async () => {
    const h = (window as unknown as { __lexoraPdf?: Handle }).__lexoraPdf
    if (!h) throw new Error("handle missing")
    const inst = h.current()
    if (!inst) throw new Error("current editor missing")
    return Array.from(await inst.save())
  })
  expect(savedBytes.length).toBeGreaterThan(0)
  const head = new TextDecoder("latin1").decode(new Uint8Array(savedBytes.slice(0, 8)))
  expect(head.startsWith("%PDF")).toBe(true)

  // 「重开」：用保存字节重新挂载，验证能再次渲染出画布。
  const reopened = await page.evaluate(async (bytesArray) => {
    const h = (window as unknown as { __lexoraPdf?: Handle }).__lexoraPdf
    if (!h) throw new Error("handle missing")
    h.dispose()
    await h.mount(new Uint8Array(bytesArray), "report.pdf")
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
