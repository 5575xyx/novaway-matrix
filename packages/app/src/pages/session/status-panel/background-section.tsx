import { For, Show, createEffect, createMemo, onCleanup, on } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon } from "@novaway/ui/icon"
import { Tag } from "@novaway/ui/tag"
import { IconButton } from "@novaway/ui/icon-button"
import { useLanguage } from "@/context/language"
import { useLayout, sidePaneSubagentTabId } from "@/context/layout"
import { useSDK } from "@/context/sdk"
import {
  backgroundJobStat,
  formatElapsed,
  isJobVisible,
  isResumed,
  jobKind,
  jobKindLabelKey,
  resumeSkipped,
  showsResult,
  visibleBackgroundJobs,
  type BackgroundJob,
} from "./background-section-model"
import type { StatusPanelSection } from "./status-panel"

const messageOf = (err: unknown) => {
  if (err instanceof Error) return err.message
  if (typeof err === "string") return err
  return String(err)
}

const jobSessionID = (job: BackgroundJob): string | undefined => {
  const value = job.metadata?.sessionId
  return typeof value === "string" && value ? value : undefined
}

const jobParentID = (job: BackgroundJob): string | undefined => {
  const value = job.metadata?.parentSessionId
  return typeof value === "string" && value ? value : undefined
}

/** 每种后台任务有自己的图标，扫一眼就能分辨"在跑什么"。 */
const JOB_ICONS = {
  agent: "task",
  shell: "terminal",
  monitor: "eye",
  subscribe: "globe",
  orchestrator: "fork",
  other: "dash",
} as const

const jobIcon = (job: BackgroundJob) => JOB_ICONS[jobKind(job)]

