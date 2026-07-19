import path from "node:path"
import { createHash } from "node:crypto"
import { AppProcess } from "@opencode-ai/core/process"
import { NodeFileSystem } from "@effect/platform-node"
import { BackgroundJob } from "@/background/job"
import { Bus } from "@/bus"
import { Identifier } from "@/id/id"
import { Cause, Context, Duration, Effect, Exit, FileSystem, Layer, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import type { ChildProcessHandle } from "effect/unstable/process/ChildProcessSpawner"
import { make as makeRunRepository, type RunStep } from "./run-repository"
import { Event } from "./events"
import { redactBytes } from "./redact"
import { assertAutoLocalApprove, assertNetworkTargetAllowed } from "./isolation"

export type StepMode = "command" | "service"

export type StepInput = {
  id: string
  argv: string[]
  cwd: string
  timeoutMs?: number
  kind?: "profile" | "retry_probe"
  profileStepID?: string
  mode?: StepMode
  readyUrl?: string
  dependsOn?: string[]
}

export type FinalizeInput = { runID: string; input: RunInput; steps: RunStep[] }
export type Finalize = (input: FinalizeInput) => Effect.Effect<{ fingerprint: string; evidenceFiles?: string[] }, unknown>

export type RunInput = {
  bindingID: string
  action: string
  snapshotRevision: number
  worktree: string
  steps: StepInput[]
  evidenceFiles?: string[]
  finalize?: Finalize
  attempt?: number
}

export class RunnerError extends Schema.TaggedErrorClass<RunnerError>()("PowersNexusRunnerError", {
  code: Schema.String,
  message: Schema.String,
}) {}

function runnerError(code: string, message: string) {
  return new RunnerError({ code, message })
}

type StepMeta = {
  mode: StepMode
  readyUrl?: string
  dependsOn: string[]
}

const META_PREFIX = "powersnexus-step-meta:"

function encodeMeta(step: StepInput): string[] {
  const meta: StepMeta = {
    mode: step.mode === "service" ? "service" : "command",
    readyUrl: step.readyUrl,
    dependsOn: step.dependsOn ?? [],
  }
  return [`${META_PREFIX}${JSON.stringify(meta)}`]
}

function decodeMeta(artifacts: string[] | null | undefined): StepMeta {
  const raw = (artifacts ?? []).find((item) => item.startsWith(META_PREFIX))?.slice(META_PREFIX.length)
  if (!raw) return { mode: "command", dependsOn: [] }
  try {
    const parsed = JSON.parse(raw) as StepMeta
    return {
      mode: parsed.mode === "service" ? "service" : "command",
      readyUrl: typeof parsed.readyUrl === "string" ? parsed.readyUrl : undefined,
      dependsOn: Array.isArray(parsed.dependsOn) ? parsed.dependsOn.filter((item) => typeof item === "string") : [],
    }
  } catch {
    return { mode: "command", dependsOn: [] }
  }
}

function validateStep(step: StepInput, worktree: string) {
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(step.id)) throw runnerError("RUN_STEP_INVALID", "step id 格式无效")
  if (step.argv.length === 0 || step.argv.some((value) => value.includes("\0"))) {
    throw runnerError("RUN_STEP_INVALID", "step argv 必须是非空且不含 NUL 的字符串数组")
  }
  if (step.mode === "service" && step.readyUrl) {
    try {
      assertNetworkTargetAllowed(step.readyUrl, undefined, { auto: true })
    } catch (cause) {
      throw runnerError("RUN_STEP_INVALID", cause instanceof Error ? cause.message : "service readyUrl 无效")
    }
  }
  const cwd = path.resolve(step.cwd)
  const root = path.resolve(worktree)
  const relative = path.relative(root, cwd)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw runnerError("PATH_OUTSIDE_WORKTREE", "step cwd 必须位于当前 Worktree 内")
  }
  return { ...step, cwd }
}

