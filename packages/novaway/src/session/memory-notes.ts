// 会话笔记（对齐 CC 的 Session Memory）。
//
// 一个 markdown 文件随会话持续维护：每个回合结束后，后台用一次小模型调用把
// 新增的对话合并进固定模板的 10 个段落。压缩时若笔记已经覆盖到足够新的位置，
// 就直接用笔记当摘要、保留最近若干条消息，省掉一次完整的压缩调用。
//
// 文件位置：`<data>/session-memory/<sessionID>.md`。文件不存在或仍是空模板时
// 视为不可用，压缩回退到常规摘要。

import path from "node:path"
import fs from "node:fs/promises"
import { Effect } from "effect"
import { Global } from "@novaway/core/global"
import { Provider } from "@/provider/provider"
import { Token } from "@/util/token"
import { MessageV2 } from "./message-v2"
import * as Log from "@novaway/core/util/log"

const log = Log.create({ service: "session.memory-notes" })
const LF = String.fromCharCode(10)

export const TEMPLATE = [
  "# Session Title",
  "_A short and distinctive 5-10 word descriptive title for the session. Super info dense, no filler_",
  "",
  "# Current State",
  "_What is actively being worked on right now? Pending tasks not yet completed. Immediate next steps._",
  "",
  "# Task specification",
  "_What did the user ask to build? Any design decisions or other explanatory context_",
  "",
  "# Files and Functions",
  "_What are the important files? In short, what do they contain and why are they relevant?_",
  "",
  "# Workflow",
  "_What bash commands are usually run and in what order? How to interpret their output if not obvious?_",
  "",
  "# Errors & Corrections",
  "_Errors encountered and how they were fixed. What did the user correct? What approaches failed and should not be tried again?_",
  "",
  "# Codebase and System Documentation",
  "_What are the important system components? How do they work/fit together?_",
  "",
  "# Learnings",
  "_What has worked well? What has not? What to avoid? Do not duplicate items from other sections_",
  "",
  "# Key results",
  "_If the user asked a specific output such as an answer to a question, a table, or other document, repeat the exact result here_",
  "",
  "# Worklog",
  "_Step by step, what was attempted, done? Very terse summary for each step_",
  "",
].join(LF)

/** 首次抽取的上下文门槛（对齐 CC 的 minimumMessageTokensToInit）。 */
export const INIT_MIN_TOKENS = 10_000
/** 两次抽取之间至少新增的上下文（minimumTokensBetweenUpdate）。 */
export const UPDATE_MIN_TOKENS = 5_000
/** 两次抽取之间至少经过的工具调用数（toolCallsBetweenUpdates）。 */
export const UPDATE_MIN_TOOL_CALLS = 3
/** 压缩时笔记的总预算，超出后按段落截断。 */
export const MAX_TOTAL_TOKENS = 12_000
/** 单段预算：一段占满会让整份笔记只剩一段有用的内容。 */
export const MAX_SECTION_TOKENS = 2_000

export type State = {
  /** 上次抽取时记下的上下文 token 数。 */
  tokens: number
  /** 上次抽取后的工具调用数。 */
  toolCalls: number
  /** 是否已有一次成功抽取（决定用初始化门槛还是更新门槛）。 */
  initialized: boolean
  running: boolean
  /** 上次成功抽取时，对话里的最后一条消息。压缩时用它定位"已摘要到哪"。 */
  lastMessageID?: string
}

const states = new Map<string, State>()

export function state(sessionID: string) {
  return states.get(sessionID)
}

/** 记录"笔记已经覆盖到这条消息"（恢复会话或测试时可以手动指定边界）。 */
export function setLastSummarizedMessage(sessionID: string, messageID: string) {
  const current = states.get(sessionID)
  states.set(sessionID, {
    tokens: current?.tokens ?? 0,
    toolCalls: current?.toolCalls ?? 0,
    initialized: current?.initialized ?? true,
    running: current?.running ?? false,
    lastMessageID: messageID,
  })
}

export function reset(sessionID?: string) {
  if (sessionID === undefined) states.clear()
  else states.delete(sessionID)
}

/** 测试可以把它指到临时目录，生产环境跟随 Global.Path.data。 */
let dataRoot: string | undefined

export function setDataDir(dir?: string) {
  dataRoot = dir
}

