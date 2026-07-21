import { PowersNexusVersion } from "@/powersnexus/version-service"
import { PowersNexusWorkflow } from "@/powersnexus/service"
import { PowersNexusRunner } from "@/powersnexus/runner"
import { PowersNexusDelivery } from "@/powersnexus/delivery"
import { InstanceState } from "@/effect/instance-state"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { redactSecrets } from "@/powersnexus/redact"
import {
  PowersNexusBadRequest,
  PowersNexusConflict,
  PowersNexusForbidden,
  PowersNexusInternalError,
  PowersNexusNotFound,
  PowersNexusUnavailable,
  PowersNexusUnprocessable,
} from "../groups/powersnexus"

function apiError(code: string, message: string) {
  const safeMessage = redactSecrets(message)
  if (["PATH_OUTSIDE_WORKTREE", "PERMISSION_REQUIRED", "EXTERNAL_ACTION_REQUIRED"].includes(code)) {
    return new PowersNexusForbidden({ code, message: safeMessage })
  }
  if (["CHANGE_NOT_FOUND", "RUN_NOT_FOUND"].includes(code)) {
    return new PowersNexusNotFound({ code, message: safeMessage })
  }
  if (
    [
      "PROTOCOL_VERSION_UNSUPPORTED",
      "UPDATE_VERSION_INCOMPATIBLE",
      "UPDATE_ACTIVE_VERSION_CONFLICT",
      "REVISION_CONFLICT",
      "INVALID_TRANSITION",
      "TASK_STATE_CONFLICT",
      "DELIVERY_COMMAND_UNCONFIRMED",
      "RUN_ALREADY_ACTIVE",
      "RUN_INTERRUPTED",
      "ARCHIVE_CONFLICT",
      "BINDING_CONFLICT",
    ].includes(code)
  ) {
    return new PowersNexusConflict({ code, message: safeMessage })
  }
  if (
    [
      "UPDATE_MANIFEST_INVALID",
      "UPDATE_ARTIFACT_INVALID",
      "ARTIFACT_INVALID",
      "STEP_FAILED",
      "RUN_STEP_FAILED",
      "RUN_OUTPUT_LIMIT",
      "RUN_PROCESS_ERROR",
      "REPAIR_LIMIT_REACHED",
    ].includes(code)
  ) {
    return new PowersNexusUnprocessable({ code, message: safeMessage })
  }
  if (["POWERSNEXUS_NOT_AVAILABLE", "BROWSER_UNAVAILABLE"].includes(code)) {
    return new PowersNexusUnavailable({ code, message: safeMessage })
  }
  if (code === "INTERNAL_WORKFLOW_ERROR" || code === "BRIDGE_VERIFY_FAILED") {
    return new PowersNexusInternalError({ code, message: safeMessage })
  }
  return new PowersNexusBadRequest({ code, message: safeMessage })
}

function mapError<A, E, R>(effect: Effect.Effect<A, E, R>) {
  return effect.pipe(
    Effect.mapError(
      (cause) =>
        apiError(
          typeof cause === "object" && cause && "code" in cause && typeof cause.code === "string"
            ? cause.code
            : "INTERNAL_WORKFLOW_ERROR",
          cause instanceof Error ? cause.message : "PowersNexus 版本操作失败",
        ),
    ),
  )
}

function publicVersion(version: {
  version: string
  protocolVersion: string
  digest: string
  source: "bundled" | "downloaded" | "developer"
  compatible: boolean
  verified: boolean
}) {
  return {
    version: version.version,
    protocolVersion: version.protocolVersion,
    digest: version.digest,
    source: version.source,
    compatible: version.compatible,
    verified: version.verified,
  }
}

function publicStatus(status: PowersNexusVersion.Status) {
  // optionalKey 字段必须省略，不能传 undefined，否则 HttpApi 编码会 400/500
  return {
    policy: status.policy,
    active: publicVersion(status.active),
    bundled: publicVersion(status.bundled),
    ...(status.previous ? { previous: publicVersion(status.previous) } : {}),
    installed: status.installed.map(publicVersion),
    ...(status.available ? { available: publicVersion(status.available) } : {}),
    activationDeferred: status.activationDeferred,
    ...(status.lastCheckedAt ? { lastCheckedAt: status.lastCheckedAt } : {}),
    ...(status.lastErrorCode ? { lastErrorCode: status.lastErrorCode } : {}),
    ...(status.stableGate ? { stableGate: status.stableGate } : {}),
  }
}

