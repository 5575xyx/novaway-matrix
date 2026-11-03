import { expect, test } from "@playwright/test"

test.use({ channel: "chrome", video: "off", trace: "off" })

const FIXTURE = "/e2e/fixtures/diff-style.html"

async function open(page: import("@playwright/test").Page) {
  await page.goto(FIXTURE)
  await expect(page.locator("diffs-container").first()).toBeVisible({ timeout: 20_000 })
  // pierre 把行渲染在 shadow DOM 里；Playwright 的 CSS 选择器会自动穿透。
  await expect(page.locator("[data-line][data-line-type='change-addition']").first()).toBeVisible({ timeout: 20_000 })
  return {
    // 经典 +/- 指示符与行底色都挂在 [data-line] 上（行号列 [data-column-number] 不带）。
    addition: page.locator("[data-line][data-line-type='change-addition']").first(),
    deletion: page.locator("[data-line][data-line-type='change-deletion']").first(),
    context: page.locator("[data-line][data-line-type='context']").first(),
  }
}

/** 取某个元素的 ::before 内容（经典 +/- 指示符就是画在这里）。 */
const beforeContent = (locator: import("@playwright/test").Locator) =>
  locator.evaluate((element) => getComputedStyle(element, "::before").content)

/**
 * 取某个元素的实际渲染色（sRGB 通道）。
 *
 * 底色是 `color-mix(in lab, ...)` 算出来的，`getComputedStyle` 会原样返回
 * `lab(...)` 文本 —— 直接抠数字得到的是 L/a/b，不是红绿蓝。这里画一个像素再读回来，
 * 让浏览器自己把它转到 sRGB。
 */
const background = (locator: import("@playwright/test").Locator) =>
  locator.evaluate((element) => {
    const color = getComputedStyle(element).backgroundColor
    const canvas = document.createElement("canvas")
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext("2d")!
    ctx.fillStyle = color
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b] = Array.from(ctx.getImageData(0, 0, 1, 1).data)
    return { r: r ?? 0, g: g ?? 0, b: b ?? 0 }
  })

test("变更行首是绿色 + / 红色 -（经典指示符）", async ({ page }) => {
  const view = await open(page)
  expect(await beforeContent(view.addition)).toContain("+")
  expect(await beforeContent(view.deletion)).toContain("-")
})

test("红绿底色足够鲜明，且互不相同", async ({ page }) => {
  const view = await open(page)
  await expectVivid(view)
})

test.describe("深色主题", () => {
  test.use({ colorScheme: "dark" })

  test("深色下红绿底色仍然拉得开", async ({ page }) => {
    const view = await open(page)
    await expectVivid(view)
  })
})

async function expectVivid(view: {
  addition: import("@playwright/test").Locator
  deletion: import("@playwright/test").Locator
  context: import("@playwright/test").Locator
}) {
  const add = await background(view.addition)
  const del = await background(view.deletion)
  const base = await background(view.context)

  // 新增行偏绿：绿通道明显高于红通道。
  expect(add.g).toBeGreaterThan(add.r + 10)
  // 删除行偏红：红通道明显高于绿通道。
  expect(del.r).toBeGreaterThan(del.g + 10)
  // 与正文底色的差距要看得出来（不是"几乎和背景一样"）：单通道至少差 10。
  const distance = (a: typeof base, b: typeof base) =>
    Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b))
  expect(distance(add, base)).toBeGreaterThan(10)
  expect(distance(del, base)).toBeGreaterThan(10)
}

test("上下 / 左右两种排布都能渲染出变更行", async ({ page }) => {
  const view = await open(page)
  // 上下：新增行与删除行在同一个纵向流里。
  const unifiedCount = await page.locator("[data-line][data-line-type='change-addition']").count()
  expect(unifiedCount).toBeGreaterThan(0)

  await page.evaluate(() =>
    (window as never as { __diff: { setStyle: (v: "split") => void } }).__diff.setStyle("split"),
  )
  await expect(page.locator("#host")).toHaveAttribute("data-style", "split")
  await expect.poll(() => page.locator("[data-line][data-line-type='change-addition']").count()).toBeGreaterThan(0)
  expect(await beforeContent(view.addition)).toContain("+")
})
