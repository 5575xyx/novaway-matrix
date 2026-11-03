import { For, Show, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@novaway/ui/button"
import { Icon } from "@novaway/ui/icon"
import { showToast } from "@novaway/ui/toast"
import type { DocumentReviewPending1 } from "@novaway/sdk/v2"
import {
  formatWait,
  kindLabelKey,
  replyToReview,
  sendReviewAsMessage,
  type ReviewDecision,
  type ReviewPending,
} from "@/components/session/review-shared"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useSDK } from "@/context/sdk"
import { useSessionLayout } from "@/pages/session/session-layout"
import type { StatusPanelSection } from "./status-panel"

const text = (error: unknown) => (error instanceof Error ? error.message : String(error))

const toPending = (item: DocumentReviewPending1): ReviewPending => ({
  id: item.id,
  sessionID: item.sessionID,
  path: item.path,
  kind: item.kind,
  title: item.title,
  ...(item.version ? { version: item.version } : {}),
  createdAt: typeof item.createdAt === "number" && Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
})

/**
 * 待评审文档（PRD / 计划 / 方案）。
 *
 * 代理把文档挂到评审通道后会结束本轮（会话回到空闲），不再占着"运行中"。
 * 卡片在聊天流里，但长会话里用户可能已经滚走或切到了别的会话；状态面板这里
 * 再放一份，结论照样点一下生效。服务端会广播 requested / resolved，到了就刷新；
 * 2 秒轮询兜底（重载页面、错过事件）。
 */
export function useDocumentReviewSection(sessionID: () => string): () => StatusPanelSection | null {
  const sdk = useSDK()
  const language = useLanguage()
  const file = useFile()
  const layout = useLayout()
  const { tabs } = useSessionLayout()

  const [store, setStore] = createStore({
    items: [] as ReviewPending[],
    pending: "",
    editing: "",
    error: "",
  })
  const [draft, setDraft] = createSignal("")
  const [now, setNow] = createSignal(Date.now())

  const t = (key: string, vars?: Record<string, string | number>) => language.t(key, vars)

  let inflight = false
  const load = () => {
    const id = sessionID()
    if (!id || inflight) return
    inflight = true
    void sdk.client.session.documentReview
      .list({ directory: sdk.directory, sessionID: id })
      .then((result) => {
        const items = (result.data ?? []).map(toPending)
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
      setStore({ items: [], error: "", pending: "", editing: "" })
      setDraft("")
      if (id) load()
    }),
  )

  const offRequested = sdk.event.on("document_review.requested", (event) => {
    if (event.properties.sessionID !== sessionID()) return
    load()
    showToast({
      icon: "checklist",
      title: t("session.review.title"),
      description: event.properties.title,
    })
  })
  const offResolved = sdk.event.on("document_review.resolved", (event) => {
    if (event.properties.sessionID !== sessionID()) return
    load()
  })
  onCleanup(() => {
    offRequested()
    offResolved()
  })

  const poll = setInterval(load, 2000)
  const clock = setInterval(() => setNow(Date.now()), 15_000)
  onCleanup(() => {
    clearInterval(poll)
    clearInterval(clock)
  })

  const openDocument = (path: string) => {
    const target = file.normalize(path)
    if (!target) return
    void file.load(target)
    const tab = file.tab(target)
    void tabs().open(tab)
    tabs().setActive(tab)
    layout.sidePane.add("preview")
  }

  const reply = (item: ReviewPending, next: ReviewDecision, note?: string) => {
    if (store.pending) return
    const feedback = note?.trim() || undefined
    setStore("pending", item.id)
    // 评审工具已经不阻塞：登记完就返回、本轮结束，所以真正让代理继续的是下面
    // 这条用户消息。服务端 reply 只做结算（把请求从待评审列表里摘掉），失败也照发。
    void replyToReview({
      client: sdk.client,
      directory: sdk.directory,
      sessionID: item.sessionID,
      requestID: item.id,
      decision: next,
      feedback,
    })
      .catch(() => undefined)
      .then(() => {
        setStore("editing", "")
        setDraft("")
        const message =
          next === "approved"
            ? t("session.review.message.approved", { title: item.title, path: item.path })
            : t("session.review.message.revise", {
                title: item.title,
                path: item.path,
                feedback: feedback ?? "",
              })
        return sendReviewAsMessage({
          client: sdk.client,
          directory: sdk.directory,
          sessionID: item.sessionID,
          text: message,
        })
      })
      .catch((error: unknown) => showToast({ title: t("common.requestFailed"), description: text(error) }))
      .finally(() => {
        setStore("pending", "")
        load()
      })
  }

  return createMemo<StatusPanelSection | null>(() => {
    if (store.items.length === 0) return null
    return {
      id: "document-review",
      title: t("statusPanel.documentReview.title"),
      summary: <span class="tabular-nums">{store.items.length}</span>,
      ticker: () => t("statusPanel.documentReview.ticker", { count: store.items.length }),
      defaultOpen: true,
      children: (
        <div class="flex flex-col gap-1 pb-1">
          <For each={store.items}>
            {(item) => (
              <div class="flex min-w-0 flex-col gap-1 rounded-lg px-2 py-1.5 transition-colors hover:bg-hover">
                <div class="flex min-w-0 items-center gap-2">
                  <Icon name="checklist" size="small" class="shrink-0 text-foreground" />
                  <span class="min-w-0 flex-1 truncate text-ui-base text-foreground">{item.title}</span>
                  <span class="shrink-0 text-ui-xs tabular-nums text-warning">
                    {t("session.review.awaiting", { time: formatWait(now() - item.createdAt) })}
                  </span>
                </div>
                <div class="flex min-w-0 items-center gap-2">
                  <span class="text-ui-xs text-foreground-subtlest">{t(kindLabelKey(item.kind))}</span>
                  <button
                    type="button"
                    class="min-w-0 flex-1 truncate text-left font-mono text-ui-xs text-foreground-subtle hover:text-foreground"
                    title={item.path}
                    onClick={() => openDocument(item.path)}
                  >
                    {item.path}
                  </button>
                </div>
                <Show when={store.editing === item.id}>
                  <textarea
                    class="min-h-16 resize-y rounded-md border border-border bg-surface px-2 py-1 text-ui-xs text-foreground outline-none focus:border-border-focus"
                    rows={2}
                    placeholder={t("session.review.revisePlaceholder")}
                    value={draft()}
                    onInput={(event) => setDraft(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setStore("editing", "")
                      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) reply(item, "revise", draft())
                    }}
                  />
                </Show>
                <div class="flex items-center gap-1">
                  <Button
                    variant="primary"
                    size="small"
                    disabled={store.pending === item.id}
                    onClick={() => reply(item, "approved")}
                  >
                    {t("session.review.approve")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="small"
                    disabled={store.pending === item.id}
                    onClick={() => setStore("editing", store.editing === item.id ? "" : item.id)}
                  >
                    {t("session.review.revise")}
                  </Button>
                  <Show when={store.editing === item.id}>
                    <Button
                      variant="secondary"
                      size="small"
                      disabled={store.pending === item.id || draft().trim().length === 0}
                      onClick={() => reply(item, "revise", draft())}
                    >
                      {t("common.submit")}
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
}
