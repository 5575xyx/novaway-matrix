import { createMemo, createSignal, For, onCleanup, onMount, Show, type Component } from "solid-js"
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
  packageId?: string
  version?: string
  description?: string
  longDescription?: string
  author?: string
  license?: string
  categories?: string[]
  keywords?: string[]
  descriptionKey?: string
  url: string
  sha256?: string
  sourceId?: string
  dependencies?: Record<string, string>
  conflicts?: string[]
  ref?: string
  subdir?: string
  kind: "zip" | "git"
  repository?: string
  runtimeTargets?: string[]
  capabilities?: string[]
  permissions?: string[]
  releaseNotes?: string
  verifiedStatus?: "verified" | "community" | "unverified"
  compatibility?: {
    minNovaWayApi?: string
    maxNovaWayApi?: string
    manifestVersion?: number
    requiresRestart?: boolean
  }
}

type ServerNativeEntry = Omit<CatalogEntry, "kind"> & { kind?: CatalogEntry["kind"] }

type SourceClient = {
  add(input: {
    directory: string
    name: string
    type: MarketplaceSource["type"]
    url: string
  }): Promise<{ data?: unknown }>
  update(input: {
    directory: string
    sourceId: string
    name?: string
    type?: MarketplaceSource["type"]
    url?: string
    enabled?: boolean
  }): Promise<{ data?: unknown }>
  refresh(input: { directory: string; sourceId: string }): Promise<{ data?: unknown }>
  remove(input: { directory: string; sourceId: string }): Promise<{ data?: unknown }>
}

type MarketStore = {
  installed: InstalledEntry[]
  sources: MarketplaceSource[]
  legacy: LegacyEntry[]
  migrations: LegacyMigration[]
  zcode: CatalogEntry[]
  claude: CatalogEntry[]
  novaway: CatalogEntry[]
  updates: UpdateEntry[]
  operations: MarketplaceOperation[]
  errors: string[]
  loading: boolean
  pending: string
}

type InstalledEntry = InstalledPackage

type MarketplaceSource = {
  id: string
  name: string
  type: "novaway" | "claude" | "zcode" | "auto"
  url: string
  enabled: boolean
  trust: "official" | "unverified"
  builtin?: boolean
  lastRefreshAt?: number
  lastError?: string
}

/** 后端 `extension.marketplaceCatalog` 附带的远端更新检查结果。 */
type UpdateEntry = {
  name: string
  state: "current" | "outdated" | "unknown"
  revision?: string
  available?: string
  error?: string
}

type LegacyEntry = {
  name: string
  version?: string
  root: string
  runtime: "legacy"
  source: "legacy-extension"
  preserved: true
  conflict?: "marketplace-id"
}

type LegacyMigration = {
  migrationId: string
  name: string
  version?: string
  legacyRoot: string
  managedRoot: string
  backupRoot: string
  migratedAt: number
  state: "migrated" | "rolledback"
  operationId?: string
}

type MarketplaceOperation = {
  operationId: string
  operationType: "install" | "update" | "rollback" | "enable" | "disable" | "uninstall" | "migrate"
  packageId: string
  version?: string
  phase:
    | "queued"
    | "downloading"
    | "staging"
    | "validating"
    | "replacing"
    | "activating"
    | "draining"
    | "cleanup-pending"
    | "completed"
    | "failed"
  installationStatus: "absent" | "staging" | "validating" | "installed" | "updating" | "uninstalling" | "failed"
  activationStatus:
    | "disabled"
    | "activating"
    | "active"
    | "draining"
    | "deactivating"
    | "disabled-pending-restart"
    | "failed"
    | "cleanup-pending"
  consumerStatus: "undiscovered" | "discovered" | "registered" | "partially-registered" | "usable" | "unavailable"
  cleanupStatus: "not-required" | "pending" | "completed" | "failed"
  disposeStatus: "not-required" | "pending" | "completed" | "failed"
  requiresRestart: boolean
  progress: number
  startedAt: number
  finishedAt?: number
  errorCode?: string
  recoveryHint?: string
}

type UpdatePreview = {
  currentVersion?: string
  targetVersion?: string
  sourceChanged: boolean
  currentSourceId?: string
  targetSourceId?: string
  sourceUrlChanged: boolean
  permissionsAdded: string[]
  permissionsRemoved: string[]
  dependenciesAdded: Record<string, string>
  dependenciesRemoved: string[]
  conflictsAdded: string[]
  conflictsRemoved: string[]
  digestChanged: boolean
  requiresConfirmation: boolean
}

