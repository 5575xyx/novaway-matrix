import { Show, createEffect, createMemo, createSignal } from "solid-js"
import { Button } from "@novaway/ui/button"
import { Icon } from "@novaway/ui/icon"
import { Markdown } from "@novaway/ui/markdown"
import { ToolRegistry, type ToolProps } from "@novaway/ui/message-part"
import { showToast } from "@novaway/ui/toast"
import { useLanguage } from "@/context/language"
import { useFile } from "@/context/file"
import { useLayout } from "@/context/layout"
import { useSessionLayout } from "@/pages/session/session-layout"
import { createOpenSessionFileTab } from "@/pages/session/helpers"
import { useSDK } from "@/context/sdk"
import { useNotification } from "@/context/notification"

type Decision = "pending" | "approved" | "continue"
type Execution = "standard" | "goal" | "long_task"

/**
 * 主会话的计划审批卡。
 *
 * 计划完成不是普通澄清问题：它需要展示计划文档，并把用户的决定直接
 * 回传给 plan-approval 服务，让阻塞中的 plan_exit 继续。因此这里不能复用
 * question 工具，否则会得到默认的英文问卷 UI。
 */
export function PlanApprovalCard(props: ToolProps) {
  const language = useLanguage()
  const sdk = useSDK()
  const notification = useNotification()
  const file = useFile()
  const layout = useLayout()
  const sessionLayout = useSessionLayout()
  const [busy, setBusy] = createSignal(false)
  const [local, setLocal] = createSignal<Decision>()
  const [feedbackOpen, setFeedbackOpen] = createSignal(false)
  const [feedback, setFeedback] = createSignal("")

  const t = (key: string) => language.t(key)
  const requestID = createMemo(() => {
    const value = props.metadata?.requestID
    return typeof value === "string" && value ? value : undefined
  })
  const plan = createMemo(() => {
    const value = props.metadata?.plan
    return typeof value === "string" ? value : ""
  })
  const preview = createMemo(() => {
    const value = props.metadata?.planText
    return typeof value === "string" ? value : ""
  })
  const openPlanFile = createOpenSessionFileTab({
    normalizeTab: (tab) => file.tab(tab),
    openTab: sessionLayout.tabs().open,
    pathFromTab: file.pathFromTab,
    loadFile: file.load,
    openReviewPanel: () => {
      if (!sessionLayout.view().reviewPanel.opened()) sessionLayout.view().reviewPanel.open()
      layout.sidePane.add("preview")
      layout.sidePane.open()
    },
    setActive: sessionLayout.tabs().setActive,
  })
  const decision = createMemo<Decision>(() => {
    if (local()) return local()!
    const value = props.metadata?.approvalState
    if (value === "approved" || value === "continue") return value
    return "pending"
  })
  const actionable = createMemo(() => Boolean(requestID()) && decision() === "pending" && !busy())

  createEffect(() => {
    const id = requestID()
    const sessionID = props.sessionID
    if (!id || !sessionID || decision() !== "pending") return
    notification.session.planApproval(sdk.directory, sessionID, id, plan())
  })

  const reply = (approved: boolean, execution?: Execution, reason?: string) => {
    const id = requestID()
    const sessionID = props.sessionID ?? ""
    if (!id || !sessionID || !actionable()) return
    setBusy(true)
    setLocal(approved ? "approved" : "continue")
    void sdk.client.session.planApproval
      .reply({
        directory: sdk.directory,
        sessionID,
        requestID: id,
        approved,
        ...(execution ? { execution } : {}),
        ...(reason?.trim() ? { feedback: reason.trim() } : {}),
      })
      .then((result) => {
        if (!result.data) {
          setLocal("pending")
          showToast({ title: t("planApproval.stale") })
        }
      })
      .catch((error: unknown) => {
        setLocal("pending")
        showToast({
          title: t("planApproval.replyFailed"),
          description: error instanceof Error ? error.message : String(error),
        })
      })
      .finally(() => setBusy(false))
  }

  return (
    <div data-component="plan-approval-card" data-state={decision()}>
      <div data-slot="plan-approval-card-head">
        <span data-slot="plan-approval-card-kind">
          <Icon name="checklist" size="small" />
          <span>{t("planApproval.title")}</span>
        </span>
        <Show when={decision() === "pending"}>
          <span data-slot="plan-approval-card-status">{t("planApproval.awaiting")}</span>
        </Show>
        <Show when={decision() === "approved"}>
          <span data-slot="plan-approval-card-status">{t("planApproval.approved")}</span>
        </Show>
        <Show when={decision() === "continue"}>
          <span data-slot="plan-approval-card-status">{t("planApproval.continue")}</span>
        </Show>
      </div>

      <Show when={plan()}>
        <div data-slot="plan-approval-card-path-row">
          <div data-slot="plan-approval-card-path">{plan()}</div>
          <Button
            variant="ghost"
            size="small"
            class="plan-approval-open-plan"
            onClick={() => openPlanFile(plan())}
            disabled={!plan()}
          >
            <Icon name="eye" size="small" />
            {t("planApproval.openPlan")}
          </Button>
        </div>
      </Show>
      <Show when={decision() === "pending" && (preview() || actionable())}>
        <div data-slot="plan-approval-card-body">
          <Show when={preview()}>
            <div data-slot="plan-approval-card-preview" data-scrollable>
              <Markdown text={preview()} />
            </div>
          </Show>

          <Show when={actionable()}>
            <div data-slot="plan-approval-card-action-layer">
            <Show
              when={feedbackOpen()}
              fallback={
                <div data-slot="plan-approval-card-actions">
                  <Button
                    data-action="plan-approve-standard"
                    variant="primary"
                    size="large"
                    class="plan-approval-action plan-approval-action-standard"
                    onClick={() => reply(true, "standard")}
                  >
                    <Icon name="play" size="small" />
                    <span class="plan-approval-action-copy">
                      <span class="plan-approval-action-label">{t("planApproval.startExecution")}</span>
                      <span class="plan-approval-action-hint">{t("planApproval.startExecutionHint")}</span>
                    </span>
                  </Button>
                  <Button
                    data-action="plan-approve-goal"
                    variant="secondary"
                    size="large"
                    class="plan-approval-action plan-approval-action-goal"
                    onClick={() => reply(true, "goal")}
                  >
                    <Icon name="target" size="small" />
                    <span class="plan-approval-action-copy">
                      <span class="plan-approval-action-label">{t("planApproval.goalExecution")}</span>
                      <span class="plan-approval-action-hint">{t("planApproval.goalExecutionHint")}</span>
                    </span>
                  </Button>
                  <Button
                    data-action="plan-approve-long-task"
                    variant="secondary"
                    size="large"
                    class="plan-approval-action plan-approval-action-long-task"
                    onClick={() => reply(true, "long_task")}
                  >
                    <Icon name="task" size="small" />
                    <span class="plan-approval-action-copy">
                      <span class="plan-approval-action-label">{t("planApproval.longTaskExecution")}</span>
                      <span class="plan-approval-action-hint">{t("planApproval.longTaskExecutionHint")}</span>
                    </span>
                  </Button>
                  <Button
                    data-action="plan-continue"
                    variant="ghost"
                    size="large"
                    class="plan-approval-action plan-approval-action-continue"
                    onClick={() => {
                      setFeedback("")
                      setFeedbackOpen(true)
                    }}
                  >
                    <Icon name="edit" size="small" />
                    <span class="plan-approval-action-copy">
                      <span class="plan-approval-action-label">{t("planApproval.continuePlanning")}</span>
                      <span class="plan-approval-action-hint">{t("planApproval.continuePlanningHint")}</span>
                    </span>
                  </Button>
                </div>
              }
            >
              <form
                data-slot="plan-approval-card-feedback"
                onSubmit={(event) => {
                  event.preventDefault()
                  const value = feedback().trim()
                  if (!value) return
                  reply(false, undefined, value)
                }}
              >
                <label for="plan-approval-feedback" class="text-12-medium text-foreground-subtle">
                  {t("planApproval.feedbackLabel")}
                </label>
                <textarea
                  id="plan-approval-feedback"
                  autofocus
                  rows={3}
                  value={feedback()}
                  placeholder={t("planApproval.feedbackPlaceholder")}
                  class="min-h-20 w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-13-regular text-foreground outline-none transition-colors placeholder:text-foreground-subtlest focus:border-interactive-base"
                  onInput={(event) => setFeedback(event.currentTarget.value)}
                />
                <div class="flex flex-wrap justify-end gap-2">
                  <Button type="button" variant="ghost" size="small" onClick={() => setFeedbackOpen(false)}>
                    {t("planApproval.cancelFeedback")}
                  </Button>
                  <Button type="submit" variant="primary" size="small" disabled={!feedback().trim()}>
                    {t("planApproval.submitFeedback")}
                  </Button>
                </div>
              </form>
            </Show>
          </div>
        </Show>
      </div>
      </Show>
    </div>
  )
}

ToolRegistry.register({
  name: "plan_exit",
  render: (props) => <PlanApprovalCard {...props} />,
})
