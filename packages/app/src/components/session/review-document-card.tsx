import { For, Show, createMemo, createSignal, onCleanup } from "solid-js"
import { Button } from "@novaway/ui/button"
import { Icon } from "@novaway/ui/icon"
import { ToolRegistry, type ToolProps } from "@novaway/ui/message-part"
import { showToast } from "@novaway/ui/toast"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useSDK } from "@/context/sdk"
import { useSessionLayout } from "@/pages/session/session-layout"
import { formatWait, kindLabelKey, replyToReview, sendReviewAsMessage, type ReviewDecision } from "./review-shared"

type Decision = "approved" | "revise" | "pending" | "cancelled"

const stringList = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : []

/**
 * 文档评审卡（PRD / 计划 / 方案）。
 *
 * 对齐 ZCode 的「计划」卡：标题、覆盖内容、查看完整文档。差别是这里的
 * 通过 / 调整都是点击即生效 —— 直接回复服务端的评审请求，代理拿到结论
 * 后继续下一步，不需要用户再回聊天框说一句「可以」。
 *
 * 数据来源是 `review_document` 工具调用的运行态 metadata（requestID /
 * 文档信息）与完成态 metadata（decision / feedback）。
 */
export function ReviewDocumentCard(props: ToolProps) {
  const language = useLanguage()
  const sdk = useSDK()
  const file = useFile()
  const layout = useLayout()
  const { tabs } = useSessionLayout()

  const [busy, setBusy] = createSignal(false)
  const [editing, setEditing] = createSignal(false)
  const [draft, setDraft] = createSignal("")
  const [local, setLocal] = createSignal<{ decision: Decision; feedback?: string }>()

  const t = (key: string, vars?: Record<string, string | number>) => language.t(key, vars)

  const path = createMemo(() => {
    const value = props.metadata?.path ?? props.input?.path
    return typeof value === "string" ? value : ""
  })
  const title = createMemo(() => {
    const value = props.metadata?.title ?? props.input?.title
    return typeof value === "string" ? value : ""
  })
  const kind = createMemo(() => kindLabelKey(props.metadata?.kind ?? props.input?.kind))
  const version = createMemo(() => {
    const value = props.metadata?.version ?? props.input?.version
    return typeof value === "string" && value.trim() ? value.trim() : undefined
  })
  const summary = createMemo(() => {
    const value = props.metadata?.summary ?? props.input?.summary
    return typeof value === "string" && value.trim() ? value.trim() : undefined
  })
  const highlights = createMemo(() => stringList(props.metadata?.highlights ?? props.input?.highlights))
  const questions = createMemo(() => stringList(props.metadata?.questions ?? props.input?.questions))
  const lines = createMemo(() => {
    const value = props.metadata?.lines
    return typeof value === "number" && value > 0 ? value : undefined
  })
  const requestID = createMemo(() => {
    const value = props.metadata?.requestID
    return typeof value === "string" && value ? value : undefined
  })

  const decision = createMemo<Decision | undefined>(() => {
    if (local()) return local()!.decision
    const value = props.metadata?.decision
    if (value === "approved" || value === "revise" || value === "pending" || value === "cancelled") return value
    return undefined
  })
  const feedback = createMemo(() => {
    const value = local()?.feedback ?? props.metadata?.feedback
    return typeof value === "string" && value.trim() ? value.trim() : undefined
  })
  const awaiting = createMemo(() => {
    if (decision()) return false
    return Boolean(requestID()) && (props.status === "running" || props.status === "pending")
  })

  // 代理停在这里等用户：卡片上显示已经等了多久，用户能判断是不是该处理了。
  const [now, setNow] = createSignal(Date.now())
  const timer = setInterval(() => setNow(Date.now()), 15_000)
  onCleanup(() => clearInterval(timer))
  const waited = createMemo(() => {
    if (!awaiting()) return undefined
    const start = props.timing?.start
    if (typeof start !== "number" || start <= 0) return undefined
    return t("session.review.awaiting", { time: formatWait(now() - start) })
  })

  // `pending` 表示代理等超时停了，但用户的结论仍然有意义：点击后会把结论作为
  // 一条普通消息发回去（见 reply 里的失效分支），所以按钮照常显示。
  const actionable = createMemo(() => {
    if (decision() === "pending") return Boolean(requestID())
    if (decision()) return false
    return Boolean(requestID()) && (props.status === "running" || props.status === "pending")
  })

  const meta = createMemo(() => {
    const parts = [version(), lines() !== undefined ? t("session.review.lines", { count: lines()! }) : undefined]
    return parts.filter(Boolean).join(" · ")
  })

  const openDocument = () => {
    const target = file.normalize(path())
    if (!target) return
    void file.load(target)
    const tab = file.tab(target)
    void tabs().open(tab)
    tabs().setActive(tab)
    layout.sidePane.add("preview")
  }

  const reply = (next: ReviewDecision, note?: string) => {
    const id = requestID()
    const sessionID = props.sessionID ?? ""
    if (!id || busy()) return
    const feedback = note?.trim() || undefined
    setBusy(true)
    void replyToReview({
      client: sdk.client,
      directory: sdk.directory,
      sessionID,
      requestID: id,
      decision: next,
      feedback,
    })
      .then((result) => {
        setLocal({ decision: next, feedback })
        if (next === "revise") {
          setEditing(false)
          setDraft("")
        }
        if (result.data) return
        // 请求已经结算（代理等超时停了、会话被清）。用户的动作意图仍然有效：
        // 把结论作为一条普通消息发回去，代理按自己的恢复路径继续。
        if (!sessionID) {
          showToast({ title: t("session.review.stale") })
          return
        }
        const text =
          next === "approved"
            ? t("session.review.message.approved", { title: title(), path: path() })
            : t("session.review.message.revise", {
                title: title(),
                path: path(),
                feedback: feedback ?? "",
              })
        void sendReviewAsMessage({ client: sdk.client, directory: sdk.directory, sessionID, text })
          .then(() => showToast({ title: t("session.review.staleSent") }))
          .catch((error: unknown) =>
            showToast({
              title: t("session.review.approveFailed"),
              description: error instanceof Error ? error.message : String(error),
            }),
          )
      })
      .catch((error: unknown) =>
        showToast({
          title: t("session.review.approveFailed"),
          description: error instanceof Error ? error.message : String(error),
        }),
      )
      .finally(() => setBusy(false))
  }

  const statusLine = createMemo(() => {
    const value = decision()
    if (value === "approved")
      return { tone: "approved" as const, text: t("session.review.approved"), icon: "circle-check" as const }
    if (value === "revise")
      return { tone: "revise" as const, text: t("session.review.revising"), icon: "checklist" as const }
    if (value === "cancelled")
      return { tone: "muted" as const, text: t("session.review.cancelled"), icon: "circle-x" as const }
    if (value === "pending")
      return { tone: "muted" as const, text: t("session.review.pending"), icon: "lu-clock" as const }
    return undefined
  })

  return (
    <div data-component="document-review-card" data-state={decision() ?? "awaiting"}>
      <div data-slot="document-review-head">
        <span data-slot="document-review-kind">
          <Icon name="checklist" size="small" />
          <span>{t(kind())}</span>
        </span>
        <div data-slot="document-review-meta-group">
          <Show when={waited()}>
            <span data-slot="document-review-wait" class="tabular-nums">
              <Icon name="lu-clock" size="small" />
              {waited()}
            </span>
          </Show>
          <Show when={meta()}>
            <span data-slot="document-review-meta" class="tabular-nums">
              {meta()}
            </span>
          </Show>
        </div>
      </div>

      <div data-slot="document-review-title">{title()}</div>

      <Show when={path()}>
        <button type="button" data-slot="document-review-path" onClick={openDocument}>
          <Icon name="folder" size="small" />
          <span>{path()}</span>
        </button>
      </Show>

      <Show when={summary()}>
        <p data-slot="document-review-summary">{summary()}</p>
      </Show>

      <Show when={highlights().length > 0}>
        <ul data-slot="document-review-list">
          <For each={highlights()}>
            {(item) => (
              <li>
                <span data-slot="document-review-dot" />
                <span>{item}</span>
              </li>
            )}
          </For>
        </ul>
      </Show>

      <Show when={questions().length > 0}>
        <div data-slot="document-review-questions">
          <div data-slot="document-review-questions-title">{t("session.review.questions")}</div>
          <For each={questions()}>{(item) => <div data-slot="document-review-question">· {item}</div>}</For>
        </div>
      </Show>

      <Show when={feedback()}>
        <div data-slot="document-review-feedback">
          <div data-slot="document-review-questions-title">{t("session.review.feedback")}</div>
          <div data-slot="document-review-feedback-text">{feedback()}</div>
        </div>
      </Show>

      <Show when={statusLine()}>
        {(line) => (
          <div data-slot="document-review-status" data-tone={line().tone}>
            <Icon name={line().icon} size="small" />
            <span>{line().text}</span>
          </div>
        )}
      </Show>

      <Show when={actionable()}>
        <Show when={decision() === "pending"}>
          <p data-slot="document-review-hint">{t("session.review.expiredHint")}</p>
        </Show>
        <div data-slot="document-review-actions">
          <Button variant="secondary" size="small" icon="folder" onClick={openDocument}>
            {t("session.review.open")}
          </Button>
          <Button variant="primary" size="small" icon="check" disabled={busy()} onClick={() => reply("approved")}>
            {t("session.review.approve")}
          </Button>
          <Button variant="ghost" size="small" disabled={busy()} onClick={() => setEditing((value) => !value)}>
            {t("session.review.revise")}
          </Button>
        </div>

        <Show when={editing()}>
          <div data-slot="document-review-revise">
            <textarea
              data-slot="document-review-textarea"
              rows={3}
              placeholder={t("session.review.revisePlaceholder")}
              value={draft()}
              onInput={(event) => setDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setEditing(false)
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) reply("revise", draft())
              }}
            />
            <div data-slot="document-review-revise-footer">
              <span data-slot="document-review-hint">{t("session.review.reviseHint")}</span>
              <Button
                variant="primary"
                size="small"
                disabled={busy() || draft().trim().length === 0}
                onClick={() => reply("revise", draft())}
              >
                {t("common.submit")}
              </Button>
            </div>
          </div>
        </Show>
      </Show>
    </div>
  )
}

ToolRegistry.register({
  name: "review_document",
  render: (props) => <ReviewDocumentCard {...props} />,
})
