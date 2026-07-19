import { Sha256, UpdatePolicy, VersionSource } from "@/powersnexus/schema"
import { ActionRequest } from "@/powersnexus/bridge-schema"
import { SessionID } from "@/session/schema"
import { WorkflowLevel, WorkflowSnapshot } from "@/powersnexus/workflow-schema"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { WorkspaceRoutingQueryFields } from "../middleware/workspace-routing"
import { described } from "./metadata"

export const ApiVersionRef = Schema.Struct({
  version: Schema.String,
  protocolVersion: Schema.String,
  digest: Sha256,
  source: VersionSource,
  compatible: Schema.Boolean,
  verified: Schema.Boolean,
})

export const StableGateCheck = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  ok: Schema.Boolean,
  detail: Schema.String,
  required: Schema.Boolean,
})

export const StableGateReport = Schema.Struct({
  ready: Schema.Boolean,
  policy: Schema.String,
  effectivePolicy: Schema.String,
  checks: Schema.Array(StableGateCheck),
  blockers: Schema.Array(Schema.String),
})

export const VersionStatus = Schema.Struct({
  policy: UpdatePolicy,
  active: ApiVersionRef,
  bundled: ApiVersionRef,
  previous: Schema.optionalKey(ApiVersionRef),
  installed: Schema.Array(ApiVersionRef),
  available: Schema.optionalKey(ApiVersionRef),
  activationDeferred: Schema.Boolean,
  lastCheckedAt: Schema.optionalKey(Schema.String),
  lastErrorCode: Schema.optionalKey(Schema.String),
  stableGate: Schema.optionalKey(StableGateReport),
})

export const CheckPayload = Schema.Struct({
  requestID: Schema.String,
  channel: Schema.Literal("stable"),
})

export const MutationPayload = Schema.Struct({
  requestID: Schema.String,
  targetDigest: Sha256,
  expectedActiveDigest: Sha256,
})

export const RollbackPayload = Schema.Struct({
  requestID: Schema.String,
  targetDigest: Schema.optional(Sha256),
  expectedActiveDigest: Sha256,
})

export const MutationResponse = Schema.Struct({
  requestID: Schema.String,
  status: Schema.Literals(["installed", "activated", "deferred", "rolled-back"]),
  active: ApiVersionRef,
  target: Schema.optionalKey(ApiVersionRef),
  replayed: Schema.Boolean,
})

export const Binding = Schema.Struct({
  id: Schema.String,
  projectID: Schema.String,
  worktree: Schema.String,
  changeName: Schema.String,
  rootSessionID: Schema.optionalKey(Schema.String),
  powersnexusVersion: Schema.String,
  powersnexusDigest: Sha256,
  protocolVersion: Schema.String,
  level: WorkflowLevel,
  active: Schema.Boolean,
  revision: Schema.Int,
  time: Schema.Struct({ created: Schema.Number, updated: Schema.Number }),
})

export const StatusQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  changeName: Schema.optional(Schema.String),
})

export const CreatePayload = Schema.Struct({
  actionID: Schema.String,
  expectedRevision: Schema.Literal(0),
  changeName: Schema.String,
  level: WorkflowLevel,
})

export const WorkflowActionPayload = Schema.Struct({
  changeName: Schema.String,
  ...ActionRequest.fields,
})

export const BindPayload = Schema.Struct({
  actionID: Schema.String,
  expectedRevision: Schema.Int,
  changeName: Schema.String,
  sessionID: SessionID,
  handoff: Schema.optional(Schema.Boolean),
})

const BrowserQaStep = Schema.Union([
  Schema.Struct({ type: Schema.Literal("snapshot") }),
  Schema.Struct({ type: Schema.Literal("click"), ref: Schema.String }),
  Schema.Struct({ type: Schema.Literal("fill"), ref: Schema.String, value: Schema.String }),
  Schema.Struct({ type: Schema.Literal("press"), key: Schema.String, ref: Schema.optional(Schema.String) }),
  Schema.Struct({ type: Schema.Literal("screenshot"), fullPage: Schema.optional(Schema.Boolean) }),
])

