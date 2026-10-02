import type { TuiPlugin, TuiPluginApi } from "@opencode/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, For, Show } from "solid-js"
import { CollapsibleSidebarCard } from "../../component/sidebar-card"
import { TodoItem } from "../../component/todo-item"
import { icon } from "../../util/panel-icons"

const id = "internal:sidebar-todo"

function View(props: { api: TuiPluginApi; session_id: string }) {
  const list = createMemo(() => props.api.state.session.todo(props.session_id))
  const show = createMemo(() => list().length > 0 && list().some((item) => item.status !== "completed"))
  // 徽标是「已完成 / 总数」,和 TodoItem 的勾选状态同源(todo-item.tsx 的 completed 判定)。
  const done = createMemo(() => list().filter((item) => item.status === "completed").length)

  return (
    <Show when={show()}>
      <CollapsibleSidebarCard
        title="待办事项"
        icon={icon("goal")}
        badge={`${done()}/${list().length}`}
        count={list().length}
        collapseAt={2}
      >
        {() => <For each={list()}>{(item) => <TodoItem status={item.status} content={item.content} />}</For>}
      </CollapsibleSidebarCard>
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
