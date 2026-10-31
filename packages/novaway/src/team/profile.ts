import { Context, Effect, Layer } from "effect"
import { and, asc, eq } from "drizzle-orm"
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
  /** 档位（轻 / 中 / 重），用于成本预估；缺省由调度器判定。 */
  tier?: string
  /**
   * 已归档 = 不再出现在「可编入新团队」的候选里。
   *
   * 归档**不影响已经在跑或已经建好的模板**：模板是复制，运行只认快照。
   * 这一点和「删除员工」不同 —— 删除会让人从历史名册里消失，归档不会。
   */
  archived: boolean
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

/**
 * 改模板（§5.2 / §13）。
 *
 * 只有「显式给了」的字段才动：`undefined` = 不改，`description: null` = 清空描述。
 * 名册是**整表替换**而不是增量：编制有顺序（`order`），增删一个人会让后面所有人的
 * 位置都变；让调用方一次说明整份名册，比猜「这次想插在哪」更不容易错。
 */
export type UpdateInput = {
  profileID: string
  name?: string
  description?: string | null
  captain?: string
  members?: ReadonlyArray<{
    employeeID: string
    duty?: string
    canAutoDispatch?: boolean
  }>
  autoEligible?: boolean
}

export interface Interface {
  /** 幂等：内置模板不存在才插入；已存在时不覆盖用户的改动。 */
  readonly seed: () => Effect.Effect<void>
  readonly list: () => Effect.Effect<Profile[]>
  readonly get: (id: string) => Effect.Effect<Profile | undefined>
  readonly members: (profileID: string) => Effect.Effect<ProfileMember[]>
  readonly employees: () => Effect.Effect<Employee[]>
  /** 新建「人」：名字 + 岗位（agent 名），可选覆盖项。 */
  readonly createEmployee: (input: {
    name: string
    job: string
    model?: string
    skills?: string[]
    prompt?: string
    tier?: string
  }) => Effect.Effect<Employee>
  /**
   * 改一个人：改名、换岗位、改覆盖项、归档 / 恢复。
   *
   * 返回 `undefined` 表示这个人不存在 —— 不新建一个来「接住」这次修改，
   * 否则打错 id 会静默多出一个人。
   */
  readonly updateEmployee: (input: {
    employeeID: string
    name?: string
    job?: string
    model?: string | null
    skills?: string[] | null
    prompt?: string | null
    tier?: string | null
    archived?: boolean
  }) => Effect.Effect<Employee | undefined>
  readonly roster: (profileID: string) => Effect.Effect<RosterEntry[]>
  /** 深拷贝成快照：运行只认它，不再读模板。 */
  readonly snapshot: (profileID: string) => Effect.Effect<Snapshot | undefined>
  readonly create: (input: CreateInput) => Effect.Effect<Profile>
  /**
   * 改模板；`undefined` 表示模板不存在。
   *
   * `version` 只在真的有字段被改时 +1：它表达的是「内容变过」，不是「接口被调过」。
   * 空 PATCH 原样返回，不发版本 —— 否则每次打开编辑框再保存都会让版本无意义地漂。
   *
   * 调用方负责保证 `captain` 在生效的名册里（HTTP 层校验）；正在跑的运行读的是
   * `roster_snapshot`，改模板对它们零影响（§5.2「模板是复制，不是绑定」）。
   */
  readonly update: (input: UpdateInput) => Effect.Effect<Profile | undefined>
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

/**
 * 从 `roster_snapshot` 这类落库的 `unknown` 里读回快照。
 *
 * 快照是运行时自己写的，但仍按「不可信输入」解析：历史运行读过旧版本数据、
 * 手改过数据库，都可能缺字段。认不出来就当没有 —— 调用方会退回默认队长，
 * 而不是拿半份名册去派发。用 `Reflect.get` 逐字段读，避免 `as` 把 `unknown`
 * 直接断言成记录类型（断言通过时编译器就不再帮忙检查了）。
 */
export function snapshotFrom(value: unknown): Snapshot | undefined {
  if (!value || typeof value !== "object") return undefined
  const profileID: unknown = Reflect.get(value, "profileID")
  const name: unknown = Reflect.get(value, "name")
  const version: unknown = Reflect.get(value, "version")
  const captain: unknown = Reflect.get(value, "captain")
  const rawRoster: unknown = Reflect.get(value, "roster")
  if (typeof profileID !== "string" || typeof name !== "string") return undefined
  if (typeof version !== "number" || typeof captain !== "string") return undefined
  if (!Array.isArray(rawRoster)) return undefined
  const roster: RosterEntry[] = []
  for (const raw of rawRoster) {
    if (!raw || typeof raw !== "object") continue
    const order: unknown = Reflect.get(raw, "order")
    if (typeof order !== "number") continue
    const employee: unknown = Reflect.get(raw, "employee")
    if (!employee || typeof employee !== "object") continue
    const id: unknown = Reflect.get(employee, "id")
    const employeeName: unknown = Reflect.get(employee, "name")
    const job: unknown = Reflect.get(employee, "job")
    if (typeof id !== "string" || typeof employeeName !== "string" || typeof job !== "string") continue
    const model: unknown = Reflect.get(employee, "model")
    const prompt: unknown = Reflect.get(employee, "prompt")
    const tier: unknown = Reflect.get(employee, "tier")
    const archived: unknown = Reflect.get(employee, "archived")
    const role: unknown = Reflect.get(raw, "role")
    const duty: unknown = Reflect.get(raw, "duty")
    const canAutoDispatch: unknown = Reflect.get(raw, "canAutoDispatch")
    roster.push({
      employee: {
        id,
        name: employeeName,
        job,
        model: typeof model === "string" ? model : undefined,
        prompt: typeof prompt === "string" ? prompt : undefined,
        ...(typeof tier === "string" ? { tier } : {}),
        // 归档状态随快照冻结：这次运行里这个人是不是「已归档」要能从快照看出来，
        // 但归档不阻止派发 —— 模板是复制，工具能力仍然在。
        archived: archived === true,
      },
      role: role === "captain" ? "captain" : "worker",
      duty: typeof duty === "string" ? duty : undefined,
      order,
      canAutoDispatch: canAutoDispatch === true,
    })
  }
  return { profileID, name, version, captain, roster: roster.sort((a, b) => a.order - b.order) }
}

/**
 * 队长提示词里的团队名册。
 *
 * 只列事实（谁、什么岗位、负责哪块），不替队长分工：编排是队长的职责，
 * 写死分工等于让模板替它做决定，遇到任务变化反而更容易派错人。
 */
export function brief(snapshot: Snapshot): string[] {
  const members = snapshot.roster
    .filter((entry) => entry.employee.id !== snapshot.captain)
    .sort((a, b) => a.order - b.order)
  return members.map(
    (entry) =>
      "- " + entry.employee.name + "（" + entry.employee.job + "）" + (entry.duty ? "：" + entry.duty : "：未指定职责"),
  )
}

const toEmployee = (row: typeof EmployeeTable.$inferSelect): Employee => ({
  id: row.id,
  name: row.name,
  job: row.job,
  model: row.model ?? undefined,
  skills: row.skills ?? undefined,
  prompt: row.prompt ?? undefined,
  tier: row.tier ?? undefined,
  archived: row.archived_at !== null,
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

    const createEmployee: Interface["createEmployee"] = Effect.fn("TeamProfile.createEmployee")(function* (input) {
      const now = Date.now()
      const employeeID = id("emp")
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .insert(EmployeeTable)
            .values({
              id: employeeID,
              name: input.name,
              job: input.job,
              model: input.model ?? null,
              skills: input.skills ?? null,
              prompt: input.prompt ?? null,
              tier: input.tier ?? null,
              time_created: now,
              time_updated: now,
            })
            .run(),
        ),
      )
      return {
        id: employeeID,
        name: input.name,
        job: input.job,
        model: input.model,
        skills: input.skills,
        prompt: input.prompt,
        tier: input.tier,
        archived: false,
      }
    })

