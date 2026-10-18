import { Component, createEffect, createMemo, createSignal, untrack } from "solid-js"
import { Button } from "@novaway/ui/button"
import { Tabs } from "@novaway/ui/tabs"
import { Icon } from "@novaway/ui/icon"
import { useParams } from "@solidjs/router"
import { useLanguage } from "@/context/language"
import { decode64 } from "@/utils/base64"
import { SettingsGeneral, SettingsPet } from "./settings-general"
import { SettingsMemoryEvolution } from "./settings-memory-evolution"
import { SettingsProviders } from "./settings-providers"
import { SettingsModels } from "./settings-models"
import { SettingsAgents, SettingsMcp, SettingsPlugins, SettingsRules, SettingsSkills } from "./settings-runtime"
import { SettingsNotifications } from "./settings-notifications"
import { SettingsKeybinds } from "./settings-keybinds"
import { SettingsBrowser } from "./settings-browser"
import { SettingsCommands } from "./settings-commands"
import { SettingsUsage } from "./settings-usage"

const settingsTabs = [
  "general",
  "desktop",
  "notifications",
  "providers",
  "models",
  "browser",
  "keybinds",
  "agents",
  "memory",
  "skills",
  "commands",
  "rules",
  "usage",
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

  createEffect(() => {
    const next = props.initialTab ?? "general"
    untrack(() => {
      if (next === tab()) return
      setTab(next)
    })
  })

  // 切换标签是**即时**的：每个面板自己有数据加载态，再叠一层全屏「加载中」
  // 只会让切换看起来卡顿（对齐 ZCode 的丝滑切换）。
  const changeTab = (value: string) => {
    if (!isSettingsTab(value)) return
    if (value === tab()) return
    setTab(value)
  }

  return (
    <div class="relative size-full min-h-0 min-w-0 bg-background">
      <Tabs
        orientation="vertical"
        variant="settings"
        value={tab()}
        onChange={changeTab}
        class="h-full settings-drawer"
        style={{ "--settings-accent": "var(--icon-blue)" }}
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
              <div class="h-px w-full bg-border" />
              {/*
                导航按 ZCode Settings 的三组组织（基础设置 / Agent 能力 / 数据与统计）：
                之前是十几个触发器的平铺列表，找不到"这属于哪一类"。
                分组标签用 Tabs.SectionTitle（settings 变体下是 12px 的弱化小标题）。
              */}
              <div class="flex flex-col gap-4 w-full">
                <div class="flex flex-col gap-1.5 w-full">
                  <Tabs.SectionTitle>{language.t("settings.group.basics")}</Tabs.SectionTitle>
                  <Tabs.Trigger value="general">
                    <Icon name="sliders" />
                    {language.t("settings.tab.general")}
                  </Tabs.Trigger>
                  <Tabs.Trigger value="desktop">
                    <Icon name="eye" />
                    {language.t("settings.tabs.pet")}
                  </Tabs.Trigger>
                  <Tabs.Trigger value="notifications">
                    <Icon name="speech-bubble" />
                    {language.t("settings.tabs.notifications")}
                  </Tabs.Trigger>
                  <Tabs.Trigger value="providers">
                    <Icon name="providers" />
                    {language.t("settings.providers.title")}
                  </Tabs.Trigger>
                  <Tabs.Trigger value="models">
                    <Icon name="models" />
                    {language.t("settings.models.title")}
                  </Tabs.Trigger>
                  <Tabs.Trigger value="browser">
                    <Icon name="globe" />
                    {language.t("settings.browser.title")}
                  </Tabs.Trigger>
                  <Tabs.Trigger value="keybinds">
                    <Icon name="keyboard" />
                    {language.t("settings.shortcuts.title")}
                  </Tabs.Trigger>
                </div>

                <div class="flex flex-col gap-1.5 w-full">
                  <Tabs.SectionTitle>{language.t("settings.group.agent")}</Tabs.SectionTitle>
                  <Tabs.Trigger value="memory">
                    <Icon name="review" />
                    {language.t("settings.memory.nav" as never)}
                  </Tabs.Trigger>
                  <Tabs.Trigger value="agents">
                    <Icon name="brain" />
                    {language.t("settings.agents.title")}
                  </Tabs.Trigger>
                  <Tabs.Trigger value="plugins">
                    <Icon name="server" />
                    {language.t("settings.plugins.title")}
                  </Tabs.Trigger>
                  <Tabs.Trigger value="mcp">
                    <Icon name="mcp" />
                    {language.t("settings.mcp.title")}
                  </Tabs.Trigger>
                  <Tabs.Trigger value="skills">
                    <Icon name="checklist" />
                    {language.t("settings.skills.title")}
                  </Tabs.Trigger>
                  <Tabs.Trigger value="commands">
                    <Icon name="console" />
                    {language.t("settings.commands.title")}
                  </Tabs.Trigger>
                  <Tabs.Trigger value="rules">
                    <Icon name="shield" />
                    {language.t("settings.rules.title")}
                  </Tabs.Trigger>
                </div>

                <div class="flex flex-col gap-1.5 w-full">
                  <Tabs.SectionTitle>{language.t("settings.group.usage")}</Tabs.SectionTitle>
                  <Tabs.Trigger value="usage">
                    <Icon name="chart" />
                    {language.t("settings.usage.title")}
                  </Tabs.Trigger>
                </div>
              </div>
            </div>
          </div>
        </Tabs.List>
        <Tabs.Content value="general" class="no-scrollbar">
          <SettingsGeneral />
        </Tabs.Content>
        <Tabs.Content value="desktop" class="no-scrollbar">
          <SettingsPet />
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
        <Tabs.Content value="browser" class="no-scrollbar">
          <SettingsBrowser />
        </Tabs.Content>
        <Tabs.Content value="keybinds" class="no-scrollbar">
          <SettingsKeybinds />
        </Tabs.Content>
        <Tabs.Content value="agents" class="no-scrollbar">
          <SettingsAgents />
        </Tabs.Content>
        <Tabs.Content value="memory" class="no-scrollbar">
          <SettingsMemoryEvolution directory={directory()} />
        </Tabs.Content>
        <Tabs.Content value="skills" class="no-scrollbar">
          <SettingsSkills />
        </Tabs.Content>
        <Tabs.Content value="commands" class="no-scrollbar">
          <SettingsCommands directory={directory()} />
        </Tabs.Content>
        <Tabs.Content value="rules" class="no-scrollbar">
          <SettingsRules directory={directory()} />
        </Tabs.Content>
        <Tabs.Content value="usage" class="no-scrollbar">
          <SettingsUsage directory={directory()} />
        </Tabs.Content>
        <Tabs.Content value="mcp" class="no-scrollbar">
          <SettingsMcp />
        </Tabs.Content>
        <Tabs.Content value="plugins" class="no-scrollbar">
          <SettingsPlugins />
        </Tabs.Content>
      </Tabs>
    </div>
  )
}
