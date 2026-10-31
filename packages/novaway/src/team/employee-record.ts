import { eq, inArray } from "drizzle-orm"
import { Database } from "@/storage/db"
import { SessionTable } from "@/session/session.sql"
import { TeamAcceptanceTable, TeamRunEventTable, TeamRunTable, TeamRunTeamTable, TeamVerificationTable } from "./run.sql"

/**
 * 员工的事实记录（§12.1）：参与、驳回、一次通过率、参与的运行墙钟。
 *
 * §12.1 的边界原话是「只做事实记录，不做排名」—— 这里按那句话实现：
 *
 * 1. **参与 = 名册快照里有这个人**（或会话归属确认他在那次运行里）。
 *    名册是发起时冻结的，之后改模板不会倒过来改写历史。
 * 2. **驳回与一次通过率挂在团队上，不挂在个人身上。** 验收项的责任人是团队
 *    （`team_acceptance.owner`），返工也是整队退回重做。把它们算到队长或某个成员
 *    头上就是猜；这里照实说「这是所在团队的事实」，并在 `caveats` 里写明。
 * 3. **耗时是运行的墙钟，不是个人工时。** 并行成员共享同一段时间，相加没有意义；
 *    这里只给「参与过的已结束运行」的平均墙钟，并注明口径。
 * 4. **分母不够就不给比率。** 没有验收项时 `rate` 不出现，而不是 0%。
 */

export type Participation = {
  runID: string
  teamID: string
  captain: boolean
  /** `roster`：名册快照里有他；`session`：只有会话归属，名册里没有（无模板的运行等）。 */
  source: "roster" | "session"
  /** 参与时间：团队创建时间，或最早一条归属会话的更新时间。 */
  at: number
}

export type Rework = { runID: string; teamID: string; reasons: readonly string[] }

/** 一条验收项的**首次**验证结论；没有验证记录时 `outcome` 缺失。 */
export type AcceptanceResult = { runID: string; owner: string; outcome?: "pass" | "fail" | "unverified" }

export type RunWall = { id: string; startedAt?: number; endedAt?: number }

export type Input = {
  employeeID: string
  participations: readonly Participation[]
  reworks: readonly Rework[]
  acceptances: readonly AcceptanceResult[]
  runs: readonly RunWall[]
}

export type Facts = {
  employeeID: string
  participations: { runs: number; teams: number; asCaptain: number; lastAt?: number }
  rework: { total: number; runs: number; top: Array<{ reason: string; count: number }> }
  /** 一次通过率：首次验证就 pass 的验收项占比。 */
  firstPass: { lines: number; passed: number; rate?: number }
  /** 参与过的、已结束运行的墙钟。并行成员共享，不能当个人工时。 */
  wall: { measured: number; avgMs?: number; totalMs?: number }
  /** 必须照实说的口径，界面直接显示，不自己再组织措辞。 */
  caveats: string[]
}

const MAX_TOP = 5

/** 与指标、回放一致：次数相同按码元顺序，报表不随环境语言换顺序。 */
const stable = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

const text = (value: unknown) => (typeof value === "string" ? value : undefined)

/** 驳回原因：优先结构化 `failed`，其次 `reason`，最后「未分类」。 */
export function reasonsOf(payload: Record<string, unknown> | undefined): string[] {
  const failed: unknown = payload ? Reflect.get(payload, "failed") : undefined
  const texts: string[] = []
  if (Array.isArray(failed)) {
    for (const item of failed) {
      if (!item || typeof item !== "object") continue
      const value = text(Reflect.get(item, "text"))
      if (value && value.trim()) texts.push(value.trim())
    }
  }
  if (texts.length > 0) return texts
  const reason = text(payload ? Reflect.get(payload, "reason") : undefined)
  if (reason === "merged-verification") return ["合并后重验未通过"]
  return ["未分类"]
}

