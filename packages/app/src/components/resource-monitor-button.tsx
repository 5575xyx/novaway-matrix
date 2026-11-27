import { Icon } from "@novaway/ui/icon"
import { Popover } from "@novaway/ui/popover"
import { For, Show, onMount, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { formatResourceSize } from "./settings-data"

type Location = { id: string; label: string; path: string; size: number; fileCount: number }
type Report = { generatedAt: number; totalSize: number; locations: Location[] }
type Cleanup = { olderThanDays: number; lastRunAt: number | null }

/** Compact desktop-only activity-rail popover for runtime files. */
export const ResourceMonitorButton: Component = () => {
  const language = useLanguage()
  const [state, setState] = createStore({
    report: undefined as Report | undefined,
    cleanup: { olderThanDays: 3, lastRunAt: null } as Cleanup,
    cleaning: false,
  })
  const available = () => window.api?.getResourceReport !== undefined
  const locationLabel = (id: string) => language.t(`settings.data.location.${id}` as never)

  const refresh = async () => {
    const report = await window.api?.getResourceReport?.()
    const cleanup = await window.api?.getResourceCleanupConfig?.()
    if (report) setState("report", report as Report)
    if (cleanup) setState("cleanup", cleanup as Cleanup)
  }
  const clean = async () => {
    if (!window.api?.cleanResources) return
    setState("cleaning", true)
    await window.api.cleanResources(state.cleanup.olderThanDays)
    await refresh()
    setState("cleaning", false)
  }
  onMount(() => void refresh())

  return (
    <Popover
      placement="right-end"
      gutter={8}
      style={{ width: "320px", padding: 0 }}
      onOpenChange={(open) => {
        if (open) void refresh()
      }}
      onOpenAutoFocus={(event) => event.preventDefault()}
      triggerAs="button"
      triggerProps={{
        type: "button",
        "aria-label": language.t("settings.monitor.open" as never),
        class:
          "group relative flex size-10 shrink-0 items-center justify-center rounded-[10px] text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground",
      }}
      trigger={<Icon name="chart" size="normal" class="transition-transform duration-150 group-hover:scale-105" />}
    >
      <div class="flex flex-col gap-2 p-3">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2 text-13-medium text-foreground">
            <Icon name="chart" size="small" />
            {language.t("settings.monitor.title" as never)}
          </div>
          <button
            type="button"
            class="rounded p-1 text-foreground-subtle hover:bg-hover hover:text-foreground"
            onClick={() => void refresh()}
            aria-label={language.t("settings.data.refresh" as never)}
          >
            <Icon name="refresh" size="small" />
          </button>
        </div>
        <Show
          when={available()}
          fallback={
            <div class="py-3 text-12-regular text-foreground-subtle">
              {language.t("settings.data.noDesktop" as never)}
            </div>
          }
        >
          <Show when={state.report} fallback={<div class="py-3 text-12-regular text-foreground-subtle">…</div>}>
            {(report) => (
              <>
                <div class="rounded-lg border border-border bg-surface px-3 py-2">
                  <div class="text-11-regular text-foreground-subtle">{language.t("settings.data.total" as never)}</div>
                  <div class="mt-0.5 text-18-semibold tabular-nums text-foreground">
                    {formatResourceSize(report().totalSize)}
                  </div>
                </div>
                <div class="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
                  <For each={report().locations}>
                    {(location) => (
                      <div class="flex items-center gap-2 px-3 py-2">
                        <Icon
                          name={location.id === "logs" ? "console" : location.id === "temp" ? "lu-clock" : "database"}
                          size="small"
                          class="shrink-0 text-foreground-subtle"
                        />
                        <div class="min-w-0 flex-1">
                          <div class="truncate text-12-medium text-foreground">{locationLabel(location.id)}</div>
                          <div class="text-11-regular text-foreground-subtle">
                            {location.fileCount} {language.t("settings.data.files" as never)}
                          </div>
                        </div>
                        <span class="shrink-0 text-12-medium tabular-nums text-foreground-subtle">
                          {formatResourceSize(location.size)}
                        </span>
                      </div>
                    )}
                  </For>
                </div>
                <div class="flex items-center justify-between gap-2 pt-1">
                  <span class="text-11-regular text-foreground-subtle">
                    {language.t("settings.data.cleanupDays" as never)} {state.cleanup.olderThanDays}{" "}
                    {language.t("settings.data.days" as never)}
                  </span>
                  <button
                    type="button"
                    class="flex items-center gap-1 rounded-md bg-surface-critical-weak px-2 py-1.5 text-11-medium text-foreground transition-colors hover:bg-surface-critical-base/20"
                    disabled={state.cleaning}
                    onClick={() => void clean()}
                  >
                    <Icon name="trash" size="small" />
                    {state.cleaning ? "…" : language.t("settings.data.cleanNow" as never)}
                  </button>
                </div>
              </>
            )}
          </Show>
        </Show>
      </div>
    </Popover>
  )
}
