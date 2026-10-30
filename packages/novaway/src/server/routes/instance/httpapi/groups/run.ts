import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/run"

export const RunBudget = Schema.Struct({
  tokens: Schema.optional(Schema.Number),
  cost: Schema.optional(Schema.Number),
  wallMs: Schema.optional(Schema.Number),
})

export const RunUsageView = Schema.Struct({
  reserved: Schema.Number,
  settled: Schema.Number,
  unknown: Schema.Number,
  cap: Schema.Number,
  overrun: Schema.Boolean,
  byActor: Schema.optional(
    Schema.Array(
      Schema.Struct({
        actor: Schema.String,
        teamID: Schema.String,
        employeeID: Schema.optional(Schema.String),
        job: Schema.optional(Schema.String),
        committed: Schema.Number,
        basis: Schema.String,
      }),
    ),
  ),
  byJob: Schema.optional(Schema.Array(Schema.Struct({ job: Schema.String, committed: Schema.Number }))),
}).annotate({ identifier: "RunUsageView" })

export const RunView = Schema.Struct({
  id: Schema.String,
  sessionID: Schema.String,
  directory: Schema.String,
  /** 所属持久目标（§3.2）；临时任务缺失。 */
  missionID: Schema.optional(Schema.String),
  mode: Schema.Literals(["team", "auto"]),
  goal: Schema.String,
  state: Schema.String,
  phase: Schema.optional(Schema.String),
  planVersion: Schema.Number,
  roundMain: Schema.Number,
  budget: Schema.optional(RunBudget),
  attempts: Schema.Struct({ business: Schema.Number, formatRetry: Schema.Number }),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  error: Schema.optional(Schema.String),
  terminalReason: Schema.optional(Schema.String),
  /** 本次运行是否只读；缺省 true（审查运行不能改工作区）。 */
  readOnly: Schema.Boolean,
  /** 用量归属快照（§10.3）：运行结束后写入，运行中可能缺失。 */
  usage: Schema.optional(RunUsageView),
}).annotate({ identifier: "RunView" })

export const RunTeamView = Schema.Struct({
  id: Schema.String,
  profileID: Schema.optional(Schema.String),
  phase: Schema.String,
  roundCaptain: Schema.Number,
  verdict: Schema.optional(Schema.Any),
  dependsOn: Schema.Array(Schema.Number),
  /** 团队 worktree 目录；缺失表示这次运行在会话目录里跑（非 git 仓库等）。 */
  worktree: Schema.optional(Schema.String),
}).annotate({ identifier: "RunTeamView" })

export const RunAcceptanceView = Schema.Struct({
  id: Schema.String,
  taskID: Schema.optional(Schema.String),
  specID: Schema.String,
  version: Schema.Number,
  text: Schema.String,
  kind: Schema.String,
  expected: Schema.optional(Schema.String),
  owner: Schema.optional(Schema.String),
}).annotate({ identifier: "RunAcceptanceView" })

export const RunVerificationView = Schema.Struct({
  id: Schema.String,
  acceptanceID: Schema.String,
  attempt: Schema.Number,
  snapshotID: Schema.String,
  verifierVersion: Schema.String,
  outcome: Schema.Literals(["pass", "fail", "unverified"]),
  measured: Schema.optional(Schema.String),
  evidenceRef: Schema.optional(Schema.String),
  at: Schema.Number,
}).annotate({ identifier: "RunVerificationView" })

export const RunSummaryLine = Schema.Struct({
  acceptanceID: Schema.String,
  text: Schema.String,
  outcome: Schema.String,
  measured: Schema.optional(Schema.String),
  snapshotID: Schema.optional(Schema.String),
}).annotate({ identifier: "RunSummaryLine" })

export const RunSummaryView = Schema.Struct({
  pass: Schema.Number,
  fail: Schema.Number,
  unverified: Schema.Number,
  stale: Schema.Number,
  unresolved: Schema.Number,
  ratio: Schema.Number,
  deliverable: Schema.Boolean,
  verdict: Schema.Literals(["complete", "partial", "failed"]),
  lines: Schema.Array(RunSummaryLine),
}).annotate({ identifier: "RunSummaryView" })

export const RunEventView = Schema.Struct({
  seq: Schema.Number,
  at: Schema.Number,
  kind: Schema.String,
  payload: Schema.optional(Schema.Any),
}).annotate({ identifier: "RunEventView" })

