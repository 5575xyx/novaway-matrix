import type { Info as TodoInfo } from "@/session/todo"
import { createHash } from "node:crypto"
import type { WorkflowTask } from "./workflow-schema"

export type ReconcileOrigin = "artifact" | "session"

export type ReconcileState = {
  artifactRevision: number
  sessionRevision: number
  origin: ReconcileOrigin
}

export type ReconcileResult =
  | { type: "unchanged"; todos: TodoInfo[]; state: ReconcileState }
  | { type: "update-session"; todos: TodoInfo[]; state: ReconcileState }
  | { type: "update-artifact"; tasks: Array<{ id: string; status: WorkflowTask["status"] }>; state: ReconcileState }
  | { type: "conflict"; code: "TASK_STATE_CONFLICT"; taskIDs: string[] }

const taskPattern = /^\[([^\]]+)\]\s+(.+)$/

function todoStatus(status: WorkflowTask["status"]): string {
  if (status === "completed") return "completed"
  if (status === "in_progress") return "in_progress"
  if (status === "cancelled") return "cancelled"
  return "pending"
}

function taskStatus(status: string): WorkflowTask["status"] {
  if (status === "completed") return "completed"
  if (status === "in_progress") return "in_progress"
  if (status === "cancelled") return "cancelled"
  return "pending"
}

export function taskTodos(tasks: ReadonlyArray<WorkflowTask>): TodoInfo[] {
  return tasks.map((task) => ({
    content: `[${task.id}] ${task.title}`,
    status: todoStatus(task.status),
    priority: task.status === "blocked" ? "high" : "medium",
  }))
}

export function todoRevision(todos: ReadonlyArray<TodoInfo>) {
  return Number.parseInt(createHash("sha256").update(JSON.stringify(todos)).digest("hex").slice(0, 12), 16)
}

function todoTasks(todos: ReadonlyArray<TodoInfo>) {
  return todos.flatMap((todo) => {
    const match = taskPattern.exec(todo.content)
    if (!match) return []
    return [{ id: match[1], title: match[2], status: taskStatus(todo.status) }]
  })
}

export function reconcileTasks(input: {
  tasks: ReadonlyArray<WorkflowTask>
  todos: ReadonlyArray<TodoInfo>
  state: ReconcileState
  artifactRevision: number
  sessionRevision: number
}): ReconcileResult {
  const expected = taskTodos(input.tasks)
  if (JSON.stringify(expected) === JSON.stringify(input.todos)) {
    return {
      type: "unchanged",
      todos: expected,
      state: {
        artifactRevision: input.artifactRevision,
        sessionRevision: input.sessionRevision,
        origin: input.state.origin,
      },
    }
  }

  const artifactChanged = input.artifactRevision !== input.state.artifactRevision
  const sessionChanged = input.sessionRevision !== input.state.sessionRevision
  if (artifactChanged && sessionChanged) {
    const session = new Map(todoTasks(input.todos).map((task) => [task.id, task.status]))
    const conflicts = input.tasks
      .filter((task) => session.has(task.id) && session.get(task.id) !== task.status)
      .map((task) => task.id)
    if (conflicts.length > 0) return { type: "conflict", code: "TASK_STATE_CONFLICT", taskIDs: conflicts }
  }

  if (sessionChanged && !artifactChanged) {
    const known = new Set(input.tasks.map((task) => task.id))
    return {
      type: "update-artifact",
      tasks: todoTasks(input.todos)
        .filter((task) => known.has(task.id))
        .map((task) => ({ id: task.id, status: task.status })),
      state: { artifactRevision: input.artifactRevision, sessionRevision: input.sessionRevision, origin: "session" },
    }
  }

  return {
    type: "update-session",
    todos: expected,
    state: { artifactRevision: input.artifactRevision, sessionRevision: input.sessionRevision, origin: "artifact" },
  }
}

export * as PowersNexusReconcile from "./reconcile"