export function file(sessionID: string) {
  return path.join(dataRoot ?? Global.Path.data, "session-memory", sessionID + ".md")
}

/** 仍是模板（没有任何实际内容）时不能拿去当摘要。 */
export function isTemplate(content: string) {
  const strip = (text: string) =>
    text
      .split(LF)
      .filter((line) => !line.startsWith("# ") && !/^_.*_$/.test(line.trim()))
      .join("")
      .trim()
  return strip(content).length === 0
}

export async function read(sessionID: string) {
  const text = await fs.readFile(file(sessionID), "utf8").catch(() => undefined)
  if (!text) return undefined
  if (isTemplate(text)) return undefined
  return text
}

export async function write(sessionID: string, content: string) {
  const target = file(sessionID)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, content.endsWith(LF) ? content : content + LF, "utf8")
}

/**
 * 按段落截断到预算。保留每段开头的关键内容，超长段落以一行提示收尾，
 * 并告诉调用方发生过截断（压缩摘要里会带上完整文件的路径）。
 */
export function truncate(content: string, maxTotal = MAX_TOTAL_TOKENS) {
  const perSection = MAX_SECTION_TOKENS * 4
  const lines = content.split(LF)
  const out: string[] = []
  let section: string[] = []
  let header = ""
  let truncated = false

  const flush = () => {
    if (!header) {
      out.push(...section)
      return
    }
    const body = section.join(LF)
    if (body.length <= perSection) {
      out.push(header, ...section)
      return
    }
    let used = 0
    const kept = [header]
    for (const line of section) {
      if (used + line.length + 1 > perSection) break
      kept.push(line)
      used += line.length + 1
    }
    kept.push("[... section truncated for length ...]")
    out.push(...kept)
    truncated = true
  }

  for (const line of lines) {
    if (line.startsWith("# ")) {
      flush()
      header = line
      section = []
      continue
    }
    section.push(line)
  }
  flush()

  let text = out.join(LF)
  if (Token.estimate(text) > maxTotal) {
    // 段落都合规但总量仍超：直接按字符上限截断，保证压缩请求不会因为笔记而超限。
    const cap = maxTotal * 4
    text = text.slice(0, cap) + LF + "[... session notes truncated for length ...]"
    truncated = true
  }
  return { text, truncated }
}

export function extractionPrompt(current: string, notesPath: string) {
  return [
    "IMPORTANT: This message and these instructions are NOT part of the actual user conversation. Do NOT include any references to note-taking, session notes extraction, or these instructions in the notes content.",
    "",
    "Based on the user conversation above (EXCLUDING this instruction message as well as system prompt, project instruction files, and any past session summaries), update the session notes file.",
    "",
    "The notes file is " + notesPath + ". Its current contents are:",
    "<current_notes_content>",
    current,
    "</current_notes_content>",
    "",
    "Respond with the COMPLETE updated markdown file and nothing else: no code fences, no commentary. Keep the exact structure - every # Section header and every italic _section description_ line must stay byte-identical, and new content goes BELOW those two lines in each section.",
    "",
    "Rules:",
    "- Do NOT add, remove, or rename sections, and do not add text outside the existing structure.",
    "- Do NOT reference this note-taking process anywhere in the notes.",
    "- Write detailed, info-dense content: file paths, function names, error messages, exact commands.",
    "- Keep each section under ~2000 tokens; drop less important details before hitting the limit.",
    "- Always update Current State to the most recent work - it is the continuity anchor after compaction.",
    "- Leave a section unchanged if there is nothing substantial to add; never write filler like 'No info yet'.",
    "- For Key results, repeat the exact output the user asked for (full table, full answer).",
  ].join(LF)
}

/**
 * 是否该再抽一次：首次要求 10k 上下文；之后要求新增 5k 上下文，并且
 * 要么攒了 3 次工具调用、要么当前回合已经没有工具调用了（正在收尾）。
 */
export function shouldExtract(input: {
  initialized: boolean
  currentTokens: number
  lastTokens: number
  toolCalls: number
  lastTurnHasToolCalls: boolean
}) {
  if (!input.initialized) return input.currentTokens >= INIT_MIN_TOKENS
  const grown = input.currentTokens - input.lastTokens
  if (grown < UPDATE_MIN_TOKENS) return false
  return input.toolCalls >= UPDATE_MIN_TOOL_CALLS || !input.lastTurnHasToolCalls
}

