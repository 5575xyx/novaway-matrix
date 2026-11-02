/**
 * 资料补丁的合并规则（纯函数，便于单测）。
 *
 * 只接受"确实更好"的值：接口/页面偶尔会返回空串或者占位文案，
 * 不能因为一次失败的刷新把本来有名字的账号清成空。
 */

export interface ProfilePatch {
  nickname?: string
  avatar?: string
  uid?: string
  fansCount?: number
}

export interface ProfileLike {
  nickname?: string
  avatar?: string
  uid?: string
  fansCount?: number
}

export function mergeProfile(current: ProfileLike, patch: ProfilePatch): ProfilePatch {
  const next: ProfilePatch = {}
  const nickname = (patch.nickname ?? "").trim()
  const avatar = (patch.avatar ?? "").trim()
  const uid = (patch.uid ?? "").trim()
  if (nickname && nickname !== current.nickname) next.nickname = nickname
  if (avatar && avatar !== current.avatar) next.avatar = avatar
  if (uid && uid !== current.uid) next.uid = uid
  if (typeof patch.fansCount === "number" && patch.fansCount !== current.fansCount) next.fansCount = patch.fansCount
  return next
}
