import { Show, type Component } from "solid-js"
import { Button } from "@novaway/ui/button"
import { Icon } from "@novaway/ui/icon"
import { useLanguage } from "@/context/language"

export const TaskDecisionCard: Component<{
  count: number
  onOpenDetails: () => void
}> = (props) => {
  const language = useLanguage()
  return (
    <Show when={props.count > 0}>
      <div class="flex flex-wrap items-center gap-2 rounded-lg border border-warning-base bg-surface px-3 py-2 text-ui-xs">
        <Icon name="warning" size="small" class="text-warning-base" />
        <span class="font-medium text-foreground">{language.t("taskDecision.title" as never)}</span>
        <span class="text-foreground-subtlest">{language.t("taskDecision.hint" as never, { count: props.count } as never)}</span>
        <Button variant="ghost" size="small" class="ml-auto" onClick={props.onOpenDetails}>
          {language.t("taskDecision.open" as never)}
          <Icon name="chevron-right" size="small" class="ml-0.5" />
        </Button>
      </div>
    </Show>
  )
}
