import { Context, Effect, Layer } from "effect"
import { and, asc, eq } from "drizzle-orm"
import { Database } from "@/storage/db"
import { EmployeeTable, TeamProfileMemberTable, TeamProfileTable } from "./run.sql"
import { of as effectiveOf, type Effective } from "./effective"

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
   * 归档**不改写已经建好的模板或快照**：模板是复制，运行只认快照，历史因此还能解释。
   * 但归档之后这个人不能再接新活 —— 派发前会对账（`team/roster` 的 `problems()`，§9）：
   * 名册里有人已归档时，这一轮不派，而不是「照原样派给一个已经离开的人」。
   * 这一点和「删除员工」不同 —— 删除会让人从历史名册里消失，归档不会（而且员工只归档、不物理删除）。
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
  /**
   * 冻结那一刻这个人**实际生效**的配置（§5.4）。
   *
   * 只有快照有，活名册里没有：它是「这历史报告当时按什么跑的」的答案，
   * 不是「这个人现在该怎么派」的答案。
   */
  effective?: Effective
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

export class Service extends Context.Service<Service, Interface>()("@novaway/TeamProfile") {}

/** 内置模板：代码审查团队保留原有固定 ID，其他场景模板使用独立固定 ID。 */
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
const builtinPresets = [
  {
    id: BUILTIN_PROFILE_ID,
    name: "代码审查团队",
    autoEligible: false,
    ...builtin,
    description: builtin.description,
  },
  {
    id: "prof_builtin_operations",
    name: "运营增长团队",
    description: "从用户洞察、内容运营到数据复盘，协同推进增长目标。",
    autoEligible: true,
    captain: "emp_builtin_ops_lead",
    employees: [
      { id: "emp_builtin_ops_lead", name: "运营策略师", job: "plan", prompt: "明确运营目标、拆解增长路径，协调成员形成可执行方案。" },
      { id: "emp_builtin_ops_content", name: "内容运营", job: "general", prompt: "规划内容主题、渠道和发布节奏，产出可直接执行的内容方案。" },
      { id: "emp_builtin_ops_growth", name: "增长分析师", job: "general", prompt: "分析转化漏斗、用户行为和增长机会，提出可验证的实验。" },
      { id: "emp_builtin_ops_research", name: "用户研究员", job: "general", prompt: "整理用户反馈和竞品信息，提炼真实需求与优先级。" },
    ],
    duties: {
      emp_builtin_ops_content: "内容规划 / 渠道 / 发布",
      emp_builtin_ops_growth: "漏斗 / 指标 / 实验",
      emp_builtin_ops_research: "用户 / 竞品 / 需求",
    } as Record<string, string>,
  },
  {
    id: "prof_builtin_office",
    name: "办公效率团队",
    description: "处理文档、表格、会议和资料整理，把繁琐工作变成清晰交付。",
    autoEligible: true,
    captain: "emp_builtin_office_lead",
    employees: [
      { id: "emp_builtin_office_lead", name: "办公协调员", job: "general", prompt: "理解办公目标，安排文档、数据和会议任务，汇总成最终交付。" },
      { id: "emp_builtin_office_docs", name: "文档助手", job: "general", prompt: "撰写、整理和校对文档，保持结构清晰、信息完整、格式统一。" },
      { id: "emp_builtin_office_data", name: "表格分析师", job: "general", prompt: "清洗表格、提取关键指标，制作可解释的分析结果和图表。" },
      { id: "emp_builtin_office_meeting", name: "会议秘书", job: "general", prompt: "整理会议材料、纪要、决策和待办，明确负责人和截止时间。" },
    ],
    duties: {
      emp_builtin_office_docs: "文档 / 报告 / 校对",
      emp_builtin_office_data: "表格 / 指标 / 图表",
      emp_builtin_office_meeting: "会议 / 纪要 / 待办",
    } as Record<string, string>,
  },
  {
    id: "prof_builtin_development",
    name: "软件研发团队",
    description: "覆盖需求拆解、前后端实现、测试和安全检查的完整研发协作。",
    autoEligible: true,
    captain: "emp_builtin_dev_lead",
    employees: [
      { id: "emp_builtin_dev_lead", name: "研发队长", job: "build", prompt: "拆解开发目标，安排实现、测试和审查工作，汇总可交付结果。" },
      { id: "emp_builtin_dev_frontend", name: "前端工程师", job: "build", prompt: "负责界面、交互和前端状态逻辑，保证响应式体验与可维护性。" },
      { id: "emp_builtin_dev_backend", name: "后端工程师", job: "build", prompt: "负责 API、数据模型和服务逻辑，关注边界、错误处理与兼容性。" },
      { id: "emp_builtin_dev_test", name: "测试工程师", job: "general", prompt: "补充关键测试和回归验证，用证据确认功能真正可用。" },
      { id: "emp_builtin_dev_security", name: "安全工程师", job: "general", prompt: "检查权限、输入、敏感数据和外部副作用，给出可复现的风险。" },
    ],
    duties: {
      emp_builtin_dev_frontend: "界面 / 交互 / 状态",
      emp_builtin_dev_backend: "API / 数据 / 服务",
      emp_builtin_dev_test: "测试 / 回归 / 验证",
      emp_builtin_dev_security: "权限 / 输入 / 风险",
    } as Record<string, string>,
  },
  {
    id: "prof_builtin_product",
    name: "产品设计团队",
    description: "从用户需求、竞品研究到体验方案，协同产出清晰的产品设计。",
    autoEligible: true,
    captain: "emp_builtin_product_lead",
    employees: [
      { id: "emp_builtin_product_lead", name: "产品负责人", job: "plan", prompt: "澄清用户问题和产品目标，拆解需求并协调研究、设计和验证。" },
      { id: "emp_builtin_product_ux", name: "体验设计师", job: "general", prompt: "设计用户流程、交互方案和体验细节，指出可用性问题。" },
      { id: "emp_builtin_product_research", name: "竞品研究员", job: "general", prompt: "对比竞品能力、定位和体验，提炼可验证的产品机会。" },
      { id: "emp_builtin_product_spec", name: "产品文档师", job: "general", prompt: "把方案整理成清晰的需求、验收标准和交付说明。" },
    ],
    duties: {
      emp_builtin_product_lead: "目标 / 需求 / 优先级",
      emp_builtin_product_ux: "流程 / 交互 / 体验",
      emp_builtin_product_research: "竞品 / 用户 / 机会",
      emp_builtin_product_spec: "需求 / 验收 / 文档",
    } as Record<string, string>,
  },
  {
    id: "prof_builtin_data",
    name: "数据分析团队",
    description: "从数据整理、指标定义到洞察报告，帮助团队用证据做决策。",
    autoEligible: true,
    captain: "emp_builtin_data_lead",
    employees: [
      { id: "emp_builtin_data_lead", name: "数据负责人", job: "plan", prompt: "明确分析问题、口径和交付形式，安排数据整理与洞察验证。" },
      { id: "emp_builtin_data_clean", name: "数据整理师", job: "general", prompt: "清洗数据、处理缺失和异常，记录数据来源与处理过程。" },
      { id: "emp_builtin_data_insight", name: "指标洞察师", job: "general", prompt: "定义关键指标，分析趋势、差异和可能原因，避免过度推断。" },
      { id: "emp_builtin_data_report", name: "报告可视化师", job: "general", prompt: "把分析结果整理成清晰的图表、结论和行动建议。" },
    ],
    duties: {
      emp_builtin_data_clean: "清洗 / 异常 / 口径",
      emp_builtin_data_insight: "指标 / 趋势 / 原因",
      emp_builtin_data_report: "图表 / 结论 / 建议",
    } as Record<string, string>,
  },
  {
    id: "prof_builtin_marketing",
    name: "市场营销团队",
    description: "协同完成市场定位、活动策划、内容创意和渠道复盘。",
    autoEligible: true,
    captain: "emp_builtin_marketing_lead",
    employees: [
      { id: "emp_builtin_marketing_lead", name: "市场策略师", job: "plan", prompt: "明确目标人群、市场定位和活动目标，形成可执行的营销计划。" },
      { id: "emp_builtin_marketing_campaign", name: "活动运营", job: "general", prompt: "策划活动流程、传播节奏和执行清单，关注转化与复盘。" },
      { id: "emp_builtin_marketing_copy", name: "营销文案师", job: "general", prompt: "根据受众和渠道撰写有说服力的标题、文案和传播素材。" },
      { id: "emp_builtin_marketing_channel", name: "渠道分析师", job: "general", prompt: "比较渠道表现、成本和转化，提出下一轮投放优化建议。" },
    ],
    duties: {
      emp_builtin_marketing_campaign: "活动 / 节奏 / 执行",
      emp_builtin_marketing_copy: "标题 / 文案 / 素材",
      emp_builtin_marketing_channel: "渠道 / 成本 / 转化",
    } as Record<string, string>,
  },
  {
    id: "prof_builtin_content",
    name: "内容创作团队",
    description: "从选题研究、内容写作到编辑校对，快速产出高质量内容。",
    autoEligible: true,
    captain: "emp_builtin_content_lead",
    employees: [
      { id: "emp_builtin_content_lead", name: "内容主编", job: "general", prompt: "明确受众和内容目标，安排研究、写作和校对，保持整体调性。" },
      { id: "emp_builtin_content_research", name: "选题研究员", job: "general", prompt: "搜集可信资料和案例，整理背景、事实与可引用证据。" },
      { id: "emp_builtin_content_writer", name: "内容写作者", job: "general", prompt: "根据目标受众完成文章、脚本或营销文案，保证表达自然有说服力。" },
      { id: "emp_builtin_content_editor", name: "编辑校对", job: "general", prompt: "检查结构、事实、语气和错漏，给出可直接发布的修订稿。" },
    ],
    duties: {
      emp_builtin_content_research: "资料 / 案例 / 事实",
      emp_builtin_content_writer: "文章 / 脚本 / 文案",
      emp_builtin_content_editor: "结构 / 语气 / 校对",
    } as Record<string, string>,
  },
] as const

