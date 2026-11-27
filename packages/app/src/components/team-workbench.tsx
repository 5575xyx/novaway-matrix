import type { ExpertCenterTaskView, RunView } from "@novaway/sdk/v2"
import { Button } from "@novaway/ui/button"
import { Icon } from "@novaway/ui/icon"
import { Tag } from "@novaway/ui/tag"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type Component } from "solid-js"
import { PageHeader } from "@/components/page-header"
import { RunConsole } from "@/components/run-console"
import { ExpertCenterTask } from "@/components/expert-center-task"
import { taskPhase } from "@/components/expert-center.logic"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { formatRelativeTime } from "@/utils/relative-time"

const NEEDS_YOU = new Set(["awaiting_approval", "blocked", "paused", "needs_review"])
const ACTIVE = new Set(["planning", "ready", "running"])
const STOPPED = new Set(["paused", "partial", "failed", "exceeded", "cancelled"])

type Filter = "all" | "needs-you" | "active" | "done" | "stopped"

const stateClass = (state: string) => ({
  "bg-surface-success-base": state === "done",
  "bg-surface-warning-base": NEEDS_YOU.has(state),
  "bg-surface-interactive-base": ACTIVE.has(state),
  "bg-foreground-subtlest": STOPPED.has(state) && state !== "done",
})

const isNeedsYou = (run: RunView) => NEEDS_YOU.has(run.state)
const isActive = (run: RunView) => ACTIVE.has(run.state)
const isDone = (run: RunView) => run.state === "done"
const isStopped = (run: RunView) => STOPPED.has(run.state)

const nextActionKey = (run: RunView) => {
  if (run.state === "planning") return "workbench.next.planning"
  if (run.state === "awaiting_approval") return "workbench.next.approve"
  if (run.state === "running" && !run.phase) return "workbench.next.start"
  if (run.state === "running") return "workbench.next.working"
  if (run.state === "paused" || run.state === "needs_review") return "workbench.next.resume"
  if (run.state === "blocked") return "workbench.next.retry"
  if (run.state === "done") return "workbench.next.done"
  if (run.state === "partial") return "workbench.next.partial"
  return "workbench.next.failed"
}

const compactNumber = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return ""
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(Math.round(value))
}

const budgetLabel = (run: RunView) => {
  const cap = Number(run.budget?.tokens)
  const used = Number(run.usage?.settled)
  if (!Number.isFinite(cap) || cap <= 0 || !Number.isFinite(used) || used <= 0) return ""
  return `${compactNumber(used)} / ${compactNumber(cap)}`
}

