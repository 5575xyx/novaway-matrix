import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { connect } from "../../src/browser/cdp"

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** 起一次真实的 headless 浏览器：这条链路就是"浏览器不可用"的修复点，值得端到端验。 */
describe("cdp", () => {
  test("navigates and captures a PNG screenshot", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "novaway-cdp-"))
    const file = path.join(dir, "index.html")
    await fs.writeFile(file, "<h1 id=title>hello nova</h1>")
    const session = await connect()
    try {
      await session.page.navigate(pathToFileURL(file).href)
      expect(await session.page.title()).toBe("")
      const bytes = await session.page.screenshot(false)
      expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true)
      expect(bytes.byteLength).toBeGreaterThan(500)
    } finally {
      await session.close()
      await fs.rm(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
