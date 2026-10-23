/**
 * 自动生成评测用例（基线）。
 *
 * 目的：新用户导入一批文档后，评测页是空的 —— 没有用例就看不出检索好坏。
 * 这里用**确定性启发式**从文档本身造一批"问题 → 期望文档"：
 * 不需要调模型，离线可用，导入完立刻就有基线分。
 *
 * 查询词取「这篇文档最有辨识度的术语」：
 * - 术语在**整个集合里越少见**，区分度越高（IDF）；
 * - 在**这篇文档里出现越多**，越能代表它（TF）；
 * - 标题里的词额外加权（标题通常就是主题）；
 * 中文按 2–4 字词块，英文按单词，和检索的分词口径保持一致。
 */
import { tokenize } from "./search"

export type SuggestDocument = {
  id: string
  title: string
  content: string
}

export type SuggestedCase = {
  query: string
  expected: string[]
  /** 为什么选它，便于 UI 展示与排查。 */
  reason: "title" | "terms"
  /** 选中的关键词（reason=terms 时有值）。 */
  terms?: string[]
}

const MAX_DOCS = 12
const MAX_TERMS = 3
const MIN_CONTENT = 40
const TITLE_MIN = 4
const TITLE_MAX = 60

// 标题里常见但没有检索价值的词，避免生成"使用说明"这种过于宽泛的查询。
const WEAK_TITLES = new Set([
  "readme",
  "index",
  "notes",
  "note",
  "untitled",
  "文档",
  "说明",
  "笔记",
  "新建文档",
  "未命名",
  "无标题",
])

function normalizeTitle(title: string) {
  return title
    .replace(/\.[a-z0-9]{1,8}$/i, "")
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function isUsefulTitle(title: string) {
  const value = normalizeTitle(title)
  if (value.length < TITLE_MIN || value.length > TITLE_MAX) return false
  if (WEAK_TITLES.has(value.toLowerCase())) return false
  // 纯数字/纯符号标题没有检索价值。
  return /[\p{L}\p{N}]/u.test(value)
}

/** 词是否适合当查询：长度与字符集过滤，去掉纯数字与停用词。 */
function usable(token: string) {
  if (token.length < 2) return false
  if (/^\d+$/.test(token)) return false
  if (!/[\p{L}\p{N}]/u.test(token)) return false
  return true
}

function frequencies(content: string) {
  const counts = new Map<string, number>()
  for (const token of tokenize(content)) {
    if (!usable(token)) continue
    counts.set(token, (counts.get(token) ?? 0) + 1)
  }
  return counts
}

export function suggestCases(documents: readonly SuggestDocument[], limit = MAX_DOCS): SuggestedCase[] {
  const usableDocs = documents.filter((document) => document.content.trim().length >= MIN_CONTENT && document.id)
  if (usableDocs.length === 0) return []

  // 集合级文档频率：用来算 IDF。
  const documentFrequency = new Map<string, number>()
  const perDocument = usableDocs.map((document) => {
    const counts = frequencies(document.content)
    for (const token of counts.keys()) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1)
    }
    return { document, counts }
  })

  const total = usableDocs.length
  const scored = perDocument.map(({ document, counts }) => {
    const titleTokens = new Set(tokenize(normalizeTitle(document.title)))
    let best: Array<{ token: string; score: number }> = []
    for (const [token, count] of counts) {
      const df = documentFrequency.get(token) ?? 1
      // 出现在所有文档里的词区分度为 0，直接排除。
      if (df >= total && total > 1) continue
      const idf = Math.log(1 + total / df)
      const tf = 1 + Math.log(count)
      const titleBoost = titleTokens.has(token) ? 1.8 : 1
      best.push({ token, score: tf * idf * titleBoost })
    }
    best = best.sort((a, b) => b.score - a.score).slice(0, MAX_TERMS)
    return { document, terms: best.map((item) => item.token) }
  })

  const used = new Set<string>()
  const result: SuggestedCase[] = []

  for (const item of scored) {
    if (result.length >= limit) break
    const title = normalizeTitle(item.document.title)
    if (isUsefulTitle(title) && !used.has(title.toLowerCase())) {
      used.add(title.toLowerCase())
      result.push({ query: title, expected: [item.document.id], reason: "title" })
      continue
    }
    const terms = item.terms.filter((term) => term.length >= 2)
    if (terms.length === 0) continue
    const query = terms.join(" ")
    if (used.has(query.toLowerCase())) continue
    used.add(query.toLowerCase())
    result.push({ query, expected: [item.document.id], reason: "terms", terms })
  }

  return result
}