function retryProbeID(stepID: string, existing: Set<string>) {
  for (let attempt = 1; attempt <= 100; attempt++) {
    const suffix = attempt === 1 ? ".retry" : `.retry${attempt}`
    const candidate = `${stepID.slice(0, 80 - suffix.length)}${suffix}`
    if (!existing.has(candidate)) return candidate
  }
  throw runnerError("RUN_STEP_INVALID", "无法为失败步骤生成唯一的重试标识")
}

export const make = Effect.fn("PowersNexus.Runner.make")(function* () {
  const fs = yield* FileSystem.FileSystem
  const appProcess = yield* AppProcess.Service
  const jobs = yield* BackgroundJob.Service
  const bus = yield* Bus.Service
  const repository = yield* makeRunRepository()
  const serviceHandles = new Map<string, ChildProcessHandle[]>()

  const trackService = (runID: string, handle: ChildProcessHandle) => {
    const current = serviceHandles.get(runID) ?? []
    current.push(handle)
    serviceHandles.set(runID, current)
  }

  const stopServices = Effect.fnUntraced(function* (runID: string) {
    const handles = serviceHandles.get(runID) ?? []
    serviceHandles.delete(runID)
    for (const handle of handles) {
      yield* handle.kill({ forceKillAfter: Duration.seconds(2) }).pipe(Effect.catch(() => Effect.void))
    }
  })

  const waitForReady = Effect.fnUntraced(function* (
    url: string | undefined,
    handle: ChildProcessHandle,
    timeoutMs: number,
  ) {
    if (!url) {
      // 无 readyUrl 时仅确认服务进程仍在运行
      if (!(yield* handle.isRunning.pipe(Effect.catch(() => Effect.succeed(false))))) {
        return yield* runnerError("RUN_STEP_FAILED", "服务步骤在启动后立即退出")
      }
      return
    }
    const deadline = Date.now() + Math.max(1_000, Math.min(timeoutMs, 10 * 60_000))
    const probe = () =>
      Effect.tryPromise({
        try: async () => {
          const response = await fetch(url, { signal: AbortSignal.timeout(2_000) })
          return response.status < 500
        },
        catch: () => new Error("health probe failed"),
      }).pipe(Effect.orElseSucceed(() => false))

    const loop = (): Effect.Effect<void, RunnerError> =>
      Effect.gen(function* () {
        if (yield* probe()) return
        if (!(yield* handle.isRunning.pipe(Effect.catch(() => Effect.succeed(false))))) {
          return yield* runnerError("RUN_STEP_FAILED", `服务在健康探测前退出：${url}`)
        }
        if (Date.now() >= deadline) {
          return yield* runnerError("RUN_STEP_FAILED", `服务健康探测超时：${url}`)
        }
        yield* Effect.sleep("100 millis")
        return yield* loop()
      })
    yield* loop()
  })

  const failRun = Effect.fnUntraced(function* (
    runID: string,
    bindingID: string,
    stepID: string,
    rowID: string,
    stdoutFile: string,
    stderrFile: string,
    code: string,
    message: string,
    exitCode?: number,
    evidenceDigest?: string,
  ) {
    yield* stopServices(runID)
    yield* repository.updateStep(rowID, {
      status: "failed",
      exit_code: exitCode,
      stdout_file: stdoutFile,
      stderr_file: stderrFile,
      evidence_digest: evidenceDigest,
      time_ended: Date.now(),
    })
    yield* repository.updateRun(runID, {
      status: "failed",
      error_code: code,
      time_ended: Date.now(),
    })
    yield* bus.publish(Event.StepCompleted, {
      runID,
      stepID,
      status: "failed",
      exitCode,
      evidenceDigest,
      timestamp: new Date().toISOString(),
    })
    yield* bus.publish(Event.RunCompleted, {
      runID,
      bindingID,
      status: "failed",
      errorCode: code,
      timestamp: new Date().toISOString(),
    })
    return yield* runnerError(code, message)
  })

  const execute = Effect.fnUntraced(function* (runID: string, input: RunInput, steps: StepInput[], logDirectory: string) {
    yield* repository.updateRun(runID, { status: "running", time_started: Date.now() })
    yield* bus.publish(Event.RunStarted, {
      runID,
      bindingID: input.bindingID,
      action: input.action,
      timestamp: new Date().toISOString(),
    })
    const completed = new Set<string>()
    try {
      for (const step of steps) {
        const rowID = `${runID}:${step.id}`
        const stdoutFile = path.join(logDirectory, `${step.id}.stdout.log`)
        const stderrFile = path.join(logDirectory, `${step.id}.stderr.log`)
        const meta = {
          mode: step.mode === "service" ? ("service" as const) : ("command" as const),
          readyUrl: step.readyUrl,
          dependsOn: step.dependsOn ?? [],
        }
        for (const dependency of meta.dependsOn) {
          if (!completed.has(dependency)) {
            return yield* failRun(
              runID,
              input.bindingID,
              step.id,
              rowID,
              stdoutFile,
              stderrFile,
              "RUN_STEP_INVALID",
              `步骤 ${step.id} 依赖的 ${dependency} 尚未通过`,
            )
          }
        }
        yield* repository.updateStep(rowID, { status: "running", time_started: Date.now() })
        yield* bus.publish(Event.StepStarted, { runID, stepID: step.id, timestamp: new Date().toISOString() })

        if (meta.mode === "service") {
          const handle = yield* appProcess
            .spawn(
              ChildProcess.make(step.argv[0], step.argv.slice(1), {
                cwd: step.cwd,
                extendEnv: true,
                stdin: "ignore",
                stdout: "pipe",
                stderr: "pipe",
              }),
            )
            .pipe(
              Effect.mapError((cause) =>
                runnerError("RUN_PROCESS_ERROR", cause instanceof Error ? cause.message : "服务步骤启动失败"),
              ),
            )
          trackService(runID, handle)
          yield* waitForReady(meta.readyUrl, handle, step.timeoutMs ?? 10 * 60 * 1000).pipe(
            Effect.tapError(() =>
              Effect.gen(function* () {
                yield* fs.writeFile(stdoutFile, new TextEncoder().encode(""))
                yield* fs.writeFile(stderrFile, new TextEncoder().encode(`服务步骤未就绪：${meta.readyUrl ?? step.id}`))
              }),
            ),
            Effect.catch((cause) =>
              failRun(
                runID,
                input.bindingID,
                step.id,
                rowID,
                stdoutFile,
                stderrFile,
                cause instanceof RunnerError ? cause.code : "RUN_STEP_FAILED",
                cause instanceof RunnerError ? cause.message : `服务步骤失败：${step.id}`,
              ),
            ),
          )
          const evidenceDigest = createHash("sha256")
            .update(step.id)
            .update(meta.readyUrl ?? "service")
            .update("running")
            .digest("hex")
          yield* Effect.all([
            fs.writeFile(stdoutFile, new TextEncoder().encode(`service-ready ${meta.readyUrl ?? step.id}\n`)),
            fs.writeFile(stderrFile, new Uint8Array()),
          ])
          yield* repository.updateStep(rowID, {
            status: "passed",
            exit_code: null,
            stdout_file: stdoutFile,
            stderr_file: stderrFile,
            evidence_digest: evidenceDigest,
            time_ended: Date.now(),
          })
          yield* bus.publish(Event.StepCompleted, {
            runID,
            stepID: step.id,
            status: "passed",
            exitCode: undefined,
            evidenceDigest,
            timestamp: new Date().toISOString(),
          })
          completed.add(step.id)
          continue
        }

        const result = yield* appProcess
          .run(
            ChildProcess.make(step.argv[0], step.argv.slice(1), {
              cwd: step.cwd,
              extendEnv: true,
              stdin: "ignore",
              stdout: "pipe",
              stderr: "pipe",
            }),
            {
              timeout: Duration.millis(step.timeoutMs ?? 10 * 60 * 1000),
              maxOutputBytes: 64 * 1024 * 1024,
              maxErrorBytes: 16 * 1024 * 1024,
            },
          )
          .pipe(
            Effect.onExit((exit) => {
              if (Exit.isSuccess(exit)) return Effect.void
              const cancelled = Cause.hasInterruptsOnly(exit.cause)
              return Effect.all([
                stopServices(runID),
                fs.writeFile(stdoutFile, new Uint8Array()),
                fs.writeFile(stderrFile, new TextEncoder().encode(cancelled ? "运行已取消" : "进程执行失败")),
                repository.updateStep(rowID, {
                  status: cancelled ? "cancelled" : "failed",
                  stdout_file: stdoutFile,
                  stderr_file: stderrFile,
                  time_ended: Date.now(),
                }),
                repository.updateRun(runID, {
                  status: cancelled ? "cancelled" : "failed",
                  error_code: cancelled ? "RUN_CANCELLED" : "RUN_PROCESS_ERROR",
                  time_ended: Date.now(),
                }),
              ]).pipe(Effect.asVoid)
            }),
          )
        const safeStdout = redactBytes(result.stdout)
        const safeStderr = redactBytes(result.stderr)
        yield* Effect.all([fs.writeFile(stdoutFile, safeStdout), fs.writeFile(stderrFile, safeStderr)])
        const evidenceDigest = createHash("sha256")
          .update(safeStdout)
          .update(safeStderr)
          .update(String(result.exitCode))
          .digest("hex")
        if (result.exitCode !== 0 || result.stdoutTruncated || result.stderrTruncated) {
          return yield* failRun(
            runID,
            input.bindingID,
            step.id,
            rowID,
            stdoutFile,
            stderrFile,
            result.stdoutTruncated || result.stderrTruncated ? "RUN_OUTPUT_LIMIT" : "RUN_STEP_FAILED",
            `交付步骤失败：${step.id}`,
            result.exitCode,
            evidenceDigest,
          )
        }
        yield* repository.updateStep(rowID, {
          status: "passed",
          exit_code: result.exitCode,
          stdout_file: stdoutFile,
          stderr_file: stderrFile,
          evidence_digest: evidenceDigest,
          time_ended: Date.now(),
        })
        yield* bus.publish(Event.StepCompleted, {
          runID,
          stepID: step.id,
          status: "passed",
          exitCode: result.exitCode,
          evidenceDigest,
          timestamp: new Date().toISOString(),
        })
        completed.add(step.id)
      }

      const stepsForEvidence = (yield* repository.listSteps(runID)).filter((step) => step.kind === "profile")
      const finalized = input.finalize
        ? yield* input.finalize({ runID, input, steps: stepsForEvidence }).pipe(
            Effect.mapError((cause) =>
              runnerError(
                typeof cause === "object" && cause && "code" in cause && typeof cause.code === "string"
                  ? cause.code
                  : "BRIDGE_VERIFY_FAILED",
                cause instanceof Error ? cause.message : "写入 PowersNexus 交付证据失败",
              ),
            ),
            Effect.tapError((cause) =>
              Effect.all([
                stopServices(runID),
                repository.updateRun(runID, { status: "failed", error_code: cause.code, time_ended: Date.now() }),
              ]),
            ),
          )
        : undefined
      yield* stopServices(runID)
      yield* repository.updateRun(runID, {
        status: "passed",
        fingerprint: finalized?.fingerprint,
        evidence_files: finalized?.evidenceFiles ?? input.evidenceFiles ?? [],
        time_ended: Date.now(),
      })
      if (finalized) {
        yield* bus.publish(Event.EvidenceAdded, {
          runID,
          bindingID: input.bindingID,
          fingerprint: finalized.fingerprint,
          timestamp: new Date().toISOString(),
        })
      }
      yield* bus.publish(Event.RunCompleted, {
        runID,
        bindingID: input.bindingID,
        status: "passed",
        timestamp: new Date().toISOString(),
      })
    } catch (cause) {
      yield* stopServices(runID)
      throw cause
    }
  })

  const start = Effect.fn("PowersNexus.Runner.start")(function* (input: RunInput) {
    const worktree = path.resolve(input.worktree)
    assertAutoLocalApprove(input.action)
    const steps = yield* Effect.try({
      try: () => input.steps.map((step) => validateStep(step, worktree)),
      catch: (cause) => (cause instanceof RunnerError ? cause : runnerError("RUN_STEP_INVALID", "步骤配置无效")),
    })
    if (new Set(steps.map((step) => step.id)).size !== steps.length) {
      return yield* runnerError("RUN_STEP_INVALID", "同一 run 不能包含重复 step id")
    }
    const runID = Identifier.create("run", "ascending")
    const logDirectory = path.join(worktree, ".novaway", "powersnexus", "runs", runID)
    yield* fs.makeDirectory(logDirectory, { recursive: true })
    const now = Date.now()
    yield* repository.createRun({
      id: runID,
      binding_id: input.bindingID,
      action: input.action,
      status: "pending",
      attempt: input.attempt ?? 1,
      snapshot_revision: input.snapshotRevision,
      log_directory: logDirectory,
      recovery_policy: "retry-failed-step-then-full-run",
      evidence_files: input.evidenceFiles ?? [],
      time_created: now,
      time_updated: now,
    })
    yield* repository.createSteps(
      steps.map((step, sequence) => ({
        id: `${runID}:${step.id}`,
        run_id: runID,
        step_id: step.id,
        sequence,
        kind: step.kind ?? "profile",
        profile_step_id: step.profileStepID ?? step.id,
        argv: step.argv,
        cwd: step.cwd,
        timeout_ms: step.timeoutMs,
        status: "pending" as const,
        artifacts: encodeMeta(step),
        time_created: now,
        time_updated: now,
      })),
    )
    const job = yield* jobs.start({
      id: runID,
      type: "powersnexus.delivery",
      title: `PowersNexus ${input.action}`,
      metadata: { runID, bindingID: input.bindingID },
      run: Effect.scoped(execute(runID, input, steps, logDirectory)).pipe(Effect.as("PowersNexus 交付运行完成")),
    })
    return { runID, job }
  })

  return {
    recover: repository.recoverInterrupted,
    start,
    get: (runID: string) =>
      Effect.all({ run: repository.getRun(runID), steps: repository.listSteps(runID), job: jobs.get(runID) }),
    wait: (runID: string, timeout?: number) => jobs.wait({ id: runID, timeout }),
    evidence: (input: { bindingID?: string; runID?: string }) =>
      Effect.gen(function* () {
        const run = input.runID
          ? yield* repository.getRun(input.runID)
          : input.bindingID
            ? (yield* repository.listRuns(input.bindingID)).find((item) => item.fingerprint !== null)
            : undefined
        if (!run) return yield* runnerError("RUN_NOT_FOUND", "未找到可用的 PowersNexus 交付证据")
        return { run, steps: yield* repository.listSteps(run.id), files: run.evidence_files }
      }),
    cancel: (runID: string) =>
      jobs.cancel(runID).pipe(
        Effect.tap((job) =>
          job?.status === "cancelled"
            ? Effect.all([
                stopServices(runID),
                repository.cancelRunningSteps(runID),
                repository.updateRun(runID, {
                  status: "cancelled",
                  error_code: "RUN_CANCELLED",
                  time_ended: Date.now(),
                }),
              ])
            : Effect.void,
        ),
      ),
    retry: (runID: string, finalize?: Finalize) =>
      Effect.gen(function* () {
        const previous = yield* repository.getRun(runID)
        if (!previous) return yield* runnerError("RUN_NOT_FOUND", `run 不存在：${runID}`)
        if (previous.status === "running" || previous.status === "pending") {
          return yield* runnerError("RUN_ALREADY_ACTIVE", "活动 run 不能重试")
        }
        const previousSteps = yield* repository.listSteps(runID)
        const profileSteps = previousSteps.filter((step) => step.kind === "profile")
        const worktree = path.resolve(previous.log_directory, "../../../..")
        const failedStep = previousSteps.find((step) => step.status === "failed")
        const existing = new Set(previousSteps.map((step) => step.step_id))
        const failedProfile = failedStep
          ? profileSteps.find((step) => step.step_id === failedStep.profile_step_id)
          : undefined
        const retryProbe = failedProfile
          ? [
              {
                id: retryProbeID(failedProfile.step_id, existing),
                argv: failedProfile.argv,
                cwd: failedProfile.cwd,
                timeoutMs: failedProfile.timeout_ms ?? undefined,
                kind: "retry_probe" as const,
                profileStepID: failedProfile.step_id,
                ...decodeMeta(failedProfile.artifacts),
              },
            ]
          : []
        return yield* start({
          bindingID: previous.binding_id,
          action: previous.action,
          snapshotRevision: previous.snapshot_revision,
          worktree,
          attempt: previous.attempt + 1,
          evidenceFiles: previous.evidence_files,
          finalize,
          steps: [
            ...retryProbe,
            ...profileSteps.map((step) => {
              const meta = decodeMeta(step.artifacts)
              return {
                id: step.step_id,
                argv: step.argv,
                cwd: step.cwd,
                timeoutMs: step.timeout_ms ?? undefined,
                mode: meta.mode,
                readyUrl: meta.readyUrl,
                dependsOn: meta.dependsOn,
              }
            }),
          ],
        })
      }),
    log: (input: { runID: string; stepID: string; stream: "stdout" | "stderr"; offset: number; limit: number }) =>
      Effect.gen(function* () {
        const run = yield* repository.getRun(input.runID)
        if (!run) return yield* runnerError("RUN_NOT_FOUND", `run 不存在：${input.runID}`)
        const step = (yield* repository.listSteps(input.runID)).find((item) => item.step_id === input.stepID)
        const file = input.stream === "stdout" ? step?.stdout_file : step?.stderr_file
        if (!file) return { text: "", offset: input.offset, nextOffset: input.offset, eof: true }
        const root = path.resolve(run.log_directory)
        const absolute = path.resolve(file)
        const relative = path.relative(root, absolute)
        if (relative.startsWith("..") || path.isAbsolute(relative)) {
          return yield* runnerError("PATH_OUTSIDE_WORKTREE", "run 日志路径越出日志目录")
        }
        const content = yield* fs.readFile(absolute)
        const offset = Math.max(0, Math.min(input.offset, content.length))
        const limit = Math.max(1, Math.min(input.limit, 1024 * 1024))
        const nextOffset = Math.min(content.length, offset + limit)
        return {
          text: new TextDecoder().decode(content.subarray(offset, nextOffset)),
          offset,
          nextOffset,
          eof: nextOffset >= content.length,
        }
      }),
  }
})

export type Interface = Effect.Success<ReturnType<typeof make>>
export class Service extends Context.Service<Service, Interface>()("@opencode/PowersNexusRunner") {}

export const layer = Layer.effect(Service, make())

export const defaultLayer: Layer.Layer<Service> = layer.pipe(
  Layer.provide(BackgroundJob.defaultLayer),
  Layer.provide(AppProcess.defaultLayer),
  Layer.provide(NodeFileSystem.layer),
  Layer.provide(Bus.layer),
)

export * as PowersNexusRunner from "./runner"
