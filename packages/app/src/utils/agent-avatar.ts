import { agentAvatarSrc } from "@novaway/ui/util/agent-avatar"

export { agentAvatarSrc }

/**
 * 可选头像的种子。
 *
 * 头像是按种子离线生成的 SVG：同一颗种子永远同一张图，所以设置页每次打开
 * 看到的都是同一批候选，用户挑中的那一个也能原样存进员工配置（frontmatter 的
 * `avatar`），换机器、换网络都不会变。
 */
export const agentAvatarSeeds = [
  // 种子本身对用户不可见（只存在配置里）；这 12 个是按哈希后的色相刻意挑的，
  // 打开选择器能一眼看出「颜色不重样」。
  "amber",
  "drift",
  "olive",
  "azure",
  "berry",
  "emerald",
  "onyx",
  "lime",
  "dusk",
  "ocean",
  "peach",
  "plum",
] as const

/**
 * AI 员工实际使用的头像。
 *
 * 用户挑过（`options.avatar` 是种子）就用挑的；没挑过才退回按名字生成。
 * 所有展示 AI 员工头像的地方都走这里，挑了头像才不会只有设置页生效。
 */
export function agentAvatar(name: string, options?: Record<string, unknown> | null) {
  const seed = typeof options?.avatar === "string" ? options.avatar.trim() : ""
  return agentAvatarSrc(seed || name)
}
