import type { Cookie } from "electron"
import { captureProfileInWindow } from "./profile-window"
import type { CaptureHints } from "./profile-capture"

export interface PlatformAccountInfo {
  nickname: string
  avatar: string
  platformUserId: string
  fansCount?: number
}

export interface PublishInput {
  type: "video" | "image_text" | "article"
  title: string
  description: string
  filePaths?: string[]
  tags?: string[]
  scheduleTime?: number
}

export interface PublishResult {
  success: boolean
  platformPostId?: string
  error?: string
  url?: string
}

export interface PublishRecord {
  id: string
  accountId: string
  platform: string
  type: "video" | "image_text" | "article"
  title: string
  status: "pending" | "publishing" | "success" | "failed"
  result?: PublishResult
  createdAt: number
}

export interface AccountStats {
  followers: number
  following: number
  totalPosts: number
  totalLikes: number
  updatedAt: number
}

export interface PlatformLoginResult {
  success: boolean
  cookies?: Cookie[]
  userInfo?: {
    nickname: string
    avatar: string
    platformUserId: string
    fansCount?: number
  }
  error?: string
}

export abstract class PlatformBase {
  abstract readonly id: string
  abstract readonly name: string
  abstract readonly loginUrl: string
  abstract readonly cookieCheckField: string

  /**
   * 只靠 cookie 拿不到资料时的兜底页面（创作者后台首页）。
   * 有它才能"用隐藏窗口读昵称/头像"，见 profile-window.ts。
   */
  readonly profileUrl?: string
  /** 该页面上昵称/头像的 CSS 选择器先验，传给页面抓取脚本。 */
  readonly profileHints?: CaptureHints

  abstract detectLogin(cookies: Cookie[]): Promise<boolean>
  abstract getAccountInfo(cookies: Cookie[]): Promise<PlatformAccountInfo>
  abstract publish(input: PublishInput, cookies: Cookie[]): Promise<PublishResult>
  abstract getPublishHistory(accountId: string): Promise<PublishRecord[]>
  abstract getAccountStats(accountId: string): Promise<AccountStats>
  abstract loginOrView(authModel: "login" | "view", existingCookies?: Cookie[] | null): Promise<PlatformLoginResult>

  /**
   * 用登录态窗口抓一份资料（接口被风控时的兜底）。
   * 注意与各平台内部的 `captureProfile(win)` 区分：那个是在已有窗口里抓，
   * 这个只需要 cookie。
   * 未声明 `profileUrl` 的平台返回 null —— 调用方据此保留原资料。
   */
  async captureProfileFromPage(cookies: Cookie[]): Promise<PlatformAccountInfo | null> {
    if (!this.profileUrl) return null
    const profile = await captureProfileInWindow(cookies, this.profileUrl, this.profileHints)
    if (!profile) return null
    if (!profile.uid && !profile.nickname && !profile.avatar) return null
    return {
      platformUserId: profile.uid,
      nickname: profile.nickname,
      avatar: profile.avatar,
    }
  }

  async login(): Promise<{
    loginCookie: string
    uid: string
    nickname: string
    avatar: string
    fansCount: number
  } | null> {
    const result = await this.loginOrView("login")
    if (!result.success || !result.cookies) return null
    const userInfo = result.userInfo || (await this.getAccountInfo(result.cookies))
    return {
      loginCookie: JSON.stringify(result.cookies),
      uid: userInfo.platformUserId,
      nickname: userInfo.nickname,
      avatar: userInfo.avatar,
      fansCount: userInfo.fansCount || 0,
    }
  }
}
