import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import type { SessionID } from "@/session/schema"
import { Timestamps } from "@/storage/schema.sql"

/**
 * 团队编排（TeamRun）持久层。
 *
 * 与 `team.sql.ts` 的分工：
 * - `team.sql.ts` 是**会话内临时团队**的运行时形态（内核动态组队、任务板）；
 * - 本文件是**组织资产 + 一次编排**：员工、团队模板、运行、验收、验证、操作日志、账本。
 *
 * 命名：列用 snake_case，领域对象在 `team/run.ts` 里转成 camelCase。
 */

/** 员工（人）：名字 + 岗位 + 个人覆盖。同一个人可加入多个团队。 */
export const EmployeeTable = sqliteTable(
  "employee",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    job: text().notNull(),
    model: text(),
    skills: text({ mode: "json" }).$type<string[]>(),
    prompt: text(),
    tier: text(),
    archived_at: integer(),
    ...Timestamps,
  },
  (table) => [index("employee_job_idx").on(table.job), index("employee_archived_idx").on(table.archived_at)],
)

/** 团队模板（编制表）。 */
export const TeamProfileTable = sqliteTable("team_profile", {
  id: text().primaryKey(),
  name: text().notNull(),
  description: text(),
  captain_member: text().notNull(),
  policy: text({ mode: "json" }).$type<Record<string, unknown>>(),
  auto_eligible: integer().notNull().default(0),
  version: integer().notNull().default(1),
  ...Timestamps,
})

/** 编制行：引用某个人。同一团队可多人同岗位；同一人默认只占一个编制。 */
export const TeamProfileMemberTable = sqliteTable(
  "team_profile_member",
  {
    id: text().primaryKey(),
    profile_id: text().notNull(),
    employee_id: text().notNull(),
    role: text().notNull().default("worker"),
    duty: text(),
    can_auto_dispatch: integer().notNull().default(1),
    order: integer().notNull().default(0),
    overrides: text({ mode: "json" }).$type<Record<string, unknown>>(),
    ...Timestamps,
  },
  (table) => [
    index("team_profile_member_profile_idx").on(table.profile_id),
    uniqueIndex("team_profile_member_unique").on(table.profile_id, table.employee_id),
  ],
)

/**
 * Mission（持久目标，§3.2）：跨多次运行存活的工作区与固定 `base_sha`。
 *
 * 它的状态与运行的成败**互不推导**：运行结束不会自动完成目标，目标完成也不停止运行。
 * `number` 单调分配、永不复用；`M-xxx` 只出现在界面上，模型看到的是 `id`。
 */
export const TeamMissionTable = sqliteTable(
  "team_mission",
  {
    id: text().primaryKey(),
    number: integer().notNull(),
    directory: text().notNull(),
    goal: text().notNull(),
    status: text().notNull().default("active"),
    /** 目标开始时的那次提交：累计差异从这里算，运行期间用户再提交也不影响它。 */
    base_sha: text(),
    worktree: text(),
    branch: text(),
    ...Timestamps,
  },
  (table) => [
    // 全局单调：换一个仓库也不会出现两个 `M-002`，历史记录永远指得回去。
    uniqueIndex("team_mission_number").on(table.number),
    index("team_mission_status_idx").on(table.status),
  ],
)

/** 一次编排。 */
export const TeamRunTable = sqliteTable(
  "team_run",
  {
    id: text().primaryKey(),
    session_id: text().$type<SessionID>().notNull(),
    directory: text().notNull(),
    /** 属于哪个持久目标；临时任务为空。 */
    mission_id: text(),
    mode: text().notNull().default("team"),
    goal: text().notNull(),
    brief: text({ mode: "json" }).$type<Record<string, unknown>>(),
    acceptance: text({ mode: "json" }).$type<unknown[]>(),
    plan: text({ mode: "json" }).$type<Record<string, unknown>>(),
    plan_version: integer().notNull().default(0),
    approval: text({ mode: "json" }).$type<Record<string, unknown>>(),
    state: text().notNull().default("planning"),
    phase: text(),
    round_main: integer().notNull().default(0),
    attempts: text({ mode: "json" })
      .$type<{ business: number; formatRetry: number }>()
      .notNull()
      .default({ business: 0, formatRetry: 0 }),
    budget: text({ mode: "json" }).$type<Record<string, unknown>>(),
    usage: text({ mode: "json" }).$type<Record<string, unknown>>(),
    merged_verification: text({ mode: "json" }).$type<Record<string, unknown>>(),
    started_at: integer(),
    ended_at: integer(),
    error: text(),
    terminal_reason: text(),
    ...Timestamps,
  },
  (table) => [
    index("team_run_session_idx").on(table.session_id),
    index("team_run_state_idx").on(table.state),
    index("team_run_mission_idx").on(table.mission_id),
  ],
)