const BrowserQaPayload = Schema.Struct({
  scenarios: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      url: Schema.String,
      steps: Schema.optional(Schema.Array(BrowserQaStep)),
      requiredText: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
  viewports: Schema.optional(Schema.Array(Schema.Struct({ name: Schema.String, width: Schema.Int, height: Schema.Int }))),
  server: Schema.optional(
    Schema.Struct({
      argv: Schema.Array(Schema.String),
      cwd: Schema.String,
      healthUrl: Schema.String,
      timeoutMs: Schema.optional(Schema.Int),
    }),
  ),
})

export const VerifyPayload = Schema.Struct({
  actionID: Schema.String,
  expectedRevision: Schema.Int,
  bindingID: Schema.String,
  evidenceFiles: Schema.optional(Schema.Array(Schema.String)),
  browserQa: Schema.optional(BrowserQaPayload),
  steps: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      argv: Schema.Array(Schema.String),
      cwd: Schema.String,
      timeoutMs: Schema.optional(Schema.Int),
      mode: Schema.optional(Schema.Literals(["command", "service"])),
      readyUrl: Schema.optional(Schema.String),
      dependsOn: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
})

export const RunInfo = Schema.Struct({
  id: Schema.String,
  binding_id: Schema.String,
  action: Schema.String,
  status: Schema.String,
  attempt: Schema.Int,
  snapshot_revision: Schema.Int,
  fingerprint: Schema.Union([Schema.String, Schema.Null]),
  error_code: Schema.Union([Schema.String, Schema.Null]),
  log_directory: Schema.String,
  recovery_policy: Schema.String,
  evidence_files: Schema.Array(Schema.String),
  time_started: Schema.Union([Schema.Number, Schema.Null]),
  time_ended: Schema.Union([Schema.Number, Schema.Null]),
  time_created: Schema.Number,
  time_updated: Schema.Number,
})

export const RunStepInfo = Schema.Struct({
  id: Schema.String,
  run_id: Schema.String,
  step_id: Schema.String,
  sequence: Schema.Int,
  kind: Schema.Literals(["profile", "retry_probe"]),
  profile_step_id: Schema.String,
  argv: Schema.Array(Schema.String),
  cwd: Schema.String,
  timeout_ms: Schema.Union([Schema.Number, Schema.Null]),
  status: Schema.String,
  exit_code: Schema.Union([Schema.Number, Schema.Null]),
  stdout_file: Schema.Union([Schema.String, Schema.Null]),
  stderr_file: Schema.Union([Schema.String, Schema.Null]),
  artifacts: Schema.Array(Schema.String),
  evidence_digest: Schema.Union([Schema.String, Schema.Null]),
  time_started: Schema.Union([Schema.Number, Schema.Null]),
  time_ended: Schema.Union([Schema.Number, Schema.Null]),
  time_created: Schema.Number,
  time_updated: Schema.Number,
})

export const RunDetail = Schema.Struct({
  run: Schema.Union([RunInfo, Schema.Undefined]),
  steps: Schema.Array(RunStepInfo),
  job: Schema.Unknown,
})

export const RunMutationPayload = Schema.Struct({ actionID: Schema.String })
export const RunLogQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  stepID: Schema.String,
  stream: Schema.Literals(["stdout", "stderr"]),
  offset: Schema.optional(Schema.NumberFromString),
  limit: Schema.optional(Schema.NumberFromString),
})
export const RunLogResponse = Schema.Struct({
  text: Schema.String,
  offset: Schema.Number,
  nextOffset: Schema.Number,
  eof: Schema.Boolean,
})
export const EvidenceQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  bindingID: Schema.optional(Schema.String),
  runID: Schema.optional(Schema.String),
})
export const EvidenceResponse = Schema.Struct({
  run: RunInfo,
  steps: Schema.Array(RunStepInfo),
  files: Schema.Array(Schema.String),
})
export const ArchivePayload = Schema.Struct({
  actionID: Schema.String,
  expectedRevision: Schema.Int,
  bindingID: Schema.String,
})
export const ArchiveResponse = Schema.Struct({
  bindingID: Schema.String,
  archivePath: Schema.String,
  replayed: Schema.Boolean,
})

