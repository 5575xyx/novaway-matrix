import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { WorkspaceRoutingQuery, WorkspaceRoutingQueryFields } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/run"

/** 运行列表的查询：目录过滤之外，还能按团队筛。 */
export const RunListQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  /**
   * 只看某支团队参与过的运行。
   *
   * 团队页的「最近运行」用它：计划里 `profileID` 记的就是发起时那支团队，
   * 在服务端按计划过滤，界面不必拉全量再自己比对。
   */
  teamID: Schema.optional(Schema.String),
})

/**
 * 运行指标（§12）：本地统计，不上报、不排名。
 *
 * 每个字段都带口径：`unknown` 是「已发生但用量不明」，不并入 `settled`；
 * `failureRate` / `rate` 在分母为零时**不出现**，而不是写成 0；
 * 算不出来的指标列在 `unavailable` 里并写明原因，不编一个数。
 */
export const RunMetricsView = Schema.Struct({
  window: Schema.Struct({
    runs: Schema.Number,
    /** 有事件记录的运行数：百分比类指标的分母是它，不是全部运行。 */
    eventsCovered: Schema.Number,
    from: Schema.optional(Schema.Number),
    to: Schema.optional(Schema.Number),
  }),
  states: Schema.Array(Schema.Struct({ state: Schema.String, runs: Schema.Number })),
  tokens: Schema.Struct({
    settled: Schema.Number,
    /** 用量不明：单独计数，不计入 settled。 */
    unknown: Schema.Number,
    covered: Schema.Number,
    overrunRuns: Schema.Number,
  }),
  rounds: Schema.Array(Schema.Struct({ round: Schema.Number, runs: Schema.Number })),
  rework: Schema.Struct({
    total: Schema.Number,
    top: Schema.Array(Schema.Struct({ reason: Schema.String, count: Schema.Number })),
  }),
  attempts: Schema.Struct({
    dispatched: Schema.Number,
    failed: Schema.Number,
    failureRate: Schema.optional(Schema.Number),
  }),
  blockers: Schema.Struct({
    runs: Schema.Number,
    rate: Schema.optional(Schema.Number),
    byKind: Schema.Array(Schema.Struct({ kind: Schema.String, count: Schema.Number })),
  }),
  /** 钱花在哪（验证开销占比）：只统计有明细且标注了用途的已结算条目。 */
  spend: Schema.Struct({
    dispatch: Schema.Number,
    verification: Schema.Number,
    /** 老账本没有区分用途的那部分：单列，不并入任何一边。 */
    unspecified: Schema.Number,
    /** 验证 / (派发 + 验证)；分母为零时不出现。 */
    verificationShare: Schema.optional(Schema.Number),
    coveredRuns: Schema.Number,
    partialRuns: Schema.Number,
  }),
  unavailable: Schema.Array(Schema.Struct({ metric: Schema.String, reason: Schema.String })),
}).annotate({ identifier: "RunMetricsView" })

/** 指标的取样窗口：最近 `limit` 次运行（默认 30，最多 100）。 */
export const RunMetricsQuery = Schema.Struct({
  ...RunListQuery.fields,
  limit: Schema.optional(Schema.Number),
})

export const RunReplayStep = Schema.Struct({
  seq: Schema.Number,
  at: Schema.Number,
  /** 事件种类原样保留；不认识的种类也留在链上，只是不带任何 payload。 */
  kind: Schema.String,
  teamID: Schema.optional(Schema.String),
  round: Schema.optional(Schema.Number),
  attempt: Schema.optional(Schema.Number),
  acceptanceID: Schema.optional(Schema.String),
  outcome: Schema.optional(Schema.String),
  snapshotID: Schema.optional(Schema.String),
  verifierVersion: Schema.optional(Schema.String),
  /** 计数类字段（claims / acceptance / merged 条数），具体内容不回放。 */
  count: Schema.optional(Schema.Number),
  reason: Schema.optional(Schema.String),
  leaseEpoch: Schema.optional(Schema.Number),
}).annotate({ identifier: "RunReplayStep" })

