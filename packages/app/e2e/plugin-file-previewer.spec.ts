import { expect, test } from "@playwright/test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const backend = () => `http://127.0.0.1:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
const projectSlug = (directory: string) =>
  Buffer.from(directory, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")

test("D4: builtin Office previewer renders and follows plugin disable and re-enable", async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), "novaway-d4-previewer-"))
  await writeFile(join(directory, "d4-note.foo"), "d4 previewer body")
  try {
    await page.addInitScript(
      ({ directory }) => {
        const value = JSON.stringify({
          list: [],
          projects: { local: [{ worktree: directory, expanded: true }] },
          lastProject: {},
        })
        localStorage.setItem("novaway.global.dat:server", value)
        localStorage.setItem("novaway.global.dat:server.v3", value)
      },
      { directory },
    )
    await page.goto(`/${projectSlug(directory)}/session`)
    const treeItem = page.locator('[role="treeitem"][aria-label="d4-note.foo"]').first()
    await expect(treeItem).toBeVisible({ timeout: 20_000 })
    await treeItem.evaluate((element) => (element as HTMLElement).click())

    const previewer = page.locator('[data-slot="plugin-file-previewer"][data-previewer-id="foo-preview"]').first()
    await expect(previewer).toBeVisible({ timeout: 20_000 })

    const toggle = async (enabled: boolean) => {
      const response = await page.request.patch(`${backend()}/plugin/novaway-ui`, {
        headers: { "x-novaway-directory": directory },
        data: { enabled, scope: "builtin" },
      })
      return response.status()
    }

    expect(await toggle(false)).toBe(200)
    await expect(page.locator('[data-slot="plugin-file-previewer"]')).toHaveCount(0, { timeout: 20_000 })

    expect(await toggle(true)).toBe(200)
    await expect(
      page.locator('[data-slot="plugin-file-previewer"][data-previewer-id="foo-preview"]').first(),
    ).toBeVisible({
      timeout: 20_000,
    })
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {})
  }
})
