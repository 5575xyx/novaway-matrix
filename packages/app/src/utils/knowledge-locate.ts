/**
 * 在文档正文里定位引用片段。
 *
 * 检索结果现在会带 `offset`（切片在原文中的起始位置），这是**最可靠**的线索：
 * 先用它在附近验证片段，命中就直接采用，不必全文搜。
 * 拿不到 offset（旧索引、图谱扩展命中）时按三级降级：
 *   1. 原样匹配
 *   2. 去掉首尾省略号后匹配
 *   3. 空白归一化后按词序列匹配（返回原文里的近似区间）
 * 都不中返回 undefined，UI 退回普通预览。
 */
export type LocateResult = {
  start: number
  end: number
  /** 命中的方式，便于调试与单测。 */
  mode: "offset" | "exact" | "trimmed" | "normalized"
}

const ELLIPSIS = ["…", "...", "⋯"]

function stripEllipsis(value: string) {
  let text = value.trim()
  let changed = true
  while (changed) {
    changed = false
    for (const mark of ELLIPSIS) {
      if (text.startsWith(mark)) {
        text = text.slice(mark.length).trimStart()
        changed = true
      }
      if (text.endsWith(mark)) {
        text = text.slice(0, -mark.length).trimEnd()
        changed = true
      }
    }
  }
  return text
}

/** 把文本切成 [归一化片段, 原文区间]，用于按归一化文本对齐回原文。 */
function normalizeWithMap(text: string) {
  const chars: string[] = []
  const map: number[] = []
  let inSpace = false
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    const space = /\s/.test(char)
    if (space) {
      if (inSpace) continue
      inSpace = true
      chars.push(" ")
      map.push(index)
      continue
    }
    inSpace = false
    chars.push(char.toLowerCase())
    map.push(index)
  }
  return { normalized: chars.join(""), map }
}

/**
 * 用索引给出的 offset 验证片段位置。
 *
 * offset 指向切片的开头，而 snippet 是切片内部截出来的一段（可能带省略号、
 * 也可能前面还有偏移），所以先剥掉省略号，在 offset 附近 ±64 字符的窗口里找。
 * 找不到就返回 undefined，交给全文匹配兜底 —— 不能盲目相信 offset，
 * 索引可能是旧版本生成的。
 */
function locateByOffset(text: string, snippet: string, offset: number): LocateResult | undefined {
  if (!Number.isFinite(offset) || offset < 0 || offset >= text.length) return
  const needle = stripEllipsis(snippet)
  if (needle.length < 2) return
  const from = Math.max(0, offset - 64)
  const window = text.slice(from, Math.min(text.length, offset + needle.length + 64))
  const at = window.indexOf(needle)
  if (at === -1) return
  const start = from + at
  return { start, end: start + needle.length, mode: "offset" }
}

export function locateSnippet(text: string, snippet: string | undefined, offset?: number): LocateResult | undefined {
  const raw = (snippet ?? "").trim()
  if (!text || raw.length < 2) return

  if (offset !== undefined) {
    const byOffset = locateByOffset(text, raw, offset)
    if (byOffset) return byOffset
  }

  const exact = text.indexOf(raw)
  if (exact !== -1) return { start: exact, end: exact + raw.length, mode: "exact" }

  const trimmed = stripEllipsis(raw)
  if (trimmed.length >= 2) {
    const at = text.indexOf(trimmed)
    if (at !== -1) return { start: at, end: at + trimmed.length, mode: "trimmed" }
  }

  const needle = stripEllipsis(raw).replace(/\s+/g, " ").toLowerCase()
  if (needle.length < 4) return
  const { normalized, map } = normalizeWithMap(text)
  const at = normalized.indexOf(needle)
  if (at === -1) return
  const start = map[at] ?? 0
  const last = Math.min(map.length - 1, at + needle.length - 1)
  const end = (map[last] ?? start) + 1
  return { start, end, mode: "normalized" }
}
