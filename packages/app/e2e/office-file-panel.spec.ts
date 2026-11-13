import { expect, test } from "./office-test"
import type { Page } from "@playwright/test"
import { createDocument } from "../../core/src/office/create"
import { docxEngine } from "../../core/src/office/engine/docx"
import { createPdf, pdfEngine, readPdfText } from "../../core/src/office/pdf/engine"
import { buildZip } from "../../core/src/office/pptx-edit"
import { encodeText, decodeText, type TextFormat } from "../../core/src/office/text/format"
import { readFile, unlink, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import JSZip from "jszip"

const NATIVE_VARIANTS = [
  { extension: "xlsx", family: "xlsx" },
  { extension: "pptx", family: "pptx" },
  {
    extension: "dotx",
    family: "docx",
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml",
  },
  { extension: "dotm", family: "docx", contentType: "application/vnd.ms-word.template.macroEnabledTemplate.main+xml" },
  {
    extension: "xltx",
    family: "xlsx",
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml",
  },
  { extension: "xltm", family: "xlsx", contentType: "application/vnd.ms-excel.template.macroEnabled.main+xml" },
  {
    extension: "potx",
    family: "pptx",
    contentType: "application/vnd.openxmlformats-officedocument.presentationml.template.main+xml",
  },
  { extension: "potm", family: "pptx", contentType: "application/vnd.ms-powerpoint.template.macroEnabled.main+xml" },
  {
    extension: "ppsx",
    family: "pptx",
    contentType: "application/vnd.openxmlformats-officedocument.presentationml.slideshow.main+xml",
  },
  { extension: "ppsm", family: "pptx", contentType: "application/vnd.ms-powerpoint.slideshow.macroEnabled.main+xml" },
]
const REAL_SAMPLE_DIR = process.env.OFFICE_REAL_SAMPLES
const macroName = (extension: string) => `office-panel-${process.pid}-real.${extension}`
const macroPath = (extension: string) => resolve(process.cwd(), "e2e", "fixtures", macroName(extension))
const MACRO_PARTS = [
  { extension: "docm", root: "word", main: "document" },
  { extension: "xlsm", root: "xl", main: "workbook" },
  { extension: "pptm", root: "ppt", main: "presentation" },
]

const FILE_NAME = `office-panel-${process.pid}.docx`
const LEGACY_FILE_NAME = `office-panel-${process.pid}.odt`
const PDF_FILE_NAME = `office-panel-${process.pid}.pdf`
const CSV_FILE_NAME = `office-panel-${process.pid}.csv`
// Keep real file search/watching scoped to the fixture project, not the entire source/vendor tree.
const ROOT = resolve(process.cwd(), "e2e", "fixtures")
const FILE_PATH = resolve(process.cwd(), "e2e", "fixtures", FILE_NAME)
const LEGACY_FILE_PATH = resolve(process.cwd(), "e2e", "fixtures", LEGACY_FILE_NAME)
const PDF_FILE_PATH = resolve(process.cwd(), "e2e", "fixtures", PDF_FILE_NAME)
const CSV_FILE_PATH = resolve(process.cwd(), "e2e", "fixtures", CSV_FILE_NAME)
const CSV_VARIANTS: { id: string; delimiter: string; format: TextFormat }[] = [
  { id: "utf8-bom", delimiter: ";", format: { encoding: "utf-8", bom: true, eol: "\r\n" } },
  { id: "utf16le", delimiter: "\t", format: { encoding: "utf-16le", bom: true, eol: "\r\n" } },
  { id: "utf16be", delimiter: "|", format: { encoding: "utf-16be", bom: true, eol: "\n" } },
  { id: "gbk", delimiter: ";", format: { encoding: "gbk", bom: false, eol: "\r\n" } },
]
const csvVariantName = (id: string) => `office-panel-${process.pid}-${id}.csv`
const csvVariantPath = (id: string) => resolve(process.cwd(), "e2e", "fixtures", csvVariantName(id))
const slug = Buffer.from(ROOT, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")

test.use({ channel: "chrome", video: "off", trace: "off" })

async function openSession(page: Page) {
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.goto(`/${slug}/session`)
  const frame = page.locator('[data-component="side-pane-frame"]')
  await expect(frame).toHaveAttribute("data-open", "true", { timeout: 20_000 })
}

async function openFile(page: Page, fileName = FILE_NAME) {
  const input = page.getByPlaceholder(/Search (?:workspace )?files|搜索(?:工作区)?文件/).first()
  const files = page.getByRole("menuitem", { name: /^(Workspace files|工作区文件)$/ }).first()
  await expect(async () => {
    if (await input.isVisible()) return
    if (!(await files.isVisible()))
      await page
        .getByRole("button", { name: /Add panel tab|新增面板标签/ })
        .first()
        .click()
    await files.click({ timeout: 2000 })
    await expect(input).toBeVisible({ timeout: 2000 })
  }).toPass({ timeout: 15_000 })
  await input.fill(fileName)
  const row = page.getByRole("treeitem").filter({ hasText: fileName })
  await expect(row.first()).toBeVisible({ timeout: 30_000 })
  await row.first().click()
  await expect(input).toBeHidden()
  await expect(page.locator('[data-component="file-preview-header"]')).toBeVisible()
}

async function verifyOfficeEditorThemeSwitch(page: Page) {
  const host = page.locator("[data-office-editor-host]")
  const header = page.locator('[data-component="file-preview-header"]')
  const themeToggle = page.getByRole("button", { name: /^(Dark mode|Light mode)$/ }).first()
  await expect(host).toBeVisible()
  await expect(themeToggle).toBeVisible()
  if ((await page.locator("html").getAttribute("data-color-scheme")) !== "light") {
    await themeToggle.click()
    await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "light")
  }
  const readHeaderPaint = () =>
    header.evaluate((element) => {
      const style = getComputedStyle(element)
      const control = element.querySelector("button")
      return {
        background: style.backgroundColor,
        foreground: control ? getComputedStyle(control).color : style.color,
        border: style.borderColor,
      }
    })
  const light = await readHeaderPaint()
  expect(light.foreground).not.toBe("")
  await themeToggle.click()
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark")
  await page.waitForTimeout(3_500)
  const dark = await readHeaderPaint()
  expect(dark.foreground).not.toBe(light.foreground)
  expect(dark.border).not.toBe(light.border)
  await expect(host).toBeVisible()
}

test.beforeAll(async () => {
  for (const variant of NATIVE_VARIANTS) {
    const zip = await JSZip.loadAsync(
      createDocument(`native.${variant.family}`, { title: "原生面板", body: "初始内容" }).bytes,
    )
    if (variant.contentType) {
      const types = await zip.file("[Content_Types].xml")!.async("string")
      zip.file(
        "[Content_Types].xml",
        types.replace(
          /application\/vnd\.openxmlformats-officedocument\.(?:wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation)\.main\+xml/g,
          variant.contentType,
        ),
      )
    }
    await writeFile(macroPath(variant.extension), await zip.generateAsync({ type: "uint8array" }))
  }
  if (REAL_SAMPLE_DIR) {
    for (const sample of MACRO_PARTS)
      await writeFile(
        macroPath(sample.extension),
        await readFile(resolve(REAL_SAMPLE_DIR, `sample.${sample.extension}`)),
      )
  }
  const document = createDocument(FILE_NAME, { title: "面板验收", body: "初始段落\n第二段" })
  await writeFile(FILE_PATH, document.bytes)
  const encoder = new TextEncoder()
  const odt = buildZip([
    { name: "mimetype", data: encoder.encode("application/vnd.oasis.opendocument.text") },
    {
      name: "content.xml",
      data: encoder.encode(
        '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text><text:p>旧格式正文</text:p></office:text></office:body></office:document-content>',
      ),
    },
  ])
  await writeFile(LEGACY_FILE_PATH, odt)
  await writeFile(PDF_FILE_PATH, await createPdf({ title: "真实面板 PDF 验收" }))
  await writeFile(CSV_FILE_PATH, "姓名;金额\r\n张三;12\r\n")
  for (const variant of CSV_VARIANTS) {
    const d = variant.delimiter
    await writeFile(csvVariantPath(variant.id), encodeText(`姓名${d}金额\n张三${d}=1+1\n`, variant.format))
  }
})
test.afterAll(async () => {
  await Promise.all(NATIVE_VARIANTS.map(({ extension }) => unlink(macroPath(extension)).catch(() => {})))
  if (REAL_SAMPLE_DIR)
    await Promise.all(MACRO_PARTS.map((sample) => unlink(macroPath(sample.extension)).catch(() => {})))
  await unlink(FILE_PATH).catch(() => {})
  await unlink(LEGACY_FILE_PATH).catch(() => {})
  await unlink(PDF_FILE_PATH).catch(() => {})
  await unlink(CSV_FILE_PATH).catch(() => {})
  await Promise.all(CSV_VARIANTS.map((variant) => unlink(csvVariantPath(variant.id)).catch(() => {})))
})

for (const { extension, family, contentType } of NATIVE_VARIANTS) {
  test(`原生 ${extension.toUpperCase()} 文件面板编辑写盘、关闭重开`, async ({ page }) => {
    test.setTimeout(120_000)
    page.on("console", (message) => console.log("BROWSER", message.type(), message.text()))
    await openSession(page)
    await openFile(page, macroName(extension))
    await verifyOfficeEditorThemeSwitch(page)
    const originalBytes = new Uint8Array(await readFile(macroPath(extension)))
    const host = page.locator("[data-office-editor-host]")
    if (family === "docx") {
      const editor = host.locator("[contenteditable]").filter({ hasText: "初始内容" }).first()
      await expect(editor).toBeVisible({ timeout: 60_000 })
      await editor.click()
      await page.keyboard.press("ControlOrMeta+a")
      await page.keyboard.type("Native panel saved value")
    } else if (family === "xlsx") {
      await expect(host.locator('[data-u-comp="formula-bar"]').first()).toBeVisible({ timeout: 60_000 })
      await expect(async () => {
        const rect = await host.locator("canvas").evaluateAll(
          (elements) =>
            elements
              .map((element) => {
                const box = element.getBoundingClientRect()
                return { x: box.x, y: box.y, width: box.width, height: box.height }
              })
              .sort((a, b) => b.width * b.height - a.width * a.height)[0],
        )
        await page.mouse.dblclick(rect.x + 70, rect.y + 45)
        await expect(page.locator('[data-u-comp="editor"]:focus')).toHaveCount(1, { timeout: 1500 })
      }).toPass({ timeout: 15_000 })
      await page.keyboard.type("Native panel saved value")
      await page.keyboard.press("Enter")
    } else {
      const notes = host.locator(".notes-pane textarea")
      await expect(notes).toBeVisible({ timeout: 60_000 })
      await notes.fill("Native panel saved value")
      await notes.blur()
    }
    const header = page.locator('[data-component="file-preview-header"]')
    const save = header.getByRole("button", { name: /Save|保存/ })
    await expect(save).toBeEnabled({ timeout: 15_000 })
    await page.getByRole("button", { name: /More options|更多选项/ }).click()
    const copyWait = page.waitForEvent("download")
    await page.getByRole("menuitem", { name: "另存为副本（保留原件）" }).click()
    const copy = await copyWait
    expect(copy.suggestedFilename()).toBe(macroName(extension).replace(/(\.[^.]+)$/, "-copy$1"))
    const copyZip = await JSZip.loadAsync(await readFile(await copy.path()))
    const copyTypes = await copyZip.file("[Content_Types].xml")!.async("string")
    if (contentType) expect(copyTypes).toContain(contentType)
    const copyXml = (
      await Promise.all(
        Object.keys(copyZip.files)
          .filter((part) => /\.xml$/.test(part))
          .map((part) => copyZip.file(part)!.async("string")),
      )
    ).join("\n")
    expect(copyXml).toContain("Native panel saved value")
    expect(new Uint8Array(await readFile(macroPath(extension)))).toEqual(originalBytes)
    await expect(save).toBeEnabled()
    await save.click()
    const parts = (zip: JSZip) =>
      Object.keys(zip.files).filter((name) =>
        family === "docx"
          ? name === "word/document.xml"
          : family === "xlsx"
            ? /^xl\/(worksheets\/sheet\d+|sharedStrings)\.xml$/.test(name)
            : /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name),
      )
    await expect
      .poll(
        async () => {
          const zip = await JSZip.loadAsync(await readFile(macroPath(extension)))
          return (await Promise.all(parts(zip).map((part) => zip.file(part)!.async("string")))).join("\n")
        },
        { timeout: 30_000 },
      )
      .toContain("Native panel saved value")
    await expect(save).toBeHidden({ timeout: 30_000 })
    const zip = await JSZip.loadAsync(await readFile(macroPath(extension)))
    if (contentType) expect(await zip.file("[Content_Types].xml")!.async("string")).toContain(contentType)
    const xml = (await Promise.all(parts(zip).map((part) => zip.file(part)!.async("string")))).join("\n")
    expect(xml).toContain("Native panel saved value")
    const tab = page.locator('[data-component="side-pane-file-tab"]').filter({ hasText: macroName(extension) })
    await tab.getByRole("button", { name: /Close tab|关闭标签/ }).click()
    await expect(header).toHaveCount(0)
    await page
      .getByRole("button", { name: /Toggle side pane|切换 Side Pane/ })
      .first()
      .click()
    await openFile(page, macroName(extension))
    if (family === "docx")
      await expect(page.locator("[data-office-editor-host]")).toContainText("Native panel saved value", {
        timeout: 60_000,
      })
    else if (family === "pptx")
      await expect(page.locator("[data-office-editor-host] .notes-pane textarea")).toHaveValue(
        "Native panel saved value",
        { timeout: 60_000 },
      )
    else
      await expect(page.locator('[data-office-editor-host] [data-u-comp="formula-bar"]').first()).toBeVisible({
        timeout: 60_000,
      })
  })
}

