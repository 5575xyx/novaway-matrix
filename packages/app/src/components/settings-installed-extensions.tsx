import { createEffect, createSignal, For, onMount, Show, type Component } from "solid-js"
import { Button } from "@novaway/ui/button"
import { Icon } from "@novaway/ui/icon"
import { Switch } from "@novaway/ui/switch"
import { Tag } from "@novaway/ui/tag"
import { showToast } from "@novaway/ui/toast"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { NOVAWAY_MARKETPLACE_ENTRIES, type BuiltinMarketEntry } from "@/constants/novaway-marketplace"
import { AppIcon } from "./app-icon"

type ExtensionIssue = {
  severity: "error" | "warning"
  code: string
  message: string
}

type ExtensionInfo = {
  name: string
  displayName?: string
  displayNameI18n?: Record<string, string>
  icon?: string
  version?: string
  description?: string
  root: string
  source: "builtin" | "user" | "project" | "claude" | "plugin" | "session"
  enabled: boolean
  error?: string
  issues?: ExtensionIssue[]
  status?: "added" | "removed" | "upgraded" | "downgraded" | "changed" | "unchanged"
}

const text = (err: unknown) => (err instanceof Error ? err.message : String(err))

function officialMetadataOf(name: string): BuiltinMarketEntry | undefined {
  return NOVAWAY_MARKETPLACE_ENTRIES.find(
    (entry) => name === entry.name || name.startsWith(`${entry.name}@`),
  )
}

function iconMirrorOf(url: string | undefined): string | undefined {
  if (!url) return undefined
  const match = url.match(/^https:\/\/gitee\.com\/([^/]+)\/([^/]+)\/raw\/([^/]+)\/(.+)$/)
  if (!match) return undefined
  return `https://cdn.jsdelivr.net/gh/${match[1]}/${match[2]}@${match[3]}/${match[4]}`
}

const InstalledExtensionIcon: Component<{ src?: string; seed: string }> = (props) => {
  const [attempt, setAttempt] = createSignal(0)
  const source = () => [props.src, iconMirrorOf(props.src)].filter((value): value is string => Boolean(value))[attempt()]
  return (
    <Show when={source()} fallback={<AppIcon seed={props.seed} fallback="mcp" size="sm" class="mt-0.5" />}>
      <img
        src={source()}
        alt=""
        class="size-10 shrink-0 rounded-xl object-cover"
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setAttempt((value) => value + 1)}
      />
    </Show>
  )
}

/**
 * Installed registry names intentionally include the package identity and version
 * (for example `com.novaway.agency-agents@1.0.0`). The marketplace owns the
 * user-facing label and icon, so both screens resolve official packages through
 * the same metadata instead of rendering the filesystem identity.
 */
function displayNameOf(item: ExtensionInfo, locale: string): string {
  const metadata = officialMetadataOf(item.name)
  const translations = item.displayNameI18n ?? {}
  const languageCode = locale.split("-")[0]
  return (
    translations[locale] ??
    translations[languageCode] ??
    item.displayName ??
    metadata?.displayNameI18n?.[locale] ??
    metadata?.displayNameI18n?.[languageCode] ??
    metadata?.displayName ??
    item.name.replace(/@[^@]+$/, "")
  )
}

function descriptionOf(item: ExtensionInfo): string | undefined {
  return item.description ?? officialMetadataOf(item.name)?.description
}

function iconOf(item: ExtensionInfo): string | undefined {
  return item.icon ?? officialMetadataOf(item.name)?.icon
}

/**
 * 内核扩展：直接读取 `plugin.json` / `.claude-plugin/plugin.json` 注册的
 * 命令、Agent、技能、Hook、MCP 与工具。开关只写启用状态，不删除文件。
 *
 * 与下方「扩展市场」区分：市场负责下载与安装，这里展示内核实际加载到的东西。
 */
