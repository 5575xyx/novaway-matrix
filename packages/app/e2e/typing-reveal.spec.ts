import { expect, test, type Page } from "@playwright/test"

// 本机没有下载 Playwright 自带的 Chromium 时用系统 Chrome；
// 装了自带浏览器也不影响（channel 会优先用它找到的那一个）。
// 本机没装 ffmpeg（Playwright 的录制依赖），这里关掉录像/追踪。
test.use({ channel: "chrome", video: "off", trace: "off" })

const FIXTURE = "/e2e/fixtures/typing-reveal.html"

type Hooks = {
  setText: (value: string) => void
  setLive: (value: boolean) => void
  setScope: (value: string) => void
  shown: () => string
}

const lines = (count: number, prefix = "// line") =>
  Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}`).join("\n")

/** 文件已经完整显示时的基础内容（打开面板那一刻的样子）。 */
const base = lines(40)

/** 这一笔 AI 新写的内容：改写最后一行 + 追加 12 行（足够看出逐字效果）。 */
const written = `${lines(39)}\n// line 40 changed by ai\n${lines(12, "// new line")
  .split("\n")
  .map((line) => line)
  .join("\n")}`

async function setup(page: Page) {
  await page.goto(FIXTURE)
  await page.waitForFunction(() => typeof (window as never as { __typing?: Hooks }).__typing === "object")
  const shown = () => page.locator("#shown").innerText()
  const set = (value: string) =>
    page.evaluate((v) => (window as never as { __typing: Hooks }).__typing.setText(v), value)
  const live = (value: boolean) =>
    page.evaluate((v) => (window as never as { __typing: Hooks }).__typing.setLive(v), value)
  const scope = (value: string) =>
    page.evaluate((v) => (window as never as { __typing: Hooks }).__typing.setScope(v), value)
  return { shown, set, live, scope }
}

test("不在跟写窗口时直出全文（用户自己打开/保存不慢放）", async ({ page }) => {
  const { shown, set, live } = await setup(page)
  await live(false)
  await set(base)
  await expect.poll(shown).toBe(base)
})

test("跟写时只打新增行，未改动的行立刻完整显示", async ({ page }) => {
  const { shown, set, live } = await setup(page)

  // 先有基础内容（打开面板那一刻），再进入跟写窗口。
  await live(false)
  await set(base)
  await expect.poll(shown).toBe(base)
  await live(true)

  await set(written)
  // 第一拍：未改动的 39 行已经在，新写的部分还没开始（尾部为空行占位）。
  const first = await shown()
  expect(first.split("\n").slice(0, 39)).toEqual(base.split("\n").slice(0, 39))
  expect(first).not.toBe(written)

  // 逐字长出来，最终追平。
  await expect.poll(shown, { timeout: 5000 }).toBe(written)
})

test("打字过程中前缀行永远不消失，长度单调增长（不闪）", async ({ page }) => {
  const { shown, set, live } = await setup(page)
  await live(false)
  await set(base)
  await expect.poll(shown).toBe(base)
  await live(true)
  await set(written)

  const head = base.split("\n").slice(0, 39).join("\n")
  let previous = 0
  for (let i = 0; i < 40; i++) {
    const value = await shown()
    // 未改动的行全程完整：不会出现"整块缩回去再长出来"。
    expect(value.startsWith(head)).toBe(true)
    expect(value.length).toBeGreaterThanOrEqual(previous)
    previous = value.length
    if (value === written) break
    await page.waitForTimeout(30)
  }
  await expect.poll(shown, { timeout: 5000 }).toBe(written)
})

test("内容没变时不重启动画（重复写盘不闪）", async ({ page }) => {
  const { shown, set, live } = await setup(page)
  await live(false)
  await set(base)
  await expect.poll(shown).toBe(base)
  await live(true)
  await set(written)
  await expect.poll(shown, { timeout: 5000 }).toBe(written)

  // 同一份内容再来一次（watcher 重复事件）：不应该缩回去。
  await set(written)
  const samples: string[] = []
  for (let i = 0; i < 5; i++) {
    samples.push(await shown())
    await page.waitForTimeout(40)
  }
  for (const sample of samples) expect(sample).toBe(written)
})

test("切换文件后重置基准，不拿上一个文件的内容作差", async ({ page }) => {
  const { shown, set, live, scope } = await setup(page)
  await live(false)
  await set(base)
  await expect.poll(shown).toBe(base)
  await live(true)

  const other = lines(10, "// other")
  await scope("b")
  await set(other)
  await expect.poll(shown, { timeout: 2000 }).toBe(other)
})
