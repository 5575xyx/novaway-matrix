import { createMemo, Show } from "solid-js"
import { useParams } from "@solidjs/router"
import { Icon } from "@novaway/ui/icon"
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

// 顶栏那个点开的 popover 已经并进右侧状态卡片：卡片头给命中率，卡片体铺完整统计。
// 摘要值和明细来自同一份 metrics，展开后看到的百分比必然就是卡片头上那个数字。
export function useSessionCacheUsage() {
  const params = useParams()
  const globalSync = useGlobalSync()
  const language = useLanguage()

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

  return { metrics, hitRate, formatter }
}

export function CacheUsageBody() {
  const usage = useSessionCacheUsage()

  return (
    <div class="p-3">
      <Show
        when={usage.metrics().calls > 0}
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
            <span class="text-24-semibold text-text-strong">{usage.hitRate()}%</span>
          </div>
          <span class="text-11-regular text-text-weak">
            已调用 {usage.formatter().format(usage.metrics().calls)} 次
          </span>
        </div>
        <div class="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-hover">
          <div
            class="h-full rounded-full bg-[var(--icon-blue)] transition-all duration-300"
            style={{ width: `${usage.hitRate()}%` }}
          />
        </div>
        <div class="mt-3 grid grid-cols-2 gap-2">
          <Stat label="缓存命中（读取）" value={usage.formatter().format(usage.metrics().cacheRead)} />
          <Stat label="缓存写入（新写入）" value={usage.formatter().format(usage.metrics().cacheWrite)} />
          <Stat label="未命中输入" value={usage.formatter().format(usage.metrics().input)} />
          <Stat label="总输入" value={usage.formatter().format(usage.metrics().totalInput)} />
        </div>
      </Show>
    </div>
  )
}
