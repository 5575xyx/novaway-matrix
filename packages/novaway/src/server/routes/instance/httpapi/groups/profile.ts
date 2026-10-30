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
}).annotate({ identifier: "TeamEmployeeView" })

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
        description: "People that can be placed into a team template (job = agent capability).",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "profile",
      description: "Team templates and employees.",
    }),
  )
