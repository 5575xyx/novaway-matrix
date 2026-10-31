import type { Snapshot } from "./profile"

/**
 * 派发时的「这次活记在谁名下」（§10.3）。
 *
 * 只有两种来源，都是事实、都不靠猜：
 *
 * 1. 队长把活派给名册里的成员：`task` 的 `name` 写成成员姓名，唯一匹配才算指认。
 *    同名多人时不选 —— 指错了比不归属更糟。
 * 2. 其余会话跟着父会话走：成员自己派生的子代理仍然算这个成员的工时，
 *    队长自己的临时助手算队长的（队长也是名册里的人）。
 *
 * 回到 `undefined` 表示「不知道是谁」：界面与接口都必须把它显示成未归属，
 * 不能借位给队长，也不能按岗位猜一个同名的人。
 */
export function identify(input: {
  /** 这次运行所属团队的编制快照；没有运行就是空。 */
  readonly roster?: Snapshot
  /** 父会话是否这次运行的队长（队长的父会话就是运行根会话）。 */
  readonly captain: boolean
  /** 这次 `task` 调用声明的名字。 */
  readonly name?: string
  /** 父会话的归属。 */
  readonly parentEmployeeID?: string
}): string | undefined {
  if (!input.captain) return input.parentEmployeeID
  const name = input.name?.trim()
  if (!name || !input.roster) return undefined
  const hits = input.roster.roster.filter((entry) => entry.employee.name === name)
  return hits.length === 1 ? hits[0].employee.id : undefined
}

export * as TeamIdentity from "./identity"
