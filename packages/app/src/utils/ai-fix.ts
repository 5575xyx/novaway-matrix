/**
 * 「让 AI 帮我装 / 帮我修」的上下文拼装。
 *
 * 各个能力（OCR、本地向量模型、语言工具链……）把自己的状态、失败原因和日志
 * 交给这段逻辑，统一截断后再作为 prompt 的背景信息交给 Agent。
 * 日志只保留尾部，避免把几 MB 的 pip / winget 输出塞进上下文。
 */

export type AiFixContext = {
  /** 当前状态的一句话描述（例如「未检测到 Ollama」）。 */
  status?: string
  error?: string
  hint?: string
  /** 原始日志，自动截断到尾部。 */
  log?: string
  /** 额外事实，按「- key: value」逐行列出。 */
  facts?: Record<string, string | number | boolean | null | undefined>
}

export type AiFixLabels = {
  status: (value: string) => string
  error: (value: string) => string
  hint: (value: string) => string
  log: string
  fact: (key: string, value: string) => string
}

export const AI_FIX_LOG_LIMIT = 2000

type Translate = (key: string, params?: Record<string, string | number>) => string

/** 各能力共用的标签；避免每个调用点重复写一遍翻译键。 */
export function aiFixLabels(t: Translate): AiFixLabels {
  return {
    status: (value) => t("aiFix.context.status", { value }),
    error: (value) => t("aiFix.context.error", { value }),
    hint: (value) => t("aiFix.context.hint", { value }),
    log: t("aiFix.context.log"),
    fact: (key, value) => "- " + key + ": " + value,
  }
}

/** 日志尾部截断：从换行处开始，避免把一行 pip 输出切成两半。 */
export function tailLog(log: string, limit = AI_FIX_LOG_LIMIT) {
  if (log.length <= limit) return log
  const tail = log.slice(-limit)
  const newline = tail.indexOf(String.fromCharCode(10))
  return newline === -1 ? tail : tail.slice(newline + 1)
}

/** 拼出交给 AI 的上下文块；没有任何信息时返回空串。 */
export function buildAiFixDetails(context: AiFixContext, labels: AiFixLabels, limit = AI_FIX_LOG_LIMIT) {
  const parts: string[] = []
  if (context.status?.trim()) parts.push(labels.status(context.status.trim()))
  if (context.error?.trim()) parts.push(labels.error(context.error.trim()))
  if (context.hint?.trim()) parts.push(labels.hint(context.hint.trim()))
  for (const [key, value] of Object.entries(context.facts ?? {})) {
    if (value === undefined || value === null || String(value).trim() === "") continue
    parts.push(labels.fact(key, String(value)))
  }
  const log = context.log ? tailLog(context.log, limit) : ""
  if (log.trim()) parts.push(labels.log + String.fromCharCode(10) + log)
  return parts.join(String.fromCharCode(10))
}

/** 部分环境变量/路径里带反斜杠，prompt 里统一换成斜杠更好读。 */
export function normalizePathForPrompt(value: string) {
  return value.replace(/\\/g, "/")
}
