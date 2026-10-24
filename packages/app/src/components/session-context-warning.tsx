import { Show, createSignal } from "solid-js"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { useSync } from "@/context/sync"
import { useSessionContextData } from "@/components/session/use-session-context"

/**
 * 上下文接近自动压缩阈值时的提示。
 * 与内核 `session/overflow.ts` 的阈值保持一致：阈值前 20k 提示，达阈值后
 * 变为错误色，硬上限前 3k 提示必须手动压缩。
 */
export function SessionContextWarning() {
  const { ctx } = useSessionContextData()
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const sync = useSync()
  const [compacting, setCompacting] = createSignal(false)

  const busy = (sessionID: string) => sync.data.session_status[sessionID]?.type === "busy"

  const visible = () => {
    const value = ctx()
    if (!value?.budget) return
    if (value.budget.status === "normal") return
    return value
  }

  const compact = async (message: NonNullable<ReturnType<typeof ctx>>["message"]) => {
    if (compacting() || busy(message.sessionID)) return
    setCompacting(true)
    try {
      await globalSDK.client.session.summarize({
        sessionID: message.sessionID,
        providerID: message.providerID,
        modelID: message.modelID,
        auto: false,
      })
    } catch {
      // 失败会通过会话错误事件展示，这里只恢复按钮状态。
    } finally {
      setCompacting(false)
    }
  }

  return (
    <Show when={visible()} keyed>
      {(value) => (
        <div
          data-slot="session-context-warning"
          classList={{
            "mx-1 mb-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-md px-2 py-1 text-ui-xs":
              true,
            "text-warning": value.budget!.status !== "blocking",
            "text-destructive": value.budget!.status === "blocking",
          }}
        >
          <span class="font-medium">
            {language.t(
              value.budget!.status === "blocking" ? "context.usage.blocking" : "context.usage.warning",
            )}
          </span>
          <span class="text-foreground-subtle">·</span>
          <span>{language.t("context.usage.remaining", { percent: value.budget!.percentLeft ?? 0 })}</span>
          <span class="text-foreground-subtle">·</span>
          <button
            type="button"
            class="underline underline-offset-2 transition-opacity hover:opacity-80 disabled:opacity-50"
            disabled={compacting() || busy(value.message.sessionID)}
            onClick={() => void compact(value.message)}
          >
            {language.t(compacting() ? "context.usage.compacting" : "context.usage.compactNow")}
          </button>
        </div>
      )}
    </Show>
  )
}
