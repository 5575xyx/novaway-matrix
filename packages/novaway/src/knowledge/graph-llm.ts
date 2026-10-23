/**
 * LLM 图谱抽取（可选）。
 *
 * 启发式抽取快但只知道"哪些词一起出现"；LLM 能给出**关系语义**
 * （例如「订单服务 依赖 支付网关」），关联检索的质量明显更好。
 * 代价是每次导入多一次模型调用，所以默认关闭，由
 * `NOVAWAY_KNOWLEDGE_LLM_GRAPH=1` 或请求参数显式开启。
 *
 * 这里只放"解析 + 合并"的纯逻辑，模型调用在 HTTP handler 里注入，
 * 便于单测、也避免知识库模块依赖 Provider。
 */
import type { GraphEdge, GraphNode, KnowledgeGraph } from "./graph"

export type GraphRelation = {
  source: string
  target: string
  relation: string
}

export type ExtractedGraph = {
  entities: string[]
  relations: GraphRelation[]
}

export type LlmGraphExtractor = (input: { title: string; content: string }) => Promise<ExtractedGraph | undefined>

export type StoredGraph = ExtractedGraph & {
  hash: string
  modelID: string
  createdAt: number
}

const LIMITS = { entities: 40, relations: 60 }

/** 模型经常包一层 ```json：先剥围栏，再取最外层花括号。 */
export function parseGraphJson(text: string): ExtractedGraph | undefined {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim()
  const start = cleaned.indexOf("{")
  const end = cleaned.lastIndexOf("}")
  if (start === -1 || end <= start) return
  let value: unknown
  try {
    value = JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    return
  }
  if (!value || typeof value !== "object") return
  const record = value as Record<string, unknown>
  const entities = Array.isArray(record.entities)
    ? record.entities
        .map((item) => (typeof item === "string" ? item : typeof item === "object" && item ? (item as any).name : ""))
        .map((item) => String(item ?? "").trim())
        .filter((item) => item.length >= 1 && item.length <= 80)
    : []
  const relations = Array.isArray(record.relations)
    ? record.relations.flatMap((item) => {
        if (!item || typeof item !== "object") return []
        const relation = item as Record<string, unknown>
        const source = String(relation.source ?? relation.from ?? "").trim()
        const target = String(relation.target ?? relation.to ?? "").trim()
        const label = String(relation.relation ?? relation.type ?? relation.label ?? "").trim()
        if (!source || !target || source === target) return []
        return [{ source, target, relation: label }]
      })
    : []
  const uniqueEntities = Array.from(new Set(entities)).slice(0, LIMITS.entities)
  const uniqueRelations = relations.slice(0, LIMITS.relations)
  if (uniqueEntities.length === 0 && uniqueRelations.length === 0) return
  return { entities: uniqueEntities, relations: uniqueRelations }
}

/** 把文档级抽取结果合并进图：实体累加文档数，关系边按出现次数加权。 */
export function mergeExtracted(graph: KnowledgeGraph, extracted: readonly StoredGraph[]): KnowledgeGraph {
  const nodes = new Map<string, GraphNode>(graph.nodes.map((node) => [node.id, { ...node }]))
  const edges = new Map<string, GraphEdge>(graph.edges.map((edge) => [edge.source + " " + edge.target, { ...edge }]))

  for (const item of extracted) {
    for (const entity of item.entities) {
      const node = nodes.get(entity)
      if (node) {
        node.documents += 1
        node.weight += 1
      } else {
        nodes.set(entity, { id: entity, label: entity, type: "term", documents: 1, weight: 1 })
      }
    }
    for (const relation of item.relations) {
      const [source, target] = [relation.source, relation.target].sort()
      if (!nodes.has(source) || !nodes.has(target)) continue
      const key = source + " " + target
      const edge = edges.get(key)
      // LLM 关系的信息量高于共现，权重给 2；同一对实体重复出现继续累加。
      if (edge) edge.weight += 2
      else edges.set(key, { source, target, weight: 2 })
    }
  }

  return {
    nodes: Array.from(nodes.values())
      .sort((a, b) => b.documents - a.documents || b.weight - a.weight)
      .slice(0, 80),
    edges: Array.from(edges.values())
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 240),
  }
}

/** 相关文档：优先用 LLM 抽的实体集合，没有时回落到传入的启发式实体。 */
export function sharedEntities(
  target: { entities: readonly string[] },
  candidate: { entities: readonly string[] },
): string[] {
  const set = new Set(target.entities)
  return Array.from(new Set(candidate.entities)).filter((entity) => set.has(entity))
}
