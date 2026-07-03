import { readFileSync } from "node:fs"
import { BrowserWindow, screen, session } from "electron"
import type { Cookie } from "electron"
import { PlatformBase, type PlatformLoginResult, type PublishInput, type PublishResult, type PlatformAccountInfo, type AccountStats, type PublishRecord } from "../PlatformBase"

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

function waitFor(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function convertCookieToJson(cookies: any): string {
  let arr: Cookie[]
  if (typeof cookies === "string") {
    try {
      arr = JSON.parse(cookies)
    } catch {
      return cookies
    }
  } else if (Array.isArray(cookies)) {
    arr = cookies
  } else {
    return ""
  }
  return arr.map((c) => `${c.name}=${c.value}`).join("; ")
}

export class DouyinPlatform extends PlatformBase {
  readonly id = "douyin"
  readonly name = "抖音"
  readonly loginUrl = "https://creator.douyin.com/"
  readonly cookieCheckField = "sessionid"

  private defaultUserAgent = DEFAULT_USER_AGENT
  private getUserInfoUrl = "https://creator.douyin.com/web/api/media/user/info/"
  private cookieSecUidCheckField = "x-web-secsdk-uid"
  private cookieIntervalList: Record<number, NodeJS.Timeout> = {}
  private windowMap: Record<number, BrowserWindow> = {}

  /**
   * 登录
   */
  async login(): Promise<{ loginCookie: string; uid: string; nickname: string; avatar: string; fansCount: number } | null> {
    try {
      const { success, data, error } = await this.execServiceLoginOrView("login")
      if (!success || !data) {
        console.log("Login process failed:", error)
        return null
      }

      const userInfo = await this.execGetUserInfo(data.cookie)

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

  /**
   * 授权|预览
   */
  private async execServiceLoginOrView(
    authModel: "login" | "view",
    cookies?: any,
  ): Promise<{
    success: boolean
    data?: { cookie: string; userInfo: any; localStorage: string }
    error?: string
  }> {
    const winRes = await this.createAuthorizationWindow(authModel === "view" ? cookies : null)
    const { winContentsId, partition } = winRes
    try {
      const cookieArr = await this.filterCookie(winContentsId, partition)
      const localStorageStr = await this.filterLocalStorage(winContentsId)
      const userInfo = await this.getUserInfo(cookieArr)

      return {
        success: true,
        data: {
          cookie: JSON.stringify(cookieArr),
          userInfo,
          localStorage: localStorageStr,
        },
      }
    } finally {
      if (authModel === "login") {
        const win = this.windowMap[winContentsId]
        if (win && !win.isDestroyed()) {
          win.webContents.removeAllListeners()
          win.destroy()
          delete this.windowMap[winContentsId]
        }
      }
    }
  }

  /**
   * 创建授权窗口
   */
  private async createAuthorizationWindow(cookies: any = null): Promise<{ winContentsId: number; partition: string }> {
    return new Promise<{ winContentsId: number; partition: string }>(async (resolve) => {
      const partition = Date.now().toString()
      const { width, height } = screen.getPrimaryDisplay().workAreaSize

      const win = new BrowserWindow({
        width: Math.ceil(width * 0.9),
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

      win.loadURL(this.loginUrl, { userAgent: this.defaultUserAgent })

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

      win.webContents.on("did-finish-load", async () => {
        if (win.webContents.getURL() === this.loginUrl) {
          let checkEleNum = 0
          while (true) {
            if (checkEleNum >= 10) break
            if (!win || win.isDestroyed()) break

            const hasEle = await win.webContents.executeJavaScript(`
              (function() {
                return document.querySelector('.dux-icon-14') !== null;
              })()
            `)

            if (hasEle) {
              await win.webContents.executeJavaScript(`
                (function() {
                  document.querySelector('.dux-icon-14').parentElement.parentElement.style.display = 'none';
                })()
              `)
              break
            }
            checkEleNum++
            await waitFor(1000)
          }
          resolve({ winContentsId, partition })
        }
      })
    })
  }

  /**
   * 检查用户登录是否过期
   */
  async checkLoginStatus(cookies: string): Promise<boolean> {
    const cookieString = convertCookieToJson(cookies)
    try {
      const res = await this.makeRequest(
        this.getUserInfoUrl,
        {
          method: "GET",
          headers: { Cookie: cookieString },
        },
      )

      if (res.status_code !== 0) {
        throw new Error(res.status_msg ?? "未知错误")
      }
      return true
    } catch (err) {
      console.error("检查登录状态失败:", err)
      throw err
    }
  }

  /**
   * 获取网站登录cookie
   */
  private async filterCookie(winContentsId: number, partition: string): Promise<Electron.Cookie[]> {
    return new Promise((resolve, reject) => {
      this.cookieIntervalList[winContentsId] = setInterval(async () => {
        try {
          const cookies = await session.fromPartition(partition).cookies.get({})

          const alreadyLogin = cookies.some((item) => item.name.includes(this.cookieCheckField))
          const hasSecUid = cookies.some((item) => item.name.includes(this.cookieSecUidCheckField))

          if (alreadyLogin && hasSecUid) {
            if (Object.prototype.hasOwnProperty.call(this.cookieIntervalList, winContentsId)) {
              clearInterval(this.cookieIntervalList[winContentsId])
              delete this.cookieIntervalList[winContentsId]
            }
            resolve(cookies)
          }
        } catch (err) {
          console.error("获取cookie失败:", err)
          reject("获取网站cookie失败")
        }
      }, 3000)
    })
  }

  /**
   * 获取私钥等信息
   */
  private async filterLocalStorage(winContentsId: number): Promise<string> {
    let win = this.windowMap[winContentsId]

    if (!win) {
      win = BrowserWindow.fromId(winContentsId) as BrowserWindow
    }

    if (!win || win.isDestroyed()) {
      throw new Error("找不到有效的窗口")
    }

    let retryCount = 0
    const maxRetries = 10

    while (retryCount < maxRetries) {
      if (!win || win.isDestroyed()) {
        throw new Error("窗口已被销毁")
      }

      try {
        const hasLocalStorage = await win.webContents.executeJavaScript(`
          (function() {
            return window.localStorage['security-sdk/s_sdk_crypt_sdk'] !== undefined && 
                   window.localStorage['security-sdk/s_sdk_sign_data_key/web_protect'] !== undefined;
          })()
        `)

        if (hasLocalStorage) {
          const privateKey = await win.webContents.executeJavaScript(`
            (function() {
              try {
                const sdkData = window.localStorage['security-sdk/s_sdk_crypt_sdk'];
                const parsedData = JSON.parse(sdkData);
                const parsedInnerData = JSON.parse(parsedData.data);
                return parsedInnerData.ec_privateKey;
              } catch (e) {
                return null;
              }
            })()
          `)

          const webProtect = await win.webContents.executeJavaScript(`
            (function() {
              try {
                const protectData = window.localStorage['security-sdk/s_sdk_sign_data_key/web_protect'];
                const parsedData = JSON.parse(protectData);
                return parsedData.data;
              } catch (e) {
                return null;
              }
            })()
          `)

          if (!privateKey || !webProtect) {
            throw new Error("获取到的 privateKey 或 webProtect 为空")
          }

          return JSON.stringify({ privateKey, webProtect })
        }
      } catch (err) {
        console.error(`第 ${retryCount + 1} 次尝试获取 localStorage 失败:`, err)
      }

      retryCount++
      await waitFor(1000)
    }

    throw new Error("获取 localStorage 超过最大重试次数")
  }

  /**
   * 获取用户信息
   */
  async getUserInfo(cookies: Cookie[]): Promise<{ uid: string; authorId: string; nickname: string; avatar: string; fansCount: number }> {
    const cookieString = convertCookieToJson(cookies)
    const res = await this.makeRequest(
      this.getUserInfoUrl,
      {
        method: "GET",
        headers: { Cookie: cookieString },
      },
    )

    if (res.status_code === 0) {
      return {
        uid: res.user.sec_uid,
        authorId: res.user.unique_id !== "" ? res.user.unique_id : res.user.uid,
        nickname: res.user.nickname ?? "",
        avatar: res.user.avatar_thumb?.url_list?.[0] ?? "",
        fansCount: res.user.follower_count ?? 0,
      }
    }

    throw new Error(res.status_msg ?? "获取用户信息失败")
  }

  /**
   * 通过cookie字符串获取用户信息（用于login()中的第二次调用）
   */
  private async execGetUserInfo(cookieStr: string): Promise<{ uid: string; authorId: string; nickname: string; avatar: string; fansCount: number }> {
    const cookieString = convertCookieToJson(cookieStr)
    const res = await this.makeRequest(
      this.getUserInfoUrl,
      {
        method: "GET",
        headers: { Cookie: cookieString },
      },
    )

    if (res.status_code === 0) {
      return {
        uid: res.user.sec_uid,
        authorId: res.user.unique_id !== "" ? res.user.unique_id : res.user.uid,
        nickname: res.user.nickname ?? "",
        avatar: res.user.avatar_thumb?.url_list?.[0] ?? "",
        fansCount: res.user.follower_count ?? 0,
      }
    }

    throw new Error(res.status_msg ?? "获取用户信息失败")
  }

  /**
   * 通用请求方法
   */
  private async makeRequest(url: string, options: { method: string; headers: Record<string, string> }): Promise<any> {
    const res = await fetch(url, {
      method: options.method,
      headers: options.headers,
    })
    return await res.json()
  }

  // ---- PlatformBase 接口实现 ----

  async loginOrView(authModel: "login" | "view", existingCookies?: Cookie[] | null): Promise<PlatformLoginResult> {
    try {
      const result = await this.execServiceLoginOrView(authModel, existingCookies)
      if (!result.success || !result.data) {
        return { success: false, error: result.error }
      }

      const cookies: Cookie[] = JSON.parse(result.data.cookie)

      return {
        success: true,
        cookies,
        userInfo: {
          nickname: result.data.userInfo.nickname,
          avatar: result.data.userInfo.avatar,
          platformUserId: result.data.userInfo.authorId,
          fansCount: result.data.userInfo.fansCount,
        },
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "登录失败",
      }
    }
  }

  async detectLogin(cookies: Cookie[]): Promise<boolean> {
    try {
      const info = await this.getAccountInfo(cookies)
      return !!info.platformUserId
    } catch {
      return false
    }
  }

  async getAccountInfo(cookies: Cookie[]): Promise<PlatformAccountInfo> {
    try {
      const info = await this.getUserInfo(cookies)
      return {
        platformUserId: info.authorId,
        nickname: info.nickname,
        avatar: info.avatar,
        fansCount: info.fansCount,
      }
    } catch {
      return { nickname: "", avatar: "", platformUserId: "" }
    }
  }

  async publish(input: PublishInput, cookies: Cookie[]): Promise<PublishResult> {
    const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join("; ")
    try {
      const formData = new FormData()
      formData.append("title", input.title)
      formData.append("description", input.description)
      if (input.filePaths?.length) {
        const fileBuffer = readFileSync(input.filePaths[0])
        formData.append("video", new Blob([fileBuffer]), "video.mp4")
      }

      const res = await fetch("https://creator.douyin.com/web/api/media/aweme/create/", {
        method: "POST",
        headers: {
          Cookie: cookieStr,
          Referer: "https://creator.douyin.com/",
        },
        body: formData,
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
