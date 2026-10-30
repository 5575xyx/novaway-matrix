import { Context, Effect, Layer } from "effect"
import { asc, eq } from "drizzle-orm"
import { Database } from "@/storage/db"
import { EmployeeTable, TeamProfileMemberTable, TeamProfileTable } from "./run.sql"

/**
 * 团队模板（§5.2）：编制表 + 员工。
 *
 * 三条不变量：
 * 1. **模板是复制，不是绑定**：发起运行时把名册复制进 `roster_snapshot`，
 *    之后编辑模板对已在跑的运行零影响；
 * 2. **内置模板开箱可用**：§4.5 的「三步拿到第一份结果」依赖它，不能要求用户
 *    先搭组织；
 * 3. **种子幂等**：用固定 ID 插入，重复启动不会产生第二份内置模板。
 */

export type Employee = {
  id: string
  name: string
  /** 岗位（agent 名）：能力模板，同一岗位可以有多个员工。 */
  job: string
  model?: string
  skills?: string[]
  prompt?: string
}

export type ProfileMember = {
  profileID: string
  employeeID: string
  role: "captain" | "worker"
  duty?: string
  order: number
  canAutoDispatch: boolean
  overrides?: Record<string, unknown>
}

export type Profile = {
  id: string
  name: string
  description?: string
  /** 队长对应的编制行员工 ID。 */
  captainMember: string
  policy?: Record<string, unknown>
  autoEligible: boolean
  version: number
  createdAt: number
  updatedAt: number
}

export type RosterEntry = {
  employee: Employee
  role: ProfileMember["role"]
  duty?: string
  order: number
  canAutoDispatch: boolean
}

/** 发起运行时复制进 `roster_snapshot` 的只读快照。 */
export type Snapshot = {
  profileID: string
  name: string
  version: number
  captain: string
  roster: RosterEntry[]
}

export type CreateInput = {
  name: string
  description?: string
  captain: string
  members: ReadonlyArray<{
    employeeID: string
    role?: "captain" | "worker"
    duty?: string
    canAutoDispatch?: boolean
  }>
}

