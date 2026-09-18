import { Icon } from "@novaway/ui/icon"
import { IconButton } from "@novaway/ui/icon-button"
import { Tooltip } from "@novaway/ui/tooltip"
import { on, createEffect, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { usePreview } from "@/context/preview"
import { usePreviewInspection } from "@/context/preview-inspection"
import { normalizePreviewUrl } from "@/utils/preview-url"

const IFRAME_SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock"

const IFRAME_ALLOW = "fullscreen"

export function PreviewPanel() {
  const language = useLanguage()
  const preview = usePreview()
  const inspection = usePreviewInspection()

  const url = preview.url
  const embedUrl = preview.embedUrl

  const [store, setStore] = createStore({
    draft: url(),
    invalid: false,
    reload: 1,
  })

  createEffect(
    on(
      url,
      (next) => {
        if (store.draft === next) return
        setStore("draft", next)
        setStore("invalid", false)
      },
      { defer: true },
    ),
  )

  const go = () => {
    // 空输入表示还没填，不是非法地址；红字报错在这里是噪音，占位提示已经说明了格式
    if (!store.draft.trim()) return
    const normalized = normalizePreviewUrl(store.draft)
    if (!normalized) {
      setStore("invalid", true)
      return
    }
    setStore("invalid", false)
    preview.setUrl(normalized)
    setStore("reload", store.reload + 1)
  }

  const refresh = () => {
    if (!url()) return
    setStore("reload", store.reload + 1)
  }

  const openExternal = () => {
    if (!url()) return
    window.open(url(), "_blank", "noopener,noreferrer")
  }

  return (
    <div
      id="preview-panel"
      role="region"
      aria-label={language.t("preview.title")}
      class="flex h-full min-h-0 flex-col overflow-hidden bg-background-stronger"
    >
      <div class="flex h-10 shrink-0 items-center gap-1.5 border-b border-border-weak-base bg-background-stronger px-2">
        <div class="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border-weak-base bg-surface-panel px-2 focus-within:border-border-strong-base">
          <Icon name="link" size="small" class="shrink-0 text-icon-weak" />
          <input
            value={store.draft}
            onInput={(event) => {
              setStore("draft", event.currentTarget.value)
              if (store.invalid) setStore("invalid", false)
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return
              event.preventDefault()
              go()
            }}
            class="min-w-0 flex-1 bg-transparent text-12-regular text-text-strong outline-none placeholder:text-text-weaker"
            placeholder={language.t("preview.url.placeholder")}
            aria-label={language.t("preview.url.placeholder")}
            spellcheck={false}
            autocomplete="off"
          />
          <Show when={store.invalid}>
            <span class="shrink-0 text-11-regular text-rose-600 dark:text-rose-400">
              {language.t("preview.invalid")}
            </span>
          </Show>
        </div>
        <Tooltip
          value={inspection.ready() ? language.t("preview.pick.toggle") : language.t("preview.pick.unavailable")}
          placement="top"
        >
          <IconButton
            icon="window-cursor"
            variant="ghost"
            onClick={inspection.toggle}
            disabled={!inspection.ready()}
            classList={{
              "bg-surface-interactive-hover text-text-strong": inspection.armed(),
            }}
            aria-label={language.t("preview.pick.toggle")}
            aria-pressed={inspection.armed()}
          />
        </Tooltip>
        <Tooltip value={language.t("preview.go")} placement="top">
          <IconButton icon="enter" variant="ghost" onClick={go} aria-label={language.t("preview.go")} />
        </Tooltip>
        <Tooltip value={language.t("preview.refresh")} placement="top">
          <IconButton
            icon="refresh"
            variant="ghost"
            onClick={refresh}
            disabled={!url()}
            aria-label={language.t("preview.refresh")}
          />
        </Tooltip>
        <Tooltip value={language.t("preview.openExternal")} placement="top">
          <IconButton
            icon="square-arrow-top-right"
            variant="ghost"
            onClick={openExternal}
            disabled={!url()}
            aria-label={language.t("preview.openExternal")}
          />
        </Tooltip>
      </div>

      <div class="relative min-h-0 flex-1">
        {/* keyed Show 的 children 在 untrack 中执行，故把刷新序号与 URL 一起作为 when 值：任一变化都生成新对象，从而重新挂载 iframe */}
        <Show when={embedUrl() ? { target: embedUrl(), reload: store.reload } : undefined} keyed>
          {(frame) => (
            <iframe
              src={frame.target}
              title={frame.target}
              class="absolute inset-0 h-full w-full border-0"
              sandbox={IFRAME_SANDBOX}
              allow={IFRAME_ALLOW}
              referrerPolicy="no-referrer-when-downgrade"
              ref={(element) => inspection.setFrame(element)}
            />
          )}
        </Show>
        <Show when={!url()}>
          <div class="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <div class="flex size-10 items-center justify-center rounded-xl border border-border-weak-base bg-surface-panel">
              <Icon name="browser" size="large" class="text-icon-weak" />
            </div>
            <div class="text-14-medium text-text-strong">{language.t("preview.title")}</div>
            <div class="max-w-80 text-12-regular leading-relaxed text-text-weak">
              {language.t("preview.empty.description")}
            </div>
            <div class="max-w-80 text-11-regular leading-relaxed text-text-weaker">
              {language.t("preview.empty.hint")}
            </div>
          </div>
        </Show>
      </div>
    </div>
  )
}
