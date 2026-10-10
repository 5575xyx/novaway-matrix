// 分支面板:本地与远程分支同列,当前分支标 ●。
//
// 远程分支保留 git 原本的 `origin/main` 形式,不译成中文 —— 它是要喂给 git 的真实引用,
// 翻成「主分支」就切不回去了。
//
// 行高固定一行:分支名按列宽截断,不折行(理由见 files-panel.tsx 头注释)。
//
// **宽度账目必须和 nameWidth 的算式同步改**,否则行会被 flex 收缩裁切:
// paddingLeft(1) + 标记(2) + 分支名(截断后) + 计数(仅当有值:1 内边距 + ≤COUNT_WIDTH)
import { For, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { Locale } from "../../util/locale"
import type { ArmedConfirm } from "./confirm"
import type { BranchRow } from "./state"

/** 计数区最多 8 列,如 `↑91 ↓45`;再大就截断,宁可少画也不要让分支名被挤没。 */
const COUNT_WIDTH = 8
const COUNT_PAD = 1

export interface BranchesPanelProps {
  rows: BranchRow[]
  selected: () => number
  /** 确认态;非 undefined 时焦点行显示确认文案而不是分支名。 */
  armed?: ArmedConfirm
  /** 面板可用列数(已扣左右各 1 列边框)。 */
  width: number
}

export function BranchesPanel(props: BranchesPanelProps) {
  const { theme } = useTheme()
  // 一行的固定开销:左内边距 1 + 标记 2。计数只在真有值时才占列宽 ——
  // 远程分支和没有上游的分支都不占,白预留等于白白压缩分支名的显示空间。
  const nameWidth = (count?: string) => Math.max(4, props.width - 1 - 2 - (count ? COUNT_PAD + COUNT_WIDTH : 0))

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
              <box flexDirection="row" paddingLeft={1}>
                {/* 当前分支的 ● 优先于焦点标记:切完分支焦点还在这一行,两个标记抢一格会互相挤掉。 */}
                <text fg={row.current ? theme.primary : isFocused() ? theme.primary : theme.textMuted} wrapMode="none">
                  {row.current ? "● " : isFocused() ? "❯ " : "  "}
                </text>
                <Show
                  when={showingConfirm()}
                  fallback={
                    <text fg={row.current ? theme.primary : theme.text} wrapMode="none">
                      {Locale.truncateToWidth(row.name, nameWidth(row.count))}
                    </text>
                  }
                >
                  <text fg={theme.warning} wrapMode="none">
                    {Locale.truncateToWidth(props.armed?.label ?? "", props.width - 3)}
                  </text>
                </Show>
                <Show when={row.count}>
                  {(count) => (
                    <box paddingLeft={COUNT_PAD}>
                      <text fg={theme.textMuted} wrapMode="none">
                        {Locale.truncateToWidth(count(), COUNT_WIDTH)}
                      </text>
                    </box>
                  )}
                </Show>
              </box>
            )
          }}
        </For>
      </Show>
    </box>
  )
}
