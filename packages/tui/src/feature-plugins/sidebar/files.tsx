import type { TuiPlugin, TuiPluginApi } from "@opencode/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, For, Show, createSignal } from "solid-js"
import { SidebarCard } from "../../component/sidebar-card"
import { icon } from "../../util/panel-icons"
import { SIDEBAR_CARD_MIN_CONTENT } from "../../util/sidebar-metrics"
import { Locale } from "../../util/locale"

const id = "internal:sidebar-files"

function changeCountWidth(item: { additions: number; deletions: number }) {
  return [item.additions ? `+${item.additions}` : "", item.deletions ? `-${item.deletions}` : ""]
    .filter(Boolean)
    .join(" ").length
}

function View(props: { api: TuiPluginApi; session_id: string }) {
  const [open, setOpen] = createSignal(true)
  const theme = () => props.api.theme.current
  const list = createMemo(() => props.api.state.session.diff(props.session_id))

  return (
    <Show when={list().length > 0}>
      <SidebarCard
        title="修改的文件"
        icon={icon("files")}
        badge={`${list().length} files`}
        collapsible={list().length > 2}
        collapsed={!open()}
        onToggle={() => list().length > 2 && setOpen((x) => !x)}
      >
        <Show when={list().length <= 2 || open()}>
          <For each={list()}>
            {(item) => (
              <box flexDirection="row" gap={1} justifyContent="space-between">
                <text fg={theme().textMuted} wrapMode="none">
                  {/* 这一行落在「修改的文件」分区卡里,预算是分区卡内容区的最窄值 35 列,
                      再减去右侧的 +N/-M 统计宽度。 */}
                  {Locale.truncateLeft(item.file, Math.max(2, SIDEBAR_CARD_MIN_CONTENT - changeCountWidth(item)))}
                </text>
                <box flexDirection="row" gap={1} flexShrink={0}>
                  <Show when={item.additions}>
                    <text fg={theme().diffAdded}>+{item.additions}</text>
                  </Show>
                  <Show when={item.deletions}>
                    <text fg={theme().diffRemoved}>-{item.deletions}</text>
                  </Show>
                </box>
              </box>
            )}
          </For>
        </Show>
      </SidebarCard>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 500,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
