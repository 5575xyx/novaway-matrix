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

const LOGIN_URL = "https://www.goofish.com/im"
const COOKIE_URL = "https://www.goofish.com"
const LOGIN_TIMEOUT_MS = 3 * 60 * 1000
const CHECK_INTERVAL_MS = 1200
const PROFILE_SNAPSHOT_WAIT_MS = 1200
const PROFILE_SNAPSHOT_TIMEOUT_MS = 8000
const PERSONAL_PAGE_PROFILE_WAIT_MS = 2400
const LOGIN_COOKIE_HARD_REQUIRED = ["unb", "cookie2"]
const SILENT_LOGIN_CHECK_URL = "https://passport.goofish.com/newlogin/silentHasLogin.do"
const LOGIN_CHECK_TIMEOUT_MS = 8_000
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

function hasLoginCookie(cookies: Cookie[]) {
  return LOGIN_COOKIE_HARD_REQUIRED.every((name) =>
    cookies.some((cookie) => cookie.name === name && String(cookie.value || "").trim()),
  )
}

function isCookieExpired(cookie: Cookie) {
  if (typeof cookie.expirationDate !== "number") return false
  return cookie.expirationDate * 1000 <= Date.now()
}

type XianyuAccountInfo = { uid: string; account: string; nickname: string; avatar: string }
type XianyuPageProfile = { uid: string; nickname: string; avatar: string }

export class XianyuPlatform extends PlatformBase {
  readonly id = "xianyu"
  readonly name = "闲鱼"
  readonly loginUrl = LOGIN_URL
  readonly cookieCheckField = "unb"

  private windowTimers = new Map<number, NodeJS.Timeout>()

  async login(): Promise<{
    loginCookie: string
    uid: string
    nickname: string
    avatar: string
    fansCount: number
  } | null> {
    const { win, partition } = await this.createAuthorizationWindow()
    const winId = win.id

    try {
      const cookies = await this.waitForLoginCookies(winId, partition)
      let profile = await this.captureProfileFromLoginWindow(win)
      const cookieInfo = this.extractAccountInfo(cookies)
      const shouldTryPersonalPage =
        !!cookieInfo.uid && (!profile.nickname || !profile.avatar || profile.nickname.trim() === cookieInfo.uid)

      if (shouldTryPersonalPage) {
        const personalProfile = await this.captureProfileFromPersonalPage(win, cookieInfo.uid)
        profile = this.mergeProfiles(profile, personalProfile)
      }

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
      console.error("xianyu login failed:", error)
      return null
    } finally {
      this.clearTimer(winId)
      if (!win.isDestroyed()) win.close()
    }
  }

