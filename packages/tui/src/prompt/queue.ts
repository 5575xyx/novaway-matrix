import type { PromptInfo } from "./history"

/**
 * 排队中的草稿。当会话忙碌时，用户提交的提示不会直接发送到服务器，
 * 而是暂存在本地队列中，等会话空闲后按顺序自动发送。
 */
export type QueueDraft = {
  id: string
  sessionID: string
  agent: string
  model: { providerID: string; modelID: string; variant?: string }
  /** 已展开粘贴占位符后的纯文本 */
  inputText: string
  /** 非 text 部分（文件、智能体等） */
  nonTextParts: PromptInfo["parts"]
  /** 编辑器选区上下文（synthetic text part） */
  editorParts?: { type: "text"; text: string; synthetic: boolean; metadata: Record<string, unknown> }[]
}

let queueCounter = 0

/** 生成排队草稿的唯一 ID */
export function nextQueueId(): string {
  queueCounter += 1
  return `q_${Date.now().toString(36)}_${queueCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** 从草稿中提取首行非空文本作为预览 */
export function draftPreview(draft: QueueDraft, maxLength = 60): string {
  const text = draft.inputText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => !!line)
  if (!text) return "[附件]"
  return text.length > maxLength ? text.slice(0, maxLength - 1) + "…" : text
}
