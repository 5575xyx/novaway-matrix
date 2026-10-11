export const formatRelativeTime = (
  ts: number | undefined,
  now: number,
  t: (key: string, params?: Record<string, string | number>) => string,
): string => {
  if (!ts || ts > now) return ""
  const diffMs = now - ts
  if (diffMs < 60_000) return t("time.now", { count: 0 })
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 60) return t("time.minute", { count: Math.max(1, minutes) })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t("time.hour", { count: Math.max(1, hours) })
  const days = Math.floor(hours / 24)
  if (days < 7) return t("time.day", { count: Math.max(1, days) })
  const weeks = Math.floor(days / 7)
  return t("time.week", { count: Math.max(1, weeks) })
}