export const RunDetail = Schema.Struct({
  run: RunView,
  teams: Schema.Array(RunTeamView),
  acceptances: Schema.Array(RunAcceptanceView),
  verifications: Schema.Array(RunVerificationView),
  summary: RunSummaryView,
}).annotate({ identifier: "RunDetail" })

export const RunCreatePayload = Schema.Struct({
  sessionID: Schema.String,
  directory: Schema.String,
  mode: Schema.Literals(["team", "auto"]),
  goal: Schema.String,
  brief: Schema.optional(Schema.Any),
  acceptance: Schema.optional(Schema.Array(Schema.Any)),
  budget: Schema.optional(RunBudget),
  /**
   * 用团队模板发起（§4.5 的「试跑」）：名册会作为快照复制进运行，
   * 计划直接用模板名建好，用户只需批准并启动。
   */
  profileID: Schema.optional(Schema.String),
  /** 归入一个持久目标（§3.2）；省略表示这次运行是一次性任务。 */
  missionID: Schema.optional(Schema.String),
  /**
   * 是否允许本次运行改工作区。缺省 false（只读审查）；放开写操作必须显式写出来，
   * 而且它属于计划的一部分——改它等于改计划，要重新批准。
   */
  readOnly: Schema.optional(Schema.Boolean),
})

export const RunPlanPayload = Schema.Struct({
  teams: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      profileID: Schema.optional(Schema.String),
      profileVersion: Schema.optional(Schema.Number),
      scope: Schema.optional(Schema.Array(Schema.String)),
      acceptance: Schema.optional(Schema.Array(Schema.String)),
      dependsOn: Schema.optional(Schema.Array(Schema.Number)),
    }),
  ),
  notes: Schema.optional(Schema.String),
  /** 同 `RunCreatePayload.readOnly`：缺省只读。 */
  readOnly: Schema.optional(Schema.Boolean),
})

export const RunApprovePayload = Schema.Struct({
  planVersion: Schema.Number,
  budget: RunBudget,
  by: Schema.optional(Schema.Literals(["user", "main"])),
})

export const RunAcceptancePayload = Schema.Struct({
  taskID: Schema.optional(Schema.String),
  specID: Schema.String,
  text: Schema.String,
  kind: Schema.Literals(["test", "diff", "file", "rubric", "human"]),
  expected: Schema.optional(Schema.String),
  /** 团队 ID；省略表示全局验收（合并快照上重验）。 */
  owner: Schema.optional(Schema.String),
})

export const RunExecutePayload = Schema.Struct({
  /** 队长使用的 agent 名；缺省用默认 agent。 */
  captain: Schema.optional(Schema.String),
  /** 验证使用的 agent 名；缺省用队长 agent。 */
  verifier: Schema.optional(Schema.String),
  maxRounds: Schema.optional(Schema.Number),
  maxBusinessAttempts: Schema.optional(Schema.Number),
  reserveTokens: Schema.optional(Schema.Number),
  concurrency: Schema.optional(Schema.Number),
})

export const RunWorktreeCleanup = Schema.Struct({
  directory: Schema.String,
  removed: Schema.Boolean,
  error: Schema.optional(Schema.String),
}).annotate({ identifier: "RunWorktreeCleanup" })

/**
 * 显式合并的结果。
 *
 * 拒绝合并也算正常结果（`merged: false`）而不是 400：拒绝的原因是
 * 「工作区不干净」「没有集成分支」这类用户需要读到并处理的事实。
 */
export const RunMergeResult = Schema.Struct({
  merged: Schema.Boolean,
  branch: Schema.optional(Schema.String),
  sha: Schema.optional(Schema.String),
  files: Schema.optional(Schema.Array(Schema.String)),
  message: Schema.optional(Schema.String),
}).annotate({ identifier: "RunMergeResult" })