for (const sample of MACRO_PARTS) {
  test(`真实 ${sample.extension.toUpperCase()} 文件面板保留 VBA 项目、关系与宏类型并关闭重开`, async ({ page }) => {
    test.skip(!REAL_SAMPLE_DIR, "Provide genuine public samples via OFFICE_REAL_SAMPLES; no synthetic macro claim")
    test.setTimeout(120_000)
    const original = new Uint8Array(await readFile(macroPath(sample.extension)))
    const originalZip = await JSZip.loadAsync(original)
    const project = await originalZip.file(`${sample.root}/vbaProject.bin`)!.async("uint8array")
    expect(project.length).toBeGreaterThan(10_000)
    await openSession(page)
    await openFile(page, macroName(sample.extension))
    const host = page.locator("[data-office-editor-host]")
    await expect(host).not.toBeEmpty({ timeout: 60_000 })
    const header = page.locator('[data-component="file-preview-header"]')
    if (sample.extension === "docm") {
      const editor = host.locator("[contenteditable]").first()
      await expect(editor).toBeVisible({ timeout: 60_000 })
      await editor.click()
      await page.keyboard.press("ControlOrMeta+a")
      await page.keyboard.type("真实 DOCM 面板保存验收")
      const save = header.getByRole("button", { name: /Save|保存/ })
      await expect(save).toBeEnabled()
      await save.click()
      await expect(save).toBeHidden({ timeout: 30_000 })
    } else if (sample.extension === "xlsm") {
      await expect(host).toContainText("此文件包含宏", { timeout: 60_000 })
      await expect(header.getByRole("button", { name: /Save|保存/ })).toBeDisabled({ timeout: 30_000 })
      expect(new Uint8Array(await readFile(macroPath(sample.extension)))).toEqual(original)
    } else {
      const notes = host.locator(".notes-pane textarea")
      await expect(notes).toBeVisible({ timeout: 60_000 })
      await notes.fill("真实 PPTM 面板保存验收")
      await notes.blur()
      const save = header.getByRole("button", { name: /Save|保存/ })
      await expect(save).toBeEnabled()
      await save.click()
      await expect(save).toBeHidden({ timeout: 30_000 })
    }
    const savedBytes = new Uint8Array(await readFile(macroPath(sample.extension)))
    const zip = await JSZip.loadAsync(savedBytes)
    expect(await zip.file(`${sample.root}/vbaProject.bin`)!.async("uint8array")).toEqual(project)
    expect(await zip.file(`${sample.root}/_rels/${sample.main}.xml.rels`)!.async("string")).toContain("/vbaProject")
    expect(await zip.file("[Content_Types].xml")!.async("string")).toContain("macroEnabled")
    const tab = page.locator('[data-component="side-pane-file-tab"]').filter({ hasText: macroName(sample.extension) })
    await tab.getByRole("button", { name: /Close tab|关闭标签/ }).click()
    await expect(header).toHaveCount(0)
    await page
      .getByRole("button", { name: /Toggle side pane|切换 Side Pane/ })
      .first()
      .click()
    await openFile(page, macroName(sample.extension))
    if (sample.extension === "docm")
      await expect(page.locator("[data-office-editor-host]")).toContainText("真实 DOCM 面板保存验收", {
        timeout: 60_000,
      })
    else if (sample.extension === "pptm") {
      expect(await zip.file("ppt/notesSlides/notesSlide1.xml")!.async("string")).toContain("真实 PPTM 面板保存验收")
      await expect(page.locator("[data-office-editor-host] .notes-pane textarea")).toHaveValue(
        "真实 PPTM 面板保存验收",
        { timeout: 60_000 },
      )
    } else await expect(page.locator("[data-office-editor-host]")).toContainText("此文件包含宏", { timeout: 60_000 })
  })
}

