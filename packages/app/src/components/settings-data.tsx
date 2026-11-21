import { Button } from "@novaway/ui/button"
import { Icon } from "@novaway/ui/icon"
import { For, Show, createEffect, onCleanup, onMount, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { SettingsGroup, SettingsPage, SettingsRow } from "./settings-parts"

export type ResourceLocationId = "data" | "config" | "cache" | "temp" | "logs"
type ResourceLocation = {
  id: ResourceLocationId
  label: string
  path: string
  defaultPath: string
  size: number
  fileCount: number
  lastModified: number | null
  exists: boolean
}
type ResourceReport = { generatedAt: number; totalSize: number; locations: ResourceLocation[] }
type CleanupConfig = { enabled: boolean; interval: "daily" | "weekly"; olderThanDays: number; lastRunAt: number | null }

export const formatResourceSize = (value: number) => {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`
}

const locationKey = (id: ResourceLocationId) => `settings.data.location.${id}` as never

export const SettingsData: Component = () => {
  const language = useLanguage()
  const [state, setState] = createStore({
    report: undefined as ResourceReport | undefined,
    cleanup: { enabled: false, interval: "daily" as "daily" | "weekly", olderThanDays: 3, lastRunAt: null } as CleanupConfig,
    loading: false,
    failed: false,
    cleaning: false,
    message: "",
  })
  const desktop = () => window.api?.getResourceReport !== undefined

  const refresh = async () => {
    if (!desktop()) return
    setState({ loading: true, failed: false })
    const reportRequest = window.api?.getResourceReport?.()
    const cleanupRequest = window.api?.getResourceCleanupConfig?.()
    const report = reportRequest ? await reportRequest.catch(() => undefined) : undefined
    const cleanup = cleanupRequest ? await cleanupRequest.catch(() => undefined) : undefined
    if (report) setState("report", report as ResourceReport)
    if (cleanup) setState("cleanup", cleanup as CleanupConfig)
    setState({ loading: false, failed: !report })
  }

  onMount(() => void refresh())
  createEffect(() => {
    if (!state.message) return
    const timer = window.setTimeout(() => setState("message", ""), 3500)
    onCleanup(() => window.clearTimeout(timer))
  })

  const chooseLocation = async (location: ResourceLocation) => {
    const picker = window.api?.openDirectoryPicker
    if (!picker || !window.api?.setResourceLocation) return
    const selected = await picker({ title: language.t("settings.data.changeDirectory" as never), defaultPath: location.path })
    if (typeof selected !== "string") return
    const report = await window.api.setResourceLocation(location.id, selected)
    setState("report", report as ResourceReport)
  }

  const setSchedule = async (enabled: boolean, interval = state.cleanup.interval) => {
    if (!window.api?.setResourceCleanupConfig) return
    const config = await window.api.setResourceCleanupConfig({ enabled, interval, olderThanDays: state.cleanup.olderThanDays })
    setState("cleanup", config as CleanupConfig)
  }

  const clean = async () => {
    if (!window.api?.cleanResources) return
    setState({ cleaning: true, message: "" })
    const result = await window.api.cleanResources(state.cleanup.olderThanDays)
    setState("message", language.t("settings.data.cleanResult" as never, {
      files: String(result.deletedFiles),
      size: formatResourceSize(result.deletedBytes),
    }))
    await refresh()
    setState("cleaning", false)
  }

  return (
    <SettingsPage title={language.t("settings.data.title" as never)} description={language.t("settings.data.description" as never)}>
      <Show
        when={state.report}
        fallback={
          <Show
            when={desktop()}
            fallback={<div class="rounded-xl border border-border bg-surface px-4 py-4 text-13-regular text-foreground-subtle">{language.t("settings.data.noDesktop" as never)}</div>}
          >
            <Show
              when={state.loading}
              fallback={<div class="rounded-xl border border-border bg-surface px-4 py-4 text-13-regular text-foreground-subtle">{language.t("settings.data.loadFailed" as never)}</div>}
            >
              <div class="flex min-h-28 items-center justify-center rounded-xl border border-border bg-surface text-13-regular text-foreground-subtle">
                <span class="flex items-center gap-2"><Icon name="refresh" size="small" class="animate-spin" />{language.t("settings.data.loading" as never)}</span>
              </div>
            </Show>
          </Show>
        }
      >
        {(report) => (
          <>
            <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div class="rounded-lg border border-border bg-surface px-3 py-3 sm:col-span-2">
                <div class="text-11-regular text-foreground-subtle">{language.t("settings.data.total" as never)}</div>
                <div class="mt-1 text-20-semibold tabular-nums text-foreground">{formatResourceSize(report().totalSize)}</div>
              </div>
              <div class="rounded-lg border border-border bg-surface px-3 py-3 sm:col-span-2">
                <div class="text-11-regular text-foreground-subtle">{language.t("settings.data.lastRun" as never)}</div>
                <div class="mt-1 text-14-medium text-foreground">{state.cleanup.lastRunAt ? new Date(state.cleanup.lastRunAt).toLocaleString() : language.t("settings.data.never" as never)}</div>
              </div>
            </div>
            <SettingsGroup>
              <For each={report().locations}>
                {(location) => (
                  <SettingsRow
                    label={language.t(locationKey(location.id))}
                    description={<span class="break-all">{location.path}</span>}
                    control={<div class="flex items-center gap-2">
                      <span class="text-12-medium tabular-nums text-foreground-subtle">{formatResourceSize(location.size)}</span>
                      <Button variant="ghost" size="small" icon="folder" onClick={() => void chooseLocation(location)}>{language.t("settings.data.changeDirectory" as never)}</Button>
                    </div>}
                    detail={<div class="flex items-center gap-2 text-11-regular text-foreground-subtle">
                      <span>{location.fileCount} {language.t("settings.data.files" as never)}</span>
                      <Show when={location.path === location.defaultPath}><span class="rounded bg-surface-interactive-weak px-1.5 py-0.5">{language.t("settings.data.default" as never)}</span></Show>
                    </div>}
                  />
                )}
              </For>
            </SettingsGroup>
            <SettingsGroup>
              <SettingsRow
                label={language.t("settings.data.monitor.title" as never)}
                description={language.t("settings.data.monitor.description" as never)}
                control={<div class="flex flex-wrap items-center justify-end gap-2">
                  <input
                    type="number"
                    min="1"
                    max="365"
                    class="h-8 w-16 rounded-md border border-border bg-background px-2 text-12-regular text-foreground"
                    value={state.cleanup.olderThanDays}
                    onChange={(event) => {
                      const days = Math.min(365, Math.max(1, Math.floor(Number(event.currentTarget.value) || 3)))
                      setState("cleanup", "olderThanDays", days)
                      void setSchedule(state.cleanup.enabled)
                    }}
                    aria-label={language.t("settings.data.cleanupDays" as never)}
                  />
                  <span class="text-12-regular text-foreground-subtle">{language.t("settings.data.days" as never)}</span>
                  <Button variant="secondary" size="small" icon="trash" disabled={state.cleaning} onClick={() => void clean()}>{state.cleaning ? "…" : language.t("settings.data.cleanNow" as never)}</Button>
                </div>}
              />
              <SettingsRow
                label={language.t("settings.data.schedule" as never)}
                control={<div class="flex flex-wrap gap-1">
                  <For each={["off", "daily", "weekly"] as const}>
                    {(option) => <button
                      type="button"
                      class="rounded-md border border-border px-2.5 py-1.5 text-12-regular text-foreground transition-colors hover:bg-hover"
                      classList={{ "border-interactive-base/60 bg-surface-interactive-weak": option === "off" ? !state.cleanup.enabled : state.cleanup.enabled && state.cleanup.interval === option }}
                      onClick={() => void setSchedule(option !== "off", option === "weekly" ? "weekly" : "daily")}
                    >{language.t(`settings.data.schedule.${option}` as never)}</button>}
                  </For>
                </div>}
              />
            </SettingsGroup>
            <div class="flex items-center justify-between text-12-regular text-foreground-subtle">
              <span class="text-success-base">{state.message}</span>
              <Button variant="ghost" size="small" icon="refresh" disabled={state.loading} onClick={() => void refresh()}>{language.t("settings.data.refresh" as never)}</Button>
            </div>
          </>
        )}
      </Show>
    </SettingsPage>
  )
}
