import { For, Show, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@novaway/ui/button"
import { Icon } from "@novaway/ui/icon"
import { showToast } from "@novaway/ui/toast"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { createAdaptivePoll } from "@/utils/adaptive-poll"
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
  const sync = useSync()
  const [store, setStore] = createStore({
    items: [] as Pending[],
    pending: "",
    error: "",
  })
  const [feedback, setFeedback] = createSignal<{ id: string; text: string } | undefined>(undefined)

  let inflight = false
  const load = () => {
    const id = sessionID()
    if (!id || sdk.directory === "global-chat" || inflight) return
    inflight = true
    void sdk.client.session.planApproval
      .list({ directory: sdk.directory, sessionID: id })
      .then((result) => {
        // 主会话的审批在聊天区由计划文档卡展示；状态面板只承载子代理审批，
        // 否则同一个 request 会同时出现两张可点击卡片。
        const items = (result.data ?? []).filter((item) => Boolean((item as Pending).parentID)) as Pending[]
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
  // 计划审批只在意"有没有待批的计划"：会话在跑、或手上已有待批项时才值得 2 秒一问，
  // 其余时间退到 20 秒；窗口不可见时完全不跑（回到前台再补）。
  const poll = createAdaptivePoll(load, {
    fast: 2000,
    idle: 20_000,
    active: () => store.items.length > 0 || sync.data.session_working(sessionID()),
    immediate: false,
  })
  onCleanup(() => poll.stop())

  const reply = (item: Pending, execution?: "standard" | "goal" | "long_task" | false) => {
    const approved = execution !== undefined && execution !== false
    const note = feedback()?.id === item.id ? feedback()!.text.trim() : ""
    setStore("pending", item.id)
    void sdk.client.session.planApproval
      .reply({
        directory: sdk.directory,
        sessionID: sessionID(),
        requestID: item.id,
        approved,
        ...(execution ? { execution } : {}),
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
            : language.t("statusPanel.planApproval.continued"),
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
                    onClick={() => reply(item, "standard")}
                  >
                    {language.t("statusPanel.planApproval.startExecution")}
                  </Button>
                  <Button
                    variant="secondary"
                    size="small"
                    disabled={store.pending === item.id}
                    onClick={() => reply(item, "goal")}
                  >
                    {language.t("statusPanel.planApproval.goalExecution")}
                  </Button>
                  <Button
                    variant="secondary"
                    size="small"
                    disabled={store.pending === item.id}
                    onClick={() => reply(item, "long_task")}
                  >
                    {language.t("statusPanel.planApproval.longTaskExecution")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="small"
                    disabled={store.pending === item.id}
                    onClick={() =>
                      setFeedback((prev) => (prev?.id === item.id ? undefined : { id: item.id, text: "" }))
                    }
                  >
                    {language.t("statusPanel.planApproval.continuePlanning")}
                  </Button>
                  <Show when={feedback()?.id === item.id}>
                    <Button
                      variant="ghost"
                      size="small"
                      disabled={store.pending === item.id || !feedback()?.text.trim()}
                      onClick={() => reply(item, false)}
                    >
                      {language.t("statusPanel.planApproval.submitFeedback")}
                    </Button>
                  </Show>
                </div>
              </div>
            )}
          </For>
          <Show when={store.error}>
            <div class="px-2 text-ui-xs text-critical-base">{store.error}</div>
          </Show>
        </div>
      ),
    }
  })

  return section
}
