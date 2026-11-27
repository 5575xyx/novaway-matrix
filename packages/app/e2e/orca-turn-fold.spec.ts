import { expect, test } from "@playwright/test"

test.describe("Orca 风格聊天运行组", () => {
  test.beforeEach(async ({ page }) => {
    page.on("pageerror", (error) => console.error("orca-turn-fold pageerror:", error.message))
    page.on("console", (message) => {
      if (message.type() === "error") console.error("orca-turn-fold console:", message.text())
    })
    await page.goto("/e2e/fixtures/orca-turn-fold.html")
  })

  test("完成、中断、继续和错误详情保持统一的运行组结构", async ({ page }) => {
    const groups = page.locator('[data-component="turn-fold"]')
    await expect(groups).toHaveCount(3)
    await expect(page.locator('[data-testid="completed"] [data-component="turn-fold-trigger"]')).toContainText(
      "已运行 2 条命令 和 已编辑 1 个文件",
    )
    await expect(page.locator('[data-testid="interrupted"] [data-component="turn-fold-trigger"]')).toContainText(
      "已运行 1 条命令",
    )
    await expect(page.locator('[data-testid="continued"] [data-component="turn-fold-trigger"]')).toContainText(
      "已运行 1 条命令 和 已编辑 1 个文件",
    )
    await expect(page.locator('[data-component="turn-divider"]')).toHaveText("已中断")
    await expect(page.locator('[data-component="error-detail"]')).toBeVisible()
  })

  test("折叠默认收起，展开后显示紧凑明细和左侧引导线", async ({ page }) => {
    const group = page.locator('[data-testid="completed"]')
    const trigger = group.locator('[data-component="turn-fold-trigger"]')
    const detail = group.locator('[data-component="turn-fold-detail"]')
    await expect(trigger).toHaveAttribute("aria-expanded", "false")
    await expect(detail).toHaveAttribute("aria-hidden", "true")
    await expect(group.locator(".turn-fold-fixture-row")).toHaveCount(2)

    const triggerStyle = await trigger.evaluate((element) => {
      const style = getComputedStyle(element)
      return { border: style.borderWidth, background: style.backgroundColor }
    })
    expect(triggerStyle.border).toBe("0px")
    expect(triggerStyle.background).toBe("rgba(0, 0, 0, 0)")

    await trigger.click()
    await expect(trigger).toHaveAttribute("aria-expanded", "true")
    await expect(detail).toHaveAttribute("aria-hidden", "false")
    await expect(group.locator(".turn-fold-fixture-row")).toHaveCount(2)
    const rail = group.locator('[data-component="turn-fold-rows"]')
    const railStyle = await rail.evaluate((element) => getComputedStyle(element).borderLeftWidth)
    expect(railStyle).toBe("1px")
  })

  test("窄屏不产生横向溢出，运行组明细仍可展开", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const group = page.locator('[data-testid="continued"]')
    await group.locator('[data-component="turn-fold-trigger"]').click()
    await expect(group.locator(".turn-fold-fixture-row")).toHaveCount(2)
    expect(
      await page.locator("body").evaluate((element) => element.scrollWidth - element.clientWidth),
    ).toBeLessThanOrEqual(1)
  })
})
