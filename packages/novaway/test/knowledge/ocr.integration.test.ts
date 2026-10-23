import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { detectOcr, ocrImage } from "@/knowledge/ocr"

/**
 * 真机集成测试：只有本机装了 RapidOCR 时才跑。
 * 样例图由 test/knowledge/rapid-sample.png 提供（两行英文）。
 */
const backend = await detectOcr()
const ready = backend.kind === "rapid"

describe("ocr integration", () => {
  test.skipIf(!ready)("rapidocr reads a rendered image", async () => {
    const buffer = await fs.readFile(path.join(import.meta.dir, "rapid-sample.png"))
    const result = await ocrImage(buffer)
    expect(result.backend).toBe("rapid")
    expect(result.error).toBeUndefined()
    expect(result.text.toUpperCase()).toContain("RAPID")
    expect(result.text.toLowerCase()).toContain("second line here")
  })

  test.skipIf(!ready)("backend reports a concrete engine label", () => {
    expect(backend.label).toContain("RapidOCR")
  })
})
