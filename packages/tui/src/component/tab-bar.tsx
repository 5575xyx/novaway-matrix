import { For, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { icon } from "../util/panel-icons"
import { Locale } from "../util/locale"

export type TabItem = {
  id: string
  title: string
  type: "chat" | "preview" | "git-diff"
  closable: boolean
  filePath?: string
}

// 标签条的高度是钉死的:1 行标签 + 1 行下边框。
// 它是一个横排的条,任何让它变高的东西(过长的标题折行、标题里的 \n、被 flex 压缩)
// 都会顶掉下面的会话区。所以高度写死、不参与压缩、内容溢出直接裁掉。
const HEIGHT = 2
const TITLE_MAX = 24

export interface TabBarProps {
  tabs: TabItem[]
  activeTabId: string
  onTabClick: (tabId: string) => void
  onTabClose: (tabId: string) => void
}

export function TabBar(props: TabBarProps) {
  const { theme } = useTheme()

  return (
    <box
      flexDirection="row"
      height={HEIGHT}
      flexShrink={0}
      overflow="hidden"
      border={["bottom"]}
      borderColor={theme.border}
      paddingTop={0}
      paddingBottom={0}
      paddingLeft={1}
      paddingRight={1}
    >
      <For each={props.tabs}>
        {(tab) => {
          const isActive = () => tab.id === props.activeTabId
          return (
            <box
              flexDirection="row"
              flexShrink={0}
              paddingLeft={1}
              paddingRight={1}
              paddingTop={0}
              paddingBottom={0}
              backgroundColor={isActive() ? theme.backgroundPanel : theme.backgroundElement}
              onMouseUp={() => props.onTabClick(tab.id)}
            >
              <text
                wrapMode="none"
                fg={isActive() ? theme.primary : theme.textMuted}
                attributes={isActive() ? TextAttributes.BOLD : undefined}
              >
                {tab.type === "chat" ? `${icon("chat")} ` : `${icon("doc")} `}
                {Locale.oneLine(tab.title, TITLE_MAX)}
              </text>
              <Show when={tab.closable}>
                <text
                  wrapMode="none"
                  fg={theme.textMuted}
                  paddingLeft={1}
                  onMouseUp={(e) => {
                    e.stopPropagation()
                    props.onTabClose(tab.id)
                  }}
                >
                  ✕
                </text>
              </Show>
            </box>
          )
        }}
      </For>
    </box>
  )
}