export interface Interface {
  /** 幂等：内置模板不存在才插入；已存在时不覆盖用户的改动。 */
  readonly seed: () => Effect.Effect<void>
  readonly list: () => Effect.Effect<Profile[]>
  readonly get: (id: string) => Effect.Effect<Profile | undefined>
  readonly members: (profileID: string) => Effect.Effect<ProfileMember[]>
  readonly employees: () => Effect.Effect<Employee[]>
  readonly roster: (profileID: string) => Effect.Effect<RosterEntry[]>
  /** 深拷贝成快照：运行只认它，不再读模板。 */
  readonly snapshot: (profileID: string) => Effect.Effect<Snapshot | undefined>
  readonly create: (input: CreateInput) => Effect.Effect<Profile>
  readonly remove: (id: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@NovaWay/TeamProfile") {}

/** 内置「代码审查团队」：1 名队长 + 4 名不同岗位成员（§4.5）。 */
export const BUILTIN_PROFILE_ID = "prof_builtin_code_review"

const builtin = {
  captain: "emp_builtin_review_captain",
  employees: [
    {
      id: "emp_builtin_review_captain",
      name: "审查队长",
      job: "build",
      prompt: "把变更拆成互不重叠的审查角度，汇总成员结论，只保留可复现的问题。",
    },
    {
      id: "emp_builtin_review_security",
      name: "安全审查",
      job: "general",
      prompt: "只找安全问题：注入、越权、凭据泄漏、不安全的反序列化。每条都要给出触发路径。",
    },
    {
      id: "emp_builtin_review_correctness",
      name: "正确性审查",
      job: "general",
      prompt: "只找逻辑缺陷：边界、错误路径、并发与资源释放。必须给出能失败的输入。",
    },
    {
      id: "emp_builtin_review_tests",
      name: "测试审查",
      job: "general",
      prompt: "只评估测试：覆盖是否跟着改动走，断言是否能真的失败，回归是否被删。",
    },
    {
      id: "emp_builtin_review_scope",
      name: "范围审查",
      job: "plan",
      prompt: "只判断范围：改动是否超出目标、是否夹带无关重写、验收是否被改成迁就实现。",
    },
  ],
  duties: {
    emp_builtin_review_security: "注入 / 越权 / 凭据",
    emp_builtin_review_correctness: "边界 / 错误路径 / 并发",
    emp_builtin_review_tests: "覆盖 / 断言 / 回归",
    emp_builtin_review_scope: "目标一致性 / 无关改动",
  } as Record<string, string>,
  description: "只读审查一次代码变更：五个角度并行，输出带证据的问题清单。",
}

const toEmployee = (row: typeof EmployeeTable.$inferSelect): Employee => ({
  id: row.id,
  name: row.name,
  job: row.job,
  model: row.model ?? undefined,
  skills: row.skills ?? undefined,
  prompt: row.prompt ?? undefined,
})

/** 库里 role 是自由文本；认不出来的一律当普通成员，不让脏数据变成队长。 */
const toRole = (value: string): ProfileMember["role"] => (value === "captain" ? "captain" : "worker")

const toMember = (row: typeof TeamProfileMemberTable.$inferSelect): ProfileMember => ({
  profileID: row.profile_id,
  employeeID: row.employee_id,
  role: toRole(row.role),
  duty: row.duty ?? undefined,
  order: row.order,
  canAutoDispatch: row.can_auto_dispatch === 1,
  overrides: row.overrides ?? undefined,
})

const toProfile = (row: typeof TeamProfileTable.$inferSelect): Profile => ({
  id: row.id,
  name: row.name,
  description: row.description ?? undefined,
  captainMember: row.captain_member,
  policy: row.policy ?? undefined,
  autoEligible: row.auto_eligible === 1,
  version: row.version,
  createdAt: row.time_created,
  updatedAt: row.time_updated,
})

const id = (prefix: string) => prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const seed: Interface["seed"] = Effect.fn("TeamProfile.seed")(function* () {
      yield* Effect.sync(() =>
        Database.transaction((tx) => {
          const existing = tx.select().from(TeamProfileTable).where(eq(TeamProfileTable.id, BUILTIN_PROFILE_ID)).all()
          // 已存在就什么都不做：用户的编辑不能被下一次启动覆盖。
          if (existing.length > 0) return
          const now = Date.now()
          for (const employee of builtin.employees) {
            tx.insert(EmployeeTable)
              .values({
                id: employee.id,
                name: employee.name,
                job: employee.job,
                prompt: employee.prompt,
                time_created: now,
                time_updated: now,
              })
              .onConflictDoNothing()
              .run()
          }
          tx.insert(TeamProfileTable)
            .values({
              id: BUILTIN_PROFILE_ID,
              name: "代码审查团队",
              description: builtin.description,
              captain_member: builtin.captain,
              version: 1,
              auto_eligible: 0,
              time_created: now,
              time_updated: now,
            })
            .run()
          builtin.employees.forEach((employee, index) => {
            const captain = employee.id === builtin.captain
            tx.insert(TeamProfileMemberTable)
              .values({
                id: "profmem_" + employee.id,
                profile_id: BUILTIN_PROFILE_ID,
                employee_id: employee.id,
                role: captain ? "captain" : "worker",
                duty: captain ? "拆解 / 汇总 / 判定返工" : (builtin.duties[employee.id] ?? null),
                can_auto_dispatch: 1,
                order: index,
                time_created: now,
                time_updated: now,
              })
              .run()
          })
        }),
      )
    })

    const list: Interface["list"] = Effect.fn("TeamProfile.list")(function* () {
      const rows = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(TeamProfileTable).orderBy(asc(TeamProfileTable.time_created)).all()),
      )
      return rows.map(toProfile)
    })

    const get: Interface["get"] = Effect.fn("TeamProfile.get")(function* (profileID) {
      const row = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(TeamProfileTable).where(eq(TeamProfileTable.id, profileID)).get()),
      )
      return row ? toProfile(row) : undefined
    })

    const members: Interface["members"] = Effect.fn("TeamProfile.members")(function* (profileID) {
      const rows = yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .select()
            .from(TeamProfileMemberTable)
            .where(eq(TeamProfileMemberTable.profile_id, profileID))
            .orderBy(asc(TeamProfileMemberTable.order))
            .all(),
        ),
      )
      return rows.map(toMember)
    })

    const employees: Interface["employees"] = Effect.fn("TeamProfile.employees")(function* () {
      const rows = yield* Effect.sync(() => Database.use((db) => db.select().from(EmployeeTable).all()))
      return rows.map(toEmployee)
    })

    const roster: Interface["roster"] = Effect.fn("TeamProfile.roster")(function* (profileID) {
      const rows = yield* members(profileID)
      const people = new Map((yield* employees()).map((employee) => [employee.id, employee]))
      return rows.flatMap((member) => {
        const employee = people.get(member.employeeID)
        // 编制引用了不存在的员工：跳过而不是编造一个空岗位，调用方会看到缺人。
        if (!employee) return []
        return [
          {
            employee: { ...employee },
            role: member.role,
            duty: member.duty,
            order: member.order,
            canAutoDispatch: member.canAutoDispatch,
          },
        ]
      })
    })

    const snapshot: Interface["snapshot"] = Effect.fn("TeamProfile.snapshot")(function* (profileID) {
      const profile = yield* get(profileID)
      if (!profile) return undefined
      const entries = yield* roster(profileID)
      // 深拷贝：运行只认这份快照，之后再改模板也不会串味。
      return {
        profileID: profile.id,
        name: profile.name,
        version: profile.version,
        captain: profile.captainMember,
        roster: entries.map((entry) => ({ ...entry, employee: { ...entry.employee } })),
      }
    })

    const create: Interface["create"] = Effect.fn("TeamProfile.create")(function* (input) {
      const now = Date.now()
      const profileID = id("prof")
      const rows = input.members.map((member, index) => ({
        id: id("profmem"),
        profileID,
        employeeID: member.employeeID,
        role: member.employeeID === input.captain ? ("captain" as const) : (member.role ?? ("worker" as const)),
        duty: member.duty,
        order: index,
        canAutoDispatch: member.canAutoDispatch ?? true,
      }))
      yield* Effect.sync(() =>
        Database.transaction((tx) => {
          tx.insert(TeamProfileTable)
            .values({
              id: profileID,
              name: input.name,
              description: input.description ?? null,
              captain_member: input.captain,
              version: 1,
              auto_eligible: 0,
              time_created: now,
              time_updated: now,
            })
            .run()
          for (const row of rows) {
            tx.insert(TeamProfileMemberTable)
              .values({
                id: row.id,
                profile_id: row.profileID,
                employee_id: row.employeeID,
                role: row.role,
                duty: row.duty ?? null,
                can_auto_dispatch: row.canAutoDispatch ? 1 : 0,
                order: row.order,
                time_created: now,
                time_updated: now,
              })
              .run()
          }
        }),
      )
      return {
        id: profileID,
        name: input.name,
        description: input.description,
        captainMember: input.captain,
        autoEligible: false,
        version: 1,
        createdAt: now,
        updatedAt: now,
      }
    })

    const remove: Interface["remove"] = Effect.fn("TeamProfile.remove")(function* (profileID) {
      // 只删模板与编制行：历史运行用的是快照，员工也可能被别的模板引用。
      yield* Effect.sync(() =>
        Database.transaction((tx) => {
          tx.delete(TeamProfileMemberTable).where(eq(TeamProfileMemberTable.profile_id, profileID)).run()
          tx.delete(TeamProfileTable).where(eq(TeamProfileTable.id, profileID)).run()
        }),
      )
    })

    return Service.of({ seed, list, get, members, employees, roster, snapshot, create, remove })
  }),
)

export const defaultLayer = layer
export * as TeamProfile from "./profile"
