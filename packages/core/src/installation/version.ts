declare global {
  const NovaWay_VERSION: string
  const NovaWay_CHANNEL: string
}

export const InstallationVersion = typeof NovaWay_VERSION === "string" ? NovaWay_VERSION : "local"
export const InstallationChannel = typeof NovaWay_CHANNEL === "string" ? NovaWay_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
