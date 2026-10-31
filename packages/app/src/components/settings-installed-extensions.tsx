import { createEffect, createSignal, For, onMount, Show, type Component } from "solid-js"
import { Button } from "@novaway/ui/button"
import { Icon } from "@novaway/ui/icon"
import { Switch } from "@novaway/ui/switch"
import { Tag } from "@novaway/ui/tag"
import { showToast } from "@novaway/ui/toast"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { AppIcon } from "./app-icon"
import { SettingsGroup } from "./settings-parts"

type ExtensionIssue = {
  severity: "error" | "warning"
  code: string
  message: string
}

type ExtensionInfo = {
  name: string
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

  const load = () => {
    void sdk.client.extension
      .list({ directory: props.directory })
      .then((result) => setItems((result.data ?? []) as ExtensionInfo[]))
      .catch(() => setItems([]))
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
    <Show when={items().length > 0}>
      <SettingsGroup>
        <div class="flex items-center gap-2 border-b border-border px-4 py-2">
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
        <For each={items()}>
          {(item) => (
            <div class="flex min-w-0 items-start gap-3 rounded-lg px-3 py-2 hover:bg-hover">
              <AppIcon seed={item.name} fallback="mcp" size="sm" class="mt-0.5" />
              <div class="min-w-0 flex-1">
                <div class="flex min-w-0 items-center gap-2">
                  <span class="min-w-0 truncate text-ui-base text-foreground">{item.name}</span>
                  <Show when={item.version}>
                    <Tag>{item.version}</Tag>
                  </Show>
                  <Tag>{item.source}</Tag>
                  <Show when={item.status && item.status !== "unchanged"}>
                    <Tag>{language.t(`settings.extensions.status.${item.status}`)}</Tag>
                  </Show>
                </div>
                <Show when={item.description}>
                  <div class="mt-0.5 truncate text-ui-xs text-foreground-subtle">{item.description}</div>
                </Show>
                <Show when={item.error}>
                  <div class="mt-0.5 truncate text-ui-xs text-destructive">{item.error}</div>
                </Show>
                <For each={item.issues ?? []}>
                  {(issue) => (
                    <div
                      class="mt-0.5 truncate text-ui-xs"
                      classList={{
                        "text-destructive": issue.severity === "error",
                        "text-warning": issue.severity !== "error",
                      }}
                      title={issue.code}
                    >
                      {issue.message}
                    </div>
                  )}
                </For>
                <div class="mt-0.5 truncate font-mono text-ui-xs text-foreground-subtlest">{item.root}</div>
              </div>
              <Switch checked={item.enabled} onChange={(value: boolean) => toggle(item, value)} />
            </div>
          )}
        </For>
      </SettingsGroup>
    </Show>
  )
}
