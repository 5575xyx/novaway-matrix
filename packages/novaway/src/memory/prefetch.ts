import type { Info } from "./schema"
import { domainLabel } from "./domain"
import { memoryKindFromTags, memoryKindLabel } from "./kind"
import { semanticScore } from "./vector"
import { summarizeMemory } from "../util/memory-listing"

export { applyRelevanceKeep, summarizeMemory } from "../util/memory-listing"

export const DEFAULT_PREFETCH_LIMIT = 5
export const DEFAULT_PREFETCH_BUDGET_CHARS = 1200
export const DEFAULT_GLOBAL_USER_SLOTS = 2

const GREETING =
  /^(你好|您好|嗨|哈喽|在吗|早上好|下午好|晚上好|午安|晚安|谢谢|感谢|好的|嗯|哦|ok|okay|hi|hello|hey|thanks|thx)[\s!！。.?？~～]*$/i
const SKIP_MEMORY = /不要用记忆|忽略记忆|别用记忆|ignore\s+memory|no\s+memory|without\s+memory/i
const FORCE_MEMORY =
  /记住|记忆|偏好|约定|规范|继续上次|按我们|之前说|历史决策|remember|preference|convention|as\s+we|last\s+time/i

/** 是否值得做轻量预取（L0 跳过 / L1 预取） */
export function shouldPrefetch(query: string) {
  const q = query.replace(/\u200B/g, "").trim()
  if (!q) return false
  if (SKIP_MEMORY.test(q)) return false
  if (/^\/\S*$/.test(q)) return false
  if (GREETING.test(q)) return false
  // 极短且无强制信号：多半寒暄/确认
  if (q.length < 4 && !FORCE_MEMORY.test(q)) return false
  return true
}

