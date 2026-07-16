import { Show, createMemo } from "solid-js"
import { useQuery } from "@tanstack/solid-query"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useCommand } from "@/context/command"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { finiteNumber, pendingBadgeLabel } from "@/components/review-ui-helpers"

export function EvolutionIndicator() {
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const command = useCommand()

  const status = useQuery(() => ({
    queryKey: ["settings", "evolution", "status"],
    queryFn: () => globalSDK.client.evolution.status().then((x) => x.data),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  }))

  const pending = createMemo(() => finiteNumber(status.data?.pending))
  const badge = createMemo(() => pendingBadgeLabel(pending()))

  const openSettings = () => {
    command.trigger("settings.evolution.open")
  }

  return (
    <Show when={pending() > 0}>
      <Tooltip value={language.t("settings.evolution.title" as never)} placement="bottom">
        <Button
          variant="ghost"
          class="titlebar-icon w-8 h-6 p-0 box-border shrink-0 relative"
          onClick={openSettings}
          aria-label={language.t("settings.evolution.title" as never)}
        >
          <Icon size="small" name="branch" />
          <span class="absolute -top-0.5 -right-0.5 min-w-3.5 h-3.5 px-0.5 rounded-full bg-red-solid-base text-10-medium text-invert-base flex items-center justify-center leading-none">
            {badge()}
          </span>
        </Button>
      </Tooltip>
    </Show>
  )
}
