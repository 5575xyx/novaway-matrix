export function displayModelName(name: string, providerID: string, free: boolean) {
  if (providerID !== "opencode" || !free) return name
  return name.replace(/\s+free(?=\s*\(|$)/i, "").trim()
}

export function displayModelGroup(providerID: string, providerName: string, defaultName: string) {
  if (providerID === "opencode") return defaultName
  return providerName
}
