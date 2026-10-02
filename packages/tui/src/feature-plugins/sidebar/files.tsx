import type { TuiPlugin, TuiPluginApi } from "@opencode/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, For, Show } from "solid-js"
import { CollapsibleSidebarCard } from "../../component/sidebar-card"
import { icon } from "../../util/panel-icons"
import { SIDEBAR_CARD_MIN_CONTENT } from "../../util/sidebar-metrics"
import { Locale } from "../../util/locale"

const id = "internal:sidebar-files"

// 这一行的预算是「修改的文件」分区卡的内容区:最窄侧栏(44 列)下 36 列,见 util/sidebar-metrics。
// 再减去右侧 +N/-M 统计的宽度,再留 2 列余量 —— 统计那段是 flexShrink=0,行放不下时
// 被压缩的是文件名,不给余量就会把「…」和扩展名裁掉。
const PATH_MAX = SIDEBAR_CARD_MIN_CONTENT - 2

function changeCountWidth(item: { additions: number; deletions: number }) {
  return [item.additions ? `+${item.additions}` : "", item.deletions ? `-${item.deletions}` : ""]
    .filter(Boolean)
    .join(" ").length
}

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const list = createMemo(() => props.api.state.session.diff(props.session_id))

  return (
    <Show when={list().length > 0}>
      <CollapsibleSidebarCard
        title="修改的文件"
        icon={icon("files")}
        badge={`${list().length} 个文件`}
        count={list().length}
        collapseAt={2}
      >
        {() => (
          <For each={list()}>
            {(item) => (
              <box flexDirection="row" gap={1} justifyContent="space-between">
                <text fg={theme().textMuted} wrapMode="none">
                  {/* 路径按显示列截(而不是码元):中文路径按码元算会撑到两倍宽,
                      被渲染器硬裁掉之后连省略号和扩展名都没了。 */}
                  {Locale.truncateLeftToWidth(item.file, Math.max(2, PATH_MAX - changeCountWidth(item)))}
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
        )}
      </CollapsibleSidebarCard>
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
