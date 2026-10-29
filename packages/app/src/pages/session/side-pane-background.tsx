import { Show, createEffect, createMemo, createSignal, on } from "solid-js"
import { Icon } from "@novaway/ui/icon"

import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import type { SidePaneSessionTab } from "@/context/layout"
import { JOB_ICONS, jobKind, type BackgroundJob } from "./status-panel/background-section-model"

/**
 * 只渲染尾部的行数。output 没有上限（shell 的 onOutput 每帧全量写回），
 * 整段塞进 DOM 会拖垮滚动；ZCode 的 BackgroundBashOutputSidePane 同样只展示
 * 固定 8KiB 尾窗。
 */
const TAIL_LINES = 500

/** 距底部多少像素以内仍算"贴着底部"。 */
const FOLLOW_THRESHOLD = 32

const statusKey = (status: BackgroundJob["status"]) => {
  if (status === "running") return "statusPanel.background.running"
  if (status === "completed") return "statusPanel.background.completed"
  if (status === "error") return "statusPanel.background.failed"
  return "statusPanel.background.cancelled"
}

const statusClass = (status: BackgroundJob["status"]) =>
  status === "running" ? "text-foreground novaway-breathe" : "text-foreground-subtlest"

/**
 * 后台任务输出侧栏（对齐 ZCode 的 `BackgroundBashOutputSidePane`）：
 * 顶栏状态 + 等宽输出区，输出实时跟随底部；向上滚动即暂停跟随并冻结画面，
 * 底部中央浮出「回到底部」按钮，点击或滚回底部恢复跟随。
 *
 * 数据直接读 global-sync store——`background.updated` 事件每次都带全量 output，
 * 不需要轮询。标签重新打开而任务已不在缓存里（切会话清理/重启后过期）时补一次
 * GET 引导；补完还找不到（超出持久化保留条数）就显示缺位提示。
 */
export function SidePaneBackgroundOutput(props: { tab: SidePaneSessionTab }) {
  const sync = useSync()
  const sdk = useSDK()
  const language = useLanguage()

  const jobs = createMemo(() => sync.data.backgroundJob[props.tab.sessionID] ?? [])
  const job = createMemo(() => jobs().find((item) => item.id === props.tab.jobID))
  const icon = () => (job() ? JOB_ICONS[jobKind(job()!)] : "dash")
  const title = () => props.tab.title || job()?.title || props.tab.jobID
  const outputTail = createMemo(() => (job() ? tail(job()!) : { text: "", truncated: false }))

  // 引导：任务不在缓存时拉一次全量。按 sessionID 记账，同一会话只补一次，
  // 避免与"GET 之后任务依然不在"（持久化条数超限）形成死循环。
  const attempted = new Set<string>()
  createEffect(() => {
    const sessionID = props.tab.sessionID
    if (!sessionID || job() || attempted.has(sessionID)) return
    attempted.add(sessionID)
    void sdk.client.session
      .background({ directory: sdk.directory, sessionID })
      .then((result) => sync.set("backgroundJob", sessionID, result.data ?? []))
      .catch(() => {})
  })

  const [follow, setFollow] = createSignal(true)
  let viewport: HTMLDivElement | undefined

  const toBottom = () => {
    if (!viewport) return
    viewport.scrollTop = viewport.scrollHeight
    setFollow(true)
  }

  const handleScroll = () => {
    if (!viewport) return
    setFollow(viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < FOLLOW_THRESHOLD)
  }

  // 输出变化时跟随底部。follow 为 false 时只读不写：用户正在往上翻历史，
  // 此时不许抢滚动条；重新 follow（点击按钮/滚回底部）会立即再贴到底。
  createEffect(
    on(
      () => job()?.output,
      () => {
        if (!follow()) return
        if (!viewport) return
        viewport.scrollTop = viewport.scrollHeight
      },
    ),
  )

  return (
    <Show
      when={job()}
      fallback={
        <div class="flex h-full items-center justify-center px-6 text-center text-ui-xs text-foreground-subtlest">
          {language.t("sidePane.background.missing")}
        </div>
      }
    >
      {(current) => (
        <div class="relative flex h-full min-h-0 flex-col">
          <div class="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
            <Icon name={icon()} size="small" class="shrink-0 text-foreground-subtlest" />
            <span class="min-w-0 flex-1 truncate text-ui-xs text-foreground" title={current().title ?? current().id}>
              {title()}
            </span>
            <span class={`shrink-0 text-ui-xs tabular-nums ${statusClass(current().status)}`}>
              {language.t(statusKey(current().status))}
            </span>
          </div>
          <div
            ref={(el) => (viewport = el)}
            class="flex-1 min-h-0 overflow-y-auto"
            onScroll={handleScroll}
          >
            <pre class="whitespace-pre-wrap break-words px-3 py-2 font-mono text-ui-xs leading-5 text-foreground-subtle">
              <Show when={outputTail().truncated}>
                <span class="text-foreground-subtlest">
                  {language.t("sidePane.background.truncated", { count: TAIL_LINES })}
                  {"\n"}
                </span>
              </Show>
              <Show when={current().output} fallback={language.t("sidePane.background.empty")}>
                {outputTail().text}
              </Show>
            </pre>
          </div>
          <Show when={!follow()}>
            <button
              type="button"
              data-component="side-pane-background-follow"
              class="absolute bottom-4 left-1/2 flex h-8 -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-panel px-3 text-ui-xs text-foreground shadow-md transition-colors hover:bg-hover"
              onClick={toBottom}
            >
              <Icon name="chevron-down" size="small" class="shrink-0" />
              {language.t("sidePane.background.follow")}
            </button>
          </Show>
        </div>
      )}
    </Show>
  )
}

/** 尾窗：超出行数只保留最后 TAIL_LINES 行（按行截断，不切半行）。 */
function tail(job: BackgroundJob): { text: string; truncated: boolean } {
  const text = job.output ?? ""
  const lines = text.split("\n")
  if (lines.length <= TAIL_LINES) return { text, truncated: false }
  return { text: lines.slice(-TAIL_LINES).join("\n"), truncated: true }
}