for (const variant of CSV_VARIANTS) {
  test(`CSV 文件面板保留 ${variant.id} 编码、BOM、分隔符和公式文本，导出不覆盖原件`, async ({ page }) => {
    await openSession(page)
    const name = csvVariantName(variant.id)
    const path = csvVariantPath(variant.id)
    await openFile(page, name)
    const grid = page.locator('[data-component="csv-grid"]')
    await expect(grid).toContainText("张三", { timeout: 30_000 })
    const cells = grid.locator("tbody tr").nth(1).locator("td")
    await expect(cells.nth(1)).toHaveText("=1+1")
    await cells.nth(0).click()
    await grid.locator("input").fill("王五")
    await grid.locator("thead th").last().click()
    const expected = `姓名${variant.delimiter}金额\n王五${variant.delimiter}=1+1\n`
    await expect
      .poll(async () => decodeText(new Uint8Array(await readFile(path))).text, { timeout: 30_000 })
      .toBe(expected)
    const savedBytes = new Uint8Array(await readFile(path))
    expect(savedBytes).toEqual(encodeText(expected, variant.format))
    expect(decodeText(savedBytes).format).toEqual(variant.format)

    await page.getByRole("button", { name: /More options|更多选项/ }).click()
    const downloadWait = page.waitForEvent("download")
    await page.getByRole("menuitem", { name: /导出为 \.json|Export as \.json/i }).click()
    const download = await downloadWait
    const data = JSON.parse(await readFile(await download.path(), "utf8"))
    expect(data).toEqual([{ 姓名: "王五", 金额: "=1+1" }])
    expect(new Uint8Array(await readFile(path))).toEqual(savedBytes)

    const tab = page.locator('[data-component="side-pane-file-tab"]').filter({ hasText: name })
    await tab.getByRole("button", { name: /Close tab|关闭标签/ }).click()
    await expect(grid).toHaveCount(0)
    await page
      .getByRole("button", { name: /Toggle side pane|切换 Side Pane/ })
      .first()
      .click()
    await openFile(page, name)
    await expect(page.locator('[data-component="csv-grid"]')).toContainText("王五", { timeout: 30_000 })
    await expect(page.locator('[data-component="csv-grid"]')).toContainText("=1+1")
  })
}

