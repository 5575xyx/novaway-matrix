/**
 * 知识图谱（轻量版）。
 *
 * 参考 LightRAG 的思路：从文档里抽实体与共现关系，供检索时做关联扩展。
 * 这里不接 LLM 做实体抽取（每次导入都调模型成本太高），改用确定性启发式：
 * - 英文：连续的大写开头词组（产品名、类名、缩写）
 * - 中文：2~4 字的连续词块，按文档内频次过滤
 * - 显式标记：反引号 / [[wikilink]] 里的术语
 * 同一文档内共现的实体连边，边权为共现次数。
 */
import type { SearchDocument } from "./search"

export type GraphNode = {
  id: string
  label: string
  type: "term"
  /** 出现的文档数 */
  documents: number
  /** 总出现次数 */
  weight: number
}

export type GraphEdge = {
  source: string
  target: string
  weight: number
}

export type KnowledgeGraph = {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "this",
  "that",
  "from",
  "into",
  "your",
  "have",
  "will",
  "were",
  "when",
  "what",
  "which",
  "there",
  "their",
  "about",
  "after",
  "before",
  "also",
  "using",
  "used",
  "more",
  "than",
  "then",
  "some",
  "such",
  "only",
  "over",
  "under",
  "each",
  "其它",
  "可以",
  "我们",
  "需要",
  "进行",
  "以及",
  "如果",
  "没有",
  "通过",
  "这个",
  "一个",
  "为了",
  "这些",
  "其中",
  "对应",
])

export function extractEntities(text: string, limit = 24): string[] {
  const counts = new Map<string, number>()
  const add = (value: string) => {
    const term = value.trim()
    if (term.length < 2) return
    if (STOP.has(term.toLowerCase())) return
    counts.set(term, (counts.get(term) ?? 0) + 1)
  }

  const backtick = /`([^`\n]{2,40})`/g
  for (const match of text.matchAll(backtick)) add(match[1])
  const wiki = /\[\[([^\]\n]{2,40})\]\]/g
  for (const match of text.matchAll(wiki)) add(match[1])
  const proper = /\b([A-Z][A-Za-z0-9]{2,}(?:\s+[A-Z][A-Za-z0-9]+){0,2})\b/g
  for (const match of text.matchAll(proper)) add(match[1])
  const acronym = /\b([A-Z]{2,8})\b/g
  for (const match of text.matchAll(acronym)) add(match[1])
  const cjk = /[㐀-鿿]{2,}/g
  for (const match of text.matchAll(cjk)) {
    const run = match[0]
    for (let size = 2; size <= 4; size++) {
      for (let index = 0; index + size <= run.length; index++) add(run.slice(index, index + size))
    }
  }

  return Array.from(counts.entries())
    .filter(([term, count]) => count >= 2 || /[A-Z]/.test(term) || term.length > 3)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term]) => term)
}

export function buildGraph(documents: readonly SearchDocument[], limit = 60): KnowledgeGraph {
  const nodes = new Map<string, GraphNode>()
  const edges = new Map<string, GraphEdge>()

  for (const document of documents) {
    const entities = extractEntities(document.content.normalize("NFKC"))
    const unique = Array.from(new Set(entities))
    for (const entity of unique) {
      const node = nodes.get(entity)
      const occurrences = entities.filter((item) => item === entity).length
      if (node) {
        node.documents += 1
        node.weight += occurrences
      } else {
        nodes.set(entity, { id: entity, label: entity, type: "term", documents: 1, weight: occurrences })
      }
    }
    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        const [source, target] = [unique[i], unique[j]].sort()
        const key = source + " " + target
        const edge = edges.get(key)
        if (edge) edge.weight += 1
        else edges.set(key, { source, target, weight: 1 })
      }
    }
  }

  const ranked = Array.from(nodes.values())
    .sort((a, b) => b.documents - a.documents || b.weight - a.weight)
    .slice(0, limit)
  const keep = new Set(ranked.map((node) => node.id))
  return {
    nodes: ranked,
    edges: Array.from(edges.values())
      .filter((edge) => keep.has(edge.source) && keep.has(edge.target))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, limit * 3),
  }
}
