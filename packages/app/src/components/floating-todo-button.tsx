import { createMemo, createSignal, createEffect, on, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useLocal } from "@/context/local"
import { useLayout } from "@/context/layout"
import { useGlobalSync } from "@/context/global-sync"
import { useSessionLayout } from "@/pages/session/session-layout"
import { Persist, persisted } from "@/utils/persist"
import { AssistantPanel, type AgentItem, type Task } from "./assistant-panel"
import type { Todo } from "@opencode-ai/sdk/v2/client"

const COLLAPSED_SIZE = 112
const EDGE_PADDING = 8

const isTaskStatus = (status: string): status is Task["status"] =>
  status === "pending" || status === "in_progress" || status === "completed" || status === "cancelled"

const isTaskPriority = (priority: string): priority is Task["priority"] =>
  priority === "high" || priority === "medium" || priority === "low"

const asTask = (todo: Todo): Task | undefined => {
  if (!isTaskStatus(todo.status)) return undefined
  if (!isTaskPriority(todo.priority)) return undefined
  return { content: todo.content, status: todo.status, priority: todo.priority }
}

const clampPosition = (position: { right: number; bottom: number }) => {
  const maxRight = Math.max(EDGE_PADDING, window.innerWidth - COLLAPSED_SIZE - EDGE_PADDING)
  const maxBottom = Math.max(EDGE_PADDING, window.innerHeight - COLLAPSED_SIZE - EDGE_PADDING)

  return {
    right: Math.max(EDGE_PADDING, Math.min(position.right, maxRight)),
    bottom: Math.max(EDGE_PADDING, Math.min(position.bottom, maxBottom)),
  }
}

export function FloatingTodoButton() {
  const language = useLanguage()
  const globalSync = useGlobalSync()
  const local = useLocal()
  const layout = useLayout()
  const { sessionKey } = useSessionLayout()

  const [position, setPosition] = persisted(
    Persist.global("floating.todo.position.v1"),
    createStore({
      right: 16,
      bottom: 96,
    }),
  )
  const [isExpanded, setIsExpanded] = createSignal(false)
  const [userDismissed, setUserDismissed] = createSignal(false)
  let lastDragPointer: { x: number; y: number } | undefined

  const sessionID = createMemo(() => sessionKey().split("/").at(-1) ?? "")

  const tasks = createMemo(() => {
    const id = sessionID()
    if (!id) return []
    return (globalSync.data.session_todo[id] ?? []).map(asTask).filter((task): task is Task => !!task)
  })

  const taskCount = createMemo(() => tasks().length)
  const hasInProgressTask = createMemo(() => tasks().some((task) => task.status === "in_progress"))

  const toggleExpand = () => {
    const next = !isExpanded()
    setIsExpanded(next)
    setUserDismissed(!next)
  }

  const startPanelDrag = (pointerX: number, pointerY: number) => {
    lastDragPointer = { x: pointerX, y: pointerY }
  }

  const movePanel = (pointerX: number, pointerY: number) => {
    const previous = lastDragPointer
    lastDragPointer = { x: pointerX, y: pointerY }
    if (!previous) return

    const dx = pointerX - previous.x
    const dy = pointerY - previous.y
    setPosition(
      clampPosition({
        right: position.right - dx,
        bottom: position.bottom - dy,
      }),
    )
  }

  const clampPanel = () => {
    lastDragPointer = undefined
    setPosition(clampPosition(position))
  }

  onMount(() => {
    window.addEventListener("resize", clampPanel)
    onCleanup(() => window.removeEventListener("resize", clampPanel))
  })

  createEffect(
    on(
      taskCount,
      (count, prev) => {
        if (prev === undefined) return

        if (count > 0 && prev === 0 && !userDismissed()) {
          setIsExpanded(true)
          setUserDismissed(false)
          return
        }

        if (count > prev && !userDismissed()) {
          setIsExpanded(true)
        }
      },
      { defer: true },
    ),
  )

  const currentAgent = () => local.agent.current()

  const agents = createMemo<AgentItem[]>(() => {
    const mode = layout.mode.current()
    const list = local.agent.list() as AgentItem[]
    if (mode === "forge") {
      const plan = list.find((item) => item.name === "plan")
      const build = list.find((item) => item.name === "build")
      return [plan, build].filter((item): item is AgentItem => !!item)
    }
    return list
  })

  return (
    <AssistantPanel
      class="fixed"
      style={{
        right: `${position.right}px`,
        bottom: `${position.bottom}px`,
      }}
      currentAgent={currentAgent()}
      agents={agents()}
      tasks={tasks()}
      expanded={isExpanded()}
      onExpandToggle={toggleExpand}
      onAgentChange={(name) => local.agent.set(name)}
      onDragStart={startPanelDrag}
      onDragMove={movePanel}
      onDragEnd={clampPanel}
      title={language.t("assistant.title")}
      hasInProgressTask={hasInProgressTask()}
      draggable
    />
  )
}