  async loginOrView(authModel: "login" | "view", _existingCookies?: Cookie[] | null): Promise<PlatformLoginResult> {
    if (authModel === "view") return { success: false, error: "预览模式未实现" }

    const { win, partition } = await this.createAuthorizationWindow()
    const winId = win.id

    try {
      const cookies = await this.waitForLoginCookies(winId, partition)
      let profile = await this.captureProfileFromLoginWindow(win)
      const cookieInfo = this.extractAccountInfo(cookies)
      const shouldTryPersonalPage =
        !!cookieInfo.uid && (!profile.nickname || !profile.avatar || profile.nickname.trim() === cookieInfo.uid)

      if (shouldTryPersonalPage) {
        const personalProfile = await this.captureProfileFromPersonalPage(win, cookieInfo.uid)
        profile = this.mergeProfiles(profile, personalProfile)
      }

      const info = this.extractAccountInfo(cookies, profile)
      if (!info.uid) return { success: false, error: "无法获取用户信息" }

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
        error: error instanceof Error ? error.message : "闲鱼登录失败",
      }
    } finally {
      this.clearTimer(winId)
      if (!win.isDestroyed()) win.close()
    }
  }

  private async createAuthorizationWindow() {
    const partition = `xianyu-login-${Date.now()}`
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

  private async waitForLoginCookies(winId: number, partition: string) {
    return new Promise<Cookie[]>((resolve, reject) => {
      const timer = setInterval(async () => {
        try {
          const cookies = await session.fromPartition(partition).cookies.get({ url: COOKIE_URL })
          if (hasLoginCookie(cookies)) {
            this.clearTimer(winId)
            resolve(cookies)
          }
        } catch (error) {
          this.clearTimer(winId)
          reject(error)
        }
      }, CHECK_INTERVAL_MS)

      this.windowTimers.set(winId, timer)

      const timeout = setTimeout(() => {
        this.clearTimer(winId)
        reject(new Error("闲鱼登录超时，请重试"))
      }, LOGIN_TIMEOUT_MS)

      timer.unref?.()
      timeout.unref?.()
    })
  }

  private clearTimer(winId: number) {
    const timer = this.windowTimers.get(winId)
    if (timer) {
      clearInterval(timer)
      this.windowTimers.delete(winId)
    }
  }

  private wait(ms: number) {
    return new Promise<void>((resolve) => {
      setTimeout(() => resolve(), ms)
    })
  }

  private normalizeAvatar(value: unknown) {
    const raw = String(value || "").trim()
    if (!raw) return ""
    if (raw.startsWith("//")) return "https:" + raw
    if (/^https?:\/\//i.test(raw)) return raw
    return ""
  }

  private normalizeField(value: unknown) {
    return safeDecodeURIComponent(String(value || "").trim())
  }

  private buildUserAvatarUrl(uid: string) {
    const normalizedUid = this.normalizeField(uid)
    if (!normalizedUid) return ""
    return `https://api.goofish.com/m/userAvatar.action?id=${encodeURIComponent(normalizedUid)}&needHttps=1&suffix=_120x120.jpg`
  }

  private buildCookieHeader(cookies: Cookie[]) {
    return cookies
      .map((cookie) => {
        const name = String(cookie?.name || "").trim()
        const value = String(cookie?.value || "").trim()
        if (!name || !value) return ""
        return `${name}=${value}`
      })
      .filter(Boolean)
      .join("; ")
  }

  private async checkLoginBySilentApi(cookies: Cookie[]) {
    const cookieHeader = this.buildCookieHeader(cookies)
    if (!cookieHeader) return null

    const cookieMap = new Map<string, string>()
    for (const cookie of cookies) {
      cookieMap.set(String(cookie.name || "").trim(), String(cookie.value || ""))
    }

    const unb = String(cookieMap.get("unb") || "").trim()
    const cookie2 = String(cookieMap.get("cookie2") || "").trim()
    const xsrfToken = String(cookieMap.get("XSRF-TOKEN") || "").trim()
    const cna = String(cookieMap.get("cna") || "").trim()
    if (!unb || !cookie2) return false

    const query = new URLSearchParams({
      documentReferer: "https%3A%2F%2Fwww.goofish.com%2F",
      appEntrance: "xianyu_sdkSilent",
      appName: "xianyu",
      fromSite: "0",
      ltl: "true",
    })
    const form = new URLSearchParams({
      hid: unb,
      ltl: "true",
      appName: "xianyu",
      appEntrance: "web",
      _csrf_token: xsrfToken,
      umidToken: "",
      hsiz: cookie2,
      mainPage: "false",
      isMobile: "false",
      lang: "zh_CN",
      returnUrl: "",
      fromSite: "77",
      isIframe: "true",
      documentReferer: "https://www.goofish.com/",
      defaultView: "hasLogin",
      umidTag: "SERVER",
      deviceId: cna,
    })

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), LOGIN_CHECK_TIMEOUT_MS)

    try {
      const response = await fetch(`${SILENT_LOGIN_CHECK_URL}?${query.toString()}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Accept: "application/json, text/plain, */*",
          Origin: "https://www.goofish.com",
          Referer: "https://www.goofish.com/",
          Cookie: cookieHeader,
          "User-Agent": DEFAULT_USER_AGENT,
        },
        body: form.toString(),
        signal: controller.signal,
      })
      if (!response.ok) return null

      const text = await response.text().catch(() => "")
      if (!text) return null

      let payload: any = null
      try {
        payload = JSON.parse(text)
      } catch {
        return null
      }

      if (!payload || typeof payload !== "object") return null

      const content = payload.content && typeof payload.content === "object" ? payload.content : null
      if (typeof content?.success === "boolean") return content.success
      if (typeof payload.success === "boolean") return payload.success
      if (typeof payload.isLogin === "boolean") return payload.isLogin
      if (typeof payload.hasLogin === "boolean") return payload.hasLogin

      return null
    } catch {
      return null
    } finally {
      clearTimeout(timeout)
    }
  }

  private mergeProfiles(first?: XianyuPageProfile, second?: XianyuPageProfile): XianyuPageProfile {
    const p1 = this.normalizePageProfile(first)
    const p2 = this.normalizePageProfile(second)
    return {
      uid: p2.uid || p1.uid,
      nickname: p2.nickname || p1.nickname,
      avatar: p2.avatar || p1.avatar,
    }
  }

  private normalizePageProfile(raw: unknown): XianyuPageProfile {
    if (!raw || typeof raw !== "object") return { uid: "", nickname: "", avatar: "" }
    const data = raw as Partial<XianyuPageProfile>
    return {
      uid: this.normalizeField(data.uid),
      nickname: this.normalizeField(data.nickname),
      avatar: this.normalizeAvatar(data.avatar),
    }
  }

  private async captureProfileFromLoginWindow(win: BrowserWindow): Promise<XianyuPageProfile> {
    try {
      if (win.isDestroyed()) return { uid: "", nickname: "", avatar: "" }

      await this.wait(PROFILE_SNAPSHOT_WAIT_MS)
      if (win.isDestroyed()) return { uid: "", nickname: "", avatar: "" }

      const script = `(() => {
        const pick = (value) => typeof value === 'string' ? value.trim() : '';
        const decode = (value) => {
          try { return decodeURIComponent(value); } catch { return value; }
        };
        const toAbsolute = (url) => {
          const text = pick(url);
          if (!text) return '';
          if (text.startsWith('//')) return 'https:' + text;
          if (/^https?:\\/\\//i.test(text)) return text;
          return '';
        };
        const readCookie = (name) => {
          const safeName = String(name || '').replace(/([.*+?^=!:()|[\\]\\\\/{}$-])/g, '\\\\$1');
          const matched = document.cookie.match(new RegExp('(?:^|;\\\\s*)' + safeName + '=([^;]*)'));
          return matched ? decode(matched[1] || '') : '';
        };

        const result = { uid: '', nickname: '', avatar: '' };
        const roots = [];
        const pushRoot = (value) => {
          if (value && typeof value === 'object') roots.push(value);
        };

        pushRoot(window.__INITIAL_STATE__);
        pushRoot(window.__ICE_APP_CONTEXT__);
        pushRoot(window.__APP_DATA__);
        pushRoot(window.__NEXT_DATA__);
        pushRoot(window.g_config);

        try {
          for (let i = 0; i < window.localStorage.length; i += 1) {
            const key = window.localStorage.key(i);
            if (!key) continue;
            const raw = window.localStorage.getItem(key);
            if (!raw) continue;
            const text = raw.trim();
            if (!text || (text[0] !== '{' && text[0] !== '[')) continue;
            try { const parsed = JSON.parse(text); pushRoot(parsed); } catch { /* ignore */ }
          }
        } catch { /* ignore */ }

        const visited = new Set();
        const queue = roots.slice(0, 120);
        let bestNick = '';
        let bestAvatar = '';
        let bestUid = '';
        let bestScore = -1;

        while (queue.length && visited.size < 5000) {
          const current = queue.shift();
          if (!current || typeof current !== 'object' || visited.has(current)) continue;
          visited.add(current);

          if (Array.isArray(current)) {
            for (const item of current) {
              if (item && typeof item === 'object') queue.push(item);
            }
            continue;
          }

          let nick = '';
          let avatar = '';
          let uid = '';

          for (const key in current) {
            if (!Object.prototype.hasOwnProperty.call(current, key)) continue;
            const value = current[key];
            const lower = key.toLowerCase();

            if (!nick && /nick|nickname|displayname|user.?name|name/.test(lower)) {
              const text = pick(value);
              if (text && text.length <= 40 && text !== '\u95F2\u9C7C') nick = text;
            }

            if (!avatar && /avatar|head|icon|portrait|image|pic/.test(lower)) {
              const url = toAbsolute(value);
              if (url) avatar = url;
            }

            if (!uid && /uid|user.?id|member.?id|account.?id|unb/.test(lower)) {
              const text = pick(value);
              if (text && text.length <= 64) uid = text;
            }

            if (value && typeof value === 'object') queue.push(value);
          }

          const score = (nick ? 3 : 0) + (avatar ? 5 : 0) + (uid ? 2 : 0) + (nick && avatar ? 2 : 0) + (avatar && /avatar|head|portrait|icon/i.test(avatar) ? 1 : 0);
          if (score > bestScore) {
            bestScore = score;
            bestNick = nick || bestNick;
            bestAvatar = avatar || bestAvatar;
            bestUid = uid || bestUid;
          }
        }

        if (!bestAvatar) {
          const imgs = Array.from(document.querySelectorAll('img'));
          for (const img of imgs) {
            const cls = String(img.className || '').toLowerCase();
            const src = toAbsolute(img.getAttribute('src') || '');
            if (!src) continue;
            if (/avatar|head|portrait|user/.test(cls) || /avatar|head|portrait|user/.test(src)) {
              bestAvatar = src;
              break;
            }
          }
        }

        if (!bestNick) {
          const selectors = ['[class*="nickname"]', '[class*="nick"]', '[class*="user-name"]', '[class*="username"]', '[data-nick]', '[data-user-name]'];
          for (const selector of selectors) {
            const node = document.querySelector(selector);
            const text = pick(node && node.textContent);
            if (text && text.length <= 40 && text !== '\u95F2\u9C7C') { bestNick = text; break; }
          }
        }

        if (!bestNick) {
          const title = pick(document.title || '');
          if (title) {
            const cleaned = title.replace(/\u95F2\u9C7C|\u54B8\u9C7C|\u4E3B\u9875|\u4E2A\u4EBA\u4E2D\u5FC3|\u6211\u7684| - .*/g, '').trim();
            if (cleaned && cleaned.length <= 40) bestNick = cleaned;
          }
        }

        if (!bestUid) bestUid = readCookie('unb');
        if (!bestNick) bestNick = readCookie('tracknick') || readCookie('tracknick_enc');

        result.uid = pick(bestUid);
        result.nickname = pick(bestNick);
        result.avatar = toAbsolute(bestAvatar);
        return result;
      })()`

      const profile = (await Promise.race([
        win.webContents.executeJavaScript(script, true),
        this.wait(PROFILE_SNAPSHOT_TIMEOUT_MS).then(() => null),
      ])) as unknown

      const result = this.normalizePageProfile(profile)
      console.debug("[xianyu] captureProfileFromLoginWindow result:", JSON.stringify(result))
      return result
    } catch (error) {
      console.warn("[xianyu] captureProfileFromLoginWindow failed:", error)
      return { uid: "", nickname: "", avatar: "" }
    }
  }

  private async captureProfileFromPersonalPage(win: BrowserWindow, uid: string): Promise<XianyuPageProfile> {
    try {
      if (win.isDestroyed() || !uid) return { uid: "", nickname: "", avatar: "" }

      const personalUrl = `https://www.goofish.com/personal?userId=${encodeURIComponent(uid)}`
      console.debug("[xianyu] navigating to personal page:", personalUrl)
      await win.loadURL(personalUrl)
      await this.wait(PERSONAL_PAGE_PROFILE_WAIT_MS)
      const result = await this.captureProfileFromLoginWindow(win)
      console.debug("[xianyu] personal page profile:", JSON.stringify(result))
      return result
    } catch (error) {
      console.warn("[xianyu] captureProfileFromPersonalPage failed:", error)
      return { uid: "", nickname: "", avatar: "" }
    }
  }

  private extractAccountInfo(cookies: Cookie[], profile?: XianyuPageProfile): XianyuAccountInfo {
    const cookieMap = new Map<string, string>()
    for (const cookie of cookies) {
      cookieMap.set(cookie.name, String(cookie.value || ""))
    }

    const cookieUid = cookieMap.get("unb") || cookieMap.get("tracknick_enc") || cookieMap.get("tracknick") || ""
    const nicknameRaw = cookieMap.get("tracknick") || cookieMap.get("tracknick_enc") || cookieUid || ""
    const nickname = safeDecodeURIComponent(nicknameRaw)
    const normalizedProfile = this.normalizePageProfile(profile)
    const uid = normalizedProfile.uid || cookieUid
    const nicknameText = normalizedProfile.nickname || nickname
    const avatar = normalizedProfile.avatar || this.buildUserAvatarUrl(uid || cookieUid)

    console.debug(
      "[xianyu] extractAccountInfo:",
      JSON.stringify({ uid: uid.trim(), nickname: nicknameText.trim(), avatar: avatar.trim() }),
      "cookie_unb:",
      cookieMap.get("unb"),
      "cookie_tracknick:",
      cookieMap.get("tracknick"),
      "profile:",
      JSON.stringify(normalizedProfile),
    )

    return {
      uid: uid.trim(),
      account: uid.trim(),
      nickname: nicknameText.trim() || uid.trim(),
      avatar: avatar.trim(),
    }
  }

  async detectLogin(cookies: Cookie[]): Promise<boolean> {
    const silentCheck = await this.checkLoginBySilentApi(cookies).catch(() => null)
    if (silentCheck !== null) return silentCheck
    return hasLoginCookie(cookies)
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
    return { success: false, error: "闲鱼暂未接入发布能力" }
  }

  async getPublishHistory(_accountId: string): Promise<PublishRecord[]> {
    return []
  }

  async getAccountStats(_accountId: string): Promise<AccountStats> {
    return { followers: 0, following: 0, totalPosts: 0, totalLikes: 0, updatedAt: Date.now() }
  }
}
