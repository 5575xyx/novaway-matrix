import { Context, Effect, Layer } from "effect"
import { Memory } from "@/memory/service"
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
}

export interface DistillPattern {
  readonly name: string
  readonly description: string
  readonly frequency: number
  readonly successRate: number
}

export interface Interface {
  readonly fromAnalysis: (analysis: DreamAnalysis) => Effect.Effect<DistillResult>

  readonly extractPatterns: (analyses: DreamAnalysis[]) => Effect.Effect<DistillPattern[]>

  readonly applyMemories: (result: DistillResult) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@NovaWay/DistillService") {}
export { Service as DistillService }

const patternMap = new Map<string, { count: number; success: number }>()

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const memory = yield* Memory.Service

    return {
      fromAnalysis: Effect.fn("DistillService.fromAnalysis")(function* (analysis) {
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
            })
          }

          if (pattern.type === "failure" && pattern.frequency > 1) {
            memories.push({
              content: `失败模式: ${pattern.description} - 需要避免`,
              domain: "coding",
              kind: "lesson",
              tags: ["pattern", "failure", "warning"],
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

      applyMemories: Effect.fn("DistillService.applyMemories")(function* (result) {
        for (const mem of result.memories) {
          yield* memory.add({
            content: mem.content,
            domain: mem.domain,
            kind: mem.kind,
            tags: mem.tags,
          })
        }
      }),
    }
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Memory.defaultLayer))
