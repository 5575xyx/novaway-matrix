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
import { requestJson, PLATFORM_USER_AGENT } from "../request"
import { capturePageProfile, type PageProfile } from "../profile-capture"

const DEFAULT_USER_AGENT = PLATFORM_USER_AGENT

/** 创作者中心首页右上角的账号区（不同版本类名不同，按优先级试）。 */
const XHS_CAPTURE_HINTS = {
  nicknameSelectors: [".user-info .name", ".user-name", ".header-user .name", ".account-info .name"],
  avatarSelectors: [".user-info img.avatar", ".user-avatar img", ".header-user img", ".account-info img"],
}

export class XhsPlatform extends PlatformBase {
  readonly id = "xhs"
  readonly name = "小红书"
  readonly loginUrl = "https://creator.xiaohongshu.com/"
  readonly cookieCheckField = "access-token"
  readonly profileUrl = "https://creator.xiaohongshu.com/new/home"
  readonly profileHints = XHS_CAPTURE_HINTS

  private defaultUserAgent = DEFAULT_USER_AGENT
  private loginUrlHome = "https://www.xiaohongshu.com/"
  private getUserInfoUrl = "https://edith.xiaohongshu.com/api/sns/web/v2/user/me"
  private getFansInfoUrl = "https://creator.xiaohongshu.com/api/galaxy/creator/home/personal_info"
  private cookieIntervalList: Record<string, NodeJS.Timeout> = {}
  private prevWebSession = ""
  private win?: BrowserWindow

  async login(): Promise<{
    loginCookie: string
    uid: string
    nickname: string
    avatar: string
    fansCount: number
  } | null> {
    try {
      const result = await this.loginOrView("login")
      if (!result.success || !result.cookies) return null

      const userInfo = result.userInfo
      // 身份拿不到就别建记录：空 uid 会在账号列表里留下一条"登录了但没有名字"的僵尸账号，
      // 而且下次 addOrUpdateAccount 会按空 uid 匹配到别的账号上。
      if (!userInfo?.platformUserId) {
        console.warn("[xhs] login succeeded but profile is empty")
        return null
      }

      return {
        loginCookie: JSON.stringify(result.cookies),
        uid: userInfo.platformUserId,
        nickname: userInfo.nickname || userInfo.platformUserId,
        avatar: userInfo.avatar,
        fansCount: userInfo.fansCount || 0,
      }
    } catch (error) {
      console.error("Login process failed:", error)
      return null
    }
  }

  async loginOrView(authModel: "login" | "view", existingCookies?: Cookie[] | null): Promise<PlatformLoginResult> {
    try {
      const winRes = await this.createAuthorizationWindow(authModel === "view" ? existingCookies || null : null)
      const { winContentsId, partition } = winRes
      const newCookies = await this.filterCookie(winContentsId, partition)
      // 登录窗口此刻停在创作者中心首页：先从页面抓一份资料（页面一定渲染了昵称头像），
      // 再用接口补粉丝数等指标。接口被风控拒绝时页面这份就是唯一来源。
      const win = BrowserWindow.fromId(winContentsId)
      const page = win ? await capturePageProfile(win, XHS_CAPTURE_HINTS) : undefined
      const userInfo = await this.getUserInfo(newCookies, page)

      if (authModel === "login") {
        if (win && !win.isDestroyed()) win.close()
        this.prevWebSession = ""
      }

      return {
        success: true,
        cookies: newCookies,
        userInfo,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "登录失败",
      }
    }
  }

  private async createAuthorizationWindow(
    _existingCookies?: Cookie[] | null,
  ): Promise<{ winContentsId: number; partition: string }> {
    const partition = Date.now().toString()
    const { width, height } = screen.getPrimaryDisplay().workAreaSize

    const win = new BrowserWindow({
      width: Math.ceil(width * 0.8),
      height: Math.ceil(height * 0.8),
      show: false,
      webPreferences: {
        contextIsolation: false,
        nodeIntegration: false,
        partition,
      },
    })
    win.show()
    win.webContents.setUserAgent(this.defaultUserAgent)
    this.prevWebSession = ""

    await win.loadURL(this.loginUrlHome)
    this.win = win

    return {
      winContentsId: win.id,
      partition,
    }
  }

