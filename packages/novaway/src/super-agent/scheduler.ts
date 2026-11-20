import { readyTasks } from "./state"
import type { SuperAgentRun, TaskNode, TaskNodeStatus } from "./types"

const transitions: Record<TaskNodeStatus, readonly TaskNodeStatus[]> = {
  pending: ["ready", "blocked"],
  ready: ["running", "blocked"],
  running: ["waiting", "succeeded", "failed", "needs_review"],
  waiting: ["running", "failed", "blocked"],
  retrying: ["running", "ready", "blocked", "needs_review"],
  succeeded: ["verifying", "failed"],
  verifying: ["completed", "failed", "needs_review"],
  completed: [],
  failed: ["retrying", "blocked", "needs_review"],
  blocked: ["ready", "needs_review"],
  needs_review: ["ready", "blocked"],
}

export class InvalidTaskTransition extends Error {}

export function transitionTask(task: TaskNode, status: TaskNodeStatus, now = Date.now()): TaskNode {
  if (task.status === status) return { ...task, updatedAt: now }
  if (!transitions[task.status].includes(status)) throw new InvalidTaskTransition(`${task.status} -> ${status}`)
  return { ...task, status, attempts: status === "running" ? task.attempts + 1 : task.attempts, updatedAt: now }
}

export class TaskScheduler {
  constructor(
    private run: SuperAgentRun,
    private readonly maxParallel = 8,
  ) {}

  snapshot() {
    return structuredClone(this.run)
  }

  ready(at = Date.now()) {
    return readyTasks(this.run, at).slice(0, this.maxParallel)
  }

  retry(taskID: string, now = Date.now()) {
    const task = this.require(taskID)
    if (task.status !== "failed") throw new InvalidTaskTransition(`${task.status} -> retrying`)
    if (!task.retryPolicy.retryable || task.attempts >= task.retryPolicy.maxAttempts)
      throw new Error(`task ${taskID} has exhausted its retry policy`)
    const retrying = transitionTask(task, "retrying", now)
    const ready = transitionTask(
      { ...retrying, retryAt: now + Math.max(0, retrying.retryPolicy.backoffMs) },
      "ready",
      now,
    )
    this.replace(ready)
    return ready
  }

  start(taskID: string) {
    let task = this.require(taskID)
    if (task.status === "pending") {
      task = transitionTask(task, "ready")
      this.replace(task)
    }
    const next = transitionTask(task, "running")
    this.replace(next)
    return next
  }

  settle(
    taskID: string,
    status: Extract<TaskNodeStatus, "succeeded" | "failed" | "waiting" | "needs_review">,
    output?: unknown,
  ) {
    const task = this.require(taskID)
    const next = transitionTask({ ...task, ...(output === undefined ? {} : { output }) }, status)
    this.replace(next)
    return next
  }

  verify(taskID: string) {
    const task = this.require(taskID)
    const next = transitionTask(task, "verifying")
    this.replace(next)
    return next
  }

  complete(taskID: string) {
    const task = this.require(taskID)
    const next = transitionTask(task, "completed")
    this.replace(next)
    return next
  }

  private require(taskID: string) {
    const task = this.run.graph.nodes.find((candidate) => candidate.id === taskID)
    if (!task) throw new Error(`task not found: ${taskID}`)
    return task
  }

  private replace(task: TaskNode) {
    this.run = {
      ...this.run,
      graph: { ...this.run.graph, nodes: this.run.graph.nodes.map((item) => (item.id === task.id ? task : item)) },
      updatedAt: task.updatedAt,
    }
  }
}
