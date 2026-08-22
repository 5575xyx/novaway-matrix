export function displayModelName(name: string, providerID: string, free: boolean) {
  if (providerID !== "NovaWay" || !free) return name
  return name.replace(/\s+free(?=\s*\(|$)/i, "").trim()
}

export function displayModelGroup(providerID: string, providerName: string, defaultName: string) {
  if (providerID === "NovaWay") return defaultName
  return providerName
}