const ApiErrorFields = { code: Schema.String, message: Schema.String }

export class PowersNexusBadRequest extends Schema.ErrorClass<PowersNexusBadRequest>("PowersNexusBadRequest")(
  ApiErrorFields,
  { httpApiStatus: 400 },
) {}
export class PowersNexusForbidden extends Schema.ErrorClass<PowersNexusForbidden>("PowersNexusForbidden")(
  ApiErrorFields,
  { httpApiStatus: 403 },
) {}
export class PowersNexusNotFound extends Schema.ErrorClass<PowersNexusNotFound>("PowersNexusNotFound")(
  ApiErrorFields,
  { httpApiStatus: 404 },
) {}
export class PowersNexusConflict extends Schema.ErrorClass<PowersNexusConflict>("PowersNexusConflict")(
  ApiErrorFields,
  { httpApiStatus: 409 },
) {}
export class PowersNexusUnprocessable extends Schema.ErrorClass<PowersNexusUnprocessable>("PowersNexusUnprocessable")(
  ApiErrorFields,
  { httpApiStatus: 422 },
) {}
export class PowersNexusUnavailable extends Schema.ErrorClass<PowersNexusUnavailable>("PowersNexusUnavailable")(
  ApiErrorFields,
  { httpApiStatus: 503 },
) {}
export class PowersNexusInternalError extends Schema.ErrorClass<PowersNexusInternalError>("PowersNexusInternalError")(
  { code: Schema.String, message: Schema.String },
  { httpApiStatus: 500 },
) {}

export const PowersNexusApiError = Schema.Union([
  PowersNexusBadRequest,
  PowersNexusForbidden,
  PowersNexusNotFound,
  PowersNexusConflict,
  PowersNexusUnprocessable,
  PowersNexusUnavailable,
  PowersNexusInternalError,
])

export const PowersNexusPaths = {
  status: "/powersnexus/status",
  changes: "/powersnexus/changes",
  bind: "/powersnexus/bind",
  actions: "/powersnexus/actions",
  verify: "/powersnexus/verify",
  run: "/powersnexus/runs/:id",
  runCancel: "/powersnexus/runs/:id/cancel",
  runRetry: "/powersnexus/runs/:id/retry",
  runLog: "/powersnexus/runs/:id/log",
  evidence: "/powersnexus/evidence",
  archive: "/powersnexus/archive",
  version: "/powersnexus/version",
  check: "/powersnexus/update/check",
  install: "/powersnexus/update/install",
  activate: "/powersnexus/update/activate",
  rollback: "/powersnexus/update/rollback",
} as const

