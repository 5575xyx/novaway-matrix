/**
 * 一站式发布执行器：一次输入 → 多个账号（可跨平台）。
 *
 * 串行执行而不是并发：每个账号都要开一个隐藏窗口上传文件，并发开一堆
 * 既吃内存又更容易触发风控。串行还让进度条看起来是"一个个完成"，
 * 用户能清楚看到卡在哪个平台上。
 */
import type { PublishAccountResult, PublishBatch, PublishInput, PublishProgressEvent, PublishStatus } from "./types"
import { getDriver } from "./drivers"
import { findOpenSurface } from "./surface"
import {
  clickByText,
  fillEditor,
  hasText,
  navigate,
  openPublishWindow,
  readWechatToken,
  setFileInput,
  waitForAnySelector,
  waitUntil,
  type PublishSurface,
} from "./automation"

export interface PublishAccount {
  id: string
  platform: string
  nickname: string
  cookies: string
}

export type ProgressSink = (event: PublishProgressEvent) => void

const UPLOAD_TIMEOUT_MS = 10 * 60 * 1000
const SUBMIT_TIMEOUT_MS = 60 * 1000
const SUCCESS_TIMEOUT_MS = 60 * 1000

function parseCookies(value: string): any[] {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function result(
  account: PublishAccount,
  status: PublishStatus,
  progress: number,
  message: string,
  extra: { url?: string; error?: string } = {},
): PublishAccountResult {
  return {
    accountId: account.id,
    platform: account.platform,
    nickname: account.nickname,
    status,
    progress,
    message,
    url: extra.url,
    error: extra.error,
    updatedAt: Date.now(),
  }
}

/**
 * 发布单个账号。任何一步失败都返回 `failed` 结果，不抛给批次循环 ——
 * 「发到 5 个平台，4 个成功 1 个失败」是常态，批次不该被一个平台打断。
 */
export async function publishToAccount(
  account: PublishAccount,
  input: PublishInput,
  report: (result: PublishAccountResult) => void,
  signal: AbortSignal,
): Promise<PublishAccountResult> {
  const driver = getDriver(account.platform)
  const step = (status: PublishStatus, progress: number, message: string, extra: { url?: string; error?: string } = {}) => {
    const next = result(account, status, progress, message, extra)
    report(next)
    return next
  }

  if (!driver) return step("unsupported", 0, "该平台暂不支持自动发布")
  if (!driver.supports.includes(input.kind)) {
    const kindName = input.kind === "video" ? "视频" : input.kind === "image_text" ? "图文" : "文章"
    return step("unsupported", 0, `${driver.name}不支持${kindName}发布`)
  }

  // 公众号这类编辑页要 token，只认已登录会话里的地址栏；没有 token 时
  // 先落到平台的首页/入口页，让它自己把 token 带出来。
  const url = driver.url[input.kind]
  if (!url) return step("unsupported", 0, `${driver.name}暂不支持该内容形式`)

  if (signal.aborted) return step("cancelled", 0, "已取消")

  // 优先复用运营工作台里已经打开、用户看得见的页面；没有才开隐藏窗口。
  const reused = findOpenSurface(account.platform)
  let handle: PublishSurface | undefined = reused
  try {
    if (handle) {
      step("running", 5, "复用运营工作台里已打开的页面…")
      // 页面可能是别的子路径（比如首页），下面的导航会把它带到发布页。
    } else {
      const cookies = parseCookies(account.cookies)
      if (cookies.length === 0) return step("failed", 0, "登录信息缺失，请重新登录", { error: "no-cookies" })
      step("running", 5, "打开发布页…")
      handle = await openPublishWindow(cookies, url)
    }
    const win = handle
    if (signal.aborted) return step("cancelled", 5, "已取消")

    // 0) 落到入口页 → 取 token → 进真正的编辑页
    if (driver.editorUrl) {
      step("running", 8, "定位编辑页…")
      await navigate(win, url)
      let token = await readWechatToken(win)
      if (!token) {
        // 有些入口要再跳一次才带上 token，等页面安定后再读一次。
        await waitUntil(win, async () => Boolean(await readWechatToken(win)), 10_000, 500)
        token = await readWechatToken(win)
      }
      if (!token) {
        return step("failed", 8, "没拿到登录 token，请先在这个账号的页面里完成登录", { error: "no-token" })
      }
      await navigate(win, driver.editorUrl(token))
    }

    // 1) 选文件（视频/图文都需要）
    if (input.filePaths.length > 0 && driver.fileInput?.length) {
      const ready = await waitForAnySelector(win, driver.fileInput, 30_000)
      if (!ready) return step("failed", 15, "发布页没有出现上传入口（可能未登录或页面改版）")
      if (signal.aborted) return step("cancelled", 15, "已取消")
      step("running", 20, "上传中…")
      await setFileInput(win, driver.fileInput, input.filePaths)
    }

    // 2) 等上传完成：平台在传完后会把按钮变成可点/出现"重新上传"文案。
    // 没有文件（文章类）就没有上传可等 —— 以前这里会白等 10 分钟才报超时。
    if (input.filePaths.length > 0) {
      const uploaded = await waitUntil(
        win,
        async () => {
          const done = await hasText(win, driver.readyText)
          if (done) return true
          // 没有可用文案时退化成"提交按钮出现且可点"
          return win.webContents
            .executeJavaScript(
              `(() => {
                const patterns = ${JSON.stringify(driver.submitText ?? [])}.map((p) => new RegExp(p, "i"));
                const nodes = Array.from(document.querySelectorAll('button, [role="button"]'));
                return nodes.some((node) => {
                  const text = (node.textContent || "").trim();
                  if (!patterns.some((re) => re.test(text))) return false;
                  return !(node.disabled || node.getAttribute("aria-disabled") === "true");
                });
              })()`,
              true,
            )
            .catch(() => false)
        },
        UPLOAD_TIMEOUT_MS,
        1000,
      )
      if (signal.aborted) return step("cancelled", 55, "已取消")
      if (!uploaded) return step("failed", 55, "等待上传完成超时", { error: "upload-timeout" })
    }

    // 3) 填标题与正文
    // 标题用 fillEditor：它同时会处理 input / textarea / contenteditable，
    // 公众号的 `#activity-name` 在不同版本里就是这三种之一。
    step("running", 65, "填写内容…")
    await fillEditor(win, driver.titleInput, input.title)
    const description = [input.description, ...(input.tags ?? []).map((tag) => `#${tag}`)]
      .filter(Boolean)
      .join("\n")
    await fillEditor(win, driver.descriptionEditor, description)

    // 4) 提交
    step("running", 80, "提交发布…")
    const clicked = await waitUntil(win, () => clickByText(win, driver.submitText), SUBMIT_TIMEOUT_MS, 1500)
    if (!clicked) return step("failed", 80, "找不到发布按钮（平台可能改版）", { error: "submit-not-found" })

    // 5) 确认结果
    const ok = await waitUntil(win, () => hasText(win, driver.successText), SUCCESS_TIMEOUT_MS, 1200)
    if (!ok) return step("failed", 90, "点击发布后未确认到成功提示", { error: "unconfirmed" })

    return step("success", 100, driver.successMessage ?? "发布成功")
  } catch (error) {
    return step("failed", 0, error instanceof Error ? error.message : String(error), {
      error: error instanceof Error ? error.message : String(error),
    })
  } finally {
    // 复用的是用户的页面：跑完关掉会直接把人在看的东西弄没，所以只有临时窗口才清理。
    if (handle?.origin === "hidden") await handle.close()
  }
}

/** 批量发布：逐个账号执行，边跑边发进度。 */
export async function runPublishBatch(
  accounts: PublishAccount[],
  input: PublishInput,
  report: ProgressSink,
  signal: AbortSignal,
): Promise<PublishBatch> {
  const batch: PublishBatch = {
    id: `pub_${Date.now()}`,
    input,
    results: accounts.map((account) => result(account, "pending", 0, "排队中")),
    startedAt: Date.now(),
  }
  for (const account of accounts) {
    if (signal.aborted) break
    const index = batch.results.findIndex((item) => item.accountId === account.id)
    batch.results[index] = result(account, "running", 0, "准备中")
    report({ batchId: batch.id, result: batch.results[index] })

    const final = await publishToAccount(
      account,
      input,
      (progress) => {
        batch.results[index] = progress
        report({ batchId: batch.id, result: progress })
      },
      signal,
    )
    batch.results[index] = final
    report({ batchId: batch.id, result: final })
  }
  if (signal.aborted) {
    for (let i = 0; i < batch.results.length; i++) {
      const item = batch.results[i]
      if (item.status === "pending" || item.status === "running") {
        batch.results[i] = { ...item, status: "cancelled", message: "已取消", updatedAt: Date.now() }
        report({ batchId: batch.id, result: batch.results[i] })
      }
    }
  }
  batch.finishedAt = Date.now()
  return batch
}
