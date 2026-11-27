import { expect, test } from "./office-test"
import { readFile, writeFile, unlink, readdir } from "node:fs/promises"
import { resolve } from "node:path"
import JSZip from "jszip"

let readLegacyDocument!: (data: Uint8Array, extension: string) => Promise<any>
let engineFor!: (extension: string) => { open: (data: Uint8Array) => Promise<{ ok: boolean }> } | undefined

const samples = process.env.OFFICE_REAL_SAMPLES
const variants = [
  { extension: "doc", target: "docx" },
  { extension: "xls", target: "xlsx" },
  { extension: "ppt", target: "pptx" },
  { extension: "rtf", target: "docx" },
  { extension: "ods", target: "xlsx" },
  { extension: "odp", target: "pptx" },
] as const
const name = (ext: string) => `office-legacy-${process.pid}.${ext}`
const path = (ext: string) => resolve(process.cwd(), "e2e", "fixtures", name(ext))
const root = resolve(process.cwd(), "e2e", "fixtures")
const slug = Buffer.from(root).toString("base64url")
const encoder = new TextEncoder()

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const output = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}

function u16(value: number) {
  const output = new Uint8Array(2)
  new DataView(output.buffer).setUint16(0, value, true)
  return output
}

function u32(value: number) {
  const output = new Uint8Array(4)
  new DataView(output.buffer).setUint32(0, value >>> 0, true)
  return output
}

function utf16(text: string) {
  const output = new Uint8Array(text.length * 2)
  const view = new DataView(output.buffer)
  for (let index = 0; index < text.length; index += 1) view.setUint16(index * 2, text.charCodeAt(index), true)
  return output
}

/** Build a small but valid CFB/OLE container for deterministic Office 97-2003 samples. */
function buildOle(streams: Record<string, Uint8Array>): Uint8Array {
  const entries = Object.entries(streams).map(([name, data]) => ({ name, data }))
  const padded = entries.map((entry) => {
    const sectors = Math.max(1, Math.ceil(entry.data.length / 512))
    const data = new Uint8Array(sectors * 512)
    data.set(entry.data)
    return { name: entry.name, size: entry.data.length, data, sectors }
  })
  const sectorCount = padded.reduce((sum, entry) => sum + entry.sectors, 0)
  const fatSectors = Math.max(1, Math.ceil((sectorCount + 2) / 128))
  const dataStart = fatSectors + 1
  const header = new Uint8Array(512)
  const headerView = new DataView(header.buffer)
  header.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
  headerView.setUint16(0x1e, 9, true)
  headerView.setUint16(0x20, 6, true)
  headerView.setUint32(0x2c, fatSectors, true)
  headerView.setUint32(0x30, fatSectors, true)
  headerView.setUint32(0x38, 4096, true)
  headerView.setUint32(0x3c, 0xfffffffe, true)
  headerView.setUint32(0x44, 0xfffffffe, true)
  for (let index = 0; index < 109; index += 1) headerView.setUint32(0x4c + index * 4, 0xffffffff, true)
  for (let index = 0; index < fatSectors; index += 1) headerView.setUint32(0x4c + index * 4, index, true)

  const fat = new Uint8Array(fatSectors * 512)
  const fatView = new DataView(fat.buffer)
  for (let index = 0; index < fatView.byteLength / 4; index += 1) fatView.setUint32(index * 4, 0xffffffff, true)
  for (let index = 0; index < fatSectors; index += 1) fatView.setUint32(index * 4, 0xfffffffe, true)
  fatView.setUint32(fatSectors * 4, 0xfffffffe, true)
  let sector = dataStart
  for (const entry of padded) {
    for (let index = 0; index < entry.sectors; index += 1) {
      const current = sector + index
      fatView.setUint32(current * 4, index === entry.sectors - 1 ? 0xfffffffe : current + 1, true)
    }
    sector += entry.sectors
  }

  const directory = new Uint8Array(512)
  const directoryView = new DataView(directory.buffer)
  const writeEntry = (index: number, name: string, type: number, start: number, size: number) => {
    const offset = index * 128
    directory.set(utf16(name + String.fromCharCode(0)).subarray(0, 64), offset)
    directoryView.setUint16(offset + 64, Math.min((name.length + 1) * 2, 64), true)
    directoryView.setUint8(offset + 66, type)
    directoryView.setUint32(offset + 116, start, true)
    directoryView.setUint32(offset + 120, size, true)
  }
  writeEntry(0, "Root Entry", 5, 0xfffffffe, 0)
  sector = dataStart
  padded.forEach((entry, index) => {
    writeEntry(index + 1, entry.name, 2, sector, entry.size)
    sector += entry.sectors
  })
  return concat([header, fat, directory, ...padded.map((entry) => entry.data)])
}

