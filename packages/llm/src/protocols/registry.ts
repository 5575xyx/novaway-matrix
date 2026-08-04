import type { ImageGenerationProtocol } from "./image-generation"
import type { VideoGenerationProtocol } from "./video-generation"

const imageProtocols: Map<string, ImageGenerationProtocol> = new Map()
const videoProtocols: Map<string, VideoGenerationProtocol> = new Map()

function protocolByBaseURL(
  protocols: Map<string, ImageGenerationProtocol>,
  baseURL: string,
): ImageGenerationProtocol | undefined {
  let host: string
  try {
    host = new URL(baseURL).hostname.toLowerCase()
  } catch {
    return undefined
  }
  return Array.from(protocols.values()).find((protocol) => {
    try {
      return new URL(protocol.baseURL).hostname.toLowerCase() === host
    } catch {
      return false
    }
  })
}

export const registerImageProtocol = (providerId: string, protocol: ImageGenerationProtocol): void => {
  imageProtocols.set(providerId, protocol)
}

export const registerVideoProtocol = (providerId: string, protocol: VideoGenerationProtocol): void => {
  videoProtocols.set(providerId, protocol)
}

export const getImageProtocol = (providerId: string, baseURL?: string): ImageGenerationProtocol | undefined => {
  const protocol = (baseURL ? protocolByBaseURL(imageProtocols, baseURL) : undefined) ?? imageProtocols.get(providerId)
  if (!protocol) return undefined
  if (baseURL) {
    return { ...protocol, baseURL }
  }
  return protocol
}

export const getVideoProtocol = (providerId: string, baseURL?: string): VideoGenerationProtocol | undefined => {
  const protocol = videoProtocols.get(providerId)
  if (!protocol) return undefined
  if (baseURL) {
    return { ...protocol, baseURL }
  }
  return protocol
}

export const listImageProviders = (): string[] => Array.from(imageProtocols.keys())

export const listVideoProviders = (): string[] => Array.from(videoProtocols.keys())
