import { BrowserWindow, screen, session } from "electron"
import type { Cookie } from "electron"
import { PlatformBase, type PlatformLoginResult, type PublishInput, type PublishResult, type PlatformAccountInfo, type AccountStats, type PublishRecord } from "../PlatformBase"

const LOGIN_URL = "https://mp.weixin.qq.com/"
const COOKIE_URL = "https://mp.weixin.qq.com"
const LOGIN_TIMEOUT_MS = 3 * 60 * 1000
const CHECK_INTERVAL_MS = 1200
const PROFILE_WAIT_MS = 1200
const PROFILE_TIMEOUT_MS = 8000
const LOGIN_COOKIE_CANDIDATES = ["slave_sid", "slave_user", "data_bizuin", "bizuin"]
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

function safeDecodeURIComponent(value: string) {
  try { return decodeURIComponent(value) } catch { return value }
}

function parseCookies(value?: string): Cookie[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed as Cookie[]
  } catch { return [] }
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

  async login(): Promise<{ loginCookie: string; uid: string; nickname: string; avatar: string; fansCount: number } | null> {
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
        if (intervalTimer) { clearInterval(intervalTimer); intervalTimer = null }
        if (timeoutTimer) { clearTimeout(timeoutTimer); timeoutTimer = null }
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

      const onNavigate = () => { void checkLogin() }

      const onClosed = () => { fail(new Error("微信公众号登录窗口已关闭")) }

      win.once("closed", onClosed)
      win.webContents.on("did-navigate", onNavigate)
      win.webContents.on("did-navigate-in-page", onNavigate)

      intervalTimer = setInterval(() => { void checkLogin() }, CHECK_INTERVAL_MS)
      timeoutTimer = setTimeout(() => { fail(new Error("微信公众号登录超时，请重试")) }, LOGIN_TIMEOUT_MS)
      intervalTimer.unref?.()
      timeoutTimer.unref?.()
      void checkLogin()
    })
  }

  private wait(ms: number) {
    return new Promise<void>((resolve) => { setTimeout(() => resolve(), ms) })
  }

  private async navigateToDashboard(win: BrowserWindow, token: string) {
    if (win.isDestroyed()) return
    const currentUrl = win.webContents.getURL() || ""
    if (this.isLoggedInUrl(currentUrl) && !!token) return
    try {
      const url = token ? `https://mp.weixin.qq.com/cgi-bin/home?token=${token}&lang=zh_CN` : "https://mp.weixin.qq.com/cgi-bin/home"
      console.debug("[wxGzh] navigating to dashboard:", url)
      await win.loadURL(url)
      await this.wait(PROFILE_WAIT_MS)
    } catch (error) {
      console.warn("[wxGzh] navigateToDashboard failed:", error)
    }
  }

  private async captureProfile(win: BrowserWindow): Promise<WxGzhProfile> {
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
        const pickByPath = (obj, paths) => {
          if (!obj || typeof obj !== 'object') return '';
          for (const path of paths) {
            const keys = path.split('.');
            let cur = obj;
            let ok = true;
            for (const key of keys) {
              if (!cur || typeof cur !== 'object' || !(key in cur)) { ok = false; break; }
              cur = cur[key];
            }
            if (ok) {
              const text = pick(cur);
              if (text) return text;
            }
          }
          return '';
        };

        const wxData = (window.wx && (window.wx.cgiData || window.wx.data)) || {};
        const cgiData = window.cgiData || {};
        const appData = window.__INITIAL_STATE__ || {};

        const datasets = [wxData, cgiData, appData];
        for (const source of datasets) {
          if (!result.uid) {
            result.uid = pickByPath(source, ['user_name', 'username', 'userName', 'bizuin', 'data_bizuin', 'slave_user', 'fakeid']);
          }
          if (!result.nickname) {
            result.nickname = pickByPath(source, ['nick_name', 'nickname', 'nickName', 'user_nickname', 'name']);
          }
          if (!result.avatar) {
            result.avatar = toAbsolute(pickByPath(source, ['headimg', 'head_img', 'avatar', 'headImg']));
          }
        }

        if (!result.nickname) {
          const title = pick(document.title).replace(/微信公众平台/g, '').replace(/[-|_].*$/, '').trim();
          if (title && title !== '首页') result.nickname = title;
        }

        if (!result.nickname) {
          const nameNode = document.querySelector('.weui-desktop-account__info-name, .account_meta_primary');
          const text = pick(nameNode && nameNode.textContent);
          if (text) result.nickname = text;
        }

        if (!result.avatar) {
          const avatarNode = document.querySelector('.weui-desktop-account__info-avatar img, .account_meta img');
          const src = avatarNode ? avatarNode.getAttribute('src') || '' : '';
          result.avatar = toAbsolute(src);
        }

        return result;
      })()`

      const profile = (await Promise.race([
        win.webContents.executeJavaScript(script, true),
        this.wait(PROFILE_TIMEOUT_MS).then(() => null),
      ])) as Partial<WxGzhProfile> | null

      const result = {
        uid: this.normalizeField(profile?.uid),
        nickname: this.normalizeField(profile?.nickname),
        avatar: this.normalizeAvatar(profile?.avatar),
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
    } catch { return "" }
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

    console.debug("[wxGzh] extractAccountInfo:", JSON.stringify({ uid, nickname, avatar }),
      "cookie_nick_name:", cookieMap.get("nick_name"),
      "cookie_fakeid:", cookieMap.get("fakeid"),
      "profile:", JSON.stringify(profile))

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
