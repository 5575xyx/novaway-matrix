import { describe, expect, test } from "bun:test"
import type { TeamMemberView, TeamTaskView } from "@novaway/sdk/v2"
import { currentTask, isIdle, memberStat, taskProgress, visibleMembers } from "./agents-section-model"
import {
  activeWorkers,
  leadOnlyInProgress,
  openTasks,
  taskOwnerName,
} from "./agents-section-model"

const member = (input: Partial<TeamMemberView> & { name: string }): TeamMemberView => ({
  sessionID: `ses_${input.name}`,
  agent: "general",
  role: "worker",
  status: "idle",
  ...input,
})

const task = (input: Partial<TeamTaskView> & { id: string }): TeamTaskView => ({
  subject: `task ${input.id}`,
  status: "pending",
  blockedBy: [],
  ...input,
})

describe("agents section model", () => {
  test("visibleMembers hides archived and puts lead first", () => {
    const list = visibleMembers([
      member({ name: "worker-b", status: "active" }),
      member({ name: "lead", role: "lead" }),
      member({ name: "archived", status: "archived" }),
    ])
    expect(list.map((item) => item.name)).toEqual(["lead", "worker-b"])
  })

  test("visibleMembers sorts active ahead of idle", () => {
    const list = visibleMembers([
      member({ name: "idle-one", status: "idle" }),
      member({ name: "active-one", status: "active" }),
    ])
    expect(list.map((item) => item.name)).toEqual(["active-one", "idle-one"])
  })

  test("memberStat shows active/total while working", () => {
    const members = [
      member({ name: "a", status: "active" }),
      member({ name: "b", status: "idle" }),
      member({ name: "c", status: "archived" }),
    ]
    expect(memberStat(members)).toBe("1/2")
    expect(memberStat([member({ name: "a", status: "idle" })])).toBe("1")
  })

  test("taskProgress counts completed tasks", () => {
    expect(taskProgress([task({ id: "1", status: "completed" }), task({ id: "2" })])).toEqual({ done: 1, total: 2 })
    expect(taskProgress([])).toEqual({ done: 0, total: 0 })
  })

  test("currentTask resolves the member task id", () => {
    const members = [member({ name: "a", status: "active", currentTaskID: "2" })]
    expect(currentTask(members[0]!, [task({ id: "1" }), task({ id: "2" })])?.id).toBe("2")
    expect(currentTask(members[0]!, [])).toBeUndefined()
  })

  test("isIdle is true for anything not active", () => {
    expect(isIdle(member({ name: "a", status: "active" }))).toBe(false)
    expect(isIdle(member({ name: "a", status: "idle" }))).toBe(true)
    expect(isIdle(member({ name: "a", status: "archived" }))).toBe(true)
  })

  test("openTasks keeps unfinished work and puts in_progress first", () => {
    const list = openTasks([
      task({ id: "done", status: "completed" }),
      task({ id: "cancelled", status: "cancelled" }),
      task({ id: "queued" }),
      task({ id: "running", status: "in_progress" }),
    ])
    expect(list.map((item) => item.id)).toEqual(["running", "queued"])
  })

  test("taskOwnerName resolves the owner session to its roster name", () => {
    const members = [member({ name: "worker-a" })]
    expect(taskOwnerName(task({ id: "1", ownerSessionID: "ses_worker-a" }), members)).toBe("worker-a")
    expect(taskOwnerName(task({ id: "2", ownerSessionID: "ses_unknown" }), members)).toBeUndefined()
    expect(taskOwnerName(task({ id: "3" }), members)).toBeUndefined()
  })

  test("activeWorkers ignores the lead and idle members", () => {
    const members = [
      member({ name: "lead", role: "lead", status: "active" }),
      member({ name: "busy", status: "active" }),
      member({ name: "idle" }),
    ]
    expect(activeWorkers(members).map((item) => item.name)).toEqual(["busy"])
  })

  // 回归：看板任务被主代理自己 claim 后是 in_progress，但没有派任何子代理。
  // 面板需要提示“无子代理执行”，而不是让人以为有 3 个员工在并行。
  test("leadOnlyInProgress flags board tasks that only the lead holds", () => {
    const lead = member({ name: "lead", role: "lead", status: "active" })
    const tasks = [task({ id: "1", status: "in_progress", ownerSessionID: "ses_lead" })]
    expect(leadOnlyInProgress(tasks, [lead])).toBe(true)
    // 有一个真正的 worker 在跑就不提示
    expect(leadOnlyInProgress(tasks, [lead, member({ name: "busy", status: "active" })])).toBe(false)
    // 没有进行中的任务也不提示
    expect(leadOnlyInProgress([task({ id: "1" })], [lead])).toBe(false)
  })
})

import { canMessage, canStop } from "./agents-section-model"

describe("agents actions", () => {
  test("canMessage excludes archived members", () => {
    expect(canMessage(member({ name: "a", status: "active" }))).toBe(true)
    expect(canMessage(member({ name: "a", status: "idle" }))).toBe(true)
    expect(canMessage(member({ name: "a", status: "archived" }))).toBe(false)
  })

  test("canStop only applies to working members", () => {
    expect(canStop(member({ name: "a", status: "active" }))).toBe(true)
    expect(canStop(member({ name: "a", status: "idle" }))).toBe(false)
  })
})

import { compactTokens, formatMoney, usageBreakdown, usageLabel } from "./agents-section-model"
import type { TeamUsageView } from "@novaway/sdk/v2"

const usage = (input: Partial<TeamUsageView>): TeamUsageView => ({
  cost: 0,
  input: 0,
  output: 0,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
  total: 0,
  ...input,
})

describe("agent usage labels", () => {
  test("compactTokens keeps small values exact and compacts large ones", () => {
    expect(compactTokens(0)).toBe("0")
    expect(compactTokens(950)).toBe("950")
    expect(compactTokens(1_500)).toBe("1.5k")
    expect(compactTokens(12_345)).toBe("12k")
    expect(compactTokens(1_500_000)).toBe("1.5M")
    expect(compactTokens(Number.NaN)).toBe("0")
  })

  test("usageLabel hides a member with no spend", () => {
    expect(usageLabel(undefined, "en-US")).toBeUndefined()
    expect(usageLabel(usage({}), "en-US")).toBeUndefined()
    expect(usageLabel(usage({ cost: 0.5, total: 1_200 }), "en-US")).toBe("$0.50 · 1.2k")
  })

  test("sub-cent spend keeps enough precision to stay readable", () => {
    expect(formatMoney(0.004, "en-US")).toBe("$0.0040")
    expect(formatMoney(1.5, "en-US")).toBe("$1.50")
  })

  test("usageBreakdown separates input, output and cache", () => {
    const label = usageBreakdown(
      usage({ cost: 0.25, input: 10_000, output: 500, cacheRead: 2_000, cacheWrite: 0, total: 12_500 }),
      "en-US",
    )
    expect(label).toBe("$0.25 · 10k in · 500 out · 2.0k cache")
    expect(usageBreakdown(undefined, "en-US")).toBeUndefined()
  })
})
