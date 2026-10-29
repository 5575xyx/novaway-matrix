// 定时任务的存储：会话内的内存任务 + 可选的落盘任务。
//
// 落盘格式对齐 CC 的 `.claude/scheduled_tasks.json`：
//   { "tasks": [{ id, cron, prompt, createdAt, lastFiredAt?, recurring, durable, sessionID }] }
// 这样用户手工编辑或迁移配置时格式不变。
//
// 内存任务随进程消失（CC 的 session-only 语义）；落盘任务下次启动时按项目目录
// 重新载入，只有找到原会话时才继续触发。

import { randomBytes } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { nextRunAt } from "./cron"

/** 循环任务的最长寿命：到期后再触发一次就删除，避免会话变成永动机。 */
export const RECURRING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export const STORE_FILE = path.join(".claude", "scheduled_tasks.json")

export type Task = {
  /** 8 位十六进制 id，短到能在对话里粘贴。 */
  id: string
  cron: string
  prompt: string
  createdAt: number
  /** 最近一次触发时间；重启后据此重建下个触发点。 */
  lastFiredAt?: number
  recurring: boolean
  /** true 时写入项目目录下的 scheduled_tasks.json。 */
  durable: boolean
  sessionID: string
  /** 任务所属项目目录，落盘任务按它分组。 */
  directory: string
  /** 循环任务的过期时间；一次性任务没有。 */
  expiresAt?: number
}

const tasks = new Map<string, Task>()
const loaded = new Set<string>()

export function id() {
  return randomBytes(4).toString("hex")
}

export function reset() {
  tasks.clear()
  loaded.clear()
}

export function all(): Task[] {
  return [...tasks.values()]
}

export function forSession(sessionID: string): Task[] {
  return all().filter((task) => task.sessionID === sessionID)
}

export function get(taskID: string) {
  return tasks.get(taskID)
}

export function add(task: Task) {
  tasks.set(task.id, task)
  return task
}

export function remove(taskID: string) {
  return tasks.delete(taskID)
}

export function markFired(taskID: string, at: number) {
  const task = tasks.get(taskID)
  if (!task) return undefined
  task.lastFiredAt = at
  return task
}

/** 任务是否已经到了该触发的时间。 */
export function due(task: Task, now: number) {
  const anchor = task.lastFiredAt ?? task.createdAt
  const next = nextRunAt(task.cron, new Date(anchor))
  return next !== undefined && next <= now ? next : undefined
}

/** 循环任务到期后还要再触发一次，然后删除。 */
export function expired(task: Task, now: number) {
  return task.expiresAt !== undefined && now >= task.expiresAt
}

export async function load(directory: string) {
  if (loaded.has(directory)) return []
  loaded.add(directory)

  const file = path.join(directory, STORE_FILE)
  const raw = await fs.readFile(file, "utf8").catch(() => undefined)
  if (!raw) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }

  const list = (parsed as { tasks?: unknown })?.tasks
  if (!Array.isArray(list)) return []

  const restored: Task[] = []
  for (const item of list) {
    const value = item as Partial<Task>
    if (typeof value.cron !== "string" || typeof value.prompt !== "string") continue
    if (!nextRunAt(value.cron, new Date())) continue
    const task: Task = {
      id: typeof value.id === "string" ? value.id : id(),
      cron: value.cron,
      prompt: value.prompt,
      createdAt: typeof value.createdAt === "number" ? value.createdAt : Date.now(),
      ...(typeof value.lastFiredAt === "number" ? { lastFiredAt: value.lastFiredAt } : {}),
      recurring: value.recurring !== false,
      durable: true,
      sessionID: typeof value.sessionID === "string" ? value.sessionID : "",
      directory,
      ...(value.recurring !== false ? { expiresAt: (value.createdAt as number) + RECURRING_MAX_AGE_MS } : {}),
    }
    tasks.set(task.id, task)
    restored.push(task)
  }
  return restored
}

/** 把一个任务写回它所属项目目录的 scheduled_tasks.json。 */
export async function persist(directory: string) {
  const file = path.join(directory, STORE_FILE)
  const list = all()
    .filter((task) => task.durable && task.directory === directory)
    .map((task) => ({
      id: task.id,
      cron: task.cron,
      prompt: task.prompt,
      createdAt: task.createdAt,
      ...(task.lastFiredAt !== undefined ? { lastFiredAt: task.lastFiredAt } : {}),
      recurring: task.recurring,
      sessionID: task.sessionID,
    }))

  if (list.length === 0) {
    await fs.rm(file, { force: true }).catch(() => {})
    return
  }
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify({ tasks: list }, null, 2) + "\n", "utf8")
}