function docSample(): Uint8Array {
  const text = "Office 97 DOC panel sample"
  const word = new Uint8Array(4096)
  const wordView = new DataView(word.buffer)
  wordView.setUint16(0x000a, 0x0200, true)
  wordView.setUint32(0x004c, text.length, true)
  word.set(utf16(text), 0x0200)
  const table = new Uint8Array(512)
  const tableView = new DataView(table.buffer)
  const base = 0x0100
  const clxLength = 4 + 2 * 4 + 8
  table[base] = 0x02
  tableView.setUint32(base + 1, clxLength, true)
  tableView.setUint32(base + 5, 0, true)
  tableView.setUint32(base + 9, text.length, true)
  tableView.setUint32(base + 15, 0x0200, true)
  wordView.setUint32(0x01a2, base, true)
  wordView.setUint32(0x01a6, clxLength + 5, true)
  const tableStream = new Uint8Array(4096)
  tableStream.set(table)
  return buildOle({ WordDocument: word, "1Table": tableStream })
}

function padToRegularStream(bytes: Uint8Array) {
  const output = new Uint8Array(4096)
  output.set(bytes)
  return output
}

function biff(id: number, data: Uint8Array) {
  return concat([u16(id), u16(data.length), data])
}

function xlsSample(): Uint8Array {
  const biffString = (text: string) => concat([u16(text.length), new Uint8Array([0x01]), utf16(text)])
  const sst = biff(0x00fc, concat([u32(1), u32(1), biffString("名称")]))
  const boundsheet = (start: number) =>
    biff(0x0085, concat([u32(start), new Uint8Array([0, 0]), new Uint8Array([2, 1]), utf16("数据")]))
  const sheetStart = sst.length + boundsheet(0).length
  const labelIndex = new Uint8Array(4)
  new DataView(labelIndex.buffer).setUint32(0, 0, true)
  const label = biff(0x00fd, concat([u16(0), u16(0), u16(0), labelIndex]))
  const number = biff(0x0203, concat([u16(1), u16(1), u16(0), new Uint8Array(8)]))
  new DataView(number.buffer).setFloat64(10, 120, true)
  const worksheet = concat([biff(0x0809, new Uint8Array(16)), label, number, biff(0x000a, new Uint8Array(0))])
  return buildOle({ Workbook: padToRegularStream(concat([sst, boundsheet(sheetStart), worksheet])) })
}

function pptRecord(type: number, body: Uint8Array) {
  return concat([u16(0), u16(type), u32(body.length), body])
}

function pptSample(): Uint8Array {
  const first = pptRecord(0x03ee, pptRecord(0x0fa0, utf16("Office 97 PPT panel sample")))
  return buildOle({ "PowerPoint Document": padToRegularStream(pptRecord(0x03e8, first)) })
}

