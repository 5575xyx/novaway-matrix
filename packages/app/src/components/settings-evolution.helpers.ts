import type { EvolutionCandidate, EvolutionStatus as EvolutionStatusSummary } from "@opencode-ai/sdk/v2/client"
import { finiteNumber } from "./review-ui-helpers"
import { matchesModeGroup, type ModeGroup } from "./settings-mode-groups"

export type CandidateStatus = "pending" | "applied" | "dismissed"
export type CandidateSource = "all" | "background" | "session-end"

export function evolutionCandidateSource(tags: readonly string[] | undefined | null): Exclude<CandidateSource, "all"> {
  if (safeTags(tags).includes("session-end")) return "session-end"
  return "background"
}

export function evolutionCounts(status: EvolutionStatusSummary | undefined): Record<CandidateStatus, number> {
  return {
    pending: finiteNumber(status?.pending),
    applied: finiteNumber(status?.applied),
    dismissed: finiteNumber(status?.dismissed),
  }
}

export function evolutionSourceCounts(
  status: EvolutionStatusSummary | undefined,
  candidateStatus: CandidateStatus,
): Record<CandidateSource, number> {
  return {
    all: finiteNumber(status?.sourceByStatus?.[candidateStatus]?.all),
    background: finiteNumber(status?.sourceByStatus?.[candidateStatus]?.background),
    "session-end": finiteNumber(status?.sourceByStatus?.[candidateStatus]?.["session-end"]),
  }
}

export function filterEvolutionCandidates(
  candidates: readonly EvolutionCandidate[] | undefined | null,
  source: CandidateSource,
  mode: ModeGroup = "all",
) {
  return safeCandidates(candidates).filter(
    (candidate) =>
      (source === "all" || evolutionCandidateSource(candidate.tags) === source) &&
      matchesModeGroup(candidateModeSearchText(candidate), mode),
  )
}

function candidateModeSearchText(candidate: EvolutionCandidate) {
  return [
    safeTags(candidate.tags),
    candidate.kind,
    candidate.target,
    candidate.title,
    candidate.content,
    candidate.reason,
  ]
}

function safeCandidates(candidates: readonly EvolutionCandidate[] | undefined | null) {
  return Array.isArray(candidates) ? candidates : []
}

function safeTags(tags: readonly string[] | undefined | null) {
  return Array.isArray(tags) ? tags : []
}