// 后台任务没有服务端推送事件（子代理/后台命令各跑各的），用 2 秒轮询换实时感；
// 只有真的存在任务时才把区块塞进状态面板，避免空卡片常驻。
export function useBackgroundSection(sessionID: () => string): () => StatusPanelSection | null {
  const sdk = useSDK()
  const language = useLanguage()
  const layout = useLayout()
  const [store, setStore] = createStore({
    jobs: [] as BackgroundJob[],
    now: Date.now(),
    error: "",
  })

  let inflight = false
  // 内容相同不写 store：jobs 引用保持稳定，statusSections 才不会每 2 秒重建，
  // 也就不会把正在操作的分支下拉/输入框一并卸载。
  const signature = (jobs: BackgroundJob[]) => JSON.stringify(jobs)
  const load = () => {
    const id = sessionID()
    if (!id || inflight) return
    inflight = true
    void sdk.client.session
      .background({ directory: sdk.directory, sessionID: id })
      .then((result) => {
        const jobs = result.data ?? []
        if (signature(jobs) === signature(store.jobs)) {
          setStore("now", Date.now())
          return
        }
        setStore({ jobs, now: Date.now(), error: "" })
      })
      .catch((err: unknown) => setStore({ now: Date.now(), error: messageOf(err) }))
      .finally(() => {
        inflight = false
      })
  }

  createEffect(
    on(sessionID, (id) => {
      setStore("jobs", [])
      if (id) load()
    }),
  )

  const timer = setInterval(() => {
    setStore("now", Date.now())
    if (sessionID()) load()
    // 没有运行中的任务时，把过了展示期的已完成任务从本地列表移除；
    // 只在真的删掉东西时才写 store，避免空转导致区块重建。
    if (!store.jobs.some((job) => job.status === "running")) {
      const next = store.jobs.filter((job) => isJobVisible(job, Date.now()))
      if (next.length !== store.jobs.length) setStore("jobs", next)
    }
  }, 2000)
  onCleanup(() => clearInterval(timer))

  const visible = createMemo(() => visibleBackgroundJobs(store.jobs, store.now))

  const stop = (job: BackgroundJob) => {
    const id = sessionID()
    if (!id) return
    void sdk.client.session.background2
      .cancel({ directory: sdk.directory, sessionID: id, jobID: job.id })
      .then(() => load())
      .catch((err: unknown) => setStore("error", messageOf(err)))
  }

  const open = (job: BackgroundJob) => {
    const child = jobSessionID(job)
    const parent = jobParentID(job) ?? sessionID()
    if (!child || !parent) return
    layout.sidePane.openSession({
      id: sidePaneSubagentTabId(child),
      kind: "subagent",
      sessionID: child,
      parentID: parent,
      title: job.title ?? language.t("statusPanel.background.subagent"),
    })
  }

  const statusLabel = (job: BackgroundJob) => {
    if (job.status === "running") return language.t("statusPanel.background.running")
    if (job.status === "completed") return language.t("statusPanel.background.completed")
    if (job.status === "error") return language.t("statusPanel.background.failed")
    return language.t("statusPanel.background.cancelled")
  }

  const statusClass = (job: BackgroundJob) => {
    if (job.status === "running") return "text-foreground animate-pulse"
    if (job.status === "completed") return "text-success"
    if (job.status === "error") return "text-destructive"
    return "text-foreground-subtlest"
  }

  // 区块对象只在「有没有任务」变化时重建；now 的心跳只在 JSX 内的文本表达式里读取，
  // 不会通过 memo 向上冒泡成 statusSections 的重算。
  const section = createMemo(() => {
    if (store.jobs.length === 0) return null
    return {
      id: "background",
      title: language.t("statusPanel.background.title"),
      summary: <span class="tabular-nums">{backgroundJobStat(store.jobs, store.now)}</span>,
      defaultOpen: true,
      children: (
        <div class="flex flex-col gap-0.5 pb-1">
          <For each={visible()}>
            {(job) => (
              <div class="flex min-w-0 items-start gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-hover">
                <Icon name={jobIcon(job)} size="small" class="mt-0.5 shrink-0 text-foreground" />
                <button
                  type="button"
                  class="min-w-0 flex-1 text-left"
                  title={job.title ?? job.id}
                  onClick={() => {
                    if (jobSessionID(job)) open(job)
                  }}
                >
                  <div class="flex min-w-0 items-center gap-2">
                    <Show when={jobKindLabelKey(job)}>
                      {(key) => <Tag class="shrink-0">{language.t(key() as never)}</Tag>}
                    </Show>
                    <Show when={isResumed(job)}>
                      <Tag class="shrink-0">{language.t("statusPanel.background.resumed")}</Tag>
                    </Show>
                    <Show when={resumeSkipped(job)}>
                      <Tag class="shrink-0" title={language.t("statusPanel.background.resumeSkippedHint")}>
                        {language.t("statusPanel.background.resumeSkipped")}
                      </Tag>
                    </Show>
                    <span class="min-w-0 flex-1 truncate text-ui-base text-foreground">{job.title ?? job.id}</span>
                    <span class={`shrink-0 text-ui-xs tabular-nums ${statusClass(job)}`}>{statusLabel(job)}</span>
                    <span class="shrink-0 text-ui-xs tabular-nums text-foreground-subtlest">
                      {formatElapsed(Number(job.started_at), Number(job.completed_at), store.now)}
                    </span>
                  </div>
                  <Show when={job.status === "running" && job.output}>
                    <div class="mt-0.5 truncate font-mono text-ui-xs text-foreground-subtle">{job.output}</div>
                  </Show>
                  <Show when={showsResult(job)}>
                    <div class="mt-0.5 line-clamp-2 whitespace-pre-line font-mono text-ui-xs text-foreground-subtle">
                      {job.output}
                    </div>
                  </Show>
                  <Show when={job.status === "error" && job.error}>
                    <div class="mt-0.5 truncate text-ui-xs text-destructive">{job.error}</div>
                  </Show>
                </button>
                <Show when={job.status === "running"}>
                  <IconButton
                    icon="stop"
                    variant="ghost"
                    size="small"
                    class="mt-0.5 h-5 w-5 shrink-0"
                    title={language.t("statusPanel.background.stop")}
                    aria-label={language.t("statusPanel.background.stop")}
                    onClick={() => stop(job)}
                  />
                </Show>
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