function publicMutation(result: {
  requestID: string
  status: "installed" | "activated" | "deferred" | "rolled-back"
  active: {
    version: string
    protocolVersion: string
    digest: string
    source: "bundled" | "downloaded" | "developer"
    compatible: boolean
    verified: boolean
  }
  target?: {
    version: string
    protocolVersion: string
    digest: string
    source: "bundled" | "downloaded" | "developer"
    compatible: boolean
    verified: boolean
  }
  replayed: boolean
}) {
  return {
    requestID: result.requestID,
    status: result.status,
    active: publicVersion(result.active),
    ...(result.target ? { target: publicVersion(result.target) } : {}),
    replayed: result.replayed,
  }
}

export const powersnexusHandlers = HttpApiBuilder.group(InstanceHttpApi, "powersnexus", (handlers) =>
  Effect.gen(function* () {
    const versions = yield* PowersNexusVersion.Service
    const workflow = yield* PowersNexusWorkflow.Service
    const runner = yield* PowersNexusRunner.Service
    const delivery = yield* PowersNexusDelivery.Service

    return handlers
      .handle("status", (ctx) => mapError(workflow.status(ctx.query.changeName, ctx.query.sessionID)).pipe(Effect.map((value) => value ?? null)))
      .handle("changes", () => mapError(workflow.list()))
      .handle("createChange", (ctx) =>
        mapError(workflow.create({ changeName: ctx.payload.changeName, level: ctx.payload.level })),
      )
      .handle("bind", (ctx) =>
        mapError(
          workflow.bind({
            changeName: ctx.payload.changeName,
            sessionID: ctx.payload.sessionID,
            expectedRevision: ctx.payload.expectedRevision,
            handoff: ctx.payload.handoff ?? false,
          }),
        ),
      )
      .handle("action", (ctx) =>
        mapError(
          workflow.action(ctx.payload.changeName, {
            actionID: ctx.payload.actionID,
            expectedRevision: ctx.payload.expectedRevision,
            bindingID: ctx.payload.bindingID,
            action: ctx.payload.action,
            input: ctx.payload.input,
          }),
        ),
      )
      .handle("verify", (ctx) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const result = yield* mapError(
            delivery.start({
              bindingID: ctx.payload.bindingID,
              expectedRevision: ctx.payload.expectedRevision,
              worktree: instance.worktree,
              evidenceFiles: [...(ctx.payload.evidenceFiles ?? [])],
              steps: ctx.payload.steps.map((step) => ({
                id: step.id,
                argv: [...step.argv],
                cwd: step.cwd,
                timeoutMs: step.timeoutMs,
                mode: step.mode,
                readyUrl: step.readyUrl,
                dependsOn: step.dependsOn ? [...step.dependsOn] : undefined,
              })),
              ...(ctx.payload.browserQa ? { browserQa: ctx.payload.browserQa } : {}),
            }),
          )
          return { runID: result.runID }
        }),
      )
      .handle("run", (ctx) =>
        mapError(runner.get(ctx.params.id)).pipe(
          Effect.flatMap((result) =>
            result.run ? Effect.succeed(result) : Effect.fail(apiError("RUN_NOT_FOUND", `run 不存在：${ctx.params.id}`)),
          ),
        ),
      )
      .handle("runCancel", (ctx) =>
        mapError(runner.cancel(ctx.params.id)).pipe(
          Effect.flatMap((result) =>
            result ? Effect.succeed(result) : Effect.fail(apiError("RUN_NOT_FOUND", `run 不存在：${ctx.params.id}`)),
          ),
        ),
      )
      .handle("runRetry", (ctx) =>
        mapError(delivery.retry(ctx.params.id)).pipe(Effect.map((result) => ({ runID: result.runID }))),
      )
      .handle("runLog", (ctx) =>
        mapError(
          runner.log({
            runID: ctx.params.id,
            stepID: ctx.query.stepID,
            stream: ctx.query.stream,
            offset: ctx.query.offset ?? 0,
            limit: ctx.query.limit ?? 64 * 1024,
          }),
        ),
      )
      .handle("evidence", (ctx) =>
        mapError(runner.evidence({ bindingID: ctx.query.bindingID, runID: ctx.query.runID })),
      )
      .handle("archive", (ctx) => mapError(workflow.archive(ctx.payload)))
      .handle("version", () => mapError(versions.status()).pipe(Effect.map(publicStatus)))
      .handle("check", () => mapError(versions.check()).pipe(Effect.map(publicStatus)))
      .handle("install", (ctx) =>
        mapError(versions.install(ctx.payload)).pipe(Effect.map(publicMutation)),
      )
      .handle("activate", (ctx) =>
        mapError(versions.activate(ctx.payload)).pipe(Effect.map(publicMutation)),
      )
      .handle("rollback", (ctx) =>
        mapError(versions.rollback(ctx.payload)).pipe(Effect.map(publicMutation)),
      )
  }),
)
