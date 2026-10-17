import { createSignal, Show } from "solid-js"
import { Button } from "@novaway/ui/button"
import { Icon } from "@novaway/ui/icon"
import { IconButton } from "@novaway/ui/icon-button"
import { Spinner } from "@novaway/ui/spinner"
import { showToast } from "@novaway/ui/toast"
import { useLanguage } from "@/context/language"
import { useLocal } from "@/context/local"
import { useSDK } from "@/context/sdk"
import type { SidePaneSessionTab } from "@/context/layout"
import { clearSideChatSeed, getSideChatSeed, type SideChatQuote } from "@/pages/session/side-chat-seed"

/**
 * 辅助对话的输入框。
 *
 * **视觉与主输入框一致**（对齐 ZCode：辅助对话的 composer 和主对话是同一个组件形态 ——
 * 顶部是模型/权限那排，中间是输入区，底部左侧是 + @ / 、右侧是发送）。
 * 用户在不同窗口之间切换时，不应该还要重新认一遍输入框长什么样。
 *
 * 从聊天区/文件预览里「在辅助对话中提问」带进来的选中内容，显示成输入框
 * **上方的一张引用卡片**（不是塞进输入框的正文），发送时作为 synthetic 文本块
 * 一并给模型 —— 与主输入框的引用卡片语义一致。
 *
 * 实现上没有复用主线的 `PromptInput`：那个组件牵着整条 prompt store
 * （草稿持久化、@ 提及、附件、命令面板、斜杠菜单），而辅助对话要的是
 * "把选中内容带进来、问一句"。这里只保留外观一致 + 最小闭环。
 */
export function SideChatComposer(props: { tab: SidePaneSessionTab }) {
  const language = useLanguage()
  const sdk = useSDK()
  const local = useLocal()

  // 读取「待带入内容」：不删除，面板在打开动画里重挂载也不会把引用弄丢。
  // 发送成功或用户移除引用后才清除。
  const seed = getSideChatSeed(props.tab.sessionID)
  const [quote, setQuote] = createSignal<SideChatQuote | undefined>(seed?.quote)
  const [draft, setDraft] = createSignal(seed?.draft ?? "")
  const [sending, setSending] = createSignal(false)

  const modelLabel = () => local.model.current()?.name ?? language.t("dialog.model.select.title")

  const quoteText = (value: SideChatQuote) => {
    const header = value.label ? `${language.t("sidePane.sideChat.quote")}（${value.label}）：` : `${language.t("sidePane.sideChat.quote")}：`
    return `${header}\n${value.text
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n")}`
  }

  const send = async () => {
    const text = draft().trim()
    if (!text || sending()) return
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
      await sdk.client.session.promptAsync({
        sessionID: props.tab.sessionID,
        agent,
        model: { providerID: model.provider.id, modelID: model.id },
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
          { type: "text", text },
        ],
      })
      setDraft("")
      setQuote(undefined)
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

  return (
    <div class="shrink-0 px-2 pb-2">
      {/* 外壳与主输入框同款：rounded-2xl + input 边框/底色 + p-3。 */}
      <div class="rounded-2xl border border-input-border bg-input p-3 transition-colors focus-within:border-input-border-focused focus-within:bg-input-focused">
        {/* 顶部：模型与权限（只读展示，改动仍走主线；辅助对话沿用主线的选择）。 */}
        <div class="flex items-center gap-2 pb-2 text-ui-sm text-foreground-subtle">
          <span class="flex min-w-0 items-center gap-1.5">
            <Icon name="models" size="small" class="shrink-0 text-foreground-subtlest" />
            <span class="truncate">{modelLabel()}</span>
          </span>
          <span class="text-foreground-subtlest">·</span>
          <span class="shrink-0">{language.t("sidePane.sideChat.inheritsMain")}</span>
        </div>

        {/* 引用卡片：选中内容带进来时显示，可单独移除。 */}
        <Show when={quote()}>
          {(value) => (
            <div
              data-component="side-chat-quote"
              class="mb-2 flex min-w-0 flex-col gap-1 rounded-lg bg-surface px-2.5 py-2 shadow-xs-border"
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

        <textarea
          value={draft()}
          rows={2}
          placeholder={language.t("sidePane.sideChat.placeholder")}
          class="max-h-40 min-h-14 w-full resize-none bg-transparent px-0.5 py-1 text-ui-base text-foreground outline-none placeholder:text-foreground-subtlest"
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

        {/* 底部：左侧 + @ /（外观与主输入框一致；辅助对话只支持纯文本，
            所以这三个是**不可点**的占位符而不是按钮 —— 点不动的按钮比没有更糟）。 */}
        <div class="flex items-center gap-1 pt-1">
          <span
            aria-hidden="true"
            class="flex items-center gap-2.5 px-1.5 text-ui-base text-foreground-subtlest select-none"
          >
            <span>+</span>
            <span>@</span>
            <span>/</span>
          </span>
          <div class="flex-1" />
          <Show when={sending()} fallback={
            <Button
              variant="primary"
              size="small"
              class="size-8 shrink-0 rounded-full p-0"
              disabled={!draft().trim()}
              aria-label={language.t("prompt.action.send")}
              onClick={() => void send()}
            >
              <Icon name="paper-plane" size="small" />
            </Button>
          }>
            <Spinner class="m-1.5 size-4 shrink-0 text-foreground-subtlest" />
          </Show>
        </div>
      </div>
    </div>
  )
}
