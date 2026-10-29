import { createStore, produce } from "solid-js/store"

/**
 * 团队选择模式（§4.2）。
 *
 * - `off`：不向模型注入团队目录，主智能体不会派发；
 * - `selected`：只允许 `teamIDs` 里的团队，派发前不用等用户批准；
 * - `auto`：把 `autoEligible` 的团队都交给模型自己挑，但每次派发都要先在
 *   运行页批准 —— 这条批准语义由内核保证，界面只负责把模式写进会话。
 */
export type TeamMode = "off" | "auto" | "selected"

export type TeamSelectionValue = {
  mode: TeamMode
  teamIDs: string[]
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
    setStore("pending", directory, { mode: value.mode, teamIDs: [...value.teamIDs] })
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
