import type {
  Agent,
  Config,
  McpStatus,
  Part,
  SettingsProjectInstructionGetResponse,
  SettingsAgentListResponse,
  SettingsRuleListResponse,
  SettingsSkillListResponse,
} from "@opencode-ai/sdk/v2/client"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Select } from "@opencode-ai/ui/select"
import { Switch } from "@opencode-ai/ui/switch"
import { Tag } from "@opencode-ai/ui/tag"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query"
import { createEffect, createMemo, createSignal, For, onCleanup, Show, type Component, type JSX } from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { agentDisplayName, skillDisplayName } from "@/utils/agent"
import { pathKey } from "@/utils/path-key"
import { SettingsList } from "./settings-list"
import { matchesModeGroup, modeGroupLabel, modeGroups, type ModeGroup } from "./settings-mode-groups"
import { agentSkillPermission, hasSkillPermission, withAgentSkills } from "./settings-agent-config"

type ConfigKey = "agent" | "skills" | "permission" | "mcp" | "plugin"
type ConfigRecordKey = Exclude<ConfigKey, "plugin">
type RuntimeIcon = "brain" | "checklist" | "server" | "mcp" | "shield"
type RuleFile = SettingsRuleListResponse[number]
type ProjectInstructionFile = SettingsProjectInstructionGetResponse
type RuleTrigger = "always" | "mention" | "auto"
type SkillAsset = SettingsSkillListResponse[number]
type SourceFilter = "all" | "built-in" | "custom"
type ModeFilter = "all" | "primary" | "subagent"
type ProjectInstructionGenerateProgress = {
  step: "session" | "command" | "waiting" | "written"
  title: string
  detail?: string
  content?: string
  answer?: string
}

const statusLabels = {
  connected: "mcp.status.connected",
  failed: "mcp.status.failed",
  needs_auth: "mcp.status.needs_auth",
  needs_client_registration: "mcp.status.needs_client_registration",
  disabled: "mcp.status.disabled",
} as const

const sourceFilters: Array<{ value: SourceFilter; label: string }> = [
  { value: "all", label: "settings.filters.all" },
  { value: "built-in", label: "settings.filters.builtIn" },
  { value: "custom", label: "settings.filters.custom" },
]

const modeFilters: Array<{ value: ModeFilter; label: string }> = [
  { value: "all", label: "settings.filters.all" },
  { value: "primary", label: "settings.filters.primary" },
  { value: "subagent", label: "settings.filters.subagent" },
]

const allCategoryFilter = "all"

const ruleTriggerOptions: Array<{ value: RuleTrigger; label: string; description: string }> = [
  { value: "always", label: "settings.rules.trigger.always", description: "settings.rules.trigger.always.description" },
  {
    value: "mention",
    label: "settings.rules.trigger.mention",
    description: "settings.rules.trigger.mention.description",
  },
  { value: "auto", label: "settings.rules.trigger.auto", description: "settings.rules.trigger.auto.description" },
]

const configValue = (config: Config, key: ConfigKey) => {
  if (key === "plugin") return config.plugin ?? []
  return config[key] ?? {}
}

