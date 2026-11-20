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
    const fresh = { ...evidence("fresh", "tool execution completed"), kind: "artifact" as const, capturedAt: 2 }
    await expect(
      registry.verify("builtin.artifact", { runID: "run-1", criterion, evidence: [old, fresh] }),
    ).resolves.toMatchObject({ outcome: "pass", evidenceIDs: ["fresh"] })
  })
})
