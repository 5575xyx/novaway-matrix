/**
 * Markdown front-matter（文件头的属性区）。
 *
 * 为什么要有这个模块：属性区是**结构化数据**，不是正文。
 * 用户想改 `tags` 的一个值，不该手工去数冒号在第几个字符；「属性面板」需要
 * 一份能读能写的模型，而 Agent 也要能用同一套词汇改属性（note
 * properties）。这里刻意只实现 YAML 的一个安全子集：
 *
 *   ---
 *   title: 周报
 *   tags: [工作, 2026]
 *   draft: false
 *   ---
 *
 * 支持标量（字符串 / 数字 / 布尔 / null）、行内数组、`- item` 块数组和注释；
 * 嵌套对象原样保留但不可编辑（面板只读展示），避免半懂不懂地重排用户的 YAML。
 *
 * 所有改写都只动被点中的那几行，其余字节原样保留 —— 和文档编辑器的外科手术式
 * 写回是同一条原则。
 */

export type FrontMatterValue = string | number | boolean | null | string[]

export type FrontMatterEntry = {
  key: string
  value: FrontMatterValue
  /** 值在源码里原样长什么样（未修改时直接回写它，不做重新序列化）。 */
  raw: string
  /** 这一行的偏移（相对整个文件，0 起）。 */
  offset: number
}

export type FrontMatterBlock = {
  /** 开头 `---` 的起始偏移。 */
  start: number
  /** 结尾 `---` 之后（含换行）的偏移，也就是正文开始的位置。 */
  end: number
  entries: FrontMatterEntry[]
}

type SourceLine = { text: string; start: number; next: number }

const KEY_LINE = /^([A-Za-z0-9_.\-\u4e00-\u9fff]+)\s*:\s*(.*)$/u
const NUMBER = /^[-+]?\d+(?:\.\d+)?$/

function sourceLines(text: string): SourceLine[] {
  const result: SourceLine[] = []
  let index = 0
  while (index <= text.length) {
    const newline = text.indexOf("\n", index)
    const end = newline === -1 ? text.length : newline
    result.push({
      text: text.slice(index, end).replace(/\r$/, ""),
      start: index,
      next: newline === -1 ? text.length : newline + 1,
    })
    if (newline === -1) break
    index = newline + 1
  }
  return result
}

/** 文件的换行风格：改写属性区时沿用，别把 CRLF 文件改成 LF。 */
function eolOf(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n"
}

function unquote(raw: string): string {
  const quote = raw[0]
  const inner = raw.slice(1, -1)
  if (quote === "'") return inner.replace(/''/g, "'")
  try {
    return JSON.parse(raw) as string
  } catch {
    return inner
  }
}

function splitInlineList(body: string): string[] {
  const items: string[] = []
  let current = ""
  let quote: string | undefined
  for (const char of body) {
    if (quote) {
      if (char === quote) quote = undefined
      current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      current += char
      continue
    }
    if (char === ",") {
      items.push(current)
      current = ""
      continue
    }
    current += char
  }
  if (current.trim() !== "" || items.length > 0) items.push(current)
  return items
    .map((item) => parseScalar(item.trim()))
    .map((item) => (item === null ? "" : typeof item === "string" ? item : String(item)))
}

function parseScalar(raw: string): FrontMatterValue {
  const value = raw.trim()
  if (value === "" || value === "~" || value === "null" || value === "Null" || value === "NULL") return null
  if (value === "true" || value === "True" || value === "TRUE") return true
  if (value === "false" || value === "False" || value === "FALSE") return false
  if (NUMBER.test(value)) return Number(value)
  if (value.startsWith("[") && value.endsWith("]")) return splitInlineList(value.slice(1, -1))
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) return unquote(value)
  }
  // 行尾注释：`draft: false # 还没写完` —— 只在有空格隔开时才算注释。
  const comment = value.search(/\s#/)
  if (comment > 0) return parseScalar(value.slice(0, comment))
  return value
}

