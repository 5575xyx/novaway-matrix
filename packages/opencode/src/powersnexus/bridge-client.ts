import path from "node:path"
import { randomUUID } from "node:crypto"
import { AppProcess } from "@opencode-ai/core/process"
import { Duration, Effect, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import {
  ActionCompleted,
  ActionRequest,
  ActionStarted,
  ArtifactSnapshot,
  BridgeFailure,
  ValidationResult,
  type ActionRequest as ActionRequestType,
} from "./bridge-schema"
import { BridgeClientError } from "./bridge-error"
import type { VersionRef } from "./schema"
import { redactEvidence, redactSecrets } from "./redact"
import { powersnexusNodeExecutable } from "./node-exec"

const MAX_STDOUT = 8 * 1024 * 1024
const MAX_STDERR = 1024 * 1024
const CHANGE_NAME = /^[a-z0-9][a-z0-9._-]{0,79}$/

type BaseInput = {
  version: VersionRef
  worktree: string
  changeName: string
  signal?: AbortSignal
}

function failure(code: string, message: string, options?: { exitCode?: number; evidence?: string[] }) {
  return new BridgeClientError({
    code,
    message: redactSecrets(message),
    traceID: randomUUID(),
    exitCode: options?.exitCode,
    evidence: redactEvidence(options?.evidence ?? []),
  })
}

function validateInput(input: BaseInput) {
  if (!path.isAbsolute(input.worktree)) return failure("PATH_OUTSIDE_WORKTREE", "worktree 必须是绝对路径")
  if (!path.isAbsolute(input.version.cliPath)) {
    return failure("POWERSNEXUS_NOT_AVAILABLE", "VersionRef.cliPath 必须是绝对路径")
  }
  if (!input.version.verified || !input.version.compatible) {
    return failure("POWERSNEXUS_NOT_AVAILABLE", "PowersNexus 版本尚未通过完整验证或不兼容")
  }
  if (input.version.protocolVersion.split(".")[0] !== "1") {
    return failure("PROTOCOL_VERSION_UNSUPPORTED", `不支持 Bridge ${input.version.protocolVersion}`)
  }
  if (!CHANGE_NAME.test(input.changeName)) return failure("CHANGE_NAME_INVALID", "changeName 格式无效")
}

const decodeJson = <A>(schema: Schema.Decoder<A>, text: string) =>
  Effect.try({
    try: () => Schema.decodeUnknownSync(schema)(JSON.parse(text)),
    catch: (cause) => failure("ARTIFACT_INVALID", cause instanceof Error ? cause.message : "Bridge JSON 无效"),
  })

function ensureProtocol(protocolVersion: string) {
  return protocolVersion.split(".")[0] === "1"
    ? Effect.void
    : Effect.fail(failure("PROTOCOL_VERSION_UNSUPPORTED", `不支持 Bridge ${protocolVersion}`))
}

const execute = Effect.fn("PowersNexus.Bridge.execute")(function* (
  input: BaseInput,
  subcommand: "inspect" | "validate" | "transition",
  stdin?: string,
) {
  const invalid = validateInput(input)
  if (invalid) return yield* invalid
  const processService = yield* AppProcess.Service
  const format = subcommand === "transition" ? "jsonl" : "json"
  const command = ChildProcess.make(
    powersnexusNodeExecutable(),
    [input.version.cliPath, "bridge", subcommand, "--change", input.changeName, "--format", format],
    {
      cwd: input.worktree,
      extendEnv: true,
      stdin: stdin === undefined ? "ignore" : "pipe",
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const result = yield* processService
    .run(command, {
      stdin,
      signal: input.signal,
      timeout: Duration.seconds(30),
      maxOutputBytes: MAX_STDOUT,
      maxErrorBytes: MAX_STDERR,
    })
    .pipe(Effect.mapError((cause) => failure("INTERNAL_WORKFLOW_ERROR", redactSecrets(cause.message))))
  if (result.stdoutTruncated || result.stderrTruncated) {
    return yield* failure("ARTIFACT_INVALID", "Bridge 输出超过允许上限", { exitCode: result.exitCode })
  }
  if (result.exitCode === 0) return result.stdout.toString("utf8")
  const parsed = yield* decodeJson(BridgeFailure, redactSecrets(result.stderr.toString("utf8"))).pipe(
    Effect.catch(() => Effect.succeed(undefined)),
  )
  const exitCode = result.exitCode
  const fallback =
    exitCode === 2
      ? "INVALID_REQUEST"
      : exitCode === 3
        ? "REVISION_CONFLICT"
        : exitCode === 4
          ? "CHANGE_NOT_FOUND"
          : "INTERNAL_WORKFLOW_ERROR"
  return yield* failure(parsed?.error.code ?? fallback, parsed?.error.message ?? "Bridge 调用失败", {
    exitCode,
    evidence: [...(parsed?.error.evidence ?? [])],
  })
})

export const inspect = Effect.fn("PowersNexus.Bridge.inspect")(function* (input: BaseInput) {
  const text = yield* execute(input, "inspect")
  const snapshot = yield* decodeJson(ArtifactSnapshot, text)
  yield* ensureProtocol(snapshot.protocolVersion)
  return snapshot
})

export const validate = Effect.fn("PowersNexus.Bridge.validate")(function* (input: BaseInput) {
  const text = yield* execute(input, "validate")
  const result = yield* decodeJson(ValidationResult, text)
  yield* ensureProtocol(result.snapshot.protocolVersion)
  return result
})

export const transition = Effect.fn("PowersNexus.Bridge.transition")(function* (
  input: BaseInput & { request: ActionRequestType },
) {
  const request = yield* Effect.try({
    try: () => Schema.decodeUnknownSync(ActionRequest)(input.request),
    catch: (cause) => failure("INVALID_TRANSITION", cause instanceof Error ? cause.message : "Action 请求无效"),
  })
  const text = yield* execute(input, "transition", JSON.stringify(request))
  const lines = text.split(/\r?\n/).filter(Boolean)
  if (lines.length < 2) return yield* failure("ARTIFACT_INVALID", "Bridge transition 缺少完整 JSONL 事件")
  const started = yield* decodeJson(ActionStarted, lines[0])
  const completed = yield* decodeJson(ActionCompleted, lines.at(-1) ?? "")
  yield* ensureProtocol(started.protocolVersion)
  yield* ensureProtocol(completed.protocolVersion)
  if (started.actionID !== request.actionID || completed.actionID !== request.actionID) {
    return yield* failure("ARTIFACT_INVALID", "Bridge transition actionID 不一致")
  }
  return completed
})

export * as PowersNexusBridgeClient from "./bridge-client"
