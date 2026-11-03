import { createSignal, For, Show } from "solid-js"
import { ProviderIcon } from "@novaway/ui/provider-icon"
import { modelColor, modelIconId } from "@/utils/provider-icon"
import { Button } from "@novaway/ui/button"
import { Icon } from "@novaway/ui/icon"
import { IconButton } from "@novaway/ui/icon-button"
import { Spinner } from "@novaway/ui/spinner"
import { showToast } from "@novaway/ui/toast"
import { ModelSelectorPopover } from "@/components/dialog-select-model"
import { PermissionModeSelect } from "@/components/permission-mode-select"
import { ThinkingEffortPopover } from "@/components/thinking-effort-popover"
import { useLanguage } from "@/context/language"
import { useLocal } from "@/context/local"
import { useModels } from "@/context/models"
import { useSDK } from "@/context/sdk"
import type { SidePaneSessionTab } from "@/context/layout"
import { clearSideChatSeed, getSideChatSeed, type SideChatQuote } from "@/pages/session/side-chat-seed"

type Attachment = { id: string; filename: string; mime: string; dataUrl: string }

/**
 * 辅助对话的输入框。
 *
 * **与主输入框完全一致**（对齐 ZCode：辅助对话的 composer 和主对话是同一个形态）：
 * 顶部是模型 / 思考强度 / 项目权限那排（组件与主输入框是同一套），中间是引用卡片与输入区，
 * 底部是 + @ / 与发送。用户在不同窗口之间切换时，不该重新认一遍输入框长什么样，
 * 也不该少掉主对话里能做的事（选模型、调思考强度、挂附件、调权限）。
 *
 * 从聊天区/文件预览里「在辅助对话中提问」带进来的选中内容，显示成输入框
 * **上方的一张引用卡片**（不是塞进输入框的正文），发送时作为 synthetic 文本块
 * 一并给模型 —— 与主输入框的引用卡片语义一致。
 */
