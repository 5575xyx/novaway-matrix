export type NativeVoiceRuntimeEvent =
  | { type: "status"; status: string; device?: string }
  | { type: "partial"; text: string }
  | { type: "level"; level: number }
  | { type: "final"; text: string }
  | { type: "error"; message: string }

export type NativeVoiceRuntimeOptions = {
  model: string
  language: string
  onEvent: (event: NativeVoiceRuntimeEvent) => void
  silenceStopMs?: number
}

const MODEL_ALIASES: Record<string, string> = {
  "Xenova/whisper-tiny": "whisper-tiny",
  "Xenova/whisper-small": "whisper-tiny",
  "onnx-community/whisper-large-v3-turbo": "whisper-large-v3-turbo",
}

const NATIVE_MODEL_IDS = new Set([
  "whisper-tiny",
  "whisper-large-v3-turbo",
  "sense-voice-zh-en-ja-ko-yue",
  "nemotron-3.5-asr-streaming-0.6b",
  "parakeet-tdt-0.6b-v3-int8",
])

export function isNativeSpeechModel(value: string) {
  return NATIVE_MODEL_IDS.has(value)
}

export function nativeSpeechModelId(value: string) {
  return MODEL_ALIASES[value] ?? value
}

export class NativeVoiceRuntime {
  private readonly options: NativeVoiceRuntimeOptions
  private context?: AudioContext
  private stream?: MediaStream
  private source?: MediaStreamAudioSourceNode
  private capture?: AudioWorkletNode
  private silenceTimer?: ReturnType<typeof setInterval>
  private feedQueue: Promise<void> = Promise.resolve()
  private streamStarted = false
  private nativeStreaming = false
  private chunks: Float32Array[] = []
  private partialInFlight = false
  private lastPartialSamples = 0
  private heardVoice = false
  private lastVoiceAt = 0
  private stopping = false
  private disposed = false

  constructor(options: NativeVoiceRuntimeOptions) {
    this.options = options
  }

