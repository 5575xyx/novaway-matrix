import type { TuiPlugin, TuiPluginApi } from "@opencode/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, For, Match, Show, Switch } from "solid-js"
import { CollapsibleSidebarCard } from "../../component/sidebar-card"
import { icon } from "../../util/panel-icons"
import { Locale } from "../../util/locale"

const id = "internal:sidebar-mcp"

// MCP 的连接错误经常是整段带换行的堆栈或响应体。侧栏是一根窄条,
// 原样铺进去这一格就能长到几十行高,把下面的面板全顶掉。
const ERROR_MAX = 120

function View(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const list = createMemo(() => props.api.state.mcp())
  const on = createMemo(() => list().filter((item) => item.status === "connected").length)
  const bad = createMemo(
    () =>
      list().filter(
        (item) =>
          item.status === "failed" || item.status === "needs_auth" || item.status === "needs_client_registration",
      ).length,
  )

  const dot = (status: string) => {
    if (status === "connected") return theme().success
    if (status === "failed") return theme().error
    if (status === "disabled") return theme().textMuted
    if (status === "needs_auth") return theme().warning
    if (status === "needs_client_registration") return theme().error
    return theme().textMuted
  }

  return (
    <Show when={list().length > 0}>
      {/* 徽标里是活跃/错误数:折叠时也一直看得见,不用先展开才知道有几个服务器活着。 */}
      <CollapsibleSidebarCard
        title="MCP"
        icon={icon("hub")}
        badge={`${on()} 活跃${bad() > 0 ? `, ${bad()} 错误` : ""}`}
        count={list().length}
        collapseAt={2}
      >
        {() => (
          <For each={list()}>
            {(item) => (
              <box flexDirection="row" gap={1}>
                <text
                  flexShrink={0}
                  style={{
                    fg: dot(item.status),
                  }}
                >
                  •
                </text>
                <text fg={theme().text} wrapMode="word">
                  {item.name}{" "}
                  <span style={{ fg: theme().textMuted }}>
                    <Switch fallback={item.status}>
                      <Match when={item.status === "connected"}>已连接</Match>
                      <Match when={item.status === "failed"}>
                        <i>{Locale.oneLine(item.error ?? "", ERROR_MAX)}</i>
                      </Match>
                      <Match when={item.status === "disabled"}>已禁用</Match>
                      <Match when={item.status === "needs_auth"}>需要认证</Match>
                      <Match when={item.status === "needs_client_registration"}>需要客户端ID</Match>
                    </Switch>
                  </span>
                </text>
              </box>
            )}
          </For>
        )}
      </CollapsibleSidebarCard>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 200,
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
