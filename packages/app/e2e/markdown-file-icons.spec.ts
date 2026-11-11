import { expect, test } from "@playwright/test"

test.use({ channel: "chrome", video: "off", trace: "off" })

// 聊天正文的文件引用要有"一眼看出是什么"的图标：
// 文件链接前面挂类型图标，目录 chip 前面挂文件夹图标但不可点，不像路径的行内 code 不加。
test.describe("正文文件 / 目录图标", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/e2e/fixtures/markdown-file-icons.html")
    await expect(page.locator('[data-e2e="markdown-root"] table')).toBeVisible()
  })

  test("文件链接前面是类型图标，且图标跟着扩展名变", async ({ page }) => {
    const pptx = page.locator('code[data-file-path="product_promo_20261101_134706.pptx"]')
    await expect(pptx.locator('svg[data-component="file-icon"]')).toHaveCount(1)
    await expect(pptx.locator("svg use")).toHaveAttribute("href", /#Powerpoint$/)
    await expect(pptx.locator('svg[data-component="file-icon"]')).toHaveAttribute("data-kind", "file")
    await expect(pptx.locator("svg rect")).toHaveAttribute("fill", "currentColor")
    await expect(pptx.locator("svg rect")).toHaveAttribute("mask", /^url\(#markdown-file-icon-/)
    const maskID = await pptx.locator("svg mask").getAttribute("id")
    await expect(pptx.locator("svg use")).toHaveAttribute("href", /#Powerpoint$/)
    expect(maskID).toBeTruthy()

    await expect(page.locator('code[data-file-path="design_spec.md"] use')).toHaveAttribute("href", /#Markdown$/)
    await expect(page.locator('code[data-file-path="workflow.log"] use')).toHaveAttribute("href", /#Log$/)
    const maskIDs = await page
      .locator("code[data-file-path] svg mask")
      .evaluateAll((masks) => masks.map((mask) => mask.id))
    expect(new Set(maskIDs).size).toBe(maskIDs.length)
  })

  test("图标和路径在同一行，不吃掉点击", async ({ page }) => {
    const pptx = page.locator('code[data-file-path="product_promo_20261101_134706.pptx"]')
    // 图标必须贴在文字左边同一行：只量 code 的盒子会被换行的图标撑高，
    // 所以直接拿文本节点的矩形来比 y 轴（踩过：Tailwind preflight 把 svg 设成 block）。
    const boxes = await pptx.evaluate((el) => {
      const svg = el.querySelector("svg")
      if (!svg) throw new Error("文件链接前面没有图标")
      const text = Array.from(el.childNodes).find((node) => node.nodeType === Node.TEXT_NODE)
      const range = document.createRange()
      if (text) range.selectNode(text)
      const label = range.getBoundingClientRect()
      return { svg: svg.getBoundingClientRect(), label }
    })
    expect(boxes.svg.x, "图标应在文字左侧").toBeLessThan(boxes.label.x)
    expect(boxes.svg.y, "图标应与文字同行").toBeGreaterThanOrEqual(boxes.label.y - 4)
    expect(boxes.svg.bottom, "图标应与文字同行").toBeLessThanOrEqual(boxes.label.bottom + 4)

    // 点在图标上也要能打开：CSS 给图标 pointer-events: none，事件落回 code。
    await pptx.locator("svg").click({ force: true })
    await expect(page.locator('[data-e2e="clicked"]')).toHaveText("product_promo_20261101_134706.pptx")
  })

  test("目录有文件夹图标，但不可点", async ({ page }) => {
    const docs = page.locator("code", { hasText: "docs/" }).first()
    await expect(docs.locator('svg[data-component="file-icon"]')).toHaveAttribute("data-kind", "directory")
    await expect(docs.locator("svg use")).toHaveAttribute("href", /#FolderDocs$/)
    await expect(docs).not.toHaveAttribute("data-file-open", "")

    const output = page.locator("code", { hasText: "svg_output/" }).first()
    await expect(output.locator("svg use")).toHaveAttribute("href", /#Folder$/)
    await expect(output).not.toHaveAttribute("data-file-open", "")
  })

  test("不像路径的行内 code 不加图标", async ({ page }) => {
    const plain = page.locator("code", { hasText: "inline_path" }).first()
    await expect(plain).toBeVisible()
    await expect(plain.locator("svg")).toHaveCount(0)
    await expect(plain).not.toHaveAttribute("data-file-open", "")
  })
})
