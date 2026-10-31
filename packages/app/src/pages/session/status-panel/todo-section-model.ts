import type { Todo } from "@novaway/sdk/v2/client"

export interface TodoSectionModel {
  done: number
  total: number
  focus: Todo[]
  preceding: number
  following: number
}

// 完成语义与 todo 列表的展示口径一致：cancelled 也算 done
// （taskList.toggle 的默认筛选是「未完成」，这里把 cancelled 计入完成侧）。
export function isTodoDone(todo: Todo): boolean {
  return todo.status === "completed" || todo.status === "cancelled"
}

export function todoSectionModel(todos: Todo[]): TodoSectionModel | null {
  if (todos.length === 0) return null
  const total = todos.length
  const done = todos.filter(isTodoDone).length
  if (total <= 6) return { done, total, focus: todos, preceding: 0, following: 0 }

  // 3 条焦点窗口：优先锚在 in_progress 中心；无 in_progress 时锚到第一条未完成 todo；全完成时锚到尾部。
  // start 被 clamp 到 [0, total - windowSize]，保证 preceding + focus.length + following === total 恒成立。
  const inProgressIdx = todos.findIndex((todo) => todo.status === "in_progress")
  let center = inProgressIdx >= 0 ? inProgressIdx : todos.findIndex((todo) => !isTodoDone(todo))
  if (center < 0) center = total - 1
  const windowSize = 3
  const half = Math.floor(windowSize / 2)
  const start = Math.max(0, Math.min(total - windowSize, center - half))
  const focus = todos.slice(start, start + windowSize)
  return { done, total, focus, preceding: start, following: total - (start + windowSize) }
}
