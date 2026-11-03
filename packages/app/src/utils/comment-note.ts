import type { FileSelection } from "@/context/file"

export type PromptComment = {
  path: string
  selection?: FileSelection
  comment: string
  preview?: string
  origin?: "review" | "file"
}

function selection(selection: unknown) {
  if (!selection || typeof selection !== "object") return undefined
  const startLine = Number((selection as FileSelection).startLine)
  const startChar = Number((selection as FileSelection).startChar)
  const endLine = Number((selection as FileSelection).endLine)
  const endChar = Number((selection as FileSelection).endChar)
  if (![startLine, startChar, endLine, endChar].every(Number.isFinite)) return undefined
  return {
    startLine,
    startChar,
    endLine,
    endChar,
  } satisfies FileSelection
}

export function createCommentMetadata(input: PromptComment) {
  return {
    NovaWayComment: {
      path: input.path,
      selection: input.selection,
      comment: input.comment,
      preview: input.preview,
      origin: input.origin,
    },
  }
}

export function readCommentMetadata(value: unknown) {
  if (!value || typeof value !== "object") return
  const meta = (value as { NovaWayComment?: unknown }).NovaWayComment
  if (!meta || typeof meta !== "object") return
  const path = (meta as { path?: unknown }).path
  const comment = (meta as { comment?: unknown }).comment
  if (typeof path !== "string" || typeof comment !== "string") return
  const preview = (meta as { preview?: unknown }).preview
  const origin = (meta as { origin?: unknown }).origin
  return {
    path,
    selection: selection((meta as { selection?: unknown }).selection),
    comment,
    preview: typeof preview === "string" ? preview : undefined,
    origin: origin === "review" || origin === "file" ? origin : undefined,
  } satisfies PromptComment
}

/**
 * 卡片/气泡上展示的一句话摘要。
 *
 * 「选元素」类备注（预览里点 DOM、PPT 里点形状）的正文是拼出来的：
 * `用户对「div.user-card」的修改要求：` + 用户那句话 + 一大段元素细节
 * （CSS 路径、计算样式、源码）。整段铺在聊天区就是三大列源码墙，所以这里
 * 只留用户自己写的那句；细节仍然完整发给模型，只是不展示。
 *
 * 普通行级评论没有这层包装，原样返回。
 */
export function commentSummary(comment: string) {
  const text = comment.replace(/\r\n?/g, "\n").trim()
  // 锚点里可能还嵌套「」（`针对「第 5 页 · 形状「标题」」的修改要求：`），
  // 用非贪婪匹配 + 回溯定位到最后一个收尾括号。
  const heading = text.match(/^(?:用户对|针对)「[\s\S]*?」的修改要求[：:]\s*\n?/)
  if (heading) {
    const rest = text.slice(heading[0].length)
    // 用户那句话和元素细节之间空一行；只有用户那句话时才取第一段。
    return (rest.split(/\n\s*\n/)[0] ?? "").trim()
  }
  // 用户没写评论、只点了元素：正文全是"下面是我在预览里选中的元素"，展示出来只是噪音。
  if (text.startsWith("下面是我在预览里选中的元素")) return ""
  return text
}

export function formatCommentNote(input: { path: string; selection?: FileSelection; comment: string }) {
  const start = input.selection ? Math.min(input.selection.startLine, input.selection.endLine) : undefined
  const end = input.selection ? Math.max(input.selection.startLine, input.selection.endLine) : undefined
  const range =
    start === undefined || end === undefined
      ? "this file"
      : start === end
        ? `line ${start}`
        : `lines ${start} through ${end}`
  return `The user made the following comment regarding ${range} of ${input.path}: ${input.comment}`
}

export function parseCommentNote(text: string) {
  const match = text.match(
    /^The user made the following comment regarding (this file|line (\d+)|lines (\d+) through (\d+)) of (.+?): ([\s\S]+)$/,
  )
  if (!match) return
  const start = match[2] ? Number(match[2]) : match[3] ? Number(match[3]) : undefined
  const end = match[2] ? Number(match[2]) : match[4] ? Number(match[4]) : undefined
  return {
    path: match[5],
    selection:
      start !== undefined && end !== undefined
        ? {
            startLine: start,
            startChar: 0,
            endLine: end,
            endChar: 0,
          }
        : undefined,
    comment: match[6],
  } satisfies PromptComment
}
