/**
 * 新会话的默认团队模式（§4.5）。
 *
 * 这是「选择器的初始值」，不是「每次派发都替你选」。两者差一个字，代价完全不同：
 * 初始值只影响新建会话写进库里的 `teamMode`，之后用户随时能在选择器里改；
 * 若做成「派发时兜底」，模型就会拿到用户从没点过的授权。
 *
 * 三条边界写在 `resolve()` 里：
 * 1. **显式选择永远优先。** 请求里带了 `teamMode`（哪怕是 `off`）就不动它。
 * 2. **子会话不继承。** `parentID` 存在时不套默认值 —— 团队成员、后台子代理
 *    都是子会话，它们能不能派发由父会话的编排决定，不该被项目默认悄悄打开。
 * 3. **总控关闭时默认值失效。** 关闭后内核不注入目录，写一个 `auto` 进库只会
 *    让界面显示「Auto」但什么也不会发生，等于两边打架。
 */

export type Mode = "off" | "auto" | "selected"

export type Fallback = {
  mode?: Mode
  ids?: readonly string[]
}

export type Resolution = {
  teamMode: Exclude<Mode, "off">
  teamIDs?: string[]
}

export type Input = {
  /** 请求里显式给的值；`teamMode` 出现即视为用户已选择。 */
  requested?: { teamMode?: Mode }
  /** 子会话（团队成员、子代理）不套默认值。 */
  parentID?: string
  /** 总控开关是否开启（`TeamSwitch.enabled`）。 */
  enabled: boolean
  /** 项目配置里的默认值。 */
  fallback?: Fallback
}

/**
 * 需要补写进 `session.create` 的字段；`undefined` 表示「什么都不加」。
 *
 * 返回 `undefined` 而不是 `{ teamMode: "off" }`：`off` 与「没设置」在内核里
 * 是同一件事（都不注入目录），写死一个 `off` 只会让以后改默认值时多一层迁移。
 */
export function resolve(input: Input): Resolution | undefined {
  if (input.requested?.teamMode !== undefined) return undefined
  if (input.parentID) return undefined
  if (!input.enabled) return undefined

  const mode = input.fallback?.mode
  if (!mode || mode === "off") return undefined

  if (mode === "auto") return { teamMode: "auto" }

  // 指定团队但没有名单：写进库也注入不了任何东西，索性不写。
  const ids = [...new Set((input.fallback?.ids ?? []).filter((id) => typeof id === "string" && id.length > 0))]
  if (ids.length === 0) return undefined
  return { teamMode: "selected", teamIDs: ids }
}
