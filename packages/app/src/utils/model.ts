export function isAutoModel(providerID: string, modelID: string): boolean {
  return providerID === "builtin" && modelID === "auto"
}
