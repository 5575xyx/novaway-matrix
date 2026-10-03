import type { TuiPlugin, TuiPluginApi } from "@opencode/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, Show } from "solid-js"
import { TUI_BRAND } from "../../brand"

const id = "internal:sidebar-footer"

/**
 * 侧栏页脚。**这里不再打印目录**。
 *
 * 原来这个组件在品牌落款上面印了一行 `目录[:分支]`(会话目录,没有会话时落回实例目录,
 * 末尾还缀一个分支名)。同一屏的会话页底栏(routes/session/footer.tsx)已经独家显示同一份
 * 路径,而且路径做过 abbreviateHome、右组还带着 `⑂ 分支` —— 于是屏幕上上下叠着两条同样的路径,
 * 分支也跟着印了两遍。删掉的是这一份,底栏那一份留着。
 *
 * 换句话说:**目录在整个底部区域只由会话页底栏独家拥有**(同一条纪律见
 * component/prompt/index.tsx 里被删掉的那次重复)。侧栏根卡的 sidebar_footer 槽在没有插件
 * 注册时会落到 routes/session/sidebar.tsx 的兜底内容,而那份兜底本来也只有品牌落款 ——
 * 两边一致,不存在「插件打了一份、兜底打了一份」的第二真相。
 */
function View(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const has = createMemo(() =>
    props.api.state.provider.some(
      (item) => item.id !== "NovaWay" || Object.values(item.models).some((model) => model.cost?.input !== 0),
    ),
  )
  const done = createMemo(() => props.api.kv.get("dismissed_getting_started", false))
  const show = createMemo(() => !has() && !done())

  return (
    <box gap={1}>
      <Show when={show()}>
        <box
          backgroundColor={theme().backgroundElement}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          paddingRight={2}
          flexDirection="row"
          gap={1}
        >
          <text flexShrink={0} fg={theme().text}>
            ⬖
          </text>
          <box flexGrow={1} gap={1}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={theme().text}>
                <b>快速开始</b>
              </text>
              <text fg={theme().textMuted} onMouseDown={() => props.api.kv.set("dismissed_getting_started", true)}>
                ✕
              </text>
            </box>
            <text fg={theme().textMuted}>{TUI_BRAND.name} 包含免费模型，您可以立即开始使用。</text>
            <text fg={theme().textMuted}>连接 75+ 提供商以使用其他模型，包括 Claude、GPT、Gemini 等</text>
            <box flexDirection="row" gap={1} justifyContent="space-between">
              <text fg={theme().text}>连接提供商</text>
              <text fg={theme().textMuted}>/connect</text>
            </box>
          </box>
        </box>
      </Show>
      <text fg={theme().textMuted}>
        <span style={{ fg: theme().success }}>•</span> <b>{TUI_BRAND.left}</b>
        <span style={{ fg: theme().text }}>
          <b>{TUI_BRAND.right}</b>
        </span>{" "}
        <span>{props.api.app.version}</span>
      </text>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: {
      sidebar_footer() {
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
