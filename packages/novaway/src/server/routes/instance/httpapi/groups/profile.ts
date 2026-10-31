import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/team/profile"

export const EmployeeView = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  job: Schema.String,
  model: Schema.optional(Schema.String),
  prompt: Schema.optional(Schema.String),
  skills: Schema.optional(Schema.Array(Schema.String)),
  /** 档位（轻 / 中 / 重）：用于成本预估，缺省由调度器判定。 */
  tier: Schema.optional(Schema.String),
  /**
   * 已归档：不再出现在「可编入新团队」的候选里，但已在用的模板与已跑的运行不受影响
   * （模板是复制，运行只认快照）。
   */
  archived: Schema.Boolean,
}).annotate({ identifier: "TeamEmployeeView" })

export const EmployeeCreatePayload = Schema.Struct({
  name: Schema.String,
  /** 岗位（agent 名）：能力模板，同一岗位可以有多个员工。 */
  job: Schema.String,
  model: Schema.optional(Schema.String),
  skills: Schema.optional(Schema.Array(Schema.String)),
  prompt: Schema.optional(Schema.String),
  tier: Schema.optional(Schema.String),
})

/**
 * 改名 / 换岗位 / 改覆盖项 / 归档。
 *
 * 字段全部可选：只改传了的那些。覆盖项的「清空」用空串 / 空数组表达，
 * 与「没传 = 不动」区分开 —— 否则用户永远没法把一个覆盖项改回默认。
 *
 * 为什么不用 `null`：OpenAPI 表达不出 `NullOr`（生成出来仍是 `type: string`），
 * 只有手写 JSON 的客户端能传 null，生成的 SDK 类型里根本不存在这个值。
 * 空值本来就是「没有覆盖」的自然写法，契约跟着这个走。
 */
export const EmployeeUpdatePayload = Schema.Struct({
  name: Schema.optional(Schema.String),
  job: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  skills: Schema.optional(Schema.Array(Schema.String)),
  prompt: Schema.optional(Schema.String),
  tier: Schema.optional(Schema.String),
  archived: Schema.optional(Schema.Boolean),
})

export const ProfileMemberView = Schema.Struct({
  employeeID: Schema.String,
  name: Schema.String,
  job: Schema.String,
  role: Schema.Literals(["captain", "worker"]),
  duty: Schema.optional(Schema.String),
  order: Schema.Number,
}).annotate({ identifier: "TeamProfileMemberView" })

export const ProfileView = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  captainMember: Schema.String,
  autoEligible: Schema.Boolean,
  version: Schema.Number,
  memberCount: Schema.Number,
  updatedAt: Schema.Number,
}).annotate({ identifier: "TeamProfileView" })

export const ProfileDetail = Schema.Struct({
  profile: ProfileView,
  members: Schema.Array(ProfileMemberView),
}).annotate({ identifier: "TeamProfileDetail" })

const UsageAmount = Schema.Struct({
  tokens: Schema.Number,
  cost: Schema.Number,
  sessions: Schema.Number,
})

/**
 * 某个人的用量。
 *
 * 口径写在字段上而不是说明里：`totals` 只含归属到这个人的会话；
 * `unattributed` 是同几次运行里没有归属到人的会话（验证、匿名派发），
 * 单列出来是为了让「部分覆盖」看起来就是部分覆盖，而不是一张完整账单。
 */
export const EmployeeUsageView = Schema.Struct({
  employeeID: Schema.String,
  totals: UsageAmount,
  runs: Schema.Array(
    Schema.Struct({
      runID: Schema.String,
      tokens: Schema.Number,
      cost: Schema.Number,
      sessions: Schema.Number,
      lastAt: Schema.Number,
    }),
  ),
  unattributed: UsageAmount,
  /** 有归属却没有运行坐标的会话；正常应为 0。 */
  outsideRuns: UsageAmount,
  lastUsedAt: Schema.optional(Schema.Number),
}).annotate({ identifier: "TeamEmployeeUsageView" })

/**
 * 员工的事实记录（§12.1）：只记录，不排名。
 *
 * `rework` 与 `firstPass` 挂在**所在团队**上（验收的责任人是团队，返工也是整队退回），
 * `wall` 是运行墙钟而不是个人工时 —— 这三条口径由 `caveats` 原样带出，
 * 界面直接显示，不要自己再组织成「某某业绩」。
 */
export const EmployeeRecordView = Schema.Struct({
  employeeID: Schema.String,
  participations: Schema.Struct({
    runs: Schema.Number,
    teams: Schema.Number,
    asCaptain: Schema.Number,
    lastAt: Schema.optional(Schema.Number),
  }),
  rework: Schema.Struct({
    total: Schema.Number,
    runs: Schema.Number,
    top: Schema.Array(Schema.Struct({ reason: Schema.String, count: Schema.Number })),
  }),
  /** 首次验证就通过的验收项占比；没有验收项时 `rate` 不出现。 */
  firstPass: Schema.Struct({
    lines: Schema.Number,
    passed: Schema.Number,
    rate: Schema.optional(Schema.Number),
  }),
  wall: Schema.Struct({
    measured: Schema.Number,
    avgMs: Schema.optional(Schema.Number),
    totalMs: Schema.optional(Schema.Number),
  }),
  caveats: Schema.Array(Schema.String),
}).annotate({ identifier: "TeamEmployeeRecordView" })

export const ProfileCreatePayload = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  captain: Schema.String,
  members: Schema.Array(
    Schema.Struct({
      employeeID: Schema.String,
      duty: Schema.optional(Schema.String),
      canAutoDispatch: Schema.optional(Schema.Boolean),
    }),
  ),
})

