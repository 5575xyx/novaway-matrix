import { createMemo, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useGlobalSync } from "@/context/global-sync"
import { useSessionKey } from "@/pages/session/session-layout"
import type { Todo } from "@novaway/sdk/v2/client"
import { isTodoDone, todoSectionModel, type TodoSectionModel } from "./todo-section-model"
import type { StatusPanelSection } from "./status-panel"

export { todoSectionModel, isTodoDone, type TodoSectionModel } from "./todo-section-model"

// 区块描述符由调用方的 memo 驱动：model 为 null 时该区块整体不进 sections，面板随之不挂载。
// 这里刻意不用 Kobalte 承载的 Checkbox——它的模块作用域会触碰客户端 API，
// 使 todo-section.test.ts 无法以纯逻辑方式 import 本文件；设计系统样式本就由 data-* 属性驱动。
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

    return {
      id: "todo",
      title: language.t("session.todo.title"),
      summary: (
        <>
          {current.done}/{current.total}
        </>
      ),
      defaultOpen: true,
      bodyHeight: "max-h-80",
      children: (
        <div class="space-y-1 px-3 pb-2">
          <Show when={current.preceding > 0}>
            <div class="px-1.5 py-0.5 text-ui-sm text-foreground-subtle">
              {language.t("session.todo.more", { count: current.preceding })}
            </div>
          </Show>
          <For each={current.focus}>
            {(todo) => (
              <div class="flex items-start gap-2 px-1.5 py-1">
                <span
                  data-component="checkbox"
                  data-readonly=""
                  data-checked={isTodoDone(todo) ? "" : undefined}
                  class="shrink-0"
                />
                <span
                  class="min-w-0 flex-1 text-ui-base"
                  classList={{
                    "text-foreground": !isTodoDone(todo),
                    "text-foreground-subtle line-through": isTodoDone(todo),
                  }}
                >
                  {todo.content}
                </span>
              </div>
            )}
          </For>
          <Show when={current.following > 0}>
            <div class="px-1.5 py-0.5 text-ui-sm text-foreground-subtle">
              {language.t("session.todo.more", { count: current.following })}
            </div>
          </Show>
        </div>
      ),
    }
  }
}
