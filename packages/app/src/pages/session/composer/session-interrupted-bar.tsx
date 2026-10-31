import { createMemo, Show } from "solid-js"
import { Button } from "@novaway/ui/button"
import { Icon } from "@novaway/ui/icon"
import { Tooltip } from "@novaway/ui/tooltip"
import { showToast } from "@novaway/ui/toast"
import { writeClipboard } from "@novaway/ui/util/clipboard"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useSessionKey } from "@/pages/session/session-layout"

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * 输入框上方的「任务中断」提示条。
 *
 * 对齐 ZCode：这一条**始终挂在输入框正上方**（不是跟着会话底部走），只有一行卡片高度，
 * 一眼能看到"这轮没跑完 + 为什么断的 + 可以继续"。
 *
 * 只有**意外中断**才出现：
 *  - 最后一轮最后一条 assistant 带 error 且不是 `MessageAbortedError`（那是用户自己点的停止）；
 *  - 或没有 error 但也没有 `time.completed`（进程/流被硬切断）。
 * 会话还在跑、或这一轮已经正常收尾时不出现，所以「继续」点完、开始跑起来它就自然消失。
 */
export function SessionInterruptedBar() {
  const language = useLanguage()
  const sync = useSync()
  const sdk = useSDK()
  const route = useSessionKey()

  const sessionID = createMemo(() => route.params.id)

  /** 意外中断的现场（原因 + 所属用户消息）；null 表示不该显示这条。 */
  const interrupted = createMemo(() => {
    const id = sessionID()
    if (!id) return
    const status = sync.data.session_status[id]?.type ?? "idle"
    if (status !== "idle") return
    const messages = sync.data.message[id] ?? []
    const user = messages.findLast((message) => message.role === "user")
    if (!user) return
    const attempts = messages.filter((message) => message.role === "assistant" && message.parentID === user.id)
    const last = attempts.at(-1)
    if (!last || last.role !== "assistant") return
    // 用户主动停止：这是用户的决定，不给「继续」。
    if (last.error?.name === "MessageAbortedError") return
    const data = last.error?.data
    const reason =
      typeof data === "object" && data !== null && "message" in data && typeof data.message === "string"
        ? data.message
        : undefined
    if (last.error) return { userMessageID: user.id, reason: reason ?? "" }
    if (typeof last.time.completed !== "number") return { userMessageID: user.id, reason: reason ?? "" }
    return
  })

  const reason = createMemo(() => interrupted()?.reason ?? "")

  const resume = () => {
    const id = sessionID()
    if (!id) return
    void sdk.client.session.resume({ sessionID: id }).catch((error) => {
      showToast({ title: language.t("session.error.resume.failed"), description: errorMessage(error) })
    })
  }

  const copy = () => {
    const value = reason().trim() || language.t("session.error.resume.title")
    void writeClipboard(value).then((copied) => {
      showToast(
        copied
          ? { variant: "success", icon: "circle-check", title: language.t("common.copied") }
          : { variant: "error", title: language.t("toast.copyFailed.title"), description: value },
      )
    })
  }

  return (
    <Show when={interrupted()}>
      <div
        data-component="session-interrupted-bar"
        class="relative mb-1.5 flex w-full items-center gap-2 overflow-hidden rounded-xl px-2.5 py-1.5 backdrop-blur-xl"
        style={{
          // 鲜艳琥珀 + 半透明 + 毛玻璃。
          // 这里不能用 `--syntax-warning`：它是主题里「语法高亮」的暖色，novaway 主题把它
          // 压成了发暗的 #934a13，叠在浅底上就是用户说的"棕色"。
          // 改用调色板里的 amber-9(#ffb224)：色相干净、明度高；
          // 半透明靠"纯色层 + opacity"实现，避免 color-mix 再把它调暗。
          "--interrupted-amber": "var(--amber-light-9, #ffb224)",
          "backdrop-filter": "blur(16px) saturate(1.8)",
          "-webkit-backdrop-filter": "blur(16px) saturate(1.8)",
          "box-shadow": "0 10px 26px -18px var(--interrupted-amber)",
        }}
      >
        <span
          aria-hidden="true"
          class="pointer-events-none absolute inset-0 opacity-[0.18] dark:opacity-[0.26]"
          style={{ background: "var(--interrupted-amber)" }}
        />
        <span
          aria-hidden="true"
          class="pointer-events-none absolute inset-0 rounded-xl"
          style={{ "box-shadow": "inset 0 0 0 1px var(--interrupted-amber)", opacity: "0.6" }}
        />
        <span
          class="relative z-10 grid size-6 shrink-0 place-items-center rounded-full"
          style={{ background: "var(--interrupted-amber)" }}
        >
          <Icon name="warning" size="small" style={{ color: "#1f1300" }} />
        </span>
        <span class="relative z-10 shrink-0 text-13-medium text-foreground">
          {language.t("session.error.resume.title")}
        </span>
        <Tooltip
          value={reason() || language.t("session.error.resume.hint")}
          placement="top"
          gutter={6}
          class="relative z-10 min-w-0 flex-1"
        >
          <span class="block cursor-help truncate font-mono text-12-regular text-foreground-subtle">
            {reason() || language.t("session.error.resume.hint")}
          </span>
        </Tooltip>
        <Show when={reason().trim()}>
          <button
            type="button"
            class="relative z-10 flex size-6 shrink-0 items-center justify-center rounded-md text-foreground-subtle transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
            title={language.t("session.error.resume.copy")}
            aria-label={language.t("session.error.resume.copy")}
            onClick={copy}
          >
            <Icon name="copy" size="small" />
          </button>
        </Show>
        <Tooltip
          value={language.t("session.error.resume.tooltip")}
          placement="top"
          gutter={6}
          class="relative z-10 shrink-0"
        >
          <Button
            variant="secondary"
            size="small"
            data-action="session-error-resume"
            class="shrink-0"
            style={{
              background: "var(--interrupted-amber)",
              "border-color": "var(--interrupted-amber)",
              color: "#1f1300",
            }}
            onClick={resume}
          >
            {language.t("session.error.resume.action")}
          </Button>
        </Tooltip>
      </div>
    </Show>
  )
}
