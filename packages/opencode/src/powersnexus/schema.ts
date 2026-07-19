import { Schema } from "effect"

export const Sha256 = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)).annotate({
  identifier: "PowersNexusSha256",
})

export const UpdatePolicy = Schema.Literals(["bundled", "stable", "manual", "developer"])
export type UpdatePolicy = Schema.Schema.Type<typeof UpdatePolicy>

export const VersionSource = Schema.Literals(["bundled", "downloaded", "developer"])
export type VersionSource = Schema.Schema.Type<typeof VersionSource>

export const VersionRef = Schema.Struct({
  version: Schema.String,
  protocolVersion: Schema.String,
  digest: Sha256,
  source: VersionSource,
  compatible: Schema.Boolean,
  verified: Schema.Boolean,
  cliPath: Schema.String,
}).annotate({ identifier: "PowersNexusVersionRef" })
export type VersionRef = Schema.Schema.Type<typeof VersionRef>

export * as PowersNexusSchema from "./schema"
