import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { connect } from "../../src/browser/cdp"

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** 起一次真实的 headless 浏览器：这条链路就是"浏览器不可用"的修复点，值得端到端验。 */
describe.serial("cdp", () => {
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

  test("lists and switches browser tabs without closing the browser context", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "novaway-cdp-tabs-"))
    const file = path.join(dir, "tab.html")
    await fs.writeFile(file, "<title>second tab</title><p>tab content</p>")
    const session = await connect()
    const extra = await session.newPage()
    try {
      await extra.page.navigate(pathToFileURL(file).href)
      const tabs = await session.tabs()
      expect(tabs.some((tab) => tab.targetId === extra.targetId)).toBe(true)
      await session.selectTab(extra.targetId)
      expect(await session.page.title()).toBe("second tab")
    } finally {
      await extra.dispose()
      await session.close()
      await fs.rm(dir, { recursive: true, force: true })
    }
  }, 60_000)
  test("uses snapshot tokens to click and fill real page controls", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "novaway-cdp-controls-"))
    const file = path.join(dir, "index.html")
    await fs.writeFile(
      file,
      '<input id="name"><button id="go" onclick="document.body.dataset.clicked=document.querySelector(\'#name\').value">Go</button>',
    )
    const session = await connect()
    try {
      await session.page.navigate(pathToFileURL(file).href)
      const snapshot = await session.page.snapshot<{
        snapshotToken: string
        refs: Array<{ ref: string; tag: string }>
      }>(
        `(() => {
          const token = crypto.randomUUID()
          const refs = [...document.querySelectorAll("input,button")].map((el, index) => {
            const ref = "e" + (index + 1)
            el.setAttribute("data-nv-ref", ref)
            el.setAttribute("data-nv-snapshot", token)
            return { ref, tag: el.tagName.toLowerCase() }
          })
          return { snapshotToken: token, refs }
        })()`,
      )
      const input = snapshot.refs.find((item) => item.tag === "input")!
      const button = snapshot.refs.find((item) => item.tag === "button")!
      await session.page.fillRef(input.ref, "hello nova")
      await session.page.clickRef(button.ref)
      expect(await session.page.evaluate<string>("document.body.dataset.clicked")).toBe("hello nova")
    } finally {
      await session.close()
      await fs.rm(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
