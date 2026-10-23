/**
 * 知识库检索的纯逻辑：切片 + 分词 + BM25。
 *
 * 不依赖文件系统或数据库，单测可以直接跑。
 * 分词同时覆盖英文单词与中文（单字 + 相邻二元组），这样中文查询不需要额外分词器。
 */
import { cosineSimilarity, textVector } from "@/memory/vector"

export type Chunk = {
  index: number
  text: string
  /** 在原文中的起始偏移（用于引用精确定位）。 */
  offset: number
}

export type SearchDocument = {
  id: string
  collectionID: string
  title: string
  content: string
  /** 文档内容指纹：索引与向量缓存用它判断是否过期。 */
  hash?: string
}

export type SearchHit = {
  collectionID: string
  documentID: string
  title: string
  snippet: string
  score: number
  chunk: number
  /** 命中切片在原文中的起始偏移，供 UI 精确定位。 */
  offset?: number
  /** 命中来源：关键词/语义融合，或图谱关联扩展。 */
  via?: "hybrid" | "graph"
}

const DEFAULT_CHUNK_SIZE = 1200
const DEFAULT_OVERLAP = 120

/**
 * 切片前的规范化。
 *
 * 索引只存偏移与长度，加载时要从原文切回切片正文，所以这里必须是
 * **唯一**的规范化入口 —— chunkText 与索引重建共用它，否则偏移会错位。
 */
export function normalizeForChunks(text: string) {
  return text.replace(/\r\n/g, "\n").trim()
}

/** 按空行切段落，再把段落拼进不超过 maxSize 的窗口；超长段落按句子/长度硬切。 */
export function chunkText(text: string, options: { maxSize?: number; overlap?: number } = {}): Chunk[] {
  const maxSize = options.maxSize ?? DEFAULT_CHUNK_SIZE
  const overlap = Math.min(options.overlap ?? DEFAULT_OVERLAP, Math.floor(maxSize / 4))
  const normalized = normalizeForChunks(text)
  if (!normalized) return []

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean)

  const pieces: string[] = []
  for (const paragraph of paragraphs) {
    if (paragraph.length <= maxSize) {
      pieces.push(paragraph)
      continue
    }
    const sentences = paragraph.split(/(?<=[。！？.!?])\s*/)
    let current = ""
    for (const sentence of sentences) {
      if (!sentence) continue
      if (sentence.length > maxSize) {
        if (current) {
          pieces.push(current)
          current = ""
        }
        for (let index = 0; index < sentence.length; index += maxSize - overlap) {
          pieces.push(sentence.slice(index, index + maxSize))
        }
        continue
      }
      if (current.length + sentence.length > maxSize) {
        pieces.push(current)
        current = sentence
        continue
      }
      current += sentence
    }
    if (current) pieces.push(current)
  }

  const bodies: string[] = []
  let current = ""
  for (const piece of pieces) {
    if (current && current.length + piece.length + 2 > maxSize) {
      bodies.push(current)
      // 重叠：把上一段尾部带进下一段，跨段落的句子也能命中。
      const tail = overlap > 0 ? current.slice(-overlap) : ""
      current = tail ? `${tail}\n\n${piece}` : piece
    } else {
      current = current ? `${current}\n\n${piece}` : piece
    }
  }
  if (current) bodies.push(current)

  // 偏移按「锚点」定位：用切片开头的一段文字在规范化后的原文里向后查找。
  // 段落被 trim / 合并过，无法靠长度累加精确推导，锚点查找更稳。
  let cursor = 0
  return bodies.map((body, index) => {
    const anchor = body.slice(0, 24)
    const found = anchor ? normalized.indexOf(anchor, cursor) : -1
    const offset = found === -1 ? cursor : found
    cursor = Math.max(offset + 1, cursor)
    return { index, text: body, offset }
  })
}

/** 英文/数字按词切；中文按字 + 相邻二元组切。全小写。 */
export function tokenize(text: string): string[] {
  const lower = text.toLowerCase()
  const tokens: string[] = []
  for (const match of lower.matchAll(/[a-z0-9_]+|[㐀-鿿]+/g)) {
    const value = match[0]
    if (!/[㐀-鿿]/.test(value)) {
      tokens.push(value)
      continue
    }
    const chars = Array.from(value)
    for (let index = 0; index < chars.length; index++) {
      tokens.push(chars[index])
      if (index + 1 < chars.length) tokens.push(chars[index] + chars[index + 1])
    }
  }
  return tokens
}

const K1 = 1.2
const B = 0.75

