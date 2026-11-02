/**
 * 执行中「现在在做什么」的纯计算。
 *
 * 竞品（Magentic-UI / AutoGen Studio / LangGraph Studio）都把「此刻走到哪」放在
 * 最显眼的位置：用户不需要读日志，只要看到进度和正在做的任务，就知道系统还在动。
 *
 * 这里只做计数与筛选，不读时间、不发请求，方便单测固定「已完成 / 进行中 /
 * 失败」的口径 —— 界面上的数字必须和任务板上的状态一一对应，不能各算各的。
 */

export type LiveTask = {
  id: string
  subject: string
  status: string
  owner?: string
}

export type LiveTeam = {
  id: string
  name: string
  phase: string
}

export type LiveSummary = {
  total: number
  done: number
  active: number
  failed: number
  pending: number
  /** 已完成占比；没有任务时为 0，界面不该画一条假的满格进度。 */
  percent: number
  /** 最多三条「正在做」，再多就只报数量。 */
  current: LiveTask[]
  deliveredTeams: number
  totalTeams: number
}

const ACTIVE = "in_progress"
const DONE = "completed"
const FAILED = new Set(["failed", "cancelled"])

export function summarizeLive(input: { tasks: readonly LiveTask[]; teams: readonly LiveTeam[] }): LiveSummary {
  const tasks = input.tasks ?? []
  const done = tasks.filter((task) => task.status === DONE).length
  const activeTasks = tasks.filter((task) => task.status === ACTIVE)
  const failed = tasks.filter((task) => FAILED.has(task.status)).length
  const pending = tasks.filter((task) => task.status === "pending").length
  const total = tasks.length

  return {
    total,
    done,
    active: activeTasks.length,
    failed,
    pending,
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
    current: activeTasks.slice(0, 3),
    deliveredTeams: input.teams.filter((team) => team.phase === "delivered").length,
    totalTeams: input.teams.length,
  }
}
