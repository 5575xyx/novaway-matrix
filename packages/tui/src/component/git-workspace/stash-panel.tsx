// 贮藏面板:`stash@{0}` + 说明。空时显示（暂无）。
//
// ref 和说明各自独立截断再用空格拼在一起 —— 不能拼成一串再整体截断,
// 那样 `stash@{0}` 可能被截成 `stash@{`,而 ref 是要喂给 `git stash pop` 的引用,
// 截断就没意义了。写法照 files-panel.tsx 的状态词 + 路径两列。
//
// **宽度账目必须和 messageWidth 的算式同步改**,否则行会被 flex 收缩裁切:
// paddingLeft(1) + 标记(2) + ref(≤REF_WIDTH) + 分隔空格(1) + 说明(截断后)
import { For, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { Locale } from "../../util/locale"
import type { ArmedConfirm } from "./confirm"
import type { GitStashEntry } from "../../util/git-status"

/** ref 列宽:`stash@{0}` 是 9 列,留 12 列容下三位数序号。 */
const REF_WIDTH = 12

export interface StashPanelProps {
  rows: GitStashEntry[]
  selected: () => number
  /** 确认态;非 undefined 时焦点行显示确认文案而不是 ref。 */
  armed?: ArmedConfirm
  /** 面板可用列数(已扣左右各 1 列边框)。 */
  width: number
  /** 单击行:面板不关心命令,只报告点了第几行;外壳负责选中 + 双击判定。 */
  onRowClick?: (rowIndex: number) => void
}

export function StashPanel(props: StashPanelProps) {
  const { theme } = useTheme()
  // ref 本身不截断到不足 12 列(它是引用),所以按 REF_WIDTH 预留,余下全给说明。
  const messageWidth = () => Math.max(4, props.width - 1 - 2 - REF_WIDTH - 1)

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0}>
      <Show
        when={props.rows.length > 0}
        fallback={
          <box paddingLeft={3}>
            <text fg={theme.textMuted}>（暂无）</text>
          </box>
        }
      >
        <For each={props.rows}>
          {(row, index) => {
            const isFocused = () => index() === props.selected()
            const showingConfirm = () => isFocused() && props.armed !== undefined
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
                <Show
                  when={showingConfirm()}
                  fallback={
                    <text fg={isFocused() ? theme.primary : theme.text} wrapMode="none">
                      {Locale.truncateToWidth(row.ref, REF_WIDTH)} {Locale.truncateToWidth(row.message, messageWidth())}
                    </text>
                  }
                >
                  <text fg={theme.warning} wrapMode="none">
                    {Locale.truncateToWidth(props.armed?.label ?? "", props.width - 3)}
                  </text>
                </Show>
              </box>
            )
          }}
        </For>
      </Show>
    </box>
  )
}
