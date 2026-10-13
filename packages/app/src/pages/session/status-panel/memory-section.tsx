import { MemoryEvolutionPanel, useMemoryEvolutionPending } from "@/components/memory-evolution-panel"
import { pendingBadgeLabel } from "@/components/review-ui-helpers"
import { useLanguage } from "@/context/language"
import type { StatusPanelSection } from "./status-panel"

// 记忆与进化是全局能力，和"这次任务在不在跑"无关。卡片头给待审条数，展开就是整块审核面板。
export function useMemorySection(): () => StatusPanelSection {
  const language = useLanguage()
  const pending = useMemoryEvolutionPending()

  return () => ({
    id: "memory",
    title: language.t("memory.evolution.title"),
    summary: <>{pendingBadgeLabel(pending())}</>,
    defaultOpen: false,
    children: <MemoryEvolutionPanel />,
  })
}
