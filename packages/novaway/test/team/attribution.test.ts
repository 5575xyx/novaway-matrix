import { describe, expect, test } from "bun:test"
import { summarize } from "@/team/attribution"
import type { Entry } from "@/team/ledger"
import type { RunTeam } from "@/team/run"

const entry = (over: Partial<Entry> & Pick<Entry, "actor" | "state">): Entry => ({
  id: "led_" + Math.random().toString(36).slice(2, 8),
  runID: "run_1",
  reservedTokens: 0,
  settledTokens: 0,
  at: 1,
  ...over,
})

const team = (id: string, over: Partial<RunTeam> = {}): RunTeam => ({
  id,
  runID: "run_1",
  phase: "delivered",
  roundCaptain: 1,
  dependsOn: [],
  artifactsOut: [],
  createdAt: 1,
  updatedAt: 1,
  ...over,
})

const roster = (captain: string, job: string) => ({
  profileID: "prof_1",
  name: "审查组",
  version: 1,
  captain,
  roster: [{ employee: { id: captain, name: "队长", job }, role: "captain", order: 0, canAutoDispatch: true }],
})

describe("team attribution", () => {
  test("splits the ledger by team and rolls it up by job", () => {
    const teams = [
      team("rt_a", { rosterSnapshot: roster("emp_a", "build") }),
      team("rt_b", { rosterSnapshot: roster("emp_b", "general") }),
    ]
    const result = summarize({
      teams,
      entries: [
        entry({ actor: "rt_a", state: "settled", reservedTokens: 100, settledTokens: 80 }),
        entry({ actor: "rt_a", state: "reserved", reservedTokens: 50 }),
        entry({ actor: "rt_b", state: "unknown", reservedTokens: 30 }),
      ],
    })

    // 总量口径与预算判断一致：预占 + 已结算 + 用量不明。
    expect(result).toMatchObject({ reserved: 50, settled: 80, unknown: 30, committed: 160 })
    expect(result.byActor.map((item) => [item.teamID, item.committed])).toEqual([
      ["rt_a", 130],
      ["rt_b", 30],
    ])
    // 队长口径要说清楚：现在只有队长真的跑会话。
    expect(result.byActor[0]).toMatchObject({ employeeID: "emp_a", job: "build", basis: "team" })
    expect(result.byJob).toEqual([
      { job: "build", committed: 130 },
      { job: "general", committed: 30 },
    ])
  })

  test("released reservations do not count as spend", () => {
    const result = summarize({
      teams: [team("rt_a")],
      entries: [entry({ actor: "rt_a", state: "released", reservedTokens: 500 })],
    })
    expect(result.committed).toBe(0)
    expect(result.byActor[0].committed).toBe(0)
  })

  test("a missing roster leaves the job unknown instead of inventing one", () => {
    const result = summarize({
      teams: [team("rt_a")],
      entries: [entry({ actor: "rt_a", state: "settled", settledTokens: 10 })],
    })
    // 名册读不回来就是读不回来：不猜岗位，也不把它算到别人头上。
    expect(result.byActor[0].job).toBeUndefined()
    expect(result.byJob).toEqual([{ job: "unknown", committed: 10 }])
  })
})
