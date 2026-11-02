/**
 * 账号资料（昵称 / 头像 / 平台 uid / 粉丝数）的补齐。
 *
 * 三个入口都走这里，保证"只要 cookie 还有效，资料迟早会被补上"：
 * - 登录成功那一刻（登录窗口里的页面抓取，见各平台 loginOrView）
 * - 巡检登录状态（接口 → 隐藏窗口兜底）
 * - 账号列表打开时对空资料的自动回填
 */
import type { Cookie } from "electron"
import type { PlatformBase } from "./PlatformBase"
import type { StoredAccount } from "./store"
import { mergeProfile, type ProfilePatch } from "./profile-merge"

export type { ProfilePatch }
export { mergeProfile }

function parseCookies(value: string | undefined): Cookie[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? (parsed as Cookie[]) : []
  } catch {
    return []
  }
}

/**
 * 尝试补一份资料：先打接口，关键字段缺失再用隐藏窗口读页面。
 * 返回补丁（可能为空对象）。
 */
export async function resolveProfile(
  platform: PlatformBase,
  account: Pick<StoredAccount, "uid" | "nickname" | "avatar" | "cookies" | "fansCount">,
): Promise<ProfilePatch> {
  const cookies = parseCookies(account.cookies)
  if (cookies.length === 0) return {}

  const api = await platform.getAccountInfo(cookies).catch(() => null)
  const apiNickname = (api?.nickname ?? "").trim()
  const apiAvatar = (api?.avatar ?? "").trim()

  // 接口缺昵称/头像时，用隐藏窗口读一次页面。页面是用户眼前看到的，
  // 优先级高于接口（接口可能只返回了 uid 或是旧缓存）。
  const page =
    !apiNickname || !apiAvatar ? await platform.captureProfileFromPage(cookies).catch(() => null) : null

  return mergeProfile(account, {
    nickname: (page?.nickname || apiNickname).trim(),
    avatar: (page?.avatar || apiAvatar).trim(),
    uid: (api?.platformUserId || page?.platformUserId || "").trim(),
    fansCount: api?.fansCount ?? page?.fansCount,
  })
}
