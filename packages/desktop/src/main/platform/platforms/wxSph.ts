import { BrowserWindow, screen, session } from "electron"
import type { Cookie } from "electron"
import { PlatformBase, type PlatformLoginResult, type PublishInput, type PublishResult, type PlatformAccountInfo, type AccountStats, type PublishRecord } from "../PlatformBase"

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

function convertCookieToJson(cookies: any): string {
  let arr: Cookie[]
  if (typeof cookies === "string") {
    try { arr = JSON.parse(cookies) } catch { return cookies }
  } else if (Array.isArray(cookies)) { arr = cookies } else { return "" }
  return arr.map((c) => `${c.name}=${c.value}`).join("; ")
}

export class WxSphPlatform extends PlatformBase {
  readonly id = "wxSph"
  readonly name = "微信视频号"
  readonly loginUrl = "https://channels.weixin.qq.com"
  readonly cookieCheckField = "sessionid"

  private defaultUserAgent = DEFAULT_USER_AGENT
  private getUserInfoUrl = "https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/auth/auth_data"
  private cookieIntervalList: Record<number, NodeJS.Timeout> = {}
  private windowMap: Record<number, BrowserWindow> = {}

  async login(): Promise<{ loginCookie: string; uid: string; nickname: string; avatar: string; fansCount: number } | null> {
    try {
      const { success, data, error } = await this.execLoginOrView("login")
      if (!success || !data) {
        console.log("Login process failed:", error)
        return null
      }

      const userInfo = await this.getUserInfo(data.cookie)
      const loginCookie = typeof data.cookie === "string" ? data.cookie : JSON.stringify(data.cookie)

      return {
        loginCookie,
        uid: userInfo.authorId,
        nickname: userInfo.nickname,
        avatar: userInfo.avatar,
        fansCount: userInfo.fansCount || 0,
      }
    } catch (error) {
      console.error("Login process failed:", error)
      return null
    }
  }

  private async execLoginOrView(
    authModel: "login" | "view",
    cookies?: any,
  ): Promise<{ success: boolean; data?: { cookie: any; userInfo: any }; error?: string }> {
    try {
      const winRes = await this.createAuthorizationWindow(authModel === "view" ? cookies : null)
      const { winContentsId, partition } = winRes
      const newCookies = await this.filterCookie(winContentsId, partition)
      const userInfo = await this.getUserInfo(newCookies)

      if (authModel === "login") {
        const win = this.windowMap[winContentsId]
        if (win && !win.isDestroyed()) {
          win.webContents.removeAllListeners()
          win.destroy()
          delete this.windowMap[winContentsId]
        }
      }

      return {
        success: true,
        data: { cookie: newCookies, userInfo },
      }
    } catch (e) {
      return { success: false, error: "获取失败" }
    }
  }

