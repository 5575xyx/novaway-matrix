import type { RunDetail, RunView } from "@novaway/sdk/v2"
import { Button } from "@novaway/ui/button"
import { Icon } from "@novaway/ui/icon"
import { Tag } from "@novaway/ui/tag"
import { createMemo, createSignal, For, onCleanup, onMount, Show, type Component } from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

const TERMINAL = new Set(["done", "partial", "failed", "exceeded", "cancelled"])

/**
 * 「团队运行」页。
 *
 * 它回答的是「这次交付到底成立吗」，而不是「聊到哪了」：
 * 左侧是运行列表，右侧是验收台账 —— 通过、失败、未验证、证据过期
 * 四个数字分开显示，未验证永远不会被并进「通过」。
 * 每个数字都能点开看到对应的验收项与实测结果。
 */
export const RunPage: Component<{
  directory: string
  onBack: () => void
  onOpenSession?: (sessionID: string) => void
}> = (props) => {
  const sdk = useGlobalSDK()
  const language = useLanguage()
  const t = (key: string, vars?: Record<string, unknown>) => language.t(key as never, vars as never)

  const [runs, setRuns] = createSignal<RunView[]>([])
  const [selected, setSelected] = createSignal<string | undefined>(undefined)
  const [detail, setDetail] = createSignal<RunDetail | undefined>(undefined)
  const [error, setError] = createSignal("")
  const [busy, setBusy] = createSignal("")

  const loadRuns = async (select?: string) => {
    try {
      const result = await sdk.client.run.list({ directory: props.directory })
      const list = (result.data ?? []) as RunView[]
      setRuns(list)
      setError("")
      const next = select ?? selected() ?? list[0]?.id
      setSelected(next)
      if (next) await loadDetail(next)
      else setDetail(undefined)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const loadDetail = async (runID: string) => {
    try {
      const result = await sdk.client.run.detail({ runID, directory: props.directory })
      if (selected() !== runID) return
      setDetail((result.data ?? undefined) as RunDetail | undefined)
      setError("")
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const reload = async () => {
    const runID = selected()
    if (runID) await loadDetail(runID)
  }

  const act = async (label: string, action: () => Promise<unknown>) => {
    setBusy(label)
    try {
      await action()
      await reload()
      await loadRuns(selected())
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy("")
    }
  }

  const execute = () =>
    act("execute", async () => {
      const runID = selected()
      if (!runID) return
      await sdk.client.run.execute({ runID, directory: props.directory })
    })

  const cancel = () =>
    act("cancel", async () => {
      const runID = selected()
      if (!runID) return
      await sdk.client.run.cancel({ runID, directory: props.directory })
    })

  const approve = () =>
    act("approve", async () => {
      const run = detail()?.run
      if (!run) return
      await sdk.client.run.approve({
        runID: run.id,
        directory: props.directory,
        planVersion: run.planVersion,
        budget: run.budget ?? { tokens: 200_000 },
        by: "user",
      })
    })

  onMount(() => {
    void loadRuns()
    // 运行是后台推进的；没有推送时用轮询保证看板不会停在旧状态。
    const timer = setInterval(() => {
      void reload()
    }, 3000)
    onCleanup(() => clearInterval(timer))
  })

  const stateLabel = (state: string) => t(`run.state.${state}`)
  const summary = createMemo(() => detail()?.summary)
  const canExecute = createMemo(() => {
    const state = detail()?.run.state
    return !!state && !TERMINAL.has(state) && state !== "awaiting_approval"
  })

  return (
    <div class="flex h-full min-h-0 flex-col bg-background">
      <div class="shrink-0 border-b border-border px-4 py-3">
        <div class="flex items-center gap-2">
          <Button variant="ghost" size="small" onClick={() => props.onBack()}>
            <Icon name="arrow-left" size="small" />
            {t("common.goBack")}
          </Button>
          <span class="text-14-medium text-foreground">{t("run.page.title")}</span>
          <div class="flex-1" />
          <Button variant="ghost" size="small" onClick={() => void loadRuns()}>
            <Icon name="refresh" size="small" />
            {t("run.action.refresh")}
          </Button>
        </div>
        <div class="mt-1.5 pl-1 text-12-regular text-foreground-subtle">{t("run.page.hint")}</div>
      </div>

      <Show when={error()}>
        <div class="shrink-0 border-b border-border px-4 py-1.5 text-ui-xs text-destructive">{error()}</div>
      </Show>

      <div class="flex min-h-0 flex-1">
        <aside class="flex w-64 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border p-2">
          <Show
            when={runs().length > 0}
            fallback={<div class="px-2 py-3 text-ui-xs leading-relaxed text-foreground-subtle">{t("run.empty")}</div>}
          >
            <For each={runs()}>
              {(run) => (
                <button
                  type="button"
                  class="flex w-full flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-hover"
                  classList={{ "bg-surface": run.id === selected() }}
                  onClick={() => setSelected(run.id)}
                >
                  <span class="w-full truncate text-ui-base text-foreground">{run.goal}</span>
                  <span class="w-full truncate text-ui-xs text-foreground-subtle">
                    {stateLabel(run.state)} · {run.mode}
                  </span>
                </button>
              )}
            </For>
          </Show>
        </aside>

        <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          <Show
            when={detail()}
            fallback={
              <div class="flex h-full items-center justify-center text-ui-sm text-foreground-subtle">
                {t("run.empty")}
              </div>
            }
          >
            {(data) => (
              <div class="flex flex-col gap-3 p-4">
                <div class="flex items-start gap-2">
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-15-medium text-foreground">{data().run.goal}</div>
                    <div class="mt-1 flex flex-wrap items-center gap-1.5">
                      <Tag>{stateLabel(data().run.state)}</Tag>
                      <Tag>{data().run.mode}</Tag>
                      <Tag>{"第 " + data().run.roundMain + " 轮"}</Tag>
                      {Number(data().run.planVersion) > 0 ? <Tag>{"计划 v" + data().run.planVersion}</Tag> : null}
                    </div>
                  </div>
                  <div class="flex shrink-0 items-center gap-1.5">
                    <Show when={data().run.state === "awaiting_approval"}>
                      <Button variant="primary" size="small" disabled={busy() !== ""} onClick={() => void approve()}>
                        {t("run.action.approve")}
                      </Button>
                    </Show>
                    <Show when={canExecute()}>
                      <Button variant="primary" size="small" disabled={busy() !== ""} onClick={() => void execute()}>
                        {t("run.action.execute")}
                      </Button>
                    </Show>
                    <Show when={!TERMINAL.has(data().run.state)}>
                      <Button variant="ghost" size="small" disabled={busy() !== ""} onClick={() => void cancel()}>
                        {t("run.action.cancel")}
                      </Button>
                    </Show>
                  </div>
                </div>

                <div class="grid grid-cols-4 gap-2">
                  <div class="rounded-lg border border-border bg-surface px-3 py-2">
                    <div class="text-ui-xs text-foreground-subtle">{t("run.metric.pass")}</div>
                    <div class="text-18-medium text-success">{summary()?.pass ?? 0}</div>
                  </div>
                  <div class="rounded-lg border border-border bg-surface px-3 py-2">
                    <div class="text-ui-xs text-foreground-subtle">{t("run.metric.fail")}</div>
                    <div class="text-18-medium text-destructive">{summary()?.fail ?? 0}</div>
                  </div>
                  <div class="rounded-lg border border-border bg-surface px-3 py-2">
                    <div class="text-ui-xs text-foreground-subtle">{t("run.metric.unverified")}</div>
                    {/* 未验证用警示色，不是绿色也不是灰色：它不是通过。 */}
                    <div class="text-18-medium text-warning">{summary()?.unverified ?? 0}</div>
                  </div>
                  <div class="rounded-lg border border-border bg-surface px-3 py-2">
                    <div class="text-ui-xs text-foreground-subtle">{t("run.metric.stale")}</div>
                    <div class="text-18-medium text-warning">{summary()?.stale ?? 0}</div>
                  </div>
                </div>

                <div class="flex flex-col gap-1.5">
                  <div class="text-ui-xs text-foreground-subtle">{t("run.page.about")}</div>
                  <Show
                    when={(data().summary.lines ?? []).length > 0}
                    fallback={
                      <div class="px-1 py-2 text-ui-xs text-foreground-subtlest">{t("run.acceptance.empty")}</div>
                    }
                  >
                    <For each={data().summary.lines ?? []}>
                      {(line) => (
                        <div class="flex items-start gap-2 rounded-lg border border-border px-3 py-2">
                          <span
                            classList={{
                              "mt-1 size-2 shrink-0 rounded-full": true,
                              "bg-success": line.outcome === "pass",
                              "bg-destructive": line.outcome === "fail",
                              "bg-warning": line.outcome !== "pass" && line.outcome !== "fail",
                            }}
                          />
                          <div class="min-w-0 flex-1">
                            <div class="text-ui-base text-foreground">{line.text}</div>
                            <div class="mt-0.5 flex flex-wrap items-center gap-1.5 text-ui-xs text-foreground-subtle">
                              <Tag>{line.outcome}</Tag>
                              <Show when={line.measured}>{(measured) => <span>{measured()}</span>}</Show>
                              <Show when={line.snapshotID}>
                                {(snapshot) => <span class="truncate">{snapshot()}</span>}
                              </Show>
                            </div>
                          </div>
                        </div>
                      )}
                    </For>
                  </Show>
                </div>

                <div class="flex flex-wrap items-center gap-1.5">
                  <For each={data().teams}>{(team) => <Tag>{team.id + " · " + team.phase}</Tag>}</For>
                </div>
              </div>
            )}
          </Show>
        </div>
      </div>
    </div>
  )
}
