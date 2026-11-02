/**
 * 账号在列表里显示的名字。
 *
 * 迁移过来的老记录里有两类"看起来有名字"的脏数据：
 * - 空昵称（只有 cookie，接口又被风控拒了）
 * - 占位昵称（早期登录后固定等 1.2s 抓到的是页面标题："公众号"）
 * 两者都不该当成用户名字显示，否则列表里一排「公众号」「公众号」。
 */
const PLACEHOLDERS = new Set([
  "公众号",
  "微信公众平台",
  "视频号",
  "小红书",
  "小红书创作服务平台",
  "抖音",
  "抖音创作者中心",
  "哔哩哔哩",
  "bilibili",
  "快手",
  "快手创作者服务平台",
  "闲鱼",
  "登录",
  "首页",
])

export interface AccountNameInput {
  platform: string
  nickname?: string
  account?: string
}

export function accountDisplayName(input: AccountNameInput, platformName?: string): string {
  const nickname = (input.nickname ?? "").trim()
  if (nickname && !PLACEHOLDERS.has(nickname)) return nickname
  const account = (input.account ?? "").trim()
  if (account) return account
  return platformName ?? input.platform
}
