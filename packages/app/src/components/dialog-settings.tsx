import { Component, Suspense, createEffect, createMemo, createSignal, untrack } from "solid-js"
import { Button } from "@novaway/ui/button"
import { Tabs } from "@novaway/ui/tabs"
import { Icon } from "@novaway/ui/icon"
import { useParams } from "@solidjs/router"
import { useLanguage } from "@/context/language"
import { useGlobalSync } from "@/context/global-sync"
import { decode64 } from "@/utils/base64"
import { SettingsGeneral } from "./settings-general"
import { SettingsMemoryEvolution } from "./settings-memory-evolution"
import { SettingsProviders } from "./settings-providers"
import { SettingsAgents, SettingsMcp, SettingsPlugins, SettingsRules, SettingsSkills } from "./settings-runtime"
import { SettingsNotifications } from "./settings-notifications"
import { SettingsKeybinds } from "./settings-keybinds"
import { SettingsBrowser } from "./settings-browser"
import { SettingsComputer } from "./settings-computer"
import { SettingsCommands } from "./settings-commands"
import { SettingsHooks } from "./settings-hooks"
import { SettingsUsage } from "./settings-usage"

const settingsTabs = [
  "general",
  "notifications",
  "providers",
  "browser",
  "computer",
  "keybinds",
  "agents",
  "memory",
  "skills",
  "commands",
  "hooks",
  "rules",
  "usage",
  "mcp",
  "plugins",
] as const
export type SettingsTab = (typeof settingsTabs)[number]

const isSettingsTab = (value: string): value is SettingsTab => settingsTabs.some((tab) => tab === value)

// 设置页挂在**应用级** Suspense 之下。某个标签页里只要有一个资源还在加载，
// 整个应用就会被换成启动 Splash（用户看到的"切个菜单整页闪一下"）。
// 每个标签外面包一层局部 Suspense，把等待限制在面板内部。
const SettingsPanelFallback = () => (
  <div class="flex h-full flex-col gap-3 p-6 sm:p-10">
    <div class="h-6 w-40 animate-pulse rounded bg-surface" />
    <div class="h-4 w-72 animate-pulse rounded bg-surface" />
    <div class="mt-4 flex flex-col gap-2">
      <div class="h-14 animate-pulse rounded-lg bg-surface" />
      <div class="h-14 animate-pulse rounded-lg bg-surface" />
      <div class="h-14 animate-pulse rounded-lg bg-surface" />
    </div>
  </div>
)