  private async createAuthorizationWindow(cookies: any = null): Promise<{ winContentsId: number; partition: string }> {
    return new Promise<{ winContentsId: number; partition: string }>(async (resolve, reject) => {
      try {
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

        const winContentsId = win.webContents.id
        this.windowMap[winContentsId] = win

        if (cookies) {
          try {
            const loginStatus = await this.checkLoginStatus(cookies)
            if (loginStatus) {
              const cookiesObj = typeof cookies === "string" ? JSON.parse(cookies) : cookies
              for (const cookie of cookiesObj) {
                await session.fromPartition(partition).cookies.set({
                  url: this.loginUrl,
                  name: cookie.name,
                  value: cookie.value,
                  domain: cookie.domain,
                  path: cookie.path,
                })
              }
            }
          } catch (err) {
            console.error("Set cookies error:", err)
          }
        }

        win.webContents.setUserAgent(this.defaultUserAgent)

        win.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
          console.error("Page failed to load:", errorDescription)
          if (errorCode === -3) return
          reject(new Error(`Failed to load page: ${errorDescription}`))
        })

        win.once("ready-to-show", () => {
          win.focus()
          win.center()
          win.setAlwaysOnTop(true)
          win.setAlwaysOnTop(false)
        })

        win.webContents.on("destroyed", () => {
          if (Object.prototype.hasOwnProperty.call(this.cookieIntervalList, winContentsId)) {
            clearInterval(this.cookieIntervalList[winContentsId])
            delete this.cookieIntervalList[winContentsId]
          }
          delete this.windowMap[winContentsId]
        })

        let isResolved = false

        win.webContents.on("did-finish-load", () => {
          if (!isResolved) {
            isResolved = true
            resolve({ winContentsId, partition })
          }
        })

        try {
          win.loadURL(this.loginUrl, {
            userAgent: this.defaultUserAgent,
            httpReferrer: "https://channels.weixin.qq.com",
          })

          setTimeout(() => {
            if (!isResolved) {
              isResolved = true
              resolve({ winContentsId, partition })
            }
          }, 5000)
        } catch (err: any) {
          console.error("Load URL error:", err)
          if (err.code !== -3 && !isResolved) reject(err)
        }
      } catch (err: any) {
        console.error("Create window error:", err)
        reject(err)
      }
    })
  }

  async checkLoginStatus(cookies: string): Promise<boolean> {
    const cookieString = convertCookieToJson(cookies)
    try {
      const res = await this.makeRequest(
        this.getUserInfoUrl,
        {
          method: "POST",
          headers: {
            Origin: "https://channels.weixin.qq.com",
            Referer: "https://channels.weixin.qq.com/platform",
            Cookie: cookieString,
          },
        },
      )
      if (res.errCode === 0) return true
      throw new Error(res.data?.errMsg ?? "未知错误")
    } catch (err) {
      console.error("检查登录状态失败:", err)
      throw err
    }
  }

  private async filterCookie(winContentsId: number, partition: string): Promise<Cookie[]> {
    return new Promise((resolve, reject) => {
      this.windowMap[winContentsId].webContents.on("did-navigate", async () => {
        try {
          const cookies = await this.windowMap[winContentsId].webContents.session.cookies.get({})
          const alreadyLogin = cookies.some((item) => item.name.includes(this.cookieCheckField) && item.value !== "")
          if (alreadyLogin) {
            if (Object.prototype.hasOwnProperty.call(this.cookieIntervalList, winContentsId)) {
              clearInterval(this.cookieIntervalList[winContentsId])
              delete this.cookieIntervalList[winContentsId]
            }
            resolve(cookies)
          }
        } catch (error) {
          console.error(error)
          reject("获取网站cookie失败")
        }
      })
    })
  }

  async getUserInfo(cookies: Cookie[]): Promise<{ authorId: string; nickname: string; avatar: string; fansCount: number }> {
    const cookieString = convertCookieToJson(cookies)
    const res = await this.makeRequest(
      this.getUserInfoUrl,
      {
        method: "POST",
        headers: {
          Origin: "https://channels.weixin.qq.com",
          Referer: "https://channels.weixin.qq.com/platform",
          Cookie: cookieString,
        },
      },
    )
    if (res.errCode === 0) {
      return {
        authorId: res.data.finderUser.uniqId ?? "",
        nickname: res.data.finderUser.nickname ?? "",
        avatar: res.data.finderUser.headImgUrl ?? "",
        fansCount: res.data.finderUser.fansCount ?? 0,
      }
    }
    throw new Error(res.data?.errMsg ?? "未知错误")
  }

  private async makeRequest(url: string, options: { method: string; headers: Record<string, string> }): Promise<any> {
    const res = await fetch(url, {
      method: options.method,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
      ...(options.method === "POST" ? { body: "{}" } : {}),
    })
    return await res.json()
  }

  // ---- PlatformBase 接口实现 ----

  async loginOrView(authModel: "login" | "view", existingCookies?: Cookie[] | null): Promise<PlatformLoginResult> {
    const result = await this.execLoginOrView(authModel, existingCookies)
    if (!result.success || !result.data) {
      return { success: false, error: result.error }
    }
    return {
      success: true,
      cookies: result.data.cookie,
      userInfo: {
        nickname: result.data.userInfo.nickname,
        avatar: result.data.userInfo.avatar,
        platformUserId: result.data.userInfo.authorId,
        fansCount: result.data.userInfo.fansCount,
      },
    }
  }

  async detectLogin(cookies: Cookie[]): Promise<boolean> {
    try {
      const info = await this.getUserInfo(cookies)
      return !!info.authorId
    } catch {
      return false
    }
  }

  async getAccountInfo(cookies: Cookie[]): Promise<PlatformAccountInfo> {
    const info = await this.getUserInfo(cookies)
    return {
      platformUserId: info.authorId,
      nickname: info.nickname,
      avatar: info.avatar,
      fansCount: info.fansCount,
    }
  }

  async publish(_input: PublishInput, _cookies: Cookie[]): Promise<PublishResult> {
    return { success: false, error: "视频号暂未接入发布能力" }
  }

  async getPublishHistory(_accountId: string): Promise<PublishRecord[]> {
    return []
  }

  async getAccountStats(_accountId: string): Promise<AccountStats> {
    return { followers: 0, following: 0, totalPosts: 0, totalLikes: 0, updatedAt: Date.now() }
  }
}
