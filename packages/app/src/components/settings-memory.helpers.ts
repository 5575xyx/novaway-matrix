import type {
  Memory,
  MemoryReviewCandidate,
  MemoryReviewStatus as MemoryReviewSummary,
} from "@novaway/sdk/v2/client"
import { finiteNumber } from "./review-ui-helpers"
import { matchesModeGroup, type ModeGroup } from "./settings-mode-groups"

export type ReviewStatus = "pending" | "applied" | "dismissed"
export type CandidateSource = "all" | "explicit" | "background" | "compaction" | "session-end"
export type MemoryDomain = "general" | "coding" | "office" | "personal" | "research" | "ops"
export type MemoryOperation = "add" | "update" | "archive" | "confirm"
export type DomainFilter = "all" | MemoryDomain

export const memoryDomainFilters: DomainFilter[] = ["all", "general", "coding", "office", "personal", "research", "ops"]

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

export function memoryDomainLabel(domain: string | undefined | null) {
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

export function memoryKindLabel(kind: string | undefined | null) {
  switch (kind) {
    case "episodic":
      return "情景"
    case "preference":
      return "偏好"
    case "goal":
      return "目标"
    case "decision":
      return "决策"
    case "relationship":
      return "关系"
    case "lesson":
      return "经验"
    case "procedure":
      return "程序"
    default:
      return "事实"
  }
}

export function memoryOperationLabel(operation: string | undefined | null) {
  switch (operation) {
    case "update":
      return "更新"
    case "archive":
      return "归档"
    case "confirm":
      return "确认"
    default:
      return "新增"
  }
}

export function memoryConfidenceLabel(confidence: number | string | undefined) {
  const value = finiteNumber(confidence)
  if (!value) return "置信度 —"
  return `置信度 ${value.toFixed(2)}`
}

export function memoryVersionLabel(item: Pick<Memory, "version" | "factKey" | "supersedesID"> | MemoryReviewCandidate) {
  const version = finiteNumber((item as Memory).version) || 1
  const factKey = (item as Memory).factKey || (item as MemoryReviewCandidate).factKey
  const parts = [`v${version}`]
  if (factKey) parts.push(`键:${factKey}`)
  if ((item as Memory).supersedesID) parts.push("已替代旧事实")
  return parts.join(" · ")
}

export function filterMemoryByDomain<T extends { domain?: string | null }>(
  items: readonly T[] | undefined | null,
  domain: DomainFilter,
) {
  const list = Array.isArray(items) ? items : []
  if (domain === "all") return list.slice()
  return list.filter((item) => (item.domain ?? "general") === domain)
}

export function memoryDomainCounts(items: readonly { domain?: string | null }[] | undefined | null) {
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
    const domain = (item.domain ?? "general") as MemoryDomain
    if (domain in counts) counts[domain] += 1
  }
  return counts
}

export function memoryDomainFilterLabel(domain: DomainFilter) {
  if (domain === "all") return "全部领域"
  return memoryDomainLabel(domain)
}

function candidateModeSearchText(candidate: MemoryReviewCandidate) {
  return [
    safeTags(candidate.tags),
    candidate.scope,
    candidate.target,
    candidate.domain,
    candidate.operation,
    candidate.factKey,
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
