import type { Info } from "./schema"
import { scoreMemory, tokenizeQuery } from "./prefetch"
import { semanticScore } from "./vector"
import { denseCosine } from "./embedder"

/** ?????????? FTS5 MATCH ???? */
export function sanitizeFtsQuery(query: string) {
  const raw = query
    .replace(/["'*^():{}[\]~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (!raw) return ""
  const terms = tokenizeQuery(raw)
    .filter((term) => term.length >= 2)
    .slice(0, 12)
  if (!terms.length) return raw.slice(0, 80)
  return terms.map((term) => `"${term.replace(/"/g, "")}"`).join(" OR ")
}

export function rrfScore(rank: number, k = 60) {
  return 1 / (k + rank)
}

export type HybridScoreOptions = {
  ftsRanks?: Map<string, number>
  semanticRanks?: Map<string, number>
  queryEmbedding?: number[]
  queryEmbeddingModel?: string
  /** off disables local semantic boost (rare) */
  semantic?: "on" | "off"
  now?: number
}

/** 关键词 + FTS + 稠密/本地语义 + 重要性/时效性混合排序。 */
export function hybridScore(query: string, item: Info, options: HybridScoreOptions = {}) {
  const now = options.now ?? Date.now()
  let value = scoreMemory(query, item)

  const ftsRank = options.ftsRanks?.get(item.id)
  if (ftsRank !== undefined) value += rrfScore(ftsRank) * 40

  const dense =
    options.queryEmbedding &&
    item.embedding &&
    item.embeddingModel &&
    options.queryEmbeddingModel &&
    item.embeddingModel === options.queryEmbeddingModel
      ? denseCosine(options.queryEmbedding, item.embedding)
      : 0

  if (dense > 0) {
    value += dense * 40
  } else if (options.semantic !== "off") {
    const semanticRank = options.semanticRanks?.get(item.id)
    if (semanticRank !== undefined) value += rrfScore(semanticRank) * 30
    else value += semanticScore(query, item) * 25
  }

  value += (item.confidence ?? 0.7) * 5
  if (item.time.validTo && item.time.validTo < now) value -= 20
  if (item.time.lastConfirmed && now - item.time.lastConfirmed < 1000 * 60 * 60 * 24 * 30) value += 2

  return value
}

export function rankBySemantic(query: string, items: Info[]) {
  return items
    .map((item) => ({ item, score: semanticScore(query, item) }))
    .filter((entry) => entry.score >= 0.08)
    .toSorted((a, b) => b.score - a.score || b.item.time.updated - a.item.time.updated)
}

export function mergeHybridCandidates(input: {
  query: string
  keywordItems: Info[]
  ftsIds: string[]
  byId: Map<string, Info>
  limit: number
  queryEmbedding?: number[]
  queryEmbeddingModel?: string
  semantic?: "on" | "off"
}) {
  const ftsRanks = new Map(input.ftsIds.map((id, index) => [id, index + 1]))
  const pool = new Map<string, Info>()
  for (const item of input.keywordItems) pool.set(item.id, item)
  for (const id of input.ftsIds) {
    const item = input.byId.get(id)
    if (item) pool.set(id, item)
  }
  for (const item of input.byId.values()) pool.set(item.id, item)

  const semanticRanks =
    input.semantic === "off"
      ? new Map<string, number>()
      : new Map(
          rankBySemantic(input.query, Array.from(pool.values()))
            .slice(0, Math.max(input.limit * 3, 20))
            .map((entry, index) => [entry.item.id, index + 1] as const),
        )

  return Array.from(pool.values())
    .map((item) => ({
      item,
      score: hybridScore(input.query, item, {
        ftsRanks,
        semanticRanks,
        queryEmbedding: input.queryEmbedding,
        queryEmbeddingModel: input.queryEmbeddingModel,
        semantic: input.semantic,
      }),
    }))
    .toSorted((a, b) => b.score - a.score || b.item.time.updated - a.item.time.updated)
    .slice(0, input.limit)
    .map((entry) => entry.item)
}