/**
 * 决策链回放（§12）：回答「为什么它认为完成了」。
 *
 * 与「重跑」不是一回事（§8.5）：回放只还原当时的事件与证据，
 * 不保证重新执行会得到相同结果。`evidence` 说明结论是否有事件流背书 ——
 * 旧版本运行只有验证表、没有 `verification.recorded` 事件时会是 `absent`。
 */
export const RunReplayView = Schema.Struct({
  source: Schema.Literals(["events", "empty"]),
  steps: Schema.Array(RunReplayStep),
  conclusion: Schema.Struct({
    state: Schema.String,
    verdict: Schema.Literals(["complete", "partial", "failed"]),
    deliverable: Schema.Boolean,
    lines: Schema.Array(
      Schema.Struct({
        acceptanceID: Schema.String,
        text: Schema.String,
        /** `unverified` / `stale` 永远不计入通过。 */
        outcome: Schema.String,
        snapshotID: Schema.optional(Schema.String),
        verifierVersion: Schema.optional(Schema.String),
        attempt: Schema.optional(Schema.Number),
        at: Schema.optional(Schema.Number),
      }),
    ),
    counts: Schema.Struct({
      pass: Schema.Number,
      fail: Schema.Number,
      unverified: Schema.Number,
      stale: Schema.Number,
    }),
    evidence: Schema.Literals(["complete", "partial", "absent"]),
    /** 必须照实说的边界，界面直接显示。 */
    notes: Schema.Array(Schema.String),
  }),
}).annotate({ identifier: "RunReplayView" })

