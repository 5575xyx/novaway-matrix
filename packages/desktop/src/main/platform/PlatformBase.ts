import type { Cookie } from "electron"

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

  abstract detectLogin(cookies: Cookie[]): Promise<boolean>
  abstract getAccountInfo(cookies: Cookie[]): Promise<PlatformAccountInfo>
  abstract publish(input: PublishInput, cookies: Cookie[]): Promise<PublishResult>
  abstract getPublishHistory(accountId: string): Promise<PublishRecord[]>
  abstract getAccountStats(accountId: string): Promise<AccountStats>
  abstract loginOrView(authModel: "login" | "view", existingCookies?: Cookie[] | null): Promise<PlatformLoginResult>

  async login(): Promise<{ loginCookie: string; uid: string; nickname: string; avatar: string; fansCount: number } | null> {
    const result = await this.loginOrView("login")
    if (!result.success || !result.cookies) return null
    const userInfo = result.userInfo || await this.getAccountInfo(result.cookies)
    return {
      loginCookie: JSON.stringify(result.cookies),
      uid: userInfo.platformUserId,
      nickname: userInfo.nickname,
      avatar: userInfo.avatar,
      fansCount: userInfo.fansCount || 0,
    }
  }
}
