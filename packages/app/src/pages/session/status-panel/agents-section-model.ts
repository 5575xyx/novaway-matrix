import type { TeamMemberView, TeamTaskView } from "@novaway/sdk/v2"

export type AgentMember = TeamMemberView
export type AgentTask = TeamTaskView

/** Archived members are finished; the panel only shows the live roster. */
export function visibleMembers(members: readonly AgentMember[]): AgentMember[] {
  return members
    .filter((member) => member.status !== "archived")
    .toSorted((a, b) => {
      if (a.role !== b.role) return a.role === "lead" ? -1 : 1
      if (a.status !== b.status) return a.status === "active" ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

/** Panel summary: `active/total` when someone is working, otherwise just the total. */
export function memberStat(members: readonly AgentMember[]): string {
  const visible = visibleMembers(members)
  const active = visible.filter((member) => member.status === "active").length
  return active > 0 ? `${active}/${visible.length}` : String(visible.length)
}

export function taskProgress(tasks: readonly AgentTask[]): { done: number; total: number } {
  const total = tasks.length
  const done = tasks.filter((task) => task.status === "completed").length
  return { done, total }
}

/** Current task subject for a member, if the task is still on the board. */
export function currentTask(member: AgentMember, tasks: readonly AgentTask[]): AgentTask | undefined {
  if (!member.currentTaskID) return undefined
  return tasks.find((task) => task.id === member.currentTaskID)
}

/** Members whose execution has stopped (idle or archived). */
export function isIdle(member: AgentMember): boolean {
  return member.status !== "active"
}

/** A member can receive a steering message unless it has been archived. */
export function canMessage(member: AgentMember): boolean {
  return member.status !== "archived"
}

/** Only a working member can be stopped; idle members have nothing running. */
export function canStop(member: AgentMember): boolean {
  return member.status === "active"
}

export type AgentUsage = NonNullable<TeamMemberView["usage"]>

// Generated wire types allow the JSON spellings of non-finite numbers; treat
// anything that is not a finite number as zero instead of rendering "NaN".
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0)

/** Compact token counts: 950 → "950", 1 500 → "1.5k", 12 345 → "12k", 1 500 000 → "1.5M". */
export function compactTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0"
  if (value < 1_000) return String(Math.round(value))
  if (value < 1_000_000) {
    const scaled = value / 1_000
    return `${scaled < 10 ? scaled.toFixed(1) : Math.round(scaled)}k`
  }
  return `${(value / 1_000_000).toFixed(1)}M`
}

export function formatMoney(value: number, locale: string): string {
  const digits = value > 0 && value < 0.01 ? 4 : 2
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)
}

/** Row label: cost and total tokens, or undefined when nothing was spent yet. */
export function usageLabel(usage: AgentUsage | undefined, locale: string): string | undefined {
  if (!usage) return undefined
  const cost = num(usage.cost)
  const total = num(usage.total)
  if (cost <= 0 && total <= 0) return undefined
  return `${formatMoney(cost, locale)} · ${compactTokens(total)}`
}

export function usageBreakdown(usage: AgentUsage | undefined, locale: string): string | undefined {
  if (!usage) return undefined
  const cost = num(usage.cost)
  const input = num(usage.input)
  const output = num(usage.output)
  const cache = num(usage.cacheRead) + num(usage.cacheWrite)
  if (cost <= 0 && input + output + cache <= 0) return undefined
  return [
    formatMoney(cost, locale),
    `${compactTokens(input)} in`,
    `${compactTokens(output)} out`,
    `${compactTokens(cache)} cache`,
  ].join(" · ")
}
