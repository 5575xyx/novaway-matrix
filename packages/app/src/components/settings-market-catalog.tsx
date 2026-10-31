import { createMemo, createSignal, For, onMount, Show, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@novaway/ui/button"
import { Icon } from "@novaway/ui/icon"
import { Tag } from "@novaway/ui/tag"
import { showToast } from "@novaway/ui/toast"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { AppIcon } from "./app-icon"
import { SettingsGroup } from "./settings-parts"
import { updateAvailable, updateLabel, updateTitle, type InstalledPackage } from "./settings-market-model"
import { NOVAWAY_MARKETPLACE_ENTRIES } from "@/constants/novaway-marketplace"

type CatalogEntry = {
  name: string
  version?: string
  description?: string
  descriptionKey?: string
  url: string
  sha256?: string
  ref?: string
  subdir?: string
  kind: "zip" | "git"
}

type InstalledEntry = InstalledPackage

/** 后端 `extension.marketplaceCatalog` 附带的远端更新检查结果。 */
type UpdateEntry = {
  name: string
  state: "current" | "outdated" | "unknown"
  revision?: string
  available?: string
  error?: string
}

const text = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * 市场目录与安装。
 *
 * 下载、校验、解压、浅克隆都在内核里完成（`extension/marketplace.ts`），
 * 这里只负责展示和发起请求，因此 Web / TUI 构建同样可用，不再依赖桌面端 IPC。
 */
export const MarketCatalog: Component<{ directory: string; onInstalled?: () => void }> = (props) => {
  // 扩展页挂在 layout 层（应用级），这里没有 Session 的 SDKProvider，
  // 只能用全局 SDK + 显式目录参数。
  const sdk = useGlobalSDK()
  const language = useLanguage()
  const [store, setStore] = createStore({
    installed: [] as InstalledEntry[],
    zcode: [] as CatalogEntry[],
    claude: [] as CatalogEntry[],
    novaway: NOVAWAY_MARKETPLACE_ENTRIES.map((entry) => ({ ...entry })),
    updates: [] as UpdateEntry[],
    errors: [] as string[],
    loading: false,
    pending: "",
  })
  // 内置条目放前面：数量少、离线可用，是「我们建议装什么」的入口。
  // Claude 目录条目最多，紧随其后。
  const [tab, setTab] = createSignal<"novaway" | "zcode" | "claude">("novaway")

  const load = () => {
    setStore("loading", true)
    void sdk.client.extension
      .marketplaceCatalog({ directory: props.directory })
      .then((result) => {
        const data = result.data
        if (!data) return
        setStore({
          installed: data.installed as InstalledEntry[],
          zcode: (data.zcode as Omit<CatalogEntry, "kind">[]).map((entry) => ({ ...entry, kind: "zip" as const })),
          claude: (data.claude as Omit<CatalogEntry, "kind">[]).map((entry) => ({ ...entry, kind: "git" as const })),
          updates: (data.updates ?? []) as UpdateEntry[],
          errors: data.errors,
        })
      })
      .catch((error: unknown) => setStore("errors", [text(error)]))
      .finally(() => setStore("loading", false))
  }

  onMount(load)

  const installedNames = createMemo(() => new Set(store.installed.map((item) => item.name)))
  const entries = createMemo(() =>
    tab() === "zcode" ? store.zcode : tab() === "claude" ? store.claude : store.novaway,
  )
  const TABS = ["novaway", "claude", "zcode"] as const
  const countOf = (id: (typeof TABS)[number]) =>
    id === "zcode" ? store.zcode.length : id === "claude" ? store.claude.length : store.novaway.length
  const descriptionOf = (entry: CatalogEntry) =>
    entry.descriptionKey ? language.t(entry.descriptionKey as never) : entry.description
  // 官方仓库有新提交时（后端比对提交哈希 / 归档 ETag）在条目上标出来。
  const updateOf = (name: string) => store.updates.find((item) => item.name === name)
  const outdated = (name: string) => updateOf(name)?.state === "outdated"

  const install = (entry: CatalogEntry) => {
    setStore("pending", entry.name)
    void sdk.client.extension
      .marketplaceInstall({
        directory: props.directory,
        kind: entry.kind,
        name: entry.name,
        url: entry.url,
        version: entry.version,
        sha256: entry.sha256,
        ref: entry.ref,
        subdir: entry.subdir,
      })
      .then(() => {
        showToast({ title: language.t("settings.market.installed", { name: entry.name }) })
        load()
        props.onInstalled?.()
      })
      .catch((error: unknown) => showToast({ title: language.t("common.requestFailed"), description: text(error) }))
      .finally(() => setStore("pending", ""))
  }

  /** 升级 = 按安装记录重放一次安装（同 source/ref/subdir），装完仍是同一个目录。 */
  const update = (entry: InstalledEntry) => {
    setStore("pending", entry.name)
    void sdk.client.extension
      .marketplaceInstall({
        directory: props.directory,
        kind: entry.kind,
        name: entry.name,
        url: entry.source,
        version: entry.version,
        sha256: entry.sha256,
        ref: entry.ref,
        subdir: entry.subdir,
      })
      .then(() => {
        showToast({ title: language.t("settings.market.updated", { name: entry.name }) })
        load()
        props.onInstalled?.()
      })
      .catch((error: unknown) => showToast({ title: language.t("common.requestFailed"), description: text(error) }))
      .finally(() => setStore("pending", ""))
  }

  const uninstall = (entry: InstalledEntry) => {
    setStore("pending", entry.name)
    void sdk.client.extension
      .marketplaceUninstall({ directory: props.directory, name: entry.root.split(/[\/]/).pop() ?? entry.name })
      .then(() => {
        showToast({ title: language.t("settings.market.uninstalled", { name: entry.name }) })
        load()
        props.onInstalled?.()
      })
      .catch((error: unknown) => showToast({ title: language.t("common.requestFailed"), description: text(error) }))
      .finally(() => setStore("pending", ""))
  }

  return (
    <SettingsGroup>
      <div class="flex items-center gap-2 border-b border-border px-4 py-2">
        <div class="min-w-0 flex-1">
          <div class="text-13-medium text-foreground">{language.t("settings.market.title")}</div>
          <div class="mt-0.5 text-12-regular text-foreground-subtle">{language.t("settings.market.hint")}</div>
        </div>
        <Button variant="ghost" size="small" disabled={store.loading} onClick={load}>
          <Icon name="refresh" size="small" />
          {language.t("settings.market.refresh")}
        </Button>
      </div>

      <div class="flex items-center gap-1 border-b border-border px-4 py-1.5">
        <For each={TABS}>
          {(id) => (
            <button
              type="button"
              class="rounded-md px-2 py-1 text-ui-xs"
              classList={{
                "bg-hover text-foreground": tab() === id,
                "text-foreground-subtle hover:bg-hover": tab() !== id,
              }}
              onClick={() => setTab(id)}
            >
              {language.t(`settings.market.tab.${id}`, { count: countOf(id) })}
            </button>
          )}
        </For>
        <div class="flex-1" />
        <span class="text-ui-xs text-foreground-subtlest">
          {language.t("settings.market.installedCount", { count: store.installed.length })}
        </span>
      </div>

      <Show when={store.errors.length > 0}>
        <div class="border-b border-border px-4 py-1.5 text-ui-xs text-warning">{store.errors.join(" · ")}</div>
      </Show>

      <div class="flex max-h-[calc(100vh-280px)] flex-col gap-2 overflow-y-auto p-2">
        <For
          each={entries()}
          fallback={
            <div class="px-2 py-3 text-ui-xs text-foreground-subtle">{language.t("settings.market.empty")}</div>
          }
        >
          {(entry) => {
            const installed = () => installedNames().has(entry.name)
            const installedEntry = () => store.installed.find((item) => item.name === entry.name)
            return (
              <div
                data-component="market-entry"
                class="flex min-w-0 items-start gap-3 rounded-xl border border-border bg-panel px-3 py-2.5 transition-colors hover:border-border-hover hover:bg-hover/40"
              >
                <AppIcon seed={entry.name} fallback="mcp" class="mt-0.5" />
                <div class="min-w-0 flex-1">
                  <div class="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span class="min-w-0 truncate text-ui-base font-medium text-foreground">{entry.name}</span>
                    <Show when={entry.version}>
                      <Tag>{entry.version}</Tag>
                    </Show>
                    <Show when={installed()}>
                      <Tag>{language.t("settings.market.installedTag")}</Tag>
                    </Show>
                    <Show when={installed() && outdated(entry.name)}>
                      <Tag title={updateOf(entry.name)?.available}>{language.t("settings.market.updateNote")}</Tag>
                    </Show>
                    <Show when={installedEntry()}>
                      {(item) => (
                        <>
                          <Show when={updateLabel(item())}>
                            {(label) => <Tag title={updateTitle(item(), language.intl())}>{label()}</Tag>}
                          </Show>
                          <Show when={updateAvailable(item(), entry.version)}>
                            <Tag>{language.t("settings.market.updateAvailable", { version: entry.version ?? "" })}</Tag>
                          </Show>
                        </>
                      )}
                    </Show>
                  </div>
                  <Show when={descriptionOf(entry)}>
                    <div class="mt-0.5 line-clamp-2 text-ui-xs leading-5 text-foreground-subtle">
                      {descriptionOf(entry)}
                    </div>
                  </Show>
                </div>
                <div class="flex shrink-0 items-center gap-1">
                  <Show when={installed() && outdated(entry.name)}>
                    <Button
                      variant="secondary"
                      size="small"
                      disabled={store.pending === entry.name}
                      onClick={() => update(installedEntry()!)}
                    >
                      {language.t("settings.market.update")}
                    </Button>
                  </Show>
                  <Button
                    variant={installed() ? "ghost" : "secondary"}
                    size="small"
                    disabled={store.pending === entry.name}
                    onClick={() => (installed() ? uninstall(installedEntry()!) : install(entry))}
                  >
                    {installed() ? language.t("settings.market.remove") : language.t("settings.market.install")}
                  </Button>
                </div>
              </div>
            )
          }}
        </For>
      </div>
    </SettingsGroup>
  )
}