export const RunBudget = Schema.Struct({
  tokens: Schema.optional(Schema.Number),
  cost: Schema.optional(Schema.Number),
  /**
   * 墙钟上限（毫秒）。缺省 = 不限；`0` = 一分钟都不给，立刻停。
   * 只在轮次与派发批次之间检查：已经在跑的派发不会被中断（§7.3 硬上限）。
   */
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

/**
 * 用户声明的范围与约束（§5.3 / §13）。
 *
 * 以前这里是 `Schema.Any`：收下就存，从没进过队长的提示词。现在类型化：
 * 已知字段会原样进提示词，字段类型不对就在入口报错；不认识的键按平台默认忽略。
 */
export const RunBrief = Schema.Struct({
  scope: Schema.optional(Schema.Array(Schema.String)),
  files: Schema.optional(Schema.Array(Schema.String)),
  constraints: Schema.optional(Schema.Array(Schema.String)),
  context: Schema.optional(Schema.String),
}).annotate({ identifier: "RunBrief" })

export const RunView = Schema.Struct({
  id: Schema.String,
  sessionID: Schema.String,
  directory: Schema.String,
  /** 所属持久目标（§3.2）；临时任务缺失。 */
  missionID: Schema.optional(Schema.String),
  mode: Schema.Literals(["team", "auto"]),
  goal: Schema.String,
  /** 用户声明的范围与约束（§5.3）：派发时原样进队长提示词，这里可回看。 */
  brief: Schema.optional(RunBrief),
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
  /**
   * 产物与版本（§8.6）：版本由产物内容决定。下游记录的是具体版本，
   * 上游一变，下游的旧结论就失效 —— 界面能看出「它交付的是哪一版」。
   */
  artifacts: Schema.optional(Schema.Array(Schema.Struct({ name: Schema.String, version: Schema.String }))),
  /**
   * 最近一次派发的上下文清单（§6.4）。`brief` 就是模型实际看到的字；
   * `truncated` 为真时界面必须显示 —— 「悄悄少给几条」是不允许的。
   */
  context: Schema.optional(
    Schema.Struct({
      acceptance: Schema.Array(Schema.Struct({ id: Schema.String, version: Schema.Number })),
      rosterVersion: Schema.optional(Schema.String),
      feedback: Schema.Array(Schema.String),
      omitted: Schema.Array(
        Schema.Struct({
          kind: Schema.String,
          count: Schema.Number,
          reason: Schema.String,
        }),
      ),
      truncated: Schema.Boolean,
      builtAt: Schema.Number,
    }),
  ),
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

/**
 * 阻塞项（§11.2）：拒绝不能被静默吞掉，界面必须能指出「卡在哪、为什么、换人有没有用」。
 */
export const RunBlockerView = Schema.Struct({
  seq: Schema.Number,
  at: Schema.Number,
  kind: Schema.String,
  tool: Schema.optional(Schema.String),
  taskID: Schema.optional(Schema.String),
  reason: Schema.optional(Schema.String),
  teamID: Schema.optional(Schema.String),
  files: Schema.optional(Schema.Number),
  /** 换个人来做能不能解决；权限类不能（换人等于提权）。 */
  swappable: Schema.Boolean,
}).annotate({ identifier: "RunBlockerView" })

export const RunDetail = Schema.Struct({
  run: RunView,
  teams: Schema.Array(RunTeamView),
  acceptances: Schema.Array(RunAcceptanceView),
  verifications: Schema.Array(RunVerificationView),
  summary: RunSummaryView,
  blockers: Schema.Array(RunBlockerView),
}).annotate({ identifier: "RunDetail" })

export const RunCreatePayload = Schema.Struct({
  sessionID: Schema.String,
  directory: Schema.String,
  mode: Schema.Literals(["team", "auto"]),
  goal: Schema.String,
  brief: Schema.optional(RunBrief),
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

/**
 * 授权（§11.1）。缺省的只读不是提示词约定，而是工具入口的硬拦截；
 * 放宽只能由人在批准之前显式改。
 */
export const RunPolicyPayload = Schema.Struct({
  readOnly: Schema.Boolean,
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
      query: RunListQuery,
      success: described(Schema.Array(RunView), "Runs"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "run.list",
        summary: "List team runs",
        description: "List orchestration runs in this workspace; `teamID` narrows it to one team's runs.",
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
    HttpApiEndpoint.get("runMetrics", `${root}/metrics`, {
      query: RunMetricsQuery,
      success: described(RunMetricsView, "Aggregated run metrics"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "run.metrics",
        summary: "Aggregated run metrics",
        description:
          "Local aggregate over the most recent runs in this workspace: state counts, settled vs unknown usage, round distribution, top rejection reasons, dispatch failure rate and blocked-run rate. Percentages are omitted when their denominator is zero, and metrics that cannot be derived are listed in `unavailable` with a reason. Nothing is uploaded.",
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
    /**
     * 改变授权（只读 ↔ 可写）。
     *
     * 授权属于计划的一部分，所以改它等于改计划：版本号递增、回到 `awaiting_approval`。
     * 这条路径存在的意义是「放宽必须是显式的」—— 默认只读，允许写操作只能由人在
     * 批准之前点出来，模型没有接口把自己提权。
     */
    HttpApiEndpoint.post("setRunPolicy", `${root}/:runID/policy`, {
      params: { runID: Schema.String },
      query: WorkspaceRoutingQuery,
      payload: RunPolicyPayload,
      success: described(RunDetail, "Updated run"),
      error: [HttpApiError.BadRequest, HttpApiError.NotFound, HttpApiError.Conflict],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "run.policy",
        summary: "Change the run policy",
        description:
          "Switch between read-only and writable before the run starts. Bumps the plan version, so any previous approval becomes stale.",
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
      error: [HttpApiError.NotFound],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "run.events",
        summary: "Run events",
        description: "Append-only event log used for replay and audit.",
      }),
    ),
    HttpApiEndpoint.get("runReplay", `${root}/:runID/replay`, {
      params: { runID: Schema.String },
      query: WorkspaceRoutingQuery,
      success: described(RunReplayView, "Decision chain and its evidence"),
      error: [HttpApiError.NotFound],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "run.replay",
        summary: "Replay the decision chain",
        description:
          "Rebuilds, from the append-only event log plus the verification table, why this run reached its verdict: ordered steps, per-acceptance evidence (pass / fail / unverified / stale kept apart), and whether every pass is backed by an event. This is replay, not re-execution: it never claims a re-run would produce the same result.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "Team runs" }))
