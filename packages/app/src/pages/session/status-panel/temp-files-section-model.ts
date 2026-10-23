import type { SessionTempFile } from "@novaway/sdk/v2"

const num = (input: unknown): number => {
  if (typeof input === "number" && Number.isFinite(input)) return input
  const parsed = Number(input)
  return Number.isFinite(parsed) ? parsed : 0
}

export type TempFilesSectionModel = {
  count: number
  /** 总字节数 */
  size: number
  files: SessionTempFile[]
}

export function buildTempFilesModel(files: readonly SessionTempFile[] | undefined): TempFilesSectionModel | null {
  if (!files || files.length === 0) return null
  return {
    count: files.length,
    size: files.reduce((sum, file) => sum + num(file.size), 0),
    files: files.slice().sort((a, b) => num(b.createdAt) - num(a.createdAt)),
  }
}

export function formatBytes(input: unknown) {
  const bytes = num(input)
  if (bytes < 1024) return bytes + " B"
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB"
  return (bytes / 1024 / 1024).toFixed(1) + " MB"
}

export function cleanSummary(result: { removed: readonly string[]; skipped: readonly { reason: string }[] }) {
  const reasons = new Map<string, number>()
  for (const item of result.skipped) reasons.set(item.reason, (reasons.get(item.reason) ?? 0) + 1)
  return {
    removed: result.removed.length,
    skipped: result.skipped.length,
    reasons: Array.from(reasons.entries()),
  }
}