test("真实文件面板编辑分号 CSV 并保存、关闭重开", async ({ page }) => {
  await openSession(page)
  await openFile(page, CSV_FILE_NAME)
  const grid = page.locator('[data-component="csv-grid"]')
  await expect(grid).toContainText("张三", { timeout: 30_000 })
  await grid.locator("tbody tr").nth(1).locator("td").nth(0).dblclick()
  await grid.locator("input").fill("王五")
  await grid.locator("thead th").last().click()

  const header = page.locator('[data-component="file-preview-header"]')
  await expect.poll(async () => readFile(CSV_FILE_PATH, "utf8"), { timeout: 30_000 }).toBe("姓名;金额\r\n王五;12\r\n")

  const tab = page.locator('[data-component="side-pane-file-tab"]').filter({ hasText: CSV_FILE_NAME })
  await tab.getByRole("button", { name: /Close tab|关闭标签/ }).click()
  await expect(header).toHaveCount(0)
  await page
    .getByRole("button", { name: /Toggle side pane|切换 Side Pane/ })
    .first()
    .click()
  await openFile(page, CSV_FILE_NAME)
  await expect(page.locator('[data-component="csv-grid"]')).toContainText("王五", { timeout: 30_000 })
})

test("真实文件面板将 ODT 确认转换并另存为 DOCX，保留原件", async ({ page }) => {
  await openSession(page)
  await openFile(page, LEGACY_FILE_NAME)
  await expect(page.getByText("旧格式正文").first()).toBeVisible({ timeout: 30_000 })
  const originalBytes = new Uint8Array(await readFile(LEGACY_FILE_PATH))

  await page.getByRole("button", { name: /More options|更多选项/ }).click()
  await page.getByRole("menuitem", { name: /导出为 \.docx|Export as \.docx/i }).click()
  const confirm = page.getByRole("dialog")
  await expect(confirm).toContainText("转换并另存为？")
  await expect(confirm).toContainText("不会覆盖原文件")
  const downloadWait = page.waitForEvent("download")
  await confirm.getByRole("button", { name: "继续导出副本" }).click()
  const download = await downloadWait
  expect(download.suggestedFilename()).toBe(LEGACY_FILE_NAME.replace(/\.odt$/, ".docx"))

  const exportedBytes = new Uint8Array(await readFile(await download.path()))
  const converted = await docxEngine.open(exportedBytes)
  expect(converted.ok).toBe(true)
  if (converted.ok) expect(converted.data.paragraphs.map((item) => item.text).join(" ")).toContain("旧格式正文")
  expect(new Uint8Array(await readFile(LEGACY_FILE_PATH))).toEqual(originalBytes)
})

