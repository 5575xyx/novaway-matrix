import { Context, Effect, Layer } from "effect"
import { Memory } from "@/memory/service"
import * as Consolidation from "@/memory/consolidation"
import { deriveFactKey } from "@/memory/fact"
import { MemoryID } from "@/memory/schema"
import type { ConsolidationAudit, ConsolidationOp } from "@/memory/schema"
import type { ProjectID } from "@/project/schema"
import type { SessionID } from "@/session/schema"
import type { DreamAnalysis } from "./dream"

export interface DistillResult {
  readonly memories: DistillMemory[]
  readonly patterns: DistillPattern[]
  readonly appliedAt: Date
}

export interface DistillMemory {
  readonly content: string
  readonly domain?: "general" | "coding" | "office" | "personal" | "research" | "ops"
  readonly kind?: "episodic" | "semantic" | "procedure" | "goal" | "preference" | "lesson" | "relationship" | "decision"
  readonly tags: string[]
  readonly confidence?: number
  readonly factKey?: string
}

export interface DistillPattern {
  readonly name: string
  readonly description: string
  readonly frequency: number
  readonly successRate: number
}

export type ExistingMemory = {
  id: MemoryID
  content: string
  factKey?: string
  scope: string
  target: string
}

export type Decision = {
  draft: DistillMemory
  op: Extract<ConsolidationOp, "add" | "update" | "dedupe">
  existingID?: MemoryID
  before?: string
  factKey?: string
}

export const AUTO_APPLY_CONFIDENCE = 0.9

export interface Interface {
  readonly fromAnalysis: (analysis: DreamAnalysis) => Effect.Effect<DistillResult>

  readonly extractPatterns: (analyses: DreamAnalysis[]) => Effect.Effect<DistillPattern[]>

  readonly applyMemories: (input: {
    projectID?: ProjectID
    sessionID?: SessionID
    result: DistillResult
    /** 是否把用户级(global)记忆纳入去重/更新比对;跨会话整合默认开,项目级整合可关。 */
    includeGlobal?: boolean
  }) => Effect.Effect<ConsolidationAudit[]>

  readonly applyDrafts: (input: {
    projectID?: ProjectID
    sessionID?: SessionID
    decisions: readonly Decision[]
    /** false 时强制写成项目级记忆，不按内容猜成 global(跨会话整合默认)。 */
    includeGlobal?: boolean
  }) => Effect.Effect<ConsolidationAudit[]>

  readonly rollback: (input: { audits: readonly ConsolidationAudit[] }) => Effect.Effect<ConsolidationAudit[]>
}

export class Service extends Context.Service<Service, Interface>()("@novaway/DistillService") {}
export { Service as DistillService }

const patternMap = new Map<string, { count: number; success: number }>()

function normalizeContent(content: string) {
  return content.replace(/\s+/g, " ").trim().toLowerCase()
}

/**
 * 把蒸馏草稿映射成对记忆的操作。
 *
 * 去重优先（内容一致即 no-op），其次按 factKey 判为更新，其余新增。纯函数，便于单测。
 */
