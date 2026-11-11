import { expect, test, type Locator, type Page } from "@playwright/test"
import { resolve } from "node:path"

/**
 * 右栏分屏 + 标签右键菜单（split view / Open to the Right）。
 *
 * 这里跑真实应用（不是夹具）：这三件事只有在真实上下文里才成立 ——
 *   1. 标签右键菜单能打开并命中 `layout.sidePane.openSecondary`；
 *   2. 两窗格按 ratio 分配宽度，拖分割线改比例、双击收成分屏；
 *   3. ⌘⌥→ / ⌘⌥W 这两个快捷键走的是命令系统（keybind 分发），不是手写监听。
 *
 * 环境约定与 layout.spec 一致：仓库根目录的 slug + 干净浏览器（locale 回退 en）。
 * 只用已有文件，不发消息、不建会话，跑完只剩本地 localStorage 里的标签状态。
 */
test.use({ channel: "chrome", video: "off", trace: "off" })

function workspaceRootSlug() {
  const workspaceRoot = resolve(process.cwd(), "..", "..")
  return Buffer.from(workspaceRoot, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

const FILE_A = "README.md"
const FILE_B = "AGENTS.md"

// 顶层标签条：side-pane-body + h-9（内容区那块 side-pane-body 是 flex-1，没有 h-9）。
const tabStrip = (page: Page): Locator =>
  page.locator('[data-component="side-pane-frame"] div.side-pane-body.h-9').first()

async function openSession(page: Page): Promise<Locator> {
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.goto(`/${workspaceRootSlug()}/session`)
  const frame = page.locator('[data-component="side-pane-frame"]')
  await expect(frame).toHaveAttribute("data-open", "true", { timeout: 20_000 })
  return frame
}

/**
 * 用右栏「+」菜单里的「文件」进入内置选文件弹窗（web 构建没有原生通道 → in-app dialog），
 * 搜名字并选中。dialog 的 open() 选完文件会自己 add("preview") 把宿主激活
 * （与拖拽/系统/原生选择器的 openPaths 一致），因此这里不需要再点一次标签，
 * 内容区应直接落到该文件 —— 下方各用例里的 `expect(panes).toHaveCount(1)` 就是这个回归断言。
 */
async function openFile(page: Page, name: string) {
  await page
    .getByRole("button", { name: /Add panel tab|新增面板标签/ })
    .first()
    .click()
  await page
    .getByRole("menuitem", { name: /^(Files|文件)$/ })
    .first()
    .click()

  const input = page.getByPlaceholder(/Search files|搜索文件/).first()
  await expect(input).toBeVisible({ timeout: 10_000 })
  await input.fill(name)

  // 列表项是 <button data-slot="list-item">；按文件名命中再点。
  const row = page.locator('[data-component="list"] button[data-slot="list-item"]').filter({ hasText: name })
  await expect(row.first()).toBeVisible({ timeout: 10_000 })
  await row.first().click()
  await expect(input).toBeHidden({ timeout: 10_000 })

  // 选完即激活 preview 宿主：内容区出现唯一窗格，且该文件标签可见。
  await expect(panes(page)).toHaveCount(1)
  await expect(tabButton(page, name)).toBeVisible()
}

// 文件标签按钮：缩到标签条即可唯一命中（预览头部的文件名不是 button）。
// 转义文件名里的正则元字符（"." 等），避免把它当通配。
const tabButton = (page: Page, name: string) =>
  tabStrip(page).getByRole("button", { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) })

const panes = (page: Page) => page.locator('[data-component="side-pane-frame"] .side-pane-content')
const divider = (page: Page) =>
  page.locator('[data-component="side-pane-frame"] [data-component="side-pane-split-divider"]')

/** 主窗格与次窗格的宽度（次窗格始终是两个 .side-pane-content 里靠右/靠下的那个）。 */
async function paneWidths(page: Page) {
  const [first, second] = [await panes(page).nth(0).boundingBox(), await panes(page).nth(1).boundingBox()]
  return { primary: first?.width ?? 0, secondary: second?.width ?? 0 }
}

test.describe("右栏分屏", () => {
  test("标签右键「在右侧打开」拆出两栏，拖分割线改比例，双击收单栏", async ({ page }) => {
    const frame = await openSession(page)
    await openFile(page, FILE_A)
    await openFile(page, FILE_B)
    await expect(tabButton(page, FILE_A)).toBeVisible()
    await expect(tabButton(page, FILE_B)).toBeVisible()

    // 主窗格此时停在最后打开的 FILE_B；把 FILE_A 拆到右栏。
    await expect(panes(page)).toHaveCount(1)
    await tabButton(page, FILE_A).click({ button: "right" })
    await page.getByRole("menuitem", { name: /Open to the Right|在右侧打开/ }).click()

    await expect(panes(page)).toHaveCount(2)
    await expect(divider(page)).toBeVisible()
    const before = await paneWidths(page)
    // 初始比例 0.5：两栏宽度接近（分割线 5px 之外不应有肉眼可见的偏心）。
    expect(Math.abs(before.primary - before.secondary)).toBeLessThan(before.primary * 0.12)

    // 把分割线往左拖 120px = 次窗格变大 120px。
    const box = await divider(page).boundingBox()
    expect(box).not.toBeNull()
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await page.mouse.down()
    await page.mouse.move(box!.x + box!.width / 2 - 120, box!.y + box!.height / 2, { steps: 8 })
    await page.mouse.up()
    const after = await paneWidths(page)
    expect(after.secondary - before.secondary).toBeCloseTo(120, -3)

    // 双击分割线收回单栏。
    await divider(page).dblclick()
    await expect(panes(page)).toHaveCount(1)
    await expect(divider(page)).toHaveCount(0)
    await expect(frame).toBeVisible()
  })

  test("⌘⌥→ 拆当前标签，⌘⌥W 收分屏（命令快捷键）", async ({ page }) => {
    await openSession(page)
    await openFile(page, FILE_A)
    await expect(panes(page)).toHaveCount(1)

    // 焦点放回聊天区，避免按键被输入框吃掉。
    await page.locator('[data-component="conv-frame"]').click({ position: { x: 4, y: 4 } })
    await page.keyboard.press("Control+Alt+ArrowRight")
    await expect(panes(page)).toHaveCount(2)

    await page.keyboard.press("Control+Alt+w")
    await expect(panes(page)).toHaveCount(1)
  })

  test("右键「在下方打开」是上下排列，「关闭其他标签」只留当前文件", async ({ page }) => {
    await openSession(page)
    await openFile(page, FILE_A)
    await openFile(page, FILE_B)

    await tabButton(page, FILE_A).click({ button: "right" })
    await page.getByRole("menuitem", { name: /Open Below|在下方打开/ }).click()
    await expect(panes(page)).toHaveCount(2)

    const [top, bottom] = [await panes(page).nth(0).boundingBox(), await panes(page).nth(1).boundingBox()]
    expect(top && bottom ? bottom.y >= top.y + top.height - 1 : false).toBe(true)
    expect(top && bottom ? Math.abs(top.width - bottom.width) : 999).toBeLessThan(2)

    // 关掉分屏后清空多余标签：右键 FILE_A「关闭其他标签」，只剩 FILE_A。
    await divider(page).dblclick()
    await tabButton(page, FILE_A).click({ button: "right" })
    await page.getByRole("menuitem", { name: /Close Other Tabs|关闭其他标签/ }).click()
    await expect(tabButton(page, FILE_A)).toBeVisible()
    await expect(tabButton(page, FILE_B)).toHaveCount(0)
  })
})
