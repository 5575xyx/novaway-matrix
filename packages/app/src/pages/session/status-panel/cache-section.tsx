import { CacheUsageBody, useSessionCacheUsage } from "@/components/cache-usage-panel"
import { useLanguage } from "@/context/language"
import type { StatusPanelSection } from "./status-panel"

// 缓存统计是整个会话累积出来的（和 git 一样），不是这一轮运行的临时残留，所以任务停下也留着。
// 没有任何调用记录时整块不进 sections：空卡片只会白占右上角。
export function useCacheSection(): () => StatusPanelSection | null {
  const language = useLanguage()
  const usage = useSessionCacheUsage()

  return () => {
    if (usage.metrics().calls <= 0) return null

    return {
      id: "cache",
      title: language.t("cache.hit.rate"),
      summary: <>{usage.hitRate()}%</>,
      defaultOpen: false,
      children: <CacheUsageBody />,
    }
  }
}