export function record(input: Input): Facts {
  const participationRuns = new Set(input.participations.map((item) => item.runID))
  const teamKeys = new Set(input.participations.map((item) => item.runID + "|" + item.teamID))

  // 驳回只算「这个人所在团队」的：别的团队的返工跟他无关。
  const reworks = input.reworks.filter((item) => teamKeys.has(item.runID + "|" + item.teamID))
  const reasons = new Map<string, number>()
  let total = 0
  const reworkRuns = new Set<string>()
  for (const item of reworks) {
    reworkRuns.add(item.runID)
    for (const reason of item.reasons) {
      total += 1
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1)
    }
  }

  // 一次通过率：所在团队名下的验收项，首次验证就 pass 的比例。
  const lines = input.acceptances.filter((item) => teamKeys.has(item.runID + "|" + item.owner))
  const passed = lines.filter((item) => item.outcome === "pass").length

  const walls = input.runs
    .filter((run) => participationRuns.has(run.id))
    .flatMap((run) =>
      run.startedAt !== undefined && run.endedAt !== undefined && run.endedAt >= run.startedAt
        ? [run.endedAt - run.startedAt]
        : [],
    )
  const totalMs = walls.reduce((sum, value) => sum + value, 0)

  const lastAt = input.participations.reduce<number | undefined>(
    (current, item) => (current === undefined ? item.at : Math.max(current, item.at)),
    undefined,
  )

  const sessionOnly = input.participations.filter((item) => item.source === "session").length
  const caveats = [
    "驳回与一次通过率是所在团队的事实，不是对个人的评价：任务难度、依赖质量、验证严格程度都会影响它们。",
    "耗时是运行的墙钟；并行成员共享同一段时间，不是个人工时。",
  ]
  if (sessionOnly > 0)
    caveats.push(
      "有 " +
        sessionOnly +
        " 次参与只能从会话归属确认，名册快照里没有这个人（无模板发起的运行），这些运行不计入一次通过率。",
    )

  return {
    employeeID: input.employeeID,
    participations: {
      runs: participationRuns.size,
      teams: teamKeys.size,
      asCaptain: input.participations.filter((item) => item.captain).length,
      ...(lastAt !== undefined ? { lastAt } : {}),
    },
    rework: {
      total,
      runs: reworkRuns.size,
      top: [...reasons.entries()]
        .sort((a, b) => b[1] - a[1] || stable(a[0], b[0]))
        .slice(0, MAX_TOP)
        .map(([reason, count]) => ({ reason, count })),
    },
    firstPass: {
      lines: lines.length,
      passed,
      ...(lines.length > 0 ? { rate: passed / lines.length } : {}),
    },
    wall: {
      measured: walls.length,
      ...(walls.length > 0 ? { totalMs, avgMs: Math.round(totalMs / walls.length) } : {}),
    },
    caveats,
  }
}

/** 从名册快照里读出「谁在队里、谁是队长」；坏数据当作没有名册。 */
function rosterOf(snapshot: Record<string, unknown> | null | undefined) {
  if (!snapshot) return undefined
  const raw: unknown = Reflect.get(snapshot, "roster")
  if (!Array.isArray(raw)) return undefined
  const employees: string[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue
    const employee: unknown = Reflect.get(entry, "employee")
    if (!employee || typeof employee !== "object") continue
    const id = text(Reflect.get(employee, "id"))
    if (id) employees.push(id)
  }
  const captain = text(Reflect.get(snapshot, "captain"))
  return { employees, captain }
}

/**
 * 读某个人的事实记录。
 *
 * 两步走：先按名册快照 / 会话归属找出他参与过的运行，再只读这些运行的事件、验收与验证。
 * 不扫全表 —— 运行会越来越多，而「这个人参与过哪些运行」能把范围先收窄。
 */
