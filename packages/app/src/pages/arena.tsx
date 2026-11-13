import type { ArenaContenderView, ArenaRunDetailView, ArenaRunView } from "@novaway/sdk/v2"
import { Button } from "@novaway/ui/button"
import { Icon } from "@novaway/ui/icon"
import { createEffect, createSignal, For, Show, type Component } from "solid-js"
import { TextField } from "@novaway/ui/text-field"
import { PageHeader } from "@/components/page-header"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { formatRelativeTime } from "@/utils/relative-time"

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

const statusTone = (status: ArenaContenderView["status"]) =>
  status === "completed"
    ? "text-text-success-base"
    : status === "failed"
      ? "text-text-critical-base"
      : "text-foreground-subtlest"

const verdictTone = (verdict: ArenaContenderView["verdict"]) =>
  verdict === "pass"
    ? "text-text-success-base"
    : verdict === "fail"
      ? "text-text-critical-base"
      : "text-foreground-subtle"

/** 生成的 SDK 会把 number 展开成 `number | "NaN" | ...`;展示时只认有限数字。 */
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0)

const totals = (result: ArenaContenderView) => {
  const files = result.diff?.files ?? []
  return {
    files: files.length,
    added: files.reduce((sum, file) => sum + num(file.added), 0),
    removed: files.reduce((sum, file) => sum + num(file.removed), 0),
  }
}

/**
 * Arena 对比页：从配置的模型发起运行，并将 contender 产出并排对比。
 */
