import { createMemo, createSignal, Show } from "solid-js"
import { useParams } from "@solidjs/router"
import { Button } from "@novaway/ui/button"
import { Icon } from "@novaway/ui/icon"
import { Popover } from "@novaway/ui/popover"
import { Tooltip } from "@novaway/ui/tooltip"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { decode64 } from "@/utils/base64"
import { getSessionCacheMetrics } from "./session/session-context-metrics"

function Stat(props: { label: string; value: string }) {
  return (
    <div class="rounded-md border border-border-weak-base bg-surface-raised-base px-2.5 py-2">
      <div class="text-11-regular text-text-weak">{props.label}</div>
      <div class="mt-0.5 text-13-medium text-text-strong break-all">{props.value}</div>
    </div>
  )
}

export function CacheUsagePanel() {
  const params = useParams()
  const globalSync = useGlobalSync()
  const language = useLanguage()
  const [shown, setShown] = createSignal(false)

  const messages = createMemo(() => {
    const id = params.id
    const directory = params.dir ? decode64(params.dir) : undefined
    if (!id || !directory) return []
    const [store] = globalSync.child(directory, { bootstrap: false })
    return store.message[id] ?? []
  })
  const metrics = createMemo(() => getSessionCacheMetrics(messages()))
  const formatter = createMemo(() => new Intl.NumberFormat(language.intl()))
  const hitRate = createMemo(() => {
    const value = metrics().hitRate
    if (value == null) return null
    return Math.round(value * 1000) / 10
  })

  return (
    <Popover
      open={shown()}
      onOpenChange={setShown}
      triggerAs={Button}
      triggerProps={{
        variant: "ghost",
        class:
          "h-9 min-w-[96px] shrink-0 rounded-md border border-border-weak-base bg-surface-base/60 px-2 text-text-strong transition-all duration-150 hover:scale-[1.03] hover:border-border-active hover:bg-surface-hover",
        "aria-label": "缓存命中率",
        style: { scale: 1 },
      }}
      trigger={
        <Tooltip value="缓存命中率" placement="bottom">
          <div class="flex h-full items-center justify-center gap-1.5 whitespace-nowrap">
            <Icon size="small" name="server" class="text-icon-strong" />
            <span class="text-12-medium leading-none tracking-normal">缓存命中</span>
          </div>
        </Tooltip>
      }
      class="[&_[data-slot=popover-body]]:p-0 w-[360px] max-w-[calc(100vw-32px)] bg-background-strong shadow-[var(--shadow-lg-border-base)] rounded-lg border border-border-weak-base"
      gutter={4}
      placement="bottom-end"
      shift={-120}
    >
      <Show when={shown()}>
        <div class="flex max-h-[min(520px,calc(100vh-76px))] flex-col overflow-hidden">
          <div class="flex items-center justify-between border-b border-border-weak-base px-3 py-2">
            <div class="flex items-center gap-2">
              <Icon name="server" size="small" />
              <span class="text-13-medium text-text-strong">缓存命中率</span>
            </div>
            <span class="text-11-regular text-text-weak">当前会话</span>
          </div>

          <div class="p-3">
            <Show
              when={metrics().calls > 0}
              fallback={
                <div class="flex flex-col items-center gap-2 py-8 text-center">
                  <Icon name="server" size="normal" class="text-text-weak" />
                  <span class="text-12-regular text-text-weak">当前会话暂无 token 统计</span>
                </div>
              }
            >
              <div class="flex items-end justify-between gap-4">
                <div class="flex flex-col gap-1">
                  <span class="text-12-regular text-text-weak">缓存命中率</span>
                  <span class="text-24-semibold text-text-strong">{hitRate()}%</span>
                </div>
                <span class="text-11-regular text-text-weak">已调用 {formatter().format(metrics().calls)} 次</span>
              </div>
              <div class="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-hover">
                <div
                  class="h-full rounded-full bg-[var(--text-interactive-base)] transition-all duration-300"
                  style={{ width: `${hitRate()}%` }}
                />
              </div>
              <div class="mt-3 grid grid-cols-2 gap-2">
                <Stat label="缓存命中（读取）" value={formatter().format(metrics().cacheRead)} />
                <Stat label="缓存写入（新写入）" value={formatter().format(metrics().cacheWrite)} />
                <Stat label="未命中输入" value={formatter().format(metrics().input)} />
                <Stat label="总输入" value={formatter().format(metrics().totalInput)} />
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </Popover>
  )
}
