import type { PlatformBase } from "./PlatformBase"

export interface LoginResult {
  success: boolean
  cookies?: Electron.Cookie[]
  loginCookie?: string
  uid?: string
  nickname?: string
  avatar?: string
  fansCount?: number
  error?: string
}

export class PlatformLoginManager {
  async startLogin(platform: PlatformBase): Promise<LoginResult> {
    const result = await platform.login()
    if (!result) return { success: false, error: "登录失败" }
    return {
      success: true,
      loginCookie: result.loginCookie,
      cookies: JSON.parse(result.loginCookie),
      uid: result.uid,
      nickname: result.nickname,
      avatar: result.avatar,
      fansCount: result.fansCount,
    }
  }

  cancel(): void {
    // Each platform handles cleanup internally
  }
}
