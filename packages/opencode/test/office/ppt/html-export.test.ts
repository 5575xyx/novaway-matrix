import { describe, expect, test } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import JSZip from "jszip"
import { tmpdir } from "../../fixture/fixture"
import { fingerprintHtmlSlides } from "../../../src/office/pptx/html-review"
import { inspectPptx, listHtmlSlides, resolveOutput, validateReview } from "../../../src/office/pptx/html-export"

describe("html pptx export helpers", () => {
  test("lists page html slides in page order", async () => {
    await using tmp = await tmpdir()
    const pages = path.join(tmp.path, "pages")
    await mkdir(pages, { recursive: true })
    await writeFile(path.join(pages, "page_02.html"), "<html/>")
    await writeFile(path.join(pages, "page_01.html"), "<html/>")
    await writeFile(path.join(pages, "notes.txt"), "not a slide")

    expect(await listHtmlSlides(pages)).toEqual([path.join(pages, "page_01.html"), path.join(pages, "page_02.html")])
  })

  test("rejects a deck without page html files", async () => {
    await using tmp = await tmpdir()
    await expect(listHtmlSlides(path.join(tmp.path, "empty"))).rejects.toThrow("没有 page_*.html")
  })

  test("resolves output paths relative to the deck directory", async () => {
    await using tmp = await tmpdir()
    expect(resolveOutput(tmp.path, undefined)).toBe(path.join(tmp.path, `${path.basename(tmp.path)}.pptx`))
    expect(resolveOutput(tmp.path, "out/x")).toBe(path.join(tmp.path, "out/x.pptx"))
    expect(resolveOutput(tmp.path, "out/已导出.PPTX")).toBe(path.join(tmp.path, "out/已导出.PPTX"))
  })

  test("rejects export when the visual review is missing", async () => {
    await using tmp = await tmpdir()
    await expect(validateReview(tmp.path, [], false)).rejects.toThrow("缺少 review.json")
    expect(await validateReview(tmp.path, [], true)).toEqual(["缺少视觉审查报告，已通过 --force 明确跳过"])
  })

  test("rejects a blocked visual review", async () => {
    await using tmp = await tmpdir()
    await writeFile(path.join(tmp.path, "review.json"), JSON.stringify({ status: "blocked", sourceFingerprint: "x" }))
    await expect(validateReview(tmp.path, [], false)).rejects.toThrow("视觉审查未通过")
  })

  test("accepts a passed review whose fingerprint matches the pages", async () => {
    await using tmp = await tmpdir()
    const pages = path.join(tmp.path, "pages")
    await mkdir(pages, { recursive: true })
    const slide = path.join(pages, "page_01.html")
    await writeFile(slide, "<html><body><h1>标题</h1></body></html>")
    await writeFile(
      path.join(tmp.path, "review.json"),
      JSON.stringify({ status: "passed", sourceFingerprint: await fingerprintHtmlSlides([slide]) }),
    )
    expect(await validateReview(tmp.path, [slide], false)).toEqual([])
  })

  test("rejects a passed review with a stale fingerprint", async () => {
    await using tmp = await tmpdir()
    const pages = path.join(tmp.path, "pages")
    await mkdir(pages, { recursive: true })
    const slide = path.join(pages, "page_01.html")
    await writeFile(slide, "<html><body><h1>标题</h1></body></html>")
    await writeFile(path.join(tmp.path, "review.json"), JSON.stringify({ status: "passed", sourceFingerprint: "old" }))
    await expect(validateReview(tmp.path, [slide], false)).rejects.toThrow("不匹配")
  })
})

describe("pptx postflight inspection", () => {
  test("passes a package with editable text and native shapes", async () => {
    await using tmp = await tmpdir()
    const zip = new JSZip()
    zip.file("[Content_Types].xml", "<Types/>")
    zip.file("ppt/presentation.xml", "<p:presentation/>")
    zip.file("ppt/slides/slide1.xml", "<p:sld><p:spTree><p:sp><a:t>标题</a:t></p:sp></p:spTree></p:sld>")
    const file = path.join(tmp.path, "deck.pptx")
    await writeFile(file, await zip.generateAsync({ type: "nodebuffer" }))

    const result = await inspectPptx(file, 1, [])
    expect(result.status).toBe("passed")
    expect(result.slideCount).toBe(1)
    expect(result.editableTextRuns).toBeGreaterThan(0)
    expect(result.shapeNodes).toBeGreaterThan(0)
    expect(result.pictureNodes).toBe(0)
  })

  test("rejects a slide count mismatch", async () => {
    await using tmp = await tmpdir()
    const zip = new JSZip()
    zip.file("[Content_Types].xml", "<Types/>")
    zip.file("ppt/presentation.xml", "<p:presentation/>")
    zip.file("ppt/slides/slide1.xml", "<p:sld><p:sp><a:t>标题</a:t></p:sp></p:sld>")
    const file = path.join(tmp.path, "deck.pptx")
    await writeFile(file, await zip.generateAsync({ type: "nodebuffer" }))

    await expect(inspectPptx(file, 2, [])).rejects.toThrow("预期 2 页")
  })

  test("rejects a flattened shell without editable shapes", async () => {
    await using tmp = await tmpdir()
    const zip = new JSZip()
    zip.file("[Content_Types].xml", "<Types/>")
    zip.file("ppt/presentation.xml", "<p:presentation/>")
    zip.file("ppt/slides/slide1.xml", "<p:sld><p:spTree/></p:sld>")
    const file = path.join(tmp.path, "deck.pptx")
    await writeFile(file, await zip.generateAsync({ type: "nodebuffer" }))

    await expect(inspectPptx(file, 1, [])).rejects.toThrow("扁平化空壳")
  })

  test("rejects a package missing the OOXML contract", async () => {
    await using tmp = await tmpdir()
    const zip = new JSZip()
    zip.file("ppt/slides/slide1.xml", "<p:sld/>")
    const file = path.join(tmp.path, "deck.pptx")
    await writeFile(file, await zip.generateAsync({ type: "nodebuffer" }))

    await expect(inspectPptx(file, 1, [])).rejects.toThrow("OOXML 包文件")
  })
})
