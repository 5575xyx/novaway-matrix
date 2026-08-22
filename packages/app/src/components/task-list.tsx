import { Show, For, createMemo } from "solid-js"
import { Icon } from "@novaway/ui/icon"
import { useLanguage } from "@/context/language"
import { useGlobalSync } from "@/context/global-sync"
import { useSessionLayout } from "@/pages/session/session-layout"

type TaskStatus = "pending" | "in_progress" | "completed" | "cancelled"

type Task = {
  id: string
  content: string
  status: TaskStatus
  priority: "high" | "medium" | "low"
}

export function TaskList(props: { class?: string }) {
  const language = useLanguage()
  const globalSync = useGlobalSync()
  const { sessionKey } = useSessionLayout()

  const { view } = useSessionLayout()

  const sessionID = createMemo(() => sessionKey().split("/").at(-1) ?? "")

  const isCollapsed = createMemo(() => view().todoCollapsed.get())

  const toggleCollapse = () => {
    view().todoCollapsed.set(!isCollapsed())
  }

  const tasks = createMemo(() => {
    const id = sessionID()
    if (!id) return []
    return (globalSync.data.session_todo[id] ?? []) as Task[]
  })

  const completedCount = createMemo(() => tasks().filter((task) => task.status === "completed").length)

  const statusColor = (status: TaskStatus) => {
    switch (status) {
      case "completed":
        return "text-green-500"
      case "in_progress":
        return "text-orange-500"
      case "cancelled":
        return "text-gray-400"
      default:
        return "text-gray-300"
    }
  }

  const StatusIcon = (props: { status: TaskStatus; class?: string }) => {
    const color = statusColor(props.status)
    const baseClass = `shrink-0 mt-0.5 ${color} ${props.class ?? ""}`

    switch (props.status) {
      case "completed":
        return <Icon name="circle-check" size="small" class={baseClass} />
      case "in_progress":
        return (
          <svg
            class={baseClass}
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <circle cx="12" cy="12" r="4" />
          </svg>
        )
      case "cancelled":
        return <Icon name="circle-x" size="small" class={baseClass} />
      default:
        return (
          <svg
            class={baseClass}
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
          </svg>
        )
    }
  }

  return (
    <div class={`flex flex-col ${props.class ?? ""}`}>
      <div
        class="flex items-center justify-between px-3 py-2 border-b border-border-weaker-base bg-surface-panel cursor-pointer hover:bg-surface-raised-base-hover select-none"
        onClick={toggleCollapse}
      >
        <span class="text-12-medium text-text-strong">{language.t("taskList.title")}</span>
        <div class="flex items-center gap-2">
          <Show when={!isCollapsed()}>
            <span class="text-11-regular text-text-weak">
              {completedCount()}/{tasks().length}
            </span>
          </Show>
          <Icon name={isCollapsed() ? "chevron-right" : "chevron-down"} size="small" class="text-icon-weak" />
        </div>
      </div>
      <Show when={!isCollapsed()}>
        <div class="flex-1 overflow-y-auto py-1">
          <Show
            when={tasks().length > 0}
            fallback={
              <div class="flex items-center justify-center h-full text-12-regular text-text-weak">
                {language.t("taskList.empty")}
              </div>
            }
          >
            <For each={tasks()}>
              {(task) => (
                <div class="flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-surface-raised-base-hover">
                  <StatusIcon status={task.status} />
                  <span
                    class={`text-12-regular ${
                      task.status === "completed"
                        ? "line-through text-text-weak"
                        : task.status === "in_progress"
                          ? "font-medium text-text-strong"
                          : "text-text-base"
                    }`}
                  >
                    {task.content}
                  </span>
                </div>
              )}
            </For>
          </Show>
        </div>
      </Show>
    </div>
  )
}
