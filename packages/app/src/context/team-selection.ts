import { createStore, produce } from "solid-js/store"

/**
 * 团队选择模式（§4.2）。
 *
 * - `off`：用户明确要求主助手直接处理，不启用专家协作；
 * - `selected`：只允许 `teamIDs` 里的团队，或直接派给 `employeeID` 指向的专家；
 * - `auto`：主助手根据任务需要从 `autoEligible` 团队中选择，低风险只读派发自动继续，
 *   写入和外部副作用仍需要用户批准。 */
export type TeamMode = "off" | "auto" | "selected"

export type TeamSelectionValue = {
  mode: TeamMode
  teamIDs: string[]
  /** Optional direct expert selection; kept separate from teamIDs for compatibility. */
  employeeID?: string
}

export const TEAM_MODE_OFF: TeamSelectionValue = { mode: "off", teamIDs: [] }

/**
 * 新会话的待定选择。
 *
 * 已存在的会话把 `teamMode` / `teamIDs` 存在会话行上，界面直接读它 ——
 * 只有一处真相。但新建会话在发第一条消息前还没有会话 id，选择器这时把
 * 选择暂存在这里，`session.create` 时一起写进会话（和权限档位的待定槽位
 * 是同一套思路）。所以这里刻意不暴露 `set` 之外的重置入口：写进会话后
 * 必须 `take` 掉，否则下一次新会话会带着上一次的选择。
 */
const [store, setStore] = createStore<{ pending: Record<string, TeamSelectionValue> }>({ pending: {} })

export const TeamSelection = {
  pending(directory: string): TeamSelectionValue | undefined {
    return store.pending[directory]
  },
  setPending(directory: string, value: TeamSelectionValue) {
    setStore("pending", directory, {
      mode: value.mode,
      teamIDs: [...value.teamIDs],
      ...(value.employeeID ? { employeeID: value.employeeID } : {}),
    })
  },
  /** 写进会话后清掉；不清的话下一次新会话会带着上一次的选择。 */
  clearPending(directory: string) {
    setStore(
      "pending",
      produce((draft) => {
        delete draft[directory]
      }),
    )
  },
}
