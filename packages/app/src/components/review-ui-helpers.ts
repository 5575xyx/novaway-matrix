export function finiteNumber(value: number | string | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

export function pendingBadgeLabel(value: number | string | undefined) {
  const count = finiteNumber(value)
  if (count > 99) return "99+"
  return String(count)
}
