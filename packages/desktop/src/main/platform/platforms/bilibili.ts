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

const LOGIN_URL = "https://passport.bilibili.com/login"
const COOKIE_URL = "https://www.bilibili.com"
const LOGIN_TIMEOUT_MS = 3 * 60 * 1000
const CHECK_INTERVAL_MS = 1200
const PROFILE_WAIT_MS = 1000
const PROFILE_TIMEOUT_MS = 8000
const LOGIN_COOKIE_CANDIDATES = ["SESSDATA", "bili_jct", "DedeUserID"]
const USER_AGENT =
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

function isCookieExpired(cookie: Cookie) {
  if (typeof cookie.expirationDate !== "number") return false
  return cookie.expirationDate * 1000 <= Date.now()
}

function hasBilibiliLoginCookie(cookies: Cookie[]) {
  return LOGIN_COOKIE_CANDIDATES.every((name) =>
    cookies.some((cookie) => cookie.name === name && String(cookie.value || "").trim()),
  )
}

type BilibiliProfile = {
  uid: string
  nickname: string
  avatar: string
}

type BilibiliAccountInfo = {
  uid: string
  account: string
  nickname: string
  avatar: string
}

export class BilibiliPlatform extends PlatformBase {
  readonly id = "bilibili"
  readonly name = "B站"
  readonly loginUrl = LOGIN_URL
  readonly cookieCheckField = "SESSDATA"

  async login(): Promise<{
    loginCookie: string
    uid: string
    nickname: string
    avatar: string
    fansCount: number
  } | null> {
    const { win, partition } = await this.createAuthorizationWindow()

    try {
      const cookies = await this.waitForLoginCookies(win, partition)
      await this.navigateToMainSite(win)
      const snapshotProfile = await this.captureProfile(win)
      const cookieProfile = await this.fetchProfileByCookies(cookies)
      const profile = this.mergeProfile(snapshotProfile, cookieProfile)
      const info = this.extractAccountInfo(cookies, profile)
      if (!info.uid) return null

      return {
        loginCookie: JSON.stringify(cookies),
        uid: info.uid,
        nickname: info.nickname,
        avatar: info.avatar,
        fansCount: 0,
      }
    } catch (error) {
      console.error("bilibili login failed:", error)
      return null
    } finally {
      if (!win.isDestroyed()) win.close()
    }
  }

