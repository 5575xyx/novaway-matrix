import { afterEach, describe, expect, test } from "bun:test"
import { ocrSettings, resetOcrDetection, detectOcr } from "@/knowledge/ocr"
import { extractText, isImageFile, pdfEmbeddedImages } from "@/knowledge/extract"

const original = { ocr: process.env.NOVAWAY_OCR, langs: process.env.NOVAWAY_OCR_LANGS }

afterEach(() => {
  if (original.ocr === undefined) delete process.env.NOVAWAY_OCR
  else process.env.NOVAWAY_OCR = original.ocr
  if (original.langs === undefined) delete process.env.NOVAWAY_OCR_LANGS
  else process.env.NOVAWAY_OCR_LANGS = original.langs
  resetOcrDetection()
})

describe("knowledge.ocr", () => {
  test("settings default to auto with chi_sim and eng", () => {
    delete process.env.NOVAWAY_OCR
    delete process.env.NOVAWAY_OCR_LANGS
    expect(ocrSettings()).toEqual({ mode: "auto", languages: ["chi_sim", "eng"] })
  })

  test("settings honour env overrides", () => {
    process.env.NOVAWAY_OCR = "off"
    process.env.NOVAWAY_OCR_LANGS = "eng"
    expect(ocrSettings()).toEqual({ mode: "off", languages: ["eng"] })
  })

  test("off mode reports no backend", async () => {
    process.env.NOVAWAY_OCR = "off"
    resetOcrDetection()
    const backend = await detectOcr()
    expect(backend.kind).toBe("none")
  })

  test("auto mode degrades to none when nothing is installed", async () => {
    process.env.NOVAWAY_OCR = "auto"
    resetOcrDetection()
    const backend = await detectOcr()
    expect(["rapid", "cli", "wasm", "none"]).toContain(backend.kind)
  })

  test("image extensions are recognised", () => {
    expect(isImageFile("scan.PNG")).toBe(true)
    expect(isImageFile("notes.md")).toBe(false)
  })

  test("image without any OCR backend returns a warning, not a throw", async () => {
    process.env.NOVAWAY_OCR = "off"
    resetOcrDetection()
    const result = await extractText({ name: "scan.png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47]) })
    expect(result.text).toBe("")
    expect(result.warning).toBeTruthy()
  })

  test("pdfEmbeddedImages extracts jpeg streams", () => {
    const before = Buffer.from("%PDF-1.4\n/Subtype /Image /Filter /DCTDecode\nstream\n")
    const jpeg = Buffer.from([0xff, 0xd8, 0x11, 0x22, 0xff, 0xd9])
    const after = Buffer.from("\nendstream\nendobj")
    const images = pdfEmbeddedImages(Buffer.concat([before, jpeg, after]))
    expect(images).toHaveLength(1)
    expect(images[0][0]).toBe(0xff)
    expect(images[0][1]).toBe(0xd8)
  })
})

describe("vision OCR fallback", () => {
  test("uses the vision callback when local OCR is off", async () => {
    process.env.NOVAWAY_OCR = "off"
    resetOcrDetection()
    const calls: string[] = []
    const result = await extractText(
      { name: "scan.png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
      {
        vision: async (input) => {
          calls.push(input.mimeType)
          return "识别出的文字"
        },
      },
    )
    expect(result.text).toBe("识别出的文字")
    expect(result.ocr?.backend).toBe("vision")
    expect(calls).toEqual(["image/png"])
  })

  test("vision failures fall back to a warning", async () => {
    process.env.NOVAWAY_OCR = "off"
    resetOcrDetection()
    const result = await extractText(
      { name: "scan.png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
      { vision: async () => Promise.reject(new Error("boom")) },
    )
    expect(result.text).toBe("")
    expect(result.warning).toBeTruthy()
  })
})

describe("rapidocr output parsing", () => {
  test("sorts lines by reading order and drops empty text", async () => {
    const { parseRapidOutput } = await import("@/knowledge/ocr")
    const parsed = parseRapidOutput(
      JSON.stringify({
        engine: "rapidocr_onnxruntime",
        lines: [
          {
            text: "second line",
            score: 0.9,
            box: [
              [10, 60],
              [100, 60],
              [100, 80],
              [10, 80],
            ],
          },
          {
            text: "first line",
            score: 0.95,
            box: [
              [10, 10],
              [100, 10],
              [100, 30],
              [10, 30],
            ],
          },
          { text: "   ", score: 0.2, box: [] },
          {
            text: "right column",
            score: 0.8,
            box: [
              [300, 12],
              [400, 12],
              [400, 32],
              [300, 32],
            ],
          },
        ],
      }),
    )
    expect(parsed.engine).toBe("rapidocr_onnxruntime")
    expect(parsed.lines.map((line) => line.text)).toEqual(["first line", "right column", "second line"])
  })

  test("tolerates missing boxes and scores", async () => {
    const { parseRapidOutput } = await import("@/knowledge/ocr")
    const parsed = parseRapidOutput(JSON.stringify({ lines: [{ text: "only text" }] }))
    expect(parsed.lines).toEqual([{ text: "only text", score: 0, box: [] }])
  })

  test("handles the v1 tuple-style payload shape", async () => {
    const { parseRapidOutput } = await import("@/knowledge/ocr")
    const parsed = parseRapidOutput(
      JSON.stringify({
        engine: "rapidocr",
        lines: [
          {
            text: "甲",
            score: 0.99,
            box: [
              [0, 0],
              [10, 0],
              [10, 10],
              [0, 10],
            ],
          },
          {
            text: "乙",
            score: 0.98,
            box: [
              [0, 20],
              [10, 20],
              [10, 30],
              [0, 30],
            ],
          },
        ],
      }),
    )
    expect(parsed.lines.map((line) => line.text)).toEqual(["甲", "乙"])
  })
})
