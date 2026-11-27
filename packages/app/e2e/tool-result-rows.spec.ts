import { expect, test, type Locator } from "@playwright/test"

const statusIcon = '[data-slot="tool-status-icon"] use'
const trigger = '[data-slot="collapsible-trigger"]'

async function expectStatus(row: Locator, tone: "success" | "critical") {
  const icon = row.locator(statusIcon)
  const themedColor = await row.evaluate((element, tone) => {
    const sample = document.createElement("span")
    sample.style.color = `var(--icon-${tone}-base)`
    element.append(sample)
    const color = getComputedStyle(sample).color
    sample.remove()
    return color
  }, tone)
  await expect(icon).toHaveAttribute("href", tone === "success" ? /-lu-check$/ : /-lu-x$/)
  await expect(icon).toHaveCSS("color", themedColor)
}

for (const scheme of ["light", "dark"] as const) {
  test(`tool result icons retain their semantic colors in ${scheme}, including on hover`, async ({ page }) => {
    await page.goto("/e2e/fixtures/tool-result-rows.html")
    await page.getByRole("button", { name: new RegExp(`^${scheme}$`, "i") }).click()
    await expect(page.locator("html")).toHaveAttribute("data-color-scheme", scheme)
    for (const [id, tone] of [
      ["edit", "success"],
      ["bash", "success"],
      ["write", "critical"],
      ["apply_patch", "critical"],
      ["context", "success"],
    ] as const) {
      const row = page.getByTestId(id)
      await expectStatus(row, tone)
      await row.locator(trigger).hover()
      await expectStatus(row, tone)
    }
  })
}

test("file results keep the name beside the action and show the diff only after expansion", async ({ page }) => {
  await page.goto("/e2e/fixtures/tool-result-rows.html")
  for (const [id, name] of [
    ["edit", "renamed.ts"],
    ["write", "blocked.ts"],
    ["apply_patch", "main.ts"],
    ["history", "history.ts"],
    ["write-history", "new.ts"],
  ]) {
    const summary = page.getByTestId(id).locator(trigger)
    await expect(summary.getByText(name, { exact: true })).toBeVisible()
    await expect(summary).toHaveAttribute("aria-expanded", "false")
  }
  const edit = page.getByTestId("edit")
  const diff = edit.locator('[data-component="file"][data-mode="diff"]')
  await expect(diff).toBeHidden()
  await edit.locator(trigger).click()
  const deletion = diff.locator('[data-line][data-line-type="change-deletion"]')
  const addition = diff.locator('[data-line][data-line-type="change-addition"]')
  await expect(deletion).toBeVisible()
  await expect(deletion).toContainText("before")
  await expect(addition).toBeVisible()
  await expect(addition).toContainText("after")

  const write = page.getByTestId("write-history")
  await write.locator(trigger).click()
  await expect(write.locator('[data-line][data-line-type="change-addition"]')).toContainText("new file content")
})