export const InstalledExtensions: Component<{ directory: string; refreshKey?: number }> = (props) => {
  // 扩展页挂在 layout 层（应用级），没有 Session 的 SDKProvider。
  const sdk = useGlobalSDK()
  const language = useLanguage()
  const [items, setItems] = createSignal<ExtensionInfo[]>([])
  const [busy, setBusy] = createSignal(false)
  const [loading, setLoading] = createSignal(true)

  const load = () => {
    setLoading(true)
    void sdk.client.extension
      .list({ directory: props.directory })
      .then((result) => setItems((result.data ?? []) as ExtensionInfo[]))
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }

  onMount(load)
  // Re-read the installed list after a marketplace install/uninstall.
  createEffect(() => {
    props.refreshKey
    load()
  })

  const reload = () => {
    setBusy(true)
    void sdk.client.extension
      .reload({ directory: props.directory })
      .then((result) => {
        setItems((result.data ?? []) as ExtensionInfo[])
        showToast({ title: language.t("settings.extensions.reloaded") })
      })
      .catch((error: unknown) => showToast({ title: language.t("common.requestFailed"), description: text(error) }))
      .finally(() => setBusy(false))
  }

  const toggle = (item: ExtensionInfo, enabled: boolean) => {
    void sdk.client.extension
      .toggle({ directory: props.directory, name: item.name, enabled })
      .then(() => load())
      .catch((error: unknown) => showToast({ title: language.t("common.requestFailed"), description: text(error) }))
  }

  return (
    <Show
      when={!loading()}
      fallback={
        <div class="flex items-center gap-2 rounded-xl border border-border px-4 py-5 text-12-regular text-foreground-subtle">
          <Icon name="refresh" size="small" class="animate-spin text-icon-interactive-base" />
          正在加载扩展…
        </div>
      }
    >
      <Show when={items().length > 0}>
      <section>
        <div class="flex items-center gap-2 px-1 pb-4">
          <div class="min-w-0 flex-1">
            <div class="text-13-medium text-foreground">{language.t("settings.extensions.installed")}</div>
            <div class="mt-0.5 text-12-regular text-foreground-subtle">
              {language.t("settings.extensions.installedHint")}
            </div>
          </div>
          <Button variant="ghost" size="small" disabled={busy()} onClick={reload}>
            <Icon name="refresh" size="small" />
            {language.t("settings.extensions.reload")}
          </Button>
        </div>
        <div class="divide-y divide-border/60 rounded-2xl border border-border px-5">
          <For each={items()}>
            {(item) => {
              const displayName = displayNameOf(item, language.intl())
              return (
                <div class="flex min-w-0 items-center gap-4 py-5 transition-colors hover:bg-hover/30">
                  <InstalledExtensionIcon src={iconOf(item)} seed={displayName} />
                  <div class="min-w-0 flex-1">
                    <div class="flex min-w-0 items-center gap-2">
                      <span class="min-w-0 truncate text-ui-base text-foreground">{displayName}</span>
                      <Show when={item.version}>
                        <Tag>{item.version}</Tag>
                      </Show>
                      <Tag>{item.source}</Tag>
                      <Show when={item.status && item.status !== "unchanged"}>
                        <Tag>{language.t(`settings.extensions.status.${item.status}`)}</Tag>
                      </Show>
                    </div>
                    <Show when={descriptionOf(item)}>
                      <div class="mt-0.5 truncate text-ui-xs text-foreground-subtle">{descriptionOf(item)}</div>
                    </Show>
                    <Show when={item.error}>
                      <div class="mt-0.5 truncate text-ui-xs text-critical-base">{item.error}</div>
                    </Show>
                    <For each={item.issues ?? []}>
                      {(issue) => (
                        <div
                          class="mt-0.5 truncate text-ui-xs"
                          classList={{
                            "text-critical-base": issue.severity === "error",
                            "text-warning-base": issue.severity !== "error",
                          }}
                          title={issue.code}
                        >
                          {issue.message}
                        </div>
                      )}
                    </For>
                    <div class="mt-0.5 truncate font-mono text-ui-xs text-foreground-subtlest">{item.root}</div>
                  </div>
                  <Switch checked={item.enabled} onChange={(value: boolean) => toggle(item, value)} hideLabel>
                    {displayName}
                  </Switch>
                </div>
              )
            }}
          </For>
        </div>
      </section>
      </Show>
    </Show>
  )
}
