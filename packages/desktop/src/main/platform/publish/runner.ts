/**
 * 一站式发布执行器：一次输入 → 多个账号（可跨平台）。
 *
 * 串行执行而不是并发：每个账号都要开一个隐藏窗口上传文件，并发开一堆
 * 既吃内存又更容易触发风控。串行还让进度条看起来是"一个个完成"，
 * 用户能清楚看到卡在哪个平台上。
 */
import type { PublishAccountResult, PublishBatch, PublishInput, PublishProgressEvent, PublishStatus } from "./types"
import { getDriver, type PublishDriver } from "./drivers"
import { precheckPublish } from "./precheck"
import { findOpenSurface } from "./surface"
import {
  attrOf,
  clickAt,
  clickBySelector,
  clickByText,
  contentsOf,
  createWechatDraft,
  fillVerified,
  hasSelector,
  hasText,
  navigate,
  openPublishWindow,
  pageText,
  readWechatToken,
  rectOf,
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

/** 大文件 + 弱网：2GB @ 700KB/s 就要 50 分钟，再留转码时间。 */
const UPLOAD_TIMEOUT_MS = 60 * 60 * 1000
const SUBMIT_TIMEOUT_MS = 60 * 1000
const SUCCESS_TIMEOUT_MS = 90 * 1000

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
  extra: { url?: string; error?: string; warnings?: string[] } = {},
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
    warnings: extra.warnings && extra.warnings.length > 0 ? extra.warnings : undefined,
    updatedAt: Date.now(),
  }
}

function kindName(kind: PublishInput["kind"]) {
  return kind === "video" ? "视频" : kind === "image_text" ? "图文" : "文章"
}

/** 纯文本 → 段落 HTML（公众号草稿接口吃 HTML，裸文本会挤成一坨）。 */
export function textToHtml(text: string): string {
  const escape = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
  return text
    .split("\n")
    .map((line) => `<p>${escape(line) || "<br>"}</p>`)
    .join("")
}

/** 描述正文：正文 + 话题标签（各平台都用 `#tag` 的形式）。 */
function buildDescription(input: PublishInput): string {
  return [input.description, ...(input.tags ?? []).map((tag) => `#${tag}`)].filter(Boolean).join("\n")
}

/** 提交按钮此刻能不能点。 */
async function canSubmit(win: PublishSurface, driver: PublishDriver): Promise<boolean> {
  if (driver.submitClick) {
    const wait = driver.submitClick.waitAttr
    if (!wait) return true
    return (await attrOf(win, driver.submitClick.host, wait.name)) === wait.value
  }
  if (driver.submitSelector?.length) return hasSelector(win, driver.submitSelector)
  if (!driver.submitText?.length) return false
  const script = `(() => {
    const patterns = ${JSON.stringify(driver.submitText)}.map((p) => new RegExp(p, "i"));
    const nodes = Array.from(document.querySelectorAll('button, [role="button"], div[class*="button"]'));
    return nodes.some((node) => {
      const text = (node.textContent || "").trim();
      if (!patterns.some((re) => re.test(text))) return false;
      return !(node.disabled || node.getAttribute("aria-disabled") === "true");
    });
  })()`
  return Boolean(await contentsOf(win).executeJavaScript(script, true))
}

/**
 * 等上传完成。
 *
 * 抖音的「上传成功」一闪而过、「重新上传」在传输过程中也会出现，单看任一个都会
 * 误判；正确判据是「取消上传」消失 **且** 出现「重新上传/上传成功」。
 * 没有这类文案的平台退化成"提交按钮可点"。
 */
async function waitUploadDone(
  win: PublishSurface,
  driver: PublishDriver,
  signal: AbortSignal,
): Promise<"ready" | "cancelled" | "timeout"> {
  const done = await waitUntil(
    win,
    async () => {
      if (signal.aborted) return "cancelled"
      if (driver.uploadingText?.length && (await hasText(win, driver.uploadingText))) return false
      if (driver.uploadedText?.length && (await hasText(win, driver.uploadedText))) return true
      if (await hasText(win, driver.readyText)) return true
      // 文案还没出现不代表没传完：继续等按钮可点作为兜底。
      return (await canSubmit(win, driver)) ? true : false
    },
    UPLOAD_TIMEOUT_MS,
    1500,
  )
  return done === "cancelled" ? "cancelled" : done ? "ready" : "timeout"
}

