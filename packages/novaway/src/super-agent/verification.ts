import type { AcceptanceCriterion, Evidence, VerificationOutcome } from "./types"

export type VerifierInput = {
  runID: string
  criterion: AcceptanceCriterion
  evidence: readonly Evidence[]
}

export type VerifierResult = {
  outcome: VerificationOutcome
  evidenceIDs: readonly string[]
  reason: string
  measured?: string
}

export type Verifier = {
  id: string
  version: string
  verify(input: VerifierInput): Promise<VerifierResult>
}

export class VerifierAlreadyRegistered extends Error {}
export class VerifierNotFound extends Error {}

export class VerifierRegistry {
  private readonly entries = new Map<string, Verifier>()

  register(verifier: Verifier) {
    if (this.entries.has(verifier.id)) throw new VerifierAlreadyRegistered(verifier.id)
    this.entries.set(verifier.id, verifier)
    return { dispose: () => this.entries.delete(verifier.id) }
  }

  resolve(id: string) {
    return this.entries.get(id)
  }

  list() {
    return [...this.entries.values()]
  }

  async verify(id: string, input: VerifierInput) {
    const verifier = this.resolve(id)
    if (!verifier) throw new VerifierNotFound(id)
    return verifier.verify(input)
  }
}

export const builtinTestVerifier: Verifier = {
  id: "builtin.test",
  version: "1",
  async verify(input) {
    const evidence = input.evidence.filter((item) => item.kind === "test")
    if (evidence.length === 0) return { outcome: "unverified", evidenceIDs: [], reason: "no test evidence" }
    const passed = evidence.every((item) => item.measured?.toLowerCase() === "pass")
    return {
      outcome: passed ? "pass" : "fail",
      evidenceIDs: evidence.map((item) => item.id),
      reason: passed ? "all test evidence passed" : "at least one test evidence failed",
      measured: `${evidence.length} test evidence record(s)`,
    }
  },
}

export const builtinArtifactVerifier: Verifier = {
  id: "builtin.artifact",
  version: "1",
  async verify(input) {
    const evidence = input.evidence.filter((item) =>
      ["artifact", "file", "http", "log", "screenshot", "external"].includes(item.kind),
    )
    if (evidence.length === 0) return { outcome: "unverified", evidenceIDs: [], reason: "no artifact evidence" }
    const latestAt = Math.max(...evidence.map((item) => item.capturedAt))
    const latest = evidence.filter((item) => item.capturedAt === latestAt)
    const failed = latest.some((item) => item.measured?.toLowerCase() === "fail")
    return {
      outcome: failed ? "fail" : "pass",
      evidenceIDs: latest.map((item) => item.id),
      reason: failed ? "latest artifact evidence failed" : "latest artifact evidence is present",
      measured: `${latest.length} latest artifact evidence record(s)`,
    }
  },
}