test("真实文件面板编辑 PDF 页面并写盘，关闭重开后仍可解析", async ({ page }) => {
  await openSession(page)
  await openFile(page, PDF_FILE_NAME)
  await page.getByRole("button", { name: "更多 PDF 页面工具" }).click()
  const rotate = page.locator('[data-action="pdf-page-rotate"]')
  await expect(rotate).toBeVisible({ timeout: 30_000 })
  const header = page.locator('[data-component="file-preview-header"]')
  await rotate.click()
  await expect
    .poll(
      async () => {
        const opened = await pdfEngine.open(new Uint8Array(await readFile(PDF_FILE_PATH)))
        return opened.ok ? opened.data.pages[0]?.rotation : undefined
      },
      { timeout: 30_000 },
    )
    .toBe(90)

  const undo = header.getByRole("button", { name: /Undo|撤销/ })
  await expect(undo).toBeEnabled({ timeout: 10_000 })
  await undo.click()
  await expect
    .poll(
      async () => {
        const opened = await pdfEngine.open(new Uint8Array(await readFile(PDF_FILE_PATH)))
        return opened.ok ? opened.data.pages[0]?.rotation : undefined
      },
      { timeout: 30_000 },
    )
    .toBe(0)
  const redo = header.getByRole("button", { name: /Redo|重做/ })
  await expect(redo).toBeEnabled()
  await redo.click()
  await expect
    .poll(
      async () => {
        const opened = await pdfEngine.open(new Uint8Array(await readFile(PDF_FILE_PATH)))
        return opened.ok ? opened.data.pages[0]?.rotation : undefined
      },
      { timeout: 30_000 },
    )
    .toBe(90)

  const saved = await pdfEngine.open(new Uint8Array(await readFile(PDF_FILE_PATH)))
  expect(saved.ok).toBe(true)
  if (saved.ok) expect(saved.data.pages[0]?.rotation).toBe(90)

  const tab = page.locator('[data-component="side-pane-file-tab"]').filter({ hasText: PDF_FILE_NAME })
  await tab.getByRole("button", { name: /Close tab|关闭标签/ }).click()
  await expect(header).toHaveCount(0)
  await page
    .getByRole("button", { name: /Toggle side pane|切换 Side Pane/ })
    .first()
    .click()
  await openFile(page, PDF_FILE_NAME)
  await page.getByRole("button", { name: "更多 PDF 页面工具" }).click()
  await expect(page.locator('[data-action="pdf-page-rotate"]')).toBeVisible({ timeout: 30_000 })
})