  async start() {
    const api = window.api
    if (!api?.startNativeSpeechStream || !api.feedNativeSpeechStream || !api.stopNativeSpeechStream) {
      throw new Error("当前桌面端没有 Native 实时语音运行时")
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined") {
      throw new Error("当前浏览器不支持麦克风采集")
    }
    this.options.onEvent({ type: "status", status: "requesting-microphone" })
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    this.context = new AudioContext({ latencyHint: "interactive", sampleRate: 16_000 })
    await this.context.audioWorklet.addModule(new URL("./voice-capture.worklet.js", import.meta.url))

    const modelId = nativeSpeechModelId(this.options.model)
    const started = await api.startNativeSpeechStream(modelId, this.options.language)
    if (this.stopping || this.disposed) {
      this.dispose()
      return
    }
    this.streamStarted = true
    this.nativeStreaming = started.streaming
    this.source = this.context.createMediaStreamSource(this.stream)
    this.capture = new AudioWorkletNode(this.context, "novaway-voice-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: "explicit",
      channelInterpretation: "speakers",
    })
    this.capture.port.onmessage = (
      event: MessageEvent<{ type: "audio"; pcm: ArrayBuffer } | { type: "level"; level: number }>,
    ) => {
      if (event.data.type === "level") {
        this.options.onEvent(event.data)
        if (event.data.level >= 0.015) {
          this.heardVoice = true
          this.lastVoiceAt = performance.now()
        }
        return
      }
      const pcm = new Float32Array(event.data.pcm)
      if (!this.nativeStreaming) {
        this.chunks.push(pcm)
        this.scheduleFallbackPartial(modelId, api)
        return
      }
      this.feedQueue = this.feedQueue
        .then(async () => {
          if (this.stopping || this.disposed || !this.streamStarted) return
          const update = await api.feedNativeSpeechStream!(modelId, pcm)
          if (!this.stopping && !this.disposed && update.full) {
            this.options.onEvent({ type: "partial", text: update.full })
          }
        })
        .catch((cause) => {
          this.fail(cause instanceof Error ? cause.message : "Native 实时语音转写失败")
        })
    }
    this.source.connect(this.capture)
    const silence = this.context.createGain()
    silence.gain.value = 0
    this.capture.connect(silence)
    silence.connect(this.context.destination)
    await this.context.resume()
    const silenceStopMs = this.options.silenceStopMs ?? 1800
    this.silenceTimer = setInterval(() => {
      if (this.heardVoice && performance.now() - this.lastVoiceAt >= silenceStopMs) this.stop()
    }, 200)
    this.options.onEvent({ type: "status", status: "recording", device: started.device.name })
  }

  stop() {
    if (this.stopping || this.disposed) return
    this.stopping = true
    if (this.silenceTimer) clearInterval(this.silenceTimer)
    this.silenceTimer = undefined
    this.source?.disconnect()
    this.capture?.disconnect()
    this.stream?.getTracks().forEach((track) => track.stop())
    void this.context?.close()
    void this.finishStream()
  }

  private scheduleFallbackPartial(
    modelId: string,
    api: NonNullable<typeof window.api>,
  ) {
    const samples = this.chunks.reduce((total, chunk) => total + chunk.length, 0)
    if (this.partialInFlight || samples < 24_000 || samples - this.lastPartialSamples < 24_000) return
    this.lastPartialSamples = samples
    this.partialInFlight = true
    const audio = this.merge()
    this.feedQueue = this.feedQueue
      .then(async () => {
        if (this.stopping || this.disposed || !api.transcribeNativeSpeech) return
        const result = await api.transcribeNativeSpeech(modelId, audio, this.options.language)
        if (!this.stopping && !this.disposed && result.text) {
          this.options.onEvent({ type: "partial", text: result.text })
        }
      })
      .catch((cause) => {
        this.fail(cause instanceof Error ? cause.message : "Native 实时语音转写失败")
      })
      .finally(() => {
        this.partialInFlight = false
      })
  }

  private merge() {
    const length = this.chunks.reduce((total, chunk) => total + chunk.length, 0)
    const audio = new Float32Array(length)
    let offset = 0
    for (const chunk of this.chunks) {
      audio.set(chunk, offset)
      offset += chunk.length
    }
    return audio
  }

  private async finishStream() {
    const api = window.api
    try {
      if (!api) throw new Error("Native 语音接口不可用")
      await this.feedQueue
      if (!this.streamStarted) {
        this.finish("")
        return
      }
      this.options.onEvent({ type: "status", status: "transcribing" })
      if (!this.nativeStreaming) {
        if (!api.transcribeNativeSpeech) throw new Error("Native 语音转写接口不可用")
        const result = await api.transcribeNativeSpeech(
          nativeSpeechModelId(this.options.model),
          this.merge(),
          this.options.language,
        )
        this.streamStarted = false
        this.finish(result.text)
        return
      }
      if (!api.stopNativeSpeechStream) throw new Error("Native 实时语音接口不可用")
      const result = await api.stopNativeSpeechStream(nativeSpeechModelId(this.options.model))
      this.streamStarted = false
      this.finish(result.text)
    } catch (cause) {
      this.fail(cause instanceof Error ? cause.message : "Native 实时语音转写失败")
    }
  }

  private finish(text: string) {
    if (this.disposed) return
    this.disposed = true
    this.options.onEvent({ type: "final", text })
    this.cleanup()
  }

  private fail(message: string) {
    if (this.disposed) return
    this.disposed = true
    this.options.onEvent({ type: "error", message })
    this.cleanup()
  }

  private cleanup() {
    if (this.silenceTimer) clearInterval(this.silenceTimer)
    this.silenceTimer = undefined
    this.source?.disconnect()
    this.capture?.disconnect()
    this.stream?.getTracks().forEach((track) => track.stop())
    void this.context?.close()
    this.streamStarted = false
    this.nativeStreaming = false
    this.chunks = []
    this.partialInFlight = false
    this.lastPartialSamples = 0
    this.source = undefined
    this.capture = undefined
    this.stream = undefined
    this.context = undefined
  }

  private dispose() {
    if (this.disposed) return
    this.disposed = true
    this.cleanup()
  }
}
