import { preloadVoiceModel } from "./voice-model-runtime"

export type VoiceModel = {
  id: string
  label: string
  description: string
  size: string
  quality: string
  languages: string
}

export const VOICE_MODELS: readonly VoiceModel[] = [
  {
    id: "Xenova/whisper-tiny",
    label: "Whisper Tiny",
    description: "下载最小，适合首次测试和低配置电脑。",
    size: "约 46 MB",
    quality: "一般",
    languages: "多语言",
  },
  {
    id: "Xenova/whisper-small",
    label: "Whisper Small",
    description: "识别质量更好，下载和运行占用更多资源。",
    size: "约 466 MB",
    quality: "良好",
    languages: "多语言",
  },
  {
    id: "onnx-community/whisper-large-v3-turbo",
    label: "Whisper Large v3 Turbo",
    description: "识别质量更高，适合配置较好的电脑；首次下载较大。",
    size: "约 900 MB",
    quality: "很好",
    languages: "多语言",
  },
] as const

const STORAGE_PREFIX = "novaway.voice.model.ready."

export function voiceModelReady(id: string) {
  try {
    return globalThis.localStorage?.getItem(STORAGE_PREFIX + id) === "1"
  } catch {
    return false
  }
}

export function markVoiceModelReady(id: string) {
  try {
    globalThis.localStorage?.setItem(STORAGE_PREFIX + id, "1")
  } catch {
    // Browser storage may be disabled; the Transformers cache still works.
  }
}

export type VoiceModelDownloadStatus = {
  state: "idle" | "downloading" | "ready" | "error"
  type: "status" | "error"
  status?: string
  progress?: number
  device?: "webgpu" | "wasm" | "native-gpu"
  message?: string
}

export async function downloadVoiceModel(id: string, onProgress: (status: VoiceModelDownloadStatus) => void) {
  onProgress({ state: "downloading", type: "status", status: "loading-model" })
  try {
    await preloadVoiceModel(id, (event) =>
      onProgress({
        state: event.type === "status" && event.status === "ready" ? "ready" : "downloading",
        ...event,
      }),
    )
    markVoiceModelReady(id)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "模型下载失败"
    onProgress({ state: "error", type: "error", message })
    throw cause
  }
}