export const TeamWorkbench: Component<{
  directory: string
  onBack: () => void
  onManageOrganization: () => void
  onOpenExpertDirectory?: (section: "all" | "teams" | "experts") => void
  onOpenSession?: (sessionID: string) => void
}> = (props) => {
  const sdk = useGlobalSDK()
  const language = useLanguage()
  const t = (key: string, vars?: Record<string, unknown>) => language.t(key as never, vars as never)
  const [runs, setRuns] = createSignal<RunView[]>([])
  const [taskProjection, setTaskProjection] = createSignal<ExpertCenterTaskView>()
  const [selectedRunID, setSelectedRunID] = createSignal<string>()
  const [filter, setFilter] = createSignal<Filter>("all")
  const [query, setQuery] = createSignal("")
  const [composing, setComposing] = createSignal(false)
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal("")

  const load = async (select?: string) => {
    setLoading(true)
    try {
      const result = await sdk.client.run.list({ directory: props.directory })
      const next = [...(result.data ?? [])].sort((left, right) => {
        const rightTime = Number(right.updatedAt)
        const leftTime = Number(left.updatedAt)
        return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0)
      }) as RunView[]
      setRuns(next)
      const preferred = select ?? selectedRunID()
      const selected = preferred && next.some((run) => run.id === preferred) ? preferred : next[0]?.id
      setSelectedRunID(selected)
      setError("")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }

  const loadTaskProjection = async (runID: string) => {
    try {
      const result = await sdk.client.expertCenter.task({ taskID: runID, directory: props.directory })
      if (selectedRunID() !== runID) return
      setTaskProjection(result.data)
    } catch {
      // Older servers can still serve the compatible run detail; keep the task UI usable.
      setTaskProjection(undefined)
    }
  }

  const startConversation = async () => {
    // Claude Code 风格的入口：新任务先进入普通对话，用户只描述目标；
    // 团队选择器留在输入框里，复杂的运行详情不再阻塞第一步。
    if (!props.onOpenSession) {
      setComposing(true)
      return
    }
    setLoading(true)
    setError("")
    try {
      // 不在这里先拉团队再决定模式：新会话的默认 Auto 由服务端统一解析，
      // 这样没有团队模板、只有可派发专家，或用户关闭默认协作时都不会被 UI 猜错。
      const created = await sdk.client.session.create({
        directory: props.directory,
        title: t("workbench.newConversationTitle"),
      })
      const sessionID = created.data?.id
      if (!sessionID) throw new Error(t("workbench.sessionCreateFailed"))
      props.onOpenSession(sessionID)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }

  const filtered = createMemo(() => {
    const current = filter()
    const needle = query().trim().toLocaleLowerCase()
    return runs().filter((run) => {
      if (needle && !run.goal.toLocaleLowerCase().includes(needle)) return false
      if (current === "needs-you") return isNeedsYou(run)
      if (current === "active") return isActive(run)
      if (current === "done") return isDone(run)
      if (current === "stopped") return isStopped(run)
      return true
    })
  })

  const taskGroup = (run: RunView) => {
    if (isNeedsYou(run)) return "needs-you" as const
    if (isActive(run)) return "active" as const
    if (isDone(run)) return "done" as const
    return "stopped" as const
  }

  const grouped = createMemo(() => {
    const order = ["needs-you", "active", "done", "stopped"] as const
    const groups = new Map<(typeof order)[number], RunView[]>()
    for (const run of filtered()) {
      const key = taskGroup(run)
      const current = groups.get(key)
      if (current) current.push(run)
      else groups.set(key, [run])
    }
    return order.map((key) => ({ key, runs: groups.get(key) ?? [] })).filter((group) => group.runs.length > 0)
  })

  const selectedRun = createMemo(() => runs().find((run) => run.id === selectedRunID()))

  const count = (kind: Filter) => {
    if (kind === "all") return runs().length
    if (kind === "needs-you") return runs().filter(isNeedsYou).length
    if (kind === "active") return runs().filter(isActive).length
    if (kind === "done") return runs().filter(isDone).length
    return runs().filter(isStopped).length
  }

  const overview = createMemo(() => ({
    needsYou: runs().filter(isNeedsYou).length,
    active: runs().filter(isActive).length,
    done: runs().filter(isDone).length,
    stopped: runs().filter(isStopped).length,
  }))

  createEffect(() => {
    const list = filtered()
    if (composing() || list.length === 0) return
    if (!selectedRunID() || !list.some((run) => run.id === selectedRunID())) setSelectedRunID(list[0].id)
  })

  createEffect(() => {
    const id = selectedRunID()
    if (!id || composing()) {
      setTaskProjection(undefined)
      return
    }
    void loadTaskProjection(id)
  })

  onMount(() => {
    void load()
    const timer = window.setInterval(() => void load(), 4_000)
    onCleanup(() => window.clearInterval(timer))
  })

  createEffect(() => {
    if (composing()) setSelectedRunID(undefined)
  })

  return (
    <div
      class="flex h-full min-h-0 flex-col bg-background"
      style={{ "container-type": "inline-size", "container-name": "expert-workbench" }}
    >
      <PageHeader
        onBack={props.onBack}
        title={t("workbench.title")}
        hint={t("workbench.hint")}
        actions={
          <Button
            variant="ghost"
            size="small"
            title={t("workbench.refresh")}
            aria-label={t("workbench.refresh")}
            disabled={loading()}
            onClick={() => void load()}
          >
            <Icon name="refresh" size="small" class={loading() ? "animate-spin" : undefined} />
          </Button>
        }
      />
      <div class="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2 text-ui-xs">
        <button type="button" class="rounded-md bg-surface px-2 py-1 text-foreground" onClick={() => setFilter("all")}>
          {t("workbench.overview")}
        </button>
        <button
          type="button"
          data-action="workbench-open-executors"
          class="rounded-md px-2 py-1 text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
          onClick={() => {
            if (props.onOpenExpertDirectory) props.onOpenExpertDirectory("all")
            else props.onManageOrganization()
          }}
        >
          <Icon name="lu-users" size="small" class="mr-1 inline-block align-text-bottom" />
          {t("expertCenter.directory.title")}
        </button>
      </div>
      <div class="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2 text-ui-xs">
        <span class="text-foreground-subtle">{t("workbench.overview")}</span>
        <button
          type="button"
          class="rounded-md px-1.5 py-0.5 transition-colors hover:bg-hover"
          classList={{ "bg-surface-warning-base text-foreground": overview().needsYou > 0 }}
          onClick={() => setFilter("needs-you")}
        >
          <span class="text-warning-base">{overview().needsYou}</span> {t("workbench.needsYou")}
        </button>
        <button
          type="button"
          class="rounded-md px-1.5 py-0.5 transition-colors hover:bg-hover"
          onClick={() => setFilter("active")}
        >
          <span class="text-interactive-base">{overview().active}</span> {t("workbench.active")}
        </button>
        <span class="text-foreground-subtlest">·</span>
        <span class="text-foreground-subtle">
          {overview().done} {t("workbench.done")}
        </span>
        <Show when={overview().stopped > 0}>
          <span class="text-foreground-subtlest">·</span>
          <button
            type="button"
            class="text-foreground-subtle transition-colors hover:text-foreground"
            onClick={() => setFilter("stopped")}
          >
            {overview().stopped} {t("workbench.stopped")}
          </button>
        </Show>
        <Show when={overview().needsYou > 0}>
          <button
            type="button"
            class="ml-auto rounded-md px-2 py-1 text-warning-base transition-colors hover:bg-hover"
            onClick={() => setFilter("needs-you")}
          >
            {t("workbench.openNeedsYou")}
            <Icon name="chevron-right" size="small" class="ml-0.5 inline-block align-text-bottom" />
          </button>
        </Show>
      </div>
      <Show when={error()}>
        <div class="shrink-0 border-b border-border px-4 py-1.5 text-ui-xs text-critical-base">{error()}</div>
      </Show>
      <div class="expert-workbench-layout flex min-h-0 flex-1 flex-col">
        <aside class="expert-workbench-sidebar flex h-[min(46vh,22rem)] min-h-0 w-full shrink-0 flex-col border-b border-border">
          <div class="flex shrink-0 items-center gap-1.5 border-b border-border p-2">
            <div class="relative min-w-0 flex-1">
              <Icon
                name="magnifying-glass"
                size="small"
                class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-foreground-subtlest"
              />
              <input
                value={query()}
                placeholder={t("workbench.search")}
                aria-label={t("workbench.search")}
                class="h-8 w-full rounded-md border border-border bg-background pl-7 pr-2 text-ui-xs text-foreground outline-none placeholder:text-foreground-subtlest focus:border-border-focus"
                onInput={(event) => setQuery(event.currentTarget.value)}
              />
            </div>
            <Button
              variant="primary"
              size="small"
              class="min-w-0"
              data-action="workbench-manual-launch"
              onClick={() => void startConversation()}
            >
              <Icon name="plus" size="small" />
              <span class="hidden xl:inline">{t("workbench.new")}</span>
            </Button>
            <Button variant="ghost" size="small" title={t("workbench.manageHint")} onClick={props.onManageOrganization}>
              <Icon name="settings-gear" size="small" />
            </Button>
          </div>
          <div class="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-2 py-1.5">
            <For
              each={
                [
                  ["all", "workbench.all"],
                  ["needs-you", "workbench.needsYou"],
                  ["active", "workbench.active"],
                  ["done", "workbench.done"],
                  ["stopped", "workbench.stopped"],
                ] as const
              }
            >
              {([value, label]) => (
                <button
                  type="button"
                  class="shrink-0 rounded-md px-2 py-1 text-ui-xs transition-colors"
                  classList={{
                    "bg-surface text-foreground": filter() === value,
                    "text-foreground-subtle hover:bg-hover": filter() !== value,
                  }}
                  onClick={() => setFilter(value)}
                >
                  {t(label)} <span class="text-foreground-subtlest">{count(value)}</span>
                </button>
              )}
            </For>
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto p-2">
            <Show
              when={!loading() || runs().length > 0}
              fallback={<div class="px-2 py-4 text-ui-xs text-foreground-subtle">{t("workbench.loading")}</div>}
            >
              <Show
                when={filtered().length > 0}
                fallback={
                  <div class="px-2 py-4 text-ui-xs leading-relaxed text-foreground-subtle">{t("workbench.empty")}</div>
                }
              >
                <div class="flex flex-col gap-3">
                  <For each={grouped()}>
                    {(group) => (
                      <section>
                        <div class="mb-1 px-2 text-ui-xs font-medium text-foreground-subtlest">
                          {t(`workbench.${group.key === "needs-you" ? "needsYou" : group.key}`)}
                        </div>
                        <div class="flex flex-col gap-1">
                          <For each={group.runs}>
                            {(run) => (
                              <button
                                type="button"
                                aria-current={selectedRunID() === run.id && !composing() ? "true" : undefined}
                                class="group flex w-full flex-col gap-1.5 rounded-lg border border-transparent px-2.5 py-2.5 text-left transition-colors hover:bg-hover"
                                classList={{ "border-border bg-surface": selectedRunID() === run.id && !composing() }}
                                onClick={() => {
                                  setSelectedRunID(run.id)
                                  setComposing(false)
                                }}
                              >
                                <div class="flex w-full items-start gap-2">
                                  <span
                                    class="mt-1.5 size-2 shrink-0 rounded-full"
                                    classList={{ ...stateClass(run.state), "animate-pulse": isActive(run) }}
                                  />
                                  <span class="min-w-0 flex-1 truncate text-ui-base text-foreground">{run.goal}</span>
                                  <Icon
                                    name="chevron-right"
                                    size="small"
                                    class="shrink-0 text-foreground-subtlest transition-transform group-hover:translate-x-0.5"
                                  />
                                </div>
                                <div class="flex items-center gap-1.5 pl-4 text-ui-xs text-foreground-subtle">
                                  <Tag>{t(`run.state.${run.state}`)}</Tag>
                                  <Show when={run.phase}>
                                    {(phase) => <span class="truncate">{t(`run.phase.${phase()}`)}</span>}
                                  </Show>
                                  <Show when={run.mode === "auto"}>
                                    <Tag>{t("workbench.auto")}</Tag>
                                  </Show>
                                </div>
                                <div class="flex items-center gap-2 pl-4 text-ui-xs">
                                  <span class={isNeedsYou(run) ? "text-warning-base" : "text-foreground-subtle"}>
                                    {t(nextActionKey(run))}
                                  </span>
                                  <Show when={budgetLabel(run)}>
                                    {(budget) => (
                                      <span class="ml-auto text-foreground-subtlest">
                                        {t("workbench.tokens", { value: budget() })}
                                      </span>
                                    )}
                                  </Show>
                                </div>
                                <div class="flex items-center gap-2 pl-4 text-ui-xs text-foreground-subtlest">
                                  <span>
                                    {formatRelativeTime(Number(run.updatedAt) || undefined, Date.now(), language.t)}
                                  </span>
                                  <Show when={run.readOnly}>
                                    <span>· {t("run.policy.readOnly")}</span>
                                  </Show>
                                </div>
                              </button>
                            )}
                          </For>
                        </div>
                      </section>
                    )}
                  </For>
                </div>
              </Show>
            </Show>
          </div>
        </aside>
        <main class="min-h-0 min-w-0 flex-1">
          <ExpertCenterTask
            run={selectedRun()}
            report={{
              summary: taskProjection()?.summary,
              verification: taskProjection()?.verification
                ? {
                    status: taskProjection()!.verification!.status,
                    passed: Number(taskProjection()!.verification!.passed),
                    failed: Number(taskProjection()!.verification!.failed),
                    unverified: Number(taskProjection()!.verification!.unverified),
                    stale: Number(taskProjection()!.verification!.stale),
                  }
                : undefined,
              changeCount: taskProjection()?.changes?.length ?? taskProjection()?.artifacts.length,
            }}
          >
            <RunConsole
              directory={props.directory}
              userTaskActions
              {...(selectedRunID() ? { runID: selectedRunID()! } : {})}
              composing={composing()}
              onComposingChange={setComposing}
              onOpenSession={props.onOpenSession}
              onCreated={(runID) => {
                setComposing(false)
                void load(runID)
              }}
            />
          </ExpertCenterTask>
        </main>
      </div>
    </div>
  )
}
