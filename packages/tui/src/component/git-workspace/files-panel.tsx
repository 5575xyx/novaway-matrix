// 文件面板:文件列表 + 中文状态词 + 加删行数。焦点行有 ❯ 标记。
//
// 行高是**固定一行**:文件路径按列宽截断(见 Locale.truncateToWidth),不折行 ——
// 折行会让「j/k 选下一行」的视觉反馈变成跳一大段。
import { For, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { Locale } from "../../util/locale"
import type { ArmedConfirm } from "./confirm"
import type { FileRow } from "./state"

export interface FilesPanelProps {
  rows: FileRow[]
  /** 当前焦点行下标;面板没获得焦点时由调用方传 -1(没有行是焦点)。 */
  selected: () => number
  /** 确认态;非 undefined 时焦点行显示确认文案而不是正常内容。 */
  armed?: ArmedConfirm
  /** 面板可用列数,用于截断路径。 */
  width: number
}

export function FilesPanel(props: FilesPanelProps) {
  const { theme } = useTheme()
  // 扣掉左边的选中标记与空格(2 列),再扣掉右边的计数(约 10 列)。
  const pathWidth = () => Math.max(8, props.width - 2 - 10)

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0}>
      <Show
        when={props.rows.length > 0}
        fallback={
          <text fg={theme.textMuted} paddingLeft={2}>
            暂无改动
          </text>
        }
      >
        <For each={props.rows}>
          {(row, index) => {
            const isFocused = () => index() === props.selected()
            const showingConfirm = () => isFocused() && props.armed !== undefined
            return (
              <box flexDirection="row" paddingLeft={1}>
                <text fg={isFocused() ? theme.primary : theme.textMuted} wrapMode="none">
                  {isFocused() ? "❯ " : "  "}
                </text>
                <Show
                  when={showingConfirm()}
                  fallback={
                    <>
                      <text fg={theme.text} wrapMode="none">
                        {Locale.truncateToWidth(row.label, 6)} {Locale.truncateToWidth(row.file, pathWidth())}
                      </text>
                      <Show when={row.count}>
                        <text fg={theme.textMuted} wrapMode="none" paddingLeft={1}>
                          {row.count}
                        </text>
                      </Show>
                    </>
                  }
                >
                  <text fg={theme.warning} wrapMode="none">
                    {props.armed?.label ?? ""}
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
