import { type Component } from "solid-js"
import { Button } from "@novaway/ui/button"
import { Icon } from "@novaway/ui/icon"
import { useLanguage } from "@/context/language"
import { KernelCapabilitiesCard } from "@/components/kernel-capabilities"

/**
 * 内核页。
 *
 * 之前「内核能力」是扩展页的第一个标签，和插件市场混在一起：一个是
 * 「这台实例实际加载了什么」，一个是「从市场装什么」，两种问题互不相干。
 * 拆成独立页面后，扩展页只剩插件，内核页专门回答运行时的真实状态。
 * 每一行都带一句解释 —— 光看「自动并行编排」「异步事件源」这种名字，
 * 没人知道它到底做了什么。
 */
export const KernelPage: Component<{
  directory: string
  onBack: () => void
  onOpenSettings?: (tab: "general" | "agents" | "hooks") => void
  onOpenTeams?: () => void
}> = (props) => {
  const language = useLanguage()

  return (
    <div class="flex h-full min-h-0 flex-col bg-background">
      <div class="shrink-0 border-b border-border px-4 py-3">
        <div class="flex items-center gap-2">
          <Button variant="ghost" size="small" onClick={() => props.onBack()}>
            <Icon name="arrow-left" size="small" />
            {language.t("common.goBack")}
          </Button>
          <span class="text-14-medium text-foreground">{language.t("kernel.page.title")}</span>
          <div class="flex-1" />
        </div>
        <div class="mt-1.5 pl-1 text-12-regular text-foreground-subtle">{language.t("kernel.page.hint")}</div>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div class="flex flex-col gap-3">
          <KernelCapabilitiesCard
            directory={props.directory}
            onOpenSettings={props.onOpenSettings}
            onOpenTeams={props.onOpenTeams}
          />
          <div class="px-1 text-ui-xs leading-relaxed text-foreground-subtlest">{language.t("kernel.page.about")}</div>
        </div>
      </div>
    </div>
  )
}
