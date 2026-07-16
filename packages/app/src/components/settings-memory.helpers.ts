import type { MemoryReviewCandidate, MemoryReviewStatus as MemoryReviewSummary } from "@opencode-ai/sdk/v2/client"
import { finiteNumber } from "./review-ui-helpers"
import { matchesModeGroup, type ModeGroup } from "./settings-mode-groups"

export type ReviewStatus = "pending" | "applied" | "dismissed"
export type CandidateSource = "all" | "explicit" | "background" | "compaction" | "session-end"

export function memoryCandidateSource(tags: readonly string[] | undefined | null): Exclude<CandidateSource, "all"> {
  const values = safeTags(tags)
  if (values.includes("session-end")) return "session-end"
  if (values.includes("compaction")) return "compaction"
  if (values.includes("explicit")) return "explicit"
  return "background"
}

export function memoryReviewCounts(status: MemoryReviewSummary | undefined): Record<ReviewStatus, number> {
  return {
    pending: finiteNumber(status?.pending),
    applied: finiteNumber(status?.applied),
    dismissed: finiteNumber(status?.dismissed),
  }
}

export function memoryReviewSourceCounts(
  status: MemoryReviewSummary | undefined,
  reviewStatus: ReviewStatus,
): Record<CandidateSource, number> {
  return {
    all: finiteNumber(status?.sourceByStatus?.[reviewStatus]?.all),
    explicit: finiteNumber(status?.sourceByStatus?.[reviewStatus]?.explicit),
    background: finiteNumber(status?.sourceByStatus?.[reviewStatus]?.background),
    compaction: finiteNumber(status?.sourceByStatus?.[reviewStatus]?.compaction),
    "session-end": finiteNumber(status?.sourceByStatus?.[reviewStatus]?.["session-end"]),
  }
}

export function filterMemoryReviewCandidates(
  candidates: readonly MemoryReviewCandidate[] | undefined | null,
  source: CandidateSource,
  mode: ModeGroup = "all",
) {
  return safeCandidates(candidates).filter(
    (candidate) =>
      (source === "all" || memoryCandidateSource(candidate.tags) === source) &&
      matchesModeGroup(candidateModeSearchText(candidate), mode),
  )
}

function candidateModeSearchText(candidate: MemoryReviewCandidate) {
  return [
    safeTags(candidate.tags),
    candidate.scope,
    candidate.target,
    candidate.summary,
    candidate.content,
    candidate.reason,
  ]
}

function safeCandidates(candidates: readonly MemoryReviewCandidate[] | undefined | null) {
  return Array.isArray(candidates) ? candidates : []
}

function safeTags(tags: readonly string[] | undefined | null) {
  return Array.isArray(tags) ? tags : []
}