  async loginOrView(authModel: "login" | "view", _existingCookies?: Cookie[] | null): Promise<PlatformLoginResult> {
    if (authModel === "view") {
      return { success: false, error: "预览模式未实现" }
    }

    const { win, partition } = await this.createAuthorizationWindow()

    try {
      const cookies = await this.waitForLoginCookies(win, partition)
      await this.navigateToMainSite(win)
      const snapshotProfile = await this.captureProfile(win)
      const cookieProfile = await this.fetchProfileByCookies(cookies)
      const profile = this.mergeProfile(snapshotProfile, cookieProfile)
      const info = this.extractAccountInfo(cookies, profile)

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
        error: error instanceof Error ? error.message : "B站登录失败",
      }
    } finally {
      if (!win.isDestroyed()) win.close()
    }
  }

  private async createAuthorizationWindow() {
    const partition = `bilibili-login-${Date.now()}`
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

    win.webContents.setUserAgent(USER_AGENT)
    await win.loadURL(LOGIN_URL)
    win.show()

    return { win, partition }
  }

  private async waitForLoginCookies(win: BrowserWindow, partition: string) {
    const ses = session.fromPartition(partition)
    return new Promise<Cookie[]>((resolve, reject) => {
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

      const finish = (result: Cookie[]) => {
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
          const cookies = await ses.cookies.get({ url: COOKIE_URL })
          if (hasBilibiliLoginCookie(cookies)) {
            finish(cookies)
          }
        } catch (error) {
          fail(new Error(`B站登录检测失败: ${String(error)}`))
        }
      }

      const onNavigate = () => {
        void checkLogin()
      }

      const onClosed = () => {
        fail(new Error("B站登录窗口已关闭"))
      }

      win.once("closed", onClosed)
      win.webContents.on("did-navigate", onNavigate)
      win.webContents.on("did-navigate-in-page", onNavigate)

      intervalTimer = setInterval(() => {
        void checkLogin()
      }, CHECK_INTERVAL_MS)
      timeoutTimer = setTimeout(() => {
        fail(new Error("B站登录超时，请重试"))
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

  private async navigateToMainSite(win: BrowserWindow) {
    if (win.isDestroyed()) return
    const currentUrl = win.webContents.getURL() || ""
    if (currentUrl.startsWith("https://www.bilibili.com")) return
    try {
      console.debug("[bilibili] navigating to www.bilibili.com for profile capture")
      await win.loadURL("https://www.bilibili.com")
      await this.wait(PROFILE_WAIT_MS)
    } catch (error) {
      console.warn("[bilibili] navigateToMainSite failed:", error)
    }
  }

  private async captureProfile(win: BrowserWindow): Promise<BilibiliProfile> {
    try {
      if (win.isDestroyed()) return { uid: "", nickname: "", avatar: "" }
      await this.wait(PROFILE_WAIT_MS)
      if (win.isDestroyed()) return { uid: "", nickname: "", avatar: "" }

      const script = `(() => {
        const pick = (value) => (typeof value === 'string' ? value.trim() : '');
        const toAbsolute = (url) => {
          const text = pick(url);
          if (!text) return '';
          if (text.startsWith('//')) return 'https:' + text;
          if (/^https?:\\/\\//i.test(text)) return text;
          return '';
        };

        const result = { uid: '', nickname: '', avatar: '' };

        try {
          const state = window.__INITIAL_STATE__ || {};
          const userData = state.userData || state.user || {};
          result.uid = pick(userData.mid || userData.uid || '');
          result.nickname = pick(userData.uname || userData.name || '');
          result.avatar = toAbsolute(userData.face || userData.avatar || '');
        } catch {}

        return fetch('https://api.bilibili.com/x/web-interface/nav', {
          credentials: 'include',
        })
          .then((res) => res.json())
          .then((json) => {
            const data = (json && json.data) || {};
            result.uid = result.uid || pick(data.mid);
            result.nickname = result.nickname || pick(data.uname);
            result.avatar = result.avatar || toAbsolute(data.face);
            return result;
          })
          .catch(() => result);
      })()`

      const profile = (await Promise.race([
        win.webContents.executeJavaScript(script, true),
        this.wait(PROFILE_TIMEOUT_MS).then(() => null),
      ])) as Partial<BilibiliProfile> | null

      const result = {
        uid: this.normalizeField(profile?.uid),
        nickname: this.normalizeField(profile?.nickname),
        avatar: this.normalizeAvatar(profile?.avatar),
      }
      console.debug("[bilibili] captureProfile result:", JSON.stringify(result))
      return result
    } catch (error) {
      console.warn("[bilibili] captureProfile failed:", error)
      return { uid: "", nickname: "", avatar: "" }
    }
  }

  private mergeProfile(primary?: Partial<BilibiliProfile>, fallback?: Partial<BilibiliProfile>): BilibiliProfile {
    return {
      uid: this.normalizeField(primary?.uid) || this.normalizeField(fallback?.uid),
      nickname: this.normalizeField(primary?.nickname) || this.normalizeField(fallback?.nickname),
      avatar: this.normalizeAvatar(primary?.avatar) || this.normalizeAvatar(fallback?.avatar),
    }
  }

  private buildCookieHeader(cookies: Cookie[]) {
    return cookies
      .map((cookie) => {
        const name = this.normalizeField(cookie?.name)
        const value = this.normalizeField(cookie?.value)
        if (!name || !value) return ""
        return `${name}=${value}`
      })
      .filter(Boolean)
      .join("; ")
  }

  private async fetchProfileByCookies(cookies: Cookie[]): Promise<BilibiliProfile> {
    const cookieHeader = this.buildCookieHeader(cookies)
    if (!cookieHeader) return { uid: "", nickname: "", avatar: "" }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PROFILE_TIMEOUT_MS)
    try {
      const response = await fetch("https://api.bilibili.com/x/web-interface/nav", {
        method: "GET",
        headers: {
          Accept: "application/json, text/plain, */*",
          Referer: "https://www.bilibili.com/",
          Origin: "https://www.bilibili.com",
          Cookie: cookieHeader,
          "User-Agent": USER_AGENT,
        },
        signal: controller.signal,
      })
      if (!response.ok) return { uid: "", nickname: "", avatar: "" }

      const json = (await response.json().catch(() => null)) as any
      const data = json?.data || {}
      const result = {
        uid: this.normalizeField(data.mid),
        nickname: this.normalizeField(data.uname),
        avatar: this.normalizeAvatar(data.face),
      }
      console.debug("[bilibili] fetchProfileByCookies response:", response.status, JSON.stringify(result))
      return result
    } catch (error) {
      console.warn("[bilibili] fetchProfileByCookies failed:", String(error))
      return { uid: "", nickname: "", avatar: "" }
    } finally {
      clearTimeout(timer)
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

  private extractAccountInfo(cookies: Cookie[], profile?: BilibiliProfile): BilibiliAccountInfo {
    const cookieMap = new Map<string, string>()
    for (const cookie of cookies) {
      cookieMap.set(cookie.name, this.normalizeField(cookie.value))
    }

    const uid = this.normalizeField(profile?.uid) || this.normalizeField(cookieMap.get("DedeUserID")) || ""
    const nickname = this.normalizeField(profile?.nickname) || this.normalizeField(cookieMap.get("bili_uname")) || uid
    const avatar = this.normalizeAvatar(profile?.avatar)

    console.debug(
      "[bilibili] extractAccountInfo:",
      JSON.stringify({ uid, nickname, avatar }),
      "cookie_bili_uname:",
      cookieMap.get("bili_uname"),
      "profile:",
      JSON.stringify(profile),
    )

    return { uid, account: uid, nickname, avatar }
  }

  async detectLogin(cookies: Cookie[]): Promise<boolean> {
    try {
      const profile = await this.fetchProfileByCookies(cookies)
      return !!profile.uid
    } catch {
      return false
    }
  }

  async getAccountInfo(cookies: Cookie[]): Promise<PlatformAccountInfo> {
    const profile = await this.fetchProfileByCookies(cookies)
    const info = this.extractAccountInfo(cookies, profile)
    return {
      platformUserId: info.uid,
      nickname: info.nickname,
      avatar: info.avatar,
    }
  }

  async publish(_input: PublishInput, _cookies: Cookie[]): Promise<PublishResult> {
    return { success: false, error: "B站暂未接入发布能力" }
  }

  async getPublishHistory(_accountId: string): Promise<PublishRecord[]> {
    return []
  }

  async getAccountStats(_accountId: string): Promise<AccountStats> {
    return { followers: 0, following: 0, totalPosts: 0, totalLikes: 0, updatedAt: Date.now() }
  }
}
