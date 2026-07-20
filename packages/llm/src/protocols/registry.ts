import type { ImageGenerationProtocol } from "./image-generation"
import type { VideoGenerationProtocol } from "./video-generation"

const imageProtocols: Map<string, ImageGenerationProtocol> = new Map()
const videoProtocols: Map<string, VideoGenerationProtocol> = new Map()

export const registerImageProtocol = (providerId: string, protocol: ImageGenerationProtocol): void => {
  imageProtocols.set(providerId, protocol)
}

export const registerVideoProtocol = (providerId: string, protocol: VideoGenerationProtocol): void => {
  videoProtocols.set(providerId, protocol)
}

export const getImageProtocol = (providerId: string, baseURL?: string): ImageGenerationProtocol | undefined => {
  const protocol = imageProtocols.get(providerId)
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