export function tokenizeQuery(query: string) {
  const q = query.toLowerCase().trim()
  if (!q) return [] as string[]
  const spaceTerms = q
    .split(/[\s,，。.!！?？;；:：、|/\\]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
  const cjkChunks = q.match(/[\u4e00-\u9fff]{2,}/g) ?? []
  const bigrams: string[] = []
  for (const chunk of cjkChunks) {
    if (chunk.length <= 2) bigrams.push(chunk)
    else for (let i = 0; i < chunk.length - 1; i++) bigrams.push(chunk.slice(i, i + 2))
  }
  return Array.from(new Set([...spaceTerms, ...bigrams]))
}

export function scoreMemory(query: string, item: Info) {
  const terms = tokenizeQuery(query)
  const haystack = [item.content, item.summary ?? "", ...item.tags].join(" ").toLowerCase()
  let hits = 0
  for (const term of terms) {
    if (haystack.includes(term)) hits += 1
  }
  let value = hits * 10 + item.importance
  // 全局用户画像：常驻候选加权
  if (item.scope === "global" && item.target === "user") value += 3
  else if (item.scope === "global") value += 1
  if (item.scope === "project") value += 0.5
  // 无命中时：仅靠重要性，便于挑高优先级画像
  if (!terms.length) return item.importance + (item.scope === "global" && item.target === "user" ? 3 : 0)
  return value
}

export type PrefetchSelectOptions = {
  limit?: number
  maxChars?: number
  globalUserSlots?: number
  relations?: readonly RelationClue[]
  /** Retrieved candidates are already filtered and ranked by hybrid search. */
  source?: "pool" | "retrieved"
  globalUsers?: Info[]
  /** 陈旧条目标注「N 天前，使用前先核实」。默认开启。 */
  staleness?: boolean
  /** 当前请求已带工具 schema 时，跳过「怎么用工具」这类说明型记忆。 */
  hasLiveToolSchema?: boolean
}

/** 超过这个天数没被确认/更新的记忆，在索引里提示先核实。 */
export const STALE_AFTER_DAYS = 14

const TOOL_GUIDE =
  /(?:工具|tool).{0,16}(?:调用|使用|参数|schema|参数表|命令)|(?:how to|use|call)\s+(?:the\s+)?[\w-]*tool/i

function stalenessDays(item: Info, now: number) {
  const last = item.time.lastConfirmed ?? item.time.updated
  if (!last) return undefined
  return Math.max(0, Math.floor((now - last) / 86_400_000))
}

export function stalenessNote(item: Info, now = Date.now()) {
  const days = stalenessDays(item, now)
  if (days === undefined || days < STALE_AFTER_DAYS) return undefined
  if (days > 3650) return "很久前，使用前先核实"
  return `${days} 天前，使用前先核实`
}

/** 工具说明型记忆：当前请求已经带 live tool schema 时注入只是噪音。 */
export function isToolGuide(item: Info) {
  if (item.kind !== "procedure" && !item.tags.includes("tool")) return false
  return TOOL_GUIDE.test(`${item.content} ${item.summary ?? ""}`)
}

export type RelationClue = {
  source: string
  relation: string
  target: string
  memoryID: string
}

/** 相关排序 + 全局画像保底 + 字符预算 */
export function selectPrefetchItems(query: string, pool: Info[], options: PrefetchSelectOptions = {}) {
  const limit = Math.max(1, options.limit ?? DEFAULT_PREFETCH_LIMIT)
  const maxChars = Math.max(200, options.maxChars ?? DEFAULT_PREFETCH_BUDGET_CHARS)
  const globalUserSlots = Math.max(0, options.globalUserSlots ?? DEFAULT_GLOBAL_USER_SLOTS)

  const candidates = options.hasLiveToolSchema ? pool.filter((item) => !isToolGuide(item)) : pool
  const scored = candidates.map((item) => ({ item, score: scoreMemory(query, item) }))
  const ranked =
    options.source === "retrieved"
      ? scored
      : scored.toSorted((a, b) => b.score - a.score || b.item.time.updated - a.item.time.updated)

  const selected: Info[] = []
  const seen = new Set<string>()
  let used = 0

  const tryAdd = (item: Info) => {
    if (seen.has(item.id)) return false
    if (selected.length >= limit) return false
    const line = formatIndexLine(item, { staleness: options.staleness })
    if (used + line.length > maxChars && selected.length > 0) return false
    selected.push(item)
    seen.add(item.id)
    used += line.length + 1
    return true
  }

  // 全局用户画像保底（高重要性优先）
  const globalUser = (options.globalUsers ?? ranked.map((x) => x.item))
    .filter((item) => item.scope === "global" && item.target === "user")
    .toSorted((a, b) => b.importance - a.importance || b.time.updated - a.time.updated)
    .slice(0, globalUserSlots)
  for (const item of globalUser) tryAdd(item)

  // 相关命中（分数需有一定信号，或无 query 时靠画像/重要性）
  const terms = tokenizeQuery(query)
  for (const { item, score } of ranked) {
    if (
      options.source !== "retrieved" &&
      terms.length &&
      score < 8 &&
      !(item.scope === "global" && item.target === "user")
    )
      continue
    tryAdd(item)
    if (selected.length >= limit) break
  }

  return selected
}

export function formatIndexLine(item: Info, options?: { staleness?: boolean; now?: number }) {
  const kind = item.target === "user" ? "用户" : "项目"
  const scope = item.scope === "global" ? "全局" : item.scope === "session" ? "会话" : "项目"
  const memoryKind = item.kind ?? memoryKindFromTags(item.tags)
  const entityItems = item.entities ?? []
  const entities = entityItems.length ? ` · ${entityItems.map((entity) => entity.name).join("、")}` : ""
  const stale = options?.staleness === false ? undefined : stalenessNote(item, options?.now)
  return `- [${item.id}] (${scope}/${kind}/${memoryKindLabel(memoryKind)}) ${summarizeMemory(item)}${stale ? ` · ${stale}` : ""}${entities}`
}

export function formatMemoryIndex(items: Info[], options?: { staleness?: boolean; now?: number }) {
  if (!items.length) return ""
  return [
    ...items.map((item) => formatIndexLine(item, options)),
    "",
    "说明：以上为记忆索引（摘要）。需要完整原文或更多条目时，使用 memory 工具：",
    "- action=search, query=关键词",
    "- action=read, id=上方 [mem_…] 获取原文；不传 id 列出记忆",
  ].join("\n")
}

export function buildPrefetchText(query: string, pool: Info[], options?: PrefetchSelectOptions) {
  if (!shouldPrefetch(query)) return ""
  const selected = selectPrefetchItems(query, pool, options)
  const index = formatMemoryIndex(selected, { staleness: options?.staleness })
  const relations = (options?.relations ?? []).filter((relation) =>
    selected.some((item) => item.id === relation.memoryID),
  )
  if (!relations.length) return index
  const relationLines = [
    "",
    "## 关系线索",
    ...relations
      .slice(0, 8)
      .map((relation) => `- ${relation.source} ${relation.relation} ${relation.target}（${relation.memoryID}）`),
  ].join("\n")
  return `${index}${relationLines}`
}
