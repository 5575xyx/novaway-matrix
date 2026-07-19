import path from "node:path"
import { NodeFileSystem } from "@effect/platform-node"
import { Context, Effect, FileSystem, Layer, Schema } from "effect"
import { createFingerprint } from "./evidence"
import { PowersNexusBrowserQa, type BrowserQaRequest } from "./browser-qa"
import { make as makeRepository, type Binding } from "./repository"
import { PowersNexusRunner, type Finalize } from "./runner"
import { PowersNexusWorkflow } from "./service"

export class DeliveryError extends Schema.TaggedErrorClass<DeliveryError>()("PowersNexusDeliveryError", {
  code: Schema.String,
  message: Schema.String,
}) {}

export type VerifyInput = {
  bindingID: string
  expectedRevision: number
  worktree: string
  evidenceFiles: string[]
  steps: Array<{ id: string; argv: string[]; cwd: string; timeoutMs?: number; mode?: "command" | "service"; readyUrl?: string; dependsOn?: string[] }>
  browserQa?: BrowserQaRequest
}

type StartResult = Effect.Success<ReturnType<PowersNexusRunner.Interface["start"]>>

export interface Interface {
  readonly start: (input: VerifyInput) => Effect.Effect<StartResult, unknown>
  readonly retry: (runID: string) => Effect.Effect<StartResult, unknown>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PowersNexusDelivery") {}

function deliveryError(code: string, message: string) {
  return new DeliveryError({ code, message })
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const runner = yield* PowersNexusRunner.Service
    const workflow = yield* PowersNexusWorkflow.Service
    const browserQa = yield* PowersNexusBrowserQa.Service
    const repository = yield* makeRepository()

    const finalize = (
      binding: Binding,
      worktree: string,
      expectedRevision: number,
      evidenceFiles: string[],
      profile: string,
      browserQaInput?: BrowserQaRequest,
    ): Finalize =>
      Effect.fnUntraced(function* ({ runID, steps }) {
        const runEvidence = new Set(evidenceFiles)
        if (browserQaInput) {
          const configPath = path.join(worktree, ".novaway", "powersnexus", "runs", runID, "browser-qa.json")
          yield* fs.writeFileString(configPath, JSON.stringify(browserQaInput, null, 2))
          runEvidence.add(path.relative(worktree, configPath).replaceAll("\\", "/"))
          const results = yield* browserQa.run({ worktree, ...browserQaInput })
          for (const file of results.flatMap((result) => result.evidenceFiles)) runEvidence.add(file)
          if (!results.every((result) => result.passed)) {
            return yield* deliveryError("BROWSER_QA_FAILED", "Browser QA 未通过，禁止写入成功 verify")
          }
        }
        const fingerprint = yield* createFingerprint({ worktree, files: [...runEvidence], steps, profile }).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
        )
        yield* workflow.action(binding.changeName, {
          actionID: `verify:${runID}`,
          expectedRevision,
          bindingID: binding.id,
          action: "verify",
          input: {
            verifiedAt: new Date().toISOString(),
            steps: steps.map((step) => ({
              id: step.profile_step_id,
              status: step.status,
              exitCode: step.exit_code,
              executedAt: new Date(step.time_ended ?? Date.now()).toISOString(),
              evidence: [step.evidence_digest, step.stdout_file, step.stderr_file, ...step.artifacts].filter(
                (item): item is string => typeof item === "string",
              ),
            })),
            deliveryFingerprint: fingerprint,
          },
        })
        return { fingerprint: fingerprint.digest, evidenceFiles: [...runEvidence] }
      })

    const bindingFor = Effect.fnUntraced(function* (bindingID: string, worktree: string) {
      const binding = yield* repository.get(bindingID)
      if (!binding?.active) return yield* deliveryError("CHANGE_NOT_FOUND", `活动 binding 不存在：${bindingID}`)
      if (path.resolve(binding.worktree) !== path.resolve(worktree)) {
        return yield* deliveryError("PATH_OUTSIDE_WORKTREE", "run 与 binding 不属于同一 Worktree")
      }
      return binding
    })

    const start = Effect.fn("PowersNexus.Delivery.start")(function* (input: VerifyInput) {
      const binding = yield* bindingFor(input.bindingID, input.worktree)
      const snapshot = yield* workflow.inspect(binding.changeName)
      const profile = snapshot.delivery?.profile ?? snapshot.profile ?? "application"
      return yield* runner.start({
        bindingID: binding.id,
        action: "verify",
        snapshotRevision: input.expectedRevision,
        worktree: input.worktree,
        evidenceFiles: input.evidenceFiles,
        finalize: finalize(binding, input.worktree, input.expectedRevision, input.evidenceFiles, profile, input.browserQa),
        steps: input.steps,
      })
    })

    const retry = Effect.fn("PowersNexus.Delivery.retry")(function* (runID: string) {
      const previous = (yield* runner.get(runID)).run
      if (!previous) return yield* deliveryError("RUN_NOT_FOUND", `run 不存在：${runID}`)
      const worktree = path.resolve(previous.log_directory, "../../../..")
      const binding = yield* bindingFor(previous.binding_id, worktree)
      const snapshot = yield* workflow.inspect(binding.changeName)
      const profile = snapshot.delivery?.profile ?? snapshot.profile ?? "application"
      const browserQaInput = yield* fs
        .readFileString(path.join(previous.log_directory, "browser-qa.json"))
        .pipe(
          Effect.flatMap((text) => Effect.try({ try: () => JSON.parse(text) as BrowserQaRequest, catch: () => undefined })),
          Effect.catch(() => Effect.succeed(undefined)),
        )
      return yield* runner.retry(
        runID,
        finalize(binding, worktree, previous.snapshot_revision, previous.evidence_files, profile, browserQaInput),
      )
    })

    return Service.of({ start, retry })
  }),
)

export const defaultLayer: Layer.Layer<Service> = layer.pipe(
  Layer.provide(PowersNexusRunner.defaultLayer),
  Layer.provide(PowersNexusBrowserQa.defaultLayer),
  Layer.provide(PowersNexusWorkflow.defaultLayer),
  Layer.provide(NodeFileSystem.layer),
)

export * as PowersNexusDelivery from "./delivery"
