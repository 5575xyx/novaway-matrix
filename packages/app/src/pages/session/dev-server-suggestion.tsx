import { Button } from "@novaway/ui/button"
import { Icon } from "@novaway/ui/icon"
import { IconButton } from "@novaway/ui/icon-button"
import { Tooltip } from "@novaway/ui/tooltip"
import { Show } from "solid-js"
import { useDevServers } from "@/context/dev-server"
import { useLanguage } from "@/context/language"

// 终端输出里发现本地 dev server 时浮出的建议条。绝对定位在会话面板右下角，
// 只在有待处理建议时渲染，因此不会常态遮挡会话内容。
export function DevServerSuggestion() {
  const language = useLanguage()
  const devServers = useDevServers()

  return (
    <Show when={devServers.pending}>
      {(url) => (
        <div class="absolute right-3 bottom-3 z-20 flex max-w-[calc(100%-1.5rem)] items-center gap-2 rounded-xl border border-border-weak-base bg-surface-raised-stronger-non-alpha px-2.5 py-2 text-text-strong shadow-[var(--shadow-lg-border-base)]">
          <Icon name="terminal" size="small" class="shrink-0 text-icon-weak" />
          <div class="flex min-w-0 flex-col">
            <span class="text-12-medium leading-tight">{language.t("preview.suggestion.title")}</span>
            <code class="truncate text-11-regular text-text-weak">{url()}</code>
          </div>
          <Button variant="primary" size="small" class="ml-1 shrink-0" onClick={() => devServers.accept()}>
            {language.t("preview.suggestion.open")}
          </Button>
          <Tooltip value={language.t("preview.suggestion.dismiss")} placement="top">
            <IconButton
              icon="close-small"
              variant="ghost"
              class="shrink-0"
              onClick={() => devServers.dismiss()}
              aria-label={language.t("preview.suggestion.dismiss")}
            />
          </Tooltip>
        </div>
      )}
    </Show>
  )
}
