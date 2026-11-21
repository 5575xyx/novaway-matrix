import { Component, For, Show, createEffect, createMemo, createResource, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@novaway/ui/button"
import { IconButton } from "@novaway/ui/icon-button"
import { Icon } from "@novaway/ui/icon"
import { Spinner } from "@novaway/ui/spinner"
import { TextField } from "@novaway/ui/text-field"
import { ProviderIcon } from "@novaway/ui/provider-icon"
import { Dialog } from "@novaway/ui/dialog"
import { useDialog } from "@novaway/ui/context/dialog"
import { showToast } from "@novaway/ui/toast"
import {
  usePlatform,
  type AppAppearanceIcon,
  type AppAppearanceImageSource,
  type AppAppearanceState,
} from "@/context/platform"
import { useGlobalSDK } from "@/context/global-sdk"
import { useModels } from "@/context/models"
import { modelColor, modelIconId } from "@/utils/provider-icon"
import { ModelList } from "./dialog-select-model"
import { SettingsGroup } from "./settings-parts"

/** 单个图标缩略图：向主进程要一次 PNG dataURL，失败时回退到占位图标。 */
const IconThumb: Component<{ id: string; mode?: "light" | "dark"; class?: string }> = (props) => {
  const platform = usePlatform()
  const [data] = createResource(
    () => `${props.id}:${props.mode ?? "light"}`,
    () => platform.getAppIconData?.(props.id, props.mode).catch(() => null) ?? Promise.resolve(null),
  )
  return (
    <Show
      when={data()}
      fallback={
        <div class={`flex items-center justify-center text-foreground-subtle ${props.class ?? ""}`}>
          <Icon name="lu-image" />
        </div>
      }
    >
      {(src) => <img src={src()} alt="" class={`object-contain ${props.class ?? ""}`} draggable={false} />}
    </Show>
  )
}

export const SettingsAppAppearance: Component = () => {
  const platform = usePlatform()
  const dialog = useDialog()
  const [state, setState] = createStore<{
    appearance: AppAppearanceState | undefined
    nameDraft: string
    importing: boolean
    applyingIcon: string | undefined
  }>({
    appearance: undefined,
    nameDraft: "",
    importing: false,
    applyingIcon: undefined,
  })

  const apply = (next: AppAppearanceState | undefined | null) => {
    if (!next) return
    setState("appearance", next)
    setState("nameDraft", next.name)
  }

  onMount(() => {
    void platform.getAppAppearance?.().then(apply)
    const dispose = platform.onAppAppearanceChange?.((next) => setState("appearance", next))
    if (dispose) onCleanup(dispose)
  })

  createEffect(() => {
    const current = state.appearance?.name
    if (current === undefined) return
    if (!state.nameDraft) setState("nameDraft", current)
  })

  const icons = () => state.appearance?.icons ?? []
  const currentIcon = () => state.appearance?.icon ?? "default"
  const nameDirty = () => state.nameDraft.trim() !== (state.appearance?.name ?? "")

  const saveName = () => {
    const value = state.nameDraft.trim()
    void platform.setAppName?.(value || null).then((next) => {
      apply(next)
      showToast({
        variant: "success",
        icon: "circle-check",
        title: "应用名称已更新",
        description: value || next.defaultName,
      })
    })
  }

  const resetName = () => {
    void platform.setAppName?.(null).then((next) => {
      apply(next)
      showToast({ title: "已恢复默认名称", description: next.defaultName })
    })
  }

  const selectIcon = (id: string) => {
    if (id === currentIcon()) return
    setState("applyingIcon", id)
    void platform
      .setAppIcon?.(id)
      .then(apply)
      .catch((error) => showToast({ title: "切换图标失败", description: String(error?.message ?? error) }))
      .finally(() => setState("applyingIcon", undefined))
  }

  const importIcon = () => {
    setState("importing", true)
    void platform
      .importAppIcon?.()
      .then((next) => {
        if (!next) return
        apply(next)
        showToast({ variant: "success", icon: "circle-check", title: "已导入并应用图标" })
      })
      .catch((error) => showToast({ title: "导入图标失败", description: String(error?.message ?? error) }))
      .finally(() => setState("importing", false))
  }

  const importIconPair = () => {
    setState("importing", true)
    void platform
      .importAppIconPair?.()
      .then((next) => {
        if (!next) return
        apply(next)
        showToast({ variant: "success", icon: "circle-check", title: "浅色和深色图标已导入并应用" })
      })
      .catch((error) => showToast({ title: "导入主题图标失败", description: String(error?.message ?? error) }))
      .finally(() => setState("importing", false))
  }

  const openIconCropper = () => {
    const id = currentIcon()
    void platform.getAppIconData?.(id, state.appearance?.mode).then((data) => {
      if (!data) {
        showToast({ title: "无法编辑图标", description: "当前图标数据不可用。" })
        return
      }
      const icon = icons().find((item) => item.id === id)
      dialog.show(() => (
        <AppIconCropper
          id={id}
          data={data}
          mode={state.appearance?.mode ?? "light"}
          paired={!!icon?.lightId || !!icon?.darkId}
          onApply={apply}
        />
      ))
    })
  }

  const removeIcon = (icon: AppAppearanceIcon) => {
    void platform
      .deleteAppIcon?.(icon.id)
      .then(apply)
      .catch((error) => showToast({ title: "删除图标失败", description: String(error?.message ?? error) }))
  }

  return (
    <div class="flex flex-col gap-1">
      <h3 class="text-14-medium text-foreground pb-2">应用图标与名称</h3>
      <SettingsGroup>
        <div class="border-t border-border/80 px-4 py-4 first:border-t-0">
          <div class="grid grid-cols-1 items-center gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div class="flex min-w-0 flex-col gap-0.5">
              <span class="text-13-medium text-foreground">应用名称</span>
              <span class="text-12-regular text-foreground-subtle">
                显示在窗口标题、任务栏与托盘。留空恢复默认「{state.appearance?.defaultName ?? "NovaWay"}」。
              </span>
            </div>
            <div class="flex w-full items-center gap-2 sm:w-auto">
              <TextField
                variant="normal"
                value={state.nameDraft}
                maxLength={40}
                placeholder={state.appearance?.defaultName ?? "NovaWay"}
                onChange={(value) => setState("nameDraft", value)}
                onKeyDown={(event: KeyboardEvent) => {
                  if (event.key === "Enter") saveName()
                }}
                class="w-48"
              />
              <Button variant="primary" size="small" disabled={!nameDirty()} onClick={saveName}>
                应用
              </Button>
              <Show when={state.appearance && state.appearance.name !== state.appearance.defaultName}>
                <IconButton
                  icon="lu-rotate-ccw"
                  variant="ghost"
                  size="small"
                  title="恢复默认名称"
                  onClick={resetName}
                />
              </Show>
            </div>
          </div>
        </div>

        <div class="border-t border-border/80 px-4 py-4">
          <div class="flex flex-wrap items-center gap-4">
            <div class="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
              <IconThumb id={currentIcon()} mode={state.appearance?.mode} class="size-14" />
            </div>
            <div class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span class="text-13-medium text-foreground">应用图标</span>
              <span class="text-12-regular text-foreground-subtle">
                点选下方图标即时切换；可导入图片，或自定义生成浅色/深色两版并预览后应用，切换主题时自动匹配对应版本。
              </span>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="small"
                icon="brain"
                onClick={() => dialog.show(() => <AppIconGenerator />)}
              >
                自定义图标
              </Button>
              <Button
                variant="secondary"
                size="small"
                icon="cloud-upload"
                disabled={state.importing}
                onClick={importIcon}
              >
                {state.importing ? "导入中…" : "导入图片"}
              </Button>
              <Button variant="secondary" size="small" icon="photo" disabled={state.importing} onClick={importIconPair}>
                导入浅/深色图标
              </Button>
              <Button variant="ghost" size="small" icon="folder" onClick={() => void platform.openAppIconDir?.()}>
                图标文件夹
              </Button>
            </div>
          </div>

          <div class="mt-4 flex items-center gap-2">
            <span class="text-12-regular text-foreground-subtle">调整所选图标</span>
            <Button size="small" variant="secondary" disabled={!!state.applyingIcon} onClick={openIconCropper}>
              裁剪图标
            </Button>
          </div>

          <div class="mt-4 grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-3">
            <For each={icons()}>
              {(icon) => {
                const selected = () => currentIcon() === icon.id
                return (
                  <div class="group/icon relative flex flex-col items-center gap-1">
                    <button
                      type="button"
                      title={icon.builtIn ? "默认图标" : icon.label}
                      aria-pressed={selected()}
                      class="relative flex size-16 items-center justify-center overflow-hidden rounded-xl border border-border bg-background p-1.5 transition-colors hover:border-border-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-interactive-focus/40"
                      classList={{ "border-interactive-base/70 ring-2 ring-interactive-base/30": selected() }}
                      onClick={() => selectIcon(icon.id)}
                    >
                      <IconThumb id={icon.id} mode={state.appearance?.mode} class="size-11" />
                      <Show when={state.applyingIcon === icon.id}>
                        <div class="absolute inset-0 flex items-center justify-center bg-background/60">
                          <Spinner class="size-4 text-foreground" />
                        </div>
                      </Show>
                      <Show when={selected()}>
                        <span class="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-interactive-base text-background">
                          <Icon name="check-small" size="small" />
                        </span>
                      </Show>
                    </button>
                    <span class="w-full truncate text-center text-10-medium text-foreground-subtle">
                      {icon.builtIn ? "默认" : icon.label}
                    </span>
                    <Show when={!icon.builtIn}>
                      <button
                        type="button"
                        title="删除该图标"
                        class="absolute -right-1 -top-1 hidden size-5 items-center justify-center rounded-full border border-border bg-surface text-foreground-subtle shadow-sm transition-colors hover:text-foreground group-hover/icon:flex"
                        onClick={() => removeIcon(icon)}
                      >
                        <Icon name="close-small" size="small" />
                      </button>
                    </Show>
                  </div>
                )
              }}
            </For>
          </div>
        </div>
      </SettingsGroup>
    </div>
  )
}

const AppIconCropper: Component<{
  id: string
  data: string
  mode: "light" | "dark"
  paired: boolean
  onApply: (state: AppAppearanceState) => void
}> = (props) => {
  const platform = usePlatform()
  const dialog = useDialog()
  const [state, setState] = createStore({ frame: "square" as "square" | "circle", zoom: 1, busy: false })

  const applyCrop = async () => {
    if (state.busy) return
    setState("busy", true)
    try {
      const image = new Image()
      image.src = props.data
      await image.decode()
      const canvas = document.createElement("canvas")
      const size = 512
      canvas.width = size
      canvas.height = size
      const context = canvas.getContext("2d")
      if (!context) throw new Error("无法创建图像裁剪画布")
      const sourceSize = Math.min(image.naturalWidth, image.naturalHeight) / state.zoom
      const sourceX = (image.naturalWidth - sourceSize) / 2
      const sourceY = (image.naturalHeight - sourceSize) / 2
      if (state.frame === "circle") {
        context.beginPath()
        context.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2)
        context.clip()
      }
      context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, size, size)
      const next = await platform.generateAppIconFromImage?.(
        { base64: canvas.toDataURL("image/png").split(",")[1] },
        undefined,
        "square",
        props.mode,
        props.paired ? props.id : undefined,
        props.paired,
      )
      if (!next) throw new Error("桌面图标裁剪接口不可用")
      props.onApply(next)
      dialog.close()
      showToast({ variant: "success", icon: "circle-check", title: "图标裁剪已应用" })
    } catch (error) {
      showToast({ title: "裁剪图标失败", description: String(error) })
    } finally {
      setState("busy", false)
    }
  }

  return (
    <Dialog
      title="裁剪应用图标"
      description="拖动预览可调整位置，使用缩放滑块调整图标大小。"
      class="w-full max-w-[620px] mx-auto"
      footer={
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="small" disabled={state.busy} onClick={() => dialog.close()}>
            取消
          </Button>
          <Button variant="primary" size="small" disabled={state.busy} onClick={() => void applyCrop()}>
            <Show when={state.busy} fallback="应用裁剪">
              <span class="flex items-center gap-1.5">
                <Spinner class="size-3.5" />
                处理中…
              </span>
            </Show>
          </Button>
        </div>
      }
    >
      <div class="flex flex-col gap-5 p-5 sm:flex-row">
        <div class="flex flex-1 items-center justify-center rounded-xl border border-border bg-background p-6">
          <div
            class="size-56 overflow-hidden border border-border bg-surface"
            classList={{ "rounded-full": state.frame === "circle", "rounded-3xl": state.frame === "square" }}
          >
            <img
              src={props.data}
              alt="图标裁剪预览"
              class="size-full object-cover"
              style={{ transform: `scale(${state.zoom})`, "transform-origin": "center" }}
              draggable={false}
            />
          </div>
        </div>
        <div class="flex w-full flex-col gap-5 sm:w-44">
          <div class="flex flex-col gap-2">
            <span class="text-13-medium text-foreground">外框形状</span>
            <Button
              size="small"
              variant={state.frame === "square" ? "primary" : "secondary"}
              onClick={() => setState("frame", "square")}
            >
              方形
            </Button>
            <Button
              size="small"
              variant={state.frame === "circle" ? "primary" : "secondary"}
              onClick={() => setState("frame", "circle")}
            >
              圆形
            </Button>
          </div>
          <label class="flex flex-col gap-2 text-13-medium text-foreground">
            缩放 {state.zoom.toFixed(1)}×
            <input
              type="range"
              min="1"
              max="3"
              step="0.05"
              value={state.zoom}
              onInput={(event) => setState("zoom", Number(event.currentTarget.value))}
              class="w-full accent-interactive-base"
            />
          </label>
        </div>
      </div>
    </Dialog>
  )
}