export function SideChatComposer(props: { tab: SidePaneSessionTab }) {
  const language = useLanguage()
  const sdk = useSDK()
  const local = useLocal()
  const models = useModels()

  // 读取「待带入内容」：不删除，面板在打开动画里重挂载也不会把引用弄丢。
  // 发送成功或用户移除引用后才清除。
  const seed = getSideChatSeed(props.tab.sessionID)
  const [quote, setQuote] = createSignal<SideChatQuote | undefined>(seed?.quote)
  const [draft, setDraft] = createSignal(seed?.draft ?? "")
  const [attachments, setAttachments] = createSignal<Attachment[]>([])
  const [sending, setSending] = createSignal(false)
  let fileInputRef: HTMLInputElement | undefined
  let textareaRef: HTMLTextAreaElement | undefined

  const modelLabel = () =>
    models.autoMode() ? "Auto" : (local.model.current()?.name ?? language.t("dialog.model.select.title"))
  // 模型图标/名字颜色：主输入框同一套解析（聚合网关按模型名认厂商）。
  const currentModel = () => local.model.current()
  const iconId = () =>
    modelIconId(currentModel()?.provider?.id, currentModel()?.provider?.name, currentModel()?.id, currentModel()?.name)
  const nameColor = () =>
    modelColor(currentModel()?.provider?.id, currentModel()?.provider?.name, currentModel()?.id, currentModel()?.name)

  const insertText = (value: string) => {
    const element = textareaRef
    if (!element) {
      setDraft(draft() + value)
      return
    }
    const start = element.selectionStart ?? draft().length
    const end = element.selectionEnd ?? start
    const next = draft().slice(0, start) + value + draft().slice(end)
    setDraft(next)
    requestAnimationFrame(() => {
      element.focus()
      element.setSelectionRange(start + value.length, start + value.length)
    })
  }

  const addFiles = (files: FileList | null) => {
    if (!files) return
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = typeof reader.result === "string" ? reader.result : ""
        if (!dataUrl) return
        setAttachments((current) => [
          ...current,
          { id: `${Date.now()}-${current.length}`, filename: file.name, mime: file.type, dataUrl },
        ])
      }
      reader.readAsDataURL(file)
    }
  }

  const quoteText = (value: SideChatQuote) => {
    const header = value.label
      ? `${language.t("sidePane.sideChat.quote")}（${value.label}）：`
      : `${language.t("sidePane.sideChat.quote")}：`
    return `${header}\n${value.text
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n")}`
  }

  const send = async () => {
    const text = draft().trim()
    if ((!text && attachments().length === 0) || sending()) return
    const agent = local.agent.current()?.name
    const model = local.model.current()
    if (!agent || !model) {
      showToast({
        variant: "error",
        title: language.t("prompt.toast.modelAgentRequired.title"),
        description: language.t("prompt.toast.modelAgentRequired.description"),
      })
      return
    }
    setSending(true)
    try {
      const activeQuote = quote()
      const files = attachments()
      await sdk.client.session.promptAsync({
        sessionID: props.tab.sessionID,
        agent,
        model: { providerID: model.provider.id, modelID: model.id },
        variant: local.model.variant.current(),
        parts: [
          ...(activeQuote
            ? [
                {
                  type: "text" as const,
                  text: quoteText(activeQuote),
                  synthetic: true,
                  metadata: activeQuote.path ? { quote: { path: activeQuote.path } } : undefined,
                },
              ]
            : []),
          ...files.map((file) => ({
            type: "file" as const,
            mime: file.mime,
            url: file.dataUrl,
            filename: file.filename,
          })),
          ...(text ? [{ type: "text" as const, text }] : []),
        ],
      })
      setDraft("")
      setQuote(undefined)
      setAttachments([])
      clearSideChatSeed(props.tab.sessionID)
    } catch {
      showToast({
        variant: "error",
        title: language.t("prompt.toast.promptSendFailed.title"),
        description: language.t("prompt.toast.promptSendFailed.description"),
      })
    } finally {
      setSending(false)
    }
  }

  const controlStyle = { height: "28px", "border-radius": "8px" }

  return (
    <div class="shrink-0 px-2 pb-2">
      {/* 外壳与主输入框同款：rounded-2xl + input 边框/底色 + p-3。 */}
      <div class="rounded-2xl border border-input-border bg-input p-3 transition-colors hover:border-input-border-hover focus-within:border-input-border-focused focus-within:bg-input-focused">
        {/* 顶部工具栏：模型 / 变体 / 项目权限 —— 与主输入框逐项一致。 */}
        <div class="flex flex-wrap items-center gap-2 border-b border-border px-2 pb-1 pt-2 min-w-0">
          <ModelSelectorPopover
            model={local.model}
            triggerAs={Button}
            triggerProps={{
              variant: "ghost",
              size: "normal",
              style: controlStyle,
              class: "min-w-0 max-w-[200px] overflow-hidden text-13-medium text-foreground group",
              "data-action": "side-chat-model",
            }}
          >
            <Show when={models.autoMode()}>
              <Icon name="autopilot" class="size-4 shrink-0 text-icon-blue transition-opacity duration-150" />
            </Show>
            <Show when={!models.autoMode() && currentModel()?.provider?.id}>
              <ProviderIcon
                id={iconId()}
                colorId={iconId()}
                brand
                class="size-4 shrink-0 text-icon-blue transition-opacity duration-150"
              />
            </Show>
            <span
              class="min-w-0 truncate"
              style={
                nameColor()
                  ? { color: nameColor() }
                  : {
                      background: "linear-gradient(135deg, var(--icon-blue), #8b5cf6)",
                      "-webkit-background-clip": "text",
                      "-webkit-text-fill-color": "transparent",
                      "background-clip": "text",
                    }
              }
            >
              {modelLabel()}
            </span>
            <Icon name="chevron-down" size="small" class="shrink-0" />
          </ModelSelectorPopover>

          {/* 思考强度：与主输入框同一个下拉（图标 + 档位文字 + 滑块弹层），
              没有档位的模型直接不渲染。 */}
          <Show when={!models.autoMode()}>
            <div class="shrink-0">
              <ThinkingEffortPopover
                model={local.model}
                triggerStyle={controlStyle}
                triggerClass="shrink-0 whitespace-nowrap"
              />
            </div>
          </Show>

          <div class="flex-1" />

          <div class="flex shrink-0 items-center whitespace-nowrap">
            <PermissionModeSelect sessionID={props.tab.sessionID} />
          </div>
        </div>

        {/* 引用卡片：选中内容带进来时显示，可单独移除。 */}
        <Show when={quote()}>
          {(value) => (
            <div
              data-component="side-chat-quote"
              class="mt-2 flex min-w-0 flex-col gap-1 rounded-lg bg-surface px-2.5 py-2 shadow-xs-border"
            >
              <div class="flex min-w-0 items-center gap-1.5">
                <Icon name="quote" size="small" class="shrink-0 text-foreground-subtle" />
                <span class="min-w-0 flex-1 truncate text-11-medium text-foreground">
                  {value().label || language.t("sidePane.sideChat.quote")}
                </span>
                <IconButton
                  type="button"
                  icon="close-small"
                  variant="ghost"
                  class="size-5 shrink-0 text-foreground-subtle"
                  aria-label={language.t("prompt.context.removeFile")}
                  onClick={() => {
                    setQuote(undefined)
                    clearSideChatSeed(props.tab.sessionID)
                  }}
                />
              </div>
              <div class="line-clamp-3 whitespace-pre-wrap break-words text-11-regular text-foreground-subtle">
                {value().text}
              </div>
            </div>
          )}
        </Show>

        {/* 附件（与主输入框的图片附件同款缩略图）。 */}
        <Show when={attachments().length > 0}>
          <div class="mt-2 flex flex-wrap gap-2">
            <For each={attachments()}>
              {(file) => (
                <div class="group relative size-14 overflow-hidden rounded-md border border-border">
                  <img src={file.dataUrl} alt={file.filename} class="size-full object-cover" />
                  <IconButton
                    type="button"
                    icon="close-small"
                    variant="ghost"
                    class="absolute right-0.5 top-0.5 size-5 bg-background/80 text-foreground-subtle"
                    aria-label={language.t("prompt.attachment.remove")}
                    onClick={() => setAttachments((current) => current.filter((item) => item.id !== file.id))}
                  />
                </div>
              )}
            </For>
          </div>
        </Show>

        <div class="relative">
          <textarea
            ref={(el) => (textareaRef = el)}
            value={draft()}
            rows={2}
            placeholder={language.t("sidePane.sideChat.placeholder")}
            class="max-h-40 min-h-14 w-full resize-none bg-transparent px-2.5 py-2 text-13-regular leading-6 text-foreground outline-none placeholder:text-foreground-subtlest"
            onInput={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              // 与主输入框一致：Enter 发送、Shift+Enter 换行；
              // 输入法组字期间的回车不算发送（否则会打断候选词上屏）。
              if (event.isComposing) return
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            }}
          />
        </div>

        {/* 底部：+ @ / 与发送 —— 与主输入框同一排、同一尺寸。 */}
        <div class="flex items-center gap-1 px-1 pt-1">
          <input
            ref={(el) => (fileInputRef = el)}
            type="file"
            accept="image/*"
            multiple
            class="hidden"
            onChange={(event) => {
              addFiles(event.currentTarget.files)
              event.currentTarget.value = ""
            }}
          />
          <Button
            type="button"
            variant="ghost"
            class="size-8 p-0"
            aria-label={language.t("prompt.action.attachFile")}
            onClick={() => fileInputRef?.click()}
          >
            <Icon name="link" class="size-4.5 text-icon-blue" />
          </Button>
          <Button type="button" variant="ghost" class="size-8 p-0" aria-label="提及 @" onClick={() => insertText("@")}>
            <span class="text-sm font-semibold text-icon-blue">@</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            class="size-8 p-0"
            aria-label="斜杠命令 /"
            onClick={() => insertText("/")}
          >
            <span class="text-sm font-semibold text-icon-blue">/</span>
          </Button>
          <div class="flex-1" />
          <Show
            when={sending()}
            fallback={
              <Button
                variant="primary"
                size="small"
                class="size-8 shrink-0 rounded-full p-0"
                disabled={!draft().trim() && attachments().length === 0}
                aria-label={language.t("prompt.action.send")}
                onClick={() => void send()}
              >
                <Icon name="paper-plane" size="small" />
              </Button>
            }
          >
            <Spinner class="m-1.5 size-4 shrink-0 text-foreground-subtlest" />
          </Show>
        </div>
      </div>
    </div>
  )
}
