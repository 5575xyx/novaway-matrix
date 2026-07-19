import path from "node:path"
import { createHash } from "node:crypto"
import { Effect, FileSystem, Schema } from "effect"
import type { RunStep } from "./run-repository"

export const DeliveryFingerprint = Schema.Struct({
  algorithm: Schema.Literal("sha256"),
  digest: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  files: Schema.Array(Schema.String),
  commands: Schema.Array(
    Schema.Struct({ id: Schema.String, argv: Schema.Array(Schema.String), timeoutMs: Schema.Union([Schema.Number, Schema.Null]) }),
  ),
  environment: Schema.Struct({ platform: Schema.String, arch: Schema.String, node: Schema.String }),
})
export type DeliveryFingerprint = Schema.Schema.Type<typeof DeliveryFingerprint>

export class EvidenceError extends Schema.TaggedErrorClass<EvidenceError>()("PowersNexusEvidenceError", {
  code: Schema.String,
  message: Schema.String,
}) {}

export const createFingerprint = Effect.fn("PowersNexus.Evidence.createFingerprint")(function* (input: {
  worktree: string
  files: ReadonlyArray<string>
  steps: ReadonlyArray<RunStep>
  profile: string
}) {
  const fs = yield* FileSystem.FileSystem
  const root = path.resolve(input.worktree)
  const files = [...new Set(input.files.map((file) => file.replaceAll("\\", "/")))].sort((a, b) =>
    a.localeCompare(b, "en"),
  )
  const hash = createHash("sha256")
  for (const file of files) {
    const absolute = path.resolve(root, ...file.split("/"))
    const relative = path.relative(root, absolute)
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return yield* new EvidenceError({ code: "PATH_OUTSIDE_WORKTREE", message: `证据文件越出 Worktree：${file}` })
    }
    const content = yield* fs.readFile(absolute)
    hash.update(file).update("\0").update(content).update("\0")
  }
  const commands = [...input.steps]
    .sort((a, b) => a.sequence - b.sequence)
    .map((step) => ({ id: step.profile_step_id, argv: step.argv, timeoutMs: step.timeout_ms }))
  const environment = { platform: process.platform, arch: process.arch, node: process.version }
  hash.update(JSON.stringify({ profile: input.profile, commands, environment }))
  return { algorithm: "sha256", digest: hash.digest("hex"), files, commands, environment } satisfies DeliveryFingerprint
})

export * as PowersNexusEvidence from "./evidence"
