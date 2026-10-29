import { createSignal, Show } from "solid-js"
import { Icon } from "@novaway/ui/icon"
import { useLanguage } from "@/context/language"
import type { ErrorKind } from "@/pages/session/session-error"

/**
 * 会话错误卡片。
 *
 * 上游报错经常是一整段 JSON（`custom stream failed 400: {"error":{"message":"upstream_400",…}}`），
 * 直接铺在聊天区既是噪音也读不懂。这里分两层：
 *
 * - **一句人话**：按归类给"发生了什么 + 能做什么"。
 * - **原始详情**：默认收起，点「详情」才展开，方便真的需要排查时复制。
 *
 * 归类在 `message-timeline.data.ts` 里做（纯函数、可单测），这里只管呈现与文案。
 *
 * 只负责「历史轮次的报错」这种中性卡片。**当前这一轮**的意外中断不在这里画：
 * 它由输入框上方的 `SessionInterruptedBar` 承担（琥珀色单行条 + 继续按钮），
 * 时间线里那条 Error 行会整行跳过。
 */
export function SessionErrorCard(props: { kind: ErrorKind; detail: string }) {
  const language = useLanguage()
  const [open, setOpen] = createSignal(false)

  // 每种归类给一句"是什么 + 怎么办"。翻译缺失时回落到英文默认值
  // （其他语言的字典里没有这些新键，直接显示 key 会很难看）。
  const FALLBACK: Record<ErrorKind, [string, string]> = {
    aborted: ["Request stopped", "The response was interrupted. Send the message again to continue."],
    rateLimit: [
      "Model service is rate limited",
      "All available accounts are cooling down. Wait a moment and try again.",
    ],
    auth: ["Model service rejected the credentials", "Check the provider's API key in Settings → Providers."],
    upstream: ["The model service is temporarily unavailable", "The upstream returned an error. Try again shortly."],
    model: ["The selected model is unavailable", "Pick another model, or check the provider's model list."],
    network: ["Could not reach the model service", "Check your network or proxy, then try again."],
    context: ["The conversation no longer fits the model", "Start a new task, or trim the context and retry."],
    unknown: ["Something went wrong", "The model request failed. Try again; expand the details if it keeps happening."],
  }

  const text = (suffix: "title" | "hint") => {
    const key = `session.error.${props.kind}.${suffix}`
    const fallback = FALLBACK[props.kind][suffix === "title" ? 0 : 1]
    const out = language.t(key as Parameters<typeof language.t>[0])
    return !out || out === key ? fallback : out
  }

  const details = () => (
    <Show when={props.detail.trim()}>
      <Show when={open()}>
        <pre class="mt-1.5 max-h-40 overflow-auto rounded-md border border-border bg-background/60 p-2 text-ui-xs leading-5 text-foreground-subtle whitespace-pre-wrap break-all select-text">
          {props.detail}
        </pre>
      </Show>
    </Show>
  )

  const detailsToggle = () => (
    <Show when={props.detail.trim()}>
      <button
        type="button"
        class="flex w-fit items-center gap-1 text-ui-xs text-foreground-subtle transition-colors hover:text-foreground"
        aria-expanded={open()}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name={open() ? "chevron-down" : "chevron-right"} size="small" class="shrink-0" />
        {language.t("session.error.details") === "session.error.details"
          ? "Details"
          : language.t("session.error.details")}
      </button>
    </Show>
  )

  return (
    <div data-component="session-error" class="flex flex-col gap-1.5">
      <div class="flex items-start gap-2">
        <Icon name="circle-ban-sign" size="small" class="mt-0.5 shrink-0 text-[var(--destructive)]" />
        <div class="flex min-w-0 flex-col gap-0.5">
          <span class="text-ui-base font-medium text-foreground">{text("title")}</span>
          <span class="text-ui-caption text-foreground-subtle">{text("hint")}</span>
        </div>
      </div>
      <Show when={props.detail.trim()}>
        <div class="flex flex-col gap-1 pl-6">
          {detailsToggle()}
          {details()}
        </div>
      </Show>
    </div>
  )
}
