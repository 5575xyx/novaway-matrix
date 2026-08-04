/** Local semantic features without external embedding APIs. */

export type SparseVector = Map<string, number>

/** Build a sparse bag-of-features vector from text (tokens + char n-grams). */
export function textVector(text: string): SparseVector {
  const raw = text.toLowerCase().normalize("NFKC").trim()
  const vec: SparseVector = new Map()
  if (!raw) return vec

  const add = (feature: string, weight = 1) => {
    if (!feature) return
    vec.set(feature, (vec.get(feature) ?? 0) + weight)
  }

  // Word-like tokens (latin/numbers/cjk runs)
  for (const token of raw.split(/[^\p{L}\p{N}]+/u)) {
    if (token.length >= 2) add(`w:${token}`, 2.5)
    // light stemming-ish prefixes for english variants
    if (/^[a-z]{5,}$/.test(token)) {
      add(`p4:${token.slice(0, 4)}`, 0.8)
      add(`p5:${token.slice(0, 5)}`, 1)
    }
  }

  // Compact string for char n-grams (helps CJK and typos)
  const compact = raw.replace(/\s+/g, "")
  const n = compact.length
  for (let i = 0; i < n; i++) {
    add(`c1:${compact[i]}`, 0.2)
    if (i + 1 < n) add(`c2:${compact.slice(i, i + 2)}`, 1)
    if (i + 2 < n) add(`c3:${compact.slice(i, i + 3)}`, 1.5)
  }

  // L2 normalize
  let norm = 0
  for (const value of vec.values()) norm += value * value
  norm = Math.sqrt(norm) || 1
  for (const [key, value] of vec) vec.set(key, value / norm)
  return vec
}

export function cosineSimilarity(a: SparseVector, b: SparseVector) {
  if (!a.size || !b.size) return 0
  // iterate smaller map
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  let dot = 0
  for (const [key, value] of small) {
    const other = large.get(key)
    if (other) dot += value * other
  }
  // vectors are normalized ? cosine == dot
  return Math.max(0, Math.min(1, dot))
}

export function semanticSimilarity(query: string, document: string) {
  return cosineSimilarity(textVector(query), textVector(document))
}

/** 0~1 semantic relevance for a memory item. */
export function semanticScore(
  query: string,
  item: {
    content: string
    summary?: string
    tags?: readonly string[]
    factKey?: string
    kind?: string
    entities?: readonly { name: string; type?: string }[]
  },
) {
  const doc = [
    item.content,
    item.summary ?? "",
    ...(item.tags ?? []),
    item.factKey ?? "",
    item.kind ?? "",
    ...(item.entities ?? []).flatMap((entity) => [entity.name, entity.type ?? ""]),
  ].join("\n")
  return semanticSimilarity(query, doc)
}
