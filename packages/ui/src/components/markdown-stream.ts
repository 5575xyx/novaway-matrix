import { marked, type Tokens } from "marked"
import remend from "remend"

export type Block = {
  raw: string
  src: string
  mode: "full" | "live"
}

function refs(text: string) {
  return /^\[[^\]]+\]:\s+\S+/m.test(text) || /^\[\^[^\]]+\]:\s+/m.test(text)
}

function open(raw: string) {
  const match = raw.match(/^[ \t]{0,3}(`{3,}|~{3,})/)
  if (!match) return false
  const mark = match[1]
  if (!mark) return false
  const char = mark[0]
  const size = mark.length
  const last = raw.trimEnd().split("\n").at(-1)?.trim() ?? ""
  return !new RegExp(`^[\\t ]{0,3}${char}{${size},}[\\t ]*$`).test(last)
}

function heal(text: string) {
  return remend(text, { linkMode: "text-only" })
}

const markdownSyntax = /[`*_~\[\]!<>|#]|(?:^|\n)[ \t]{0,3}(?:>|[-+*][ \t]|\d+[.)][ \t]|[-=*_]{3,}[ \t]*$)/m
const automaticLink = /\b(?:[a-z][\w+.-]*:\/\/|www\.)\S+|\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/i

export function plainParagraphText(text: string): string | undefined {
  const content = text.replace(/\r?\n[ \t]*\r?\n+$/, "")
  if (
    !content ||
    content !== content.trim() ||
    markdownSyntax.test(content) ||
    /\\/.test(content) ||
    / {2,}\r?\n/.test(content) ||
    /&(?:#\d+|#x[\da-f]+|[a-z][a-z\d]+);/i.test(content) ||
    automaticLink.test(content)
  ) return undefined
  return content
}

function plainParagraphs(text: string): Block[] | undefined {
  const separators = [...text.matchAll(/\r?\n[ \t]*\r?\n+/g)]
  if (separators.length === 0) return undefined

  const blocks: Block[] = []
  let start = 0
  for (const separator of separators) {
    const end = separator.index! + separator[0].length
    const raw = text.slice(start, end)
    if (!plainParagraphText(raw)) return undefined
    blocks.push({ raw, src: raw, mode: "full" })
    start = end
  }

  const tail = text.slice(start)
  if (tail && !plainParagraphText(tail)) return undefined
  blocks.push({ raw: tail, src: heal(tail), mode: "live" })
  return blocks
}

export function stream(text: string, live: boolean) {
  if (!live) return [{ raw: text, src: text, mode: "full" }] satisfies Block[]
  if (refs(text)) return [{ raw: text, src: heal(text), mode: "live" }] satisfies Block[]
  // Ordinary prose cannot contain fenced code without a backtick or tilde. Skip
  // allocating a line array and scanning every line on the common streaming path.
  if (!/[`~]/.test(text)) {
    const paragraphs = plainParagraphs(text)
    if (paragraphs) return paragraphs
    if (plainParagraphText(text) !== undefined) return [{ raw: text, src: text, mode: "live" }] satisfies Block[]
    return [{ raw: text, src: heal(text), mode: "live" }] satisfies Block[]
  }
  // Check fenced code by line boundaries, matching Markdown's optional indentation
  // and closing marker before using the specialized code-block path.
  const lines = text.split("\n")
  let opening: { index: number; marker: string } | undefined
  for (let index = 0; index < lines.length; index++) {
    const match = /^[ 	]{0,3}(`{3,}|~{3,})(.*)$/.exec(lines[index]!)
    if (!opening) {
      if (match) opening = { index, marker: match[1]! }
      continue
    }
    const mark = opening.marker[0]!
    const size = opening.marker.length
    if (new RegExp(`^[ 	]{0,3}${mark}{${size},}[ 	]*$`).test(lines[index]!)) opening = undefined
  }
  if (!opening) {
    const paragraphs = plainParagraphs(text)
    if (paragraphs) return paragraphs
    return [{ raw: text, src: heal(text), mode: "live" }] satisfies Block[]
  }
  const src = heal(text)
  const tokens = marked.lexer(text)
  const tail = tokens.findLastIndex((token) => token.type !== "space")
  if (tail < 0) return [{ raw: text, src, mode: "live" }] satisfies Block[]
  const last = tokens[tail]
  if (!last || last.type !== "code") return [{ raw: text, src, mode: "live" }] satisfies Block[]
  const code = last as Tokens.Code
  if (!open(code.raw)) return [{ raw: text, src, mode: "live" }] satisfies Block[]
  const head = tokens
    .slice(0, tail)
    .map((token) => token.raw)
    .join("")
  if (!head) return [{ raw: code.raw, src: code.raw, mode: "live" }] satisfies Block[]
  return [
    { raw: head, src: heal(head), mode: "live" },
    { raw: code.raw, src: code.raw, mode: "live" },
  ] satisfies Block[]
}

function escapeHTML(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/** Render only text that is proven to have no Markdown or autolink syntax. */
export type PlainStreamingRender = {
  html: string
  paragraphCount: number
  tailText: string
  sourceText: string
  stableHtml: string
}

const paragraphMarkup = (text: string) => (text ? `<p>${escapeHTML(text)}</p>\n` : "")

export function plainStreamingRender(
  text: string,
  previous?: PlainStreamingRender,
): PlainStreamingRender | undefined {
  if (
    previous &&
    text.length >= previous.sourceText.length &&
    text.startsWith(previous.sourceText) &&
    !/(?:\r?\n[ \t]*\r?\n+)$/.test(previous.sourceText)
  ) {
    const addition = text.slice(previous.sourceText.length)
    if (!/(?:\r?\n[ \t]*\r?\n+)/.test(addition)) {
      const tailText = previous.tailText + addition
      if (plainParagraphText(tailText) !== undefined) {
        return {
          html: previous.stableHtml + paragraphMarkup(tailText),
          paragraphCount: previous.paragraphCount,
          tailText,
          sourceText: text,
          stableHtml: previous.stableHtml,
        }
      }
      return undefined
    }
  }

  const blocks = plainParagraphs(text)
  const paragraphs: string[] = []
  if (blocks) {
    for (const block of blocks) {
      const plain = block.raw.replace(/\r?\n[ \t]*\r?\n+$/, "")
      if (plain) paragraphs.push(plain)
    }
  } else {
    const plain = plainParagraphText(text)
    if (plain === undefined) return undefined
    paragraphs.push(plain)
  }
  const stableParagraphs = paragraphs.slice(0, -1)
  const stableHtml = stableParagraphs.map(paragraphMarkup).join("")
  const tailText = paragraphs.at(-1) ?? ""
  return {
    html: stableHtml + paragraphMarkup(tailText),
    paragraphCount: paragraphs.length,
    tailText,
    sourceText: text,
    stableHtml,
  }
}