type InstallRequest = {
  directory: string
  kind: "zip" | "git"
  name: string
  url: string
  version?: string
  sha256?: string
  sourceId?: string
  permissions?: string[]
  dependencies?: Record<string, string>
  conflicts?: string[]
  ref?: string
  subdir?: string
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
  const sourceClient = () => (sdk.client.extension as unknown as { marketplaceSource: SourceClient }).marketplaceSource
  const legacyClient = () =>
    sdk.client.extension as unknown as {
      marketplaceLegacyMigrations(input: { directory: string }): Promise<{ data?: unknown }>
      marketplaceLegacyMigrate(input: { directory: string; name: string }): Promise<{ data?: unknown }>
      marketplaceLegacyRollback(input: { directory: string; migrationId: string }): Promise<{ data?: unknown }>
    }
  const installRequest = (input: InstallRequest) =>
    (sdk.client.extension.marketplaceInstall as unknown as (value: InstallRequest) => Promise<unknown>)(input)
  const previewRequest = (input: { directory: string; name: string }) =>
    (
      sdk.client.extension as unknown as {
        marketplaceUpdatePreview: (value: { directory: string; name: string }) => Promise<{ data?: unknown }>
      }
    ).marketplaceUpdatePreview(input)
  const operationsRequest = (input: { directory: string }) =>
    (
      sdk.client.extension as unknown as {
        marketplaceOperations: (value: { directory: string }) => Promise<{ data?: unknown }>
      }
    ).marketplaceOperations(input)
  const language = useLanguage()
  const [store, setStore] = createStore<MarketStore>({
    installed: [] as InstalledEntry[],
    sources: [] as MarketplaceSource[],
    legacy: [] as LegacyEntry[],
    migrations: [] as LegacyMigration[],
    zcode: [] as CatalogEntry[],
    claude: [] as CatalogEntry[],
    novaway: NOVAWAY_MARKETPLACE_ENTRIES.map((entry) => ({ ...entry })),
    updates: [] as UpdateEntry[],
    operations: [] as MarketplaceOperation[],
    errors: [] as string[],
    loading: false,
    pending: "",
  })
  // 内置条目放前面：数量少、离线可用，是「我们建议装什么」的入口。
  // Claude 目录条目最多，紧随其后。
  const [tab, setTab] = createSignal<"novaway" | "zcode" | "claude">("novaway")
  const [sourceName, setSourceName] = createSignal("")
  const [sourceUrl, setSourceUrl] = createSignal("")
  const [sourceType, setSourceType] = createSignal<MarketplaceSource["type"]>("auto")
  const [editingSource, setEditingSource] = createSignal<string>()
  const [sourceBusy, setSourceBusy] = createSignal("")
  const [search, setSearch] = createSignal("")
  const [category, setCategory] = createSignal("all")
  const [sourceFilter, setSourceFilter] = createSignal("all")
  const [sort, setSort] = createSignal<"featured" | "name" | "updated">("featured")
  const [details, setDetails] = createSignal<string>()

  const loadOperations = () =>
    operationsRequest({ directory: props.directory })
      .then((result) => {
        const operations = (result.data as MarketplaceOperation[] | undefined) ?? []
        setStore("operations", operations)
        return operations
      })
      .catch(() => [] as MarketplaceOperation[])

  const activeOperations = createMemo(() =>
    store.operations.filter((operation) => operation.phase !== "completed" && operation.phase !== "failed"),
  )

  const load = () => {
    void loadOperations()
    setStore("loading", true)
    void sdk.client.extension
      .marketplaceCatalog({ directory: props.directory })
      .then(async (result) => {
        const data = result.data
        if (!data) return
        const official = ((data as unknown as { novaway?: ServerNativeEntry[] }).novaway ?? []).map((entry) => ({
          ...entry,
          sourceId: entry.sourceId ?? "novaway-official",
          kind: entry.kind ?? (entry.runtimeTargets?.includes("legacy-extension") ? "git" : "zip"),
        }))
        const fallback: CatalogEntry[] = NOVAWAY_MARKETPLACE_ENTRIES.map((entry) => ({
          name: entry.name,
          version: entry.version,
          description: entry.description,
          descriptionKey: entry.descriptionKey,
          url: entry.url,
          sourceId: "novaway-official",
          ref: entry.ref,
          subdir: entry.subdir,
          kind: entry.kind,
          keywords: entry.keywords,
        }))
        const merged = new Map<string, CatalogEntry>()
        for (const entry of [...fallback, ...official]) {
          merged.set(entry.packageId ?? entry.name, entry)
        }
        const migrations = await legacyClient()
          .marketplaceLegacyMigrations({ directory: props.directory })
          .then((response) => (response.data as LegacyMigration[] | undefined) ?? [])
          .catch(() => [])
        setStore({
          installed: data.installed as InstalledEntry[],
          legacy: ((data as unknown as { legacy?: LegacyEntry[] }).legacy ?? []) as LegacyEntry[],
          migrations,
          sources: ((data as unknown as { sources?: MarketplaceSource[] }).sources ?? []) as MarketplaceSource[],
          novaway: [...merged.values()],
          zcode: (data.zcode as Omit<CatalogEntry, "kind">[]).map((entry) => ({ ...entry, kind: "zip" as const })),
          claude: (data.claude as Omit<CatalogEntry, "kind">[]).map((entry) => ({ ...entry, kind: "git" as const })),
          updates: (data.updates ?? []) as UpdateEntry[],
          errors: data.errors,
        })
      })
      .catch((error: unknown) => setStore("errors", [text(error)]))
      .finally(() => setStore("loading", false))
  }

  onMount(() => {
    load()
    const timer = setInterval(() => {
      if (activeOperations().length > 0) void loadOperations()
    }, 800)
    onCleanup(() => clearInterval(timer))
  })

  const saveSource = () => {
    const name = sourceName().trim()
    const url = sourceUrl().trim()
    const editing = editingSource()
    if (!name || !url) {
      showToast({ title: language.t("settings.market.source.invalid") })
      return
    }
    setSourceBusy(editing ?? "new")
    const request = editing
      ? sourceClient().update({
          directory: props.directory,
          sourceId: editing,
          name,
          type: sourceType(),
          url,
        })
      : sourceClient().add({
          directory: props.directory,
          name,
          type: sourceType(),
          url,
        })
    void request
      .then((result) => {
        if (!result.data) throw new Error(language.t("settings.market.source.failed"))
        setSourceName("")
        setSourceUrl("")
        setSourceType("auto")
        setEditingSource(undefined)
        load()
        showToast({
          title: editing ? language.t("settings.market.source.updated") : language.t("settings.market.source.added"),
        })
      })
      .catch((error: unknown) => showToast({ title: language.t("common.requestFailed"), description: text(error) }))
      .finally(() => setSourceBusy(""))
  }

  const editSource = (source: MarketplaceSource) => {
    setEditingSource(source.id)
    setSourceName(source.name)
    setSourceUrl(source.url)
    setSourceType(source.type)
  }

  const cancelSourceEdit = () => {
    setEditingSource(undefined)
    setSourceName("")
    setSourceUrl("")
    setSourceType("auto")
  }

  const toggleSource = (source: MarketplaceSource) => {
    setSourceBusy(source.id)
    void sourceClient()
      .update({ directory: props.directory, sourceId: source.id, enabled: !source.enabled })
      .then((result) => {
        if (!result.data) throw new Error(language.t("settings.market.source.failed"))
        load()
      })
      .catch((error: unknown) => showToast({ title: language.t("common.requestFailed"), description: text(error) }))
      .finally(() => setSourceBusy(""))
  }

  const refreshSource = (source: MarketplaceSource) => {
    setSourceBusy(source.id)
    void sourceClient()
      .refresh({ directory: props.directory, sourceId: source.id })
      .then((result) => {
        if (!result.data) throw new Error(language.t("settings.market.source.failed"))
        load()
      })
      .catch((error: unknown) => {
        void load()
        showToast({ title: language.t("common.requestFailed"), description: text(error) })
      })
      .finally(() => setSourceBusy(""))
  }

  const removeSource = (source: MarketplaceSource) => {
    if (source.builtin) return
    setSourceBusy(source.id)
    void sourceClient()
      .remove({ directory: props.directory, sourceId: source.id })
      .then((result) => {
        if (!result.data) throw new Error(language.t("settings.market.source.failed"))
        load()
      })
      .catch((error: unknown) => showToast({ title: language.t("common.requestFailed"), description: text(error) }))
      .finally(() => setSourceBusy(""))
  }

  const migrateLegacy = (entry: LegacyEntry) => {
    setStore("pending", `legacy:${entry.name}`)
    void legacyClient()
      .marketplaceLegacyMigrate({ directory: props.directory, name: entry.name })
      .then((result) => {
        if (!result.data) throw new Error(language.t("settings.market.legacy.failed"))
        showToast({ title: language.t("settings.market.legacy.migrated", { name: entry.name }) })
        load()
      })
      .catch((error: unknown) => showToast({ title: language.t("common.requestFailed"), description: text(error) }))
      .finally(() => setStore("pending", ""))
  }

  const rollbackLegacy = (migration: LegacyMigration) => {
    setStore("pending", `legacy:${migration.migrationId}`)
    void legacyClient()
      .marketplaceLegacyRollback({ directory: props.directory, migrationId: migration.migrationId })
      .then((result) => {
        if (!result.data) throw new Error(language.t("settings.market.legacy.failed"))
        showToast({ title: language.t("settings.market.legacy.rolledBack", { name: migration.name }) })
        load()
      })
      .catch((error: unknown) => showToast({ title: language.t("common.requestFailed"), description: text(error) }))
      .finally(() => setStore("pending", ""))
  }

  const installedNames = createMemo(() => new Set(store.installed.map((item) => item.name)))
  const entryIdentity = (entry: CatalogEntry) => entry.packageId ?? entry.name
  const entries = createMemo(() =>
    tab() === "zcode" ? store.zcode : tab() === "claude" ? store.claude : store.novaway,
  )
  const categories = createMemo(() => ["all", ...new Set(entries().flatMap((entry) => entry.categories ?? []))])
  const sourceOptions = createMemo(() => [
    "all",
    ...new Set(
      entries()
        .map((entry) => entry.sourceId)
        .filter((value): value is string => Boolean(value)),
    ),
  ])
  // Keep these helpers above visibleEntries: createMemo may evaluate immediately,
  // so sorting must not close over a const that is still in its TDZ.
  const updateOf = (entry: CatalogEntry) => store.updates.find((item) => item.name === entryIdentity(entry))
  const outdated = (entry: CatalogEntry) => updateOf(entry)?.state === "outdated"
  const visibleEntries = createMemo(() => {
    const needle = search().trim().toLocaleLowerCase()
    const selectedCategory = category()
    const selectedSource = sourceFilter()
    const filtered = entries().filter((entry) => {
      const haystack = [
        entry.name,
        entry.packageId,
        entry.description,
        entry.longDescription,
        ...(entry.keywords ?? []),
        ...(entry.categories ?? []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase()
      return (
        (!needle || haystack.includes(needle)) &&
        (selectedCategory === "all" || entry.categories?.includes(selectedCategory)) &&
        (selectedSource === "all" || entry.sourceId === selectedSource)
      )
    })
    return [...filtered].sort((left, right) => {
      if (sort() === "name") return left.name.localeCompare(right.name)
      if (sort() === "updated") return Number(outdated(right)) - Number(outdated(left))
      return Number(outdated(right)) - Number(outdated(left)) || left.name.localeCompare(right.name)
    })
  })
  const TABS = ["novaway", "claude", "zcode"] as const
  const countOf = (id: (typeof TABS)[number]) =>
    id === "zcode" ? store.zcode.length : id === "claude" ? store.claude.length : store.novaway.length
  const descriptionOf = (entry: CatalogEntry) =>
    entry.descriptionKey ? language.t(entry.descriptionKey as never) : entry.description
  const sourceOf = (entry: CatalogEntry) => store.sources.find((source) => source.id === entry.sourceId)
  const sourceNameOf = (entry: CatalogEntry) =>
    sourceOf(entry)?.name ?? entry.sourceId ?? language.t("settings.market.source.unknown")
  const trustOf = (entry: CatalogEntry): NonNullable<CatalogEntry["verifiedStatus"]> =>
    entry.verifiedStatus ??
    (sourceOf(entry)?.trust === "official" || entry.sourceId === "novaway-official" ? "verified" : "community")
  const trustLabel = (entry: CatalogEntry) => language.t(`settings.market.trust.${trustOf(entry)}` as never)
  const trustClass = (entry: CatalogEntry) =>
    trustOf(entry) === "verified"
      ? "border-success-base/30 bg-success-base/10 text-success-base"
      : trustOf(entry) === "community"
        ? "border-accent-base/30 bg-accent-base/10 text-accent-base"
        : "border-warning-base/30 bg-warning-base/10 text-warning-base"
  // 官方仓库有新提交时（后端比对提交哈希 / 归档 ETag）在条目上标出来。

  const install = (entry: CatalogEntry) => {
    const identity = entryIdentity(entry)
    setStore("pending", identity)
    void installRequest({
      directory: props.directory,
      kind: entry.kind,
      name: entryIdentity(entry),
      url: entry.url,
      version: entry.version,
      sha256: entry.sha256,
      sourceId: entry.sourceId,
      permissions: entry.permissions,
      dependencies: entry.dependencies,
      conflicts: entry.conflicts,
      ref: entry.ref,
      subdir: entry.subdir,
    })
      .then(() => {
        showToast({ title: language.t("settings.market.installed", { name: entry.name }) })
        load()
        props.onInstalled?.()
      })
      .catch((error: unknown) => {
        void load()
        showToast({ title: language.t("common.requestFailed"), description: text(error) })
      })
      .finally(() => setStore("pending", ""))
  }

  const update = (entry: InstalledEntry, target: CatalogEntry) => {
    setStore("pending", entry.name)
    void (async () => {
      const previewResult = await previewRequest({
        directory: props.directory,
        name: entry.name,
      })
      const preview = previewResult.data as UpdatePreview | undefined
      if (!preview) throw new Error(language.t("settings.market.preview.failed"))
      if (preview.requiresConfirmation) {
        const changes = [
          preview.sourceChanged
            ? `source: ${preview.currentSourceId ?? preview.currentVersion ?? "current"} → ${preview.targetSourceId ?? preview.targetVersion ?? "target"}`
            : "",
          preview.permissionsAdded.length ? `permissions added: ${preview.permissionsAdded.join(", ")}` : "",
          preview.permissionsRemoved.length ? `permissions removed: ${preview.permissionsRemoved.join(", ")}` : "",
          Object.keys(preview.dependenciesAdded).length
            ? `dependencies changed: ${Object.keys(preview.dependenciesAdded).join(", ")}`
            : "",
          preview.dependenciesRemoved.length ? `dependencies removed: ${preview.dependenciesRemoved.join(", ")}` : "",
          preview.conflictsAdded.length ? `conflicts added: ${preview.conflictsAdded.join(", ")}` : "",
          preview.digestChanged ? "artifact digest changed" : "",
        ].filter(Boolean)
        if (!window.confirm([language.t("settings.market.preview.confirm"), ...changes].join("\n"))) return
      }
      await installRequest({
        directory: props.directory,
        kind: target.kind,
        name: entryIdentity(target),
        url: target.url,
        version: target.version,
        sha256: target.sha256,
        sourceId: target.sourceId,
        permissions: target.permissions,
        dependencies: target.dependencies,
        conflicts: target.conflicts,
        ref: target.ref,
        subdir: target.subdir,
      })
      showToast({ title: language.t("settings.market.updated", { name: entry.name }) })
      load()
      props.onInstalled?.()
    })()
      .catch((error: unknown) => {
        void load()
        showToast({ title: language.t("common.requestFailed"), description: text(error) })
      })
      .finally(() => setStore("pending", ""))
  }

  const uninstall = (entry: InstalledEntry) => {
    setStore("pending", entry.name)
    void sdk.client.extension
      .marketplaceUninstall({ directory: props.directory, name: entry.root.split(/[/\\]/).pop() ?? entry.name })
      .then(() => {
        showToast({ title: language.t("settings.market.uninstalled", { name: entry.name }) })
        load()
        props.onInstalled?.()
      })
      .catch((error: unknown) => {
        void load()
        showToast({ title: language.t("common.requestFailed"), description: text(error) })
      })
      .finally(() => setStore("pending", ""))
  }

  const rollback = (entry: InstalledEntry) => {
    setStore("pending", entry.name)
    void sdk.client.extension
      .marketplaceRollback({ directory: props.directory, name: entry.name })
      .then(() => {
        showToast({ title: language.t("settings.market.rolledBack", { name: entry.name }) })
        load()
        props.onInstalled?.()
      })
      .catch((error: unknown) => {
        void load()
        showToast({ title: language.t("common.requestFailed"), description: text(error) })
      })
      .finally(() => setStore("pending", ""))
  }

  return (
    <SettingsGroup>
      <div
        data-component="marketplace-hero"
        class="flex items-start gap-3 border-b border-border bg-gradient-to-br from-panel to-background px-4 py-4"
      >
        <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent-base">
          <Icon name="archive" size="medium" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <div class="text-15-medium text-foreground">{language.t("settings.market.title")}</div>
          </div>
          <div class="mt-1 max-w-2xl text-12-regular text-foreground-subtle">{language.t("settings.market.hint")}</div>
          <div class="mt-2 flex flex-wrap gap-1.5 text-11-regular text-foreground-subtlest">
            <span>{entries().length} packages</span>
            <span>·</span>
            <span>{store.sources.filter((source) => source.enabled).length} active sources</span>
            <Show when={store.updates.some((update) => update.state === "outdated")}>
              <span>·</span>
              <span class="text-warning-base">
                {store.updates.filter((update) => update.state === "outdated").length} updates
              </span>
            </Show>
          </div>
        </div>
        <Button
          variant="ghost"
          size="small"
          disabled={store.loading}
          onClick={load}
          title={language.t("settings.market.refresh")}
        >
          <Icon name="refresh" size="small" />
          <span class="hidden sm:inline">{language.t("settings.market.refresh")}</span>
        </Button>
      </div>

      <div class="border-b border-border px-4 py-3">
        <div class="mb-2 flex items-center justify-between gap-2">
          <div>
            <div class="text-13-medium text-foreground">{language.t("settings.market.sources")}</div>
            <div class="mt-0.5 text-12-regular text-foreground-subtle">{language.t("settings.market.sourcesHint")}</div>
          </div>
          <Show when={editingSource()}>
            <Button variant="ghost" size="small" onClick={cancelSourceEdit}>
              {language.t("common.cancel")}
            </Button>
          </Show>
        </div>
        <div class="mb-3 flex flex-col gap-2 sm:flex-row">
          <input
            class="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-ui-xs text-foreground outline-none focus:border-border-focus"
            value={sourceName()}
            onInput={(event) => setSourceName(event.currentTarget.value)}
            placeholder={language.t("settings.market.source.name")}
            aria-label={language.t("settings.market.source.name")}
            disabled={sourceBusy() !== ""}
          />
          <select
            class="rounded-md border border-border bg-background px-2.5 py-1.5 text-ui-xs text-foreground outline-none focus:border-border-focus"
            value={sourceType()}
            onChange={(event) => setSourceType(event.currentTarget.value as MarketplaceSource["type"])}
            aria-label={language.t("settings.market.source.type")}
            disabled={sourceBusy() !== ""}
          >
            <option value="auto">auto</option>
            <option value="novaway">NovaWay</option>
            <option value="claude">Claude</option>
            <option value="zcode">ZCode</option>
          </select>
          <input
            class="min-w-0 flex-[2] rounded-md border border-border bg-background px-2.5 py-1.5 text-ui-xs text-foreground outline-none focus:border-border-focus"
            value={sourceUrl()}
            onInput={(event) => setSourceUrl(event.currentTarget.value)}
            placeholder="https://example.com/catalog.json"
            aria-label="URL"
            spellcheck={false}
            autocapitalize="off"
            autocomplete="off"
            disabled={sourceBusy() !== ""}
          />
          <Button size="small" disabled={sourceBusy() !== ""} onClick={saveSource}>
            {editingSource() ? language.t("settings.market.source.save") : language.t("settings.market.source.add")}
          </Button>
        </div>
        <div class="flex flex-col gap-1.5">
          <For each={store.sources}>
            {(source) => (
              <div
                data-source-id={source.id}
                class="flex flex-col gap-1 rounded-md border border-border/70 px-2.5 py-2 sm:flex-row sm:items-center"
              >
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-1.5">
                    <span class="truncate text-ui-xs font-medium text-foreground">{source.name}</span>
                    <Tag>
                      {source.trust === "official"
                        ? language.t("settings.market.source.official")
                        : language.t("settings.market.source.custom")}
                    </Tag>
                    <Tag>{source.type}</Tag>
                    <Show when={!source.enabled}>
                      <Tag>{language.t("settings.market.source.disabled")}</Tag>
                    </Show>
                  </div>
                  <div class="truncate text-11-regular text-foreground-subtlest">{source.url}</div>
                  <Show when={source.lastError}>
                    <div class="truncate text-11-regular text-warning-base">{source.lastError}</div>
                  </Show>
                </div>
                <div class="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="small"
                    disabled={sourceBusy() !== ""}
                    onClick={() => toggleSource(source)}
                  >
                    {source.enabled
                      ? language.t("settings.market.source.disable")
                      : language.t("settings.market.source.enable")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="small"
                    disabled={sourceBusy() !== ""}
                    onClick={() => refreshSource(source)}
                  >
                    {language.t("settings.market.source.refresh")}
                  </Button>
                  <Show when={!source.builtin}>
                    <Button
                      variant="ghost"
                      size="small"
                      disabled={sourceBusy() !== ""}
                      onClick={() => editSource(source)}
                    >
                      {language.t("settings.market.source.edit")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="small"
                      disabled={sourceBusy() !== ""}
                      onClick={() => {
                        if (window.confirm(language.t("settings.market.source.removeConfirm", { name: source.name }))) {
                          removeSource(source)
                        }
                      }}
                    >
                      {language.t("settings.market.source.remove")}
                    </Button>
                  </Show>
                </div>
              </div>
            )}
          </For>
        </div>
      </div>

      <Show when={store.legacy.length > 0 || store.migrations.length > 0}>
        <div class="border-b border-border px-4 py-3">
          <div class="mb-2 text-13-medium text-foreground">{language.t("settings.market.legacy.title")}</div>
          <div class="mb-2 text-12-regular text-foreground-subtle">{language.t("settings.market.legacy.hint")}</div>
          <div class="flex flex-col gap-1.5">
            <For each={store.legacy}>
              {(entry) => (
                <div class="flex items-center gap-2 rounded-md border border-border/70 px-2.5 py-2">
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-ui-xs font-medium text-foreground">{entry.name}</div>
                    <div class="truncate text-11-regular text-foreground-subtlest">
                      {entry.version ?? "legacy"} · {entry.root}
                    </div>
                  </div>
                  <Tag>legacy</Tag>
                  <Button
                    variant="secondary"
                    size="small"
                    disabled={store.pending !== ""}
                    onClick={() => migrateLegacy(entry)}
                  >
                    {language.t("settings.market.legacy.migrate")}
                  </Button>
                </div>
              )}
            </For>
            <For each={store.migrations}>
              {(migration) => (
                <div class="flex items-center gap-2 rounded-md border border-border/70 px-2.5 py-2">
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-ui-xs font-medium text-foreground">{migration.name}</div>
                    <div class="truncate text-11-regular text-foreground-subtlest">
                      {language.t("settings.market.legacy.migratedState")} · {migration.managedRoot}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="small"
                    disabled={store.pending !== ""}
                    onClick={() => rollbackLegacy(migration)}
                  >
                    {language.t("settings.market.legacy.rollback")}
                  </Button>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>

      <Show when={store.errors.length > 0}>
        <div class="border-b border-border px-4 py-2" data-component="market-catalog-errors">
          <For each={store.errors}>{(error) => <div class="text-11-regular text-warning-base">{error}</div>}</For>
        </div>
      </Show>

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

      <div
        data-component="marketplace-filters"
        class="flex flex-col gap-2 border-b border-border bg-background px-4 py-3 sm:flex-row"
      >
        <div class="relative min-w-0 flex-1">
          <input
            class="w-full rounded-lg border border-border bg-panel px-3 py-2 text-ui-xs text-foreground outline-none transition-colors placeholder:text-foreground-subtlest focus:border-border-focus"
            value={search()}
            onInput={(event) => setSearch(event.currentTarget.value)}
            placeholder={language.t("settings.market.search")}
            aria-label={language.t("settings.market.search")}
            spellcheck={false}
          />
        </div>
        <select
          class="rounded-lg border border-border bg-panel px-3 py-2 text-ui-xs text-foreground outline-none focus:border-border-focus"
          value={category()}
          onChange={(event) => setCategory(event.currentTarget.value)}
          aria-label={language.t("settings.market.category")}
        >
          <For each={categories()}>
            {(value) => (
              <option value={value}>{value === "all" ? language.t("settings.market.categoryAll") : value}</option>
            )}
          </For>
        </select>
        <select
          class="rounded-lg border border-border bg-panel px-3 py-2 text-ui-xs text-foreground outline-none focus:border-border-focus"
          value={sourceFilter()}
          onChange={(event) => setSourceFilter(event.currentTarget.value)}
          aria-label={language.t("settings.market.source.filter")}
        >
          <option value="all">{language.t("settings.market.source.all")}</option>
          <For each={sourceOptions().slice(1)}>
            {(value) => (
              <option value={value}>
                {language.t("settings.market.source.filterOption", {
                  name: store.sources.find((source) => source.id === value)?.name ?? value,
                })}
              </option>
            )}
          </For>
        </select>
        <select
          class="rounded-lg border border-border bg-panel px-3 py-2 text-ui-xs text-foreground outline-none focus:border-border-focus"
          value={sort()}
          onChange={(event) => setSort(event.currentTarget.value as "featured" | "name" | "updated")}
          aria-label={language.t("settings.market.sort")}
        >
          <option value="featured">{language.t("settings.market.sortFeatured")}</option>
          <option value="updated">{language.t("settings.market.sortUpdated")}</option>
          <option value="name">{language.t("settings.market.sortName")}</option>
        </select>
      </div>

      <Show when={store.operations.length > 0}>
        <div class="border-b border-border px-4 py-2" data-component="market-operation-history">
          <div class="mb-1 text-12-medium text-foreground">Marketplace operations</div>
          <div class="flex flex-col gap-1.5">
            <For each={store.operations.slice(-5).reverse()}>
              {(operation) => (
                <div
                  class="rounded-md border border-border/70 px-2.5 py-2 text-11-regular"
                  data-operation-id={operation.operationId}
                  data-operation-phase={operation.phase}
                >
                  <div class="flex items-center gap-2">
                    <span class="font-medium text-foreground">{operation.operationType}</span>
                    <span class="text-foreground-subtle">{operation.packageId}</span>
                    <Tag>{operation.phase}</Tag>
                    <span class="ml-auto text-foreground-subtlest">{operation.progress}%</span>
                  </div>
                  <div class="mt-1 text-foreground-subtlest">
                    install={operation.installationStatus} · activation={operation.activationStatus} · consumer=
                    {operation.consumerStatus} · cleanup={operation.cleanupStatus} · dispose={operation.disposeStatus}
                    {operation.requiresRestart ? " · restart required" : ""}
                  </div>
                  <Show when={operation.errorCode || operation.recoveryHint}>
                    <div class="mt-1 text-warning-base">
                      {operation.errorCode ?? "failed"}
                      {operation.recoveryHint ? ` · ${operation.recoveryHint}` : ""}
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>

      <div
        class="grid max-h-[calc(100vh-280px)] grid-cols-1 gap-3 overflow-y-auto bg-background/40 p-3 sm:grid-cols-2 xl:grid-cols-3"
        data-component="marketplace-results"
      >
        <For
          each={visibleEntries()}
          fallback={
            <div class="col-span-full rounded-xl border border-dashed border-border px-3 py-8 text-center text-ui-xs text-foreground-subtle">
              {language.t("settings.market.empty")}
            </div>
          }
        >
          {(entry) => {
            const identity = entryIdentity(entry)
            const installed = () => installedNames().has(identity)
            const installedEntry = () => store.installed.find((item) => item.name === identity)
            return (
              <article
                data-component="market-entry"
                data-market-source={entry.sourceId ?? "unknown"}
                data-market-trust={trustOf(entry)}
                class="group flex min-w-0 flex-col rounded-xl border border-border bg-panel p-3 transition-all hover:-translate-y-px hover:border-border-hover hover:bg-hover/40 hover:shadow-sm"
              >
                <div class="flex min-w-0 items-start gap-2.5">
                  <AppIcon seed={entry.name} fallback="mcp" class="shrink-0" />
                  <div class="min-w-0 flex-1">
                    <div class="flex min-w-0 items-start justify-between gap-2">
                      <div class="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span class="min-w-0 break-words text-ui-base font-medium text-foreground">{entry.name}</span>
                        <Show when={entry.version}>
                          <Tag>{entry.version}</Tag>
                        </Show>
                      </div>
                      <Show when={trustOf(entry) === "verified"}>
                        <span class="shrink-0 text-success-base" title={trustLabel(entry)} aria-label={trustLabel(entry)}>
                          <Icon name="shield" size="small" />
                        </span>
                      </Show>
                    </div>
                    <div class="mt-1 flex min-w-0 items-center gap-1 text-11-regular text-foreground-subtlest">
                      <span class="truncate" title={sourceNameOf(entry)}>
                        {language.t("settings.market.source.filterOption", { name: sourceNameOf(entry) })}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span class={`shrink-0 rounded-full border px-1.5 py-0.5 ${trustClass(entry)}`}>
                        {trustLabel(entry)}
                      </span>
                    </div>
                  </div>
                </div>

                <div class="mt-3 flex min-h-[2.5rem] flex-col gap-1.5">
                  <Show when={descriptionOf(entry)}>
                    <div class="line-clamp-2 text-ui-xs leading-5 text-foreground-subtle">{descriptionOf(entry)}</div>
                  </Show>
                  <Show when={entry.categories?.length}>
                    <div class="flex flex-wrap gap-1">
                      <For each={entry.categories?.slice(0, 3)}>{(item) => <Tag>{item}</Tag>}</For>
                    </div>
                  </Show>
                </div>

                <Show when={installed()}>
                  <div class="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border/70 pt-2">
                    <Tag>{language.t("settings.market.installedTag")}</Tag>
                    <Show when={outdated(entry)}>
                      <Tag title={updateOf(entry)?.available}>{language.t("settings.market.updateNote")}</Tag>
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
                </Show>

                <Show when={details() === identity}>
                  <div
                    class="mt-3 break-words rounded-lg border border-border/70 bg-background/60 px-2.5 py-2 text-11-regular text-foreground-subtle"
                    data-component="market-entry-details"
                  >
                    <Show when={entry.longDescription} fallback={descriptionOf(entry)}>
                      <div>{entry.longDescription}</div>
                    </Show>
                    <div class="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                      <Show when={entry.author}>
                        <span>author={entry.author}</span>
                      </Show>
                      <Show when={entry.license}>
                        <span>license={entry.license}</span>
                      </Show>
                      <Show when={entry.categories?.length}>
                        <span>category={entry.categories?.join(", ")}</span>
                      </Show>
                      <Show when={entry.runtimeTargets?.length}>
                        <span>runtime={entry.runtimeTargets?.join(", ")}</span>
                      </Show>
                    </div>
                    <Show when={entry.capabilities?.length}>
                      <div class="mt-1">capabilities={entry.capabilities?.join(", ")}</div>
                    </Show>
                    <Show when={entry.permissions?.length}>
                      <div class="mt-1">
                        {language.t("settings.market.permissions")}: {entry.permissions?.join(", ")}
                      </div>
                    </Show>
                    <Show when={entry.compatibility}>
                      <div class="mt-1">
                        compatibility={entry.compatibility?.minNovaWayApi ?? "any"}
                        {entry.compatibility?.maxNovaWayApi ? `–${entry.compatibility.maxNovaWayApi}` : ""}
                      </div>
                    </Show>
                    <Show when={entry.releaseNotes}>
                      <div class="mt-1">release notes={entry.releaseNotes}</div>
                    </Show>
                    <Show when={entry.sha256}>
                      <div class="mt-1 break-all font-mono">sha256={entry.sha256}</div>
                    </Show>
                  </div>
                </Show>

                <div class="mt-auto flex flex-wrap items-center gap-1.5 pt-3">
                  <Button
                    variant="ghost"
                    size="small"
                    onClick={() => setDetails(details() === identity ? undefined : identity)}
                  >
                    {language.t("settings.market.details")}
                  </Button>
                  <Show when={installed() && outdated(entry)}>
                    <Button
                      variant="secondary"
                      size="small"
                      disabled={store.pending === identity}
                      onClick={() => update(installedEntry()!, entry)}
                    >
                      {language.t("settings.market.update")}
                    </Button>
                  </Show>
                  <Show when={installedEntry()?.previous}>
                    <Button
                      variant="ghost"
                      size="small"
                      disabled={store.pending === identity}
                      onClick={() => rollback(installedEntry()!)}
                    >
                      {language.t("settings.market.rollback")}
                    </Button>
                  </Show>
                  <Button
                    class="ml-auto"
                    variant={installed() ? "ghost" : "secondary"}
                    size="small"
                    disabled={store.pending === identity}
                    onClick={() => (installed() ? uninstall(installedEntry()!) : install(entry))}
                  >
                    {installed() ? language.t("settings.market.remove") : language.t("settings.market.install")}
                  </Button>
                </div>
              </article>
            )
          }}
        </For>
      </div>
    </SettingsGroup>
  )
}
