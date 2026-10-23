import { For, Show, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@novaway/ui/button"
import { Icon } from "@novaway/ui/icon"
import { showToast } from "@novaway/ui/toast"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import type { StatusPanelSection } from "./status-panel"

type Pending = {
  id: string
  sessionID: string
  parentID?: string
  messageID?: string
  plan: string
  title?: string
  createdAt: number
}

const text = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * 子代理计划审批。
 *
 * 子代理跑完计划后会阻塞等待 lead 决策（见 `session/plan-approval.ts`）。
 * 这里把它展示成状态面板里的一张卡：批准后子代理继续实施，拒绝则回到计划阶段。
 *
 * 没有服务端推送，沿用其它区块的 2 秒轮询；内容不变时不写 store，避免卡片重建。
 */
export function usePlanApprovalSection(sessionID: () => string): () => StatusPanelSection | null {
  const sdk = useSDK()
  const language = useLanguage()
  const [store, setStore] = createStore({
    items: [] as Pending[],
    pending: "",
    error: "",
  })
  const [feedback, setFeedback] = createSignal<{ id: string; text: string } | undefined>(undefined)

  let inflight = false
  const load = () => {
    const id = sessionID()
    if (!id || inflight) return
    inflight = true
    void sdk.client.session.planApproval
      .list({ directory: sdk.directory, sessionID: id })
      .then((result) => {
        const items = (result.data ?? []) as Pending[]
        if (JSON.stringify(items) === JSON.stringify(store.items)) return
        setStore({ items, error: "" })
      })
      .catch((error: unknown) => setStore("error", text(error)))
      .finally(() => {
        inflight = false
      })
  }

  createEffect(
    on(sessionID, (id) => {
      setStore({ items: [], error: "" })
      if (id) load()
    }),
  )
  const timer = setInterval(load, 2000)
  onCleanup(() => clearInterval(timer))

  const reply = (item: Pending, approved: boolean) => {
    const note = feedback()?.id === item.id ? feedback()!.text.trim() : ""
    setStore("pending", item.id)
    void sdk.client.session.planApproval
      .reply({
        directory: sdk.directory,
        sessionID: sessionID(),
        requestID: item.id,
        approved,
        ...(note ? { feedback: note } : {}),
      })
      .then((result) => {
        if (!result.data) {
          showToast({ title: language.t("statusPanel.planApproval.stale") })
          return
        }
        showToast({
          title: approved
            ? language.t("statusPanel.planApproval.approved")
            : language.t("statusPanel.planApproval.rejected"),
        })
        setFeedback(undefined)
        load()
      })
      .catch((error: unknown) => showToast({ title: language.t("common.requestFailed"), description: text(error) }))
      .finally(() => setStore("pending", ""))
  }

  const section = createMemo<StatusPanelSection | null>(() => {
    if (store.items.length === 0) return null
    return {
      id: "plan-approval",
      title: language.t("statusPanel.planApproval.title"),
      summary: <span class="tabular-nums">{store.items.length}</span>,
      defaultOpen: true,
      children: (
        <div class="flex flex-col gap-1 pb-1">
          <For each={store.items}>
            {(item) => (
              <div class="flex min-w-0 flex-col gap-1 rounded-lg px-2 py-1.5 transition-colors hover:bg-hover">
                <div class="flex min-w-0 items-center gap-2">
                  <Icon name="checklist" size="small" class="shrink-0 text-foreground" />
                  <span class="min-w-0 flex-1 truncate text-ui-base text-foreground">{item.title ?? item.plan}</span>
                </div>
                <div class="truncate font-mono text-ui-xs text-foreground-subtlest">{item.plan}</div>
                <Show when={feedback()?.id === item.id}>
                  <input
                    class="h-7 rounded-md border border-border bg-surface px-2 text-ui-xs text-foreground outline-none focus:border-border-focus"
                    placeholder={language.t("statusPanel.planApproval.feedbackPlaceholder")}
                    value={feedback()?.text ?? ""}
                    onInput={(event) => setFeedback({ id: item.id, text: event.currentTarget.value })}
                    onKeyDown={(event) => event.key === "Escape" && setFeedback(undefined)}
                  />
                </Show>
                <div class="flex items-center gap-1">
                  <Button
                    variant="secondary"
                    size="small"
                    disabled={store.pending === item.id}
                    onClick={() => reply(item, true)}
                  >
                    {language.t("statusPanel.planApproval.approve")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="small"
                    disabled={store.pending === item.id}
                    onClick={() =>
                      setFeedback((prev) => (prev?.id === item.id ? undefined : { id: item.id, text: "" }))
                    }
                  >
                    {language.t("statusPanel.planApproval.reject")}
                  </Button>
                  <Show when={feedback()?.id === item.id}>
                    <Button
                      variant="ghost"
                      size="small"
                      disabled={store.pending === item.id}
                      onClick={() => reply(item, false)}
                    >
                      {language.t("statusPanel.planApproval.sendReject")}
                    </Button>
                  </Show>
                </div>
              </div>
            )}
          </For>
          <Show when={store.error}>
            <div class="px-2 text-ui-xs text-destructive">{store.error}</div>
          </Show>
        </div>
      ),
    }
  })

  return section
}
