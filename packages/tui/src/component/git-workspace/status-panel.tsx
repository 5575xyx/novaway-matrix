// 状态面板:四行可操作条目(分支 / 远程 / 变更 / 提示)。
//
// 为什么是「可操作的四行」而不是一块静态摘要:「选哪个远端」必须有地方放,而独立成第六个面板
// 又太重(Lazygit 也没有)。塞进状态面板当一行,正好。
//
// 选中远程行时把完整 URL 摊开:f 推送是不可逆动作,推错地方很痛,多占一行显示地址是值的。
//
// **宽度账目必须和下面 detailWidth 的算式同步改**,否则行会被 flex 收缩裁切。
import { For, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { Locale } from "../../util/locale"
import type { StatusRow } from "./state"

/** 标签固定 4 列(「分支」「远程」「变更」「提示」都是两字中文)。 */
const LABEL_WIDTH = 4
/** 计数区:1 列左内边距 + 最多 8 列(如 `+100 -20`、`↑91`)。 */
const COUNT_WIDTH = 9

export interface StatusPanelProps {
  rows: StatusRow[]
  selected: () => number
  /** 选中远端的完整地址;没有远端时 undefined。 */
  remoteUrl?: string
  width: number
}

export function StatusPanel(props: StatusPanelProps) {
  const { theme } = useTheme()
  // 一行的固定开销:左内边距 1 + 标记 2 + 标签 LABEL_WIDTH + 分隔空格 1 + 计数区 COUNT_WIDTH。
  // 账目必须和 files-panel 的 pathWidth 用同一套口径,漏算就会被 flex 收缩硬切。
  const detailWidth = () => Math.max(4, props.width - 1 - 2 - LABEL_WIDTH - 1 - COUNT_WIDTH)

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0}>
      <For each={props.rows}>
        {(row, index) => {
          const isFocused = () => index() === props.selected()
          const showUrl = () => isFocused() && row.kind === "remote" && props.remoteUrl !== undefined
          return (
            <>
              <box flexDirection="row" paddingLeft={1}>
                <text fg={isFocused() ? theme.primary : theme.textMuted} wrapMode="none">
                  {isFocused() ? "❯ " : "  "}
                </text>
                <text fg={theme.textMuted} wrapMode="none">
                  {Locale.truncateToWidth(row.label, LABEL_WIDTH)}{" "}
                </text>
                <text fg={theme.text} wrapMode="none">
                  {Locale.truncateToWidth(row.detail ?? "", detailWidth())}
                </text>
                <Show when={row.count}>
                  <text fg={theme.warning} wrapMode="none" paddingLeft={1}>
                    {row.count}
                  </text>
                </Show>
              </box>
              {/* 地址单独一行,不挤在远程那行后面 —— URL 很长,挤进去会把远端名截断掉。 */}
              <Show when={showUrl()}>
                <text fg={theme.textMuted} paddingLeft={3} wrapMode="none">
                  {Locale.truncateToWidth(props.remoteUrl ?? "", props.width - 3)}
                </text>
              </Show>
            </>
          )
        }}
      </For>
    </box>
  )
}