export const ArenaPage: Component<{
  directory: string
  onBack: () => void
  onOpenSession: (sessionID: string) => void
}> = (props) => {
  const sdk = useGlobalSDK()
  const language = useLanguage()
  const [runs, setRuns] = createSignal<ArenaRunView[]>([])
  const [detail, setDetail] = createSignal<ArenaRunDetailView | undefined>()
  const [selected, setSelected] = createSignal<string | undefined>()
  const [error, setError] = createSignal<string | undefined>()
  const [loading, setLoading] = createSignal(false)
  const [task, setTask] = createSignal("")
  const [running, setRunning] = createSignal(false)

  const open = async (runID: string) => {
    setSelected(runID)
    setLoading(true)
    try {
      const result = await sdk.client.arena.detail({ runID, directory: props.directory })
      setDetail(result.data)
      setError(undefined)
    } catch (cause) {
      setDetail(undefined)
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }

  const run = async () => {
    const value = task().trim()
    if (!value || running()) return
    setRunning(true)
    setError(undefined)
    try {
      const result = await sdk.client.arena.run({ directory: props.directory, arenaRunInput: { task: value } })
      setTask("")
      const refreshed = await sdk.client.arena.list({ directory: props.directory })
      setRuns(refreshed.data ?? [])
      if (!result.data) throw new Error(language.t("arena.error"))
      setDetail(result.data)
      setSelected(result.data.run.id)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setRunning(false)
    }
  }

  createEffect(() => {
    const directory = props.directory
    void (async () => {
      setLoading(true)
      try {
        const result = await sdk.client.arena.list({ directory })
        const next = result.data ?? []
        setRuns(next)
        setError(undefined)
        const first = next[0]?.id
        if (first) await open(first)
        else {
          setSelected(undefined)
          setDetail(undefined)
        }
      } catch (cause) {
        setError(errorMessage(cause))
      } finally {
        setLoading(false)
      }
    })()
  })

  return (
    <div class="flex h-full min-h-0 flex-col bg-background">
      <PageHeader
        onBack={props.onBack}
        title={language.t("arena.title")}
        hint={language.t("arena.hint")}
        icon="lu-flip-horizontal-2"
        accent="var(--icon-interactive-base)"
      />
      <div class="flex min-h-0 flex-1">
        <aside class="flex w-64 shrink-0 flex-col gap-2 overflow-y-auto border-r border-border p-2">
          <form
            class="flex flex-col gap-2 border-b border-border p-2 pb-3"
            onSubmit={(event) => {
              event.preventDefault()
              void run()
            }}
          >
            <TextField
              value={task()}
              onChange={setTask}
              placeholder={language.t("arena.taskPlaceholder")}
              aria-label={language.t("arena.taskPlaceholder")}
            />
            <Button type="submit" size="small" disabled={!task().trim() || running()}>
              <Show when={running()} fallback={language.t("arena.run")}>
                {language.t("arena.running")}
              </Show>
            </Button>
            <Show when={error()}>
              {(message) => <p class="text-11-regular text-text-critical-base">{message()}</p>}
            </Show>
          </form>
          <Show
            when={runs().length > 0}
            fallback={<p class="p-2 text-12-regular text-foreground-subtle">{language.t("arena.empty")}</p>}
          >
            <For each={runs()}>
              {(run) => (
                <button
                  type="button"
                  class="mb-1 flex w-full flex-col gap-1 rounded-md px-2 py-1.5 text-left hover:bg-surface-raised-base-hover"
                  classList={{ "bg-surface-raised-base-active": selected() === run.id }}
                  onClick={() => void open(run.id)}
                >
                  <span class="line-clamp-2 text-12-medium text-foreground">{run.task}</span>
                  <span class="flex items-center gap-2 text-11-regular text-foreground-subtle">
                    <span>{formatRelativeTime(Date.parse(run.createdAt), Date.now(), language.t)}</span>
                    <span>·</span>
                    <span>{run.contenders}</span>
                    <Show when={run.winner}>{(winner) => <span class="text-text-success-base">{winner()}</span>}</Show>
                  </span>
                </button>
              )}
            </For>
          </Show>
        </aside>
        <main class="flex min-w-0 flex-1 flex-col overflow-hidden">
          <Show
            when={detail()}
            fallback={
              <div class="flex flex-1 items-center justify-center p-6 text-13-regular text-foreground-subtle">
                {language.t(loading() ? "arena.loading" : error() ? "arena.error" : "arena.selectRun")}
              </div>
            }
          >
            {(current) => (
              <>
                <div class="flex shrink-0 flex-col gap-1 border-b border-border px-4 py-3">
                  <div class="flex items-center gap-2">
                    <span class="text-14-medium text-foreground">{current().run.task}</span>
                  </div>
                  <div class="flex items-center gap-3 text-12-regular text-foreground-subtle">
                    <span>{current().run.id}</span>
                    <span>·</span>
                    <span>{language.t("arena.contenders", { count: current().run.contenders })}</span>
                    <Show when={current().run.winner} fallback={<span>{language.t("arena.noWinner")}</span>}>
                      {(winner) => (
                        <span class="text-text-success-base">
                          {language.t("arena.winner")}: {winner()}
                        </span>
                      )}
                    </Show>
                  </div>
                  <Show when={current().run.note}>
                    {(note) => <span class="text-11-regular text-foreground-subtlest">{note()}</span>}
                  </Show>
                </div>
                <div class="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
                  <For each={current().results}>
                    {(result) => {
                      const stats = totals(result)
                      return (
                        <section class="flex min-w-[300px] flex-1 basis-0 flex-col overflow-hidden rounded-lg border border-border bg-surface-raised-base">
                          <header class="flex shrink-0 flex-col gap-1 border-b border-border px-3 py-2">
                            <div class="flex items-center justify-between gap-2">
                              <span class="truncate text-13-medium text-foreground">{result.id}</span>
                              <span class={`text-11-medium ${statusTone(result.status)}`}>{result.status}</span>
                            </div>
                            <div class="flex flex-wrap items-center gap-2 text-11-regular text-foreground-subtle">
                              <Show when={result.verdict}>
                                {(verdict) => (
                                  <span class={verdictTone(verdict())}>
                                    {language.t("arena.verdict")}: {verdict()}
                                  </span>
                                )}
                              </Show>
                              <Show when={result.score !== undefined}>
                                <span>
                                  {language.t("arena.score")}: {result.score}
                                </span>
                              </Show>
                              <span>
                                {language.t("arena.files")}: {stats.files}{" "}
                                <span class="text-text-success-base">+{stats.added}</span>{" "}
                                <span class="text-text-critical-base">-{stats.removed}</span>
                              </span>
                              <Show when={result.durationMs !== undefined}>
                                <span>{Math.round(num(result.durationMs) / 1000)}s</span>
                              </Show>
                              <Show when={result.usage}>{(usage) => <span>{usage().tokens} tokens</span>}</Show>
                            </div>
                          </header>
                          <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
                            <Show when={result.error}>
                              {(message) => (
                                <p class="rounded-md bg-surface-critical-base px-2 py-1.5 text-11-regular text-text-critical-base">
                                  {message()}
                                </p>
                              )}
                            </Show>
                            <Show when={result.text?.trim()}>
                              {(text) => (
                                <div class="flex flex-col gap-1">
                                  <span class="text-11-medium text-foreground-subtle">
                                    {language.t("arena.output")}
                                  </span>
                                  <pre class="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-surface-base p-2 text-11-regular text-foreground">
                                    {text()}
                                  </pre>
                                </div>
                              )}
                            </Show>
                            <div class="flex flex-col gap-1">
                              <span class="text-11-medium text-foreground-subtle">
                                {language.t("arena.changedFiles")}
                              </span>
                              <Show
                                when={stats.files > 0 || (result.diff?.untracked.length ?? 0) > 0}
                                fallback={
                                  <span class="text-11-regular text-foreground-subtlest">
                                    {language.t("arena.noDiff")}
                                  </span>
                                }
                              >
                                <ul class="flex flex-col gap-0.5">
                                  <For each={result.diff?.files ?? []}>
                                    {(file) => (
                                      <li class="flex items-center gap-2 text-11-regular">
                                        <span class="min-w-0 flex-1 truncate text-foreground" title={file.path}>
                                          {file.path}
                                        </span>
                                        <span class="shrink-0 text-text-success-base">+{file.added}</span>
                                        <span class="shrink-0 text-text-critical-base">-{file.removed}</span>
                                      </li>
                                    )}
                                  </For>
                                  <For each={result.diff?.untracked ?? []}>
                                    {(file) => (
                                      <li class="flex items-center gap-2 text-11-regular">
                                        <span class="min-w-0 flex-1 truncate text-foreground-subtle" title={file}>
                                          {file}
                                        </span>
                                        <span class="shrink-0 text-foreground-subtlest">
                                          {language.t("arena.untracked")}
                                        </span>
                                      </li>
                                    )}
                                  </For>
                                </ul>
                              </Show>
                            </div>
                            <Show when={result.sessionID}>
                              {(sessionID) => (
                                <Button variant="ghost" size="small" onClick={() => props.onOpenSession(sessionID())}>
                                  <Icon name="new-session" size="small" />
                                  {language.t("arena.openSession")}
                                </Button>
                              )}
                            </Show>
                          </div>
                        </section>
                      )
                    }}
                  </For>
                </div>
              </>
            )}
          </Show>
        </main>
      </div>
    </div>
  )
}
