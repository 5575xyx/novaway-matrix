import { createHash } from "node:crypto"
import { createReadStream, createWriteStream, existsSync } from "node:fs"
import { mkdir, rename, rm, stat } from "node:fs/promises"
import { pipeline as streamPipeline } from "node:stream/promises"
import { resolve } from "node:path"
import * as TranscribeCpp from "transcribe-cpp"

export type NativeSpeechModelId =
  | "whisper-tiny"
  | "whisper-large-v3-turbo"
  | "sense-voice-zh-en-ja-ko-yue"
  | "nemotron-3.5-asr-streaming-0.6b"
  | "parakeet-tdt-0.6b-v3-int8"

export type NativeSpeechModel = {
  id: NativeSpeechModelId
  label: string
  family: "whisper" | "sensevoice" | "nemotron" | "parakeet"
  languages: readonly string[]
  sizeBytes: number
  fileName: string
  downloadUrl: string
  sha256?: string
}

/** Native GGUF models used by the desktop runtime. URLs and hashes are pinned in the download layer. */
export const NATIVE_SPEECH_MODELS: readonly NativeSpeechModel[] = [
  {
    id: "whisper-tiny",
    label: "Whisper Tiny",
    family: "whisper",
    languages: ["multilingual"],
    sizeBytes: 45_981_088,
    fileName: "whisper-tiny-Q8_0.gguf",
    downloadUrl:
      "https://huggingface.co/handy-computer/whisper-tiny-gguf/resolve/6687f30c99641ee265df421e582354adbc8848fc/whisper-tiny-Q8_0.gguf?download=true",
    sha256: "325b9c7997cd1eff81ef709d55766565e71be696130cc3a3d444713798706834",
  },
  {
    id: "whisper-large-v3-turbo",
    label: "Whisper Large v3 Turbo",
    family: "whisper",
    languages: ["multilingual"],
    sizeBytes: 886_381_760,
    fileName: "whisper-large-v3-turbo-Q8_0.gguf",
    downloadUrl:
      "https://huggingface.co/handy-computer/whisper-large-v3-turbo-gguf/resolve/5eaf945c7978e564bae5b28a5b1639dd93c2bfb1/whisper-large-v3-turbo-Q8_0.gguf?download=true",
    sha256: "b2e30cc286bc9f3aba4db9099fc7403543497c05ce7100d0d83091ddfd25a183",
  },
  {
    id: "sense-voice-zh-en-ja-ko-yue",
    label: "SenseVoice",
    family: "sensevoice",
    languages: ["zh", "yue", "en", "ja", "ko"],
    sizeBytes: 252_684_608,
    fileName: "SenseVoiceSmall-Q8_0.gguf",
    downloadUrl:
      "https://huggingface.co/handy-computer/SenseVoiceSmall-gguf/resolve/4a08b8e900b38a977e32eb08d5d0697d6e72ba04/SenseVoiceSmall-Q8_0.gguf?download=true",
    sha256: "6c759ee4c9748c9b3f7a5a60ca74f0f7e685fb9d45d1378fce7cfd62f59adf29",
  },
  {
    id: "nemotron-3.5-asr-streaming-0.6b",
    label: "Nemotron 3.5",
    family: "nemotron",
    languages: ["multilingual"],
    sizeBytes: 751_094_240,
    fileName: "nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf",
    downloadUrl:
      "https://huggingface.co/handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf/resolve/main/nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf?download=true",
  },
  {
    id: "parakeet-tdt-0.6b-v3-int8",
    label: "Parakeet TDT v3",
    family: "parakeet",
    languages: ["multilingual"],
    sizeBytes: 739_508_576,
    fileName: "parakeet-tdt-0.6b-v3-Q8_0.gguf",
    downloadUrl:
      "https://huggingface.co/handy-computer/parakeet-tdt-0.6b-v3-gguf/resolve/main/parakeet-tdt-0.6b-v3-Q8_0.gguf?download=true",
  },
]

export type NativeSpeechModelState = NativeSpeechModel & {
  path: string
  downloaded: boolean
  bytes: number
}

export function normalizeNativeSpeechLanguage(model: NativeSpeechModel, language?: string) {
  const value = language?.trim().replaceAll("_", "-").toLowerCase()
  if (!value) return undefined

  if (model.family === "whisper") {
    const aliases: Record<string, string> = {
      zh: "zh",
      "zh-cn": "zh",
      "zh-hans": "zh",
      chinese: "zh",
      en: "en",
      english: "en",
      "en-us": "en",
      "en-gb": "en",
      ja: "ja",
      japanese: "ja",
      "ja-jp": "ja",
      ko: "ko",
      korean: "ko",
      "ko-kr": "ko",
    }
    return aliases[value] ?? value
  }

  if (model.family === "sensevoice") {
    if (value.startsWith("zh")) return "zh"
    if (value.startsWith("yue")) return "yue"
    if (value.startsWith("en")) return "en"
    if (value.startsWith("ja")) return "ja"
    if (value.startsWith("ko")) return "ko"
    return value
  }

  if (model.family === "nemotron") {
    if (value === "en" || value.startsWith("en-")) return "en-US"
    if (value === "zh" || value.startsWith("zh-")) return "zh-CN"
    return language?.trim()
  }

  return language?.trim()
}


export function getNativeSpeechModel(id: NativeSpeechModelId) {
  const model = NATIVE_SPEECH_MODELS.find((item) => item.id === id)
  if (!model) throw new Error(`未知语音模型: ${id}`)
  return model
}