export const DialogSettings: Component<{ initialTab?: SettingsTab; directory?: string; onBack?: () => void }> = (
  props,
) => {
  const language = useLanguage()
  const params = useParams()
  const directory = createMemo(() => props.directory ?? decode64(params.dir) ?? undefined)
  const [tab, setTab] = createSignal<SettingsTab>(props.initialTab ?? "general")
  const globalSync = useGlobalSync()

  /*
   * 配置写入是异步的（写文件 + 失效实例 + 重新拉取），而开关状态直接来自服务端
   * 返回的 config。中间这几百毫秒里开关不会动，用户会以为「点了没用」。
   * 这里在导航栏给一个明确的进行中/已完成指示，配合控件本身的按压动效，
   * 让每次写入都有可见的回执。
   */
  const [saveState, setSaveState] = createSignal<"idle" | "saving" | "saved">("idle")
  let wasSaving = false
  let savedTimer: number | undefined
  createEffect(() => {
    const pending = globalSync.data.reload === "pending"
    if (pending) {
      wasSaving = true
      setSaveState("saving")
      if (savedTimer !== undefined) window.clearTimeout(savedTimer)
      return
    }
    if (!wasSaving) return
    wasSaving = false
    setSaveState("saved")
    savedTimer = window.setTimeout(() => setSaveState("idle"), 1600)
  })

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
              {/* 写入回执：保存中 → 已保存，1.6s 后自动淡出。 */}
              <div
                class="flex h-4 items-center gap-1.5 px-2 text-11-regular transition-opacity duration-200"
                classList={{ "opacity-0": saveState() === "idle" }}
                aria-live="polite"
              >
                <span
                  class="size-1.5 rounded-full"
                  classList={{
                    "animate-pulse bg-[var(--icon-blue)]": saveState() === "saving",
                    "bg-success": saveState() === "saved",
                  }}
                />
                <span class="text-foreground-subtle">
                  {saveState() === "saving"
                    ? language.t("settings.save.saving")
                    : saveState() === "saved"
                      ? language.t("settings.save.saved")
                      : ""}
                </span>
              </div>
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
                  <Tabs.Trigger value="notifications">
                    <Icon name="speech-bubble" />
                    {language.t("settings.tabs.notifications")}
                  </Tabs.Trigger>
                  <Tabs.Trigger value="providers">
                    <Icon name="providers" />
                    {language.t("settings.providers.title")}
                  </Tabs.Trigger>
                  <Tabs.Trigger value="browser">
                    <Icon name="globe" />
                    {language.t("settings.browser.title")}
                  </Tabs.Trigger>
                  <Tabs.Trigger value="computer">
                    <Icon name="window-cursor" />
                    {language.t("settings.computer.title" as never)}
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
                  <Tabs.Trigger value="hooks">
                    <Icon name="lu-zap" />
                    {language.t("settings.hooks.tab")}
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
          <Suspense fallback={<SettingsPanelFallback />}>
            <SettingsGeneral />
          </Suspense>
        </Tabs.Content>
        <Tabs.Content value="notifications" class="no-scrollbar">
          <Suspense fallback={<SettingsPanelFallback />}>
            <SettingsNotifications />
          </Suspense>
        </Tabs.Content>
        <Tabs.Content value="providers" class="no-scrollbar">
          <Suspense fallback={<SettingsPanelFallback />}>
            <SettingsProviders />
          </Suspense>
        </Tabs.Content>
        <Tabs.Content value="browser" class="no-scrollbar">
          <Suspense fallback={<SettingsPanelFallback />}>
            <SettingsBrowser />
          </Suspense>
        </Tabs.Content>
        {/* 之前只有 Trigger 没有 Content：点「电脑控制」时整块面板是空白。 */}
        <Tabs.Content value="computer" class="no-scrollbar">
          <Suspense fallback={<SettingsPanelFallback />}>
            <SettingsComputer />
          </Suspense>
        </Tabs.Content>
        <Tabs.Content value="keybinds" class="no-scrollbar">
          <Suspense fallback={<SettingsPanelFallback />}>
            <SettingsKeybinds />
          </Suspense>
        </Tabs.Content>
        <Tabs.Content value="agents" class="no-scrollbar">
          <Suspense fallback={<SettingsPanelFallback />}>
            <SettingsAgents directory={directory()} />
          </Suspense>
        </Tabs.Content>
        <Tabs.Content value="memory" class="no-scrollbar">
          <Suspense fallback={<SettingsPanelFallback />}>
            <SettingsMemoryEvolution directory={directory()} />
          </Suspense>
        </Tabs.Content>
        <Tabs.Content value="skills" class="no-scrollbar">
          <Suspense fallback={<SettingsPanelFallback />}>
            <SettingsSkills />
          </Suspense>
        </Tabs.Content>
        <Tabs.Content value="commands" class="no-scrollbar">
          <Suspense fallback={<SettingsPanelFallback />}>
            <SettingsCommands directory={directory()} />
          </Suspense>
        </Tabs.Content>
        <Tabs.Content value="hooks" class="no-scrollbar">
          <Suspense fallback={<SettingsPanelFallback />}>
            <SettingsHooks directory={directory()} />
          </Suspense>
        </Tabs.Content>
        <Tabs.Content value="rules" class="no-scrollbar">
          <Suspense fallback={<SettingsPanelFallback />}>
            <SettingsRules directory={directory()} />
          </Suspense>
        </Tabs.Content>
        <Tabs.Content value="usage" class="no-scrollbar">
          <Suspense fallback={<SettingsPanelFallback />}>
            <SettingsUsage directory={directory()} />
          </Suspense>
        </Tabs.Content>
        <Tabs.Content value="mcp" class="no-scrollbar">
          <Suspense fallback={<SettingsPanelFallback />}>
            <SettingsMcp />
          </Suspense>
        </Tabs.Content>
        <Tabs.Content value="plugins" class="no-scrollbar">
          <Suspense fallback={<SettingsPanelFallback />}>
            <SettingsPlugins />
          </Suspense>
        </Tabs.Content>
      </Tabs>
    </div>
  )
}
