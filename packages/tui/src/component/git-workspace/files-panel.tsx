// 文件面板:文件列表 + 中文状态词 + 加删行数。焦点行有 ❯ 标记。
//
// 行高是**固定一行**:文件路径按列宽截断(见 Locale.truncateToWidth),不折行 ——
// 折行会让「j/k 选下一行」的视觉反馈变成跳一大段。
//
// 关于 `❯`:仓库在 prompt 里刻意用 ASCII `>`(见 component/prompt/index.tsx 那段注释,
// 理由是 Dingbats 区字符各终端字形差异大)。这里破例用 `❯`,因为列表行的焦点标记要的是
// 「一眼可辨的方向感」,而列表上下文比单行输入框对字形差异更宽容。改回 `>` 前先想清楚。
//
// **宽度账目必须和下面 pathWidth 的算式同步改**,否则行会被 flex 收缩裁切:
// paddingLeft(1) + 标记(2) + 状态词(≤6) + 分隔空格(1) + 路径(截断后) + 计数(1 + ≤8)
import { For, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { Locale } from "../../util/locale"
import type { ArmedConfirm } from "./confirm"
import type { FileRow } from "./state"

/** 状态词最多占 6 列,和下行 truncateToWidth(row.label, 6) 是同一个数。 */
const LABEL_WIDTH = 6
/** 计数区:1 列左内边距 + 最多 8 列(如 `+100 -20`)。 */
const COUNT_WIDTH = 9

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
  // 一行的固定开销:左内边距 1 + 标记 2 + 状态词 LABEL_WIDTH + 分隔空格 1 + 计数区 COUNT_WIDTH。
  // 漏算任何一项,路径就会被 flex 收缩硬切(而且省略号也画不出来),计数和路径粘成一团。
  const pathWidth = () => Math.max(4, props.width - 1 - 2 - LABEL_WIDTH - 1 - COUNT_WIDTH)

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0}>
      <Show
        when={props.rows.length > 0}
        fallback={
          // 3 = 左内边距 1 + 标记 2,和上面行内容的标签起始列对齐。
          <text fg={theme.textMuted} paddingLeft={3}>
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
                        {Locale.truncateToWidth(row.label, LABEL_WIDTH)} {Locale.truncateToWidth(row.file, pathWidth())}
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
                    {/* 文案由外壳传入、长度不可控,同样得按宽度截,否则会和 ❯ 标记粘连。 */}
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
