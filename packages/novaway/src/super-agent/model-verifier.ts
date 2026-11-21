import { generateObject } from "ai"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { Schema } from "effect"
import type { Verifier, VerifierResult } from "./verification"

const ModelVerification = Schema.Struct({
  outcome: Schema.Literals(["pass", "fail", "unverified"]),
  evidenceIDs: Schema.Array(Schema.String),
  reason: Schema.String,
})

type ModelVerificationValue = Schema.Schema.Type<typeof ModelVerification>

/** Creates a bounded, evidence-only model verifier for durable Goal runs. */
export function createModelVerifier(input: {
  model: LanguageModelV3
  maxOutputTokens?: number
  minReasonBytes?: number
}): Verifier {
  return {
    id: "builtin.judge",
    version: "1",
    async verify(value): Promise<VerifierResult> {
      const allowed = new Set(value.evidence.map((item) => item.id))
      const response = await generateObject({
        model: input.model,
        temperature: 0,
        maxOutputTokens: Math.max(128, Math.min(input.maxOutputTokens ?? 800, 4_000)),
        schema: Object.assign(
          Schema.toStandardSchemaV1(ModelVerification),
          Schema.toStandardJSONSchemaV1(ModelVerification),
        ),
        prompt: [
          "You are NovaWay's durable Goal acceptance verifier.",
          "Judge only the supplied acceptance criterion and supplied Evidence.",
          "Never infer completion from a successful tool call alone.",
          "Return pass only when the Evidence explicitly proves the criterion.",
          "Only cite Evidence IDs present in the supplied Evidence list.",
          `Acceptance criterion: ${value.criterion.id}: ${value.criterion.text}`,
          `Evidence: ${JSON.stringify(value.evidence)}`,
        ].join("\n"),
      })
      const result = response.object as ModelVerificationValue
      const evidenceIDs = result.evidenceIDs.filter((id) => allowed.has(id))
      if (result.evidenceIDs.some((id) => !allowed.has(id)))
        return { outcome: "unverified", evidenceIDs, reason: "judge cited unknown Evidence" }
      if (input.minReasonBytes !== undefined && Buffer.byteLength(result.reason, "utf8") < input.minReasonBytes)
        return {
          outcome: "unverified",
          evidenceIDs,
          reason: `judge report is below the required ${input.minReasonBytes} bytes`,
        }
      if (result.outcome === "pass" && evidenceIDs.length === 0)
        return { outcome: "unverified", evidenceIDs: [], reason: "judge passed without Evidence" }
      return { outcome: result.outcome, evidenceIDs, reason: result.reason }
    },
  }
}
