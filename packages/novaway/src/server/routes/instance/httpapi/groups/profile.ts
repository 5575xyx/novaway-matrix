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
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "profile",
      description: "Team templates and employees.",
    }),
  )