export function of(employeeID: string): Facts {
  const teams = Database.use((db) => db.select().from(TeamRunTeamTable).all())
  const participations: Participation[] = []
  for (const team of teams) {
    const roster = rosterOf(team.roster_snapshot)
    if (!roster || !roster.employees.includes(employeeID)) continue
    participations.push({
      runID: team.run_id,
      teamID: team.id,
      captain: roster.captain === employeeID,
      source: "roster",
      at: team.time_created,
    })
  }

  // 会话归属兜底：没有名册快照的运行里，仍然能确认这个人做过这件事。
  const sessions = Database.use((db) =>
    db
      .select({
        runID: SessionTable.run_id,
        updatedAt: SessionTable.time_updated,
      })
      .from(SessionTable)
      .where(eq(SessionTable.employee_id, employeeID))
      .all(),
  )
  const seen = new Set(participations.map((item) => item.runID))
  const sessionRuns = new Map<string, number>()
  for (const session of sessions) {
    if (!session.runID) continue
    const current = sessionRuns.get(session.runID)
    sessionRuns.set(session.runID, current === undefined ? session.updatedAt : Math.min(current, session.updatedAt))
  }
  for (const [runID, at] of sessionRuns) {
    if (seen.has(runID)) continue
    const team = teams.find((item) => item.run_id === runID)
    // 没有团队行时只记运行级参与：团队事实（驳回、一次通过率）无从归属。
    participations.push({ runID, teamID: team?.id ?? "", captain: false, source: "session", at })
  }

  const runIDs = [...new Set(participations.map((item) => item.runID))]
  if (runIDs.length === 0)
    return record({ employeeID, participations: [], reworks: [], acceptances: [], runs: [] })

  const runs = Database.use((db) =>
    db
      .select({
        id: TeamRunTable.id,
        startedAt: TeamRunTable.started_at,
        endedAt: TeamRunTable.ended_at,
      })
      .from(TeamRunTable)
      .where(inArray(TeamRunTable.id, runIDs))
      .all(),
  )

  const events = Database.use((db) =>
    db
      .select()
      .from(TeamRunEventTable)
      .where(inArray(TeamRunEventTable.run_id, runIDs))
      .all(),
  )
  const reworks: Rework[] = events.flatMap((event) => {
    if (event.kind !== "team.rework") return []
    const payload = event.payload ?? undefined
    const teamID = payload ? text(Reflect.get(payload, "teamID")) : undefined
    if (!teamID) return []
    return [{ runID: event.run_id, teamID, reasons: reasonsOf(payload) }]
  })

  const acceptances = Database.use((db) =>
    db
      .select({
        id: TeamAcceptanceTable.id,
        runID: TeamAcceptanceTable.run_id,
        owner: TeamAcceptanceTable.owner,
      })
      .from(TeamAcceptanceTable)
      .where(inArray(TeamAcceptanceTable.run_id, runIDs))
      .all(),
  )
  const verifications = Database.use((db) =>
    db
      .select({
        acceptanceID: TeamVerificationTable.acceptance_id,
        runID: TeamVerificationTable.run_id,
        attempt: TeamVerificationTable.attempt,
        outcome: TeamVerificationTable.outcome,
        at: TeamVerificationTable.at,
      })
      .from(TeamVerificationTable)
      .where(inArray(TeamVerificationTable.run_id, runIDs))
      .orderBy(TeamVerificationTable.at)
      .all(),
  )

  // 首次验证 = attempt 最小；同一轮里多次记录时取最早的那条。
  const first = new Map<string, { attempt: number; outcome: string }>()
  for (const item of verifications) {
    const current = first.get(item.acceptanceID)
    if (!current || item.attempt < current.attempt) first.set(item.acceptanceID, item)
  }

  return record({
    employeeID,
    participations,
    reworks,
    acceptances: acceptances.flatMap((item) => {
      if (!item.owner) return []
      const result = first.get(item.id)
      return [
        {
          runID: item.runID,
          owner: item.owner,
          ...(result && (result.outcome === "pass" || result.outcome === "fail" || result.outcome === "unverified")
            ? { outcome: result.outcome }
            : {}),
        },
      ]
    }),
    runs: runs.map((run) => ({
      id: run.id,
      ...(run.startedAt !== null ? { startedAt: run.startedAt } : {}),
      ...(run.endedAt !== null ? { endedAt: run.endedAt } : {}),
    })),
  })
}

export * as TeamEmployeeRecord from "./employee-record"
