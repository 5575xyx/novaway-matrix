import { test } from "@playwright/test"
test("debug office zen", async ({ page }) => {
  await page.goto("/")
  await page
    .getByRole("button", { name: /切换工作模式|Switch work mode/ })
    .first()
    .click()
  await page.getByRole("menuitem", { name: "禅意" }).click()
  await page.waitForTimeout(800)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(1200)
  const info = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('[role="tab"]')] as HTMLElement[]
    const ppt = tabs.find((t) => t.textContent?.trim() === "PPT生成")!
    const r = ppt.getBoundingClientRect()
    const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) as HTMLElement | null
    const boxes = document
      .elementsFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      .slice(0, 6)
      .map((e) => {
        const er = e.getBoundingClientRect()
        return `${e.tagName}.${(e.className || "").toString().slice(0, 46)} [${Math.round(er.x)},${Math.round(er.y)} ${Math.round(er.width)}x${Math.round(er.height)}] text="${(e.textContent || "").trim().slice(0, 24)}"`
      })
    return { top: el ? `${el.tagName}.${(el.className || "").toString().slice(0, 40)}` : null, boxes }
  })
  console.log(JSON.stringify(info, null, 1))
})
