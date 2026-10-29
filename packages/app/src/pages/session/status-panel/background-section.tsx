import { For, Show, createEffect, createMemo, onCleanup, on, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon } from "@novaway/ui/icon"
import { Tag } from "@novaway/ui/tag"
import { IconButton } from "@novaway/ui/icon-button"
import { useLanguage } from "@/context/language"
import { useLayout, sidePaneBackgroundTabId, sidePaneSubagentTabId } from "@/context/layout"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import {
  backgroundJobStat,
  formatElapsed,
  hideTeamMemberJobs,
  isResumed,
  jobIcon,
  jobKind,
  jobKindLabelKey,
  jobSessionID,
  visibleBackgroundJobs,
  type BackgroundJob,
} from "./background-section-model"
import type { StatusPanelSection } from "./status-panel"

const EMPTY_SESSION_IDS: ReadonlySet<string> = new Set()

const messageOf = (err: unknown) => {
  if (err instanceof Error) return err.message
  if (typeof err === "string") return err
  return String(err)
}

const jobParentID = (job: BackgroundJob): string | undefined => {
  const value = job.metadata?.parentSessionId
  return typeof value === "string" && value ? value : undefined
}

// 后台任务改为事件驱动（background.started/updated/completed → global-sync → store），
// 不再 2 秒轮询。首次切换会话时做一次 GET 引导，保证事件之前已存在的任务也能显示。
// 卡片只列正在运行的任务（结束的立刻消失），秒表也只在有运行中任务时走。
//
// hiddenSessionIDs: 团队卡片已经在展示的成员会话。子代理后台 job 与团队成员是
// 同一条会话，不去重的话右侧会同时出现「团队代理」和「后台任务」两遍同样的内容。
export function useBackgroundSection(
  sessionID: () => string,
  hiddenSessionIDs?: () => ReadonlySet<string>,
): () => StatusPanelSection | null {
  const sdk = useSDK()
  const sync = useSync()
  const language = useLanguage()
  const layout = useLayout()
  const [store, setStore] = createStore({
    error: "",
  })

  // 初始引导：切换会话时拉一次全量，事件后续增量更新由 global-sync 的 event-reducer 负责。
  const bootstrap = () => {
    const id = sessionID()
    if (!id) return
    void sdk.client.session
      .background({ directory: sdk.directory, sessionID: id })
      .then((result) => {
        const jobs = result.data ?? []
        const setStore = sync.set
        setStore("backgroundJob", id, jobs)
      })
      .catch((err: unknown) => setStore("error", messageOf(err)))
  }

  createEffect(
    on(sessionID, (id) => {
      setStore("error", "")
      if (id) {
        // 清掉旧会话的缓存，防止上一会话的任务残留。
        sync.set("backgroundJob", id, [])
        bootstrap()
      }
    }),
  )

  // 从 event-reducer 维护的 store 里取任务列表；事件到达即更新，无需轮询。
  const allJobs = createMemo(() => sync.data.backgroundJob[sessionID()] ?? [])

  // 只去掉「团队卡片里已经有的子代理 job」；shell / monitor / subscribe /
  // orchestrator 不在团队卡片里，仍然留在后台任务中。
  const remaining = createMemo(() => hideTeamMemberJobs(allJobs(), hiddenSessionIDs?.() ?? EMPTY_SESSION_IDS))

  // 秒表只在「有运行中的任务」时才走：全都停了就彻底安静——卡片上不再有要跳动的
  // 数字，每秒写一次 signal 只会白触发重渲染。已完成任务的时长仍定格在 completed_at
  // （formatElapsed 拿到结束时间就不读 now），显示不受影响。
  const [now, setNow] = createSignal(Date.now())
  let clock: ReturnType<typeof setInterval> | undefined
  createEffect(() => {
    void remaining()
    void now()
    if (remaining().some((job) => job.status === "running")) {
      if (!clock) clock = setInterval(() => setNow(Date.now()), 1000)
      return
    }
    if (clock) {
      clearInterval(clock)
      clock = undefined
    }
  })
  onCleanup(() => {
    if (clock) clearInterval(clock)
  })

  const visible = createMemo(() => visibleBackgroundJobs(remaining()))

  const stop = (job: BackgroundJob) => {
    const id = sessionID()
    if (!id) return
    void sdk.client.session.background2
      .cancel({ directory: sdk.directory, sessionID: id, jobID: job.id })
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

  /** 非子代理任务（命令/监视/订阅/编排）点开输出侧栏（对齐 ZCode 的 bash-output 标签）。 */
  const openOutput = (job: BackgroundJob) => {
    const id = sessionID()
    if (!id) return
    layout.sidePane.openSession({
      id: sidePaneBackgroundTabId(job.id),
      kind: "background",
      sessionID: id,
      parentID: id,
      title: job.title ?? job.id,
      jobID: job.id,
    })
  }

  /** 行点击：子代理钻取它的会话，其余任务看输出流。 */
  const openJob = (job: BackgroundJob) => {
    if (jobKind(job) === "agent" && jobSessionID(job)) open(job)
    else openOutput(job)
  }

  // 区块对象只在「有没有任务」变化时重建；now 的心跳只在 JSX 内的文本表达式里读取，
  // 不会通过 memo 向上冒泡成 statusSections 的重算。
  const section = createMemo(() => {
    if (visible().length === 0) return null
    return {
      id: "background",
      title: language.t("statusPanel.background.title"),
      summary: <span class="tabular-nums">{backgroundJobStat(remaining())}</span>,
      defaultOpen: false,
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
                  onClick={() => openJob(job)}
                >
                  <div class="flex min-w-0 items-center gap-2">
                    <Show when={jobKindLabelKey(job)}>
                      {(key) => <Tag class="shrink-0">{language.t(key() as never)}</Tag>}
                    </Show>
                    <Show when={isResumed(job)}>
                      <Tag class="shrink-0">{language.t("statusPanel.background.resumed")}</Tag>
                    </Show>
                    <span class="min-w-0 flex-1 truncate text-ui-base text-foreground">{job.title ?? job.id}</span>
                    <span class="shrink-0 text-ui-xs tabular-nums text-foreground novaway-breathe">
                      {language.t("statusPanel.background.running")}
                    </span>
                    <span class="shrink-0 text-ui-xs tabular-nums text-foreground-subtlest">
                      {formatElapsed(job.started_at, job.completed_at, now())}
                    </span>
                  </div>
                  <Show when={job.status === "running" && job.output}>
                    <div class="mt-0.5 truncate font-mono text-ui-xs text-foreground-subtle">{job.output}</div>
                  </Show>
                  <Show when={job.status === "error" && job.error}>
                    <div class="mt-0.5 truncate text-ui-xs text-destructive" title={job.error}>
                      {job.error}
                    </div>
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