test.use({ channel: "chrome", video: "off", trace: "off" })
test.skip(
  Boolean(process.versions.bun),
  "Bun cannot strip workspace TypeScript imported from node_modules; run this suite with Node",
)
test.beforeAll(async () => {
  const legacy = await import("@novaway/core/office/legacy/read")
  const engine = await import("@novaway/core/office/engine/registry")
  readLegacyDocument = legacy.readLegacyDocument
  engineFor = engine.engineFor
  if (samples) {
    for (const ext of ["doc", "xls", "ppt"])
      await writeFile(path(ext), await readFile(resolve(samples, `sample.${ext}`)))
  } else {
    await writeFile(path("doc"), docSample())
    await writeFile(path("xls"), xlsSample())
    await writeFile(path("ppt"), pptSample())
  }
  await writeFile(path("rtf"), String.raw`{\rtf1\ansi Legacy RTF panel verification\par}`)
  for (const ext of ["ods", "odp"]) {
    const zip = new JSZip()
    const body =
      ext === "ods"
        ? '<office:spreadsheet><table:table table:name="Data"><table:table-row><table:table-cell><text:p>Legacy ODS panel verification</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet>'
        : '<office:presentation><draw:page draw:name="Cover"><text:p>Legacy ODP panel verification</text:p></draw:page></office:presentation>'
    zip.file("mimetype", `application/vnd.oasis.opendocument.${ext === "ods" ? "spreadsheet" : "presentation"}`)
    zip.file(
      "content.xml",
      `<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"><office:body>${body}</office:body></office:document-content>`,
    )
    await writeFile(path(ext), await zip.generateAsync({ type: "uint8array" }))
  }
})
test.afterAll(async () => {
  await Promise.all(variants.map(({ extension }) => unlink(path(extension)).catch(() => {})))
  const generated = await readdir(root).then((entries) =>
    entries
      .filter((entry) =>
        new RegExp(`^office-legacy-${process.pid}-edited-\\d+-[a-z0-9]+\\.(docx|xlsx|pptx)$`).test(entry),
      )
      .map((entry) => unlink(resolve(root, entry)).catch(() => {})),
  )
  await Promise.all(generated)
})

for (const { extension, target } of variants) {
  test(`${extension.toUpperCase()} 文件面板打开、确认转换另存 ${target.toUpperCase()} 并保留原件`, async ({ page }) => {
    const original = new Uint8Array(await readFile(path(extension)))
    const document = await readLegacyDocument(original, extension)
    const marker =
      document.sheets.flatMap((sheet) => sheet.rows.flat()).find((value) => value.trim().length > 2) ??
      document.paragraphs.find((value) => value.trim().length > 2)
    expect(marker).toBeTruthy()
    await page.setViewportSize({ width: 1600, height: 900 })
    await page.goto(`/${slug}/session`)
    await page
      .getByRole("button", { name: /Add panel tab|新增面板标签/ })
      .first()
      .click()
    await page
      .getByRole("menuitem", { name: /^(Files|文件)$/ })
      .first()
      .click()
    const search = page.getByPlaceholder(/Search files|搜索文件/).first()
    await search.fill(name(extension))
    const row = page
      .locator('[data-component="list"] button[data-slot="list-item"]')
      .filter({ hasText: name(extension) })
    // File.scan is lazy and the fixture is deliberately created in beforeAll.
    // Re-issue the query once after the initial cache has been populated instead
    // of treating the first empty result as a missing legacy file.
    await expect(async () => {
      if (
        !(await row
          .first()
          .isVisible()
          .catch(() => false))
      ) {
        await search.fill("")
        await search.fill(name(extension))
      }
      await expect(row.first()).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 30_000 })
    await row.first().click()
    await expect(search).toBeHidden()
    await expect(page.locator("[data-office-editor-host]")).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(/已转换为 .* 编辑；保存只写入现代格式副本/)).toBeVisible()
    await expect(page.getByText(/只读预览（旧格式）/)).toHaveCount(0)
    await expect(page.locator('[data-action="legacy-edit-paragraph"], [data-action="legacy-edit-cell"]')).toHaveCount(0)
    await page.getByRole("button", { name: /More options|更多选项/ }).click()
    await page.getByRole("menuitem", { name: new RegExp(`导出为 \.${target}|Export as \.${target}`, "i") }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toContainText("不会覆盖原文件")
    const wait = page.waitForEvent("download")
    await dialog.getByRole("button", { name: "继续导出副本" }).click()
    const download = await wait
    expect(download.suggestedFilename()).toBe(name(extension).replace(/\.[^.]+$/, `.${target}`))
    const converted = new Uint8Array(await readFile(await download.path()))
    expect((await engineFor(target)!.open(converted)).ok).toBe(true)
    const zip = await JSZip.loadAsync(converted)
    const xml = (
      await Promise.all(
        Object.keys(zip.files)
          .filter((part) => /\.xml$/.test(part))
          .map((part) => zip.file(part)!.async("string")),
      )
    ).join("\n")
    expect(xml).toContain(marker!)
    expect(new Uint8Array(await readFile(path(extension)))).toEqual(original)
  })
}