export const RunApi = HttpApiGroup.make("run")
  .add(
    HttpApiEndpoint.get("listRuns", root, {
      query: WorkspaceRoutingQuery,
      success: described(Schema.Array(RunView), "Runs"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "run.list",
        summary: "List team runs",
        description: "List orchestration runs in this workspace.",
      }),
    ),
    HttpApiEndpoint.post("createRun", root, {
      query: WorkspaceRoutingQuery,
      payload: RunCreatePayload,
      success: described(RunDetail, "Created run"),
      error: [HttpApiError.BadRequest],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "run.create",
        summary: "Create a run",
        description: "Create a team orchestration run in planning state.",
      }),
    ),
    HttpApiEndpoint.get("runDetail", `${root}/:runID`, {
      params: { runID: Schema.String },
      query: WorkspaceRoutingQuery,
      success: described(RunDetail, "Run detail"),
      error: [HttpApiError.NotFound],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "run.detail",
        summary: "Run detail",
        description: "Run, teams, acceptance lines, verifications and the folded summary.",
      }),
    ),
    HttpApiEndpoint.post("setRunPlan", `${root}/:runID/plan`, {
      params: { runID: Schema.String },
      query: WorkspaceRoutingQuery,
      payload: RunPlanPayload,
      success: described(RunDetail, "Updated run"),
      error: [HttpApiError.NotFound],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "run.plan",
        summary: "Set the plan",
        description: "Replace the plan and bump its version. Previous approvals become stale.",
      }),
    ),
    HttpApiEndpoint.post("approveRun", `${root}/:runID/approve`, {
      params: { runID: Schema.String },
      query: WorkspaceRoutingQuery,
      payload: RunApprovePayload,
      success: described(RunDetail, "Approved run"),
      error: [HttpApiError.BadRequest, HttpApiError.NotFound, HttpApiError.Conflict],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "run.approve",
        summary: "Approve the plan",
        description: "Approve a specific plan version with its budget, then start the run.",
      }),
    ),
    HttpApiEndpoint.post("addRunAcceptance", `${root}/:runID/acceptance`, {
      params: { runID: Schema.String },
      query: WorkspaceRoutingQuery,
      payload: RunAcceptancePayload,
      success: described(RunAcceptanceView, "Registered acceptance"),
      error: [HttpApiError.NotFound],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "run.acceptance.add",
        summary: "Add an acceptance line",
        description: "Register one verifiable acceptance line for this run.",
      }),
    ),
    HttpApiEndpoint.post("executeRun", `${root}/:runID/execute`, {
      params: { runID: Schema.String },
      query: WorkspaceRoutingQuery,
      payload: RunExecutePayload,
      success: described(RunView, "Running"),
      error: [HttpApiError.BadRequest, HttpApiError.NotFound],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "run.execute",
        summary: "Execute the run",
        description: "Dispatch to captains in the background and poll run detail for progress.",
      }),
    ),
    HttpApiEndpoint.delete("removeRunWorktrees", `${root}/:runID/worktrees`, {
      params: { runID: Schema.String },
      query: WorkspaceRoutingQuery,
      success: described(Schema.Array(RunWorktreeCleanup), "Cleaned worktrees"),
      error: [HttpApiError.BadRequest, HttpApiError.NotFound],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "run.worktrees.remove",
        summary: "Remove a finished run's worktrees",
        description:
          "Deletes the team worktrees and the integration worktree of a terminal run. The integration branch is the deliverable — merge or discard it first.",
      }),
    ),
    HttpApiEndpoint.post("mergeRun", `${root}/:runID/merge`, {
      params: { runID: Schema.String },
      query: WorkspaceRoutingQuery,
      success: described(RunMergeResult, "Merge result"),
      error: [HttpApiError.BadRequest, HttpApiError.NotFound],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "run.merge",
        summary: "Merge the run's integration branch",
        description:
          "Explicitly merges novaway/integrate/<run> into the branch the user currently has checked out. Refuses when the run is not finished, when there is no integration commit, or when the working tree is dirty.",
      }),
    ),
    HttpApiEndpoint.post("cancelRun", `${root}/:runID/cancel`, {
      params: { runID: Schema.String },
      query: WorkspaceRoutingQuery,
      success: described(RunDetail, "Cancelled run"),
      error: [HttpApiError.NotFound],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "run.cancel",
        summary: "Cancel the run",
        description: "Stop dispatching, keep what already happened, then settle the run as cancelled.",
      }),
    ),
    HttpApiEndpoint.get("runEvents", `${root}/:runID/events`, {
      params: { runID: Schema.String },
      query: WorkspaceRoutingQuery,
      success: described(Schema.Array(RunEventView), "Events"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "run.events",
        summary: "Run events",
        description: "Append-only event log used for replay and audit.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "Team runs" }))
