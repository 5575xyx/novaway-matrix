import { Context, Effect, Layer } from "effect"
import { desc, eq } from "drizzle-orm"
import fs from "node:fs/promises"
import { Database } from "@/storage/db"
import { TeamMissionTable } from "./run.sql"
import { createMission, cumulativeDiff, head, type CumulativeDiff } from "./worktree"

/**
 * Mission（持久目标，§3.2）。
 *
 * 这一层很薄，只做三件事：分配不复用的编号、冻结 `baseSHA`、准备并复用一份工作区。
 * 它**不**持有运行的成败：运行结束不会让目标完成，目标完成也不会停掉运行 ——
 * 状态由用户显式维护，这是设计里写死的一条（§3.2 第 2 条）。
 */

export type MissionStatus = "active" | "done" | "abandoned"

export type Mission = {
  id: string
  /** `M-001` 里的数字；单调分配、永不复用。只给界面用，模型看到的是 `id`。 */
  number: number
  directory: string
  goal: string
  status: MissionStatus
  /** 目标开始时的提交：累计差异从这里算。 */
  baseSHA?: string
  worktree?: string
  branch?: string
  createdAt: number
  updatedAt: number
}

export type Prepared = { kind: "ready"; mission: Mission } | { kind: "skipped"; reason: string }

export type MissionDiff = { kind: "diff"; diff: CumulativeDiff } | { kind: "skipped"; reason: string }

export interface Interface {
  readonly create: (input: { directory: string; goal: string }) => Effect.Effect<Mission>
  readonly get: (missionID: string) => Effect.Effect<Mission | undefined>
  readonly list: (input?: { directory?: string; status?: MissionStatus }) => Effect.Effect<Mission[]>
  readonly setStatus: (input: { missionID: string; status: MissionStatus }) => Effect.Effect<Mission | undefined>
  /**
   * 准备（或复用）工作区。
   *
   * 工作区在第一次被使用时才建；之后每次运行都返回同一份。目录被外部删掉时
   * 按记录里的 `baseSHA` 重建 —— 起点不能漂移，否则累计差异就不成立。
   */
  readonly prepare: (missionID: string) => Effect.Effect<Prepared>
  /**
   * 累计差异：`baseSHA` → 目标工作区当前内容。
   *
   * 没有工作区、没有起点、不是 git 仓库时返回原因 —— 差异算不出来就说算不出来，
   * 不要拿「0 个文件」冒充「什么都没改」。
   */
  readonly diff: (missionID: string) => Effect.Effect<MissionDiff | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@NovaWay/TeamMission") {}

const generateId = () => "mis_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7)

/** 库里只可能存这三种；读到别的东西说明数据坏了，按 active 处理但不要假装是 done。 */
const toStatus = (value: string): MissionStatus => (value === "done" || value === "abandoned" ? value : "active")

const toMission = (row: typeof TeamMissionTable.$inferSelect): Mission => ({
  id: row.id,
  number: row.number,
  directory: row.directory,
  goal: row.goal,
  status: toStatus(row.status),
  baseSHA: row.base_sha ?? undefined,
  worktree: row.worktree ?? undefined,
  branch: row.branch ?? undefined,
  createdAt: row.time_created,
  updatedAt: row.time_updated,
})

const exists = (directory: string) =>
  fs.stat(directory).then(
    (stat) => stat.isDirectory(),
    () => false,
  )

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const get: Interface["get"] = Effect.fn("TeamMission.get")(function* (missionID) {
      const rows = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(TeamMissionTable).where(eq(TeamMissionTable.id, missionID)).all()),
      )
      return rows[0] ? toMission(rows[0]) : undefined
    })

    const create: Interface["create"] = Effect.fn("TeamMission.create")(function* (input) {
      const now = Date.now()
      const id = generateId()
      const rows = yield* Effect.sync(() => Database.use((db) => db.select().from(TeamMissionTable).all()))
      // 编号按目录单调分配：删掉的目标不会被复用号码，历史记录始终指得回去。
      const number = rows.reduce((max, row) => (row.number > max ? row.number : max), 0) + 1
      // 起点冻结在目标创建时：用户之后自己提交代码，不应该改变这次目标的累计差异。
      const baseSHA = yield* Effect.promise(() => head(input.directory))
      const mission: Mission = {
        id,
        number,
        directory: input.directory,
        goal: input.goal,
        status: "active",
        baseSHA,
        createdAt: now,
        updatedAt: now,
      }
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .insert(TeamMissionTable)
            .values({
              id,
              number,
              directory: input.directory,
              goal: input.goal,
              status: mission.status,
              base_sha: baseSHA ?? null,
              time_created: now,
              time_updated: now,
            })
            .run(),
        ),
      )
      return mission
    })

    const list: Interface["list"] = Effect.fn("TeamMission.list")(function* (input) {
      const rows = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(TeamMissionTable).orderBy(desc(TeamMissionTable.number)).all()),
      )
      return rows
        .map(toMission)
        .filter((mission) => (input?.directory ? mission.directory === input.directory : true))
        .filter((mission) => (input?.status ? mission.status === input.status : true))
    })

    const setStatus: Interface["setStatus"] = Effect.fn("TeamMission.setStatus")(function* (input) {
      const now = Date.now()
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .update(TeamMissionTable)
            .set({ status: input.status, time_updated: now })
            .where(eq(TeamMissionTable.id, input.missionID))
            .run(),
        ),
      )
      return yield* get(input.missionID)
    })

    const prepare: Interface["prepare"] = Effect.fn("TeamMission.prepare")(function* (missionID) {
      const mission = yield* get(missionID)
      if (!mission) return { kind: "skipped", reason: "目标不存在：" + missionID } satisfies Prepared
      const existing = mission.worktree
      if (existing && mission.baseSHA && (yield* Effect.promise(() => exists(existing))))
        return { kind: "ready", mission } satisfies Prepared

      const created = yield* Effect.promise(() =>
        createMission({ base: mission.directory, missionID: mission.id, baseSHA: mission.baseSHA }),
      )
      if (created.kind === "skipped") return { kind: "skipped", reason: created.reason } satisfies Prepared

      const now = Date.now()
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .update(TeamMissionTable)
            .set({
              base_sha: created.worktree.baseSHA,
              worktree: created.worktree.directory,
              branch: created.worktree.branch,
              time_updated: now,
            })
            .where(eq(TeamMissionTable.id, mission.id))
            .run(),
        ),
      )
      const updated = yield* get(mission.id)
      return { kind: "ready", mission: updated ?? mission } satisfies Prepared
    })

    const diff: Interface["diff"] = Effect.fn("TeamMission.diff")(function* (missionID) {
      const mission = yield* get(missionID)
      if (!mission) return undefined
      const baseSHA = mission.baseSHA
      if (!baseSHA) return { kind: "skipped", reason: "目标还没有起点提交" } satisfies MissionDiff
      const directory = mission.worktree
      if (!directory) return { kind: "skipped", reason: "目标还没有工作区" } satisfies MissionDiff
      const result = yield* Effect.promise(() => cumulativeDiff({ directory, baseSHA }))
      if (!result)
        return { kind: "skipped", reason: "读不到目标工作区的差异（目录已删除或不是仓库）" } satisfies MissionDiff
      return { kind: "diff", diff: result } satisfies MissionDiff
    })

    return Service.of({ create, get, list, setStatus, prepare, diff })
  }),
)

export const defaultLayer = layer
