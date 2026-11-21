import type { AcceptanceCriterion, Evidence, EvidenceKind, VerificationOutcome } from "./types"

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

const evidenceForCriterion = (input: VerifierInput, kinds: readonly EvidenceKind[]) =>
  input.evidence.filter(
    (item) =>
      kinds.includes(item.kind) &&
      item.acceptanceIDs !== undefined &&
      item.acceptanceIDs.includes(input.criterion.id),
  )

export const builtinTestVerifier: Verifier = {
  id: "builtin.test",
  version: "2",
  async verify(input) {
    const evidence = evidenceForCriterion(input, ["test"])
    if (evidence.length === 0) return { outcome: "unverified", evidenceIDs: [], reason: "no test evidence" }
    const latestAt = Math.max(...evidence.map((item) => item.capturedAt))
    const latest = evidence.filter((item) => item.capturedAt === latestAt)
    const passed = latest.every((item) => item.measured?.toLowerCase() === "pass")
    return {
      outcome: passed ? "pass" : "fail",
      evidenceIDs: latest.map((item) => item.id),
      reason: passed ? "latest test evidence passed" : "latest test evidence failed",
      measured: `${latest.length} latest test evidence record(s)`,
    }
  },
}

export const builtinArtifactVerifier: Verifier = {
  id: "builtin.artifact",
  version: "2",
  async verify(input) {
    const evidence = evidenceForCriterion(input, [
      "artifact",
      "file",
      "http",
      "log",
      "screenshot",
      "external",
      "test",
    ])
    if (evidence.length === 0) return { outcome: "unverified", evidenceIDs: [], reason: "no artifact evidence" }
    // An operation finishing is not evidence that the acceptance criterion is
    // true.  Only an explicitly measured pass may close a criterion.  This is
    // intentionally conservative: an untyped artifact must go to needs_review
    // instead of allowing a durable Goal to report a false completion.
    const latestAt = Math.max(...evidence.map((item) => item.capturedAt))
    const latest = evidence.filter((item) => item.capturedAt === latestAt)
    const failed = latest.some((item) => item.measured?.toLowerCase() === "fail")
    const passed = latest.filter((item) => item.measured?.toLowerCase() === "pass")
    if (failed) {
      return {
        outcome: "fail",
        evidenceIDs: latest.map((item) => item.id),
        reason: "latest artifact evidence failed",
      }
    }
    if (passed.length === 0) {
      return {
        outcome: "unverified",
        evidenceIDs: latest.map((item) => item.id),
        reason: "artifact exists but no verifier measured pass",
      }
    }
    return {
      outcome: "pass",
      evidenceIDs: passed.map((item) => item.id),
      reason: "latest artifact evidence explicitly passed",
      measured: `${passed.length} passing artifact evidence record(s)`,
    }
  },
}
