import type { Config } from "@novaway/sdk/v2/client"
import { Button } from "@novaway/ui/button"
import { Select } from "@novaway/ui/select"
import { Switch } from "@novaway/ui/switch"
import { TextField } from "@novaway/ui/text-field"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type Component } from "solid-js"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { PromptVoiceDictation } from "./prompt-voice-dictation"
import { SettingsGroup, SettingsPage, SettingsRow } from "./settings-parts"
import { downloadVoiceModel, voiceModelReady, VOICE_MODELS, type VoiceModelDownloadStatus } from "./voice-models"
import { detectVoiceAcceleration, type VoiceAcceleration } from "./voice-capabilities"
import {
  clearVoiceSettingsStorage,
  readVoiceSettingsStorage,
  writeVoiceSettingsStorage,
} from "./voice-settings-storage"

const LANGUAGES = [
  { value: "zh-CN", label: "中文（普通话）" },
  { value: "en-US", label: "English (US)" },
  { value: "ja-JP", label: "日本語" },
  { value: "ko-KR", label: "한국어" },
] as const
const MODES = [
  { value: "toggle", label: "点击切换" },
  { value: "hold", label: "按住说话" },
] as const

const PROVIDERS = [
  { value: "browser", label: "Chromium（浏览器在线识别）" },
  { value: "local", label: "本地 Whisper（内置 / Native GPU）" },
] as const

type NativeVoiceModel = {
  id: string
  label: string
  family: string
  languages: readonly string[]
  sizeBytes: number
  fileName: string
  downloaded: boolean
  bytes: number
}

