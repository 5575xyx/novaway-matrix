import { expect, test } from "@playwright/test"
import { join, resolve } from "node:path"
import { rm, writeFile } from "node:fs/promises"

const backend = () => `http://127.0.0.1:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
const projectSlug = (directory: string) =>
  Buffer.from(directory, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")

test.setTimeout(180_000)

test("D4: builtin Office previewer renders and follows plugin disable and re-enable", async ({ page }) => {
  const directory = resolve(process.cwd(), "..", "novaway")
  const fileName = `novaway-d4-preview-${Date.now()}.foo`
  const filePath = join(directory, fileName)
  await writeFile(filePath, "d4 previewer body")
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
    await page.getByRole("button", { name: "Files", exact: true }).click()
    await page.getByRole("button", { name: "Open file tree in side panel" }).click()
    const treeItem = page.locator(`[role="treeitem"][aria-label^="${fileName}"]`).first()
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
    await rm(filePath, { force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {})
  }
})
