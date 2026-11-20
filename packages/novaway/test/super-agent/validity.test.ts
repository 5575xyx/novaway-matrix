import { describe, expect, test } from "bun:test"
import { verificationOutcomeAt } from "../../src/super-agent"
import type { Evidence, Verification } from "../../src/super-agent"

const verification: Verification = {
  id: "v-1",
  runID: "run-1",
  acceptanceID: "checks",
  verifierID: "test",
  verifierVersion: "1",
  outcome: "pass",
  evidenceIDs: ["e-1"],
  reason: "passed",
  createdAt: 100,
}
const evidence: Evidence = {
  id: "e-1",
  runID: "run-1",
  taskID: "task-1",
  kind: "test",
  source: "test",
  capturedAt: 90,
  expiresAt: 200,
}

describe("Super-Agent verification validity", () => {
  test("marks missing and expired evidence stale", () => {
    expect(verificationOutcomeAt(verification, [])).toMatchObject({ outcome: "stale" })
    expect(verificationOutcomeAt(verification, [evidence], 201)).toMatchObject({ outcome: "stale" })
    expect(verificationOutcomeAt(verification, [evidence], 150)).toMatchObject({ outcome: "pass" })
  })
})
