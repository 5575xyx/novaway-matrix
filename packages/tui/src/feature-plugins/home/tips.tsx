import type { TuiPlugin, TuiPluginApi } from "@opencode/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, Show } from "solid-js"
import { Tips } from "./tips-view"
import { useBindings } from "../../keymap"

const id = "internal:home-tips"

function View(props: { api: TuiPluginApi; hidden: boolean; show: boolean; connected: boolean; dismissed: string }) {
  useBindings(() => ({
    commands: [
      {
        name: "tips.toggle",
        title: props.hidden ? "显示提示" : "隐藏提示",
        category: "系统",
        namespace: "palette",
        run() {
          props.api.kv.set("tips_hidden", !props.api.kv.get("tips_hidden", false))
          props.api.ui.dialog.clear()
        },
      },
    ],
    bindings: props.api.tuiConfig.keybinds.get("tips.toggle"),
  }))

  return (
    // 提示区现在紧贴输入框上方(输入框贴底),不再需要原来那 3 行下推留白。
    // maxWidth=75 就是提示卡的容器宽(tips-view 里 TIP_BAR_MAX 与它同一个数)。
    <box width="100%" maxWidth={75} alignItems="center" paddingTop={1} flexShrink={1}>
      <Show when={props.show}>
        <Tips
          api={props.api}
          connected={props.connected}
          dismissed={props.dismissed}
          // 「稍后」= 这一条我不想再听。存在 kv 里,所以切路由回来不会立刻又冒出来;
          // 与 tips_hidden(隐藏全部)是另一件事,那个旗标原样留着。
          //
          // 存的是**刚点掉的那条**的纯文本,由 Tips 从 tip() 现取后回调过来 —— 这里原先
          // 存的是 props.dismissed(上一次存的值),首次点击拿到空串,存回去等于没消解。
          onDismiss={(key) => {
            props.api.kv.set("tips_dismissed", key)
          }}
        />
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: {
      home_bottom() {
        const hidden = createMemo(() => api.kv.get("tips_hidden", false))
        const first = createMemo(() => api.state.session.count() === 0)
        const connected = createMemo(() =>
          api.state.provider.some(
            (item) => item.id !== "NovaWay" || Object.values(item.models).some((model) => model.cost?.input !== 0),
          ),
        )
        const show = createMemo(() => (!first() || !connected()) && !hidden())
        const dismissed = createMemo(() => api.kv.get("tips_dismissed", ""))
        return <View api={api} hidden={hidden()} show={show()} connected={connected()} dismissed={dismissed()} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