    const updateEmployee: Interface["updateEmployee"] = Effect.fn("TeamProfile.updateEmployee")(function* (input) {
      const now = Date.now()
      // 归档时间只写一次：反复点「归档」不该让「什么时候归档的」一直往后漂。
      const existing = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(EmployeeTable).where(eq(EmployeeTable.id, input.employeeID)).all()),
      )
      const row = existing[0]
      if (!row) return undefined
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .update(EmployeeTable)
            .set({
              ...(input.name !== undefined ? { name: input.name } : {}),
              ...(input.job !== undefined ? { job: input.job } : {}),
              ...(input.model !== undefined ? { model: input.model } : {}),
              ...(input.skills !== undefined ? { skills: input.skills } : {}),
              ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
              ...(input.tier !== undefined ? { tier: input.tier } : {}),
              ...(input.archived === true ? { archived_at: row.archived_at ?? now } : {}),
              ...(input.archived === false ? { archived_at: null } : {}),
              time_updated: now,
            })
            .where(eq(EmployeeTable.id, input.employeeID))
            .run(),
        ),
      )
      const rows = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(EmployeeTable).where(eq(EmployeeTable.id, input.employeeID)).all()),
      )
      return rows[0] ? toEmployee(rows[0]) : undefined
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

    const update: Interface["update"] = Effect.fn("TeamProfile.update")(function* (input) {
      const now = Date.now()
      const existing = yield* get(input.profileID)
      if (!existing) return undefined

      const changed =
        input.name !== undefined ||
        input.description !== undefined ||
        input.captain !== undefined ||
        input.members !== undefined ||
        input.autoEligible !== undefined
      // 空 PATCH 不算一次修改：版本号表达的是「内容变过」，不是「接口被调过」。
      if (!changed) return existing

      const captain = input.captain ?? existing.captainMember
      // 空串与 null 都表示「清空描述」：前者是 HTTP 的自然写法，后者是类型里的写法。
      const description =
        input.description === undefined
          ? undefined
          : input.description === null || input.description.trim() === ""
            ? null
            : input.description
      yield* Effect.sync(() =>
        Database.transaction((tx) => {
          if (input.members) {
            // 名册整表替换：数组顺序就是 order，队长行按新的 captain 重标。
            tx.delete(TeamProfileMemberTable).where(eq(TeamProfileMemberTable.profile_id, input.profileID)).run()
            input.members.forEach((member, index) => {
              tx.insert(TeamProfileMemberTable)
                .values({
                  id: id("profmem"),
                  profile_id: input.profileID,
                  employee_id: member.employeeID,
                  role: member.employeeID === captain ? "captain" : "worker",
                  duty: member.duty ?? null,
                  can_auto_dispatch: member.canAutoDispatch === false ? 0 : 1,
                  order: index,
                  time_created: now,
                  time_updated: now,
                })
                .run()
            })
          } else if (input.captain !== undefined && input.captain !== existing.captainMember) {
            // 只换队长时 role 必须跟着走：模板里的「队长是谁」与名册行的 role 不能各说各话。
            tx.update(TeamProfileMemberTable)
              .set({ role: "worker", time_updated: now })
              .where(
                and(eq(TeamProfileMemberTable.profile_id, input.profileID), eq(TeamProfileMemberTable.role, "captain")),
              )
              .run()
            tx.update(TeamProfileMemberTable)
              .set({ role: "captain", time_updated: now })
              .where(
                and(
                  eq(TeamProfileMemberTable.profile_id, input.profileID),
                  eq(TeamProfileMemberTable.employee_id, captain),
                ),
              )
              .run()
          }

          tx.update(TeamProfileTable)
            .set({
              ...(input.name !== undefined ? { name: input.name } : {}),
              ...(description !== undefined ? { description } : {}),
              captain_member: captain,
              ...(input.autoEligible !== undefined ? { auto_eligible: input.autoEligible ? 1 : 0 } : {}),
              version: existing.version + 1,
              time_updated: now,
            })
            .where(eq(TeamProfileTable.id, input.profileID))
            .run()
        }),
      )
      return yield* get(input.profileID)
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

    return Service.of({
      seed,
      list,
      get,
      members,
      employees,
      createEmployee,
      updateEmployee,
      roster,
      snapshot,
      create,
      update,
      remove,
    })
  }),
)

export const defaultLayer = layer
export * as TeamProfile from "./profile"