const pretty = (value: unknown) => JSON.stringify(value, null, 2)
const ignoreResult = <T,>(promise: Promise<T>) => promise.then(() => undefined)
const settingsQueryOptions = {
  staleTime: Infinity,
  refetchOnWindowFocus: false,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function safeArray<T>(value: T[] | readonly T[] | undefined | null): T[] {
  return Array.isArray(value) ? value.slice() : []
}

function configRecord(config: Config, key: ConfigRecordKey) {
  return isRecord(config[key]) ? (config[key] as Record<string, unknown>) : {}
}

function parseObject(value: string) {
  const parsed = JSON.parse(value) as unknown
  if (!isRecord(parsed)) throw new Error("Expected a JSON object")
  return parsed
}

function parsePluginSpec(value: string) {
  const trimmed = value.trim()
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{") && !trimmed.startsWith('"')) return trimmed
  const parsed = JSON.parse(value) as unknown
  if (typeof parsed === "string") return parsed
  if (Array.isArray(parsed) && typeof parsed[0] === "string" && isRecord(parsed[1])) return parsed
  throw new Error("Expected a plugin string or [specifier, options] tuple")
}

function agentConfigFromRuntime(agent: Agent) {
  return {
    ...(agent.description ? { description: agent.description } : {}),
    mode: agent.mode,
    ...(agent.prompt ? { prompt: agent.prompt } : {}),
    ...(agent.variant ? { variant: agent.variant } : {}),
    ...(typeof agent.temperature === "number" && Number.isFinite(agent.temperature)
      ? { temperature: agent.temperature }
      : {}),
    ...(typeof agent.topP === "number" && Number.isFinite(agent.topP) ? { top_p: agent.topP } : {}),
    ...(agent.color ? { color: agent.color } : {}),
    ...(agent.hidden !== undefined ? { hidden: agent.hidden } : {}),
    ...(agent.steps !== undefined ? { steps: agent.steps } : {}),
    options: agent.options ?? {},
  }
}

function stringField(value: Record<string, unknown>, key: string) {
  return typeof value[key] === "string" ? value[key] : ""
}

function ruleTrigger(value: Record<string, unknown>) {
  const trigger = stringField(value, "trigger")
  if (trigger === "mention" || trigger === "auto") return trigger
  return "always"
}

function sessionAnswerText(messages: Array<{ info: { role: string }; parts: Part[] }>) {
  return messages
    .filter((message) => message.info.role === "assistant")
    .flatMap((message) => message.parts)
    .filter(
      (part): part is Extract<Part, { type: "text" }> =>
        part.type === "text" && !part.synthetic && !part.ignored && !!part.text.trim(),
    )
    .map((part) => part.text)
    .join("\n\n")
    .trim()
}

function humanValue(value: unknown): string {
  if (value === undefined || value === null) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (Array.isArray(value)) return value.map(humanValue).filter(Boolean).join(" ")
  if (!isRecord(value)) return String(value)
  return Object.entries(value)
    .map(([key, item]) => `${key}: ${humanValue(item)}`)
    .join("\n")
}

function humanSummary(value: unknown) {
  const text = humanValue(value).trim()
  if (!text) return ""
  return text.replace(/\s+/g, " ")
}

function categoryTag(value: unknown) {
  return typeof value === "string" && value ? value : undefined
}

function agentCategory(agent: Agent) {
  const options = isRecord(agent.options) ? agent.options : {}
  const agencyCategory = categoryTag(options.agencyCategory)
  const category = categoryTag(options.category)
  if (agencyCategory) {
    return {
      value: agencyCategory,
      label: category ?? agencyCategory,
    }
  }
  if (category) {
    return {
      value: category,
      label: category,
    }
  }
  return {
    value: "built-in",
    label: "内置",
  }
}

function matchesAgentCategory(agent: Agent, category: string) {
  if (category === allCategoryFilter) return true
  return agentCategory(agent).value === category
}

function matchesSourceFilter(filter: SourceFilter, builtIn: boolean) {
  if (filter === "all") return true
  return filter === "built-in" ? builtIn : !builtIn
}

function matchesModeFilter(agent: Agent, mode: ModeFilter) {
  if (mode === "all") return true
  return agent.mode === mode
}

function skillData(skill: { data?: Record<string, unknown> | null }): Record<string, unknown> {
  return isRecord(skill.data) ? skill.data : {}
}

function skillDescription(skill: { data?: Record<string, unknown> | null }) {
  const value = skillData(skill).description
  return typeof value === "string" ? value : ""
}

function skillModeSearchText(skill: SettingsSkillListResponse[number]) {
  return [skill.name, skillData(skill), skill.content]
}

function agentMode(value: unknown): Agent["mode"] {
  if (value === "primary" || value === "all") return value
  return "subagent"
}

function agentFromFile(file: SettingsAgentListResponse[number]): Agent {
  return {
    name: file.name,
    description: typeof file.data.description === "string" ? file.data.description : undefined,
    mode: agentMode(file.data.mode),
    native: !file.editable,
    permission: [],
    prompt: file.content,
    options: { ...file.data },
  }
}

function agentEditableData(value: Record<string, unknown>, input: { description: string; mode: string }) {
  return {
    ...value,
    description: input.description.trim() || undefined,
    mode: input.mode.trim() || undefined,
  }
}

function nextName(existing: Record<string, unknown>, base: string) {
  if (!existing[base]) return base
  for (let i = 2; i < 1000; i++) {
    const name = `${base}-${i}`
    if (!existing[name]) return name
  }
  return `${base}-${Date.now()}`
}

const SettingsPage: Component<{ title: string; description: string; children: JSX.Element }> = (props) => (
  <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
    <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
      <div class="flex flex-col gap-1 pt-6 pb-8 w-full">
        <h2 class="text-16-medium text-text-strong">{props.title}</h2>
        <p class="text-13-regular text-text-weak">{props.description}</p>
      </div>
    </div>
    <div class="flex flex-col gap-8 w-full">{props.children}</div>
  </div>
)

const SectionTitle: Component<{ title: string; description?: string }> = (props) => (
  <div class="flex flex-col gap-1 pb-2">
    <h3 class="text-14-medium text-text-strong">{props.title}</h3>
    <Show when={props.description}>
      <p class="text-12-regular text-text-weak">{props.description}</p>
    </Show>
  </div>
)

const EmptyState: Component<{ message: string }> = (props) => (
  <div class="py-4 text-14-regular text-text-weak">{props.message}</div>
)

const LoadingState: Component = () => (
  <div class="flex items-center gap-2 py-4 text-14-regular text-text-weak">
    <span class="size-4 rounded-full border border-border-strong-base border-t-transparent animate-spin" />
    <span>加载中...</span>
  </div>
)

const Toolbar: Component<{ children: JSX.Element }> = (props) => (
  <div class="flex flex-wrap items-center gap-2 pb-3">{props.children}</div>
)

const PageTabs: Component<{
  value: string
  onChange: (value: string) => void
  items: Array<{ value: string; label: string; count: number }>
  class?: string
}> = (props) => (
  <div class={`flex flex-wrap gap-1 ${props.class ?? "pb-3"}`}>
    <For each={safeArray(props.items)}>
      {(item) => (
        <button
          type="button"
          class="h-8 px-3 rounded-md text-13-medium border transition-colors"
          classList={{
            "bg-surface-base-active text-text-strong border-border-weak-base": props.value === item.value,
            "bg-transparent text-text-weak border-transparent hover:bg-surface-base-hover hover:text-text-strong":
              props.value !== item.value,
          }}
          onClick={() => props.onChange(item.value)}
        >
          {item.label} {item.count}
        </button>
      )}
    </For>
  </div>
)

const JsonEntryDialog: Component<{
  title: string
  nameLabel: string
  valueLabel: string
  initialName: string
  initialValue: unknown
  lockName?: boolean
  onSave: (name: string, value: Record<string, unknown>) => Promise<void>
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const [name, setName] = createSignal(props.initialName)
  const [value, setValue] = createSignal(pretty(props.initialValue))
  const [error, setError] = createSignal("")

  const save = useMutation(() => ({
    mutationFn: async () => {
      const nextName = name().trim()
      if (!nextName) throw new Error("Name is required")
      await props.onSave(nextName, parseObject(value()) as Record<string, unknown>)
    },
    onSuccess: () => {
      dialog.close()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.management.toast.saved.title"),
        description: language.t("settings.management.toast.saved.description"),
      })
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
    },
  }))

  return (
    <Dialog
      title={props.title}
      transition
      class="w-[min(calc(100vw-40px),800px)] max-h-[calc(100vh-80px)] overflow-hidden"
    >
      <form
        class="flex flex-col gap-4 px-2.5 pb-3 max-h-[calc(100vh-160px)] overflow-y-auto no-scrollbar"
        onSubmit={(e) => {
          e.preventDefault()
          if (!save.isPending) save.mutate()
        }}
      >
        <TextField
          label={props.nameLabel}
          value={name()}
          onChange={setName}
          disabled={props.lockName}
          spellcheck={false}
          autocorrect="off"
          autocomplete="off"
          autocapitalize="off"
        />
        <TextField
          label={props.valueLabel}
          multiline
          value={value()}
          onChange={setValue}
          class="font-mono min-h-56 max-h-[min(50vh,28rem)] overflow-y-auto"
          spellcheck={false}
          autocorrect="off"
          autocomplete="off"
          autocapitalize="off"
          error={error()}
        />
        <div class="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button type="submit" disabled={save.isPending} icon="check">
            {language.t("settings.management.action.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

const SkillSelectDialog: Component<{
  title: string
  skills: SkillAsset[]
  onSelect: (names: string[]) => Promise<void>
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const [error, setError] = createSignal("")
  const [selected, setSelected] = createSignal<string[]>([])
  const select = useMutation(() => ({
    mutationFn: props.onSelect,
    onSuccess: () => {
      dialog.close()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.management.toast.saved.title"),
        description: language.t("settings.management.toast.saved.description"),
      })
    },
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  }))
  const selectedSet = createMemo(() => new Set(selected()))
  const toggle = (name: string) =>
    setSelected((current) => (current.includes(name) ? current.filter((item) => item !== name) : [...current, name]))

  return (
    <Dialog
      title={props.title}
      transition
      class="w-[min(calc(100vw-40px),640px)] max-h-[calc(100vh-80px)] overflow-hidden"
    >
      <div class="flex flex-col gap-3 px-2.5 pb-3 max-h-[calc(100vh-160px)] overflow-y-auto no-scrollbar">
        <Show when={error()}>
          <div class="text-12-regular text-danger-base">{error()}</div>
        </Show>
        <SettingsList>
          <Show
            when={safeArray(props.skills).length > 0}
            fallback={<EmptyState message={language.t("settings.agents.skills.emptyAssignable")} />}
          >
            <For each={safeArray(props.skills)}>
              {(skill) => {
                const active = () => selectedSet().has(skill.name)
                const data = skillData(skill)
                return (
                  <button
                    type="button"
                    class="w-full text-left rounded-lg transition-colors"
                    classList={{ "bg-surface-base-active": active() }}
                    disabled={select.isPending}
                    onClick={() => toggle(skill.name)}
                  >
                    <RuntimeRow
                      icon="checklist"
                      title={skillDisplayName(skill.name, data)}
                      description={typeof data.description === "string" ? data.description : ""}
                      tags={[language.t("settings.management.tag.custom")]}
                      actions={
                        <span
                          class="flex size-6 items-center justify-center rounded-md border text-13-medium"
                          classList={{
                            "border-border-strong-base bg-surface-base text-text-weak": !active(),
                            "border-border-active bg-surface-base-active text-text-strong": active(),
                          }}
                        >
                          {active() ? "✓" : "+"}
                        </span>
                      }
                    />
                  </button>
                )
              }}
            </For>
          </Show>
        </SettingsList>
        <div class="flex items-center justify-between gap-3 pt-1">
          <span class="text-12-regular text-text-weak">已选择 {selected().length} 个技能</span>
          <div class="flex items-center gap-2">
            <Button type="button" variant="secondary" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button
              type="button"
              icon="check"
              disabled={select.isPending || selected().length === 0}
              onClick={() => select.mutate(selected())}
            >
              {language.t("settings.agents.skills.action.addSelected")}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  )
}

const PluginEntryDialog: Component<{
  title: string
  initialValue: unknown
  onSave: (value: unknown) => Promise<void>
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const [value, setValue] = createSignal(
    typeof props.initialValue === "string" ? props.initialValue : pretty(props.initialValue),
  )
  const [error, setError] = createSignal("")

  const save = useMutation(() => ({
    mutationFn: async () => props.onSave(parsePluginSpec(value())),
    onSuccess: () => {
      dialog.close()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.management.toast.saved.title"),
        description: language.t("settings.management.toast.saved.description"),
      })
    },
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  }))

  return (
    <Dialog
      title={props.title}
      transition
      class="w-[min(calc(100vw-40px),800px)] max-h-[calc(100vh-80px)] overflow-hidden"
    >
      <form
        class="flex flex-col gap-4 px-2.5 pb-3 max-h-[calc(100vh-160px)] overflow-y-auto no-scrollbar"
        onSubmit={(e) => {
          e.preventDefault()
          if (!save.isPending) save.mutate()
        }}
      >
        <TextField
          label={language.t("settings.plugins.field.spec")}
          multiline
          value={value()}
          onChange={setValue}
          class="font-mono min-h-32 max-h-[min(50vh,28rem)] overflow-y-auto"
          spellcheck={false}
          autocorrect="off"
          autocomplete="off"
          autocapitalize="off"
          error={error()}
        />
        <div class="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button type="submit" disabled={save.isPending} icon="check">
            {language.t("settings.management.action.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

const SourceImportDialog: Component<{
  title: string
  placeholder: string
  extensions?: string[]
  onImport: (input: { source: string; overwrite: boolean }) => Promise<{ imported?: number; skipped?: number }>
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const platform = usePlatform()
  const server = useServer()
  const [source, setSource] = createSignal("")
  const [overwrite, setOverwrite] = createSignal(false)
  const [error, setError] = createSignal("")
  const [success, setSuccess] = createSignal("")

  const applyPickerResult = (result: string | string[] | null) => {
    const value = Array.isArray(result) ? result[0] : result
    if (!value) return
    setSource(value)
    setError("")
    setSuccess("")
  }

  const chooseDirectory = async () => {
    if (save.isPending || success()) return
    if (platform.openDirectoryPickerDialog && server.isLocal()) {
      applyPickerResult(
        await platform.openDirectoryPickerDialog({
          title: props.title,
          multiple: false,
        }),
      )
      return
    }

    const x = await import("@/components/dialog-select-directory")
    dialog.show(() => <x.DialogSelectDirectory title={props.title} onSelect={applyPickerResult} />)
  }

  const chooseFile = async () => {
    if (save.isPending || success()) return
    if (!platform.openFilePickerDialog) {
      setError("当前环境不支持直接选择文件，请手动输入文件路径，或使用选择文件夹。")
      return
    }

    applyPickerResult(
      await platform.openFilePickerDialog({
        title: props.title,
        multiple: false,
        extensions: props.extensions,
      }),
    )
  }

  const save = useMutation(() => ({
    mutationFn: async () => {
      setSuccess("")
      const next = source().trim()
      if (!next) throw new Error("Source is required")
      return props.onImport({ source: next, overwrite: overwrite() })
    },
    onSuccess: (result) => {
      const message = language.t("settings.management.toast.imported.description", {
        imported: String(result.imported ?? 0),
        skipped: String(result.skipped ?? 0),
      })
      setSuccess(message)
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.management.toast.imported.title"),
        description: message,
        duration: 6000,
      })
      setTimeout(() => dialog.close(), 1200)
    },
    onError: (err) => {
      setSuccess("")
      setError(err instanceof Error ? err.message : String(err))
    },
  }))

  return (
    <Dialog
      title={props.title}
      transition
      class="w-[min(calc(100vw-40px),720px)] max-h-[calc(100vh-80px)] overflow-hidden"
    >
      <form
        class="flex flex-col gap-4 px-2.5 pb-3 max-h-[calc(100vh-160px)] overflow-y-auto no-scrollbar"
        onSubmit={(e) => {
          e.preventDefault()
          if (!save.isPending) save.mutate()
        }}
      >
        <TextField
          label={language.t("settings.management.field.importSource")}
          value={source()}
          onChange={setSource}
          placeholder={props.placeholder}
          spellcheck={false}
          autocorrect="off"
          autocomplete="off"
          autocapitalize="off"
          error={error()}
          disabled={save.isPending || !!success()}
        />
        <Show when={success()}>
          <div class="rounded-md border border-success-base/30 bg-success-base/10 px-3 py-2 text-13-regular text-success-base">
            {success()}
          </div>
        </Show>
        <div class="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            icon="open-file"
            disabled={save.isPending || !!success()}
            onClick={() => void chooseFile()}
          >
            {language.t("settings.management.action.chooseFile")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            icon="folder"
            disabled={save.isPending || !!success()}
            onClick={() => void chooseDirectory()}
          >
            {language.t("settings.management.action.chooseDirectory")}
          </Button>
        </div>
        <Switch checked={overwrite()} disabled={save.isPending || !!success()} onChange={setOverwrite}>
          {language.t("settings.management.field.overwriteExisting")}
        </Switch>
        <div class="flex justify-end gap-2">
          <Button type="button" variant="secondary" disabled={save.isPending} onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button type="submit" disabled={save.isPending || !!success()} icon={save.isPending ? undefined : "check"}>
            <Show when={save.isPending} fallback={language.t("settings.management.action.import")}>
              <span class="size-3.5 rounded-full border border-current border-t-transparent animate-spin" />
              {language.t("settings.management.action.import")}...
            </Show>
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

const ConfirmActionDialog: Component<{
  title: string
  description: string
  confirmLabel: string
  onConfirm: () => Promise<void>
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const [error, setError] = createSignal("")
  const confirm = useMutation(() => ({
    mutationFn: props.onConfirm,
    onSuccess: () => {
      dialog.close()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.management.toast.saved.title"),
        description: language.t("settings.management.toast.saved.description"),
      })
    },
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  }))

  return (
    <Dialog title={props.title} fit>
      <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
        <div class="flex flex-col gap-1">
          <span class="text-14-regular text-text-strong">{props.description}</span>
          <Show when={error()}>
            <span class="text-12-regular text-danger-base">{error()}</span>
          </Show>
        </div>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="large" disabled={confirm.isPending} onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button variant="primary" size="large" disabled={confirm.isPending} onClick={() => confirm.mutate()}>
            {props.confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

const SkillDetailDialog: Component<{
  title: string
  name: string
  description: string
  content: string
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  return (
    <Dialog
      title={props.title}
      transition
      class="w-[min(calc(100vw-40px),800px)] max-h-[calc(100vh-80px)] overflow-hidden"
    >
      <div class="flex flex-col gap-4 px-2.5 pb-3 max-h-[calc(100vh-160px)] overflow-y-auto no-scrollbar">
        <TextField
          label={language.t("settings.management.field.name")}
          value={props.name}
          onChange={() => {}}
          readOnly
        />
        <TextField
          label={language.t("settings.skills.field.description")}
          value={props.description}
          onChange={() => {}}
          readOnly
        />
        <TextField
          label={language.t("settings.skills.field.content")}
          multiline
          value={props.content}
          onChange={() => {}}
          readOnly
          class="min-h-64 max-h-[min(50vh,28rem)] overflow-y-auto"
        />
        <div class="flex justify-end gap-2">
          <Button onClick={() => dialog.close()}>{language.t("common.close")}</Button>
        </div>
      </div>
    </Dialog>
  )
}

const RuleDetailDialog: Component<{
  title: string
  name: string
  description: string
  trigger: RuleTrigger
  content: string
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const triggerLabel = () =>
    language.t(
      ruleTriggerOptions.find((option) => option.value === props.trigger)?.label ?? "settings.rules.trigger.always",
    )
  return (
    <Dialog
      title={props.title}
      transition
      class="w-[min(calc(100vw-40px),800px)] max-h-[calc(100vh-80px)] overflow-hidden"
    >
      <div class="flex flex-col gap-4 px-2.5 pb-3 max-h-[calc(100vh-160px)] overflow-y-auto no-scrollbar">
        <TextField
          label={language.t("settings.management.field.name")}
          value={props.name}
          onChange={() => {}}
          readOnly
        />
        <TextField
          label={language.t("settings.rules.field.description")}
          value={props.description}
          onChange={() => {}}
          readOnly
        />
        <TextField
          label={language.t("settings.rules.field.trigger")}
          value={triggerLabel()}
          onChange={() => {}}
          readOnly
        />
        <TextField
          label={language.t("settings.rules.field.content")}
          multiline
          value={props.content}
          onChange={() => {}}
          readOnly
          class="min-h-64 max-h-[min(50vh,28rem)] overflow-y-auto"
        />
        <div class="flex justify-end gap-2">
          <Button onClick={() => dialog.close()}>{language.t("common.close")}</Button>
        </div>
      </div>
    </Dialog>
  )
}

const AgentDetailDialog: Component<{
  title: string
  agent: Agent
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const prompt = () => props.agent.prompt || language.t("settings.agents.detail.prompt.inherited")

  return (
    <Dialog
      title={props.title}
      transition
      class="w-[min(calc(100vw-40px),800px)] max-h-[calc(100vh-80px)] overflow-hidden"
    >
      <div class="flex flex-col gap-4 px-2.5 pb-3 max-h-[calc(100vh-160px)] overflow-y-auto no-scrollbar">
        <TextField
          label={language.t("settings.management.field.name")}
          value={props.agent.name}
          onChange={() => {}}
          readOnly
        />
        <TextField
          label={language.t("settings.skills.field.description")}
          value={props.agent.description ?? ""}
          onChange={() => {}}
          readOnly
        />
        <TextField
          label={language.t("settings.agents.field.mode")}
          value={props.agent.mode}
          onChange={() => {}}
          readOnly
        />
        <TextField
          label={language.t("settings.agents.field.prompt")}
          multiline
          value={prompt()}
          onChange={() => {}}
          readOnly
          class="min-h-56 max-h-[min(50vh,28rem)] overflow-y-auto"
        />
        <Show when={!props.agent.prompt}>
          <TextField
            label={language.t("settings.agents.field.promptSource")}
            multiline
            value={language.t("settings.agents.detail.prompt.source")}
            onChange={() => {}}
            readOnly
            class="min-h-24 max-h-[min(32vh,16rem)] overflow-y-auto"
          />
        </Show>
        <div class="flex justify-end gap-2">
          <Button onClick={() => dialog.close()}>{language.t("common.close")}</Button>
        </div>
      </div>
    </Dialog>
  )
}

const AgentConfigDialog: Component<{
  title: string
  initialName: string
  initialData: Record<string, unknown>
  lockName?: boolean
  onSave: (name: string, value: Record<string, unknown>) => Promise<void>
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const [name, setName] = createSignal(props.initialName)
  const [description, setDescription] = createSignal(stringField(props.initialData, "description"))
  const [mode, setMode] = createSignal(stringField(props.initialData, "mode") || "primary")
  const [prompt, setPrompt] = createSignal(stringField(props.initialData, "prompt"))

  const save = useMutation(() => ({
    mutationFn: async () => {
      const nextName = name().trim()
      if (!nextName) throw new Error("Name is required")
      await props.onSave(nextName, {
        ...agentEditableData(props.initialData, {
          description: description(),
          mode: mode(),
        }),
        prompt: prompt().trim() || undefined,
      })
    },
    onSuccess: () => {
      dialog.close()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.management.toast.saved.title"),
        description: language.t("settings.management.toast.saved.description"),
      })
    },
    onError: (err) =>
      showToast({
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      }),
  }))

  return (
    <Dialog
      title={props.title}
      transition
      class="w-[min(calc(100vw-40px),800px)] max-h-[calc(100vh-80px)] overflow-hidden"
    >
      <form
        class="flex flex-col gap-4 px-2.5 pb-3 max-h-[calc(100vh-160px)] overflow-y-auto no-scrollbar"
        onSubmit={(e) => {
          e.preventDefault()
          if (!save.isPending) save.mutate()
        }}
      >
        <TextField
          label={language.t("settings.management.field.name")}
          value={name()}
          onChange={setName}
          disabled={props.lockName}
          spellcheck={false}
          autocorrect="off"
          autocomplete="off"
          autocapitalize="off"
        />
        <TextField
          label={language.t("settings.skills.field.description")}
          value={description()}
          onChange={setDescription}
          spellcheck={false}
          autocorrect="off"
          autocomplete="off"
          autocapitalize="off"
        />
        <TextField
          label={language.t("settings.agents.field.mode")}
          value={mode()}
          onChange={setMode}
          spellcheck={false}
          autocorrect="off"
          autocomplete="off"
          autocapitalize="off"
        />
        <TextField
          label={language.t("settings.agents.field.prompt")}
          multiline
          value={prompt()}
          onChange={setPrompt}
          class="min-h-56 max-h-[min(50vh,28rem)] overflow-y-auto"
          spellcheck={false}
          autocorrect="off"
          autocomplete="off"
          autocapitalize="off"
        />
        <div class="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button type="submit" disabled={save.isPending} icon="check">
            {language.t("settings.management.action.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

const AgentFileDialog: Component<{
  title: string
  initialName: string
  initialData: Record<string, unknown>
  initialContent: string
  lockName?: boolean
  onSave: (name: string, data: Record<string, unknown>, content: string) => Promise<void>
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const [name, setName] = createSignal(props.initialName)
  const [description, setDescription] = createSignal(stringField(props.initialData, "description"))
  const [mode, setMode] = createSignal(stringField(props.initialData, "mode") || "subagent")
  const [content, setContent] = createSignal(props.initialContent)
  const [error, setError] = createSignal("")

  const save = useMutation(() => ({
    mutationFn: async () => {
      const nextName = name().trim()
      if (!nextName) throw new Error("Name is required")
      if (!content().trim()) throw new Error("Prompt is required")
      await props.onSave(
        nextName,
        agentEditableData(props.initialData, {
          description: description(),
          mode: mode(),
        }),
        content(),
      )
    },
    onSuccess: () => {
      dialog.close()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.management.toast.saved.title"),
        description: language.t("settings.management.toast.saved.description"),
      })
    },
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  }))

  return (
    <Dialog
      title={props.title}
      transition
      class="w-[min(calc(100vw-40px),800px)] max-h-[calc(100vh-80px)] overflow-hidden"
    >
      <form
        class="flex flex-col gap-4 px-2.5 pb-3 max-h-[calc(100vh-160px)] overflow-y-auto no-scrollbar"
        onSubmit={(e) => {
          e.preventDefault()
          if (!save.isPending) save.mutate()
        }}
      >
        <TextField
          label={language.t("settings.management.field.name")}
          value={name()}
          onChange={setName}
          disabled={props.lockName}
          spellcheck={false}
          autocorrect="off"
          autocomplete="off"
          autocapitalize="off"
        />
        <TextField
          label={language.t("settings.skills.field.description")}
          value={description()}
          onChange={setDescription}
          spellcheck={false}
          autocorrect="off"
          autocomplete="off"
          autocapitalize="off"
          error={error()}
        />
        <TextField
          label={language.t("settings.agents.field.mode")}
          value={mode()}
          onChange={setMode}
          spellcheck={false}
          autocorrect="off"
          autocomplete="off"
          autocapitalize="off"
        />
        <TextField
          label={language.t("settings.agents.field.prompt")}
          multiline
          value={content()}
          onChange={setContent}
          class="min-h-48 max-h-[min(50vh,28rem)] overflow-y-auto"
          spellcheck={false}
          autocorrect="off"
          autocomplete="off"
          autocapitalize="off"
        />
        <div class="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button type="submit" disabled={save.isPending} icon="check">
            {language.t("settings.management.action.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

const SkillFileDialog: Component<{
  title: string
  initialName: string
  initialDescription: string
  initialContent: string
  lockName?: boolean
  onSave: (name: string, description: string, content: string) => Promise<void>
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const [name, setName] = createSignal(props.initialName)
  const [description, setDescription] = createSignal(props.initialDescription)
  const [content, setContent] = createSignal(props.initialContent)
  const [error, setError] = createSignal("")

  const save = useMutation(() => ({
    mutationFn: async () => {
      const nextName = name().trim()
      if (!nextName) throw new Error("Name is required")
      if (!content().trim()) throw new Error("Content is required")
      await props.onSave(nextName, description().trim(), content())
    },
    onSuccess: () => {
      dialog.close()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.management.toast.saved.title"),
        description: language.t("settings.management.toast.saved.description"),
      })
    },
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  }))

  return (
    <Dialog
      title={props.title}
      transition
      class="w-[min(calc(100vw-40px),800px)] max-h-[calc(100vh-80px)] overflow-hidden"
    >
      <form
        class="flex flex-col gap-4 px-2.5 pb-3 max-h-[calc(100vh-160px)] overflow-y-auto no-scrollbar"
        onSubmit={(e) => {
          e.preventDefault()
          if (!save.isPending) save.mutate()
        }}
      >
        <TextField
          label={language.t("settings.management.field.name")}
          value={name()}
          onChange={setName}
          disabled={props.lockName}
          spellcheck={false}
          autocorrect="off"
          autocomplete="off"
          autocapitalize="off"
          error={error()}
        />
        <TextField
          label={language.t("settings.skills.field.description")}
          value={description()}
          onChange={setDescription}
          spellcheck={false}
          autocorrect="off"
          autocomplete="off"
          autocapitalize="off"
        />
        <TextField
          label={language.t("settings.skills.field.content")}
          multiline
          value={content()}
          onChange={setContent}
          class="min-h-56 max-h-[min(50vh,28rem)] overflow-y-auto"
          spellcheck={false}
          autocorrect="off"
          autocomplete="off"
          autocapitalize="off"
        />
        <div class="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button type="submit" disabled={save.isPending} icon="check">
            {language.t("settings.management.action.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

const RuleFileDialog: Component<{
  title: string
  initialName: string
  initialDescription: string
  initialTrigger: RuleTrigger
  initialContent: string
  lockName?: boolean
  onSave: (name: string, description: string, trigger: RuleTrigger, content: string) => Promise<void>
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const [name, setName] = createSignal(props.initialName)
  const [description, setDescription] = createSignal(props.initialDescription)
  const [trigger, setTrigger] = createSignal<RuleTrigger>(props.initialTrigger)
  const [content, setContent] = createSignal(props.initialContent)
  const [error, setError] = createSignal("")
  const options = () =>
    ruleTriggerOptions.map((option) => ({
      ...option,
      labelText: language.t(option.label),
      descriptionText: language.t(option.description),
    }))

  const save = useMutation(() => ({
    mutationFn: async () => {
      const nextName = name().trim()
      if (!nextName) throw new Error("Name is required")
      if (!content().trim()) throw new Error("Content is required")
      await props.onSave(nextName, description().trim(), trigger(), content())
    },
    onSuccess: () => {
      dialog.close()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.management.toast.saved.title"),
        description: language.t("settings.management.toast.saved.description"),
      })
    },
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  }))

  return (
    <Dialog
      title={props.title}
      transition
      class="w-[min(calc(100vw-40px),800px)] max-h-[calc(100vh-80px)] overflow-hidden"
    >
      <form
        class="flex flex-col gap-4 px-2.5 pb-3 max-h-[calc(100vh-160px)] overflow-y-auto no-scrollbar"
        onSubmit={(e) => {
          e.preventDefault()
          if (!save.isPending) save.mutate()
        }}
      >
        <TextField
          label={language.t("settings.management.field.name")}
          value={name()}
          onChange={setName}
          disabled={props.lockName}
          spellcheck={false}
          autocorrect="off"
          autocomplete="off"
          autocapitalize="off"
          error={error()}
        />
        <TextField
          label={language.t("settings.rules.field.description")}
          value={description()}
          onChange={setDescription}
          spellcheck={false}
          autocorrect="off"
          autocomplete="off"
          autocapitalize="off"
        />
        <div class="flex flex-col gap-1.5">
          <label class="text-sm font-medium text-text">{language.t("settings.rules.field.trigger")}</label>
          <Select
            options={options()}
            current={options().find((option) => option.value === trigger())}
            value={(option) => option.value}
            label={(option) => option.labelText}
            onSelect={(option) => option && setTrigger(option.value)}
            variant="secondary"
            triggerVariant="settings"
          />
          <p class="text-xs text-text-muted">
            {options().find((option) => option.value === trigger())?.descriptionText}
          </p>
        </div>
        <TextField
          label={language.t("settings.rules.field.content")}
          multiline
          value={content()}
          onChange={setContent}
          class="min-h-56 max-h-[min(50vh,28rem)] overflow-y-auto"
          spellcheck={false}
          autocorrect="off"
          autocomplete="off"
          autocapitalize="off"
        />
        <div class="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button type="submit" disabled={save.isPending} icon="check">
            {language.t("settings.management.action.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

const ProjectInstructionDetailDialog: Component<{
  title: string
  file: ProjectInstructionFile
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  return (
    <Dialog
      title={props.title}
      transition
      class="w-[min(calc(100vw-40px),800px)] max-h-[calc(100vh-80px)] overflow-hidden"
    >
      <div class="flex flex-col gap-4 px-2.5 pb-3 max-h-[calc(100vh-160px)] overflow-y-auto no-scrollbar">
        <TextField
          label={language.t("settings.projectInstruction.field.path")}
          value={props.file.location}
          onChange={() => {}}
          readOnly
        />
        <TextField
          label={language.t("settings.projectInstruction.field.content")}
          multiline
          value={props.file.content}
          onChange={() => {}}
          readOnly
          class="min-h-64 max-h-[min(50vh,28rem)] overflow-y-auto"
        />
        <div class="flex justify-end gap-2">
          <Button onClick={() => dialog.close()}>{language.t("common.close")}</Button>
        </div>
      </div>
    </Dialog>
  )
}

const ProjectInstructionDialog: Component<{
  title: string
  initialContent: string
  onSave: (content: string) => Promise<void>
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const [content, setContent] = createSignal(props.initialContent)
  const [error, setError] = createSignal("")

  const save = useMutation(() => ({
    mutationFn: async () => {
      if (!content().trim()) throw new Error(language.t("settings.projectInstruction.error.contentRequired"))
      await props.onSave(content())
    },
    onSuccess: () => {
      dialog.close()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.management.toast.saved.title"),
        description: language.t("settings.management.toast.saved.description"),
      })
    },
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  }))

  return (
    <Dialog
      title={props.title}
      transition
      class="w-[min(calc(100vw-40px),800px)] max-h-[calc(100vh-80px)] overflow-hidden"
    >
      <form
        class="flex flex-col gap-4 px-2.5 pb-3 max-h-[calc(100vh-160px)] overflow-y-auto no-scrollbar"
        onSubmit={(e) => {
          e.preventDefault()
          if (!save.isPending) save.mutate()
        }}
      >
        <TextField
          label={language.t("settings.projectInstruction.field.content")}
          multiline
          value={content()}
          onChange={setContent}
          class="min-h-72 max-h-[min(58vh,34rem)] overflow-y-auto"
          spellcheck={false}
          autocorrect="off"
          autocomplete="off"
          autocapitalize="off"
          error={error()}
        />
        <div class="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button type="submit" disabled={save.isPending} icon="check">
            {language.t("settings.management.action.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

const ProjectInstructionGenerateDialog: Component<{
  title: string
  models: Array<{ providerID: string; modelID: string; label: string }>
  initialModel?: { providerID: string; modelID: string }
  onGenerate: (
    comment: string,
    model: { providerID: string; modelID: string },
    onProgress: (item: ProjectInstructionGenerateProgress) => void,
  ) => Promise<void>
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const [comment, setComment] = createSignal("")
  const [model, setModel] = createSignal(props.initialModel)
  const [error, setError] = createSignal("")
  const [elapsed, setElapsed] = createSignal(0)
  const [progress, setProgress] = createSignal<ProjectInstructionGenerateProgress[]>([])
  const options = () => props.models
  const current = () =>
    options().find((item) => item.providerID === model()?.providerID && item.modelID === model()?.modelID)
  const answer = () =>
    progress()
      .slice()
      .reverse()
      .find((item) => item.answer)?.answer ?? ""
  const written = () =>
    progress()
      .slice()
      .reverse()
      .find((item) => item.content)?.content ?? ""
  const preview = () => answer() || written() || language.t("settings.projectInstruction.generating.preview.empty")
  const pushProgress = (item: ProjectInstructionGenerateProgress) => setProgress((items) => [...items, item])

  const generate = useMutation(() => ({
    mutationFn: async () => {
      const selected = model()
      if (!selected) throw new Error(language.t("settings.projectInstruction.error.modelRequired"))
      setProgress([])
      await props.onGenerate(comment().trim(), selected, pushProgress)
    },
    onSuccess: () => {
      dialog.close()
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      showToast({ title: language.t("common.requestFailed"), description: message })
    },
  }))

  createEffect(() => {
    if (!generate.isPending) {
      setElapsed(0)
      return
    }
    const startedAt = Date.now()
    const interval = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    onCleanup(() => window.clearInterval(interval))
  })

  return (
    <Dialog title={props.title} transition class="w-[min(calc(100vw-40px),980px)]">
      <form
        class="grid gap-4 px-2.5 pb-3 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.9fr)]"
        onSubmit={(e) => {
          e.preventDefault()
          if (!generate.isPending) generate.mutate()
        }}
      >
        <div class="flex min-w-0 flex-col gap-4">
          <TextField
            label={language.t("settings.projectInstruction.field.comment")}
            placeholder={language.t("settings.projectInstruction.field.comment.placeholder")}
            multiline
            value={comment()}
            onChange={setComment}
            class="min-h-32 max-h-[min(40vh,18rem)] overflow-y-auto"
            error={error()}
          />
          <div class="flex flex-col gap-1.5">
            <label class="text-sm font-medium text-text">{language.t("settings.projectInstruction.field.model")}</label>
            <Select
              options={options()}
              current={current()}
              value={(option) => `${option.providerID}/${option.modelID}`}
              label={(option) => option.label}
              onSelect={(option) => option && setModel({ providerID: option.providerID, modelID: option.modelID })}
              variant="secondary"
              triggerVariant="settings"
            />
          </div>
          <Show when={generate.isPending}>
            <div class="flex items-start gap-3 rounded-md border border-border-base bg-surface-base px-3 py-3">
              <span class="mt-0.5 size-5 shrink-0 rounded-full border-2 border-border-strong-base border-t-transparent animate-spin" />
              <div class="min-w-0 flex-1 space-y-1">
                <div class="text-13-medium text-text">{language.t("settings.projectInstruction.generating.title")}</div>
                <div class="text-12-regular text-text-weak">
                  {language.t("settings.projectInstruction.generating.description")}
                </div>
                <div class="text-12-regular text-text-muted" aria-live="polite">
                  {language.t("settings.projectInstruction.generating.elapsed", { seconds: elapsed() })}
                </div>
              </div>
            </div>
          </Show>
          <div class="flex justify-end gap-2">
            <Button type="button" variant="secondary" disabled={generate.isPending} onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button type="submit" disabled={generate.isPending} icon={generate.isPending ? undefined : "checklist"}>
              <Show when={generate.isPending} fallback={language.t("settings.projectInstruction.action.generate")}>
                <span class="size-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
                {language.t("settings.projectInstruction.action.generating")}
              </Show>
            </Button>
          </div>
        </div>
        <div class="min-w-0 rounded-md border border-border-base bg-surface-base/70 p-3">
          <div class="mb-3 flex items-center justify-between gap-2">
            <div class="text-13-medium text-text">
              {language.t("settings.projectInstruction.generating.panel.title")}
            </div>
            <div class="text-11-regular text-text-muted">
              {language.t("settings.projectInstruction.generating.panel.status")}
            </div>
          </div>
          <div class="mb-3 flex max-h-32 flex-col gap-2 overflow-y-auto pr-1">
            <Show
              when={progress().length > 0}
              fallback={
                <div class="text-12-regular text-text-muted">
                  {language.t("settings.projectInstruction.generating.panel.idle")}
                </div>
              }
            >
              <For each={progress()}>
                {(item) => (
                  <div class="flex items-start gap-2 text-12-regular">
                    <span
                      classList={{
                        "mt-1 size-1.5 shrink-0 rounded-full": true,
                        "bg-success-base": item.step === "written",
                        "bg-icon-strong-base animate-pulse": item.step !== "written",
                      }}
                    />
                    <div class="min-w-0">
                      <div class="text-text">{item.title}</div>
                      <Show when={item.detail}>
                        <div class="truncate text-text-muted">{item.detail}</div>
                      </Show>
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </div>
          <div class="rounded-md border border-border-weak-base bg-background-base/70">
            <div class="border-b border-border-weak-base px-3 py-2 text-12-medium text-text-weak">
              {language.t("settings.projectInstruction.generating.panel.preview")}
            </div>
            <pre class="max-h-64 min-h-40 overflow-auto whitespace-pre-wrap break-words p-3 text-11-regular leading-5 text-text-muted">
              {preview()}
            </pre>
          </div>
        </div>
      </form>
    </Dialog>
  )
}

const McpEntryDialog: Component<{
  title: string
  initialName: string
  initialValue: Record<string, unknown>
  lockName?: boolean
  onSave: (name: string, value: Record<string, unknown>) => Promise<void>
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const [name, setName] = createSignal(props.initialName)
  const [value, setValue] = createSignal(pretty(props.initialValue))
  const [error, setError] = createSignal("")

  const save = useMutation(() => ({
    mutationFn: async () => {
      const nextName = name().trim()
      if (!nextName) throw new Error("Name is required")
      await props.onSave(nextName, parseMcpConfig(value()))
    },
    onSuccess: () => {
      dialog.close()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.management.toast.saved.title"),
        description: language.t("settings.management.toast.saved.description"),
      })
    },
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  }))

  return (
    <Dialog
      title={props.title}
      transition
      class="w-[min(calc(100vw-40px),800px)] max-h-[calc(100vh-80px)] overflow-hidden"
    >
      <form
        class="flex flex-col gap-4 px-2.5 pb-3 max-h-[calc(100vh-160px)] overflow-y-auto no-scrollbar"
        onSubmit={(e) => {
          e.preventDefault()
          if (!save.isPending) save.mutate()
        }}
      >
        <TextField
          label={language.t("settings.management.field.name")}
          value={name()}
          onChange={setName}
          disabled={props.lockName || save.isPending}
          spellcheck={false}
          autocorrect="off"
          autocomplete="off"
          autocapitalize="off"
        />
        <TextField
          label={language.t("settings.management.field.config")}
          multiline
          value={value()}
          onChange={setValue}
          class="font-mono min-h-64 max-h-[min(50vh,30rem)] overflow-y-auto"
          spellcheck={false}
          autocorrect="off"
          autocomplete="off"
          autocapitalize="off"
          error={error()}
          disabled={save.isPending}
        />
        <div class="flex justify-end gap-2">
          <Button type="button" variant="secondary" disabled={save.isPending} onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button type="submit" disabled={save.isPending} icon="check">
            {language.t("settings.management.action.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

function parseMcpConfig(value: string) {
  const config = parseObject(value)
  if (config.type !== "local" && config.type !== "remote") throw new Error("MCP 类型必须是 local 或 remote")
  if (config.type === "local") {
    if (
      !Array.isArray(config.command) ||
      !config.command.every((item) => typeof item === "string") ||
      config.command.length === 0
    ) {
      throw new Error("本地 MCP 配置需要 command，且必须是非空字符串数组")
    }
  }
  if (config.type === "remote" && typeof config.url !== "string") throw new Error("远程 MCP 配置需要 url")
  if (config.enabled !== undefined && typeof config.enabled !== "boolean") throw new Error("MCP enabled 必须是布尔值")
  return config
}

const McpDetailDialog: Component<{
  title: string
  name: string
  status: McpStatus
  config?: Record<string, unknown>
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const config = () => props.config ?? {}
  const command = () => humanValue(config().command)
  const url = () => stringField(config(), "url")
  const enabled = () =>
    config().enabled === undefined ? language.t("settings.management.value.none") : humanValue(config().enabled)
  const error = () =>
    props.status.status === "failed" || props.status.status === "needs_client_registration" ? props.status.error : ""

  return (
    <Dialog
      title={props.title}
      transition
      class="w-[min(calc(100vw-40px),800px)] max-h-[calc(100vh-80px)] overflow-hidden"
    >
      <div class="flex flex-col gap-4 px-2.5 pb-3 max-h-[calc(100vh-160px)] overflow-y-auto no-scrollbar">
        <TextField
          label={language.t("settings.management.field.name")}
          value={props.name}
          onChange={() => {}}
          readOnly
        />
        <TextField
          label={language.t("settings.mcp.field.status")}
          value={props.status.status}
          onChange={() => {}}
          readOnly
        />
        <TextField
          label={language.t("settings.mcp.field.type")}
          value={stringField(config(), "type")}
          onChange={() => {}}
          readOnly
        />
        <TextField label={language.t("settings.mcp.field.command")} value={command()} onChange={() => {}} readOnly />
        <TextField label={language.t("settings.mcp.field.url")} value={url()} onChange={() => {}} readOnly />
        <TextField label={language.t("settings.mcp.field.enabled")} value={enabled()} onChange={() => {}} readOnly />
        <Show when={error()}>
          {(value) => (
            <TextField
              label={language.t("settings.mcp.field.error")}
              multiline
              value={value()}
              onChange={() => {}}
              readOnly
              class="min-h-24 max-h-[min(32vh,16rem)] overflow-y-auto"
            />
          )}
        </Show>
        <div class="flex justify-end gap-2">
          <Button onClick={() => dialog.close()}>{language.t("common.close")}</Button>
        </div>
      </div>
    </Dialog>
  )
}

const ConfigEditor: Component<{
  title: string
  description: string
  configKey: ConfigKey
  parse: (value: string) => unknown
}> = (props) => {
  const language = useLanguage()
  const globalSync = useGlobalSync()
  const [draft, setDraft] = createSignal(pretty(configValue(globalSync.data.config, props.configKey)))
  const [error, setError] = createSignal("")

  createEffect(() => {
    setDraft(pretty(configValue(globalSync.data.config, props.configKey)))
    setError("")
  })

  const save = useMutation(() => ({
    mutationFn: async () => {
      const next = props.parse(draft())
      setError("")
      await globalSync.updateConfig({ [props.configKey]: next } as Config)
    },
    onSuccess: () => {
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.management.toast.saved.title"),
        description: language.t("settings.management.toast.saved.description"),
      })
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      showToast({ title: language.t("common.requestFailed"), description: message })
    },
  }))

  return (
    <div class="flex flex-col gap-2">
      <SectionTitle title={props.title} description={props.description} />
      <TextField
        multiline
        value={draft()}
        onChange={setDraft}
        spellcheck={false}
        autocorrect="off"
        autocomplete="off"
        autocapitalize="off"
        class="font-mono min-h-48"
        error={error()}
      />
      <div class="flex flex-wrap gap-2">
        <Button variant="secondary" icon="copy" onClick={() => void navigator.clipboard.writeText(draft())}>
          {language.t("settings.management.action.export")}
        </Button>
        <Button
          variant="secondary"
          icon="reset"
          onClick={() => setDraft(pretty(configValue(globalSync.data.config, props.configKey)))}
        >
          {language.t("settings.management.action.reset")}
        </Button>
        <Button disabled={save.isPending} icon="check" onClick={() => save.mutate()}>
          {language.t("settings.management.action.save")}
        </Button>
      </div>
    </div>
  )
}

export const SettingsAgents: Component = () => {
  const dialog = useDialog()
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const queryClient = useQueryClient()
  const [categoryFilter, setCategoryFilter] = createSignal("all")
  const [sourceFilter, setSourceFilter] = createSignal<SourceFilter>("all")
  const [modeFilter, setModeFilter] = createSignal<ModeFilter>("all")

  const agents = useQuery(() => ({
    queryKey: ["settings", "agents"],
    queryFn: () => globalSDK.client.app.agents().then((x) => x.data ?? []),
    ...settingsQueryOptions,
  }))
  const files = useQuery(() => ({
    queryKey: ["settings", "agent-files"],
    queryFn: () => globalSDK.client.settings.agent.list().then((x) => x.data ?? []),
    ...settingsQueryOptions,
  }))
  const skills = useQuery(() => ({
    queryKey: ["settings", "skill-files"],
    queryFn: () => globalSDK.client.settings.skill.list().then((x) => x.data ?? []),
    ...settingsQueryOptions,
  }))

  const list = createMemo(() => {
    const runtime = agents.data ?? []
    const runtimeNames = new Set(runtime.map((agent) => agent.name))
    const imported = (files.data ?? []).filter((file) => !runtimeNames.has(file.name)).map(agentFromFile)
    return [...runtime, ...imported].sort((a, b) => a.name.localeCompare(b.name))
  })
  const configured = createMemo(() => configRecord(globalSync.data.config, "agent"))
  const sourceAgents = createMemo(() =>
    list().filter((agent) => matchesSourceFilter(sourceFilter(), agent.native === true)),
  )
  const categoryAgents = createMemo(() => list().filter((agent) => matchesAgentCategory(agent, categoryFilter())))
  const visibleAgents = createMemo(() =>
    sourceAgents()
      .filter((agent) => matchesAgentCategory(agent, categoryFilter()))
      .filter((agent) => matchesModeFilter(agent, modeFilter())),
  )
  const agentByName = createMemo(() => new Map(list().map((item) => [item.name, item])))
  const fileByName = createMemo(
    () => new Map((files.data ?? []).map((item: SettingsAgentListResponse[number]) => [item.name, item])),
  )
  const skillList = createMemo(() => (skills.data ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)))
  const builtInSkillNames = createMemo(() =>
    skillList()
      .filter((skill) => skill.builtIn)
      .map((skill) => skill.name),
  )
  const customSkills = createMemo(() => skillList().filter((skill) => !skill.builtIn))
  const skillByName = createMemo(() => new Map(skillList().map((skill) => [skill.name, skill])))
  const configuredNames = createMemo(() => new Set(Object.keys(configured())))
  const loading = createMemo(() => agents.isLoading || files.isLoading || skills.isLoading)
  const categoryTabs = createMemo(() => {
    const counts = new Map<string, { label: string; count: number }>()
    for (const agent of sourceAgents()) {
      const category = agentCategory(agent)
      const current = counts.get(category.value)
      counts.set(category.value, {
        label: current?.label ?? category.label,
        count: (current?.count ?? 0) + 1,
      })
    }
    const categoryOrder = ["核心", "办公模式"]
    return [
      { value: allCategoryFilter, label: language.t("settings.filters.all"), count: sourceAgents().length },
      ...Array.from(counts.entries())
        .map(([value, item]) => ({ value, label: item.label, count: item.count }))
        .sort((a, b) => {
          const aIndex = categoryOrder.indexOf(a.label)
          const bIndex = categoryOrder.indexOf(b.label)
          if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex
          if (aIndex !== -1) return -1
          if (bIndex !== -1) return 1
          return a.label.localeCompare(b.label)
        }),
    ]
  })
  const sourceCounts = createMemo(
    () =>
      Object.fromEntries(
        sourceFilters.map((filter) => [
          filter.value,
          categoryAgents().filter((agent) => matchesSourceFilter(filter.value, agent.native === true)).length,
        ]),
      ) as Record<SourceFilter, number>,
  )
  const modeCounts = createMemo(
    () =>
      Object.fromEntries(
        modeFilters.map((filter) => [
          filter.value,
          categoryAgents()
            .filter((agent) => matchesSourceFilter(sourceFilter(), agent.native === true))
            .filter((agent) => matchesModeFilter(agent, filter.value as ModeFilter)).length,
        ]),
      ) as Record<ModeFilter, number>,
  )

  createEffect(() => {
    if (categoryFilter() === allCategoryFilter) return
    if (categoryTabs().some((tab) => tab.value === categoryFilter())) return
    setCategoryFilter(allCategoryFilter)
  })

  const reloadAgents = async (deletedName?: string) => {
    const [nextAgents, nextFiles] = await Promise.all([
      globalSDK.client.app.agents().then((x) => x.data ?? []),
      globalSDK.client.settings.agent.list().then((x) => x.data ?? []),
    ])
    queryClient.setQueryData(
      ["settings", "agents"],
      deletedName ? nextAgents.filter((item) => item.name !== deletedName) : nextAgents,
    )
    queryClient.setQueryData(
      ["settings", "agent-files"],
      deletedName ? nextFiles.filter((item) => item.name !== deletedName) : nextFiles,
    )
  }

  const saveAgentFile = async (name: string, data: Record<string, unknown>, content: string) => {
    await globalSDK.client.settings.agent.save({ name, data, content })
    await reloadAgents()
  }

  const deleteAgentFile = async (name: string) => {
    await globalSDK.client.settings.agent.delete({ name })
    queryClient.setQueryData(["settings", "agents"], (current: Agent[] | undefined) =>
      (current ?? []).filter((item) => item.name !== name),
    )
    queryClient.setQueryData(["settings", "agent-files"], (current: SettingsAgentListResponse | undefined) =>
      (current ?? []).filter((item) => item.name !== name),
    )
    await reloadAgents(name)
  }

  const exportAgentFile = (file: SettingsAgentListResponse[number]) =>
    void navigator.clipboard.writeText(pretty({ name: file.name, data: file.data, content: file.content }))

  const importAgent = () => {
    dialog.show(() => (
      <SourceImportDialog
        title={language.t("settings.agents.action.import")}
        extensions={["md"]}
        placeholder={language.t("settings.agents.import.placeholder")}
        onImport={async (input) => {
          const result = await globalSDK.client.settings.agent.import(input).then((x) => x.data ?? {})
          setSourceFilter("custom")
          await reloadAgents()
          return result
        }}
      />
    ))
  }

  const updateAgent = async (name: string, value: Record<string, unknown>) => {
    await globalSync.updateConfig({ agent: { ...configured(), [name]: value } } as Config)
    await agents.refetch()
  }

  const deleteAgent = (name: string) => {
    const next = { ...configured(), [name]: undefined }
    return ignoreResult(globalSync.updateConfig({ agent: next } as Config))
  }

  const addAgent = () => {
    dialog.show(() => (
      <AgentFileDialog
        title={language.t("settings.agents.action.add")}
        initialName={nextName(configured(), "custom-agent")}
        initialData={{
          description: "Describe when this agent should be used",
          mode: "subagent",
          permission: {},
        }}
        initialContent="Write the agent system prompt here."
        onSave={saveAgentFile}
      />
    ))
  }

  const editAgent = (name: string) => {
    const file = fileByName().get(name)
    if (file?.editable) {
      dialog.show(() => (
        <AgentFileDialog
          title={language.t("settings.agents.action.edit")}
          initialName={name}
          initialData={file.data}
          initialContent={file.content}
          lockName
          onSave={saveAgentFile}
        />
      ))
      return
    }

    dialog.show(() => (
      <AgentConfigDialog
        title={language.t("settings.agents.action.edit")}
        initialName={name}
        initialData={
          (configured()[name] as Record<string, unknown> | undefined) ??
          (agentByName().get(name) ? agentConfigFromRuntime(agentByName().get(name)!) : {})
        }
        lockName
        onSave={updateAgent}
      />
    ))
  }

  const removeAgent = (name: string) => {
    const file = fileByName().get(name)
    if (file?.editable) return deleteAgentFile(name)
    return deleteAgent(name)
  }

  const confirmRemoveAgent = (agent: Agent) => {
    dialog.show(() => (
      <ConfirmActionDialog
        title={language.t("settings.management.action.delete")}
        description={`${language.t("settings.management.action.delete")} "${agentDisplayName(agent.name, agent.options)}"?`}
        confirmLabel={language.t("settings.management.action.delete")}
        onConfirm={() => removeAgent(agent.name)}
      />
    ))
  }

  const viewAgent = (agent: Agent) => {
    dialog.show(() => <AgentDetailDialog title={language.t("settings.agents.action.view")} agent={agent} />)
  }

  const configuredAgentData = (agent: Agent): Record<string, unknown> => {
    const value = configured()[agent.name]
    if (isRecord(value)) return value
    return agentConfigFromRuntime(agent)
  }

  const selectedCustomSkills = (agent: Agent) => {
    const rules = agentSkillPermission(configuredAgentData(agent))
    return customSkills()
      .filter((skill) => rules[skill.name] === "allow" || hasSkillPermission(skill.name, agent.permission))
      .map((skill) => skill.name)
  }

  const saveAgentSkills = (agent: Agent, custom: string[]) =>
    updateAgent(agent.name, withAgentSkills(configuredAgentData(agent), builtInSkillNames(), custom))

  const addAgentSkill = (agent: Agent) => {
    const selected = selectedCustomSkills(agent)
    const available = customSkills().filter((skill) => !selected.includes(skill.name))
    dialog.show(() => (
      <SkillSelectDialog
        title={language.t("settings.agents.skills.action.add")}
        skills={available}
        onSelect={(names) => saveAgentSkills(agent, [...selected, ...names])}
      />
    ))
  }

  const removeAgentSkill = (agent: Agent, name: string) =>
    saveAgentSkills(
      agent,
      selectedCustomSkills(agent).filter((item) => item !== name),
    )

  const confirmRemoveAgentSkill = (agent: Agent, name: string) => {
    const data = skillData(skillByName().get(name) ?? { data: {} })
    dialog.show(() => (
      <ConfirmActionDialog
        title={language.t("settings.agents.skills.remove.title")}
        description={language.t("settings.agents.skills.remove.confirm", {
          agent: agentDisplayName(agent.name, agent.options),
          skill: skillDisplayName(name, data),
        })}
        confirmLabel={language.t("settings.agents.skills.remove.button")}
        onConfirm={() => removeAgentSkill(agent, name)}
      />
    ))
  }

  const agentSkills = (agent: Agent) => [
    ...builtInSkillNames()
      .filter((name) => hasSkillPermission(name, agent.permission))
      .map((name) => ({ name, data: skillData(skillByName().get(name) ?? { data: {} }), builtIn: true })),
    ...selectedCustomSkills(agent).map((name) => ({
      name,
      data: skillData(skillByName().get(name) ?? { data: {} }),
      builtIn: false,
    })),
  ]
  const modeLabel = (mode: string) => {
    if (mode === "primary") return language.t("settings.management.tag.primary")
    if (mode === "subagent") return language.t("settings.management.tag.subagent")
    return language.t("settings.management.tag.all")
  }
  const agentTags = (agent: Agent) =>
    [
      categoryTag(agent.options?.category),
      modeLabel(agent.mode),
      agent.native ? language.t("settings.management.tag.builtIn") : language.t("settings.management.tag.custom"),
    ].filter((tag): tag is string => !!tag)

  return (
    <SettingsPage title={language.t("settings.agents.title")} description={language.t("settings.agents.description")}>
      <div>
        <SectionTitle title={language.t("settings.agents.section.available")} />
        <Toolbar>
          <Button variant="secondary" icon="plus-small" onClick={addAgent}>
            {language.t("settings.agents.action.add")}
          </Button>
          <Button variant="secondary" icon="copy" onClick={importAgent}>
            {language.t("settings.management.action.import")}
          </Button>
        </Toolbar>
        <div class="flex flex-wrap items-center justify-between gap-3 pb-3">
          <PageTabs class="pb-0" value={categoryFilter()} onChange={setCategoryFilter} items={categoryTabs()} />
          <PageTabs
            class="pb-0"
            value={sourceFilter()}
            onChange={(value) => setSourceFilter(value as SourceFilter)}
            items={sourceFilters.map((filter) => ({
              value: filter.value,
              label: language.t(filter.label),
              count: sourceCounts()[filter.value],
            }))}
          />
          <PageTabs
            class="pb-0"
            value={modeFilter()}
            onChange={(value) => setModeFilter(value as ModeFilter)}
            items={modeFilters.map((filter) => ({
              value: filter.value,
              label: language.t(filter.label),
              count: modeCounts()[filter.value],
            }))}
          />
        </div>
        <div class="pb-3 text-12-regular text-text-weak">{language.t("settings.agents.skills.note")}</div>
        <SettingsList>
          <Show when={!loading()} fallback={<LoadingState />}>
            <Show
              when={safeArray(visibleAgents()).length > 0}
              fallback={<EmptyState message={language.t("settings.agents.empty")} />}
            >
              <For each={safeArray(visibleAgents())}>
                {(agent: Agent) => (
                  <RuntimeRow
                    icon="brain"
                    title={agentDisplayName(agent.name, agent.options)}
                    description={agent.description}
                    tags={agentTags(agent)}
                    footer={
                      <AgentSkillList
                        skills={agentSkills(agent)}
                        onAdd={() => addAgentSkill(agent)}
                        onRemove={(name) => confirmRemoveAgentSkill(agent, name)}
                      />
                    }
                    actions={
                      <>
                        <Show
                          when={!agent.native}
                          fallback={
                            <IconButton
                              icon="eye"
                              variant="ghost"
                              onClick={() => viewAgent(agent)}
                              aria-label={language.t("settings.management.action.view")}
                            />
                          }
                        >
                          <IconButton
                            icon="edit"
                            variant="ghost"
                            onClick={() => editAgent(agent.name)}
                            aria-label={language.t("settings.management.action.edit")}
                          />
                          <Show when={fileByName().get(agent.name)}>
                            {(file) => (
                              <IconButton
                                icon="copy"
                                variant="ghost"
                                onClick={() => exportAgentFile(file())}
                                aria-label={language.t("settings.management.action.export")}
                              />
                            )}
                          </Show>
                          <IconButton
                            icon="trash"
                            variant="ghost"
                            disabled={!configuredNames().has(agent.name) && !fileByName().get(agent.name)?.editable}
                            onClick={() => confirmRemoveAgent(agent)}
                            aria-label={language.t("settings.management.action.delete")}
                          />
                        </Show>
                      </>
                    }
                  />
                )}
              </For>
            </Show>
          </Show>
        </SettingsList>
      </div>
    </SettingsPage>
  )
}

export const SettingsSkills: Component = () => {
  const dialog = useDialog()
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const queryClient = useQueryClient()
  const [modeGroup, setModeGroup] = createSignal<ModeGroup>("all")
  const [sourceFilter, setSourceFilter] = createSignal<SourceFilter>("all")

  const files = useQuery(() => ({
    queryKey: ["settings", "skill-files"],
    queryFn: () => globalSDK.client.settings.skill.list().then((x) => x.data ?? []),
    ...settingsQueryOptions,
  }))

  const list = createMemo(() => (files.data ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)))
  const sourceSkills = createMemo(() =>
    list().filter((skill) => matchesSourceFilter(sourceFilter(), skill.builtIn ?? false)),
  )
  const modeSkills = createMemo(() =>
    list().filter((skill) => matchesModeGroup(skillModeSearchText(skill), modeGroup())),
  )
  const visibleSkills = createMemo(() =>
    sourceSkills().filter((skill) => matchesModeGroup(skillModeSearchText(skill), modeGroup())),
  )
  const modeCounts = createMemo(
    () =>
      Object.fromEntries(
        modeGroups.map((group) => [
          group.value,
          sourceSkills().filter((skill) => matchesModeGroup(skillModeSearchText(skill), group.value)).length,
        ]),
      ) as Record<ModeGroup, number>,
  )
  const sourceCounts = createMemo(
    () =>
      Object.fromEntries(
        sourceFilters.map((filter) => [
          filter.value,
          modeSkills().filter((skill) => matchesSourceFilter(filter.value, skill.builtIn ?? false)).length,
        ]),
      ) as Record<SourceFilter, number>,
  )
  const fileByName = createMemo(
    () => new Map((files.data ?? []).map((item: SettingsSkillListResponse[number]) => [item.name, item])),
  )
  const reloadSkills = async () => {
    queryClient.setQueryData(
      ["settings", "skill-files"],
      await globalSDK.client.settings.skill.list().then((x) => x.data ?? []),
    )
  }

  const saveSkillFile = async (name: string, description: string, content: string) => {
    await globalSDK.client.settings.skill.save({ name, description: description || undefined, content })
    setSourceFilter("custom")
    await reloadSkills()
  }

  const deleteSkillFile = async (name: string) => {
    await globalSDK.client.settings.skill.delete({ name })
    queryClient.setQueryData(["settings", "skill-files"], (current: SettingsSkillListResponse | undefined) =>
      (current ?? []).filter((item) => item.name !== name),
    )
    await reloadSkills()
  }

  const exportSkillFile = (file: SettingsSkillListResponse[number]) =>
    void navigator.clipboard.writeText(
      pretty({
        name: file.name,
        description: skillDescription(file),
        content: file.content,
      }),
    )

  const importSkill = () => {
    dialog.show(() => (
      <SourceImportDialog
        title={language.t("settings.skills.action.import")}
        extensions={["md"]}
        placeholder={language.t("settings.skills.import.placeholder")}
        onImport={async (input) => {
          const result = await globalSDK.client.settings.skill.import(input).then((x) => x.data ?? {})
          setSourceFilter("custom")
          await reloadSkills()
          return result
        }}
      />
    ))
  }

  const addSkill = () => {
    const existing = Object.fromEntries((files.data ?? []).map((item) => [item.name, true]))
    dialog.show(() => (
      <SkillFileDialog
        title={language.t("settings.skills.action.add")}
        initialName={nextName(existing, "custom-skill")}
        initialDescription="Describe when this skill should be used"
        initialContent="Write the skill instructions here."
        onSave={saveSkillFile}
      />
    ))
  }

  const editSkill = (name: string) => {
    const file = fileByName().get(name)
    if (!file?.editable) return
    dialog.show(() => (
      <SkillFileDialog
        title={language.t("settings.skills.action.edit")}
        initialName={name}
        initialDescription={skillDescription(file)}
        initialContent={file.content}
        lockName
        onSave={saveSkillFile}
      />
    ))
  }

  const viewSkill = (name: string) => {
    const file = fileByName().get(name)
    if (!file) return
    dialog.show(() => (
      <SkillDetailDialog
        title={language.t("settings.skills.action.view")}
        name={file.name}
        description={skillDescription(file)}
        content={file.content}
      />
    ))
  }

  const confirmDeleteSkill = (skill: SettingsSkillListResponse[number]) => {
    const data = skillData(skill)
    dialog.show(() => (
      <ConfirmActionDialog
        title={language.t("settings.management.action.delete")}
        description={`${language.t("settings.management.action.delete")} "${skillDisplayName(skill.name, data)}"?`}
        confirmLabel={language.t("settings.management.action.delete")}
        onConfirm={() => deleteSkillFile(skill.name)}
      />
    ))
  }

  return (
    <SettingsPage title={language.t("settings.skills.title")} description={language.t("settings.skills.description")}>
      <div>
        <SectionTitle title={language.t("settings.skills.section.available")} />
        <Toolbar>
          <Button variant="secondary" icon="plus-small" onClick={addSkill}>
            {language.t("settings.skills.action.add")}
          </Button>
          <Button variant="secondary" icon="copy" onClick={importSkill}>
            {language.t("settings.management.action.import")}
          </Button>
        </Toolbar>
        <div class="flex flex-wrap items-center justify-between gap-3 pb-3">
          <PageTabs
            class="pb-0"
            value={modeGroup()}
            onChange={(value) => setModeGroup(value as ModeGroup)}
            items={modeGroups.map((group) => ({
              value: group.value,
              label: modeGroupLabel(group.value),
              count: modeCounts()[group.value],
            }))}
          />
          <PageTabs
            class="pb-0"
            value={sourceFilter()}
            onChange={(value) => setSourceFilter(value as SourceFilter)}
            items={sourceFilters.map((filter) => ({
              value: filter.value,
              label: language.t(filter.label),
              count: sourceCounts()[filter.value],
            }))}
          />
        </div>
        <SettingsList>
          <Show when={!files.isLoading} fallback={<LoadingState />}>
            <Show
              when={safeArray(visibleSkills()).length > 0}
              fallback={<EmptyState message={language.t("settings.skills.empty")} />}
            >
              <For each={safeArray(visibleSkills())}>
                {(skill) => {
                  const data = skillData(skill)
                  return (
                    <RuntimeRow
                      icon="checklist"
                      title={skillDisplayName(skill.name, data)}
                      description={typeof data.description === "string" ? data.description : ""}
                      tags={[
                        categoryTag(data.category),
                        skill.builtIn
                          ? language.t("settings.management.tag.builtIn")
                          : language.t("settings.management.tag.custom"),
                      ].filter((tag): tag is string => !!tag)}
                      actions={
                        <>
                          <IconButton
                            icon="eye"
                            variant="ghost"
                            onClick={() => viewSkill(skill.name)}
                            aria-label={language.t("settings.management.action.view")}
                          />
                          <Show when={fileByName().get(skill.name)}>
                            {(file) => (
                              <Show when={file().editable}>
                                <IconButton
                                  icon="copy"
                                  variant="ghost"
                                  onClick={() => exportSkillFile(file())}
                                  aria-label={language.t("settings.management.action.export")}
                                />
                              </Show>
                            )}
                          </Show>
                          <Show when={fileByName().get(skill.name)?.editable}>
                            <>
                              <IconButton
                                icon="edit"
                                variant="ghost"
                                onClick={() => editSkill(skill.name)}
                                aria-label={language.t("settings.management.action.edit")}
                              />
                              <IconButton
                                icon="trash"
                                variant="ghost"
                                onClick={() => confirmDeleteSkill(skill)}
                                aria-label={language.t("settings.management.action.delete")}
                              />
                            </>
                          </Show>
                        </>
                      }
                    />
                  )
                }}
              </For>
            </Show>
          </Show>
        </SettingsList>
      </div>
    </SettingsPage>
  )
}

export const SettingsRules: Component<{ directory?: string }> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const client = createMemo(() =>
    props.directory ? globalSDK.createClient({ directory: props.directory, throwOnError: true }) : globalSDK.client,
  )
  const queryClient = useQueryClient()
  const rules = useQuery(() => ({
    queryKey: ["settings", "global-rules"],
    queryFn: () =>
      client()
        .settings.rule.list({ scope: "global" })
        .then((x) => x.data ?? []),
    ...settingsQueryOptions,
  }))
  const projectRules = useQuery(() => ({
    queryKey: ["settings", "project-rules", props.directory ? pathKey(props.directory) : "none"],
    queryFn: () =>
      props.directory
        ? client()
            .settings.rule.list({ scope: "project" })
            .then((x) => x.data ?? [])
        : Promise.resolve([]),
    ...settingsQueryOptions,
  }))
  const projectInstructionFallbackPath = (directory: string) => {
    const separator = directory.includes("\\") ? "\\" : "/"
    return `${directory.replace(/[\\/]+$/, "")}${separator}AGENTS.md`
  }
  const loadProjectInstruction = async (directory: string) => {
    const file = await client()
      .settings.projectInstruction.get({ directory })
      .then((x) => x.data)
    if (file?.content.trim()) return file
    const location = projectInstructionFallbackPath(directory)
    const fallback = await client()
      .file.read({ directory, path: location })
      .then((x) => x.data)
      .catch(() => undefined)
    if (fallback?.type !== "text" || !fallback.content.trim()) return file
    return {
      name: "AGENTS.md",
      location,
      editable: true,
      data: {},
      content: fallback.content,
    }
  }
  const projectInstruction = useQuery(() => ({
    queryKey: ["settings", "project-instruction", props.directory ? pathKey(props.directory) : "none"],
    queryFn: () => (props.directory ? loadProjectInstruction(props.directory) : Promise.resolve(undefined)),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  }))
  const ruleSet = (scope: "global" | "project") => (scope === "global" ? (rules.data ?? []) : (projectRules.data ?? []))
  const queryKey = (scope: "global" | "project") =>
    scope === "global"
      ? ["settings", "global-rules"]
      : ["settings", "project-rules", props.directory ? pathKey(props.directory) : "none"]
  const projectInstructionQueryKey = () => [
    "settings",
    "project-instruction",
    props.directory ? pathKey(props.directory) : "none",
  ]
  const fileByScope = (scope: "global" | "project") => new Map(ruleSet(scope).map((item) => [item.name, item]))
  const setRuleFiles = (scope: "global" | "project", updater: (files: RuleFile[]) => RuleFile[]) =>
    queryClient.setQueryData<RuleFile[]>(queryKey(scope), (current) => updater(safeArray(current)))
  const setProjectInstruction = (file: ProjectInstructionFile) =>
    queryClient.setQueryData<ProjectInstructionFile | undefined>(projectInstructionQueryKey(), file)
  const projectStore = () => (props.directory ? globalSync.child(props.directory)[0] : undefined)
  const providerState = () => {
    const store = projectStore()
    if (store?.provider_ready) return store.provider
    return globalSync.data.provider
  }
  const configState = () => projectStore()?.config ?? globalSync.data.config
  const modelExists = (model: { providerID: string; modelID: string }) => {
    const provider = providerState().all.find((item) => item.id === model.providerID)
    return !!provider?.models[model.modelID] && providerState().connected.includes(model.providerID)
  }
  const connectedProviders = () => providerState().all.filter((item) => providerState().connected.includes(item.id))
  const projectInstructionModels = () =>
    connectedProviders().flatMap((provider) =>
      Object.values(provider.models).map((model) => ({
        providerID: provider.id,
        modelID: model.id,
        label: model.name || model.id,
      })),
    )
  const firstProviderModel = (providerID: string) => {
    const provider = connectedProviders().find((item) => item.id === providerID)
    if (!provider) return
    const configuredModel = providerState().default[provider.id]
    if (configuredModel && provider.models[configuredModel])
      return { providerID: provider.id, modelID: configuredModel }
    const first =
      Object.values(provider.models).find((model) => !model.id.includes("-nano")) ?? Object.values(provider.models)[0]
    if (first) return { providerID: provider.id, modelID: first.id }
  }
  const defaultProjectInstructionModel = () => {
    const opencode = firstProviderModel("opencode")
    if (opencode) return opencode
    const configured = configState().model?.split("/")
    if (configured?.[0] && configured[1]) {
      const model = { providerID: configured[0], modelID: configured[1] }
      if (modelExists(model)) return model
    }
    for (const provider of connectedProviders()) {
      const model = firstProviderModel(provider.id)
      if (model) return model
    }
  }

  const triggerLabel = (trigger: RuleTrigger) =>
    language.t(ruleTriggerOptions.find((option) => option.value === trigger)?.label ?? "settings.rules.trigger.always")

  const requireDirectory = () => {
    if (props.directory) return props.directory
    showToast({
      title: language.t("settings.projectInstruction.toast.folderRequired.title"),
      description: language.t("settings.projectInstruction.toast.folderRequired.description"),
    })
  }

  const saveRuleFile = async (
    scope: "global" | "project",
    name: string,
    description: string,
    trigger: RuleTrigger,
    content: string,
  ) => {
    try {
      if (scope === "project" && !props.directory) throw new Error("Project directory is required")
      const saved = await client()
        .settings.rule.save({ scope, name, description: description || undefined, trigger, content })
        .then((x) => x.data)
      if (saved) {
        setRuleFiles(scope, (files) =>
          [...files.filter((file) => file.name !== saved.name), saved].sort((a, b) => a.name.localeCompare(b.name)),
        )
      }
      await queryClient.invalidateQueries({ queryKey: queryKey(scope) })
    } catch (err) {
      showToast({
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }

  const deleteRuleFile = async (scope: "global" | "project", name: string) => {
    try {
      if (scope === "project" && !props.directory) throw new Error("Project directory is required")
      await client().settings.rule.delete({ scope, name })
      setRuleFiles(scope, (files) => files.filter((file) => file.name !== name))
      await queryClient.invalidateQueries({ queryKey: queryKey(scope) })
    } catch (err) {
      showToast({
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const saveProjectInstruction = async (content: string) => {
    try {
      const directory = requireDirectory()
      if (!directory) throw new Error(language.t("settings.projectInstruction.error.folderRequired"))
      const saved = await client()
        .settings.projectInstruction.save({ directory, content })
        .then((x) => x.data)
      if (saved) setProjectInstruction(saved)
      await queryClient.invalidateQueries({ queryKey: projectInstructionQueryKey() })
    } catch (err) {
      showToast({
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }

  const waitForProjectInstruction = async (
    directory: string,
    onProgress?: (item: ProjectInstructionGenerateProgress) => void,
  ) => {
    for (const _ of Array.from({ length: 60 })) {
      const saved = await client()
        .settings.projectInstruction.get({ directory })
        .then((x) => x.data)
      if (saved?.content.trim()) {
        onProgress?.({
          step: "written",
          title: language.t("settings.projectInstruction.generating.progress.written"),
          detail: saved.location,
          content: saved.content,
        })
        return saved
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1000))
    }
    const saved = await client()
      .settings.projectInstruction.get({ directory })
      .then((x) => x.data)
    if (saved?.content.trim()) {
      onProgress?.({
        step: "written",
        title: language.t("settings.projectInstruction.generating.progress.written"),
        detail: saved.location,
        content: saved.content,
      })
    }
    return saved
  }

  const pollProjectInstructionSession = async (
    directory: string,
    sessionID: string,
    running: () => boolean,
    onProgress: (item: ProjectInstructionGenerateProgress) => void,
  ) => {
    let last = ""
    while (running()) {
      const answer = await client()
        .session.messages({ directory, sessionID, limit: 20 })
        .then((x) => sessionAnswerText(x.data ?? []))
        .catch(() => "")
      if (answer && answer !== last) {
        last = answer
        onProgress({
          step: "command",
          title: language.t("settings.projectInstruction.generating.progress.answer"),
          detail: language.t("settings.projectInstruction.generating.progress.answer.detail"),
          answer,
        })
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1000))
    }
  }

  const generateProjectInstruction = async (
    comment: string,
    model: { providerID: string; modelID: string },
    onProgress: (item: ProjectInstructionGenerateProgress) => void,
  ) => {
    const directory = requireDirectory()
    if (!directory) return
    onProgress({
      step: "session",
      title: language.t("settings.projectInstruction.generating.progress.session"),
      detail: model.modelID,
    })
    const session = await client()
      .session.create({
        directory,
        title: language.t("settings.projectInstruction.session.title"),
        model: { providerID: model.providerID, id: model.modelID },
      })
      .then((x) => x.data)
    if (!session) throw new Error("Session creation failed")
    await client()
      .session.update({ directory, sessionID: session.id, time: { archived: Date.now() } })
      .catch(() => {})
    onProgress({
      step: "command",
      title: language.t("settings.projectInstruction.generating.progress.command"),
      detail: "/init",
    })
    const polling = { current: true }
    void pollProjectInstructionSession(directory, session.id, () => polling.current, onProgress)
    let commandError: unknown
    const command = client()
      .session.command({
        directory,
        sessionID: session.id,
        command: "init",
        arguments: comment,
        model: `${model.providerID}/${model.modelID}`,
      })
      .catch((err) => {
        commandError = err
      })
    onProgress({
      step: "waiting",
      title: language.t("settings.projectInstruction.generating.progress.waiting"),
      detail: "AGENTS.md",
    })
    const saved = await waitForProjectInstruction(directory, onProgress)
    polling.current = false
    if (!saved?.content.trim()) {
      await command
      const retry = await client()
        .settings.projectInstruction.get({ directory })
        .then((x) => x.data)
      if (retry?.content.trim()) setProjectInstruction(retry)
      if (!retry?.content.trim() && commandError) throw commandError
    }
    if (saved) setProjectInstruction(saved)
    await queryClient.invalidateQueries({ queryKey: projectInstructionQueryKey() })
    showToast({
      variant: "success",
      icon: "circle-check",
      title: language.t("settings.projectInstruction.toast.completed.title"),
      description: language.t("settings.projectInstruction.toast.completed.description"),
    })
  }

  const addRule = (scope: "global" | "project") => {
    const existing = Object.fromEntries(ruleSet(scope).map((item) => [item.name, true]))
    dialog.show(() => (
      <RuleFileDialog
        title={language.t("settings.rules.action.add")}
        initialName={nextName(existing, "rule")}
        initialDescription=""
        initialTrigger="always"
        initialContent=""
        onSave={(name, description, trigger, content) => saveRuleFile(scope, name, description, trigger, content)}
      />
    ))
  }

  const editRule = (scope: "global" | "project", name: string) => {
    const file = fileByScope(scope).get(name)
    if (!file?.editable) return
    dialog.show(() => (
      <RuleFileDialog
        title={language.t("settings.rules.action.edit")}
        initialName={name}
        initialDescription={stringField(file.data, "description")}
        initialTrigger={ruleTrigger(file.data)}
        initialContent={file.content}
        lockName
        onSave={(nextName, description, trigger, content) =>
          saveRuleFile(scope, nextName, description, trigger, content)
        }
      />
    ))
  }

  const viewRule = (scope: "global" | "project", name: string) => {
    const file = fileByScope(scope).get(name)
    if (!file) return
    dialog.show(() => (
      <RuleDetailDialog
        title={language.t("settings.management.action.view")}
        name={file.name}
        description={stringField(file.data, "description")}
        trigger={ruleTrigger(file.data)}
        content={file.content}
      />
    ))
  }

  const editProjectInstruction = () => {
    if (!requireDirectory()) return
    const file = projectInstruction.data
    dialog.show(() => (
      <ProjectInstructionDialog
        title={language.t(
          file?.content.trim()
            ? "settings.projectInstruction.action.edit"
            : "settings.projectInstruction.action.create",
        )}
        initialContent={file?.content ?? ""}
        onSave={saveProjectInstruction}
      />
    ))
  }

  const viewProjectInstruction = () => {
    const file = projectInstruction.data
    if (!file) return
    dialog.show(() => (
      <ProjectInstructionDetailDialog title={language.t("settings.projectInstruction.action.view")} file={file} />
    ))
  }

  const openGenerateProjectInstruction = () => {
    if (!requireDirectory()) return
    dialog.show(() => (
      <ProjectInstructionGenerateDialog
        title={language.t("settings.projectInstruction.action.generate")}
        models={projectInstructionModels()}
        initialModel={defaultProjectInstructionModel()}
        onGenerate={generateProjectInstruction}
      />
    ))
  }

  const ProjectInstructionSection: Component = () => (
    <div>
      <SectionTitle title={language.t("settings.projectInstruction.title")} />
      <Toolbar>
        <Button variant="secondary" icon="checklist" onClick={openGenerateProjectInstruction}>
          {language.t("settings.projectInstruction.action.generate")}
        </Button>
        <Button variant="secondary" icon="edit" onClick={editProjectInstruction}>
          {language.t(
            projectInstruction.data?.content.trim()
              ? "settings.projectInstruction.action.edit"
              : "settings.projectInstruction.action.create",
          )}
        </Button>
      </Toolbar>
      <Show
        when={!projectInstruction.isLoading}
        fallback={
          <SettingsList>
            <LoadingState />
          </SettingsList>
        }
      >
        <Show when={!props.directory}>
          <SettingsList>
            <EmptyState message={language.t("settings.projectInstruction.empty.noProject")} />
          </SettingsList>
        </Show>
        <Show when={props.directory && projectInstruction.data?.content.trim()}>
          <SettingsList>
            <RuntimeRow
              icon="checklist"
              title="AGENTS.md"
              description={projectInstruction.data?.location ?? ""}
              tags={[
                language.t("settings.projectInstruction.tag.generated"),
                language.t("settings.management.tag.configured"),
              ]}
              actions={
                <>
                  <IconButton
                    icon="eye"
                    variant="ghost"
                    onClick={viewProjectInstruction}
                    aria-label={language.t("settings.management.action.view")}
                  />
                  <IconButton
                    icon="edit"
                    variant="ghost"
                    onClick={editProjectInstruction}
                    aria-label={language.t("settings.management.action.edit")}
                  />
                </>
              }
            />
          </SettingsList>
        </Show>
      </Show>
    </div>
  )

  const RuleSection: Component<{ scope: "global" | "project"; title: string }> = (props) => (
    <div>
      <SectionTitle title={props.title} />
      <Toolbar>
        <Button variant="secondary" icon="plus-small" onClick={() => addRule(props.scope)}>
          {language.t("settings.rules.action.add")}
        </Button>
      </Toolbar>
      <SettingsList>
        <Show when={!rules.isLoading && !projectRules.isLoading} fallback={<LoadingState />}>
          <Show
            when={safeArray(ruleSet(props.scope)).length > 0}
            fallback={<EmptyState message={language.t("settings.rules.empty")} />}
          >
            <For each={safeArray(ruleSet(props.scope))}>
              {(file) => (
                <RuntimeRow
                  icon="shield"
                  title={file.name}
                  description={stringField(file.data, "description")}
                  tags={[triggerLabel(ruleTrigger(file.data)), language.t("settings.management.tag.configured")]}
                  actions={
                    <>
                      <IconButton
                        icon="eye"
                        variant="ghost"
                        onClick={() => viewRule(props.scope, file.name)}
                        aria-label={language.t("settings.management.action.view")}
                      />
                      <IconButton
                        icon="edit"
                        variant="ghost"
                        onClick={() => editRule(props.scope, file.name)}
                        aria-label={language.t("settings.management.action.edit")}
                      />
                      <IconButton
                        icon="trash"
                        variant="ghost"
                        onClick={() => void deleteRuleFile(props.scope, file.name)}
                        aria-label={language.t("settings.management.action.delete")}
                      />
                    </>
                  }
                />
              )}
            </For>
          </Show>
        </Show>
      </SettingsList>
    </div>
  )

  return (
    <SettingsPage title={language.t("settings.rules.title")} description={language.t("settings.rules.description")}>
      <ProjectInstructionSection />
      <RuleSection scope="global" title={language.t("settings.rules.section.global")} />
      <RuleSection scope="project" title={language.t("settings.rules.section.project")} />
    </SettingsPage>
  )
}

export const SettingsMcp: Component = () => {
  const dialog = useDialog()
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const queryClient = useQueryClient()

  const mcp = useQuery(() => ({
    queryKey: ["settings", "mcp"],
    queryFn: () => globalSDK.client.mcp.status().then((x) => x.data ?? {}),
    ...settingsQueryOptions,
  }))

  const items = createMemo(() =>
    Object.entries(isRecord(mcp.data) ? mcp.data : {})
      .map(([name, status]) => ({ name, status }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  )
  const configured = createMemo(() => configRecord(globalSync.data.config, "mcp"))

  const updateMcp = (name: string, value: Record<string, unknown>) =>
    ignoreResult(globalSync.updateConfig({ mcp: { ...configured(), [name]: value } } as Config))

  const deleteMcp = (name: string) =>
    ignoreResult(globalSync.updateConfig({ mcp: { ...configured(), [name]: undefined } } as Config))

  const viewMcp = (name: string, status: McpStatus) => {
    const value = configured()[name]
    dialog.show(() => (
      <McpDetailDialog
        title={language.t("settings.management.action.view")}
        name={name}
        status={status}
        config={isRecord(value) ? value : undefined}
      />
    ))
  }

  const addMcp = () => {
    dialog.show(() => (
      <McpEntryDialog
        title={language.t("settings.mcp.action.add")}
        initialName={nextName(configured(), "mcp-server")}
        initialValue={{
          type: "local",
          command: ["node", "server.js"],
          enabled: true,
        }}
        onSave={updateMcp}
      />
    ))
  }

  const editMcp = (name: string) => {
    dialog.show(() => (
      <McpEntryDialog
        title={language.t("settings.mcp.action.edit")}
        initialName={name}
        initialValue={(configured()[name] as Record<string, unknown> | undefined) ?? {}}
        lockName
        onSave={updateMcp}
      />
    ))
  }

  const toggle = useMutation(() => ({
    mutationFn: async (name: string) => {
      const status = mcp.data?.[name]
      if (status?.status === "connected") {
        await globalSDK.client.mcp.disconnect({ name })
        return
      }
      if (status?.status === "needs_auth") {
        await globalSDK.client.mcp.auth.authenticate({ name })
        return
      }
      await globalSDK.client.mcp.connect({ name })
    },
    onSuccess: () => queryClient.refetchQueries({ queryKey: ["settings", "mcp"] }),
  }))

  return (
    <SettingsPage title={language.t("settings.mcp.title")} description={language.t("settings.mcp.description")}>
      <div>
        <SectionTitle title={language.t("settings.mcp.section.servers")} />
        <Toolbar>
          <Button variant="secondary" icon="plus-small" onClick={addMcp}>
            {language.t("settings.mcp.action.add")}
          </Button>
        </Toolbar>
        <SettingsList>
          <Show when={!mcp.isLoading} fallback={<LoadingState />}>
            <Show
              when={safeArray(items()).length > 0}
              fallback={<EmptyState message={language.t("dialog.mcp.empty")} />}
            >
              <For each={safeArray(items())}>
                {(item) => (
                  <McpRow
                    name={item.name}
                    status={item.status}
                    disabled={toggle.isPending && toggle.variables === item.name}
                    onToggle={() => toggle.mutate(item.name)}
                    onView={() => viewMcp(item.name, item.status)}
                    onEdit={configured()[item.name] ? () => editMcp(item.name) : undefined}
                    onDelete={configured()[item.name] ? () => void deleteMcp(item.name) : undefined}
                  />
                )}
              </For>
            </Show>
          </Show>
        </SettingsList>
      </div>
      <ConfiguredRecordSection
        title={language.t("settings.mcp.section.configured")}
        empty={language.t("settings.mcp.configured.empty")}
        items={configured()}
        icon="mcp"
        onEdit={editMcp}
        onDelete={(name) => void deleteMcp(name)}
      />
    </SettingsPage>
  )
}

export const SettingsPlugins: Component = () => {
  const dialog = useDialog()
  const language = useLanguage()
  const globalSync = useGlobalSync()
  const configured = createMemo(() => globalSync.data.config.plugin ?? [])
  const plugins = createMemo(() =>
    safeArray(configured()).map((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin)),
  )

  const updatePlugins = (next: unknown[]) => ignoreResult(globalSync.updateConfig({ plugin: next } as Config))

  const addPlugin = () => {
    dialog.show(() => (
      <PluginEntryDialog
        title={language.t("settings.plugins.action.add")}
        initialValue="@scope/plugin"
        onSave={(value) => updatePlugins([...configured(), value])}
      />
    ))
  }

  const editPlugin = (index: number) => {
    dialog.show(() => (
      <PluginEntryDialog
        title={language.t("settings.plugins.action.edit")}
        initialValue={configured()[index] ?? ""}
        onSave={(value) => {
          const next = configured().slice()
          next[index] = value as never
          return updatePlugins(next)
        }}
      />
    ))
  }

  const deletePlugin = (index: number) => updatePlugins(configured().filter((_, i) => i !== index))

  return (
    <SettingsPage title={language.t("settings.plugins.title")} description={language.t("settings.plugins.description")}>
      <div>
        <SectionTitle title={language.t("settings.plugins.section.installed")} />
        <Toolbar>
          <Button variant="secondary" icon="plus-small" onClick={addPlugin}>
            {language.t("settings.plugins.action.add")}
          </Button>
        </Toolbar>
        <SettingsList>
          <Show
            when={safeArray(plugins()).length > 0}
            fallback={<EmptyState message={language.t("settings.plugins.empty")} />}
          >
            <For each={safeArray(plugins())}>
              {(plugin, index) => (
                <RuntimeRow
                  icon="server"
                  title={plugin}
                  tags={[language.t("settings.plugins.tag.config")]}
                  actions={
                    <>
                      <IconButton
                        icon="edit"
                        variant="ghost"
                        onClick={() => editPlugin(index())}
                        aria-label={language.t("settings.management.action.edit")}
                      />
                      <IconButton
                        icon="trash"
                        variant="ghost"
                        onClick={() => void deletePlugin(index())}
                        aria-label={language.t("settings.management.action.delete")}
                      />
                    </>
                  }
                />
              )}
            </For>
          </Show>
        </SettingsList>
      </div>
    </SettingsPage>
  )
}

const RuntimeRow: Component<{
  icon: RuntimeIcon
  title: string
  description?: string
  tags?: string[]
  footer?: JSX.Element
  actions?: JSX.Element
}> = (props) => (
  <div class="flex items-center justify-between gap-4 min-h-16 py-3 border-b border-border-weak-base last:border-none">
    <div class="flex items-start gap-3 min-w-0 flex-1">
      <Icon name={props.icon} class="size-5 shrink-0 icon-strong-base mt-0.5" />
      <div class="flex flex-col min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-14-medium text-text-strong truncate">{props.title}</span>
          <For each={props.tags ?? []}>{(tag) => <Tag>{tag}</Tag>}</For>
        </div>
        <Show when={props.description}>
          <span class="text-12-regular text-text-weak truncate">{props.description}</span>
        </Show>
        <Show when={props.footer}>{props.footer}</Show>
      </div>
    </div>
    <Show when={props.actions}>
      <div class="flex shrink-0 items-center gap-1">{props.actions}</div>
    </Show>
  </div>
)

const AgentSkillList: Component<{
  skills: { name: string; data?: Record<string, unknown>; builtIn: boolean }[]
  onAdd: () => void
  onRemove: (name: string) => void
}> = (props) => {
  const language = useLanguage()
  return (
    <div class="mt-2 flex flex-wrap items-center gap-1.5">
      <span class="text-12-regular text-text-weak">{language.t("settings.agents.skills.title")}</span>
      <Show
        when={safeArray(props.skills).length > 0}
        fallback={<Tag>{language.t("settings.agents.skills.empty")}</Tag>}
      >
        <For each={safeArray(props.skills)}>
          {(skill) => (
            <span class="inline-flex h-6 max-w-44 items-center gap-1 rounded-md border border-border-weak-base bg-surface-weak px-2 text-12-regular text-text-base">
              <span class="truncate">{skillDisplayName(skill.name, skill.data)}</span>
              <Show when={skill.builtIn}>
                <span class="text-text-weak">{language.t("settings.management.tag.builtIn")}</span>
              </Show>
              <Show when={!skill.builtIn}>
                <button
                  type="button"
                  class="text-text-weak hover:text-text-strong"
                  onClick={() => props.onRemove(skill.name)}
                  aria-label={language.t("settings.agents.skills.action.remove")}
                >
                  x
                </button>
              </Show>
            </span>
          )}
        </For>
      </Show>
      <button
        type="button"
        class="inline-flex h-6 items-center rounded-md border border-border-weak-base px-2 text-12-regular text-text-base hover:bg-surface-weak"
        onClick={props.onAdd}
      >
        {language.t("settings.agents.skills.action.add")}
      </button>
    </div>
  )
}

const ConfiguredRecordSection: Component<{
  title: string
  empty: string
  items: Record<string, unknown>
  icon: RuntimeIcon
  hideTitle?: boolean
  onEdit: (name: string) => void
  onDelete: (name: string) => void
}> = (props) => {
  const language = useLanguage()
  const entries = createMemo(() => Object.entries(props.items).sort(([a], [b]) => a.localeCompare(b)))

  return (
    <div>
      <Show when={!props.hideTitle}>
        <SectionTitle title={props.title} />
      </Show>
      <SettingsList>
        <Show when={safeArray(entries()).length > 0} fallback={<EmptyState message={props.empty} />}>
          <For each={safeArray(entries())}>
            {([name, value]) => (
              <RuntimeRow
                icon={props.icon}
                title={name}
                description={humanSummary(value)}
                tags={[language.t("settings.management.tag.configured")]}
                actions={
                  <>
                    <IconButton
                      icon="edit"
                      variant="ghost"
                      onClick={() => props.onEdit(name)}
                      aria-label={language.t("settings.management.action.edit")}
                    />
                    <IconButton
                      icon="trash"
                      variant="ghost"
                      onClick={() => props.onDelete(name)}
                      aria-label={language.t("settings.management.action.delete")}
                    />
                  </>
                }
              />
            )}
          </For>
        </Show>
      </SettingsList>
    </div>
  )
}

const McpRow: Component<{
  name: string
  status: McpStatus
  disabled: boolean
  onToggle: () => void
  onView: () => void
  onEdit?: () => void
  onDelete?: () => void
}> = (props) => {
  const language = useLanguage()
  const status = () => props.status.status
  const label = () => language.t(statusLabels[status()])
  const error = () =>
    props.status.status === "failed" || props.status.status === "needs_client_registration"
      ? props.status.error
      : undefined
  const configurable = () => !!props.onEdit || !!props.onDelete

  return (
    <div class="flex flex-wrap items-center justify-between gap-4 min-h-16 py-3 border-b border-border-weak-base last:border-none">
      <div class="flex items-start gap-3 min-w-0">
        <Icon name="mcp" class="size-5 shrink-0 icon-strong-base mt-0.5" />
        <div class="flex flex-col min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-14-medium text-text-strong truncate">{props.name}</span>
            <Tag>{label()}</Tag>
          </div>
          <Show when={error()}>
            <span class="text-12-regular text-text-weak truncate">{error()}</span>
          </Show>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <Show when={configurable()}>
          <Switch checked={status() === "connected"} disabled={props.disabled} onChange={props.onToggle} hideLabel>
            {props.name}
          </Switch>
        </Show>
        <IconButton
          icon="eye"
          variant="ghost"
          onClick={props.onView}
          aria-label={language.t("settings.management.action.view")}
        />
        <Show when={props.onEdit}>
          {(onEdit) => (
            <IconButton
              icon="edit"
              variant="ghost"
              onClick={onEdit()}
              aria-label={language.t("settings.management.action.edit")}
            />
          )}
        </Show>
        <Show when={props.onDelete}>
          {(onDelete) => (
            <IconButton
              icon="trash"
              variant="ghost"
              onClick={onDelete()}
              aria-label={language.t("settings.management.action.delete")}
            />
          )}
        </Show>
        <Show when={configurable()}>
          <IconButton
            icon="reset"
            variant="ghost"
            disabled={props.disabled}
            onClick={props.onToggle}
            aria-label={language.t("settings.management.action.retry")}
          />
        </Show>
      </div>
    </div>
  )
}
