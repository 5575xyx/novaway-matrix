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

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

export class XhsPlatform extends PlatformBase {
  readonly id = "xhs"
  readonly name = "小红书"
  readonly loginUrl = "https://creator.xiaohongshu.com/"
  readonly cookieCheckField = "access-token"

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

      const userInfo = await this.getUserInfo(result.cookies)
      const loginCookie = JSON.stringify(result.cookies)

      return {
        loginCookie,
        uid: userInfo.platformUserId,
        nickname: userInfo.nickname,
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
      const userInfo = await this.getUserInfo(newCookies)

      if (authModel === "login") {
        const win = BrowserWindow.fromId(winContentsId)
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

  async getUserInfo(cookies: Cookie[]): Promise<PlatformAccountInfo> {
    const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join("; ")

    let userData: any = {}
    let fansData: any = {}

    try {
      const res = await fetch(this.getUserInfoUrl, {
        headers: {
          Cookie: cookieStr,
          Referer: this.loginUrl,
        },
      })
      if (res.ok) userData = await res.json()
    } catch {
      // ignore
    }

    try {
      const res = await fetch(this.getFansInfoUrl, {
        headers: {
          Cookie: cookieStr,
          Referer: this.loginUrl,
        },
      })
      if (res.ok) fansData = await res.json()
    } catch {
      // ignore
    }

    return {
      platformUserId: userData.data?.user_id || "",
      nickname: userData.data?.nickname || "",
      avatar: userData.data?.imageb || "",
      fansCount: fansData.data?.fans_count || 0,
    }
  }

  async detectLogin(cookies: Cookie[]): Promise<boolean> {
    try {
      const info = await this.getUserInfo(cookies)
      return !!info.platformUserId
    } catch {
      return false
    }
  }

  async getAccountInfo(cookies: Cookie[]): Promise<PlatformAccountInfo> {
    return this.getUserInfo(cookies)
  }

  async publish(input: PublishInput, cookies: Cookie[]): Promise<PublishResult> {
    const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join("; ")
    try {
      const endpoint = "https://edith.xiaohongshu.com/web_api/sns/v2/note"
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Cookie: cookieStr,
          "Content-Type": "application/json",
          Referer: this.loginUrl,
          Origin: this.loginUrl,
        },
        body: JSON.stringify({
          title: input.title,
          desc: input.description,
          tags: input.tags,
          filePaths: input.filePaths,
        }),
      })
      const data = await res.json()
      if (data.success) {
        return { success: true, platformPostId: data.data?.id, url: data.data?.url }
      }
      return { success: false, error: data.msg || "发布失败" }
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
