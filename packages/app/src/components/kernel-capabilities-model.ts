import type { KernelCapabilities, KernelFeature } from "@novaway/sdk/v2"

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0)

export type Capability = KernelCapabilities
export type Feature = KernelFeature

/** Stable display order so the card does not reshuffle between reloads. */
export const FEATURE_ORDER = [
  "permission_mode",
  "tool_result_budget",
  "defer_loading",
  "background_subagents",
  "teams",
  "auto_delegate",
  "plan_approval",
  "async_sources",
] as const

export function orderFeatures(features: readonly Feature[]): Feature[] {
  return [...features].toSorted((a, b) => {
    const ai = FEATURE_ORDER.indexOf(a.id as never)
    const bi = FEATURE_ORDER.indexOf(b.id as never)
    if (ai === -1 && bi === -1) return a.id.localeCompare(b.id)
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })
}

/**
 * Title for a feature. Unknown ids fall back to the raw id so a newer kernel
 * still renders in an older UI instead of showing blank rows.
 */
export function featureLabel(id: string, t: (key: string) => string): string {
  const key = `settings.kernel.feature.${id}`
  const label = t(key)
  return label === key ? id : label
}

/** `12` → "12", `60000` → "60k" — budget values are unreadable raw. */
export function featureDetail(feature: Feature): string | undefined {
  if (!feature.detail) return undefined
  if (feature.id === "tool_result_budget") {
    const value = Number(feature.detail)
    if (Number.isFinite(value) && value >= 1_000) return `${Math.round(value / 1_000)}k`
  }
  return feature.detail
}

export type Summary = {
  version: string
  tools: string
  skills: string
  hooks: string
  extensions: string
}

export function summarize(caps: Capability, t: (key: string, vars?: Record<string, unknown>) => string): Summary {
  const deferred = num(caps.tools.deferred)
  return {
    version: caps.version,
    tools:
      deferred > 0
        ? t("settings.kernel.toolsDeferred", { count: num(caps.tools.total), deferred })
        : t("settings.kernel.tools", { count: num(caps.tools.total) }),
    skills: t("settings.kernel.skills", { count: num(caps.skills) }),
    hooks:
      num(caps.hooks.registrations) > 0
        ? t("settings.kernel.hooks", { count: num(caps.hooks.registrations), events: num(caps.hooks.events) })
        : t("settings.kernel.hooksNone"),
    extensions: t("settings.kernel.extensions", {
      count: num(caps.extensions.total),
      enabled: num(caps.extensions.enabled),
      contributions: num(caps.extensions.contributions),
    }),
  }
}

/** Enabled/total pairs where "0" is meaningful (no hooks is a valid state). */
export function activeFeatures(features: readonly Feature[]): Feature[] {
  return orderFeatures(features).filter((item) => item.enabled)
}
