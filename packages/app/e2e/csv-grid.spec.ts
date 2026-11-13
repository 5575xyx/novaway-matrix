import { expect, test } from "@playwright/test"

test.use({ channel: "chrome", video: "off", trace: "off" })

test("CSV 网格保留文本值、引用字段与 CRLF，并允许结构编辑", async ({ page }) => {
  await page.goto("/e2e/fixtures/csv-grid.html")
  const text = page.locator('[data-slot="csv-text"]')
  await expect(page.locator('[data-component="csv-grid"]')).toContainText("a,b")
  await expect(page.locator('[data-component="csv-grid"]')).toContainText("=1+1")
  await page.locator('[data-component="csv-grid"] tbody tr').nth(1).locator("td").nth(0).dblclick()
  await page.locator("input").fill("Bob")
  await page.locator("input").press("Enter")
  await expect
    .poll(() => text.evaluate((element) => element.textContent))
    .toBe('name,amount,note\r\nBob,12,"a,b"\r\n=1+1,0,plain')
  await page.locator("[data-action=csv-insertRows]").click()
  await expect
    .poll(() => text.evaluate((element) => element.textContent))
    .toBe('name,amount,note\r\nBob,12,"a,b"\r\n,,\r\n=1+1,0,plain')
})

test("CSV BOM、分号分隔、Unicode 与公式样式文本编辑后均保留", async ({ page }) => {
  await page.goto("/e2e/fixtures/csv-grid.html?bom")
  const text = page.locator('[data-slot="csv-text"]')
  const grid = page.locator('[data-component="csv-grid"]')
  await expect(grid.locator("tbody tr").first().locator("td").first()).toHaveText("姓名")
  await expect(grid).toContainText("=1+1")

  await grid.locator("tbody tr").nth(1).locator("td").nth(2).dblclick()
  await page.locator("input").fill("保留;分号")
  await page.locator("input").press("Enter")
  await expect
    .poll(() => text.evaluate((element) => element.textContent))
    .toBe('﻿姓名;金额;备注\r\n张三;12;"保留;分号"\r\n=1+1;0;文本')

  await grid.locator("tbody tr").nth(2).locator("td").nth(0).click()
  await page.keyboard.press("Escape")
  await page.locator("[data-action=csv-insertColumns]").click()
  await expect
    .poll(() => text.evaluate((element) => element.textContent))
    .toBe('﻿;姓名;金额;备注\r\n;张三;12;"保留;分号"\r\n;=1+1;0;文本')
})

test("CSV 阅读模式隐藏编辑控件", async ({ page }) => {
  await page.goto("/e2e/fixtures/csv-grid.html?readonly")
  await expect(page.locator("[data-action=csv-insertRows]")).toHaveCount(0)
  await expect(page.locator('[data-component="csv-grid"] td')).toHaveCount(9)
})
