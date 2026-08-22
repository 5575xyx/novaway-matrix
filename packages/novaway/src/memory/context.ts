import type { ModelMessage } from "ai"

const contextBlock = /<\s*memory-context\s*>[\s\S]*?<\s*\/\s*memory-context\s*>/gi
const contextTag = /<\/?\s*memory-context\s*>/gi
const systemNote = /\[System note:\s*The following is[\s\S]*?\]\s*/gi

export function sanitizeMemoryContext(text: string) {
  return text.replace(contextBlock, "").replace(systemNote, "").replace(contextTag, "").trim()
}

export function buildMemoryContextBlock(raw: string) {
  const clean = sanitizeMemoryContext(raw)
  if (!clean) return ""
  return [
    "<memory-context>",
    "[System note: The following is a compact MEMORY INDEX (ids + short summaries), NOT new user input. Use it as reference. Prefer these facts when relevant. If you need full text or more memories, call the memory tool (search/read by id). Do not dump unrelated memories into the reply.]",
    "",
    clean,
    "</memory-context>",
  ].join("\n")
}

export function injectMemoryContext(input: { messages: ModelMessage[]; context: string }) {
  const block = buildMemoryContextBlock(input.context)
  if (!block) return input.messages

  const index = input.messages.findLastIndex((message) => message.role === "user")
  if (index === -1) return input.messages
  if (typeof input.messages[index]?.content !== "string") return input.messages

  return input.messages.map((message, current) => {
    if (current !== index) return message
    return { ...message, content: `${message.content}\n\n${block}` }
  }) as ModelMessage[]
}

export * as MemoryContext from "./context"
