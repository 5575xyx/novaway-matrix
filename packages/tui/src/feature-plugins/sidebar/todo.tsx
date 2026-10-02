import type { TuiPlugin, TuiPluginApi } from "@opencode/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, For, Show, createSignal } from "solid-js"
import { SidebarCard } from "../../component/sidebar-card"
import { TodoItem } from "../../component/todo-item"
import { icon } from "../../util/panel-icons"

const id = "internal:sidebar-todo"

function View(props: { api: TuiPluginApi; session_id: string }) {
  const [open, setOpen] = createSignal(true)
  const list = createMemo(() => props.api.state.session.todo(props.session_id))
  const show = createMemo(() => list().length > 0 && list().some((item) => item.status !== "completed"))
  // 徽标是「已完成 / 总数」,和 TodoItem 的勾选状态同源(todo-item.tsx 的 completed 判定)。
  const done = createMemo(() => list().filter((item) => item.status === "completed").length)

  return (
    <Show when={show()}>
      <SidebarCard
        title="待办事项"
        icon={icon("goal")}
        badge={`${done()}/${list().length}`}
        collapsible={list().length > 2}
        collapsed={!open()}
        onToggle={() => list().length > 2 && setOpen((x) => !x)}
      >
        <Show when={list().length <= 2 || open()}>
          <For each={list()}>{(item) => <TodoItem status={item.status} content={item.content} />}</For>
        </Show>
      </SidebarCard>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 400,
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
