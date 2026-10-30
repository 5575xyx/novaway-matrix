import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/team/mission"

/**
 * Mission 视图（§3.2）。
 *
 * `label` 是给界面看的 `M-001`；模型与工具用的始终是 `id` —— 编号只出现在人眼前，
 * 不让模型拿「M-003」做一次多余的 id 转换。
 */
export const MissionView = Schema.Struct({
  id: Schema.String,
  number: Schema.Number,
  label: Schema.String,
  directory: Schema.String,
  goal: Schema.String,
  status: Schema.Literals(["active", "done", "abandoned"]),
  /** 目标开始时的提交：累计差异从这里算。 */
  baseSHA: Schema.optional(Schema.String),
  /** 跨运行复用的工作区；第一次运行准备之前缺失。 */
  worktree: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  /** 归属到该目标的运行次数（含已结束的）。 */
  runCount: Schema.Number,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
}).annotate({ identifier: "MissionView" })

export const MissionCreatePayload = Schema.Struct({
  directory: Schema.String,
  goal: Schema.String,
})

export const MissionStatusPayload = Schema.Struct({
  status: Schema.Literals(["active", "done", "abandoned"]),
})

export const MissionApi = HttpApiGroup.make("mission")
  .add(
    HttpApiEndpoint.get("listMissions", root, {
      query: WorkspaceRoutingQuery,
      success: described(Schema.Array(MissionView), "Missions"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "mission.list",
        summary: "List missions",
        description: "Persistent goals for this workspace; runs may be attached to one and reuse its worktree.",
      }),
    ),
    HttpApiEndpoint.get("missionDetail", `${root}/:missionID`, {
      params: { missionID: Schema.String },
      query: WorkspaceRoutingQuery,
      success: described(MissionView, "Mission"),
      error: [HttpApiError.NotFound],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "mission.detail",
        summary: "Mission detail",
        description: "Goal, status, frozen base commit and the shared worktree.",
      }),
    ),
    HttpApiEndpoint.post("createMission", root, {
      query: WorkspaceRoutingQuery,
      payload: MissionCreatePayload,
      success: described(MissionView, "Created mission"),
      error: [HttpApiError.BadRequest],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "mission.create",
        summary: "Create a mission",
        description: "Allocates a non-reusable number and freezes the base commit; status is independent of runs.",
      }),
    ),
    HttpApiEndpoint.patch("updateMission", `${root}/:missionID`, {
      params: { missionID: Schema.String },
      query: WorkspaceRoutingQuery,
      payload: MissionStatusPayload,
      success: described(MissionView, "Updated mission"),
      error: [HttpApiError.BadRequest, HttpApiError.NotFound],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "mission.update",
        summary: "Update mission status",
        description: "Only the user (or a member) sets this: finishing a run never completes a mission.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "Missions", description: "Persistent goals across runs." }))