/** 预置模板 ID：仅用于展示和测试；用户编辑过的模板不会被 seed 覆盖。 */
export const BUILTIN_PROFILE_IDS = builtinPresets.map((preset) => preset.id)

/**
 * 快照里的 `effective` 同样是不可信输入：缺字段、旧版本没有、手改过都要能读。
 * 读不出来就当没有 —— 快照仍然可用，只是这一条「当时按什么跑的」解释不了。
 */
function readEffective(value: unknown): Effective | undefined {
  if (!value || typeof value !== "object") return undefined
  const agent: unknown = Reflect.get(value, "agent")
  if (typeof agent !== "string") return undefined
  const model: unknown = Reflect.get(value, "model")
  const promptHash: unknown = Reflect.get(value, "promptHash")
  const skills: unknown = Reflect.get(value, "skills")
  return {
    agent,
    ...(typeof model === "string" ? { model } : {}),
    ...(typeof promptHash === "string" ? { promptHash } : {}),
    ...(Array.isArray(skills) ? { skills: skills.filter((item): item is string => typeof item === "string") } : {}),
  }
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
    const effective: unknown = Reflect.get(raw, "effective")
    const frozen = readEffective(effective)
    roster.push({
      employee: {
        id,
        name: employeeName,
        job,
        model: typeof model === "string" ? model : undefined,
        prompt: typeof prompt === "string" ? prompt : undefined,
        ...(typeof tier === "string" ? { tier } : {}),
        // 归档状态随快照冻结：这次运行开始时这个人是不是「已归档」要能从快照看出来。
        // 归档不抹掉历史，但会拦下派发（`team/roster` 的 `problems()`，§9）。
        archived: archived === true,
      },
      role: role === "captain" ? "captain" : "worker",
      duty: typeof duty === "string" ? duty : undefined,
      order,
      canAutoDispatch: canAutoDispatch === true,
      ...(frozen ? { effective: frozen } : {}),
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
          const now = Date.now()
          for (const preset of builtinPresets) {
            const existing = tx.select().from(TeamProfileTable).where(eq(TeamProfileTable.id, preset.id)).all()
            // 每个模板独立幂等：新增版本的预置模板可以补进已有数据库，但绝不覆盖用户已经编辑过的模板。
            if (existing.length > 0) continue
            for (const employee of preset.employees) {
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
                id: preset.id,
                name: preset.name,
                description: preset.description,
                captain_member: preset.captain,
                version: 1,
                auto_eligible: preset.autoEligible ? 1 : 0,
                time_created: now,
                time_updated: now,
              })
              .run()
            preset.employees.forEach((employee, index) => {
              const captain = employee.id === preset.captain
              tx.insert(TeamProfileMemberTable)
                .values({
                  id: "profmem_" + employee.id,
                  profile_id: preset.id,
                  employee_id: employee.id,
                  role: captain ? "captain" : "worker",
                  duty: captain ? "拆解 / 汇总 / 推进交付" : (preset.duties[employee.id] ?? null),
                  can_auto_dispatch: 1,
                  order: index,
                  time_created: now,
                  time_updated: now,
                })
                .run()
            })
          }
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
        // `effective` 与 `employee` 一起冻结：之后改员工的模型或岗位说明，
        // 这一次运行的历史报告仍然解释得通（§5.4「模板是复制，不是绑定」）。
        roster: entries.map((entry) => ({ ...entry, employee: { ...entry.employee }, effective: effectiveOf(entry) })),
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
