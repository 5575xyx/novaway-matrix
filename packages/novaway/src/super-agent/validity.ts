import type { Evidence, Verification, VerificationOutcome } from "./types"

export function verificationOutcomeAt(
  verification: Verification,
  evidence: readonly Evidence[],
  at = Date.now(),
): { outcome: VerificationOutcome; reason: string } {
  if (verification.outcome !== "pass") return { outcome: verification.outcome, reason: verification.reason }
  const byID = new Map(evidence.map((item) => [item.id, item]))
  for (const evidenceID of verification.evidenceIDs) {
    const item = byID.get(evidenceID)
    if (!item) return { outcome: "stale", reason: `evidence missing: ${evidenceID}` }
    if (item.expiresAt !== undefined && item.expiresAt <= at)
      return { outcome: "stale", reason: `evidence expired: ${evidenceID}` }
    if (item.capturedAt > verification.createdAt)
      return { outcome: "stale", reason: `evidence is newer than verification: ${evidenceID}` }
  }
  return { outcome: "pass", reason: verification.reason }
}
