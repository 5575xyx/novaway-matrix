import { FREE_PROVIDER_NATURE } from "@novaway/core/free-provider-policy"
import { popularProviders } from "@/hooks/use-providers"

export type ProviderGroup = "free" | "popular" | "other" | "custom"

export function providerGroup(providerID: string, customID?: string): ProviderGroup {
  if (customID !== undefined && providerID === customID) return "custom"
  if (providerID in FREE_PROVIDER_NATURE) return "free"
  if (popularProviders.includes(providerID)) return "popular"
  return "other"
}

export function providerGroupOrder(group: ProviderGroup): number {
  if (group === "custom") return -1
  if (group === "free") return 0
  if (group === "popular") return 1
  return 2
}