type IconVariant = { preview: string; source: AppAppearanceImageSource }

/** 选择器所需的最小模型形状：来自 useModels().list() 的可见模型项。 */
type ModelLike = {
  id: string
  name: string
  provider: { id: string; name: string }
  capabilities?: { output?: { image?: boolean } }
}

const modelKeyOf = (model: ModelLike) => `${model.provider.id}:${model.id}`

/** 与会话输入框的模型按钮同款内容：品牌图标 + 品牌色名称 + 展开箭头。 */
const ModelTriggerContent: Component<{ model?: ModelLike; placeholder: string; open?: boolean }> = (props) => (
  <>
    <Show when={props.model} fallback={<span class="min-w-0 truncate">{props.placeholder}</span>}>
      {(model) => (
        <ProviderIcon
          id={modelIconId(model().provider.id, model().provider.name, model().id, model().name)}
          colorId={modelColor(model().provider.id, model().provider.name, model().id, model().name)}
          brand
          class="size-4 shrink-0 text-icon-interactive-base transition-opacity duration-150"
        />
      )}
    </Show>
    <Show when={props.model}>
      {(model) => (
        <span
          class="min-w-0 truncate"
          style={{
            color:
              modelColor(model().provider.id, model().provider.name, model().id, model().name) ??
              "var(--text-interactive-base)",
          }}
        >
          {model().name}
        </span>
      )}
    </Show>
    <Icon name="chevron-down" size="small" class="shrink-0" classList={{ "rotate-180": !!props.open }} />
  </>
)