/** 读取文件头的属性区；没有（或格式不完整）时返回 undefined。 */
export function parseFrontMatter(text: string): FrontMatterBlock | undefined {
  const bom = text.charCodeAt(0) === 0xfeff ? 1 : 0
  const body = bom ? text.slice(1) : text
  const all = sourceLines(body)
  if (all.length === 0 || all[0].text.trim() !== "---") return undefined

  let close = -1
  for (let index = 1; index < all.length; index += 1) {
    const value = all[index].text.trim()
    if (value === "---" || value === "...") {
      close = index
      break
    }
  }
  if (close === -1) return undefined

  const entries: FrontMatterEntry[] = []
  for (let index = 1; index < close; index += 1) {
    const line = all[index]
    const value = line.text.trim()
    if (value === "" || value.startsWith("#") || value.startsWith("- ")) continue
    const match = KEY_LINE.exec(line.text)
    if (!match) continue
    const key = match[1]
    const rest = match[2].trim()
    // 块数组：`tags:` 后面换行，每一项是一行 `- 值`。
    if (rest === "") {
      const items: string[] = []
      for (let item = index + 1; item < close; item += 1) {
        const candidate = all[item].text.trim()
        if (!candidate.startsWith("- ")) break
        items.push(String(parseScalar(candidate.slice(2)) ?? ""))
      }
      if (items.length > 0) {
        entries.push({
          key,
          value: items,
          raw: items.map((item) => "- " + item).join("\n"),
          offset: bom + line.start,
        })
        index += items.length
        continue
      }
    }
    entries.push({ key, value: parseScalar(rest), raw: rest, offset: bom + line.start })
  }

  return { start: bom, end: bom + Math.min(all[close].next, body.length), entries }
}

const NEEDS_QUOTE = /^$|^\s|\s$|[:#\[\]{}&*!|>'"%@`,]|^[-+]?\d+(?:\.\d+)?$|^(?:true|false|null|~)$/i

/** 一个标量怎么写成 YAML：能裸写就裸写，有歧义才加引号。 */
function formatScalarText(value: string): string {
  if (!NEEDS_QUOTE.test(value)) return value
  return JSON.stringify(value)
}

export function formatFrontMatterValue(value: FrontMatterValue): string {
  if (value === null) return ""
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : '""'
  if (typeof value === "boolean") return value ? "true" : "false"
  if (Array.isArray(value)) return "[" + value.map(formatScalarText).join(", ") + "]"
  return formatScalarText(value)
}

function isBlockItem(line: string): boolean {
  return line.trim().startsWith("- ")
}

/**
 * 改属性：只重写被改到的键，其余行（包括注释、未知的嵌套结构）逐字节保留。
 *
 * `undefined` 表示删除这个属性；文件里还没有属性区时会建一个。
 */
export function updateFrontMatter(text: string, updates: Record<string, FrontMatterValue | undefined>): string {
  const keys = Object.keys(updates)
  if (keys.length === 0) return text
  const eol = eolOf(text)
  const block = parseFrontMatter(text)

  if (!block) {
    const present = keys.filter((key) => updates[key] !== undefined)
    if (present.length === 0) return text
    const head = present.map((key) => key + ": " + formatFrontMatterValue(updates[key]!)).join(eol)
    return "---" + eol + head + eol + "---" + eol + text
  }

  // BOM 单独拿出来：偏移都相对属性区起点，回写时再拼回去。
  const prefix = text.slice(0, block.start)
  const content = text.slice(block.start)
  const all = sourceLines(content)
  let close = -1
  for (let index = 1; index < all.length; index += 1) {
    const value = all[index].text.trim()
    if (value === "---" || value === "...") {
      close = index
      break
    }
  }
  if (close < 0) return text

  const output: string[] = [all[0].text]
  const seen = new Set<string>()
  for (let index = 1; index < close; index += 1) {
    const line = all[index]
    const match = KEY_LINE.exec(line.text)
    const key = match?.[1]
    if (!key || !Object.hasOwn(updates, key)) {
      output.push(line.text)
      continue
    }
    seen.add(key)
    // 这个键的块数组项属于它自己：改写成标量 / 删除时一起吃掉。
    let tail = index
    while (tail + 1 < close && isBlockItem(all[tail + 1].text)) tail += 1
    const value = updates[key]
    if (value !== undefined) output.push(key + ": " + formatFrontMatterValue(value))
    index = tail
  }

  for (const key of keys) {
    if (seen.has(key)) continue
    const value = updates[key]
    if (value === undefined) continue
    output.push(key + ": " + formatFrontMatterValue(value))
  }

  const tail = content.slice(all[close].next)
  const separator = tail.length > 0 ? eol : ""
  return prefix + output.join(eol) + eol + all[close].text + separator + tail
}

/** 把用户输入的一段文本按 YAML 规则解析成值（属性面板的输入框用）。 */
export function parseFrontMatterValue(raw: string): FrontMatterValue {
  return parseScalar(raw)
}
