import { Component, Show, createEffect, createMemo, createSignal, onCleanup, startTransition, untrack } from "solid-js"
import { Button } from "@novaway/ui/button"
import { Tabs } from "@novaway/ui/tabs"
import { Icon } from "@novaway/ui/icon"
import { Spinner } from "@novaway/ui/spinner"
import { useParams } from "@solidjs/router"
import { useLanguage } from "@/context/language"
import { decode64 } from "@/utils/base64"
import { SettingsGeneral } from "./settings-general"
import { SettingsMemoryEvolution } from "./settings-memory-evolution"
import { SettingsProviders } from "./settings-providers"
import { SettingsModels } from "./settings-models"
import { SettingsAgents, SettingsMcp, SettingsPlugins, SettingsRules, SettingsSkills } from "./settings-runtime"
import { SettingsNotifications } from "./settings-notifications"

const settingsTabs = [
  "general",
  "notifications",
  "providers",
  "models",
  "agents",
  "memory",
  "skills",
  "rules",
  "mcp",
  "plugins",
] as const
export type SettingsTab = (typeof settingsTabs)[number]

const isSettingsTab = (value: string): value is SettingsTab => settingsTabs.some((tab) => tab === value)

export const DialogSettings: Component<{ initialTab?: SettingsTab; directory?: string; onBack?: () => void }> = (
  props,
) => {
  const language = useLanguage()
  const params = useParams()
  const directory = createMemo(() => props.directory ?? decode64(params.dir) ?? undefined)
  const [tab, setTab] = createSignal<SettingsTab>(props.initialTab ?? "general")
  const [switching, setSwitching] = createSignal(false)
  const timers = {
    switch: undefined as ReturnType<typeof setTimeout> | undefined,
    settle: undefined as ReturnType<typeof setTimeout> | undefined,
  }

  const clearTimers = () => {
    if (timers.switch !== undefined) {
      clearTimeout(timers.switch)
      timers.switch = undefined
    }
    if (timers.settle !== undefined) {
      clearTimeout(timers.settle)
      timers.settle = undefined
    }
  }

  createEffect(() => {
    const next = props.initialTab ?? "general"
    untrack(() => {
      if (next === tab()) return
      clearTimers()
      setSwitching(false)
      setTab(next)
    })
  })

  const changeTab = (value: string) => {
    if (!isSettingsTab(value)) return
    if (value === tab()) return
    clearTimers()
    setSwitching(true)
    timers.switch = setTimeout(() => {
      timers.switch = undefined
      void startTransition(() => setTab(value))
      timers.settle = setTimeout(() => {
        timers.settle = undefined
        setSwitching(false)
      }, 180)
    }, 50)
  }

  onCleanup(clearTimers)

  return (
    <div class="relative size-full min-h-0 min-w-0 bg-background-base">
      <Tabs
        orientation="vertical"
        variant="settings"
        value={tab()}
        onChange={changeTab}
        class="h-full settings-drawer"
        style={{ "--settings-accent": "var(--text-interactive-base)" }}
      >
        <Tabs.List>
          <div class="flex flex-col justify-between h-full w-full">
            <div class="flex flex-col gap-3 w-full">
              <Button
                variant="ghost"
                icon="arrow-left"
                class="w-full justify-start rounded-md"
                onClick={props.onBack}
                aria-label={language.t("common.goBack")}
              >
                {language.t("common.goBack")}
              </Button>
              <div class="h-px w-full bg-border-weak-base" />
              <div class="flex flex-col gap-1.5 w-full">
                <Tabs.Trigger value="general">
                  <Icon name="sliders" />
                  {language.t("settings.tab.general")}
                </Tabs.Trigger>
                <Tabs.Trigger value="notifications">
                  <Icon name="speech-bubble" />
                  消息通知
                </Tabs.Trigger>
                <Tabs.Trigger value="memory">
                  <Icon name="review" />
                  {language.t("settings.memory.title" as never)}
                </Tabs.Trigger>
                <Tabs.Trigger value="providers">
                  <Icon name="providers" />
                  {language.t("settings.providers.title")}
                </Tabs.Trigger>
                <Tabs.Trigger value="models">
                  <Icon name="models" />
                  {language.t("settings.models.title")}
                </Tabs.Trigger>
                <Tabs.Trigger value="agents">
                  <Icon name="brain" />
                  {language.t("settings.agents.title")}
                </Tabs.Trigger>
                <Tabs.Trigger value="skills">
                  <Icon name="checklist" />
                  {language.t("settings.skills.title")}
                </Tabs.Trigger>
                <Tabs.Trigger value="rules">
                  <Icon name="shield" />
                  {language.t("settings.rules.title")}
                </Tabs.Trigger>
                <Tabs.Trigger value="mcp">
                  <Icon name="mcp" />
                  {language.t("settings.mcp.title")}
                </Tabs.Trigger>
                <Tabs.Trigger value="plugins">
                  <Icon name="server" />
                  {language.t("settings.plugins.title")}
                </Tabs.Trigger>
              </div>
            </div>
          </div>
        </Tabs.List>
        <Tabs.Content value="general" class="no-scrollbar">
          <SettingsGeneral />
        </Tabs.Content>
        <Tabs.Content value="notifications" class="no-scrollbar">
          <SettingsNotifications />
        </Tabs.Content>
        <Tabs.Content value="providers" class="no-scrollbar">
          <SettingsProviders />
        </Tabs.Content>
        <Tabs.Content value="models" class="no-scrollbar">
          <SettingsModels />
        </Tabs.Content>
        <Tabs.Content value="agents" class="no-scrollbar">
          <SettingsAgents />
        </Tabs.Content>
        <Tabs.Content value="memory" class="no-scrollbar">
          <SettingsMemoryEvolution />
        </Tabs.Content>
        <Tabs.Content value="skills" class="no-scrollbar">
          <SettingsSkills />
        </Tabs.Content>
        <Tabs.Content value="rules" class="no-scrollbar">
          <SettingsRules directory={directory()} />
        </Tabs.Content>
        <Tabs.Content value="mcp" class="no-scrollbar">
          <SettingsMcp />
        </Tabs.Content>
        <Tabs.Content value="plugins" class="no-scrollbar">
          <SettingsPlugins />
        </Tabs.Content>
      </Tabs>
      <Show when={switching()}>
        <div class="absolute inset-0 z-30 flex items-start justify-center bg-background-base/70 pt-6">
          <div class="flex items-center gap-2 rounded-md border border-border-weak-base bg-surface-raised-stronger-non-alpha px-3 py-2 text-12-medium text-text-base shadow-sm">
            <Spinner class="size-3.5" />
            <span>{language.t("common.loading")}</span>
          </div>
        </div>
      </Show>
    </div>
  )
}