/**
 * 与会话输入框同一套模型列表（分组、品牌图标/颜色、搜索、选中勾）。
 * 设置面板挂在模态对话框里，浮层会被「点击外部关闭/焦点抢占」打断，所以展开在按钮下方就地显示。
 */
const ModelField: Component<{
  current?: ModelLike
  currentKey: string
  placeholder: string
  filter: (model: ModelLike) => boolean
  onChoose: (model: ModelLike) => void
  disabled?: boolean
}> = (props) => {
  const [state, setState] = createStore({ open: false })
  return (
    <div class="flex flex-col gap-2">
      <div class="flex">
        <Button
          variant="secondary"
          size="small"
          class="max-w-[280px] min-w-0 overflow-hidden"
          disabled={props.disabled}
          aria-expanded={state.open}
          onClick={() => setState("open", !state.open)}
        >
          <ModelTriggerContent model={props.current} placeholder={props.placeholder} open={state.open} />
        </Button>
      </div>
      <Show when={state.open}>
        <div class="flex h-72 flex-col overflow-hidden rounded-md border border-border bg-popover p-1 shadow-sm">
          <ModelList
            currentKey={props.currentKey}
            filter={props.filter}
            onChoose={(model) => {
              props.onChoose(model)
              setState("open", false)
            }}
            onSelect={() => setState("open", false)}
            class="p-1"
          />
        </div>
      </Show>
    </div>
  )
}

