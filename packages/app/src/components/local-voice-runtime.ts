export type LocalVoiceRuntimeEvent =
  | { type: "status"; status: string; device?: "webgpu" | "wasm"; progress?: number }
  | { type: "partial"; text: string }
  | { type: "final"; text: string }
  | { type: "level"; level: number }
  | { type: "error"; message: string }

export type LocalVoiceRuntimeOptions = {
  model: string
  language: string
  onEvent: (event: LocalVoiceRuntimeEvent) => void
  silenceStopMs?: number
}

/**
 * Browser-local Whisper runtime.
 * AudioWorklet produces 16 kHz mono PCM and a module worker owns model
 * loading/inference. Transformers.js uses the browser Cache API for ONNX
 * weights, tries WebGPU first, and falls back to WASM/CPU.
 */
export class LocalVoiceRuntime {
  private readonly options: LocalVoiceRuntimeOptions
  private stream?: MediaStream
  private context?: AudioContext
  private source?: MediaStreamAudioSourceNode
  private capture?: AudioWorkletNode
  private worker?: Worker
  private stopping = false
  private disposed = false
  private heardVoice = false
  private lastVoiceAt = 0
  private silenceTimer?: ReturnType<typeof setInterval>

  constructor(options: LocalVoiceRuntimeOptions) {
    this.options = options
  }

  async start() {
    this.heardVoice = false
    this.lastVoiceAt = 0
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined" || typeof Worker === "undefined") {
      throw new Error("当前浏览器不支持 AudioWorklet 本地语音运行时")
    }
    this.options.onEvent({ type: "status", status: "requesting-microphone" })
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    this.context = new AudioContext({ latencyHint: "interactive", sampleRate: 16_000 })
    await this.context.audioWorklet.addModule(new URL("./voice-capture.worklet.js", import.meta.url))
    if (this.stopping || this.disposed) {
      this.dispose()
      return
    }

    this.worker = new Worker(new URL("./voice-stt.worker.ts", import.meta.url), { type: "module" })
    this.worker.onmessage = (event: MessageEvent<LocalVoiceRuntimeEvent>) => {
      if (this.disposed) return
      this.options.onEvent(event.data)
      if (event.data.type === "final" || event.data.type === "error") this.dispose()
    }
    this.worker.postMessage({ type: "start", model: this.options.model, language: this.options.language })

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
        if (event.data.level >= 0.015) {
          this.heardVoice = true
          this.lastVoiceAt = performance.now()
        }
        this.options.onEvent(event.data)
        return
      }
      if (!this.worker) return
      this.worker.postMessage({ type: "audio", pcm: event.data.pcm }, [event.data.pcm])
    }
    this.source.connect(this.capture)
    const silence = this.context.createGain()
    silence.gain.value = 0
    this.capture.connect(silence)
    silence.connect(this.context.destination)
    await this.context.resume()
    const silenceStopMs = this.options.silenceStopMs
    if (silenceStopMs && silenceStopMs > 0) {
      this.silenceTimer = setInterval(() => {
        if (
          this.heardVoice &&
          performance.now() - this.lastVoiceAt >= silenceStopMs &&
          !this.stopping &&
          !this.disposed
        ) {
          this.stop()
        }
      }, 200)
    }
  }

  stop() {
    if (this.disposed || this.stopping) return
    this.stopping = true
    if (this.silenceTimer) clearInterval(this.silenceTimer)
    this.silenceTimer = undefined
    this.worker?.postMessage({ type: "stop" })
    this.source?.disconnect()
    this.capture?.disconnect()
    this.stream?.getTracks().forEach((track) => track.stop())
    void this.context?.close()
    this.source = undefined
    this.capture = undefined
    this.stream = undefined
    this.context = undefined
  }

  private dispose() {
    if (this.disposed) return
    this.disposed = true
    if (this.silenceTimer) clearInterval(this.silenceTimer)
    this.silenceTimer = undefined
    this.source?.disconnect()
    this.capture?.disconnect()
    this.stream?.getTracks().forEach((track) => track.stop())
    void this.context?.close()
    this.worker?.terminate()
    this.worker = undefined
    this.source = undefined
    this.capture = undefined
    this.stream = undefined
    this.context = undefined
  }
}
