import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Popover } from "@opencode-ai/ui/popover"
import { Tag } from "@opencode-ai/ui/tag"
import { showToast } from "@opencode-ai/ui/toast"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePowersNexus } from "@/context/powersnexus"
import { useSessionLayout } from "@/pages/session/session-layout"
import { useSync } from "@/context/sync"

const phaseLabel: Record<string, string> = {
  uninitialized: "未初始化",
  needs_classification: "待分级",
  needs_clarification: "待澄清",
  needs_specification: "待规格",
  needs_design: "待设计",
  needs_plan: "待计划",
  ready_to_implement: "可实施",
  implementing: "实施中",
  needs_traceability: "待追溯",
  needs_delivery_config: "待配置交付",
  ready_to_verify: "待验证",
  verifying: "验证中",
  repairing: "修复中",
  ready_to_archive: "待归档",
  archiving: "归档中",
  completed: "已完成",
  blocked: "已阻塞",
}

function shortDigest(value?: string) {
  if (!value) return "—"
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value
}

export function PowersNexusPanel() {
  const language = useLanguage()
  const pn = usePowersNexus()
  const { params } = useSessionLayout()
  const sync = useSync()
  const [shown, setShown] = createSignal(false)
  const [creating, setCreating] = createSignal(false)
  const sessionID = createMemo(() => params.id)
  const sessionTitle = createMemo(() => {
    const id = sessionID()
    if (!id) return undefined
    return sync.data.session.find((item) => item.id === id)?.title
  })
  const snapshot = createMemo(() => pn.store.snapshot)
  const tasks = createMemo(() => snapshot()?.tasks ?? [])
  const blockers = createMemo(() => snapshot()?.blockers ?? [])
  const requirements = createMemo(() => snapshot()?.requirements ?? [])
  const steps = createMemo(() => pn.store.run?.steps ?? [])
  const badge = createMemo(() => {
    if (blockers().length > 0) return blockers().length
    if (snapshot()?.status === "running") return "…"
    if (snapshot()?.phase === "ready_to_verify" || snapshot()?.phase === "ready_to_archive") return "!"
    return undefined
  })

  createEffect(() => {
    if (shown() && !pn.store.ready) void pn.refreshAll(sessionID())
  })

  const toastError = (err: unknown) =>
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: err instanceof Error ? err.message : String(err),
    })

  const onCreateAndBind = async () => {
    const id = sessionID()
    if (!id) {
      toastError(new Error(language.t("powersnexus.error.noSession" as never)))
      return
    }
    setCreating(true)
    try {
      await pn.createAndBind({ sessionID: id, title: sessionTitle() })
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("powersnexus.toast.createOk" as never),
        description: language.t("powersnexus.toast.createOkDesc" as never),
      })
    } catch (err) {
      toastError(err)
    } finally {
      setCreating(false)
    }
  }

  const onArchive = async () => {
    try {
      await pn.archive()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("powersnexus.toast.archiveOk" as never),
        description: language.t("powersnexus.toast.archiveOkDesc" as never),
      })
    } catch (err) {
      toastError(err)
    }
  }

  const onOpenLog = async (stepID: string) => {
    const runID = pn.store.run?.run?.id ?? snapshot()?.delivery?.activeRunID
    if (!runID) return
    try {
      await pn.refreshLog({ runID, stepID })
    } catch (err) {
      toastError(err)
    }
  }

  return (
    <Popover
      open={shown()}
      onOpenChange={(open) => {
        setShown(open)
        pn.setPanelOpen(open)
        // 仅刷新状态；不在打开面板时创建 Change（等级需等用户发任务后再评估）
        if (open) void pn.refreshAll(sessionID())
      }}
      triggerAs={IconButton}
      triggerProps={{
        icon: "checklist",
        variant: "ghost",
        class: "relative size-8",
        "aria-label": language.t("powersnexus.panel.title" as never),
      }}
      trigger={
        <Tooltip value={language.t("powersnexus.panel.title" as never)} placement="bottom">
          <div class="relative flex size-8 items-center justify-center">
            <Icon name="checklist" size="small" class="text-icon-base" />
            <Show when={badge()}>
              <span class="pointer-events-none absolute -right-0.5 -top-0.5 min-w-4 h-4 px-1 rounded-full bg-surface-base-active text-[10px] leading-4 text-text-strong text-center border border-border-weak-base">
                {badge()}
              </span>
            </Show>
          </div>
        </Tooltip>
      }
      class="[&_[data-slot=popover-body]]:p-0 w-[min(92vw,420px)] max-w-[calc(100vw-32px)] bg-background-strong shadow-[var(--shadow-lg-border-base)] rounded-lg border border-border-weak-base"
      gutter={8}
      placement="bottom-end"
    >
      <Show when={shown()}>
        <div class="flex max-h-[min(80vh,640px)] flex-col overflow-hidden">
        <div class="flex items-center justify-between gap-2 px-4 py-3 border-b border-border-weak-base">
          <div class="flex flex-col gap-0.5 min-w-0">
            <div class="text-14-medium text-text-strong">{language.t("powersnexus.panel.title" as never)}</div>
            <div class="text-12-regular text-text-weak truncate">
              {snapshot()?.changeName ?? language.t("powersnexus.panel.noChange" as never)}
            </div>
          </div>
          <div class="flex items-center gap-1">
            <Tooltip value={language.t("common.refresh" as never)}>
              <IconButton
                icon="refresh"
                variant="ghost"
                class="size-7"
                disabled={pn.store.loading}
                onClick={() => void pn.refreshAll()}
              />
            </Tooltip>
          </div>
        </div>

        <div class="overflow-y-auto max-h-[min(70vh,560px)] px-4 py-3 flex flex-col gap-4">
          <Show when={pn.store.error}>
            <div class="rounded-md border border-border-weak-base px-3 py-2 text-12-regular text-text-weak">
              {pn.store.error}
            </div>
          </Show>

          <Show
            when={snapshot()}
            fallback={
              <div class="flex flex-col items-center gap-3 py-8 px-2 text-center">
                <div class="text-13-regular text-text-weak">
                  {language.t("powersnexus.panel.empty" as never)}
                </div>
                <Button
                  size="small"
                  disabled={creating() || pn.store.loading || !sessionID()}
                  onClick={() => void onCreateAndBind()}
                >
                  {creating() || pn.store.loading
                    ? language.t("powersnexus.action.creating" as never)
                    : language.t("powersnexus.action.createBind" as never)}
                </Button>
                <Show when={!sessionID()}>
                  <div class="text-12-regular text-text-weak">
                    {language.t("powersnexus.panel.needSession" as never)}
                  </div>
                </Show>
              </div>
            }
          >
            {(snap) => (
              <>
                <section class="flex flex-col gap-2">
                  <div class="flex flex-wrap items-center gap-2">
                    <Tag>{phaseLabel[snap().phase] ?? snap().phase}</Tag>
                    <Tag>{snap().status}</Tag>
                    <Tag>{snap().level}</Tag>
                  </div>
                  <div class="grid grid-cols-2 gap-x-3 gap-y-1 text-12-regular">
                    <div class="text-text-weak">{language.t("powersnexus.field.revision" as never)}</div>
                    <div class="text-text-strong text-right">{snap().revision}</div>
                    <div class="text-text-weak">{language.t("powersnexus.field.digest" as never)}</div>
                    <div class="text-text-strong text-right break-all">{shortDigest(snap().powersnexusDigest)}</div>
                    <div class="text-text-weak">{language.t("powersnexus.field.profile" as never)}</div>
                    <div class="text-text-strong text-right">{snap().profile ?? "—"}</div>
                    <div class="text-text-weak">{language.t("powersnexus.field.updatedAt" as never)}</div>
                    <div class="text-text-strong text-right">{snap().updatedAt}</div>
                  </div>
                </section>

                <Show when={snap().nextAction}>
                  {(action) => (
                    <section class="rounded-lg border border-border-weak-base bg-surface-base px-3 py-2 flex flex-col gap-2">
                      <div class="text-12-medium text-text-weak">
                        {language.t("powersnexus.field.nextAction" as never)}
                      </div>
                      <div class="text-13-medium text-text-strong">{action().label}</div>
                      <div class="text-12-regular text-text-weak">
                        {action().action}
                        {action().automatic ? ` · ${language.t("powersnexus.field.automatic" as never)}` : ""}
                      </div>
                      <Show when={snap().phase === "ready_to_archive"}>
                        <Button size="small" disabled={pn.store.loading} onClick={() => void onArchive()}>
                          {language.t("powersnexus.action.archive" as never)}
                        </Button>
                      </Show>
                    </section>
                  )}
                </Show>

                <Show when={blockers().length > 0}>
                  <section class="flex flex-col gap-2">
                    <div class="text-12-medium text-text-weak">{language.t("powersnexus.section.blockers" as never)}</div>
                    <For each={blockers()}>
                      {(item) => (
                        <div class="rounded-md border border-border-weak-base px-3 py-2">
                          <div class="text-12-medium text-text-strong">{item.code}</div>
                          <div class="text-12-regular text-text-weak">{item.message}</div>
                        </div>
                      )}
                    </For>
                  </section>
                </Show>

                <section class="flex flex-col gap-2">
                  <div class="text-12-medium text-text-weak">
                    {language.t("powersnexus.section.requirements" as never)} ({requirements().length})
                  </div>
                  <Show
                    when={requirements().length > 0}
                    fallback={<div class="text-12-regular text-text-weak">—</div>}
                  >
                    <For each={requirements()}>
                      {(req) => (
                        <div class="flex items-center justify-between gap-2 text-12-regular">
                          <span class="text-text-strong">{req.id}</span>
                          <span class="text-text-weak">{req.status}</span>
                        </div>
                      )}
                    </For>
                  </Show>
                </section>

                <section class="flex flex-col gap-2">
                  <div class="text-12-medium text-text-weak">
                    {language.t("powersnexus.section.tasks" as never)} ({tasks().length})
                  </div>
                  <Show when={tasks().length > 0} fallback={<div class="text-12-regular text-text-weak">—</div>}>
                    <For each={tasks()}>
                      {(task) => (
                        <div class="rounded-md border border-border-weak-base px-3 py-2 flex flex-col gap-1">
                          <div class="flex items-center justify-between gap-2">
                            <span class="text-12-medium text-text-strong">
                              [{task.id}] {task.title}
                            </span>
                            <Tag>{task.status}</Tag>
                          </div>
                        </div>
                      )}
                    </For>
                  </Show>
                </section>

                <section class="flex flex-col gap-2">
                  <div class="text-12-medium text-text-weak">{language.t("powersnexus.section.delivery" as never)}</div>
                  <div class="grid grid-cols-2 gap-x-3 gap-y-1 text-12-regular">
                    <div class="text-text-weak">status</div>
                    <div class="text-text-strong text-right">{snap().delivery?.status ?? "unconfigured"}</div>
                    <div class="text-text-weak">run</div>
                    <div class="text-text-strong text-right break-all">
                      {snap().delivery?.activeRunID ?? pn.store.run?.run?.id ?? "—"}
                    </div>
                    <div class="text-text-weak">fingerprint</div>
                    <div class="text-text-strong text-right">
                      {shortDigest(snap().delivery?.fingerprint ?? pn.store.run?.run?.fingerprint ?? undefined)}
                    </div>
                  </div>
                  <Show when={steps().length > 0}>
                    <For each={steps()}>
                      {(step) => (
                        <button
                          type="button"
                          class="text-left rounded-md border border-border-weak-base px-3 py-2 hover:bg-surface-base-hover"
                          onClick={() => void onOpenLog(step.step_id)}
                        >
                          <div class="flex items-center justify-between gap-2">
                            <span class="text-12-medium text-text-strong">
                              #{step.sequence} {step.step_id}
                            </span>
                            <Tag>{step.status}</Tag>
                          </div>
                        </button>
                      )}
                    </For>
                  </Show>
                  <Show when={pn.store.log && pn.store.logStepID}>
                    <div class="rounded-md border border-border-weak-base bg-background-base p-2">
                      <div class="text-11-medium text-text-weak mb-1">
                        {language.t("powersnexus.section.log" as never)} · {pn.store.logStepID}
                      </div>
                      <pre class="text-[11px] leading-4 text-text-strong whitespace-pre-wrap break-all max-h-40 overflow-auto">
                        {pn.store.log?.text || "—"}
                      </pre>
                    </div>
                  </Show>
                </section>

                <Show when={pn.store.changes.length > 1}>
                  <section class="flex flex-col gap-2">
                    <div class="text-12-medium text-text-weak">{language.t("powersnexus.section.changes" as never)}</div>
                    <For each={pn.store.changes}>
                      {(change) => (
                        <button
                          type="button"
                          class="text-left rounded-md border px-3 py-2 text-12-regular"
                          classList={{
                            "border-border-weak-base bg-surface-base-active text-text-strong":
                              change.changeName === pn.store.selectedChangeName,
                            "border-transparent text-text-weak hover:bg-surface-base-hover":
                              change.changeName !== pn.store.selectedChangeName,
                          }}
                          onClick={() => void pn.selectChange(change.changeName)}
                        >
                          {change.changeName} · rev {change.revision}
                        </button>
                      )}
                    </For>
                  </section>
                </Show>
              </>
            )}
          </Show>
        </div>
        </div>
      </Show>
    </Popover>
  )
}
