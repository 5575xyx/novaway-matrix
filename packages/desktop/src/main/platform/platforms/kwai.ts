import { BrowserWindow, screen } from "electron"
import type { Cookie } from "electron"
import requestNet from "../kwai-request-net"
import kwaiSign from "./kwai-sign/KwaiSign"
import {
  PlatformBase,
  type PlatformLoginResult,
  type PublishInput,
  type PublishResult,
  type PlatformAccountInfo,
  type AccountStats,
  type PublishRecord,
} from "../PlatformBase"

const LOGIN_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36 Edg/135.0.0.0"

const KWAI_LOGIN_URL = "https://passport.kuaishou.com/pc/account/login"
const KWAI_CREATOR_PROFILE_URL = "https://cp.kuaishou.com/profile"
const KWAI_AUTH_COOKIE_NAME_SET = new Set(["kuaishou.server.web_st", "kuaishou.server.web_ph", "did", "clientid"])

function cookieToString(cookies: Cookie[]): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ")
}

export class KwaiPlatform extends PlatformBase {
  readonly id = "kwai"
  readonly name = "快手"
  readonly loginUrl = KWAI_LOGIN_URL
  readonly cookieCheckField = "kuaishou.server.web_st"

  private async withTimeout<T>(task: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined
    try {
      return await Promise.race([
        task,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${label} timeout (${timeoutMs}ms)`)), timeoutMs)
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  async login(): Promise<{
    loginCookie: string
    uid: string
    nickname: string
    avatar: string
    fansCount: number
  } | null> {
    const req = await this.serviceLogin().catch(() => null)
    if (!req) return null

    const userInfo = await this.formatUserInfo(req.userInfo, req.cookies)
    if (!userInfo) return null

    userInfo.loginCookie = JSON.stringify(req.cookies)
    return userInfo
  }

  private async serviceLogin(): Promise<{ cookies: Cookie[]; userInfo: any } | null> {
    return new Promise(async (resolve, reject) => {
      const partition = `persist:kwai-login-${Date.now()}`
      const { width, height } = screen.getPrimaryDisplay().workAreaSize
      const mainWindow = new BrowserWindow({
        width: Math.ceil(width * 0.8),
        height: Math.ceil(height * 0.8),
        webPreferences: {
          contextIsolation: false,
          nodeIntegration: false,
          partition,
        },
      })
      mainWindow.webContents.setUserAgent(LOGIN_USER_AGENT)

      let resolved = false
      let checkingLogin = false
      let didNavigateCreatorProfile = false

      const done = (fn: () => void) => {
        if (resolved) return
        resolved = true
        clearInterval(pollTimer)
        clearTimeout(timeoutTimer)
        try {
          mainWindow.close()
        } catch {
          /* ignore */
        }
        fn()
      }

      mainWindow.on("closed", () => {
        clearInterval(pollTimer)
        clearTimeout(timeoutTimer)
        if (!resolved) reject(new Error("kwai login window closed"))
      })

      await mainWindow.loadURL(KWAI_LOGIN_URL)
      await mainWindow.webContents.session.clearCache()

      const timeoutTimer = setTimeout(() => {
        done(() => reject(new Error("kwai login timeout")))
      }, 180000)

      const tryResolveLogin = async () => {
        if (checkingLogin || resolved || mainWindow.isDestroyed()) return
        checkingLogin = true
        try {
          const cookies = await mainWindow.webContents.session.cookies.get({})
          if (!cookies.length) return

          const hasAuthCookie = cookies.some(
            (cookie) => KWAI_AUTH_COOKIE_NAME_SET.has(cookie.name) && String(cookie.value || "").trim(),
          )
          const hasApiPhCookie = cookies.some(
            (cookie) => cookie.name === "kuaishou.web.cp.api_ph" && String(cookie.value || "").trim(),
          )

          if (hasAuthCookie && !hasApiPhCookie && !didNavigateCreatorProfile) {
            didNavigateCreatorProfile = true
            await mainWindow.loadURL(KWAI_CREATOR_PROFILE_URL).catch(() => {})
            return
          }

          const userInfoReq = await this.withTimeout(
            this.serviceGetAccountInfo(cookies),
            10000,
            "kwai getAccountInfo",
          ).catch(() => null)
          const gqlUserInfo = (userInfoReq as any)?.data?.data?.userInfo
          const gqlUserId = gqlUserInfo?.userId ?? gqlUserInfo?.id ?? gqlUserInfo?.eid
          if (userInfoReq?.status === 200 && gqlUserId) {
            done(() => {
              resolve({ cookies, userInfo: userInfoReq })
            })
            return
          }

          const homeInfoReq = await this.withTimeout(this.serviceGetHomeInfo(cookies), 10000, "kwai getHomeInfo").catch(
            () => null,
          )
          const fallbackUserId = homeInfoReq?.data?.data?.userId
          if (homeInfoReq?.status === 200 && fallbackUserId) {
            done(() => {
              resolve({
                cookies,
                userInfo: {
                  status: 200,
                  headers: homeInfoReq.headers,
                  data: {
                    data: {
                      userInfo: {
                        avatar: "",
                        eid: `${fallbackUserId}`,
                        id: `${fallbackUserId}`,
                        name: homeInfoReq?.data?.data?.userName || "",
                        userId: fallbackUserId,
                        __typename: "UserInfo",
                      },
                    },
                  },
                },
              })
            })
            return
          }
        } finally {
          checkingLogin = false
        }
      }

      const pollTimer = setInterval(() => {
        void tryResolveLogin()
      }, 800)
      void tryResolveLogin()
    })
  }

  private async requestApi(params: {
    cookie: Cookie[]
    url?: string
    apiUrl?: string
    method: string
    body?: any
    headers?: Record<string, string>
  }): Promise<any> {
    const { cookie, apiUrl = "https://cp.kuaishou.com" } = params

    const apiPhCookie = cookie.find((v) => v.name === "kuaishou.web.cp.api_ph")
    const apiPh = apiPhCookie?.value || ""

    const finalBody =
      params.method === "POST" ? { ...(params.body || {}), "kuaishou.web.cp.api_ph": apiPh } : params.body

    const finalHeaders: Record<string, string | string[]> = {
      ...(params.headers || {}),
      cookie: cookieToString(cookie),
    }

    let targetUrl = `${apiUrl}${params.url || ""}`

    if (apiUrl === "https://cp.kuaishou.com") {
      try {
        const signUrl = await kwaiSign.sign({
          json: finalBody || { "kuaishou.web.cp.api_ph": apiPh },
          type: "json",
          url: targetUrl,
        })
        targetUrl = String(signUrl)
      } catch {
        // fallback to unsigned url
      }
    }

    return await requestNet({
      url: targetUrl,
      method: params.method as "GET" | "POST" | "PUT" | "DELETE",
      headers: finalHeaders,
      body: finalBody,
    })
  }

  private async serviceGetAccountInfo(cookie: Cookie[]) {
    return await this.requestApi({
      cookie,
      method: "POST",
      apiUrl: "https://www.kuaishou.com/graphql",
      headers: {
        Origin: "https://cp.kuaishou.com",
        Referer: KWAI_CREATOR_PROFILE_URL,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
      },
      body: {
        operationName: "userInfoQuery",
        variables: {},
        query:
          "query userInfoQuery {\n  userInfo {\n    id\n    name\n    avatar\n    eid\n    userId\n    __typename\n  }\n}\n",
      },
    })
  }

  private async serviceGetHomeInfo(cookie: Cookie[]) {
    return await this.requestApi({
      cookie,
      url: "/rest/cp/creator/pc/home/infoV2",
      method: "POST",
    })
  }

  private async serviceGetCurrentAccount(cookie: Cookie[]) {
    return await this.requestApi({
      cookie,
      url: "/rest/v2/creator/pc/authority/account/current",
      method: "POST",
      body: {},
    })
  }

  private async serviceGetWorks(cookie: Cookie[], params: { queryType: "0" | "2"; limit: number }) {
    return await this.requestApi({
      cookie,
      url: "/rest/cp/works/v2/video/pc/photo/list",
      method: "POST",
      body: {
        cursor: Date.now(),
        queryType: params.queryType,
        limit: params.limit,
        timeRangeType: 5,
        keyword: "",
        startTime: Date.now() - 1000 * 60 * 60 * 24 * 30,
        endTime: Date.now(),
      },
    })
  }

  private extractUidFromCookies(cookies: Cookie[]) {
    const namedUid = cookies.find((cookie) => {
      const name = String(cookie?.name || "").toLowerCase()
      return name === "userid" || name === "user_id" || name.includes("userid") || name.includes("kwaiid")
    })
    return String(namedUid?.value || "").trim()
  }

  private normalizeAvatarUrl(value: unknown) {
    const raw = String(value || "").trim()
    if (!raw) return ""
    if (raw.startsWith("//")) return "https:" + raw
    if (/^https?:\/\//i.test(raw)) return raw
    return ""
  }

  private async fetchAvatarFromWorks(cookies: Cookie[]) {
    const pickAvatar = (item: Record<string, any>) =>
      this.normalizeAvatarUrl(
        item?.userHead ||
          item?.avatar ||
          item?.headUrl ||
          item?.userAvatar ||
          item?.avatarUrl ||
          item?.headImage ||
          item?.author?.headerUrl ||
          item?.author?.avatar ||
          item?.author?.headUrl ||
          item?.creator?.avatar ||
          item?.creator?.headUrl,
      )

    const queryTypes: Array<"0" | "2"> = ["0", "2"]
    for (const queryType of queryTypes) {
      const worksRes = await this.withTimeout(
        this.serviceGetWorks(cookies, { queryType, limit: 20 }),
        10000,
        "kwai formatUserInfo getWorks",
      ).catch(() => null)

      const works = (worksRes as any)?.data?.data?.list
      if (!Array.isArray(works) || works.length === 0) continue

      const itemWithAvatar = works.find((item: any) => !!pickAvatar(item || {}))
      const avatar = pickAvatar((itemWithAvatar || {}) as Record<string, any>)
      if (avatar) return avatar
    }

    return ""
  }

  private async formatUserInfo(
    req: any | null,
    cookies: Cookie[],
  ): Promise<{
    loginCookie: string
    userId: string
    type: string
    uid: string
    account: string
    avatar: string
    nickname: string
    fansCount: number
  } | null> {
    const gqlUserInfo = req?.data?.data?.userInfo || req?.data?.userInfo || {}

    const [homeInfoRes, currentAccountRes] = await Promise.all([
      this.withTimeout(this.serviceGetHomeInfo(cookies), 10000, "kwai formatUserInfo getHomeInfo").catch(() => null),
      this.withTimeout(this.serviceGetCurrentAccount(cookies), 10000, "kwai formatUserInfo getCurrentAccount").catch(
        () => null,
      ),
    ])

    const homeInfo = (homeInfoRes?.data?.data || {}) as Record<string, any>
    const currentAccount = (currentAccountRes?.data?.data || {}) as Record<string, any>

    const uidCandidate =
      gqlUserInfo?.userId ??
      gqlUserInfo?.id ??
      gqlUserInfo?.eid ??
      currentAccount?.userId ??
      currentAccount?.userKwaiId ??
      homeInfo?.userId ??
      homeInfo?.userKwaiId ??
      this.extractUidFromCookies(cookies)
    const uid = String(uidCandidate ?? "").trim()
    if (!uid) return null

    const nicknameCandidate =
      gqlUserInfo?.name ??
      gqlUserInfo?.nickname ??
      currentAccount?.userName ??
      currentAccount?.nickname ??
      homeInfo?.userName ??
      homeInfo?.name ??
      uid

    const avatarCandidate =
      gqlUserInfo?.avatar ??
      gqlUserInfo?.headUrl ??
      currentAccount?.userAvatar ??
      currentAccount?.avatar ??
      currentAccount?.headUrl ??
      homeInfo?.avatar ??
      homeInfo?.userHead ??
      homeInfo?.headUrl ??
      ""

    let avatar = this.normalizeAvatarUrl(avatarCandidate)
    if (!avatar) {
      avatar = await this.fetchAvatarFromWorks(cookies)
    }

    return {
      loginCookie: "",
      userId: "",
      type: this.id,
      uid,
      account: uid,
      avatar,
      nickname: String(nicknameCandidate || uid).trim() || uid,
      fansCount: Number(homeInfo?.fansCnt || 0),
    }
  }

  // ---- PlatformBase 接口实现 ----

  async loginOrView(authModel: "login" | "view", _existingCookies?: Cookie[] | null): Promise<PlatformLoginResult> {
    if (authModel === "view") return { success: false, error: "预览模式未实现" }

    try {
      const req = await this.serviceLogin()
      if (!req) return { success: false, error: "登录返回为空" }

      const userInfo = await this.formatUserInfo(req.userInfo, req.cookies)
      if (!userInfo) return { success: false, error: "无法获取用户信息" }

      return {
        success: true,
        cookies: req.cookies,
        userInfo: {
          nickname: userInfo.nickname,
          avatar: userInfo.avatar,
          platformUserId: userInfo.uid,
          fansCount: userInfo.fansCount,
        },
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "快手登录失败",
      }
    }
  }

  async detectLogin(cookies: Cookie[]): Promise<boolean> {
    const res = await this.withTimeout(
      this.serviceGetAccountInfo(cookies),
      10000,
      "kwai detectLogin getAccountInfo",
    ).catch(() => null)
    if (res?.status === 200) {
      const profile = await this.formatUserInfo(res, cookies).catch(() => null)
      if (profile?.uid) return true
    }

    const homeInfo = await this.withTimeout(
      this.serviceGetHomeInfo(cookies),
      10000,
      "kwai detectLogin getHomeInfo",
    ).catch(() => null)
    return !!homeInfo?.data?.data?.userId
  }

  async getAccountInfo(cookies: Cookie[]): Promise<PlatformAccountInfo> {
    const res = await this.withTimeout(this.serviceGetAccountInfo(cookies), 10000, "kwai getAccountInfo").catch(
      () => null,
    )
    const info = await this.formatUserInfo(res, cookies)
    if (!info) return { nickname: "", avatar: "", platformUserId: "" }
    return {
      platformUserId: info.uid,
      nickname: info.nickname,
      avatar: info.avatar,
      fansCount: info.fansCount,
    }
  }

  async publish(_input: PublishInput, _cookies: Cookie[]): Promise<PublishResult> {
    return { success: false, error: "快手暂未接入发布能力" }
  }

  async getPublishHistory(_accountId: string): Promise<PublishRecord[]> {
    return []
  }

  async getAccountStats(_accountId: string): Promise<AccountStats> {
    return { followers: 0, following: 0, totalPosts: 0, totalLikes: 0, updatedAt: Date.now() }
  }
}