test("PDF Lexora 脏状态阻止切换兼容页面工具", async ({ page }) => {
  await openSession(page)
  await openFile(page, PDF_FILE_NAME)
  const host = page.locator("[data-office-editor-host]")
  await expect(host.locator("canvas").first()).toBeVisible({ timeout: 60_000 })
  await host.getByRole("button", { name: "插入文字", exact: true }).click()
  const rect = await host.locator("canvas").evaluateAll(
    (elements) =>
      elements
        .map((element) => {
          const box = element.getBoundingClientRect()
          return { x: box.x, y: box.y, width: box.width, height: box.height }
        })
        .sort((a, b) => b.width * b.height - a.width * a.height)[0],
  )
  await page.mouse.click(rect.x + rect.width * 0.4, rect.y + rect.height * 0.4)
  await host.getByRole("textbox", { name: "输入要放置的文字" }).fill("PDF host save verification")
  await host.getByRole("button", { name: "确定", exact: true }).click()
  await page.mouse.click(rect.x + rect.width * 0.4, rect.y + rect.height * 0.4)
  const header = page.locator('[data-component="file-preview-header"]')
  const save = header.getByRole("button", { name: /Save|保存/ })
  await expect(save).toBeEnabled({ timeout: 15_000 })
  const before = new Uint8Array(await readFile(PDF_FILE_PATH))
  await page.getByRole("button", { name: "更多 PDF 页面工具" }).click()
  await expect(page.getByText("请先保存 PDF 编辑器中的更改", { exact: true })).toBeVisible()
  await expect(page.locator('[data-action="pdf-page-rotate"]')).toHaveCount(0)
  await expect(save).toBeEnabled()
  expect(new Uint8Array(await readFile(PDF_FILE_PATH))).toEqual(before)

  const tab = page.locator('[data-component="side-pane-file-tab"]').filter({ hasText: PDF_FILE_NAME })
  await tab.getByRole("button", { name: /Close tab|关闭标签/ }).click()
  const closeDialog = page.getByRole("dialog")
  await expect(closeDialog).toContainText("文档尚未保存")
  await closeDialog.getByRole("button", { name: /Cancel|取消/ }).click()
  await expect(save).toBeEnabled()

  // PDF serialization flushes pending draft operations; verify draft undo/redo before snapshotting.
  const nativeUndo = host.getByRole("button", { name: /^撤销/ })
  await expect(nativeUndo).toBeEnabled()
  await nativeUndo.click()
  const nativeRedo = host.getByRole("button", { name: /^重做/ })
  await expect(nativeRedo).toBeEnabled()
  await nativeRedo.click()
  await expect(save).toBeEnabled()

  await page.getByRole("button", { name: /More options|更多选项/ }).click()
  const copyWait = page.waitForEvent("download")
  await page.getByRole("menuitem", { name: "另存为副本（保留原件）" }).click()
  const copy = await copyWait
  const copyBytes = new Uint8Array(await readFile(await copy.path()))
  expect((await readPdfText(copyBytes)).map((page) => page.text).join("\n")).toContain("PDF host save verification")
  expect(new Uint8Array(await readFile(PDF_FILE_PATH))).toEqual(before)
  await expect(save).toBeEnabled()

  await save.click()
  await expect(save).toBeHidden({ timeout: 30_000 })
  await expect
    .poll(async () => (await readFile(PDF_FILE_PATH)).toString("base64"), { timeout: 30_000 })
    .not.toBe(Buffer.from(before).toString("base64"))
  const saved = new Uint8Array(await readFile(PDF_FILE_PATH))
  expect(saved).not.toEqual(before)
  expect((await readPdfText(saved)).map((page) => page.text).join("\n")).toContain("PDF host save verification")
  const opened = await pdfEngine.open(saved)
  expect(opened.ok).toBe(true)
  await page.getByRole("button", { name: "更多 PDF 页面工具" }).click()
  await expect(page.locator('[data-action="pdf-page-rotate"]')).toBeVisible({ timeout: 30_000 })
  await page.getByRole("button", { name: "返回 Lexora PDF 编辑器" }).click()
  await expect(page.locator("[data-office-editor-host] canvas").first()).toBeVisible({ timeout: 60_000 })
})

