/**
 * 脚注与 Callout：把 Markdown 编辑器「插入工具」写出来的语法真正渲染出来。
 *
 * marked 原生不认 `[^1]` 和 `> [!note] 标题`：前者会原样显示成方括号，
 * 后者只是一个普通引用块。插入工具既然能生成这两种语法，渲染侧就都应有对应样式，
 * 这里用一个 marked 扩展补齐（tokenizer 级处理，代码块里的同形文本不受影响）：
 *   - `[^label]` → 上标序号；`[^label]: 正文` → 文末脚注列表；
 *   - `> [!kind] 标题` → 带类型色的 Callout 卡片。
 *
 * 放在独立模块里是为了能单测：`marked.tsx` 会连带加载 shiki / katex。
 */
import type { MarkedExtension } from "marked"

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/** Callout 的固定形状：插入工具生成的就是「第一行 [!kind] 标题」的引用块。 */
const CALLOUT = /<blockquote>\s*<p>\[!([A-Za-z-]+)\][ \t]*([^<\n]*)(?:\n)?([\s\S]*?)<\/p>\s*<\/blockquote>/g

export function markdownNotes(): MarkedExtension {
  const defs = new Map<string, string>()
  let refs: string[] = []

  return {
    extensions: [
      {
        name: "footnoteRef",
        level: "inline",
        start(src: string) {
          return src.indexOf("[^")
        },
        tokenizer(src: string) {
          const match = /^\[\^([^\]\s]+)\]/.exec(src)
          if (!match) return undefined
          return { type: "footnoteRef", raw: match[0], label: match[1]! }
        },
        renderer(token) {
          const label = String((token as { label?: unknown }).label ?? "")
          refs.push(label)
          const number = refs.length
          return (
            '<sup class="md-footnote-ref"><a href="#fn-' +
            number +
            '" id="fnref-' +
            number +
            '">' +
            String(number) +
            "</a></sup>"
          )
        },
      },
      {
        name: "footnoteDef",
        level: "block",
        start(src: string) {
          const index = src.search(/^\[\^[^\]\s]+\]:/m)
          return index === -1 ? undefined : index
        },
        tokenizer(src: string) {
          const match = /^\[\^([^\]\s]+)\]:[ \t]*([^\n]*)(?:\n|$)/.exec(src)
          if (!match) return undefined
          defs.set(match[1]!, match[2]!.trim())
          return { type: "footnoteDef", raw: match[0] }
        },
        renderer() {
          return ""
        },
      },
    ],
    hooks: {
      preprocess(markdown: string) {
        defs.clear()
        refs = []
        return markdown
      },
      postprocess(html: string) {
        const withCallouts = html.replace(CALLOUT, (_whole: string, kind: string, title: string, body: string) => {
          const label = title.trim()
          const text = body.trim()
          const head = label ? '<div class="md-callout-title">' + label + "</div>" : ""
          return (
            '<div class="md-callout md-callout-' +
            kind.toLowerCase() +
            '">' +
            head +
            (text ? "<p>" + text + "</p>" : "") +
            "</div>"
          )
        })
        if (refs.length === 0) return withCallouts
        const items = refs.map((label, index) => {
          const text = defs.get(label) ?? ""
          return (
            '<li id="fn-' +
            String(index + 1) +
            '">' +
            escapeHtml(text) +
            ' <a href="#fnref-' +
            String(index + 1) +
            '" class="md-footnote-back">↩</a></li>'
          )
        })
        return withCallouts + '<section class="md-footnotes"><ol>' + items.join("") + "</ol></section>"
      },
    },
  }
}

/**
 * `[[wikilink]]`：和 Obsidian 一样渲染成可点的内部链接。
 *
 * 只负责「长什么样、点了要哪个目标」；解析成真实路径由调用方做
 * （`resolveNotePath` 在 core 里，UI 层不该知道工作区目录结构）。
 */
export function markdownWikiLinks(): MarkedExtension {
  return {
    extensions: [
      {
        name: "wikilink",
        level: "inline",
        start(src: string) {
          return src.indexOf("[[")
        },
        tokenizer(src: string) {
          const match = /^\[\[([^[\]\n]+)\]\]/.exec(src)
          if (!match) return undefined
          const body = match[1]!
          const pipe = body.indexOf("|")
          const target = (pipe === -1 ? body : body.slice(0, pipe)).trim()
          const alias = pipe === -1 ? undefined : body.slice(pipe + 1).trim()
          if (!target) return undefined
          return { type: "wikilink", raw: match[0], target, alias }
        },
        renderer(token) {
          const value = token as { target?: string; alias?: string }
          const target = escapeHtml(value.target ?? "")
          const label = escapeHtml(value.alias || value.target || "")
          return (
            '<a class="md-wikilink" data-wikilink="' +
            target +
            '" href="#wikilink-' +
            target +
            '" title="' +
            target +
            '">' +
            label +
            "</a>"
          )
        },
      },
    ],
  }
}