/** 一次团队运行（编制快照在此冻结）。 */
export const TeamRunTeamTable = sqliteTable(
  "team_run_team",
  {
    id: text().primaryKey(),
    run_id: text().notNull(),
    profile_id: text(),
    profile_version: integer(),
    phase: text().notNull().default("queued"),
    round_captain: integer().notNull().default(0),
    report: text({ mode: "json" }).$type<Record<string, unknown>>(),
    verdict: text({ mode: "json" }).$type<Record<string, unknown>>(),
    worktree: text(),
    roster_snapshot: text({ mode: "json" }).$type<Record<string, unknown>>(),
    /**
     * 最近一次派发投喂给队长的上下文清单（§6.4）：实际 brief、验收 id + 版本、
     * 名册版本、打回意见与省略项。逐轮历史在 `context.manifest` 事件里。
     */
    context_manifest: text({ mode: "json" }).$type<Record<string, unknown>>(),
    depends_on: text({ mode: "json" }).$type<unknown[]>(),
    artifacts_out: text({ mode: "json" }).$type<unknown[]>(),
    usage: text({ mode: "json" }).$type<Record<string, unknown>>(),
    ...Timestamps,
  },
  (table) => [index("team_run_team_run_idx").on(table.run_id)],
)

/** 不可变事件日志（回放与审计的唯一真相源）。 */
export const TeamRunEventTable = sqliteTable(
  "team_run_event",
  {
    id: text().primaryKey(),
    run_id: text().notNull(),
    seq: integer().notNull(),
    at: integer().notNull(),
    kind: text().notNull(),
    payload: text({ mode: "json" }).$type<Record<string, unknown>>(),
    lease_epoch: integer(),
  },
  (table) => [uniqueIndex("team_run_event_seq").on(table.run_id, table.seq)],
)

/** 验收标准：带版本、验证方式、预期结果与责任人。 */
export const TeamAcceptanceTable = sqliteTable(
  "team_acceptance",
  {
    id: text().primaryKey(),
    run_id: text().notNull(),
    task_id: text(),
    spec_id: text().notNull(),
    version: integer().notNull().default(1),
    text: text().notNull(),
    kind: text().notNull(),
    expected: text(),
    verifier: text({ mode: "json" }).$type<Record<string, unknown>>(),
    owner: text(),
    ...Timestamps,
  },
  (table) => [index("team_acceptance_run_idx").on(table.run_id)],
)

/** 验证记录：通过状态只写在这里，成员报告只是声明。 */
export const TeamVerificationTable = sqliteTable(
  "team_verification",
  {
    id: text().primaryKey(),
    acceptance_id: text().notNull(),
    run_id: text().notNull(),
    attempt: integer().notNull().default(0),
    snapshot_id: text().notNull(),
    verifier_version: text().notNull(),
    outcome: text().notNull(),
    measured: text(),
    evidence_ref: text(),
    at: integer().notNull(),
  },
  (table) => [
    index("team_verification_acceptance_idx").on(table.acceptance_id),
    index("team_verification_run_idx").on(table.run_id),
  ],
)

/** 工具操作日志：回答「这个工具到底执行了没有」。 */
export const TeamRunOpTable = sqliteTable(
  "team_run_op",
  {
    id: text().primaryKey(),
    run_id: text().notNull(),
    task_id: text(),
    session_id: text().$type<SessionID>(),
    tool: text().notNull(),
    idempotency_key: text().notNull(),
    started_at: integer().notNull(),
    finished_at: integer(),
    outcome: text().notNull().default("unknown"),
    effect: text({ mode: "json" }).$type<Record<string, unknown>>(),
    lease_epoch: integer(),
  },
  (table) => [
    uniqueIndex("team_run_op_key").on(table.run_id, table.idempotency_key),
    index("team_run_op_run_idx").on(table.run_id),
  ],
)

/** 账本：预占与结算分开记，并发也不会超支。 */
export const TeamRunLedgerTable = sqliteTable(
  "team_run_ledger",
  {
    id: text().primaryKey(),
    run_id: text().notNull(),
    actor: text().notNull(),
    reserved_tokens: integer().notNull().default(0),
    reserved_cost: text(),
    settled_tokens: integer().notNull().default(0),
    settled_cost: text(),
    /**
     * 这笔钱花在哪：`dispatch`（把活派给团队）还是 `verification`（验证是否成立）。
     *
     * 没有这一列时，验证开销占比算不出来 —— 两者都记在团队这个 actor 上，
     * 汇总后只剩一个总数。老账本没有值，读取时按「未区分」处理，不猜。
     */
    kind: text(),
    state: text().notNull().default("reserved"),
    at: integer().notNull(),
  },
  (table) => [index("team_run_ledger_run_idx").on(table.run_id), index("team_run_ledger_state_idx").on(table.state)],
)

export * as TeamRunTables from "./run.sql"