test("真实文件面板完成 DOCX 编辑、保存、冲突保护与关闭重开", async ({ page }) => {
  await openSession(page)
  await openFile(page)
  await expect(page.getByText("初始段落").first()).toBeVisible({ timeout: 30_000 })
  const header = page.locator('[data-component="file-preview-header"]')
  await expect(header).toContainText(FILE_NAME)
  const editor = page.locator("[contenteditable]").filter({ hasText: "初始段落" }).first()
  await expect(editor).toBeVisible({ timeout: 30_000 })

  // 修改后试图关闭：dirty guard 应阻止关闭并保留编辑内容。
  await editor.click()
  await page.keyboard.press("ControlOrMeta+a")
  await page.keyboard.type("面板编辑内容")
  const saveButton = header.getByRole("button", { name: /Save|保存/ })
  await expect(saveButton).toBeEnabled({ timeout: 15_000 })
  const tab = page.locator('[data-component="side-pane-file-tab"]').filter({ hasText: FILE_NAME })
  await tab.getByRole("button", { name: /Close tab|关闭标签/ }).click()
  const closeDialog = page.getByRole("dialog")
  await expect(closeDialog).toContainText("文档尚未保存")
  await closeDialog.getByRole("button", { name: /Cancel|取消/ }).click()
  await expect(header).toBeVisible()
  await expect(saveButton).toBeEnabled()

  // 保存前用外部写入替换磁盘内容，验证 baseline 冲突不会静默覆盖。
  const external = createDocument(FILE_NAME, { title: "外部修改", body: "外部版本" })
  await writeFile(FILE_PATH, external.bytes)
  await saveButton.click()
  const conflict = page.getByRole("dialog")
  await expect(conflict).toContainText("文件已被外部修改")
  await conflict.getByRole("button", { name: /Cancel|取消/ }).click()
  await expect(saveButton).toBeEnabled()
  const diskAfterCancel = new Uint8Array(await readFile(FILE_PATH))
  const externalOpened = await docxEngine.open(diskAfterCancel)
  expect(externalOpened.ok).toBe(true)
  if (externalOpened.ok) expect(externalOpened.data.paragraphs.map((item) => item.text).join(" ")).toContain("外部版本")

  // 用户明确确认后，面板携带刚读到的磁盘 baseline 执行 CAS 写入。
  await saveButton.click()
  const confirm = page.getByRole("dialog")
  await expect(confirm).toContainText("文件已被外部修改")
  await confirm.getByRole("button", { name: "仍然覆盖" }).click()
  await expect(confirm).toBeHidden({ timeout: 5_000 })
  await expect(saveButton).toBeHidden({ timeout: 30_000 })
  const savedBytes = new Uint8Array(await readFile(FILE_PATH))
  const saved = await docxEngine.open(savedBytes)
  expect(saved.ok).toBe(true)
  if (saved.ok) expect(saved.data.paragraphs.map((item) => item.text).join(" ")).toContain("面板编辑内容")

  // 关闭已保存标签，再通过真实文件选择器重新打开，确认落盘字节能再次展示。
  await tab.getByRole("button", { name: /Close tab|关闭标签/ }).click()
  await expect(header).toHaveCount(0)
  await page
    .getByRole("button", { name: /Toggle side pane|切换 Side Pane/ })
    .first()
    .click()
  await openFile(page)
  await expect(page.getByText("面板编辑内容").first()).toBeVisible({ timeout: 30_000 })
})