export function searchDocuments(
  documents: readonly SearchDocument[],
  query: string,
  options: { limit?: number; snippetSize?: number } = {},
): SearchHit[] {
  const limit = options.limit ?? 10
  const snippetSize = options.snippetSize ?? 180
  const queryTokens = Array.from(new Set(tokenize(query))).filter((token) => token.length > 1 || /[㐀-鿿]/.test(token))
  if (queryTokens.length === 0) return []

  const entries = documents.flatMap((document) =>
    chunkText(document.content).map((chunk) => ({
      document,
      chunk,
      // 标题参与打分：命中标题的片段应排在前面，只给标题一份轻量权重。
      tokens: tokenize(`${document.title}\n${chunk.text}`),
    })),
  )
  if (entries.length === 0) return []

  const avgLength = entries.reduce((sum, entry) => sum + entry.tokens.length, 0) / entries.length
  const documentFrequency = new Map<string, number>()
  for (const entry of entries) {
    for (const token of new Set(entry.tokens)) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1)
    }
  }

  const scored = entries.flatMap((entry) => {
    const counts = new Map<string, number>()
    for (const token of entry.tokens) counts.set(token, (counts.get(token) ?? 0) + 1)
    let score = 0
    for (const token of queryTokens) {
      const frequency = counts.get(token)
      if (!frequency) continue
      const df = documentFrequency.get(token) ?? 0
      const idf = Math.log(1 + (entries.length - df + 0.5) / (df + 0.5))
      score += idf * ((frequency * (K1 + 1)) / (frequency + K1 * (1 - B + (B * entry.tokens.length) / avgLength)))
    }
    if (score <= 0) return []
    return [
      {
        collectionID: entry.document.collectionID,
        documentID: entry.document.id,
        title: entry.document.title,
        snippet: snippet(entry.chunk.text, queryTokens, snippetSize),
        score,
        chunk: entry.chunk.index,
      },
    ]
  })

  return scored.sort((a, b) => b.score - a.score).slice(0, limit)
}