  private filterCookie(winContentsId: number, partition: string): Promise<Cookie[]> {
    return new Promise((resolve, reject) => {
      this.cookieIntervalList[winContentsId] = setInterval(async () => {
        try {
          if (this.win!.webContents.getURL().includes(this.loginUrlHome)) {
            const cookies2 = await session.fromPartition(partition).cookies.get({ url: this.loginUrlHome })
            const webSession = cookies2.find((c) => c.name === "web_session")
            if (!this.prevWebSession) {
              this.prevWebSession = webSession?.value || ""
            }
            if (this.prevWebSession === (webSession?.value || "")) return
            await this.win!.loadURL(this.loginUrl + "login?source=official")
          } else if (this.win!.webContents.getURL().includes(this.loginUrl)) {
            const cookies1 = await session.fromPartition(partition).cookies.get({ url: this.loginUrl })
            const cookies2 = await session.fromPartition(partition).cookies.get({ url: this.loginUrlHome })
            const cookies = cookies1.concat(cookies2)
            const alreadyLogin = cookies1.some((c) => c.name.includes(this.cookieCheckField))
            if (alreadyLogin) {
              if (this.cookieIntervalList[winContentsId]) {
                clearInterval(this.cookieIntervalList[winContentsId])
                delete this.cookieIntervalList[winContentsId]
              }
              resolve(cookies)
            }
          }
        } catch (error) {
          if (this.cookieIntervalList[winContentsId]) {
            clearInterval(this.cookieIntervalList[winContentsId])
            delete this.cookieIntervalList[winContentsId]
          }
          console.error("Failed to get cookies:", error)
          reject(new Error("Failed to get website cookies"))
        }
      }, 1500)
    })
  }

  private clearCookieInterval(winContentsId: number) {
    if (this.cookieIntervalList[winContentsId]) {
      clearInterval(this.cookieIntervalList[winContentsId])
      delete this.cookieIntervalList[winContentsId]
    }
  }

  private clearCookieIntervals() {
    for (const key of Object.keys(this.cookieIntervalList)) {
      this.clearCookieInterval(Number(key))
    }
  }

  async getUserInfo(cookies: Cookie[], page?: PageProfile): Promise<PlatformAccountInfo> {
    const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join("; ")

    let userData: any = {}
    let fansData: any = {}

    try {
      // 走 Electron net（Chromium 栈）：Node 的原生 fetch 会被 edith 直接 406。
      const res = await requestJson(this.getUserInfoUrl, {
        headers: {
          Cookie: cookieStr,
          Referer: this.loginUrlHome,
        },
      })
      if (res.ok) userData = res.data || {}
    } catch {
      // 接口失败不是致命问题：页面抓取那份还能用
    }

    try {
      const res = await requestJson(this.getFansInfoUrl, {
        headers: {
          Cookie: cookieStr,
          Referer: this.loginUrl,
        },
      })
      if (res.ok) fansData = res.data || {}
    } catch {
      // ignore
    }

    // 页面 > 接口：页面上是用户此刻真正登录的那个账号，接口可能因为风控返回空。
    return {
      platformUserId: userData.data?.user_id || page?.uid || "",
      nickname: userData.data?.nickname || page?.nickname || "",
      avatar: userData.data?.imageb || page?.avatar || "",
      fansCount: fansData.data?.fans_count || 0,
    }
  }

  async detectLogin(cookies: Cookie[]): Promise<boolean> {
    try {
      const info = await this.getUserInfo(cookies)
      if (info.platformUserId) return true
    } catch {
      /* 接口被风控时继续走页面兜底 */
    }
    // edith 接口按指纹拒绝请求（406）时，登录状态其实是好的。
    // 这时用登录态页面确认一次：页面上能看到 uid 或头像才算已登录，
    // 只有标题/占位文案不算（未登录会跳登录页，那里没有这两样）。
    const page = await this.captureProfileFromPage(cookies).catch(() => null)
    return !!(page?.platformUserId || page?.avatar)
  }

  async getAccountInfo(cookies: Cookie[]): Promise<PlatformAccountInfo> {
    return this.getUserInfo(cookies)
  }

  async publish(input: PublishInput, cookies: Cookie[]): Promise<PublishResult> {
    const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join("; ")
    try {
      const endpoint = "https://edith.xiaohongshu.com/web_api/sns/v2/note"
      const res = await requestJson(endpoint, {
        method: "POST",
        headers: {
          Cookie: cookieStr,
          "Content-Type": "application/json",
          Referer: this.loginUrl,
          Origin: this.loginUrl,
        },
        body: {
          title: input.title,
          desc: input.description,
          tags: input.tags,
          filePaths: input.filePaths,
        },
      })
      const data = res.data as any
      if (data?.success) {
        return { success: true, platformPostId: data.data?.id, url: data.data?.url }
      }
      return { success: false, error: data?.msg || `发布失败（HTTP ${res.status}）` }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }

  async getPublishHistory(accountId: string): Promise<PublishRecord[]> {
    return []
  }

  async getAccountStats(accountId: string): Promise<AccountStats> {
    return { followers: 0, following: 0, totalPosts: 0, totalLikes: 0, updatedAt: Date.now() }
  }
}
