/**
 * 用一个「不可见的登录态窗口」读取账号资料。
 *
 * 检查登录状态时我们只有 cookie，没有页面。直接打接口在某些平台会被风控
 * （见 request.ts 的说明），而页面本身永远是可信的：把 cookie 灌进一个隐藏窗口，
 * 打开创作者后台，等首屏渲染完再从 DOM/首屏 state 里读昵称和头像。
 *
 * 代价是一次页面加载（几百毫秒到几秒），只在「资料缺失」或用户手动巡检时走。
 */
import { BrowserWindow, session } from "electron"
import type { Cookie } from "electron"
import { PLATFORM_USER_AGENT } from "./request"
import { capturePageProfile, type CaptureHints, type PageProfile } from "./profile-capture"

const LOAD_TIMEOUT_MS = 20_000
const RENDER_SETTLE_MS = 1_500

export interface ProfileWindowOptions {
  /** 页面加载完成后再等一会儿，让首屏异步数据落地。 */
  settleMs?: number
  /** 整次加载的超时。 */
  timeoutMs?: number
}

async function setCookies(target: Electron.Session, cookies: Cookie[]) {
  for (const cookie of cookies) {
    try {
      const url = cookie.domain
        ? cookie.domain.startsWith(".")
          ? `https://www.${cookie.domain.slice(1)}`
          : `https://${cookie.domain}`
        : ""
      await target.cookies.set({
        url,
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
      })
    } catch {
      /* 单条 cookie 失败不影响其它 */
    }
  }
}

/**
 * 打开隐藏窗口 → 灌 cookie → 加载 url → 抓资料。
 * 任何一步失败都返回 null，绝不抛给调用方（巡检不该因为某个平台挂掉而中断）。
 */
export async function captureProfileInWindow(
  cookies: Cookie[],
  url: string,
  hints: CaptureHints = {},
  options: ProfileWindowOptions = {},
): Promise<PageProfile | null> {
  if (!url) return null
  const partition = `persist:platform-profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  let win: BrowserWindow | undefined
  try {
    const target = session.fromPartition(partition)
    await setCookies(target, cookies)

    win = new BrowserWindow({
      width: 1280,
      height: 900,
      show: false,
      webPreferences: {
        contextIsolation: false,
        nodeIntegration: false,
        partition,
      },
    })
    win.webContents.setUserAgent(PLATFORM_USER_AGENT)

    const loaded = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, options.timeoutMs ?? LOAD_TIMEOUT_MS)
      timer.unref?.()
      win!.webContents.once("did-finish-load", () => {
        clearTimeout(timer)
        resolve()
      })
      win!.webContents.once("did-fail-load", () => {
        clearTimeout(timer)
        resolve()
      })
    })

    void win.loadURL(url).catch(() => undefined)
    await loaded

    await new Promise((resolve) => setTimeout(resolve, options.settleMs ?? RENDER_SETTLE_MS))
    if (win.isDestroyed()) return null

    const profile = await capturePageProfile(win, hints)
    if (!profile.uid && !profile.nickname && !profile.avatar) return null
    return profile
  } catch {
    return null
  } finally {
    try {
      if (win && !win.isDestroyed()) win.destroy()
    } catch {}
    // 隐藏窗口用的是临时分区：清掉免得 cookie 落在磁盘上长期留存。
    try {
      await session.fromPartition(partition).clearStorageData()
    } catch {}
  }
}
