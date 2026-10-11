// 提交面板:短哈希 + 提交主题。完整哈希不画(40 位顶掉半行),留给复制。
//
// 行高固定一行,主题按列宽截断,不折行(理由见 files-panel.tsx 头注释)。
//
// **宽度账目必须和 subjectWidth 的算式同步改**,否则行会被 flex 收缩裁切:
// paddingLeft(1) + 标记(2) + 哈希(≤HASH_WIDTH) + 分隔空格(1) + 主题(截断后)
import { For, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { Locale } from "../../util/locale"
import type { GitCommitRow } from "./state"

/** 短哈希列宽:git 的 `%h` 默认 7 列,按 8 列预留留一点余量。 */
const HASH_WIDTH = 8

export interface CommitsPanelProps {
  rows: GitCommitRow[]
  selected: () => number
  /** 面板可用列数(已扣左右各 1 列边框)。 */
  width: number
  /** 单击行:面板不关心命令,只报告点了第几行;外壳负责选中 + 双击判定。 */
  onRowClick?: (rowIndex: number) => void
}

export function CommitsPanel(props: CommitsPanelProps) {
  const { theme } = useTheme()
  // 哈希本身不截断 —— 它是引用,截了就没法用来定位那个提交。
  // 所以只保证主题按剩余宽度截断,别让主题顶破右边框。
  const subjectWidth = () => Math.max(4, props.width - 1 - 2 - HASH_WIDTH - 1)

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0}>
      <Show
        when={props.rows.length > 0}
        fallback={
          <box paddingLeft={3}>
            <text fg={theme.textMuted}>（暂无提交）</text>
          </box>
        }
      >
        <For each={props.rows}>
          {(row, index) => {
            const isFocused = () => index() === props.selected()
            return (
              <box
                flexDirection="row"
                paddingLeft={1}
                onMouseDown={(event) => {
                  event.stopPropagation()
                  props.onRowClick?.(index())
                }}
              >
                <text fg={isFocused() ? theme.primary : theme.textMuted} wrapMode="none">
                  {isFocused() ? "❯ " : "  "}
                </text>
                <text fg={isFocused() ? theme.primary : theme.text} wrapMode="none">
                  {row.hash} {Locale.truncateToWidth(row.subject, subjectWidth())}
                </text>
              </box>
            )
          }}
        </For>
      </Show>
    </box>
  )
}
