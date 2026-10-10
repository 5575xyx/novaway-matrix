// 状态面板:四行可操作条目(分支 / 远程 / 变更 / 提示)。
//
// 为什么是「可操作的四行」而不是一块静态摘要:「选哪个远端」必须有地方放,而独立成第六个面板
// 又太重(Lazygit 也没有)。塞进状态面板当一行,正好。
//
// 选中远程行时把完整 URL 摊开:f 推送是不可逆动作,推错地方很痛,多占一行显示地址是值的。
//
// ⚠️ 缩进必须用 <box paddingLeft={...}> 包住 <text>,**不能把 paddingLeft 写在 <text> 上**。
// 实测 opentui 0.4.5 里叶子 <text> 的 yoga padding 只收缩内容宽度、不平移绘制起点,
// 写了等于没写(文本照样从第 0 列开始)。同一个坑在 component/git-workspace/files-panel.tsx
// 的空态、component/git-workspace/diff-panel.tsx 的提示行上也有。
//
// **宽度账目必须和下面 detailWidth 的算式同步改**,否则行会被 flex 收缩裁切。
import { For, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { Locale } from "../../util/locale"
import type { StatusRow } from "./state"

/** 标签固定 4 列(「分支」「远程」「变更」「提示」都是两字中文)。 */
const LABEL_WIDTH = 4
/** 计数区总宽 = 1 列左内边距 + 计数正文。 */
const COUNT_PAD = 1
/** 计数正文最多 8 列(如 `+100 -20`)。超出截断 —— 全仓求和的数字可以很长,不截会挤掉 detail。 */
const COUNT_TEXT_WIDTH = 8

export interface StatusPanelProps {
  rows: StatusRow[]
  selected: () => number
  /** 选中远端的完整地址;没有远端时 undefined。 */
  remoteUrl?: string
  width: number
  /** 单击行:面板不关心命令,只报告点了第几行;外壳负责选中 + 双击判定。 */
  onRowClick?: (rowIndex: number) => void
}

export function StatusPanel(props: StatusPanelProps) {
  const { theme } = useTheme()
  // 一行的固定开销:左内边距 1 + 标记 2 + 标签 LABEL_WIDTH + 分隔空格 1 + 计数区(COUNT_PAD + COUNT_TEXT_WIDTH)。
  // 账目必须和 files-panel 的 pathWidth 用同一套口径,漏算就会被 flex 收缩硬切。
  const detailWidth = () => Math.max(4, props.width - 1 - 2 - LABEL_WIDTH - 1 - COUNT_PAD - COUNT_TEXT_WIDTH)
  const urlWidth = () => Math.max(4, props.width - 3)

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0}>
      <For each={props.rows}>
        {(row, index) => {
          const isFocused = () => index() === props.selected()
          const showUrl = () => isFocused() && row.kind === "remote" && props.remoteUrl !== undefined
          // 每一行(含它下面可能多出来的地址行)包成一个 column box:
          // ① 地址行是这一行的**一部分**,不是兄弟 —— 以后要给整行上高亮才做得到;
          // ② 也让「渲染行数 ≠ rows.length」这件事在结构上看得见(见下方注释)。
          return (
            <box flexDirection="column">
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
                <text fg={theme.textMuted} wrapMode="none">
                  {Locale.truncateToWidth(row.label, LABEL_WIDTH)}{" "}
                </text>
                <text fg={theme.text} wrapMode="none">
                  {Locale.truncateToWidth(row.detail ?? "", detailWidth())}
                </text>
                <Show when={row.count}>
                  <box paddingLeft={COUNT_PAD}>
                    <text fg={theme.warning} wrapMode="none">
                      {Locale.truncateToWidth(row.count ?? "", COUNT_TEXT_WIDTH)}
                    </text>
                  </box>
                </Show>
              </box>
              {/* 地址单独一行,不挤在远程那行后面 —— URL 很长,挤进去会把远端名截断掉。
                  ⚠️ 给外壳的契约:**远端行聚焦时,本面板渲染 rows.length + 1 行**。
                  任何按 selected 1:1 映射屏幕行的逻辑(光标、滚动条、固定行高)都要按这个算,
                  否则 URL 一出现就全错位。 */}
              <Show when={showUrl()}>
                <box paddingLeft={3}>
                  <text fg={theme.textMuted} wrapMode="none">
                    {Locale.truncateToWidth(props.remoteUrl ?? "", urlWidth())}
                  </text>
                </box>
              </Show>
            </box>
          )
        }}
      </For>
    </box>
  )
}
