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

export const MissionDiffFile = Schema.Struct({
  path: Schema.String,
  added: Schema.Number,
  removed: Schema.Number,
  binary: Schema.Boolean,
}).annotate({ identifier: "MissionDiffFile" })

/**
 * 累计差异视图：`baseSHA` → 目标工作区当前内容。
 *
 * `untracked` 单独一列：还没被任何提交收录的新文件不是「已交付」，
 * 混进改动统计会让人以为它们已经进去了。`skippedReason` 说明为什么算不出差异。
 */
export const MissionDiffView = Schema.Struct({
  baseSHA: Schema.optional(Schema.String),
  head: Schema.optional(Schema.String),
  files: Schema.Array(MissionDiffFile),
  untracked: Schema.Array(Schema.String),
  truncated: Schema.Boolean,
  skippedReason: Schema.optional(Schema.String),
}).annotate({ identifier: "MissionDiffView" })

export const MissionCreatePayload = Schema.Struct({
  directory: Schema.String,
  goal: Schema.String,
})

export const MissionStatusPayload = Schema.Struct({
  status: Schema.Literals(["active", "done", "abandoned"]),
})

/**
 * 工作区清理结果。
 *
 * `removed: false` 不是错误：目标还活跃、还有运行在用它、目录已经被删掉，
 * 都是用户需要读到的事实，而不是「服务器出错」。
 */
export const MissionCleanup = Schema.Struct({
  removed: Schema.Boolean,
  reason: Schema.optional(Schema.String),
}).annotate({ identifier: "MissionCleanup" })

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
    HttpApiEndpoint.get("missionDiff", `${root}/:missionID/diff`, {
      params: { missionID: Schema.String },
      query: WorkspaceRoutingQuery,
      success: described(MissionDiffView, "Cumulative diff"),
      error: [HttpApiError.NotFound],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "mission.diff",
        summary: "Cumulative diff of a mission",
        description:
          "Changes from the mission's base commit to the worktree's current content. Untracked files are listed separately — they are not delivered yet.",
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
    HttpApiEndpoint.delete("cleanupMission", `${root}/:missionID/worktree`, {
      params: { missionID: Schema.String },
      query: WorkspaceRoutingQuery,
      success: described(MissionCleanup, "Cleanup result"),
      error: [HttpApiError.BadRequest, HttpApiError.NotFound],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "mission.cleanup",
        summary: "Remove an abandoned mission's workspace",
        description:
          "Only abandoned missions can be cleaned up: an active mission may need its workspace for the next run, and a done mission needs it to answer what changed overall.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "Missions", description: "Persistent goals across runs." }))
