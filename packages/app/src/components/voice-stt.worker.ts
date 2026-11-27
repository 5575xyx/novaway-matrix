import { env, pipeline } from "@huggingface/transformers"

type StartMessage = { type: "start"; model: string; language: string }
type AudioMessage = { type: "audio"; pcm: ArrayBuffer }
type StopMessage = { type: "stop" }
type WorkerMessage = StartMessage | AudioMessage | StopMessage

type WorkerEvent =
  | { type: "status"; status: string; device?: "webgpu" | "wasm"; progress?: number }
  | { type: "partial"; text: string }
  | { type: "final"; text: string }
  | { type: "error"; message: string }

type WorkerScope = {
  postMessage: (event: WorkerEvent) => void
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null
  navigator?: { gpu?: unknown }
}

const scope = globalThis as unknown as WorkerScope
env.allowLocalModels = false
env.useBrowserCache = true
env.useFSCache = false
if (env.backends.onnx?.wasm) {
  env.backends.onnx.wasm.wasmPaths = {
    mjs: new URL("../assets/transformers/ort-wasm-simd-threaded.jsep.mjs", import.meta.url),
    wasm: new URL("../assets/transformers/ort-wasm-simd-threaded.jsep.wasm", import.meta.url),
  }
}

type Transcriber = (audio: Float32Array, options: Record<string, unknown>) => Promise<unknown>
let transcriber: Transcriber | undefined
let selectedDevice: "webgpu" | "wasm" = "wasm"
let modelName = "Xenova/whisper-tiny"
let language = ""
let chunks: Float32Array[] = []
let partialInFlight: Promise<void> | undefined
let transcriberLoading: Promise<Transcriber> | undefined

const emit = (event: WorkerEvent) => scope.postMessage(event)

const hasWebGpu = async () => {
  const value = (scope as unknown as { navigator?: { gpu?: { requestAdapter?: () => Promise<unknown> } } }).navigator
  if (!value?.gpu?.requestAdapter) return false
  try {
    return Boolean(await value.gpu.requestAdapter())
  } catch {
    return false
  }
}

const loadTranscriber = async () => {
  if (transcriber) return transcriber
  if (transcriberLoading) return transcriberLoading
  transcriberLoading = (async () => {
    const preferred = (await hasWebGpu()) ? "webgpu" : "wasm"
    emit({ type: "status", status: "loading-model", device: preferred })
    try {
      transcriber = (await pipeline("automatic-speech-recognition", modelName, {
        device: preferred,
        dtype: preferred === "webgpu" ? "fp32" : "q8",
        progress_callback: (progress: unknown) =>
          emit({
            type: "status",
            status: "downloading-model",
            device: preferred,
            progress:
              typeof progress === "object" && progress !== null && "progress" in progress
                ? Number((progress as { progress?: unknown }).progress)
                : undefined,
          }),
      })) as unknown as Transcriber
      selectedDevice = preferred
    } catch (firstError) {
      if (preferred !== "webgpu") throw firstError
      emit({ type: "status", status: "gpu-fallback", device: "wasm" })
      transcriber = (await pipeline("automatic-speech-recognition", modelName, {
        device: "wasm",
        dtype: "q8",
        progress_callback: (progress: unknown) =>
          emit({
            type: "status",
            status: "downloading-model",
            device: "wasm",
            progress:
              typeof progress === "object" && progress !== null && "progress" in progress
                ? Number((progress as { progress?: unknown }).progress)
                : undefined,
          }),
      })) as unknown as Transcriber
      selectedDevice = "wasm"
    }
    emit({ type: "status", status: "ready", device: selectedDevice })
    return transcriber
  })()
  try {
    return await transcriberLoading
  } finally {
    transcriberLoading = undefined
  }
}

const mergePcm = () => {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0)
  const audio = new Float32Array(length)
  let offset = 0
  for (const chunk of chunks) {
    audio.set(chunk, offset)
    offset += chunk.length
  }
  return audio
}

const normalizeWhisperLanguage = (value: string) => {
  const normalized = value.trim().toLowerCase().replaceAll("_", "-")
  if (!normalized) return ""
  const aliases: Record<string, string> = {
    zh: "chinese",
    "zh-cn": "chinese",
    "zh-hans": "chinese",
    en: "english",
    "en-us": "english",
    "en-gb": "english",
    ja: "japanese",
    "ja-jp": "japanese",
    ko: "korean",
    "ko-kr": "korean",
  }
  return aliases[normalized] ?? normalized
}

const transcribeAudio = async (audio: Float32Array) => {
  const run = await loadTranscriber()
  const whisperLanguage = normalizeWhisperLanguage(language)
  const result = await run(audio, {
    return_timestamps: false,
    ...(whisperLanguage ? { language: whisperLanguage } : {}),
    task: "transcribe",
  })
  const text =
    typeof result === "string"
      ? result
      : typeof result === "object" && result !== null && "text" in result
        ? String((result as { text?: unknown }).text ?? "")
        : ""
  return text.trim()
}

const maybeTranscribePartial = () => {
  if (partialInFlight || chunks.reduce((total, chunk) => total + chunk.length, 0) < 24_000) return
  const audio = mergePcm()
  partialInFlight = transcribeAudio(audio)
    .then((text) => {
      if (text) emit({ type: "partial", text })
    })
    .finally(() => {
      partialInFlight = undefined
    })
}

scope.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  try {
    if (event.data.type === "start") {
      modelName = event.data.model.trim() || "Xenova/whisper-tiny"
      language = event.data.language.trim()
      chunks = []
      await loadTranscriber()
      return
    }
    if (event.data.type === "audio") {
      chunks.push(new Float32Array(event.data.pcm))
      maybeTranscribePartial()
      return
    }
    if (event.data.type === "stop") {
      if (partialInFlight) await partialInFlight
      const audio = mergePcm()
      chunks = []
      if (!audio.length) {
        emit({ type: "final", text: "" })
        return
      }
      emit({ type: "status", status: "transcribing", device: selectedDevice })
      emit({ type: "final", text: await transcribeAudio(audio) })
    }
  } catch (cause) {
    emit({ type: "error", message: cause instanceof Error ? cause.message : "本地模型转写失败" })
  }
}