export async function getNativeSpeechModelStates(root: string): Promise<readonly NativeSpeechModelState[]> {
  return Promise.all(
    NATIVE_SPEECH_MODELS.map(async (model) => {
      const path = resolve(root, model.fileName)
      try {
        const info = await stat(path)
        return { ...model, path, downloaded: info.size === model.sizeBytes, bytes: info.size }
      } catch {
        return { ...model, path, downloaded: false, bytes: 0 }
      }
    }),
  )
}

export async function downloadNativeSpeechModel(
  root: string,
  id: NativeSpeechModelId,
  onProgress?: (progress: number) => void,
) {
  const model = getNativeSpeechModel(id)
  const destination = resolve(root, model.fileName)
  const partial = `${destination}.partial`
  await mkdir(root, { recursive: true })
  try {
    const existing = await stat(destination)
    if (existing.size === model.sizeBytes) return destination
    await rm(destination, { force: true })
  } catch {
    // The model has not been downloaded yet.
  }
  const endpoints = [
    process.env.NOVAWAY_HF_ENDPOINT?.replace(/\/$/, ""),
    "https://huggingface.co",
    "https://hf-mirror.com",
  ].filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)
  let response: Response | undefined
  let lastError = "未知网络错误"
  for (const endpoint of endpoints) {
    const url = model.downloadUrl.replace("https://huggingface.co", endpoint)
    try {
      const candidate = await fetch(url)
      if (candidate.ok && candidate.body) {
        response = candidate
        break
      }
      lastError = `HTTP ${candidate.status}`
    } catch (cause) {
      lastError = cause instanceof Error ? cause.message : String(cause)
    }
  }
  if (!response?.body)
    throw new Error(`语音模型下载失败：${lastError}。可设置 NOVAWAY_HF_ENDPOINT 使用镜像。`)
  const total = Number(response.headers.get("content-length")) || model.sizeBytes
  let received = 0
  const body = response.body as unknown as AsyncIterable<Uint8Array>
  const monitored = (async function* () {
    for await (const chunk of body) {
      received += chunk.byteLength
      onProgress?.(Math.min(100, (received / total) * 100))
      yield chunk
    }
  })()
  await streamPipeline(monitored, createWriteStream(partial))
  if (model.sha256) {
    const hash = createHash("sha256")
    await streamPipeline(createReadStream(partial), hash)
    if (hash.digest("hex") !== model.sha256) {
      await rm(partial, { force: true })
      throw new Error(`语音模型校验失败: ${model.label}`)
    }
  }
  await rename(partial, destination)
  return destination
}


export type NativeSpeechBackend = Awaited<ReturnType<typeof TranscribeCpp.getAvailableBackendsAsync>>[number]

export async function getNativeSpeechBackends(): Promise<readonly NativeSpeechBackend[]> {
  await TranscribeCpp.initialize()
  return TranscribeCpp.getAvailableBackendsAsync()
}

export class NativeSpeechSession {
  private model?: TranscribeCpp.TranscribeModel
  private session?: TranscribeCpp.Session
  private stream?: TranscribeCpp.Stream
  private loadedPath?: string

  async load(modelPath: string) {
    const absolutePath = resolve(modelPath)
    if (!existsSync(absolutePath)) throw new Error(`语音模型不存在: ${absolutePath}`)
    if (this.loadedPath === absolutePath && this.model && this.session) {
      return { device: this.model.device, capabilities: this.model.capabilities }
    }
    await TranscribeCpp.initialize()
    this.stream?.reset()
    this.stream = undefined
    this.session?.dispose()
    this.model?.dispose()
    this.model = await TranscribeCpp.TranscribeModel.load(absolutePath)
    this.session = this.model.createSession({ nThreads: 8 })
    this.loadedPath = absolutePath
    return { device: this.model.device, capabilities: this.model.capabilities }
  }

  async transcribe(pcm: Float32Array, language?: string) {
    if (!this.session) throw new Error("语音模型尚未加载")
    const result = await this.session.run(pcm, {
      timestamps: "none",
      ...(language ? { language } : {}),
    })
    return result.text.trim()
  }

  async startStream(language?: string) {
    if (!this.session || !this.model) throw new Error("语音模型尚未加载")
    if (!this.model.capabilities.supportsStreaming) {
      return {
        streaming: false,
        device: this.model.device,
        capabilities: this.model.capabilities,
      }
    }
    this.stream?.reset()
    this.stream = await this.session.stream({
      timestamps: "none",
      commitPolicy: "stable_prefix",
      ...(language ? { language } : {}),
    })
    return {
      streaming: true,
      device: this.model.device,
      capabilities: this.model.capabilities,
    }
  }

  async feedStream(pcm: Float32Array) {
    if (!this.stream) throw new Error("Native 语音流尚未启动")
    await this.stream.feed(pcm)
    const text = this.stream.text
    return {
      full: text.full.trim(),
      committed: text.committed.trim(),
      tentative: text.tentative.trim(),
    }
  }

  async finalizeStream() {
    if (!this.stream) throw new Error("Native 语音流尚未启动")
    await this.stream.finalize()
    const text = this.stream.text
    this.stream.reset()
    this.stream = undefined
    return {
      text: text.full.trim(),
      committed: text.committed.trim(),
      tentative: text.tentative.trim(),
    }
  }

  resetStream() {
    this.stream?.reset()
    this.stream = undefined
  }

  dispose() {
    this.stream?.reset()
    this.stream = undefined
    this.session?.dispose()
    this.model?.dispose()
    this.session = undefined
    this.model = undefined
    this.loadedPath = undefined
  }
}
