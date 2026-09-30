export function isAutoModel(providerID: string, modelID: string): boolean {
  return providerID === "builtin" && modelID === "auto"
}

export function firstSelectableModel(
  provider: { id: string; models: Record<string, { id: string }> },
  defaults: Record<string, string | undefined>,
  isValid: (modelID: string) => boolean,
): string | undefined {
  const preferred = defaults[provider.id]
  if (preferred && !isAutoModel(provider.id, preferred) && isValid(preferred)) return preferred
  return Object.keys(provider.models).find((id) => !isAutoModel(provider.id, id) && isValid(id))
}

export function orderFallbackProviders<T extends { id: string }>(providers: T[]): T[] {
  return [...providers].sort((a, b) => Number(a.id === "builtin") - Number(b.id === "builtin"))
}

export function stripProviderPrefix(name: string, providerIDs: ReadonlySet<string>): string {
  const index = name.indexOf(":")
  if (index <= 0) return name
  const prefix = name.slice(0, index)
  if (!providerIDs.has(prefix)) return name
  return name.slice(index + 1).trim()
}