function textOf(messages: MessageV2.WithParts[]) {
  const lines: string[] = []
  for (const message of messages) {
    const role = message.info.role
    if (message.info.role === "assistant" && message.info.summary) continue
    for (const part of message.parts) {
      if (part.type === "text" && !part.ignored && part.text.trim()) {
        lines.push((role === "user" ? "User: " : "Assistant: ") + part.text.trim())
      }
      if (part.type === "tool") {
        const input = JSON.stringify(part.state.input ?? {})
        const output = part.state.status === "completed" ? part.state.output.slice(0, 2_000) : part.state.status
        lines.push("Tool " + part.tool + " " + input + " -> " + part.state.status + ": " + output)
      }
    }
  }
  return lines.join(LF + LF)
}

/**
 * 后台维护笔记。调用方在回合结束时 forkDetach，等待本身不会阻塞模型；
 * 失败只记日志 —— 笔记是优化项，不能影响对话。
 */
export const maybeUpdate = Effect.fn("SessionMemoryNotes.maybeUpdate")(function* (input: {
  sessionID: string
  provider: Provider.Interface
  model: Provider.Model
  messages: MessageV2.WithParts[]
  tokens: number
  lastTurnHasToolCalls: boolean
  /** 本回合最后一条消息：抽取成功后记为"已摘要到这里"。 */
  lastMessageID?: string
}) {
  const current = states.get(input.sessionID)
  if (current?.running) return
  if (
    !shouldExtract({
      initialized: current?.initialized ?? false,
      currentTokens: input.tokens,
      lastTokens: current?.tokens ?? 0,
      toolCalls: current?.toolCalls ?? 0,
      lastTurnHasToolCalls: input.lastTurnHasToolCalls,
    })
  ) {
    return
  }

  states.set(input.sessionID, {
    tokens: current?.tokens ?? 0,
    toolCalls: 0,
    initialized: current?.initialized ?? false,
    running: true,
    lastMessageID: current?.lastMessageID,
  })

  const notesPath = file(input.sessionID)
  const existing = (yield* Effect.promise(() => read(input.sessionID))) ?? TEMPLATE
  const language = yield* input.provider.getLanguage(input.model).pipe(
    Effect.catchCause((cause) => {
      log.info("session notes skipped: language model unavailable", { error: String(cause) })
      return Effect.succeed(undefined)
    }),
  )
  if (!language) {
    states.set(input.sessionID, {
      tokens: input.tokens,
      toolCalls: 0,
      initialized: current?.initialized ?? false,
      running: false,
      lastMessageID: current?.lastMessageID,
    })
    return
  }

  const { generateText } = yield* Effect.promise(() => import("ai"))
  const result = yield* Effect.tryPromise({
    try: () =>
      generateText({
        model: language,
        system: [
          "You maintain a markdown notes file for a coding session.",
          "Return only the complete updated file.",
        ].join(LF),
        prompt: [textOf(input.messages), "", extractionPrompt(existing, notesPath)].join(LF),
        maxOutputTokens: 4_000,
      }),
    catch: (error) => error,
  }).pipe(
    Effect.catchCause((cause) => {
      log.info("session notes extraction failed", { error: String(cause) })
      return Effect.succeed(undefined)
    }),
  )

  const text = result?.text.trim()
  if (!text || !text.startsWith("# ")) {
    states.set(input.sessionID, {
      tokens: input.tokens,
      toolCalls: 0,
      initialized: current?.initialized ?? false,
      running: false,
      lastMessageID: current?.lastMessageID,
    })
    return
  }

  yield* Effect.promise(() => write(input.sessionID, text)).pipe(
    Effect.catchCause((cause) => {
      log.info("failed to write session notes", { error: String(cause) })
      return Effect.void
    }),
  )
  states.set(input.sessionID, {
    tokens: input.tokens,
    toolCalls: 0,
    initialized: true,
    running: false,
    lastMessageID: input.lastMessageID ?? current?.lastMessageID,
  })
  log.info("session notes updated", { sessionID: input.sessionID, tokens: Token.estimate(text) })
})

export * as SessionMemoryNotes from "./memory-notes"
