import { Show, For, createMemo, createSignal, createEffect, on } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { Button } from "@opencode-ai/ui/button"
import { useSpring } from "@opencode-ai/ui/motion-spring"
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
      return (
        <Icon name="circle-check" size="small" class={baseClass} />
      )
    case "in_progress":
      return (
        <svg class={baseClass} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="4" />
        </svg>
      )
    case "cancelled":
      return (
        <Icon name="circle-x" size="small" class={baseClass} />
      )
    default:
      return (
        <svg class={baseClass} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10" />
        </svg>
      )
  }
}

export function FloatingTodoButton() {
  const language = useLanguage()
  const globalSync = useGlobalSync()
  const { sessionKey } = useSessionLayout()

  const [isExpanded, setIsExpanded] = createSignal(false)
  const [userDismissed, setUserDismissed] = createSignal(false)
  const [prevTaskCount, setPrevTaskCount] = createSignal(0)

  const sessionID = createMemo(() => sessionKey().split("/").at(-1) ?? "")

  const tasks = createMemo(() => {
    const id = sessionID()
    if (!id) return []
    return (globalSync.data.session_todo[id] ?? []) as Task[]
  })

  const taskCount = createMemo(() => tasks().length)
  const completedCount = createMemo(() =>
    tasks().filter(task => task.status === "completed").length
  )
  const hasInProgressTask = createMemo(() =>
    tasks().some(task => task.status === "in_progress")
  )

  const spring = useSpring(() => (isExpanded() ? 1 : 0), { visualDuration: 0.3, bounce: 0 })
  const scale = createMemo(() => spring())
  const opacity = createMemo(() => spring())

  const toggleExpand = () => {
    setIsExpanded(!isExpanded())
    setUserDismissed(!isExpanded())
  }

  createEffect(
    on(
      taskCount,
      (count, prev) => {
        if (prev === undefined) {
          setPrevTaskCount(count)
          return
        }

        if (count > 0 && prev === 0 && !userDismissed()) {
          setIsExpanded(true)
          setUserDismissed(false)
        }

        if (count > prev && !userDismissed()) {
          setIsExpanded(true)
        }

        setPrevTaskCount(count)
      },
      { defer: true },
    ),
  )

  return (
    <div class="fixed bottom-24 right-4 z-50 flex flex-col items-end gap-2">
      <Show
        when={isExpanded()}
      >
        <div
          class="w-80 max-h-96 bg-surface-panel border border-border-weaker-base rounded-xl shadow-2xl flex flex-col overflow-hidden"
          style={{
            opacity: opacity(),
            transform: `translateY(${scale() > 0.01 ? 0 : 10}px)`,
          }}
        >
          <div
            class="flex items-center justify-between px-4 py-3 border-b border-border-weaker-base bg-surface-raised-base cursor-pointer"
            onClick={toggleExpand}
          >
            <span class="text-12-medium text-text-strong">
              {language.t("taskList.title")}
            </span>
            <div class="flex items-center gap-2">
              <span class="text-11-regular text-text-weak">
                {completedCount()}/{taskCount()}
              </span>
              <Icon
                name="chevron-down"
                size="small"
                class="text-icon-weak"
                style={{ transform: `rotate(${scale() > 0.5 ? 180 : 0}deg)` }}
              />
            </div>
          </div>
          <div class="flex-1 overflow-y-auto p-2">
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
        </div>
      </Show>

      <Button
        size="small"
        variant="secondary"
        class={`rounded-full shadow-lg ${hasInProgressTask() ? "animate-pulse" : ""}`}
        onClick={toggleExpand}
      >
        <Icon name="checklist" size="small" class="mr-1" />
        <span class="text-12-medium">{taskCount()}</span>
      </Button>
    </div>
  )
}