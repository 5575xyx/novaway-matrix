import { describe, expect, test } from "bun:test"
import { VerifierRegistry, builtinArtifactVerifier, builtinTestVerifier } from "../../src/super-agent"
import type { AcceptanceCriterion, Evidence } from "../../src/super-agent"

const criterion: AcceptanceCriterion = { id: "tests", text: "tests pass", required: true }
const evidence = (id: string, measured: string): Evidence => ({
  id,
  runID: "run-1",
  taskID: "task-1",
  kind: "test",
  source: "bun test",
  measured,
  acceptanceIDs: ["tests"],
  capturedAt: Date.now(),
})

describe("Super-Agent verification registry", () => {
  test("does not infer pass without test evidence and accepts only passing evidence", async () => {
    const registry = new VerifierRegistry()
    registry.register(builtinTestVerifier)
    expect(await registry.verify("builtin.test", { runID: "run-1", criterion, evidence: [] })).toMatchObject({
      outcome: "unverified",
    })
    expect(
      await registry.verify("builtin.test", {
        runID: "run-1",
        criterion,
        evidence: [{ ...evidence("unscoped", "pass"), acceptanceIDs: undefined }],
      }),
    ).toMatchObject({ outcome: "unverified" })
    expect(
      await registry.verify("builtin.test", { runID: "run-1", criterion, evidence: [evidence("e-1", "pass")] }),
    ).toMatchObject({ outcome: "pass", evidenceIDs: ["e-1"] })
    expect(
      await registry.verify("builtin.test", { runID: "run-1", criterion, evidence: [evidence("e-2", "fail")] }),
    ).toMatchObject({ outcome: "fail" })
  })

  test("uses the latest artifact evidence for repair verification", async () => {
    const registry = new VerifierRegistry()
    registry.register(builtinArtifactVerifier)
    const old = { ...evidence("old", "fail"), kind: "artifact" as const, capturedAt: 1 }
    const fresh = { ...evidence("fresh", "pass"), kind: "artifact" as const, capturedAt: 2 }
    await expect(
      registry.verify("builtin.artifact", { runID: "run-1", criterion, evidence: [old, fresh] }),
    ).resolves.toMatchObject({ outcome: "pass", evidenceIDs: ["fresh"] })
  })

  test("does not treat a completed tool operation as acceptance evidence", async () => {
    const registry = new VerifierRegistry()
    registry.register(builtinArtifactVerifier)
    await expect(
      registry.verify("builtin.artifact", {
        runID: "run-1",
        criterion,
        evidence: [{ ...evidence("tool", "tool execution completed"), kind: "artifact" as const }],
      }),
    ).resolves.toMatchObject({ outcome: "unverified" })
  })

  test("does not reuse evidence assigned to another acceptance criterion", async () => {
    const registry = new VerifierRegistry()
    registry.register(builtinArtifactVerifier)
    const otherCriterion = { id: "other", text: "other criterion", required: true }
    await expect(
      registry.verify("builtin.artifact", {
        runID: "run-1",
        criterion: otherCriterion,
        evidence: [{ ...evidence("scoped", "pass"), kind: "artifact" as const, acceptanceIDs: ["tests"] }],
      }),
    ).resolves.toMatchObject({ outcome: "unverified", evidenceIDs: [] })
  })
})
