import type { EvolutionCandidate, EvolutionStatus as EvolutionStatusSummary } from "@novaway/sdk/v2/client"
import { finiteNumber } from "./review-ui-helpers"
import { matchesModeGroup, type ModeGroup } from "./settings-mode-groups"

export type CandidateStatus = "pending" | "applied" | "dismissed"
export type CandidateSource = "all" | "background" | "session-end"
export type ValidationStatus = "pending" | "validated" | "failed"
export type EvolutionDomain = "general" | "coding" | "office" | "personal" | "research" | "ops"
export type DomainFilter = "all" | EvolutionDomain

export const evolutionDomainFilters: DomainFilter[] = [
  "all",
  "general",
  "coding",
  "office",
  "personal",
  "research",
  "ops",
]

export function evolutionKindLabel(kind: string | undefined | null) {
  switch (kind) {
    case "strategy":
      return "行为策略"
    case "habit":
      return "习惯流程"
    case "knowledge":
      return "知识模板"
    case "skill":
      return "技能"
    case "agent":
      return "智能体"
    case "workflow":
      return "工作流"
    case "prompt":
      return "提示词"
    case "tool":
      return "工具"
    default:
      return "项目规则"
  }
}

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

export function evolutionDomainLabel(domain: string | undefined | null) {
  switch (domain) {
    case "coding":
      return "编程"
    case "office":
      return "办公"
    case "personal":
      return "个人"
    case "research":
      return "研究"
    case "ops":
      return "运维"
    default:
      return "通用"
  }
}

export function evolutionValidationLabel(status: string | undefined | null) {
  switch (status) {
    case "validated":
      return "已验证"
    case "failed":
      return "验证失败"
    default:
      return "待验证"
  }
}

export function filterEvolutionByDomain<T extends { domain?: string | null }>(
  items: readonly T[] | undefined | null,
  domain: DomainFilter,
) {
  const list = Array.isArray(items) ? items : []
  if (domain === "all") return list.slice()
  return list.filter((item) => (item.domain ?? "general") === domain)
}

export function evolutionDomainCounts(items: readonly { domain?: string | null }[] | undefined | null) {
  const list = Array.isArray(items) ? items : []
  const counts: Record<DomainFilter, number> = {
    all: list.length,
    general: 0,
    coding: 0,
    office: 0,
    personal: 0,
    research: 0,
    ops: 0,
  }
  for (const item of list) {
    const domain = (item.domain ?? "general") as EvolutionDomain
    if (domain in counts) counts[domain] += 1
  }
  return counts
}

export function evolutionDomainFilterLabel(domain: DomainFilter) {
  if (domain === "all") return "全部领域"
  return evolutionDomainLabel(domain)
}

function candidateModeSearchText(candidate: EvolutionCandidate) {
  return [
    safeTags(candidate.tags),
    candidate.kind,
    candidate.domain,
    candidate.validationStatus,
    candidate.validationNote,
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