const THEME_BACKGROUND: Record<"light" | "dark", string> = {
  light: "深色背景（深蓝或近黑渐变）",
  dark: "浅色背景（浅灰或米白）",
}

/** 浅色主题配深色背景、深色主题配浅色背景，保证图标在任务栏/托盘上有足够对比。 */
const themedPrompt = (base: string, theme: "light" | "dark") =>
  `${base}\n\n主题适配：这是用于${theme === "light" ? "浅色" : "深色"}主题的版本，背景必须是${THEME_BACKGROUND[theme]}。参考图（若有）只用于参考主体造型、构图和主色，背景一律按上述要求重新生成，禁止沿用参考图背景。主体与背景保持高对比，${theme === "light" ? "在浅色任务栏上轮廓清晰" : "在深色任务栏上轮廓清晰"}；与参考图保持相同的主体造型与配色，仅背景明暗不同。`

/** 取图片四边像素的平均亮度（0-1），用来判断背景是深是浅；非 dataURL 或解码失败时返回 undefined。 */
const borderLuminance = async (src: string) => {
  if (!src.startsWith("data:")) return undefined
  const image = new Image()
  image.src = src
  if (
    !(await image.decode().then(
      () => true,
      () => false,
    ))
  )
    return undefined
  const size = 32
  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext("2d")
  if (!context) return undefined
  context.drawImage(image, 0, 0, size, size)
  const pixels = context.getImageData(0, 0, size, size).data
  const edges: number[] = []
  for (let i = 0; i < size; i++) {
    edges.push(i, (size - 1) * size + i, i * size, i * size + size - 1)
  }
  const total = edges.reduce((sum, index) => {
    const offset = index * 4
    return sum + (0.2126 * pixels[offset] + 0.7152 * pixels[offset + 1] + 0.0722 * pixels[offset + 2]) / 255
  }, 0)
  return total / edges.length
}

