/** 事实键：用于冲突检测、替代与确认，而非仅追加 */
export function normalizeFactKey(input?: string) {
  const raw = (input ?? "").trim().toLowerCase()
  if (!raw) return undefined
  const cleaned = raw
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[“”"']/g, "")
    .replace(/[:：,，.。!！?？;；]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (!cleaned) return undefined
  return cleaned.slice(0, 120)
}

/** 从内容自动派生稳定事实键（同义改写时尽量收敛） */
export function deriveFactKey(content: string, explicit?: string) {
  const fromExplicit = normalizeFactKey(explicit)
  if (fromExplicit) return fromExplicit

  const text = content.trim()
  if (!text) return undefined

  // 常见“X 使用/改为 Y”模式：package manager / language preference 等
  const patterns = [
    /(?:使用|改用|切换到|采用|默认)\s*([A-Za-z0-9._+-]+)/i,
    /(?:prefer|use|switch to|default to)\s+([A-Za-z0-9._+-]+)/i,
    /(?:偏好|习惯|喜欢)\s*(.+)$/i,
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[0]) {
      const key = normalizeFactKey(match[0])
      if (key) return key
    }
  }
  return normalizeFactKey(text.slice(0, 80))
}

export type MemoryOperation = "add" | "update" | "archive" | "confirm"

export function resolveMemoryOperation(input?: string): MemoryOperation {
  if (input === "update" || input === "archive" || input === "confirm" || input === "add") return input
  return "add"
}