/** 点一次提交按钮，返回是否真的点到了。 */
async function submitOnce(win: PublishSurface, driver: PublishDriver): Promise<string | undefined> {
  if (driver.submitClick) {
    const { host, waitAttr, xRatio = 0.8, yOffset = 26 } = driver.submitClick
    if (waitAttr) {
      await waitUntil(win, async () => (await attrOf(win, host, waitAttr.name)) === waitAttr.value, 10_000, 500)
    }
    const box = await rectOf(win, host)
    if (!box) return undefined
    // 按钮在 closed shadow root 里，只能按坐标点；取宿主右半边（发布在右、暂存在左）。
    const x = box.x + box.width * xRatio
    const y = box.y + Math.min(yOffset, box.height > 0 ? box.height * 0.5 : yOffset)
    await clickAt(win, x, y)
    return `coordinate:${host}`
  }
  if (driver.submitSelector?.length) {
    // 快手这类平台在上传没完时点发布会弹「请等待上传完成」，所以交给外面轮询重试。
    const clicked = await clickBySelector(win, driver.submitSelector)
    if (clicked && (await canSubmit(win, driver))) return clicked
  }
  return clickByText(win, driver.submitText)
}

/** 是否已经完成：跳转到成功页，或页面上出现了成功文案。 */
async function confirmDone(win: PublishSurface, driver: PublishDriver): Promise<boolean> {
  if (driver.successUrl && contentsOf(win).getURL().includes(driver.successUrl)) return true
  return hasText(win, driver.successText)
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
  // 预检结论要跟着这条账号的每个进度事件走：界面上"哪句踩线"比"失败了"有用得多。
  const warnings: string[] = []
  const step = (status: PublishStatus, progress: number, message: string, extra: { url?: string; error?: string } = {}) => {
    const next = result(account, status, progress, message, { ...extra, warnings })
    report(next)
    return next
  }

  if (!driver) return step("unsupported", 0, "该平台暂不支持自动发布")
  if (!driver.supports.includes(input.kind)) {
    return step("unsupported", 0, `${driver.name}不支持${kindName(input.kind)}发布`)
  }

  // 预检：硬错误（没有素材、公众号空标题）在这里就挡住，别开窗口白跑一趟；
  // 警告（极限词、微信引流）只随结果带给用户，最终发不发由他决定。
  const check = precheckPublish(input, [account.platform])
  const blockers = check.issues.filter((issue) => issue.level === "error")
  if (blockers.length > 0) {
    return step("failed", 0, `预检未通过：${blockers[0].message}`, { error: `precheck:${blockers[0].rule}` })
  }
  warnings.push(...check.issues.filter((issue) => issue.level === "warning").map((issue) => issue.message))

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

    // 0) 公众号：直接调后台的「保存为草稿」接口，不碰编辑器 DOM。
    //
    // 编辑器版本、iframe 布局、按钮文案都会变，但这个 cgi-bin 接口是后台自己
    // 在用的，稳定得多；而且不会误触「群发」（不可撤销 + 有次数限制）。
    if (driver.draftApi === "wechat") {
      step("running", 10, "准备公众号后台…")
      if (!(await readWechatToken(win))) {
        await navigate(win, url)
        await waitUntil(win, async () => Boolean(await readWechatToken(win)), 15_000, 800)
      }
      step("running", 45, "生成草稿…")
      const draft = await createWechatDraft(win, {
        title: input.title,
        html: textToHtml(buildDescription(input)),
      })
      return step("success", 100, driver.successMessage ?? "已保存为草稿", { url: draft.draftUrl })
    }

    // 1) 取 token → 进真正的编辑页
    //
    // 顺序是"先读、读不到才跳"：用户可能正开着某个页面（甚至正在写草稿），
    // 一上来就 loadURL 首页会把他眼前的页面冲掉。
    if (driver.editorUrl) {
      step("running", 8, "定位编辑页…")
      let token = await readWechatToken(win)
      if (!token) {
        await navigate(win, url)
        token = await readWechatToken(win)
        if (!token) {
          // 有些入口要再跳一次才带上 token，等页面安定后再读一次。
          await waitUntil(win, async () => Boolean(await readWechatToken(win)), 10_000, 500)
          token = await readWechatToken(win)
        }
      }
      if (!token) {
        return step("failed", 8, "没拿到登录 token，请先在这个账号的页面里完成登录", { error: "no-token" })
      }
      // 已经停在编辑页就别再开一个空编辑器 —— 那会丢掉用户没保存的草稿。
      const alreadyEditing = /cgi-bin\/appmsg/.test(contentsOf(win).getURL())
      if (!alreadyEditing) await navigate(win, driver.editorUrl(token))
    }

    // 2) 选文件（视频/图文都需要）
    if (input.filePaths.length > 0 && driver.fileInput?.length) {
      const ready = await waitForAnySelector(win, driver.fileInput, 30_000)
      if (!ready) {
        return step("failed", 15, "发布页没有出现上传入口（可能未登录或页面改版）", { error: "no-upload-input" })
      }
      if (signal.aborted) return step("cancelled", 15, "已取消")
      step("running", 20, "上传中…")
      await setFileInput(win, driver.fileInput, input.filePaths)
    }

    // 3) 等上传完成：没有文件（文章类）就没有上传可等。
    if (input.filePaths.length > 0) {
      const state = await waitUploadDone(win, driver, signal)
      if (state === "cancelled") return step("cancelled", 55, "已取消")
      if (state === "timeout") return step("failed", 55, "等待上传完成超时", { error: "upload-timeout" })
      step("running", 58, "上传完成")
    }

    if (signal.aborted) return step("cancelled", 58, "已取消")

    // 4) 填标题 / 正文：写进去再读回来核对。
    //
    // 富文本组件会"界面看着有字、提交时是空的"（它只认用户输入），
    // 所以这里不是填完就算，而是回读比对；不一致会整段重写一次再判失败。
    if (input.title && driver.titleInput?.length) {
      step("running", 65, "填写标题…")
      const filled = await fillVerified(win, driver.titleInput, input.title)
      if (!filled.ok) {
        return step("failed", 65, "标题没能写进发布页（编辑器拒绝了程序化输入）", {
          error: `title-not-written:${filled.read.slice(0, 40)}`,
        })
      }
    }

    const description = buildDescription(input)
    if (description && driver.descriptionEditor?.length) {
      step("running", 72, "填写正文…")
      const filled = await fillVerified(win, driver.descriptionEditor, description)
      if (!filled.ok) {
        return step("failed", 72, "正文没能写进编辑器（富文本组件拒绝了程序化输入）", {
          error: `body-not-written:${filled.read.slice(0, 40)}`,
        })
      }
    }

    if (signal.aborted) return step("cancelled", 75, "已取消")

    // 5) 提交
    step("running", 82, "提交发布…")
    const clicked = await waitUntil(win, () => submitOnce(win, driver), SUBMIT_TIMEOUT_MS, 1500)
    if (!clicked) {
      const text = await pageText(win, 120)
      return step("failed", 82, "找不到可点的发布按钮（平台可能改版）", { error: `submit-not-found:${text}` })
    }

    // 6) 确认结果
    step("running", 92, "等待平台确认…")
    const ok = await waitUntil(win, () => confirmDone(win, driver), SUCCESS_TIMEOUT_MS, 1200)
    if (!ok) {
      const text = await pageText(win, 120)
      return step("failed", 92, "点击发布后未确认到成功提示，请到后台确认是否已发出", {
        error: `unconfirmed:${text}`,
      })
    }

    return step("success", 100, driver.successMessage ?? "发布成功", { url: contentsOf(win).getURL() })
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