const AppIconGenerator: Component = () => {
  const platform = usePlatform()
  const dialog = useDialog()
  const globalSDK = useGlobalSDK()
  const models = useModels()
  const [state, setState] = createStore({
    prompt: "",
    refinePrompt: "",
    model: "",
    textModel: "",
    variants: undefined as { light: IconVariant; dark: IconVariant } | undefined,
    optimizing: false,
    generating: false,
    applying: false,
    frame: "square" as "square" | "circle",
  })

  // 选择器里的模型沿用会话输入框那套列表（分组 + 品牌图标/颜色 + 搜索），
  // 只有「当前选中」由本面板的 state 决定，不会改动会话模型。
  const isImageCandidate = (model: ModelLike) =>
    !!model.capabilities?.output?.image ||
    /^(agnes-image|gpt-image|dall-e|grok-imagine-image)/i.test(model.id) ||
    model.id === "sensenova-u1-fast"

  const imageModels = createMemo(() =>
    models
      .list()
      .filter((model) => isImageCandidate(model))
      .filter((model) => models.visible({ providerID: model.provider.id, modelID: model.id })),
  )

  createEffect(() => {
    const options = imageModels()
    if (state.model || options.length === 0) return
    const preferred =
      options.find((option) => option.id === "agnes-image-2.5-flash") ??
      options.find((option) => /^gpt-image/i.test(option.id)) ??
      options[0]
    setState("model", modelKeyOf(preferred))
  })

  const imageCurrent = () => imageModels().find((option) => modelKeyOf(option) === state.model)
  const imageModelId = () => imageCurrent()?.id ?? imageModels()[0]?.id ?? ""

  const fallbackImageModel = (exclude: string) => {
    const options = imageModels().filter((option) => option.id !== exclude)
    return (
      options.find((option) => /^gpt-image/i.test(option.id)) ??
      options.find((option) => /^grok-imagine-image/i.test(option.id))
    )
  }

  /** 优化提示词用的文本模型：只列可见且非图片输出的模型。 */
  const textModels = createMemo(() =>
    models
      .list()
      .filter((model) => !isImageCandidate(model))
      .filter((model) => models.visible({ providerID: model.provider.id, modelID: model.id })),
  )

  createEffect(() => {
    const options = textModels()
    if (state.textModel || options.length === 0) return
    const preferred = options.find((option) => /^(gpt-5|gpt-4)/i.test(option.id)) ?? options[0]
    setState("textModel", modelKeyOf(preferred))
  })

  const textCurrent = () => textModels().find((option) => modelKeyOf(option) === state.textModel)

  const optimizePrompt = async () => {
    const prompt = state.prompt.trim()
    if (!prompt || state.optimizing || state.generating) return
    setState("optimizing", true)
    try {
      const model = textCurrent() ?? textModels()[0]
      if (!model) throw new Error("请先在模型设置中连接并启用一个文本模型")
      const session = await globalSDK.client.session
        .globalCreate({ title: "优化应用图标提示词", model: { providerID: model.provider.id, id: model.id } })
        .then((result) => result.data)
      if (!session) throw new Error("无法创建临时生成会话")
      try {
        const instruction = `请将用户的简短描述优化为具体、可执行的应用图标设计提示词，供图片生成模型使用。明确主体、构图、配色和视觉风格，强调正方形画布、中心主体、高对比、简洁、无文字；不要指定背景明暗色，背景会按浅色/深色主题分别生成。只返回优化后的提示词，不要解释。用户描述：${prompt}`
        const response = await globalSDK.client.session
          .prompt({
            sessionID: session.id,
            model: { providerID: model.provider.id, modelID: model.id },
            agent: "build",
            tools: {},
            parts: [{ type: "text", text: instruction }],
          })
          .then((result) => result.data)
        const answer = response?.parts
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n")
          .trim()
        if (!answer) throw new Error("文本模型没有返回内容")
        setState("prompt", answer)
      } finally {
        await globalSDK.client.session.delete({ sessionID: session.id }).catch(() => undefined)
      }
    } catch (error) {
      showToast({ title: "优化提示词失败", description: error instanceof Error ? error.message : String(error) })
    } finally {
      setState("optimizing", false)
    }
  }

  const referenceImage = () => {
    const source = state.variants?.light.source
    if (!source) return undefined
    return source.base64 ? `data:image/png;base64,${source.base64}` : source.url
  }

  const generateIcon = async (mode: "fresh" | "refine" = "fresh") => {
    const base = state.prompt.trim()
    const refine = mode === "refine" ? state.refinePrompt.trim() : ""
    if (state.generating || state.optimizing || (mode === "refine" ? !refine : !base)) return
    // 微调时把「要改什么」作为编辑指令，并带上当前浅色版图片，让模型走图生图而不是重新画。
    const prompt = refine
      ? `${base ? `${base}\n\n` : ""}本次微调的要求（只改这些，主体造型与配色保持原样）：${refine}`
      : base
    const previous = mode === "refine" ? referenceImage() : undefined
    setState("generating", true)
    setState("variants", undefined)
    const requestVariant = async (model: string, theme: "light" | "dark", reference?: string) => {
      const response = await globalSDK.client.images.generate({
        imageGeneratePayload: {
          prompt: themedPrompt(prompt, theme),
          model: model || undefined,
          size: "1024x1024",
          n: 1,
          image: reference ? [reference] : undefined,
        },
      })
      const image = response.data?.images?.[0]
      if (!image || (!image.url && !image.base64))
        throw new Error(
          "所选模型未返回图像。请确认该模型已配置可用 API Key（内置模型依赖网关 Key），或换一个模型重试。",
        )
      return {
        source: { url: image.url, base64: image.base64 },
        preview: image.base64 ? `data:image/png;base64,${image.base64}` : image.url!,
      } satisfies IconVariant
    }
    // 先出浅色主题版，再拿它当参考图出深色主题版，让两版主体造型保持一致。
    const requestPair = async (model: string): Promise<[IconVariant, IconVariant]> => {
      // 部分模型（如 sensenova）只支持文生图，带参考图会被拒绝，这种情况退回独立生成。
      const refined = previous ? await requestVariant(model, "light", previous).catch(() => undefined) : undefined
      if (previous && !refined) {
        showToast({ title: "该模型不支持图像编辑", description: "已改为按你的描述重新生成，而不是在原图上微调。" })
      }
      const light = refined ?? (await requestVariant(model, "light"))
      const themed = await requestVariant(model, "dark", light.preview).catch(() => undefined)
      if (!themed) return [light, await requestVariant(model, "dark")]
      const [lightBorder, darkBorder] = await Promise.all([
        borderLuminance(light.preview),
        borderLuminance(themed.preview),
      ])
      // 参考图有时会把深色背景一起照抄，此时深色主题版就不是浅底了，退回独立生成保证背景真的换了。
      if (lightBorder !== undefined && darkBorder !== undefined && darkBorder - lightBorder < 0.25) {
        return [light, await requestVariant(model, "dark")]
      }
      return [light, themed]
    }
    try {
      const selected = imageModelId()
      const pair = await requestPair(selected).catch(async (error) => {
        const fallback = /^agnes-image/i.test(selected) ? fallbackImageModel(selected) : undefined
        if (!fallback) throw error
        const retry = await requestPair(fallback.id)
        setState("model", modelKeyOf(fallback))
        showToast({
          title: "已自动切换图片生成模型",
          description: `内置网关暂不支持 ${selected} 的图片生成，已改用 ${fallback.id} 完成生成。`,
        })
        return retry
      })
      setState("variants", { light: pair[0], dark: pair[1] })
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error)
      const friendly = /400|Bad Request|provider configured|No image generation/i.test(raw)
        ? "没有可用的图片生成供应商：请确认所选模型已配置 API Key（内置模型需网关 Key），或更换模型重试。"
        : raw
      showToast({ title: "生成图标失败", description: friendly })
    } finally {
      setState("generating", false)
    }
  }

  const applyIcon = async () => {
    const variants = state.variants
    if (!variants || state.applying) return
    setState("applying", true)
    try {
      const label = state.prompt.trim().slice(0, 40)
      const light = await platform.generateAppIconFromImage?.(
        variants.light.source,
        label,
        state.frame,
        "light",
        undefined,
        true,
      )
      if (!light) throw new Error("桌面图标应用接口不可用")
      await platform.generateAppIconFromImage?.(variants.dark.source, label, state.frame, "dark", light.icon, true)
      dialog.close()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: "图标已应用",
        description: "浅色与深色主题图标已分别保存，切换主题时自动使用对应版本。",
      })
    } catch (error) {
      showToast({ title: "应用图标失败", description: error instanceof Error ? error.message : String(error) })
    } finally {
      setState("applying", false)
    }
  }

  const busy = () => state.generating || state.optimizing || state.applying

  return (
    <Dialog
      title="自定义应用图标"
      description="选择图片生成模型，输入描述（可先优化提示词）；同时生成浅色与深色主题两个版本，预览确认后一并应用并保存。"
      class="w-full max-w-[620px] mx-auto"
      footer={
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="small" onClick={() => dialog.close()}>
            取消
          </Button>
          <Button
            variant="primary"
            size="small"
            disabled={!state.variants || state.applying}
            onClick={() => void applyIcon()}
          >
            <Show when={state.applying} fallback="应用图标">
              <span class="flex items-center gap-1.5">
                <Spinner class="size-3.5" />
                应用中…
              </span>
            </Show>
          </Button>
        </div>
      }
    >
      <div class="flex max-h-[75vh] flex-col gap-4 overflow-y-auto p-5">
        <div class="flex flex-col gap-2">
          <label class="text-13-medium text-foreground">图片生成模型</label>
          <ModelField
            current={imageCurrent()}
            currentKey={state.model}
            placeholder={imageModels().length ? "选择图片生成模型" : "没有可用的图片生成模型"}
            filter={isImageCandidate}
            disabled={busy()}
            onChoose={(option) => {
              const key = modelKeyOf(option)
              if (key === state.model) return
              setState("model", key)
              setState("variants", undefined)
            }}
          />
          <span class="text-12-regular text-foreground-subtle">
            使用已配置的图片生成模型产出图标：先出浅色主题版（深底），再以它为参考出深色主题版（浅底），保证两版主体一致。若网关暂不支持所选模型（如
            agnes-image），会自动改用可用的 gpt-image 模型并提示。
          </span>
          <Show when={imageModels().length === 0}>
            <span class="text-12-regular text-foreground-subtle">
              没有检测到可用的图片生成模型，请先在「设置 → 供应商」配置一个支持图片输出的模型（如内置的 gpt-image
              系列）。
            </span>
          </Show>
        </div>
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between gap-2">
            <label class="text-13-medium text-foreground">图标描述</label>
            <Button
              variant="ghost"
              size="small"
              icon={state.optimizing ? undefined : "brain"}
              disabled={!state.prompt.trim() || busy()}
              onClick={() => void optimizePrompt()}
            >
              <Show when={state.optimizing} fallback="优化提示词">
                <span class="flex items-center gap-1.5">
                  <Spinner class="size-3.5" />
                  优化中…
                </span>
              </Show>
            </Button>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-12-regular text-foreground-subtle">优化提示词模型</span>
            <ModelField
              current={textCurrent()}
              currentKey={state.textModel}
              placeholder={textModels().length ? "选择文本模型" : "没有可用的文本模型"}
              filter={(model) => !isImageCandidate(model)}
              disabled={busy()}
              onChoose={(option) => setState("textModel", modelKeyOf(option))}
            />
          </div>
          <TextField
            variant="normal"
            multiline
            value={state.prompt}
            placeholder="例如：深蓝渐变的极简纸飞机，圆角方形应用图标（只描述主体与风格，背景会自动按浅色/深色主题生成）"
            onChange={(value) => {
              setState("prompt", value)
              setState("variants", undefined)
            }}
            class="min-h-[96px]"
            disabled={state.optimizing || state.generating}
          />
          <div class="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="small"
              icon={state.generating ? undefined : "lu-image"}
              disabled={!state.prompt.trim() || !state.model || busy()}
              onClick={() => void generateIcon("fresh")}
            >
              <Show when={state.generating} fallback={state.variants ? "重新生成" : "生成预览"}>
                <span class="flex items-center gap-1.5">
                  <Spinner class="size-3.5" />
                  生成中…
                </span>
              </Show>
            </Button>
          </div>
        </div>
        <Show when={!!state.variants}>
          <div class="flex flex-col gap-2 rounded-xl border border-border bg-surface/40 p-3">
            <div class="flex flex-col gap-0.5">
              <span class="text-13-medium text-foreground">微调当前图标</span>
              <span class="text-12-regular text-foreground-subtle">
                当前浅色版图标会连同下面的提示词一起发给模型做图像编辑，只改你描述的部分。
              </span>
            </div>
            <TextField
              variant="normal"
              multiline
              value={state.refinePrompt}
              placeholder="例如：外框改成六边形、主体线条加粗、去掉网格底纹、整体提亮一档"
              onChange={(value) => setState("refinePrompt", value)}
              class="min-h-[64px]"
              disabled={state.generating}
            />
            <div class="flex justify-end">
              <Button
                variant="secondary"
                size="small"
                icon={state.generating ? undefined : "lu-image"}
                disabled={!state.refinePrompt.trim() || !state.model || busy()}
                onClick={() => void generateIcon("refine")}
              >
                <Show when={state.generating} fallback="基于当前图微调">
                  <span class="flex items-center gap-1.5">
                    <Spinner class="size-3.5" />
                    微调中…
                  </span>
                </Show>
              </Button>
            </div>
          </div>
        </Show>
        <div class="flex min-h-56 flex-col items-center justify-center gap-4 rounded-xl border border-border bg-background p-5">
          <Show
            when={state.variants}
            fallback={
              <div class="text-12-regular text-foreground-subtle">
                {state.generating
                  ? "正在生成浅色与深色两版图标…"
                  : "生成的图标会显示在这里：左侧浅色主题（深底）、右侧深色主题（浅底）"}
              </div>
            }
          >
            {(variants) => (
              <div class="flex flex-wrap items-start justify-center gap-6">
                <div class="flex flex-col items-center gap-2">
                  <img
                    src={variants().light.preview}
                    alt="浅色主题图标预览"
                    class={`size-32 border border-border object-cover shadow-sm ${state.frame === "circle" ? "rounded-full" : "rounded-3xl"}`}
                  />
                  <span class="text-12-regular text-foreground-subtle">浅色主题 · 深色背景</span>
                </div>
                <div class="flex flex-col items-center gap-2">
                  <img
                    src={variants().dark.preview}
                    alt="深色主题图标预览"
                    class={`size-32 border border-border object-cover shadow-sm ${state.frame === "circle" ? "rounded-full" : "rounded-3xl"}`}
                  />
                  <span class="text-12-regular text-foreground-subtle">深色主题 · 浅色背景</span>
                </div>
              </div>
            )}
          </Show>
          <Show when={!!state.variants}>
            <div class="flex items-center gap-2">
              <span class="text-12-regular text-foreground-subtle">应用外框</span>
              <Button
                variant={state.frame === "square" ? "primary" : "secondary"}
                size="small"
                disabled={busy()}
                onClick={() => setState("frame", "square")}
              >
                方形
              </Button>
              <Button
                variant={state.frame === "circle" ? "primary" : "secondary"}
                size="small"
                disabled={busy()}
                onClick={() => setState("frame", "circle")}
              >
                圆形
              </Button>
            </div>
            <span class="text-12-regular text-foreground-subtle">
              点击“应用图标”后，两张图会分别保存为浅色/深色版本，切换主题时自动生效。
            </span>
          </Show>
        </div>
      </div>
    </Dialog>
  )
}
