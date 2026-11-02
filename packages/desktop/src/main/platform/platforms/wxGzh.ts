import { BrowserWindow, screen, session } from "electron"
import type { Cookie } from "electron"
import {
  PlatformBase,
  type PlatformLoginResult,
  type PublishInput,
  type PublishResult,
  type PlatformAccountInfo,
  type AccountStats,
  type PublishRecord,
} from "../PlatformBase"
import { capturePageProfile, waitForSelector } from "../profile-capture"

const LOGIN_URL = "https://mp.weixin.qq.com/"
const COOKIE_URL = "https://mp.weixin.qq.com"
const LOGIN_TIMEOUT_MS = 3 * 60 * 1000
const CHECK_INTERVAL_MS = 1200
const PROFILE_WAIT_MS = 1200
const PROFILE_TIMEOUT_MS = 8000
const LOGIN_COOKIE_CANDIDATES = ["slave_sid", "slave_user", "data_bizuin", "bizuin"]
/** 后台首页右上角的账号区。 */
const WXGZH_CAPTURE_HINTS = {
  nicknameSelectors: [".weui-desktop-account__info-name", ".account_meta_primary", ".weui-desktop-account__nickname"],
  avatarSelectors: [".weui-desktop-account__info-avatar img", ".account_meta img"],
}

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

function safeDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function parseCookies(value?: string): Cookie[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed as Cookie[]
  } catch {
    return []
  }
}

function hasGzhLoginCookie(cookies: Cookie[]) {
  return LOGIN_COOKIE_CANDIDATES.some((name) =>
    cookies.some((cookie) => cookie.name === name && String(cookie.value || "").trim()),
  )
}

type WxGzhProfile = { uid: string; nickname: string; avatar: string }
type WxGzhAccountInfo = { uid: string; account: string; nickname: string; avatar: string }

export class WxGzhPlatform extends PlatformBase {
  readonly id = "wxGzh"
  readonly name = "微信公众号"
  readonly loginUrl = LOGIN_URL
  readonly cookieCheckField = "slave_sid"
  readonly profileUrl = "https://mp.weixin.qq.com/cgi-bin/home"

  async login(): Promise<{
    loginCookie: string
    uid: string
    nickname: string
    avatar: string
    fansCount: number
  } | null> {
    const { win, partition } = await this.createAuthorizationWindow()

    try {
      const { cookies, token } = await this.waitForLoginCookies(win, partition)
      await this.navigateToDashboard(win, token)
      const profile = await this.captureProfile(win)
      const info = this.extractAccountInfo(cookies, token, profile)
      if (!info.uid) return null

      return {
        loginCookie: JSON.stringify(cookies),
        uid: info.uid,
        nickname: info.nickname,
        avatar: info.avatar,
        fansCount: 0,
      }
    } catch (error) {
      console.error("wxGzh login failed:", error)
      return null
    } finally {
      if (!win.isDestroyed()) win.close()
    }
  }

  async loginOrView(authModel: "login" | "view", _existingCookies?: Cookie[] | null): Promise<PlatformLoginResult> {
    if (authModel === "view") return { success: false, error: "预览模式未实现" }

    const { win, partition } = await this.createAuthorizationWindow()

    try {
      const { cookies, token } = await this.waitForLoginCookies(win, partition)
      await this.navigateToDashboard(win, token)
      const profile = await this.captureProfile(win)
      const info = this.extractAccountInfo(cookies, token, profile)

      return {
        success: true,
        cookies,
        userInfo: {
          nickname: info.nickname || info.uid,
          avatar: info.avatar,
          platformUserId: info.uid,
        },
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "微信公众号登录失败",
      }
    } finally {
      if (!win.isDestroyed()) win.close()
    }
  }

  private async createAuthorizationWindow() {
    const partition = `wx-gzh-login-${Date.now()}`
    const { width, height } = screen.getPrimaryDisplay().workAreaSize
    const win = new BrowserWindow({
      width: Math.ceil(width * 0.82),
      height: Math.ceil(height * 0.84),
      show: false,
      webPreferences: {
        contextIsolation: false,
        nodeIntegration: false,
        partition,
      },
    })

    win.webContents.setUserAgent(DEFAULT_USER_AGENT)
    await win.loadURL(LOGIN_URL)
    win.show()

    return { win, partition }
  }

