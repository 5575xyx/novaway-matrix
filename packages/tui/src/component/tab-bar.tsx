import { createSignal, For, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { icon } from "../util/panel-icons"

export type TabItem = {
  id: string
  title: string
  type: "chat" | "preview"
  closable: boolean
  filePath?: string
}

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
              paddingLeft={1}
              paddingRight={1}
              paddingTop={0}
              paddingBottom={0}
              backgroundColor={isActive() ? theme.backgroundPanel : theme.backgroundElement}
              onMouseUp={() => props.onTabClick(tab.id)}
            >
              <text
                fg={isActive() ? theme.primary : theme.textMuted}
                attributes={isActive() ? TextAttributes.BOLD : undefined}
              >
                {tab.type === "chat" ? `${icon("chat")} ` : `${icon("doc")} `}
                {tab.title}
              </text>
              <Show when={tab.closable}>
                <text
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
