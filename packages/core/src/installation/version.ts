declare global {
  const NOVAWAY_VERSION: string
  const NOVAWAY_CHANNEL: string
}

export const InstallationVersion = typeof NOVAWAY_VERSION === "string" ? NOVAWAY_VERSION : "local"
export const InstallationChannel = typeof NOVAWAY_CHANNEL === "string" ? NOVAWAY_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