export const SettingsVoice: Component = () => {
  const language = useLanguage()
  const globalSync = useGlobalSync()
  const [localVoiceConfig, setLocalVoiceConfig] = createSignal(readVoiceSettingsStorage())
  const config = createMemo(() => ({
    ...(globalSync.data.config as Config & { voice?: Record<string, unknown> }).voice,
    ...localVoiceConfig(),
  }))
  const [enabledOverride, setEnabledOverride] = createSignal<boolean>()
  const [saveError, setSaveError] = createSignal<string>()
  const enabled = createMemo(() => enabledOverride() ?? config().enabled === true)
  createEffect(() => {
    const override = enabledOverride()
    if (override !== undefined && config().enabled === override) setEnabledOverride(undefined)
  })
  const selectedLanguage = createMemo<string>(() => {
    const value = config().language
    return typeof value === "string" ? value : "zh-CN"
  })
  const mode = createMemo<"toggle" | "hold">(() => (config().mode === "hold" ? "hold" : "toggle"))
  const engine = createMemo<"browser" | "local">(() => (config().engine === "local" ? "local" : "browser"))
  const endpoint = createMemo(() =>
    typeof config().local_endpoint === "string" ? String(config().local_endpoint) : "",
  )
  const model = createMemo(() =>
    typeof config().local_model === "string"
      ? String(config().local_model)
      : endpoint().trim()
        ? "whisper-1"
        : "Xenova/whisper-tiny",
  )
  const update = (patch: Record<string, unknown>) => {
    const changingEnabled = typeof patch.enabled === "boolean"
    if (changingEnabled) {
      setEnabledOverride(patch.enabled as boolean)
      setSaveError(undefined)
    }
    const currentVoice = {
      ...config(),
      ...(enabledOverride() === undefined ? {} : { enabled: enabledOverride() }),
    }
    const nextVoice = { ...currentVoice, ...patch }
    setLocalVoiceConfig(nextVoice)
    writeVoiceSettingsStorage(nextVoice)
    const request = globalSync.updateConfig({ voice: nextVoice } as Config)
    const timeout = new Promise<never>((_, reject) =>
      window.setTimeout(() => reject(new Error("语音设置保存超时，请检查 NovaWay 服务连接")), 10_000),
    )
    return Promise.race([request, timeout])
      .then((result) => {
        clearVoiceSettingsStorage()
        setLocalVoiceConfig({})
        return result
      })
      .catch((cause) => {
      // Keep the local optimistic state so the user can still test the microphone
      // when the settings API is temporarily offline. The error remains visible
      // and the next successful config refresh will reconcile the persisted value.
      if (changingEnabled) setEnabledOverride(patch.enabled as boolean)
      setSaveError(cause instanceof Error ? cause.message : "语音设置保存失败")
      return undefined
    })
  }
  const [downloads, setDownloads] = createSignal<Record<string, VoiceModelDownloadStatus>>({})
  const [nativeModels, setNativeModels] = createSignal<readonly NativeVoiceModel[]>([])
  const selectedModelLabel = () =>
    VOICE_MODELS.find((item) => item.id === model())?.label ??
    nativeModels().find((item) => item.id === model())?.label ??
    model()
  const [testTranscript, setTestTranscript] = createSignal("")
  const [acceleration, setAcceleration] = createSignal<VoiceAcceleration>("checking")
  onMount(() => {
    const removeDownloadProgressListener = window.api?.onNativeSpeechDownloadProgress?.((event) => {
      setDownloads((current) => ({
        ...current,
        [event.id]: {
          state: event.progress >= 100 ? "ready" : "downloading",
          type: "status",
          status: event.progress >= 100 ? "ready" : "downloading",
          progress: event.progress,
          device: "native-gpu",
        },
      }))
    })
    if (removeDownloadProgressListener) onCleanup(removeDownloadProgressListener)

    void (async () => {
      const nativeBackends = await window.api?.getNativeSpeechBackends?.().catch(() => undefined)
      if (nativeBackends?.some((backend) => backend.deviceType === "gpu")) {
        setAcceleration("native-gpu")
        return
      }
      setAcceleration(await detectVoiceAcceleration())
    })()
    const nativeModelsRequest = window.api?.getNativeSpeechModels?.()
    if (nativeModelsRequest) {
      void nativeModelsRequest.then((models) => {
        setNativeModels(models)
        setDownloads((current) => ({
          ...current,
          ...Object.fromEntries(
            models
              .filter((model) => model.downloaded)
              .map((model) => [
                model.id,
                { state: "ready", type: "status", status: "ready", device: "native-gpu" },
              ]),
          ),
        }))
      })
    }
  })
  const modelStatus = (id: string): VoiceModelDownloadStatus =>
    downloads()[id] ?? { state: voiceModelReady(id) ? "ready" : "idle", type: "status", status: "idle" }
  const selectModel = (id: string) => update({ engine: "local", local_endpoint: undefined, local_model: id })
  const downloadModel = (id: string) => {
    if (voiceModelReady(id)) {
      selectModel(id)
      setDownloads((current) => ({
        ...current,
        [id]: { state: "ready", type: "status", status: "ready" },
      }))
      return
    }
    void downloadVoiceModel(id, (status) => setDownloads((current) => ({ ...current, [id]: status })))
      .then(() => selectModel(id))
      .catch(() => undefined)
  }
  const downloadNativeModel = (item: NativeVoiceModel) => {
    const api = window.api
    if (!api?.downloadNativeSpeechModel) return

    if (item.downloaded || modelStatus(item.id).state === "ready") {
      selectModel(item.id)
      setDownloads((current) => ({
        ...current,
        [item.id]: { state: "ready", type: "status", status: "ready", device: "native-gpu" },
      }))
      return
    }
    setDownloads((current) => ({
      ...current,
      [item.id]: { state: "downloading", type: "status", status: "downloading", device: "native-gpu" },
    }))

    void api
      .downloadNativeSpeechModel(item.id)
      .then(() => {
        setNativeModels((models) =>
          models.map((model) => (model.id === item.id ? { ...model, downloaded: true, bytes: model.sizeBytes } : model)),
        )
        setDownloads((current) => ({
          ...current,
          [item.id]: { state: "ready", type: "status", status: "ready", device: "native-gpu" },
        }))
        selectModel(item.id)
      })
      .catch((cause) => {
        setDownloads((current) => ({
          ...current,
          [item.id]: {
            state: "error",
            type: "error",
            message: cause instanceof Error ? cause.message : "模型下载失败",
          },
        }))
      })
  }

  return (
    <SettingsPage
      title={language.t("settings.voice.title" as never)}
      description={language.t("settings.voice.description" as never)}
    >
      <Show when={saveError()}>
        <div
          class="rounded-lg border border-critical-base/30 bg-critical-base/10 px-3 py-2 text-12-regular text-critical-base"
          role="alert"
        >
          {saveError()}
        </div>
      </Show>
      <SettingsGroup>
        <SettingsRow
          label={language.t("settings.voice.enabled.title" as never)}
          description={language.t("settings.voice.enabled.description" as never)}
          control={
            <Switch checked={enabled()} onChange={(value) => update({ enabled: value })} hideLabel>
              {language.t("settings.voice.enabled.title" as never)}
            </Switch>
          }
        />
        <SettingsRow
          layout="wide"
          label={language.t("settings.voice.engine.title" as never)}
          description="浏览器模式使用 Chromium 在线识别；本地模式默认使用内置 Whisper。清空服务地址后可使用 Native GPU 模型；填写地址则改用你配置的 Whisper 兼容服务。"
          control={
            <Select
              options={PROVIDERS.map((item) => ({ ...item }))}
              current={PROVIDERS.map((item) => ({ ...item })).find((item) => item.value === engine())}
              value={(item) => item.value}
              label={(item) => item.label}
              onSelect={(item) => item && update({ engine: item.value })}
              disabled={!enabled()}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
          }
        />
        <SettingsRow
          label={language.t("settings.voice.language.title" as never)}
          description={language.t("settings.voice.language.description" as never)}
          control={
            <Select
              options={LANGUAGES.map((item) => ({ ...item }))}
              current={LANGUAGES.map((item) => ({ ...item })).find((item) => item.value === selectedLanguage())}
              value={(item) => item.value}
              label={(item) => item.label}
              onSelect={(item) => item && update({ language: item.value })}
              disabled={!enabled()}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
          }
        />
        <SettingsRow
          label={language.t("settings.voice.mode.title" as never)}
          description={language.t("settings.voice.mode.description" as never)}
          control={
            <Select
              options={MODES.map((item) => ({ ...item }))}
              current={MODES.map((item) => ({ ...item })).find((item) => item.value === mode())}
              value={(item) => item.value}
              label={(item) => item.label}
              onSelect={(item) => item && update({ mode: item.value })}
              disabled={!enabled()}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
          }
        />
        <Show when={engine() === "local"}>
          <SettingsRow
            layout="wide"
            label="本地服务地址（可选）"
            description="留空使用内置 Whisper/Native GPU；填写 OpenAI 兼容的 /v1/audio/transcriptions 地址后，录音会发送给该本地服务。"
            control={
              <TextField
                label={language.t("settings.voice.endpoint.title" as never)}
                hideLabel
                value={endpoint()}
                onChange={(value) => update({ local_endpoint: value })}
                placeholder="http://127.0.0.1:8080/v1/audio/transcriptions"
                spellcheck={false}
                autocorrect="off"
                autocomplete="off"
              />
            }
          />
          <Show
            when={endpoint().trim()}
            fallback={
              <SettingsRow
                label="当前模型"
                description="内置 Whisper/Native 模型只能通过下方模型卡片选择，不能手动修改模型标识。"
                control={
                  <div class="max-w-full truncate rounded-md border border-border bg-background px-3 py-2 text-12-regular text-foreground">
                    {selectedModelLabel() || "尚未选择模型"}
                  </div>
                }
              />
            }
          >
            <SettingsRow
              label="服务模型标识"
              description="当前填写了本地服务地址；这里填写该服务要求的模型名。"
              control={
                <TextField
                  label="服务模型标识"
                  hideLabel
                  value={model()}
                  onChange={(value) => update({ local_model: value })}
                  placeholder="whisper-1"
                  spellcheck={false}
                  autocorrect="off"
                  autocomplete="off"
                />
              }
            />
          </Show>
          <Show when={endpoint().trim()}>
            <div class="rounded-lg border border-warning-base/30 bg-surface-warning-base px-3 py-2 text-12-regular text-warning-base">
              当前填写了本地服务地址，测试麦克风会把录音发送到该地址，不会使用下方 Native GPU 模型。要使用本机 GPU，请清空此地址，再点击 Native 模型的“选择”按钮。
            </div>
          </Show>
        </Show>
      </SettingsGroup>
      <SettingsGroup>
        <SettingsRow
          label="本地推理加速"
          description="桌面端优先使用 Native GPU/Vulkan；浏览器模式尝试 WebGPU；不可用时自动使用 CPU/WASM。"
          control={
            <span class="text-12-regular text-foreground-subtle">
              {acceleration() === "checking"
                ? "检测中…"
                : acceleration() === "native-gpu"
                  ? "Native GPU"
                  : acceleration() === "webgpu"
                    ? "WebGPU"
                    : "CPU/WASM"}
            </span>
          }
        />
      </SettingsGroup>
      <div>
        <div class="text-15-medium text-foreground">本地语音模型</div>
        <p class="mt-1 text-12-regular text-foreground-subtle">
          下载模型后会缓存在这台电脑的浏览器中；下载完成后点击“选择”切换当前模型，不需要配置外部服务。
        </p>
      </div>
      <SettingsGroup>
        <For each={VOICE_MODELS}>
          {(item) => {
            const status = () => modelStatus(item.id)
            const selected = () => engine() === "local" && model() === item.id && !endpoint()
            return (
              <SettingsRow
                layout="wide"
                label={item.label}
                description={`${item.description} ${item.languages} · ${item.quality} · ${item.size}`}
                control={
                  <Button
                    size="small"
                    variant={selected() ? "secondary" : "ghost"}
                    disabled={status().state === "downloading"}
                    onClick={() => downloadModel(item.id)}
                  >
                    {status().state === "downloading"
                      ? typeof status().progress === "number"
                        ? `${Math.round(status().progress ?? 0)}%`
                        : "下载中…"
                      : status().state === "ready"
                        ? selected()
                          ? "使用中"
                          : "选择"
                        : "下载"}
                  </Button>
                }
                detail={
                  <Show
                    when={
                      status().state === "downloading" ||
                      status().state === "error" ||
                      (status().state === "ready" && status().device)
                    }
                  >
                    <div class="text-12-regular text-foreground-subtle">
                      {status().state === "error"
                        ? status().message
                        : status().state === "ready" && status().device
                          ? status().device === "webgpu"
                            ? "已下载 · 支持 WebGPU 加速"
                            : "已下载 · 将使用 CPU/WASM"
                          : "模型会保存在本机浏览器缓存中，首次下载后可离线使用。"}
                    </div>
                  </Show>
                }
              />
            )
          }}
        </For>
      </SettingsGroup>
      <Show when={nativeModels().length > 0}>
        <div>
          <div class="text-15-medium text-foreground">Native 语音模型</div>
          <p class="mt-1 text-12-regular text-foreground-subtle">
            桌面端模型下载到本机，由 Native transcribe-cpp 推理；支持 GPU/Vulkan，GPU 不可用时回退 CPU。下载完成后点击“选择”即可切换当前模型。
          </p>
        </div>
        <SettingsGroup>
          <For each={nativeModels()}>
            {(item) => {
              const status = () => modelStatus(item.id)
              const selected = () => engine() === "local" && model() === item.id && !endpoint()
              const size = `${Math.round(item.sizeBytes / 1024 / 1024)} MB`
              return (
                <SettingsRow
                  layout="wide"
                  label={item.label}
                  description={`${item.family} · ${item.languages.join(", ")} · ${size}`}
                  control={
                    <Button
                      size="small"
                      variant={selected() ? "secondary" : "ghost"}
                      disabled={status().state === "downloading"}
                      onClick={() => downloadNativeModel(item)}
                    >
                      {status().state === "downloading"
                        ? typeof status().progress === "number"
                          ? `${Math.round(status().progress ?? 0)}%`
                          : "下载中…"
                        : status().state === "error"
                          ? "重试下载"
                          : status().state === "ready"
                            ? selected()
                              ? "使用中"
                              : "选择"
                            : "下载"}
                    </Button>
                  }
                  detail={
                    <Show when={status().state === "downloading" || status().state === "error" || selected()}>
                      <div class="text-12-regular text-foreground-subtle">
                        {status().state === "error"
                          ? status().message
                          : status().state === "downloading"
                            ? "模型正在保存到本机，完成后即可离线测试。"
                            : selected()
                              ? "当前使用 · 测试麦克风将使用 Native 推理"
                              : "已下载 · 支持 Native GPU/Vulkan"}
                      </div>
                    </Show>
                  }
                />
              )
            }}
          </For>
        </SettingsGroup>
      </Show>
      <SettingsGroup>
        <SettingsRow
          layout="wide"
          label="测试麦克风"
          description="点击输入框旁的麦克风，说一句话确认模型、权限和识别结果都正常。"
          control={
            <PromptVoiceDictation
              enabled={enabled()}
              language={selectedLanguage()}
              mode="toggle"
              engine={engine()}
              endpoint={endpoint()}
              model={model()}
              onText={(text) => setTestTranscript((current) => (current ? `${current} ${text}` : text))}
            />
          }
          detail={
            <Show when={testTranscript()}>
              <div class="rounded-lg bg-background px-3 py-2 text-12-regular text-foreground">{testTranscript()}</div>
            </Show>
          }
        />
      </SettingsGroup>
      <div class="rounded-xl border border-border bg-surface px-4 py-3">
        <div class="text-13-medium text-foreground">{language.t("settings.voice.runtime.title" as never)}</div>
        <p class="mt-1 text-12-regular text-foreground-subtle">
          {language.t("settings.voice.runtime.description" as never)}
        </p>
      </div>
    </SettingsPage>
  )
}
