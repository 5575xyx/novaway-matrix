export function isAutoModel(providerID: string, modelID: string): boolean {
  return providerID === "builtin" && modelID === "auto"
}

export function firstSelectableModel(
  provider: { id: string; models: Record<string, { id: string }> },
  defaults: Record<string, string | undefined>,
  isValid: (modelID: string) => boolean,
) {
  const preferred = defaults[provider.id]
  if (preferred && !isAutoModel(provider.id, preferred) && isValid(preferred)) return preferred
  return Object.keys(provider.models).find((id) => !isAutoModel(provider.id, id) && isValid(id))
}
