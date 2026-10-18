import { createMemo, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useGlobalSync } from "@/context/global-sync"
import { useSessionKey } from "@/pages/session/session-layout"
import type { Todo } from "@novaway/sdk/v2/client"
import { isTodoDone, todoSectionModel, type TodoSectionModel } from "./todo-section-model"
import type { StatusPanelSection } from "./status-panel"

export { todoSectionModel, isTodoDone, type TodoSectionModel } from "./todo-section-model"

/**
 * 待办状态 → 圆圈样式。
 *
 * 对齐 ZCode 的待办行：每条前面是一个圆圈，用颜色区分状态 ——
 * - 未开始：空心灰圈；
 * - 进行中：蓝色圆环 + 呼吸动画（一眼看出"现在在做这条"）；
 * - 已完成：实心蓝圈 + 对勾；
 * - 已取消：空心圈 + 删除线文字。
 *
 * 这里不用 Kobalte 的 Checkbox：todo 是只读进度展示，点它并不会切换服务端状态，
 * 做成可点复选框反而误导。
 */
const STATUS_STYLE: Record<string, { ring: string; dot?: string; label: "pending" | "running" | "done" | "cancelled" }> = {
  pending: { ring: "border-border-hover bg-transparent", label: "pending" },
  in_progress: { ring: "border-[var(--icon-blue)] bg-transparent", dot: "bg-[var(--icon-blue)] animate-pulse", label: "running" },
  completed: { ring: "border-[var(--icon-blue)] bg-[var(--icon-blue)]", label: "done" },
  cancelled: { ring: "border-border-hover bg-transparent", label: "cancelled" },
}

function TodoStatusCircle(props: { status: string }) {
  const style = () => STATUS_STYLE[props.status] ?? STATUS_STYLE.pending
  return (
    <span
      data-component="todo-status"
      data-status={style().label}
      class={`grid size-4 shrink-0 place-items-center rounded-full border ${style().ring}`}
    >
      <Show when={style().label === "done"}>
        <svg viewBox="0 0 12 12" class="size-2.5 text-background" fill="none" aria-hidden="true">
          <path d="M2.5 6.2L4.8 8.5L9.5 3.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </Show>
      <Show when={style().dot}>
        <span class={`size-1.5 rounded-full ${style().dot}`} />
      </Show>
    </span>
  )
}

// 区块描述符由调用方的 memo 驱动：model 为 null 时该区块整体不进 sections，面板随之不挂载。
export function useTodoSection(): () => StatusPanelSection | null {
  const language = useLanguage()
  const globalSync = useGlobalSync()
  const { sessionKey } = useSessionKey()

  const sessionID = createMemo(() => sessionKey().split("/").at(-1) ?? "")
  const todos = createMemo<Todo[]>(() => {
    const id = sessionID()
    if (!id) return []
    return globalSync.data.session_todo[id] ?? []
  })
  const model = createMemo(() => todoSectionModel(todos()))

  return () => {
    const current = model()
    if (!current) return null
    // 展示全部待办（不再只取 3 条焦点窗口）：卡片体本身可滚动，
    // 长清单也能一条条看完，而不是被截断成 "+N 条"。
    const list = current.focus.length === current.total ? current.focus : todos()

    return {
      id: "todo",
      title: language.t("session.todo.title"),
      summary: (
        <>
          {current.done}/{current.total}
        </>
      ),
      defaultOpen: true,
      bodyHeight: "max-h-64",
      children: (
        <div class="flex flex-col gap-0.5 px-2 pb-2">
          <For each={list}>
            {(todo) => {
              const done = isTodoDone(todo)
              return (
                <div
                  data-component="todo-row"
                  data-status={todo.status}
                  class="flex items-start gap-2 rounded-md px-1.5 py-1.5 transition-colors hover:bg-hover"
                >
                  <span class="mt-0.5">
                    <TodoStatusCircle status={todo.status} />
                  </span>
                  <span
                    class="min-w-0 flex-1 text-ui-base leading-5"
                    classList={{
                      "text-foreground": !done,
                      "text-foreground-subtle line-through": todo.status === "cancelled",
                      "text-foreground-subtle": todo.status === "completed",
                      "text-[var(--icon-blue)]": todo.status === "in_progress",
                    }}
                  >
                    {todo.content}
                  </span>
                </div>
              )
            }}
          </For>
        </div>
      ),
    }
  }
}
