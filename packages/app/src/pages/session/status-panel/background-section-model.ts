import type { BackgroundJobInfo } from "@novaway/sdk/v2"

const num = (input: unknown): number => {
  if (typeof input === "number" && Number.isFinite(input)) return input
  const parsed = Number(input)
  return Number.isFinite(parsed) ? parsed : 0
}

export type BackgroundJob = BackgroundJobInfo

/** 完成的任务在卡片里再多留一会儿，用户能看到结果；之后自动消失。 */
export const COMPLETED_VISIBLE_MS = 90_000

export function isJobVisible(job: BackgroundJob, now: number): boolean {
  if (job.status === "running") return true
  if (job.completed_at === undefined) return false
  return now - num(job.completed_at) < COMPLETED_VISIBLE_MS
}

export function visibleBackgroundJobs(jobs: readonly BackgroundJob[], now: number): BackgroundJob[] {
  return jobs
    .filter((job) => isJobVisible(job, now))
    .toSorted((a, b) => {
      // 运行中的排前面；同状态按开始时间倒序（新的在上）。
      if (a.status === "running" && b.status !== "running") return -1
      if (b.status === "running" && a.status !== "running") return 1
      return num(b.started_at) - num(a.started_at)
    })
}

/**
 * 后台任务的种类。
 *
 * 面板以前只区分 shell 与非 shell，于是 `monitor` / `subscribe` / 编排计划
 * 全都显示成"子代理"。种类决定图标与标签，也让"这个 job 是什么"一眼可见。
 */
export type JobKind = "agent" | "shell" | "monitor" | "subscribe" | "orchestrator" | "other"

const KIND_BY_TYPE: Record<string, JobKind> = {
  task: "agent",
  shell: "shell",
  monitor: "monitor",
  subscribe: "subscribe",
  orchestrator: "orchestrator",
}

export function jobKind(job: BackgroundJob): JobKind {
  return KIND_BY_TYPE[String(job.type ?? "")] ?? "other"
}

/** 有独立 kind 的任务在标题前显示一个小标签；子代理保持无标签（最常见）。 */
export function jobKindLabelKey(job: BackgroundJob): string | undefined {
  const kind = jobKind(job)
  return kind === "agent" || kind === "other" ? undefined : `statusPanel.background.kind.${kind}`
}

/** 异步事件源在任务结束后仍值得展示最后的输出（就是发给模型的通知正文）。 */
export function showsResult(job: BackgroundJob): boolean {
  const kind = jobKind(job)
  return (kind === "monitor" || kind === "subscribe") && job.status === "completed" && Boolean(job.output)
}

/**
 * 这个后台任务是从上一个进程恢复来的。
 *
 * 进程重启后 `background/resume.ts` 会用记录下来的参数重新拉起 monitor /
 * subscribe，标题前加这个标签，用户才知道"这不是我刚启动的"。
 */
export function isResumed(job: BackgroundJob): boolean {
  return job.metadata?.resumed === true
}

/** 订阅因缺少请求头而无法自动恢复（请求头从不落库）。 */
export function resumeSkipped(job: BackgroundJob): boolean {
  return job.metadata?.resumable === true && job.status === "cancelled" && Boolean(job.metadata?.auth)
}

/** 状态面板顶部摘要：`2 运行中 / 共 3 条`。 */
export function backgroundJobStat(jobs: readonly BackgroundJob[], now: number): string {
  const visible = visibleBackgroundJobs(jobs, now)
  const running = visible.filter((job) => job.status === "running").length
  return running > 0 ? `${running}/${visible.length}` : String(visible.length)
}

export function formatElapsed(started: number, end: number | undefined, now: number): string {
  const seconds = Math.max(0, Math.round(((end === undefined ? now : num(end)) - num(started)) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60) return `${minutes}m ${rest}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}
