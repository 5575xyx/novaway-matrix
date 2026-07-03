import { Component, Show, createMemo } from "solid-js"
import { Drawer } from "@opencode-ai/ui/drawer"
import { Tabs } from "@opencode-ai/ui/tabs"
import { Icon } from "@opencode-ai/ui/icon"
import { useQuery } from "@tanstack/solid-query"
import { useParams } from "@solidjs/router"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { decode64 } from "@/utils/base64"
import { pathKey } from "@/utils/path-key"
import { SettingsGeneral } from "./settings-general"
import { SettingsEvolution } from "./settings-evolution"
import { SettingsMemory } from "./settings-memory"
import { SettingsProviders } from "./settings-providers"
import { SettingsModels } from "./settings-models"
import { SettingsAgents, SettingsMcp, SettingsPlugins, SettingsRules, SettingsSkills } from "./settings-runtime"

type SettingsTab = "general" | "providers" | "models" | "agents" | "memory" | "evolution" | "skills" | "rules" | "mcp" | "plugins"
const NOVAWAY_VERSION = "1.0.0"

export const DialogSettings: Component<{ initialTab?: SettingsTab; directory?: string }> = (props) => {
  const language = useLanguage()
  const params = useParams()
  const globalSDK = useGlobalSDK()
  const directory = createMemo(() => props.directory ?? decode64(params.dir) ?? undefined)
  const client = createMemo(() => directory() ? globalSDK.createClient({ directory: directory(), throwOnError: true }) : globalSDK.client)
  const settingsAgents = useQuery(() => ({
    queryKey: ["settings", "agents"],
    queryFn: () => client().app.agents().then((x) => x.data ?? []),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  }))
  const agentFiles = useQuery(() => ({
    queryKey: ["settings", "agent-files"],
    queryFn: () => client().settings.agent.list().then((x) => x.data ?? []),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  }))
  const skillFiles = useQuery(() => ({
    queryKey: ["settings", "skill-files"],
    queryFn: () => client().settings.skill.list().then((x) => x.data ?? []),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  }))
  const projectRules = useQuery(() => ({
    queryKey: ["settings", "project-rules", directory() ? pathKey(directory()!) : "none"],
    queryFn: () => directory() ? client().settings.rule.list({ scope: "project" }).then((x) => x.data ?? []) : Promise.resolve([]),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  }))
  const mcp = useQuery(() => ({
    queryKey: ["settings", "mcp"],
    queryFn: () => client().mcp.status().then((x) => x.data ?? {}),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  }))
  const loading = () => settingsAgents.isLoading || agentFiles.isLoading || skillFiles.isLoading || projectRules.isLoading || mcp.isLoading

  return (
    <Drawer transition>
      <Show
        when={!loading()}
        fallback={
          <div class="relative flex h-full items-center justify-center overflow-hidden bg-background-base px-8">
            <style>{`
              @keyframes settings-tech-spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
              }
              @keyframes settings-tech-counter {
                from { transform: rotate(360deg); }
                to { transform: rotate(0deg); }
              }
              @keyframes settings-tech-radar {
                0% { transform: rotate(0deg); opacity: 0.18; }
                45% { opacity: 0.62; }
                100% { transform: rotate(360deg); opacity: 0.18; }
              }
              @keyframes settings-tech-core {
                0%, 100% { transform: translate(-50%, -50%) scale(0.82); opacity: 0.72; box-shadow: 0 0 18px rgba(34, 211, 238, 0.35); }
                50% { transform: translate(-50%, -50%) scale(1.08); opacity: 1; box-shadow: 0 0 42px rgba(34, 211, 238, 0.75); }
              }
              @keyframes settings-tech-grid {
                0% { background-position: 0 0, 0 0; opacity: 0.2; }
                50% { opacity: 0.36; }
                100% { background-position: 36px 36px, 36px 36px; opacity: 0.2; }
              }
              @keyframes settings-tech-node {
                0%, 100% { opacity: 0.3; transform: scale(0.72); }
                50% { opacity: 1; transform: scale(1.18); }
              }
              @keyframes settings-tech-bar {
                0%, 100% { transform: scaleY(0.32); opacity: 0.38; }
                50% { transform: scaleY(1); opacity: 1; }
              }
              .settings-tech-grid {
                background-image:
                  linear-gradient(rgba(56, 189, 248, 0.08) 1px, transparent 1px),
                  linear-gradient(90deg, rgba(56, 189, 248, 0.08) 1px, transparent 1px);
                background-size: 36px 36px;
                animation: settings-tech-grid 4.8s linear infinite;
              }
              .settings-tech-ring {
                background:
                  conic-gradient(from 0deg, transparent 0deg, rgba(56, 189, 248, 0.12) 28deg, rgba(56, 189, 248, 0.95) 54deg, transparent 86deg, transparent 170deg, rgba(20, 184, 166, 0.8) 204deg, transparent 238deg, transparent 360deg);
                animation: settings-tech-spin 1.45s linear infinite;
                -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2px));
                mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2px));
              }
              .settings-tech-ring-wide {
                background:
                  conic-gradient(from 120deg, transparent 0deg, rgba(125, 211, 252, 0.85) 42deg, transparent 76deg, transparent 155deg, rgba(45, 212, 191, 0.7) 184deg, transparent 218deg, transparent 360deg);
                animation: settings-tech-counter 2.15s linear infinite;
                -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 4px));
                mask: radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 4px));
              }
              .settings-tech-radar {
                background: conic-gradient(from 0deg, rgba(56, 189, 248, 0.38), rgba(56, 189, 248, 0.08) 42deg, transparent 88deg, transparent 360deg);
                animation: settings-tech-radar 1.8s linear infinite;
              }
              .settings-tech-core {
                animation: settings-tech-core 1.25s ease-in-out infinite;
              }
              .settings-tech-node {
                animation: settings-tech-node 1.6s ease-in-out infinite;
              }
              .settings-tech-bar {
                animation: settings-tech-bar 1s ease-in-out infinite;
                transform-origin: bottom;
              }
            `}</style>
            <div class="settings-tech-grid absolute inset-0" />
            <div class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(56,189,248,0.10),transparent_34%)]" />
            <div class="relative flex flex-col items-center gap-6 text-center">
              <div class="relative size-36">
                <span class="absolute inset-0 rounded-full bg-cyan-300/[0.03] shadow-[0_0_54px_rgba(56,189,248,0.14)]" />
                <span class="settings-tech-ring-wide absolute inset-4 rounded-full" />
                <span class="settings-tech-ring absolute inset-8 rounded-full" />
                <span class="settings-tech-radar absolute inset-10 rounded-full opacity-70" />
                <span class="absolute inset-[42px] rounded-full border border-cyan-300/20 bg-background-base/70" />
                <span class="settings-tech-core absolute left-1/2 top-1/2 size-5 rounded-full bg-cyan-300" />
                <span class="settings-tech-node absolute left-1/2 top-5 size-2 -translate-x-1/2 rounded-full bg-cyan-200" />
                <span class="settings-tech-node absolute right-6 top-1/2 size-2 -translate-y-1/2 rounded-full bg-sky-200 [animation-delay:0.25s]" />
                <span class="settings-tech-node absolute bottom-5 left-1/2 size-2 -translate-x-1/2 rounded-full bg-teal-200 [animation-delay:0.5s]" />
                <span class="settings-tech-node absolute left-6 top-1/2 size-2 -translate-y-1/2 rounded-full bg-cyan-100 [animation-delay:0.75s]" />
              </div>
              <div class="flex flex-col gap-2">
                <span class="text-14-medium text-text-strong">{language.t("common.loading")}</span>
                <span class="text-12-regular text-text-weak">正在初始化设置资源与能力模块...</span>
                <div class="mt-1 flex h-5 items-end justify-center gap-1.5">
                  <span class="settings-tech-bar h-4 w-1 rounded-full bg-cyan-300/80" />
                  <span class="settings-tech-bar h-5 w-1 rounded-full bg-sky-300/80 [animation-delay:0.12s]" />
                  <span class="settings-tech-bar h-3 w-1 rounded-full bg-teal-300/80 [animation-delay:0.24s]" />
                  <span class="settings-tech-bar h-5 w-1 rounded-full bg-cyan-200/80 [animation-delay:0.36s]" />
                  <span class="settings-tech-bar h-4 w-1 rounded-full bg-sky-200/80 [animation-delay:0.48s]" />
                </div>
              </div>
            </div>
          </div>
        }
      >
        <Tabs orientation="vertical" variant="settings" defaultValue={props.initialTab ?? "general"} class="h-full settings-drawer">
        <Tabs.List>
          <div class="flex flex-col justify-between h-full w-full">
            <div class="flex flex-col gap-1.5 w-full pt-3">
              <Tabs.Trigger value="general">
                <Icon name="sliders" />
                {language.t("settings.tab.general")}
              </Tabs.Trigger>
              <Tabs.Trigger value="memory">
                <Icon name="review" />
                {language.t("settings.memory.title" as never)}
              </Tabs.Trigger>
              <Tabs.Trigger value="evolution">
                <Icon name="branch" />
                {language.t("settings.evolution.title" as never)}
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
        </Tabs.List>
        <Tabs.Content value="general" class="no-scrollbar" forceMount>
          <SettingsGeneral />
        </Tabs.Content>
        <Tabs.Content value="providers" class="no-scrollbar" forceMount>
          <SettingsProviders />
        </Tabs.Content>
        <Tabs.Content value="models" class="no-scrollbar" forceMount>
          <SettingsModels />
        </Tabs.Content>
        <Tabs.Content value="agents" class="no-scrollbar" forceMount>
          <SettingsAgents />
        </Tabs.Content>
        <Tabs.Content value="memory" class="no-scrollbar" forceMount>
          <SettingsMemory />
        </Tabs.Content>
        <Tabs.Content value="evolution" class="no-scrollbar" forceMount>
          <SettingsEvolution />
        </Tabs.Content>
        <Tabs.Content value="skills" class="no-scrollbar" forceMount>
          <SettingsSkills />
        </Tabs.Content>
        <Tabs.Content value="rules" class="no-scrollbar" forceMount>
          <SettingsRules directory={directory()} />
        </Tabs.Content>
        <Tabs.Content value="mcp" class="no-scrollbar" forceMount>
          <SettingsMcp />
        </Tabs.Content>
        <Tabs.Content value="plugins" class="no-scrollbar" forceMount>
          <SettingsPlugins />
        </Tabs.Content>
        </Tabs>
      </Show>
    </Drawer>
  )
}
