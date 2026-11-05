import { expect, test, type Page } from "@playwright/test"
import { resolve } from "node:path"

test.use({ channel: "chrome", video: "off", trace: "off" })

/**
 * 发布前预检的端到端：真实规则引擎（`@novaway/core/publish-precheck`）
 * 跑在真实界面里 —— 只把"桌面端桥"换成假账号，规则本身没有任何 mock。
 *
 * 覆盖的是用户真正会遇到的路径：写了一句带极限词和微信引流的文案 → 点发布 →
 * 看到「哪句踩线 + 怎么改」→ 再点一次才真的发出去。
 */

function workspaceRootSlug() {
  return Buffer.from(resolve(process.cwd(), "..", ".."), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

const account = (id: string, platform: string, nickname: string) => ({
  id,
  platform,
  uid: id,
  account: nickname,
  nickname,
  avatar: "",
  cookies: "[]",
  token: "",
  loginTime: Date.now(),
  status: "valid",
  fansCount: 0,
  readCount: 0,
  likeCount: 0,
  collectCount: 0,
  forwardCount: 0,
  commentCount: 0,
  workCount: 0,
  income: 0,
  abnormalStatus: null,
  groupId: 0,
  lastStatsTime: null,
})

async function openPublishDialog(page: Page) {
  // 只替换桌面端桥（账号来源 / 文件选择 / 发布通道），预检逻辑走真实实现。
  await page.addInitScript(() => {
    const accounts = [
      {
        id: "acc-xhs",
        platform: "xhs",
        uid: "acc-xhs",
        account: "露营小分队",
        nickname: "露营小分队",
        avatar: "",
        cookies: "[]",
        token: "",
        loginTime: Date.now(),
        status: "valid",
        fansCount: 0,
        readCount: 0,
        likeCount: 0,
        collectCount: 0,
        forwardCount: 0,
        commentCount: 0,
        workCount: 0,
        income: 0,
        abnormalStatus: null,
        groupId: 0,
        lastStatsTime: null,
      },
    ]
    const published: unknown[] = []
    ;(window as any).__published = published
    ;(window as any).api = {
      ...(window as any).api,
      openFilePicker: async () => ["C:/media/cover.jpg"],
      platform: {
        getAccounts: async () => accounts,
        getGroups: async () => [],
        getSupportedPlatforms: async () => [],
        refreshProfiles: async () => ({ accounts }),
        batchCheckLogin: async () => [{ id: "acc-xhs", valid: true }],
        publishBatch: async (payload: unknown) => {
          published.push(payload)
          return { ok: true }
        },
        cancelPublish: async () => ({ ok: true }),
        getPublishBatches: async () => [],
        onPublishProgress: () => () => {},
        onPublishFinished: () => () => {},
        // 故意不提供 publishPrecheck：Web 版应当用本地同一份规则跑。
      },
    }
  })

  await page.goto(`/${workspaceRootSlug()}/session`)
  // 干净浏览器 → 英文界面，rail 读作 Operations。
  const entry = page.locator('[data-component="sidebar-rail-item"][aria-label="Operations"]').first()
  await expect(entry).toBeVisible({ timeout: 20_000 })
  await entry.click()

  const publish = page.locator('[data-slot="pulse-publish-entry"]')
  await expect(publish).toBeVisible({ timeout: 15_000 })
  await publish.click()

  const dialog = page.locator('[data-component="dialog"]')
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  return dialog
}

test("带极限词/微信引流/收益承诺的文案会被预检拦一次，确认后才发布", async ({ page }) => {
  const dialog = await openPublishDialog(page)

  // 图文发布需要素材：走假的文件选择器。
  await dialog.getByRole("button", { name: "选择文件" }).click()
  await expect(dialog.getByText("cover.jpg")).toBeVisible()

  await dialog.getByPlaceholder("输入标题（可选）").fill("全网最低价，效果最好")
  await dialog
    .getByPlaceholder("作品描述…")
    .fill("加微信 vx123 领券，这个方案稳赚不赔，用过的人都说好。")

  const submit = dialog.getByRole("button", { name: /发布到|确认风险并发布/ })
  await expect(submit).toHaveText("发布到 1 个账号")
  await submit.click()

  // 预检结果：三类问题都要点名，并给出改法。
  const panel = dialog.getByText(/发布前预检 · \d+ 条/)
  await expect(panel).toBeVisible()
  await expect(dialog.getByText(/极限词「最…」：最低/)).toBeVisible()
  await expect(dialog.getByText(/站外引流（微信）：加微信/)).toBeVisible()
  await expect(dialog.getByText(/收益承诺：稳赚/)).toBeVisible()
  await expect(dialog.getByText(/改法：/).first()).toBeVisible()

  // 第一次点击不应真的发布。
  await expect(submit).toHaveText("确认风险并发布")
  expect(await page.evaluate(() => (window as any).__published.length)).toBe(0)

  // 第二次点击才进入发布流程。
  await submit.click()
  await expect(dialog.getByText("正在发布…")).toBeVisible({ timeout: 10_000 })
  const published = await page.evaluate(() => (window as any).__published as Array<{ input: { title: string } }>)
  expect(published).toHaveLength(1)
  expect(published[0].input.title).toBe("全网最低价，效果最好")
})

test("改掉踩线词后重新预检，不再要求二次确认", async ({ page }) => {
  const dialog = await openPublishDialog(page)

  await dialog.getByRole("button", { name: "选择文件" }).click()
  const title = dialog.getByPlaceholder("输入标题（可选）")
  const body = dialog.getByPlaceholder("作品描述…")

  await title.fill("周末露营带了什么")
  await body.fill("这次带了帐篷、折叠椅和一壶冷萃，湖边坐了一下午。")
  await dialog.getByRole("button", { name: /发布到|确认风险并发布/ }).click()

  // 没有警告就不弹预检面板，直接进发布。
  await expect(dialog.getByText("正在发布…")).toBeVisible({ timeout: 10_000 })
  await expect(dialog.getByText(/发布前预检 ·/)).toHaveCount(0)
})
