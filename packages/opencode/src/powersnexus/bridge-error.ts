import { Schema } from "effect"

export class BridgeClientError extends Schema.TaggedErrorClass<BridgeClientError>()("PowersNexusBridgeClientError", {
  code: Schema.String,
  message: Schema.String,
  traceID: Schema.String,
  exitCode: Schema.optional(Schema.Number),
  evidence: Schema.Array(Schema.String),
}) {}

export * as PowersNexusBridgeError from "./bridge-error"
