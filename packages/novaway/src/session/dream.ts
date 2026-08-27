import { Context, Effect, Layer, Schema } from "effect"
import { generateObject, type ModelMessage } from "ai"
import { Session } from "./session"
import type { SessionID } from "./schema"
import { MessageV2 } from "./message-v2"
import { Provider } from "@/provider/provider"

export interface DreamAnalysis {
  readonly sessionId: string
  readonly patterns: DreamPattern[]
  readonly insights: DreamInsight[]
  readonly suggestions: DreamSuggestion[]
  readonly analyzedAt: Date
}

export interface DreamPattern {
  readonly type: "success" | "failure" | "optimization"
  readonly description: string
  readonly frequency: number
  readonly examples: string[]
}

export interface DreamInsight {
  readonly category: "code_style" | "error_handling" | "performance" | "architecture"
  readonly observation: string
  readonly confidence: number
}

export interface DreamSuggestion {
  readonly type: "memory" | "evolution" | "workflow"
  readonly title: string
  readonly description: string
  readonly priority: "high" | "medium" | "low"
}

// LLM 反思分析的结构化输出;字段与上面的接口一一对应,便于直接映射。
const DreamResult = Schema.Struct({
  patterns: Schema.Array(
    Schema.Struct({
      type: Schema.Literals(["success", "failure", "optimization"]),
      description: Schema.String,
      frequency: Schema.Number,
      examples: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
  insights: Schema.Array(
    Schema.Struct({
      category: Schema.Literals(["code_style", "error_handling", "performance", "architecture"]),
      observation: Schema.String,
      confidence: Schema.Number,
    }),
  ),
  suggestions: Schema.Array(
    Schema.Struct({
      type: Schema.Literals(["memory", "evolution", "workflow"]),
      title: Schema.String,
      description: Schema.String,
      priority: Schema.Literals(["high", "medium", "low"]),
    }),
  ),
})

export interface Interface {
  readonly analyzeSession: (sessionId: SessionID, model: Provider.Model) => Effect.Effect<DreamAnalysis>

  readonly analyzeHistory: (model: Provider.Model, limit?: number) => Effect.Effect<DreamAnalysis[]>
}

export class Service extends Context.Service<Service, Interface>()("@NovaWay/DreamService") {}
export { Service as DreamService }

function textFromParts(parts: readonly MessageV2.Part[]) {
  return parts
    .filter((part): part is MessageV2.TextPart => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n")
}

// 把会话消息压成带角色标记的纯文本转录,并限制长度,避免超出上下文。
function transcript(messages: readonly MessageV2.WithParts[], maxChars = 12000) {
  const lines: string[] = []
  for (const m of messages) {
    const text = textFromParts(m.parts)
    if (!text) continue
    lines.push(`[${m.info.role}] ${text}`)
  }
  const joined = lines.join("\n\n")
  return joined.length > maxChars ? joined.slice(joined.length - maxChars) : joined
}

export const layer: Layer.Layer<Service, never, Session.Service | Provider.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const session = yield* Session.Service
    const provider = yield* Provider.Service

    const analyzeTranscript = (input: { model: Provider.Model; transcript: string }) => Effect.gen(function* () {
      const empty = {
        patterns: [] as DreamPattern[],
        insights: [] as DreamInsight[],
        suggestions: [] as DreamSuggestion[],
      }
      if (!input.transcript.trim()) return empty

      const language = yield* provider.getLanguage(input.model)
      const system = [
        "你是 NovaWay 的会话反思器(dream)。回顾整段会话,提炼可复用的经验。",
        "patterns: 归纳成功/失败/优化模式,frequency 为大致出现次数,examples 给 1-3 个简短例子。",
        "insights: 关于代码风格、错误处理、性能、架构的观察,confidence 为 0-1 的置信度。",
        "suggestions: 值得沉淀的改进建议,type 区分 memory(记忆)/evolution(能力进化)/workflow(工作流),priority 为 high/medium/low。",
        "只输出真正有价值、可泛化的条目;没有则返回空数组。不要编造未发生的事,不要泄露密钥或敏感信息。",
      ].join("\n")

      const messages: ModelMessage[] = [
        { role: "system", content: system },
        {
          role: "user",
          content: ["请分析以下会话转录:", "", "<transcript>", input.transcript, "</transcript>"].join("\n"),
        },
      ]

      const result = yield* Effect.promise(() =>
        generateObject({
          model: language,
          temperature: 0.2,
          maxOutputTokens: 1200,
          messages,
          schema: Object.assign(Schema.toStandardSchemaV1(DreamResult), Schema.toStandardJSONSchemaV1(DreamResult)),
        }).then((r) => r.object as Schema.Schema.Type<typeof DreamResult>),
      ).pipe(Effect.catch((err) => Effect.succeed(undefined)))

      if (!result) return empty
      return {
        patterns: result.patterns.map((p: any) => ({
          type: p.type,
          description: p.description,
          frequency: p.frequency,
          examples: p.examples ? [...p.examples] : [],
        })),
        insights: result.insights.map((i: any) => ({
          category: i.category,
          observation: i.observation,
          confidence: i.confidence,
        })),
        suggestions: result.suggestions.map((s: any) => ({
          type: s.type,
          title: s.title,
          description: s.description,
          priority: s.priority,
        })),
      }
    })

    return {
      analyzeSession: (sessionId: SessionID, model: Provider.Model) => Effect.gen(function* () {
        const messages = yield* session.messages({ sessionID: sessionId }).pipe(Effect.orDie)
        const analysis = yield* analyzeTranscript({ model, transcript: transcript(messages) })
        return {
          sessionId,
          ...analysis,
          analyzedAt: new Date(),
        }
      }).pipe(Effect.orDie),

      analyzeHistory: (model: Provider.Model, limit = 10) => Effect.gen(function* () {
        const sessions = yield* session.list({ limit })
        const analyses: DreamAnalysis[] = []
        for (const s of sessions) {
          const messages = yield* session.messages({ sessionID: s.id }).pipe(Effect.orDie)
          const analysis = yield* analyzeTranscript({ model, transcript: transcript(messages) })
          analyses.push({ sessionId: s.id, ...analysis, analyzedAt: new Date() })
        }
        return analyses
      }).pipe(Effect.orDie),
    }
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Session.defaultLayer), Layer.provide(Provider.defaultLayer))