  private async waitForLoginCookies(win: BrowserWindow, partition: string) {
    const ses = session.fromPartition(partition)
    return new Promise<{ cookies: Cookie[]; token: string }>((resolve, reject) => {
      let settled = false
      let intervalTimer: NodeJS.Timeout | null = null
      let timeoutTimer: NodeJS.Timeout | null = null

      const cleanup = () => {
        if (intervalTimer) {
          clearInterval(intervalTimer)
          intervalTimer = null
        }
        if (timeoutTimer) {
          clearTimeout(timeoutTimer)
          timeoutTimer = null
        }
        if (!win.isDestroyed()) {
          win.removeListener("closed", onClosed)
          win.webContents.removeListener("did-navigate", onNavigate)
          win.webContents.removeListener("did-navigate-in-page", onNavigate)
        }
      }

      const finish = (result: { cookies: Cookie[]; token: string }) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(result)
      }

      const fail = (error: Error) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      }

      const checkLogin = async () => {
        if (settled || win.isDestroyed()) return
        try {
          const currentUrl = win.webContents.getURL() || ""
          const token = this.extractTokenFromUrl(currentUrl)
          const cookies = await ses.cookies.get({ url: COOKIE_URL })
          if ((this.isLoggedInUrl(currentUrl) && !!token) || hasGzhLoginCookie(cookies)) {
            finish({ cookies, token })
          }
        } catch (error) {
          fail(new Error(`微信公众号登录检测失败: ${String(error)}`))
        }
      }

      const onNavigate = () => {
        void checkLogin()
      }

      const onClosed = () => {
        fail(new Error("微信公众号登录窗口已关闭"))
      }

      win.once("closed", onClosed)
      win.webContents.on("did-navigate", onNavigate)
      win.webContents.on("did-navigate-in-page", onNavigate)

      intervalTimer = setInterval(() => {
        void checkLogin()
      }, CHECK_INTERVAL_MS)
      timeoutTimer = setTimeout(() => {
        fail(new Error("微信公众号登录超时，请重试"))
      }, LOGIN_TIMEOUT_MS)
      intervalTimer.unref?.()
      timeoutTimer.unref?.()
      void checkLogin()
    })
  }

  private wait(ms: number) {
    return new Promise<void>((resolve) => {
      setTimeout(() => resolve(), ms)
    })
  }

  private async navigateToDashboard(win: BrowserWindow, token: string) {
    if (win.isDestroyed()) return
    const currentUrl = win.webContents.getURL() || ""
    if (this.isLoggedInUrl(currentUrl) && !!token) return
    try {
      const url = token
        ? `https://mp.weixin.qq.com/cgi-bin/home?token=${token}&lang=zh_CN`
        : "https://mp.weixin.qq.com/cgi-bin/home"
      console.debug("[wxGzh] navigating to dashboard:", url)
      await win.loadURL(url)
      await this.wait(PROFILE_WAIT_MS)
    } catch (error) {
      console.warn("[wxGzh] navigateToDashboard failed:", error)
    }
  }

  /**
   * 从后台首页抓账号资料。
   *
   * 之前是一段写死的脚本 + 固定等 1.2s：页面首屏还没渲染完就取，经常只拿到
   * "公众号"这种占位文案（存储里那条空昵称记录就是这么来的）。
   * 现在先等账号区真的出现，再用通用抓取（DOM 选择器 + wx.cgiData 扫描）。
   */
  private async captureProfile(win: BrowserWindow): Promise<WxGzhProfile> {
    try {
      if (win.isDestroyed()) return { uid: "", nickname: "", avatar: "" }
      await waitForSelector(
        win,
        ".weui-desktop-account__info-name, .account_meta_primary, .weui-desktop-account__info-avatar img",
        PROFILE_TIMEOUT_MS,
      )
      if (win.isDestroyed()) return { uid: "", nickname: "", avatar: "" }

      const page = await capturePageProfile(win, WXGZH_CAPTURE_HINTS)
      const result = {
        uid: this.normalizeField(page.uid),
        nickname: this.normalizeField(page.nickname),
        avatar: this.normalizeAvatar(page.avatar),
      }
      console.debug("[wxGzh] captureProfile result:", JSON.stringify(result))
      return result
    } catch (error) {
      console.warn("[wxGzh] captureProfile failed:", error)
      return { uid: "", nickname: "", avatar: "" }
    }
  }

  private normalizeField(value: unknown) {
    return safeDecodeURIComponent(String(value || "").trim())
  }

  private normalizeAvatar(value: unknown) {
    const raw = String(value || "").trim()
    if (!raw) return ""
    if (raw.startsWith("//")) return "https:" + raw
    if (/^https?:\/\//i.test(raw)) return raw
    return ""
  }

  private extractTokenFromUrl(url: string) {
    try {
      const parsed = new URL(url)
      return String(parsed.searchParams.get("token") || "").trim()
    } catch {
      return ""
    }
  }

  private isLoggedInUrl(url: string) {
    return /mp\.weixin\.qq\.com\/cgi-bin\/home/i.test(url)
  }

  private extractAccountInfo(cookies: Cookie[], token?: string, profile?: WxGzhProfile): WxGzhAccountInfo {
    const cookieMap = new Map<string, string>()
    for (const cookie of cookies) {
      cookieMap.set(cookie.name, this.normalizeField(cookie.value))
    }

    const profileUid = this.normalizeField(profile?.uid)
    const uid =
      profileUid ||
      this.normalizeField(cookieMap.get("slave_user")) ||
      this.normalizeField(cookieMap.get("data_bizuin")) ||
      this.normalizeField(cookieMap.get("bizuin")) ||
      this.normalizeField(token) ||
      ""

    const nickname =
      this.normalizeField(profile?.nickname) ||
      this.normalizeField(cookieMap.get("nick_name")) ||
      this.normalizeField(cookieMap.get("fakeid")) ||
      uid

    const avatar = this.normalizeAvatar(profile?.avatar)

    console.debug(
      "[wxGzh] extractAccountInfo:",
      JSON.stringify({ uid, nickname, avatar }),
      "cookie_nick_name:",
      cookieMap.get("nick_name"),
      "cookie_fakeid:",
      cookieMap.get("fakeid"),
      "profile:",
      JSON.stringify(profile),
    )

    return { uid, account: uid, nickname, avatar }
  }

  async detectLogin(cookies: Cookie[]): Promise<boolean> {
    return hasGzhLoginCookie(cookies)
  }

  async getAccountInfo(cookies: Cookie[]): Promise<PlatformAccountInfo> {
    const info = this.extractAccountInfo(cookies)
    return {
      platformUserId: info.uid,
      nickname: info.nickname,
      avatar: info.avatar,
    }
  }

  async publish(_input: PublishInput, _cookies: Cookie[]): Promise<PublishResult> {
    return { success: false, error: "公众号暂未接入发布能力" }
  }

  async getPublishHistory(_accountId: string): Promise<PublishRecord[]> {
    return []
  }

  async getAccountStats(_accountId: string): Promise<AccountStats> {
    return { followers: 0, following: 0, totalPosts: 0, totalLikes: 0, updatedAt: Date.now() }
  }
}
