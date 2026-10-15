import { createContext, useContext, type ParentProps } from "solid-js"
import type { SnapshotFileDiff, VcsFileDiff } from "@novaway/sdk/v2"

export type SessionFileDiff = SnapshotFileDiff | VcsFileDiff
export type SessionDiffStyle = "unified" | "split"

type SessionDiffValue = {
  /** 当前会话里这个文件的改动；没有改动（或不在会话里）返回 undefined。 */
  diffFor: (path: string) => SessionFileDiff | undefined
  style: () => SessionDiffStyle
  setStyle: (style: SessionDiffStyle) => void
}

/**
 * 当前会话「本次改动」的按文件索引。
 *
 * 用途：文件预览打开一个**有改动**的文件时，直接显示变更前后对照
 * （左旧右新、红色 − / 绿色 +），而不是把改动后的内容当普通文本铺开 ——
 * 用户点的是"变更里的文件"，期望看到的是"变了什么"。
 *
 * 由会话页把 `reviewDiffs()` 挂进来（它是当前会话变更的唯一来源：
 * git/branch 走 vcs 查询、turn 走时间线里的改动），文件标签只读。
 *
 * 这里用带默认值的 createContext 而不是 `createSimpleContext`：文件标签也会被渲染在
 * 没有会话的地方（空 Side Pane、首页的预览），那种场景应当静默退化成普通文本预览，
 * 而不是抛 "context must be used within a provider"。
 */
const DEFAULT: SessionDiffValue = {
  diffFor: () => undefined,
  style: () => "split",
  setStyle: () => {},
}

const SessionDiffContext = createContext<SessionDiffValue>(DEFAULT)

export function SessionDiffProvider(props: ParentProps<{ value: SessionDiffValue }>) {
  return <SessionDiffContext.Provider value={props.value}>{props.children}</SessionDiffContext.Provider>
}

export const useSessionDiff = () => useContext(SessionDiffContext)
