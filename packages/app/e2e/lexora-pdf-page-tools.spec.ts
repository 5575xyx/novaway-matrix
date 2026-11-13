import { expect, test } from "@playwright/test"

test.use({ channel: "chrome", video: "off", trace: "off" })

test("PDF 页面兼容工具的编辑、裁边、批注、提取、拆分和合并入口可执行", async ({ page }) => {
  await page.goto("/e2e/fixtures/pdf-page-tools.html")
  await page.locator('[data-action="pdf-page-rotate"]').click()
  await expect(page.locator('[data-slot="state"]')).toContainText('"op":"rotatePage"')
  await page.locator('[data-action="pdf-page-insert"]').click()
  await expect(page.locator('[data-slot="state"]')).toContainText('"op":"insertBlankPage"')

  await page.getByRole("tab", { name: "编辑" }).click()

  await page.locator('[data-action="pdf-find-text"]').fill("original")
  await page.locator('[data-action="pdf-replace-text"]').fill("replacement")
  await page.locator('[data-action="pdf-replace-text-run"]').click()
  await expect(page.locator('[data-slot="state"]')).toContainText('"op":"replacePageText"')

  await page.locator('[data-action="pane-inspector-toggle"]').click()
  await page.locator('[data-action="pdf-crop-input"]').fill("5")
  await page.locator('[data-action="pdf-crop-page"]').click()
  await expect(page.locator('[data-slot="state"]')).toContainText('"op":"cropPage"')

  await page.locator('[data-action="pdf-note-text"]').fill("测试批注")
  await page.locator('[data-action="pdf-annotate-note"]').click()
  await expect(page.locator('[data-slot="state"]')).toContainText('"op":"annotatePage"')

  const extractDownload = page.waitForEvent("download")
  await page.locator('[data-action="pdf-extract-pages"]').click()
  expect((await extractDownload).suggestedFilename()).toBe("sample-提取.pdf")

  const splitDownload = page.waitForEvent("download")
  await page.locator('[data-action="pdf-split-pages"]').click()
  expect((await splitDownload).suggestedFilename()).toBe("sample-1.pdf")

  const pdfBytes = await page.evaluate(() => {
    const base64 = (window as unknown as { __pdfFixtureBase64: string }).__pdfFixtureBase64
    return Array.from(Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)))
  })
  const mergeDownload = page.waitForEvent("download")
  const fileChooser = page.waitForEvent("filechooser")
  await page.locator('[data-action="pdf-merge-documents"]').click()
  await (
    await fileChooser
  ).setFiles({
    name: "second.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(pdfBytes),
  })
  expect((await mergeDownload).suggestedFilename()).toBe("sample-合并.pdf")
})
