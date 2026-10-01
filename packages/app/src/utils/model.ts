export function isAutoModel(providerID: string, modelID: string): boolean {
  return providerID === "builtin" && modelID === "auto"
}

export function configuredModel(
  configModel: string | undefined,
  isValid: (model: { providerID: string; modelID: string }) => boolean,
): { providerID: string; modelID: string } | undefined {
  if (!configModel) return
  const [providerID, modelID] = configModel.split("/")
  // Auto 关闭后 config.model 写死的 builtin/auto 不再生效(仓库默认配置就是它)
  if (isAutoModel(providerID, modelID)) return
  const model = { providerID, modelID }
  if (isValid(model)) return model
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