/**
 * 改模板：改名 / 改描述 / 换队长 / 整表替换名册 / 自动可调度。
 *
 * 字段全部可选：只改传了的那些。描述传空串表示清空（与员工覆盖项同一约定：
 * OpenAPI 表达不出 `NullOr`，空值才是「没有」的自然写法）。
 * 给了 `members` 就是整份名册 —— 增删一个人要让调用方说明完整编制，而不是猜插入位置。
 */
export const ProfileUpdatePayload = Schema.Struct({
  name: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  captain: Schema.optional(Schema.String),
  members: Schema.optional(
    Schema.Array(
      Schema.Struct({
        employeeID: Schema.String,
        duty: Schema.optional(Schema.String),
        canAutoDispatch: Schema.optional(Schema.Boolean),
      }),
    ),
  ),
  autoEligible: Schema.optional(Schema.Boolean),
})

export const ProfileApi = HttpApiGroup.make("profile")
  .add(
    HttpApiEndpoint.get("listProfiles", root, {
      query: WorkspaceRoutingQuery,
      success: described(Schema.Array(ProfileView), "Team templates"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "profile.list",
        summary: "List team templates",
        description: "Team templates (roster + captain) available in this workspace; includes the built-in one.",
      }),
    ),
    HttpApiEndpoint.get("profileDetail", `${root}/:profileID`, {
      params: { profileID: Schema.String },
      query: WorkspaceRoutingQuery,
      success: described(ProfileDetail, "Team template"),
      error: [HttpApiError.NotFound],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "profile.detail",
        summary: "Team template detail",
        description: "Template plus its roster (employee, job, role, duty).",
      }),
    ),
    HttpApiEndpoint.post("createProfile", root, {
      query: WorkspaceRoutingQuery,
      payload: ProfileCreatePayload,
      success: described(ProfileDetail, "Created template"),
      error: [HttpApiError.BadRequest],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "profile.create",
        summary: "Create a team template",
        description: "Register a reusable roster; runs copy it, so later edits cannot affect a running run.",
      }),
    ),
    HttpApiEndpoint.patch("updateProfile", `${root}/:profileID`, {
      params: { profileID: Schema.String },
      query: WorkspaceRoutingQuery,
      payload: ProfileUpdatePayload,
      success: described(ProfileDetail, "Updated template"),
      error: [HttpApiError.BadRequest, HttpApiError.NotFound],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "profile.update",
        summary: "Change a team template",
        description:
          "Rename, change the description, swap the captain, replace the roster, or toggle auto dispatch. Bumps `version` only when a field actually changes; running runs keep their snapshot, so edits apply to the next run only.",
      }),
    ),
    HttpApiEndpoint.delete("removeProfile", `${root}/:profileID`, {
      params: { profileID: Schema.String },
      query: WorkspaceRoutingQuery,
      success: described(Schema.Boolean, "Template removed"),
      error: [HttpApiError.NotFound],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "profile.remove",
        summary: "Delete a team template",
        description: "Removes the template and its roster rows. Historical runs keep their snapshots.",
      }),
    ),
    HttpApiEndpoint.get("listEmployees", "/team/employee", {
      query: WorkspaceRoutingQuery,
      success: described(Schema.Array(EmployeeView), "Employees"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "employee.list",
        summary: "List employees",
        description:
          "People that can be placed into a team template (job = agent capability). Archived people are included with archived=true.",
      }),
    ),
    HttpApiEndpoint.post("createEmployee", "/team/employee", {
      query: WorkspaceRoutingQuery,
      payload: EmployeeCreatePayload,
      success: described(EmployeeView, "Created employee"),
      error: [HttpApiError.BadRequest],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "employee.create",
        summary: "Add a person",
        description: "Creates an employee (name + job) that team templates can then reference.",
      }),
    ),
    HttpApiEndpoint.patch("updateEmployee", "/team/employee/:employeeID", {
      params: { employeeID: Schema.String },
      query: WorkspaceRoutingQuery,
      payload: EmployeeUpdatePayload,
      success: described(EmployeeView, "Updated employee"),
      error: [HttpApiError.BadRequest, HttpApiError.NotFound],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "employee.update",
        summary: "Change a person",
        description:
          "Rename, change job, edit overrides, or archive/unarchive. Archiving keeps existing templates and finished runs untouched.",
      }),
    ),
    HttpApiEndpoint.get("employeeRecord", "/team/employee/:employeeID/record", {
      params: { employeeID: Schema.String },
      query: WorkspaceRoutingQuery,
      success: described(EmployeeRecordView, "Facts about this employee's participation"),
      error: [HttpApiError.NotFound],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "employee.record",
        summary: "Facts about one person",
        description:
          "Participation count, rejections of the teams they were on, first-pass verification rate of those teams, and the wall time of runs they joined. Facts only: rejections and pass rates belong to the team, not to the person, and wall time is shared by parallel members. Not a ranking.",
      }),
    ),
    HttpApiEndpoint.get("employeeUsage", "/team/employee/:employeeID/usage", {
      params: { employeeID: Schema.String },
      query: WorkspaceRoutingQuery,
      success: described(EmployeeUsageView, "Usage attributed to this employee"),
      error: [HttpApiError.NotFound],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "employee.usage",
        summary: "Usage of one person",
        description:
          "Spend of the sessions attributed to this employee (including subagents they spawned), grouped by run. Sessions of the same runs that are not attributed to anyone are reported separately as unattributed: a person's number is not a complete bill.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "profile",
      description: "Team templates and employees.",
    }),
  )
