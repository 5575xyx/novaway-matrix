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

/** 子代理 job 关联的会话；后台命令的 sessionId 是「在哪个会话里启动的」。 */
export function jobSessionID(job: BackgroundJob): string | undefined {
  const value = job.metadata?.sessionId
  return typeof value === "string" && value ? value : undefined
}

/**
 * 团队卡片已经展示了这些成员的会话，后台任务卡片不再重复列一遍。
 * 只过滤子代理（agent）job；shell / monitor / subscribe / orchestrator
 * 不在团队卡片里，必须保留。
 */
export function hideTeamMemberJobs(
  jobs: readonly BackgroundJob[],
  hidden: ReadonlySet<string>,
): BackgroundJob[] {
  if (hidden.size === 0) return jobs as BackgroundJob[]
  return jobs.filter((job) => {
    if (jobKind(job) !== "agent") return true
    const child = jobSessionID(job) ?? job.id
    return !child || !hidden.has(child)
  })
}

/** 有独立 kind 的任务在标题前显示一个小标签；子代理保持无标签（最常见）。 */
export function jobKindLabelKey(job: BackgroundJob): string | undefined {
  const kind = jobKind(job)
  return kind === "agent" || kind === "other" ? undefined : `statusPanel.background.kind.${kind}`
}

/**
 * 监控/订阅在结束后仍值得展示最后的输出（就是发给模型的通知正文）。
 *
 * error 也要展示：失败时正文里才有"跑到哪一步、报了什么"的细节。
 */
export function showsResult(job: BackgroundJob): boolean {
  const kind = jobKind(job)
  return (kind === "monitor" || kind === "subscribe") && job.status !== "running" && Boolean(job.output)
}

/** 失败任务正文里有用的是最后几行（state 与输出尾部），不是通知头两行。 */
export function resultBody(job: BackgroundJob): string {
  const output = job.output ?? ""
  if (job.status !== "error") return output
  return output
    .trimEnd()
    .split("\n")
    .filter((line) => line.trim() !== "")
    .slice(-3)
    .join("\n")
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

/** 结束时间。
 *
 * 调用方常写成 `Number(job.completed_at)`，任务还没结束时那是 `NaN`。
 * `NaN === undefined` 是 `false`，所以"是否已结束"必须按有限数判断——
 * 之前直接判 `=== undefined`，运行中的任务会把 `NaN` 当结束时间、算出 0 秒，
 * 卡片上就永远是 `0s`（点一次停止、`completed_at` 有真实值后才正常）。
 */
const endedAt = (end: unknown): number | undefined => {
  const value = typeof end === "number" || typeof end === "string" ? Number(end) : NaN
  return Number.isFinite(value) ? value : undefined
}

export function formatElapsed(started: unknown, end: unknown, now: number): string {
  const seconds = Math.max(0, Math.round(((endedAt(end) ?? now) - num(started)) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60) return `${minutes}m ${rest}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}
