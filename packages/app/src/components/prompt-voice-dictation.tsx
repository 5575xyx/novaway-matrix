import { createEffect, createMemo, createSignal, onCleanup, Show, type Component } from "solid-js"
import { Button } from "@novaway/ui/button"
import { Icon } from "@novaway/ui/icon"
import { getSpeechRecognitionCtor } from "@/utils/runtime-adapters"
import { LocalVoiceRuntime } from "./local-voice-runtime"
import { NativeVoiceRuntime, isNativeSpeechModel, nativeSpeechModelId } from "./native-voice-runtime"
import { markVoiceModelReady, voiceModelReady } from "./voice-models"

interface SpeechResult {
  isFinal: boolean
  [index: number]: { transcript: string }
  length: number
}

interface SpeechRecognitionEventLike {
  resultIndex: number
  results: { [index: number]: SpeechResult; length: number }
}

interface RecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onend: (() => void) | null
  onerror: ((event: { error?: string }) => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

export type VoiceDictationMode = "toggle" | "hold"
export type VoiceDictationEngine = "browser" | "local"

export const PromptVoiceDictation: Component<{
  enabled: boolean
  language: string
  mode: VoiceDictationMode
  engine: VoiceDictationEngine
  endpoint: string
  model: string
  onText: (text: string) => void
}> = (props) => {
  const [listening, setListening] = createSignal(false)
  const [interim, setInterim] = createSignal("")
  const [error, setError] = createSignal<string | undefined>()
  const [micLevel, setMicLevel] = createSignal(0)
  const recognition = { current: undefined as RecognitionLike | undefined }
  let wantsListening = false
  let restartTimer: ReturnType<typeof setTimeout> | undefined
  let localRecorder: MediaRecorder | undefined
  let localStream: MediaStream | undefined
  let localChunks: Blob[] = []
  let localRuntime: LocalVoiceRuntime | undefined
  let nativeRuntime: NativeVoiceRuntime | undefined
  const ctor = createMemo(() => getSpeechRecognitionCtor<RecognitionLike>(globalThis))
  const embeddedSupported = createMemo(
    () =>
      props.engine === "local" &&
      typeof AudioContext !== "undefined" &&
      typeof AudioWorkletNode !== "undefined" &&
      typeof Worker !== "undefined" &&
      Boolean(navigator.mediaDevices?.getUserMedia),
  )
  const serviceSupported = createMemo(
    () =>
      props.engine === "local" &&
      Boolean(props.endpoint.trim()) &&
      typeof MediaRecorder !== "undefined" &&
      Boolean(navigator.mediaDevices?.getUserMedia),
  )
  const nativeModelSelected = createMemo(
    () => props.engine === "local" && !props.endpoint.trim() && isNativeSpeechModel(props.model),
  )
  const nativeSupported = createMemo(
    () =>
      nativeModelSelected() &&
      Boolean(window.api?.transcribeNativeSpeech) &&
      typeof AudioContext !== "undefined" &&
      typeof AudioWorkletNode !== "undefined" &&
      Boolean(navigator.mediaDevices?.getUserMedia),
  )
  const localSupported = createMemo(() =>
    nativeModelSelected() ? nativeSupported() : embeddedSupported() || serviceSupported(),
  )
  const unsupported = createMemo(() => (props.engine === "local" ? !localSupported() : !ctor()))

  const cleanupLocal = () => {
    localStream?.getTracks().forEach((track) => track.stop())
    localStream = undefined
    localRecorder = undefined
    localChunks = []
  }

  const transcribeLocal = async (blob: Blob) => {
    const form = new FormData()
    form.append("file", blob, "novaway-voice.webm")
    form.append("model", props.model || "whisper-1")
    form.append("language", props.language || "")
    const response = await fetch(props.endpoint, { method: "POST", body: form })
    if (!response.ok) throw new Error(`本地语音服务返回 HTTP ${response.status}`)
    const data = (await response.json()) as { text?: string; transcript?: string }
    const text = (data.text ?? data.transcript ?? "").trim()
    if (text) props.onText(text)
  }

  const stopLocal = () => {
    wantsListening = false
    setListening(false)
    setInterim("")
    const recorder = localRecorder
    if (!recorder || recorder.state === "inactive") {
      cleanupLocal()
      return
    }
    recorder.stop()
  }

  const startNative = async () => {
    if (!props.enabled || listening() || nativeRuntime || !nativeSupported()) return
    setError(undefined)
    setInterim("正在准备 Native 语音…")
    wantsListening = true
    const runtime = new NativeVoiceRuntime({
      model: props.model,
      language: props.language || "",
      silenceStopMs: 1800,
      onEvent: (event) => {
        if (event.type === "status") {
          setInterim(event.status === "transcribing" ? "正在转写…" : event.status === "recording" ? "正在听写…" : "")
        } else if (event.type === "partial") {
          setInterim(event.text)
        } else if (event.type === "level") {
          setMicLevel(Math.min(1, event.level * 12))
        } else if (event.type === "final") {
          nativeRuntime = undefined
          setListening(false)
          setMicLevel(0)
          setInterim("")
          if (event.text) props.onText(event.text)
        } else {
          nativeRuntime = undefined
          setListening(false)
          setMicLevel(0)
          setInterim("")
          setError(event.message)
        }
      },
    })
    nativeRuntime = runtime
    try {
      await runtime.start()
      if (wantsListening) setListening(true)
    } catch (cause) {
      runtime.stop()
      nativeRuntime = undefined
      wantsListening = false
      setInterim("")
      setError(cause instanceof Error ? cause.message : "无法启动 Native 语音运行时")
    }
  }

  const startEmbedded = async () => {
    if (!props.enabled || listening() || localRuntime || !embeddedSupported()) return
    setError(undefined)
    const embeddedModel = props.model.trim() || "Xenova/whisper-tiny"
    const modelWasCached = voiceModelReady(embeddedModel)
    setInterim(modelWasCached ? "正在加载已缓存模型…" : "正在准备本地模型…")
    wantsListening = true
    const runtime = new LocalVoiceRuntime({
      model: embeddedModel,
      language: props.language,
      silenceStopMs: 1800,
      onEvent: (event) => {
        if (event.type === "status") {
          if (event.status === "ready") {
            // The first successful runtime load also proves that the model is
            // available in the browser cache, even when the user skipped the
            // explicit model-download button in Settings.
            markVoiceModelReady(embeddedModel)
          }
          setInterim(
            event.status === "loading-model"
              ? modelWasCached
                ? "正在加载已缓存模型…"
                : "正在准备本地模型…"
              : event.status === "downloading-model"
                ? modelWasCached
                  ? "正在加载已缓存模型…"
                  : `正在下载模型${typeof event.progress === "number" ? ` ${Math.round(event.progress)}%` : "…"}`
                : event.status === "gpu-fallback"
                  ? "GPU 不可用，切换 CPU…"
                  : event.status === "transcribing"
                    ? "正在转写…"
                    : "",
          )
        } else if (event.type === "partial") {
          setInterim(event.text)
        } else if (event.type === "final") {
          localRuntime = undefined
          setListening(false)
          setMicLevel(0)
          setInterim("")
          if (event.text) props.onText(event.text)
        } else if (event.type === "level") {
          setMicLevel(Math.min(1, event.level * 12))
        } else {
          localRuntime = undefined
          setListening(false)
          setMicLevel(0)
          setInterim("")
          setError(event.message)
        }
      },
    })
    localRuntime = runtime
    try {
      await runtime.start()
      if (wantsListening) setListening(true)
    } catch (cause) {
      runtime.stop()
      localRuntime = undefined
      wantsListening = false
      setInterim("")
      setError(cause instanceof Error ? cause.message : "无法启动本地语音运行时")
    }
  }

  const stopNative = () => {
    wantsListening = false
    setListening(false)
    setInterim("")
    setMicLevel(0)
    nativeRuntime?.stop()
    nativeRuntime = undefined
  }

  const stopEmbedded = () => {
    setListening(false)
    setInterim("")
    setMicLevel(0)
    localRuntime?.stop()
    localRuntime = undefined
  }

  const startLocal = async () => {
    if (!props.enabled || listening() || localRuntime || nativeRuntime || !localSupported()) {
      if (!localSupported()) setError("当前浏览器不支持本地语音运行时")
      return
    }
    if (nativeSupported()) {
      await startNative()
      return
    }
    if (!props.endpoint.trim() && embeddedSupported()) {
      await startEmbedded()
      return
    }
    setError(undefined)
    wantsListening = true
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      localChunks = []
      const recorder = new MediaRecorder(localStream)
      localRecorder = recorder
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) localChunks.push(event.data)
      }
      recorder.onstop = () => {
        const blob = new Blob(localChunks, { type: recorder.mimeType || "audio/webm" })
        cleanupLocal()
        if (!blob.size) return
        void transcribeLocal(blob).catch((cause) => {
          setError(cause instanceof Error ? cause.message : "本地语音转写失败")
        })
      }
      recorder.start(250)
      setListening(true)
    } catch (cause) {
      cleanupLocal()
      wantsListening = false
      setError(cause instanceof Error && cause.name === "NotAllowedError" ? "麦克风权限被拒绝" : "无法启动本地语音录音")
    }
  }

  const stop = () => {
    if (nativeRuntime) {
      stopNative()
      return
    }
    if (localRuntime) {
      stopEmbedded()
      return
    }
    if (localRecorder) {
      stopLocal()
      return
    }
    wantsListening = false
    if (restartTimer) clearTimeout(restartTimer)
    restartTimer = undefined
    const current = recognition.current
    recognition.current = undefined
    setListening(false)
    setInterim("")
    try {
      current?.stop()
    } catch {
      current?.abort()
    }
  }

  const start = () => {
    if (!props.enabled || listening()) return
    if (props.engine === "local") {
      void startLocal()
      return
    }
    const Recognition = ctor()
    wantsListening = true
    if (!Recognition) {
      wantsListening = false
      setError("当前运行环境不支持语音识别")
      return
    }
    setError(undefined)
    const current = new Recognition()
    current.lang = props.language || "zh-CN"
    current.continuous = true
    current.interimResults = true
    current.onresult = (event) => {
      let partial = ""
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]
        const text = result?.[0]?.transcript?.trim() ?? ""
        if (!text) continue
        if (result.isFinal) props.onText(text)
        else partial += text
      }
      setInterim(partial)
    }
    current.onerror = (event) => {
      if (event.error !== "aborted" && event.error !== "no-speech") {
        setError(event.error === "not-allowed" ? "麦克风权限被拒绝" : "语音识别失败")
      }
      if (event.error === "not-allowed" || event.error === "service-not-allowed") wantsListening = false
      setListening(false)
    }
    current.onend = () => {
      if (recognition.current !== current) return
      recognition.current = undefined
      setListening(false)
      setInterim("")
      // Chromium 会在静音、网络切换或短暂服务中断后结束 continuous session。
      // 只要用户仍处于 toggle/hold 会话，就自动重建识别器，避免一次停顿让听写按钮失效。
      if (wantsListening && props.enabled) {
        restartTimer = setTimeout(() => {
          restartTimer = undefined
          if (wantsListening && props.enabled) start()
        }, 120)
      }
    }
    recognition.current = current
    setListening(true)
    try {
      current.start()
    } catch {
      recognition.current = undefined
      wantsListening = false
      setListening(false)
      setError("无法启动麦克风，请检查系统权限")
    }
  }

  const toggle = () => (listening() ? stop() : start())
  const holdStart = (event: PointerEvent) => {
    const target = event.currentTarget as HTMLButtonElement | null
    target?.setPointerCapture?.(event.pointerId)
    start()
  }
  const holdStop = (event: PointerEvent) => {
    const target = event.currentTarget as HTMLButtonElement | null
    if (target?.hasPointerCapture?.(event.pointerId)) {
      target.releasePointerCapture(event.pointerId)
    }
    stop()
  }
  const onGlobalKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.altKey || event.shiftKey) return
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "e") return
    if (!props.enabled) return
    event.preventDefault()
    toggle()
  }
  window.addEventListener("keydown", onGlobalKeyDown)
  createEffect(() => {
    if (!props.enabled && (listening() || wantsListening)) stop()
  })
  onCleanup(() => {
    window.removeEventListener("keydown", onGlobalKeyDown)
    stop()
  })

  return (
    <span
      class="relative inline-flex items-center gap-1"
      title={!props.enabled ? "请先在设置 → 语音中启用语音输入" : undefined}
    >
      <Button
        type="button"
        variant="ghost"
        class="size-8 p-0"
        disabled={!props.enabled || unsupported()}
        aria-label={listening() ? "停止语音输入" : "开始语音输入"}
        aria-pressed={listening()}
        title={
          error() ??
          (!props.enabled
            ? "请先在设置 → 语音中启用语音输入"
            : unsupported()
              ? props.engine === "local"
                ? "本地模型需要支持 AudioWorklet 的浏览器；也可以配置本地 Whisper 服务地址"
                : "当前运行环境不支持语音识别"
              : listening()
                ? `正在听写${interim() ? `：${interim()}` : ""}`
                : props.mode === "hold"
                  ? "按住说话"
                  : "点击开始语音输入")
        }
        classList={{ "text-critical-base": listening(), "animate-pulse": listening() }}
        onClick={props.mode === "toggle" ? toggle : undefined}
        onPointerDown={props.mode === "hold" ? holdStart : undefined}
        onPointerUp={props.mode === "hold" ? holdStop : undefined}
        onPointerCancel={props.mode === "hold" ? holdStop : undefined}
        onLostPointerCapture={props.mode === "hold" ? stop : undefined}
      >
        <Icon name="microphone" size="small" />
      </Button>
      <Show when={listening() && props.engine === "local"}>
        <span
          class="h-1 w-8 overflow-hidden rounded-full bg-foreground-subtle/30"
          aria-hidden="true"
          title="麦克风音量"
        >
          <span
            class="block h-full rounded-full bg-critical-base transition-[width]"
            style={{ width: `${Math.round(micLevel() * 100)}%` }}
          />
        </span>
      </Show>
      <Show when={listening() && interim()}>
        <span class="max-w-40 truncate text-11-regular text-foreground-subtle" aria-hidden="true">
          {interim()}
        </span>
      </Show>
      <span class="sr-only" aria-live="polite">
        {error() ?? interim()}
      </span>
    </span>
  )
}