function snippet(text: string, tokens: readonly string[], size: number): string {
  const flat = text.replace(/\s+/g, " ").trim()
  if (flat.length <= size) return flat
  const lower = flat.toLowerCase()
  let at = -1
  for (const token of tokens) {
    const index = lower.indexOf(token)
    if (index === -1) continue
    if (at === -1 || index < at) at = index
  }
  if (at === -1) return flat.slice(0, size) + "…"
  const start = Math.max(0, at - Math.floor(size / 3))
  const end = Math.min(flat.length, start + size)
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`
}

/**
 * 混合召回：BM25（关键词）+ 稀疏语义（本地 n-gram）+ 可选稠密向量。
 *
 * 三路分数不可直接相加（量纲不同），统一用 RRF（Reciprocal Rank Fusion）融合：
 * 每个结果按各路的排名取 1/(k+rank) 再求和，天然不受分数尺度影响。
 */
export type IndexedChunk = {
  collectionID: string
  documentID: string
  title: string
  chunk: number
  text: string
  /** 在原文中的起始偏移。 */
  offset?: number
  /** 原始 token 序列。持久化索引加载时会省略，改用 tf + length。 */
  tokens: string[]
  /** token 频次（与 tokens 二选一，优先使用）。 */
  tf?: Map<string, number>
  /** token 总数，BM25 长度归一化用。 */
  length?: number
  vector: Map<string, number>
}

/** 取词频：优先用持久化索引里的 tf，否则从 tokens 现算。 */
function countsOf(entry: IndexedChunk) {
  if (entry.tf) return entry.tf
  const counts = new Map<string, number>()
  for (const token of entry.tokens) counts.set(token, (counts.get(token) ?? 0) + 1)
  return counts
}

/** token 总数：优先用持久化索引里的 length。 */
function lengthOf(entry: IndexedChunk) {
  if (entry.length !== undefined) return entry.length
  return entry.tokens.length
}

export type HybridOptions = {
  limit?: number
  snippetSize?: number
  /** 稠密向量相似度（与 IndexedChunk 等长、同序）。没有就只用前两路。 */
  dense?: readonly number[]
  /** RRF 常数，越大越平滑。 */
  k?: number
  weights?: { lexical?: number; sparse?: number; dense?: number }
}

export type ChunkCache = Map<string, { hash: string; chunks: IndexedChunk[] }>

/**
 * 按文档缓存分片结果。
 *
 * 增量索引的关键：改一篇文档只重算这一篇的切片与词向量，其余文档直接复用。
 * 缓存键带内容 hash，文档一改旧条目自然失效（不会被引用到）。
 * 没有 hash 的文档（测试数据、手工构造）不写缓存，保证行为可预测。
 */
export function indexChunks(documents: readonly SearchDocument[], cache?: ChunkCache, limit = 20_000): IndexedChunk[] {
  return documents.flatMap((document) => {
    const hash = document.hash
    if (cache && hash) {
      const hit = cache.get(document.id)
      if (hit && hit.hash === hash && hit.chunks.length > 0) {
        cache.delete(document.id)
        cache.set(document.id, hit)
        return hit.chunks.map((chunk) => ({ ...chunk, collectionID: document.collectionID, title: document.title }))
      }
    }
    const chunks = chunkText(document.content).map((chunk) => ({
      collectionID: document.collectionID,
      documentID: document.id,
      title: document.title,
      chunk: chunk.index,
      text: chunk.text,
      offset: chunk.offset,
      tokens: tokenize(document.title + "\n" + chunk.text),
      vector: textVector(chunk.text + "\n" + document.title),
    }))
    if (cache && hash) {
      cache.set(document.id, { hash, chunks })
      while (cache.size > limit) {
        const oldest = cache.keys().next().value
        if (oldest === undefined) break
        cache.delete(oldest)
      }
    }
    return chunks
  })
}

function ranked(scores: readonly number[]) {
  return scores
    .map((score, index) => ({ score, index }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item, rank) => ({ index: item.index, rank }))
}

export function hybridSearch(
  documents: readonly SearchDocument[],
  query: string,
  options: HybridOptions = {},
): SearchHit[] {
  const entries = indexChunks(documents)
  if (entries.length === 0) return []
  return hybridSearchChunks(entries, query, options)
}

/**
 * 在已切片的条目上检索。
 *
 * 与 `hybridSearch` 的区别：不重新切片，直接吃持久化索引读出来的 chunks，
 * 因此进程重启后第一次查询不需要重新分词/向量化。
 */
export function hybridSearchChunks(
  entries: readonly IndexedChunk[],
  query: string,
  options: HybridOptions = {},
): SearchHit[] {
  const limit = options.limit ?? 10
  const snippetSize = options.snippetSize ?? 180
  const k = options.k ?? 60
  const weights = {
    lexical: options.weights?.lexical ?? 1,
    sparse: options.weights?.sparse ?? 0.7,
    dense: options.weights?.dense ?? 1.2,
  }

  if (entries.length === 0) return []

  const queryTokens = Array.from(new Set(tokenize(query))).filter((token) => token.length > 1 || /[㐀-鿿]/.test(token))
  const queryVector = textVector(query)

  // 1) BM25
  const counts = entries.map(countsOf)
  const lengths = entries.map(lengthOf)
  const avgLength = lengths.reduce((sum, value) => sum + value, 0) / Math.max(entries.length, 1)
  const documentFrequency = new Map<string, number>()
  for (const counts_ of counts) {
    for (const token of counts_.keys()) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1)
    }
  }
  const lexical = counts.map((counts_, index) => {
    let score = 0
    for (const token of queryTokens) {
      const frequency = counts_.get(token)
      if (!frequency) continue
      const df = documentFrequency.get(token) ?? 0
      const idf = Math.log(1 + (entries.length - df + 0.5) / (df + 0.5))
      score += idf * ((frequency * (K1 + 1)) / (frequency + K1 * (1 - B + (B * lengths[index]) / avgLength)))
    }
    return score
  })

  // 2) 稀疏语义：query 与 chunk 的 n-gram 余弦
  const sparse = entries.map((entry) => cosineSimilarity(queryVector, entry.vector))

  // 3) 稠密向量（可选）
  const dense = options.dense

  const fused = new Map<number, number>()
  const add = (list: Array<{ index: number; rank: number }>, weight: number) => {
    for (const item of list) fused.set(item.index, (fused.get(item.index) ?? 0) + weight / (k + item.rank + 1))
  }
  add(ranked(lexical), weights.lexical)
  add(ranked(sparse), weights.sparse)
  if (dense && dense.length === entries.length) add(ranked(Array.from(dense)), weights.dense)

  const max = Math.max(...fused.values(), 0) || 1
  return Array.from(fused.entries())
    .map(([index, score]) => ({ index, score: score / max }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ index, score }) => {
      const entry = entries[index]
      return {
        collectionID: entry.collectionID,
        documentID: entry.documentID,
        title: entry.title,
        snippet: snippet(entry.text, queryTokens, snippetSize),
        score,
        chunk: entry.chunk,
        ...(entry.offset !== undefined ? { offset: entry.offset } : {}),
      }
    })
}
