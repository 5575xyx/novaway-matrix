import { createEffect, onCleanup, onMount } from "solid-js"
import { getFilename } from "@novaway/core/util/path"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useLocal } from "@/context/local"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useSessionLayout } from "@/pages/session/session-layout"
import type { Todo } from "@novaway/sdk/v2/client"
import { sessionTitle } from "@/utils/session-title"
import type { Task, TaskGroup } from "./assistant-panel"

const isTaskStatus = (status: string): status is Task["status"] =>
  status === "pending" || status === "in_progress" || status === "completed" || status === "cancelled"

const isTaskPriority = (priority: string): priority is Task["priority"] =>
  priority === "high" || priority === "medium" || priority === "low"

const asTask = (todo: Todo, sessionID: string, index: number): Task | undefined => {
  if (!isTaskStatus(todo.status)) return undefined
  if (!isTaskPriority(todo.priority)) return undefined
  return {
    id: `${sessionID}:${todo.content}:${todo.priority}:${index}`,
    content: todo.content,
    status: todo.status,
    priority: todo.priority,
  }
}

// Electron IPC 的 Structured Clone 无法序列化 SolidJS store proxy 等响应式对象，
// 发送前转成普通 JSON 可序列化对象
const cloneForIpc = <T,>(value: T): T => JSON.parse(JSON.stringify(value))

export function FloatingAgentSync() {
  const local = useLocal()
  const globalSync = useGlobalSync()
  const language = useLanguage()
  const sdk = useSDK()
  const sync = useSync()
  const { sessionKey } = useSessionLayout()

  const sessionID = () => sessionKey().split("/").at(-1) ?? ""

  const taskGroups = (): TaskGroup[] => {
    const current = sessionID()
    return Object.entries(globalSync.data.session_todo)
      .map(([id, todos]) => {
        const tasks = todos.map((todo, index) => asTask(todo, id, index)).filter((task): task is Task => !!task)
        if (tasks.length === 0) return undefined
        const title = sessionTitle(sync.session.get(id)?.title)
        return {
          id,
          sessionID: id,
          label: `${getFilename(sdk.directory)} / ${
            title ?? language.t("assistant.monitor.session", { id: id.slice(-6) })
          }`,
          tasks,
        }
      })
      .filter((group): group is TaskGroup => !!group)
      .sort((a, b) => Number(b.id === current) - Number(a.id === current))
  }

  createEffect(() => {
    if (typeof window === "undefined") return
    const api = window.api
    if (!api?.updateFloatingAgentState) return
    const agent = local.agent.current()
    const agents = local.agent.list()
    const groups = taskGroups()
    void api.updateFloatingAgentState(
      cloneForIpc({
        current: agent?.name,
        agents,
        tasks: groups.flatMap((group) => group.tasks),
        taskGroups: groups,
        currentTaskGroupID: sessionID(),
      }),
    )
  })

  onMount(() => {
    if (typeof window === "undefined") return
    const api = window.api
    void api?.showFloatingWidget?.()
    if (!api?.onFloatingAgentChange) return
    const cleanup = api.onFloatingAgentChange((state) => {
      if (state.current) {
        local.agent.set(state.current)
      }
    })
    onCleanup(() => {
      cleanup?.()
    })
  })

  return null
}
