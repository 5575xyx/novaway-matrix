import type { TuiPlugin, TuiPluginApi } from "@opencode/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, For, Show } from "solid-js"
import { CollapsibleSidebarCard } from "../../component/sidebar-card"
import { icon } from "../../util/panel-icons"

const id = "internal:sidebar-lsp"

function View(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const list = createMemo(() => props.api.state.lsp())
  const off = createMemo(() => !props.api.state.config.lsp)

  return (
    <CollapsibleSidebarCard
      title="LSP"
      icon={icon("doc")}
      badge={off() ? "已禁用" : `${list().length} 个服务`}
      count={list().length}
      collapseAt={2}
    >
      {() => (
        <>
          <Show when={list().length === 0}>
            <text fg={theme().textMuted}>{off() ? "LSP 已禁用" : "LSP 将在读取文件时激活"}</text>
          </Show>
          <For each={list()}>
            {(item) => (
              <box flexDirection="row" gap={1}>
                <text
                  flexShrink={0}
                  style={{
                    fg: item.status === "connected" ? theme().success : theme().error,
                  }}
                >
                  •
                </text>
                <text fg={theme().textMuted}>
                  {item.id} {item.root}
                </text>
              </box>
            )}
          </For>
        </>
      )}
    </CollapsibleSidebarCard>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 300,
    slots: {
      sidebar_content() {
        return <View api={api} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