export const PowersNexusApi = HttpApi.make("powersnexus").add(
    HttpApiGroup.make("powersnexus")
      .add(
        HttpApiEndpoint.get("status", PowersNexusPaths.status, {
          query: StatusQuery,
          success: described(Schema.Union([WorkflowSnapshot, Schema.Null]), "当前 PowersNexus 工作流状态"),
          error: PowersNexusApiError,
        }),
        HttpApiEndpoint.get("changes", PowersNexusPaths.changes, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(Binding), "PowersNexus Change 绑定列表"),
          error: PowersNexusApiError,
        }),
        HttpApiEndpoint.post("createChange", PowersNexusPaths.changes, {
          query: WorkspaceRoutingQuery,
          payload: CreatePayload,
          success: described(Binding, "新建 PowersNexus Change 绑定"),
          error: PowersNexusApiError,
        }),
        HttpApiEndpoint.post("bind", PowersNexusPaths.bind, {
          query: WorkspaceRoutingQuery,
          payload: BindPayload,
          success: described(Binding, "绑定或移交 PowersNexus 根 Session"),
          error: PowersNexusApiError,
        }),
        HttpApiEndpoint.post("action", PowersNexusPaths.actions, {
          query: WorkspaceRoutingQuery,
          payload: WorkflowActionPayload,
          success: described(WorkflowSnapshot, "PowersNexus 工作流动作结果"),
          error: PowersNexusApiError,
        }),
        HttpApiEndpoint.post("verify", PowersNexusPaths.verify, {
          query: WorkspaceRoutingQuery,
          payload: VerifyPayload,
          success: described(Schema.Struct({ runID: Schema.String }), "创建 PowersNexus 交付 run"),
          error: PowersNexusApiError,
        }),
        HttpApiEndpoint.get("run", PowersNexusPaths.run, {
          params: { id: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(RunDetail, "PowersNexus run 与步骤详情"),
          error: PowersNexusApiError,
        }),
        HttpApiEndpoint.post("runCancel", PowersNexusPaths.runCancel, {
          params: { id: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: RunMutationPayload,
          success: described(Schema.Union([Schema.Unknown, Schema.Undefined]), "取消 PowersNexus run"),
          error: PowersNexusApiError,
        }),
        HttpApiEndpoint.post("runRetry", PowersNexusPaths.runRetry, {
          params: { id: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: RunMutationPayload,
          success: described(Schema.Struct({ runID: Schema.String }), "重试 PowersNexus run"),
          error: PowersNexusApiError,
        }),
        HttpApiEndpoint.get("runLog", PowersNexusPaths.runLog, {
          params: { id: Schema.String },
          query: RunLogQuery,
          success: described(RunLogResponse, "分页读取 PowersNexus step 日志"),
          error: PowersNexusApiError,
        }),
        HttpApiEndpoint.get("evidence", PowersNexusPaths.evidence, {
          query: EvidenceQuery,
          success: described(EvidenceResponse, "PowersNexus 交付证据与指纹"),
          error: PowersNexusApiError,
        }),
        HttpApiEndpoint.post("archive", PowersNexusPaths.archive, {
          query: WorkspaceRoutingQuery,
          payload: ArchivePayload,
          success: described(ArchiveResponse, "PowersNexus 本地归档结果"),
          error: PowersNexusApiError,
        }),
        HttpApiEndpoint.get("version", PowersNexusPaths.version, {
        query: WorkspaceRoutingQuery,
        success: described(VersionStatus, "PowersNexus 版本状态"),
        error: PowersNexusApiError,
      }),
      HttpApiEndpoint.post("check", PowersNexusPaths.check, {
        query: WorkspaceRoutingQuery,
        payload: CheckPayload,
        success: described(VersionStatus, "PowersNexus 更新检查结果"),
        error: PowersNexusApiError,
      }),
      HttpApiEndpoint.post("install", PowersNexusPaths.install, {
        query: WorkspaceRoutingQuery,
        payload: MutationPayload,
        success: described(MutationResponse, "PowersNexus 安装结果"),
        error: PowersNexusApiError,
      }),
      HttpApiEndpoint.post("activate", PowersNexusPaths.activate, {
        query: WorkspaceRoutingQuery,
        payload: MutationPayload,
        success: described(MutationResponse, "PowersNexus 激活结果"),
        error: PowersNexusApiError,
      }),
      HttpApiEndpoint.post("rollback", PowersNexusPaths.rollback, {
        query: WorkspaceRoutingQuery,
        payload: RollbackPayload,
        success: described(MutationResponse, "PowersNexus 回滚结果"),
        error: PowersNexusApiError,
      }),
    )
    .annotateMerge(OpenApi.annotations({ title: "PowersNexus", description: "PowersNexus 第一方版本管理接口" }))
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization),
)
