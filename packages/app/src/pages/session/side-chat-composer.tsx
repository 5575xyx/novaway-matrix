import { createSignal, Show } from "solid-js"
import { IconButton } from "@novaway/ui/icon-button"
import { Spinner } from "@novaway/ui/spinner"
import { showToast } from "@novaway/ui/toast"
import { useLanguage } from "@/context/language"
import { useLocal } from "@/context/local"
import { useSDK } from "@/context/sdk"
import type { SidePaneSessionTab } from "@/context/layout"
import { takeSideChatSeed } from "@/pages/session/side-chat-seed"

/**
 * 侧边对话的输入框。
 *
 * 面板里**不**复用主线的 `PromptInput`：那个组件牵着整条 prompt store
 * （草稿持久化、@ 提及、附件、命令面板……），而侧边对话要的恰恰是"随手问一句"。
 * 这里只做最小闭环：一个 textarea + 发送，走 `session.promptAsync`。
 *
 * 上下文继承靠"同工作区 + 同 agent/model"实现 —— 侧边对话是同一目录下的真实会话，
 * 能看见同样的文件；再额外带一段主线最近对话的摘要是多余的，反而会污染提示词。
 */
export function SideChatComposer(props: { tab: SidePaneSessionTab }) {
  const language = useLanguage()
  const sdk = useSDK()
  const local = useLocal()

  // 挂载时取走「待发送草稿」（从文件预览里选行后点"在辅助对话中提问"会写入）。
  // 一次性：取走即删，避免切回标签时重复填充。
  const [draft, setDraft] = createSignal(takeSideChatSeed(props.tab.sessionID) ?? "")
  const [sending, setSending] = createSignal(false)

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
      await sdk.client.session.promptAsync({
        sessionID: props.tab.sessionID,
        agent,
        model: { providerID: model.provider.id, modelID: model.id },
        parts: [{ type: "text", text }],
      })
      setDraft("")
    } catch (err) {
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
    <div class="shrink-0 border-t border-border p-2">
      <div class="flex items-end gap-1.5 rounded-lg border border-border bg-background p-1.5 focus-within:border-border-hover">
        <textarea
          value={draft()}
          rows={1}
          placeholder={language.t("sidePane.sideChat.placeholder")}
          class="max-h-32 min-h-7 flex-1 resize-none bg-transparent px-1 py-0.5 text-ui-base text-foreground outline-none placeholder:text-foreground-subtlest"
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
        <Show
          when={!sending()}
          fallback={<Spinner class="m-1.5 size-4 shrink-0 text-foreground-subtlest" />}
        >
          <IconButton
            icon="arrow-up"
            variant="ghost"
            size="small"
            class="shrink-0"
            disabled={!draft().trim()}
            aria-label={language.t("prompt.action.send")}
            onClick={() => void send()}
          />
        </Show>
      </div>
    </div>
  )
}