export function planDrafts(input: { drafts: readonly DistillMemory[]; existing: readonly ExistingMemory[] }) {
  const seen = new Set<string>()
  const decisions: Decision[] = []
  for (const draft of input.drafts) {
    const key = normalizeContent(draft.content)
    if (!key || seen.has(key)) continue
    seen.add(key)
    const same = input.existing.find((item) => normalizeContent(item.content) === key)
    if (same) {
      decisions.push({ draft, op: "dedupe", existingID: same.id, before: same.content })
      continue
    }
    const factKey = deriveFactKey(draft.content, draft.factKey)
    const sameKey = factKey ? input.existing.find((item) => item.factKey === factKey) : undefined
    if (sameKey) {
      decisions.push({ draft, op: "update", existingID: sameKey.id, before: sameKey.content, factKey })
      continue
    }
    decisions.push({ draft, op: "add", ...(factKey ? { factKey } : {}) })
  }
  return decisions
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const memory = yield* Memory.Service

    const applyDrafts: Interface["applyDrafts"] = Effect.fn("DistillService.applyDrafts")(function* (input) {
      const audits: ConsolidationAudit[] = []
      for (const decision of input.decisions) {
        const draft = decision.draft
        if (decision.op === "dedupe") {
          audits.push(
            Consolidation.insert({
              projectID: input.projectID,
              sessionID: input.sessionID,
              op: "dedupe",
              memoryID: decision.existingID,
              before: decision.before,
              after: draft.content,
              state: "applied",
              note: "duplicate-content",
            }),
          )
          continue
        }

        const candidates = yield* memory.review({
          projectID: input.projectID,
          sessionID: input.sessionID,
          userContent: draft.content,
          skipReviewState: true,
          candidates: [
            {
              content: draft.content,
              domain: draft.domain,
              kind: draft.kind,
              tags: [...draft.tags, "dream", "consolidation"],
              confidence: draft.confidence,
              factKey: decision.factKey,
              operation: decision.op,
              ...(input.includeGlobal === false ? { scope: "project" as const } : {}),
              reason: "dream consolidation",
            },
          ],
        })
        const candidate = candidates[0]
        if (!candidate) {
          audits.push(
            Consolidation.insert({
              projectID: input.projectID,
              sessionID: input.sessionID,
              op: decision.op,
              memoryID: decision.existingID,
              before: decision.before,
              after: draft.content,
              state: "failed",
              note: "candidate-rejected",
            }),
          )
          continue
        }

        const auto = (draft.confidence ?? 0) >= AUTO_APPLY_CONFIDENCE
        const applied = auto ? yield* memory.applyReviewCandidate(candidate.id, undefined, { auto: true }) : undefined
        audits.push(
          Consolidation.insert({
            projectID: input.projectID,
            sessionID: input.sessionID,
            op: decision.op,
            memoryID: applied?.id ?? decision.existingID,
            before: decision.before,
            after: draft.content,
            state: applied ? "applied" : "prepared",
            ...(decision.op === "update" && decision.existingID
              ? { note: `superseded:${decision.existingID}` }
              : auto && !applied
                ? { note: "auto-apply-skipped" }
                : {}),
          }),
        )
      }
      return audits
    })

    return {
      fromAnalysis: Effect.fn("DistillService.fromAnalysis")(function* (analysis: DreamAnalysis) {
        const memories: DistillMemory[] = []
        const patterns: DistillPattern[] = analysis.patterns.map((p) => ({
          name: p.description,
          description: `${p.type}: ${p.description}`,
          frequency: p.frequency,
          successRate: p.type === "success" ? 1 : p.type === "failure" ? 0 : 0.5,
        }))

        for (const pattern of analysis.patterns) {
          if (pattern.type === "success" && pattern.frequency > 2) {
            memories.push({
              content: `成功模式: ${pattern.description}`,
              domain: "coding",
              kind: "procedure",
              tags: ["pattern", "success"],
              confidence: 0.75,
            })
          }

          if (pattern.type === "failure" && pattern.frequency > 1) {
            memories.push({
              content: `失败模式: ${pattern.description} - 需要避免`,
              domain: "coding",
              kind: "lesson",
              tags: ["pattern", "failure", "warning"],
              confidence: 0.75,
            })
          }
        }

        for (const insight of analysis.insights) {
          if (insight.confidence > 0.7) {
            memories.push({
              content: `${insight.category} 洞察: ${insight.observation}`,
              domain: "coding",
              kind: "semantic",
              tags: ["insight", insight.category],
              confidence: insight.confidence,
            })
          }
        }

        for (const suggestion of analysis.suggestions) {
          if (suggestion.priority === "high") {
            memories.push({
              content: `改进建议: ${suggestion.title} - ${suggestion.description}`,
              domain: "coding",
              kind: "goal",
              tags: ["suggestion", suggestion.type],
              confidence: 0.8,
            })
          }
        }

        return {
          memories,
          patterns,
          appliedAt: new Date(),
        }
      }),

      extractPatterns: Effect.fn("DistillService.extractPatterns")(function* (analyses) {
        patternMap.clear()

        for (const analysis of analyses) {
          for (const pattern of analysis.patterns) {
            const key = `${pattern.type}:${pattern.description}`
            const existing = patternMap.get(key) ?? { count: 0, success: 0 }
            existing.count += pattern.frequency
            if (pattern.type === "success") {
              existing.success += pattern.frequency
            }
            patternMap.set(key, existing)
          }
        }

        return Array.from(patternMap.entries()).map(([key, data]) => ({
          name: key.split(":")[1],
          description: key,
          frequency: data.count,
          successRate: data.success / data.count,
        }))
      }),

      applyDrafts,

      rollback: Effect.fn("DistillService.rollback")(function* (input) {
        const rolled: ConsolidationAudit[] = []
        for (const audit of input.audits) {
          if (audit.state !== "applied" || !audit.memoryID) continue
          if (audit.op === "add") {
            yield* memory.remove(audit.memoryID)
          } else if (audit.op === "update") {
            yield* memory.update({ id: audit.memoryID, archived: true })
            const superseded = audit.note?.startsWith("superseded:")
              ? audit.note.slice("superseded:".length)
              : undefined
            if (superseded) yield* memory.update({ id: MemoryID.make(superseded), archived: false })
          } else {
            continue
          }
          Consolidation.mark({ id: audit.id, state: "rolled_back" })
          rolled.push({ ...audit, state: "rolled_back" })
        }
        return rolled
      }),

      // 兼容旧调用点：先对照已有记忆做去重/更新判定，再走审核管线与审计清单，不再直写。
      applyMemories: Effect.fn("DistillService.applyMemories")(function* (input) {
        const existing = yield* memory.list({
          projectID: input.projectID,
          includeGlobal: input.includeGlobal ?? true,
          limit: 500,
        })
        return yield* applyDrafts({
          projectID: input.projectID,
          sessionID: input.sessionID,
          includeGlobal: input.includeGlobal ?? true,
          decisions: planDrafts({
            drafts: input.result.memories,
            existing: existing.map((item) => ({
              id: item.id,
              content: item.content,
              factKey: item.factKey,
              scope: item.scope,
              target: item.target,
            })),
          }),
        })
      }),
    }
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Memory.defaultLayer))

export * as Distill from "./distill"
