import { createMemo, createSignal, For, onCleanup, onMount, Show, type Component, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@novaway/ui/button"
import { Dialog } from "@novaway/ui/dialog"
import { useDialog } from "@novaway/ui/context/dialog"
import { Icon } from "@novaway/ui/icon"
import { Tag } from "@novaway/ui/tag"
import { showToast } from "@novaway/ui/toast"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { AppIcon } from "./app-icon"
import {
  MARKET_CATEGORIES,
  MARKET_TYPES,
  marketCategoryLabel,
  marketTypesOf,
  updateAvailable,
  updateLabel,
  updateTitle,
  type InstalledPackage,
  type MarketType,
} from "./settings-market-model"
import { ConfirmDialog } from "./dialog-confirm"
import { NOVAWAY_MARKETPLACE_ENTRIES } from "@/constants/novaway-marketplace"

const PHASE_LABEL_KEY = {
  queued: "settings.market.phase.queued",
  downloading: "settings.market.phase.downloading",
  staging: "settings.market.phase.staging",
  validating: "settings.market.phase.validating",
  replacing: "settings.market.phase.replacing",
  activating: "settings.market.phase.activating",
  draining: "settings.market.phase.draining",
  "cleanup-pending": "settings.market.phase.cleanup-pending",
  completed: "settings.market.phase.completed",
  failed: "settings.market.phase.failed",
} as const

type CatalogEntry = {
  name: string
  displayName?: string
  displayNameI18n?: Record<string, string>
  packageId?: string
  version?: string
  description?: string
  longDescription?: string
  author?: string
  license?: string
  icon?: string
  screenshots?: string[]
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
  marketTypes?: string[]
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

const MarketplaceDetailsDialog: Component<{
  entry: CatalogEntry
  title: string
  source: string
  trust: string
  compatibility?: string
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  return (
    <Dialog title={props.title} class="w-[min(calc(100vw-40px),680px)]">
      <div class="flex flex-col gap-5">
        <div class="flex items-start gap-3 rounded-xl border border-border bg-surface/60 p-4">
          <MarketplaceIcon src={props.entry.icon} seed={props.title} />
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="text-16-medium text-foreground">{props.title}</h2>
              <Show when={props.entry.version}>
                <Tag>{props.entry.version}</Tag>
              </Show>
            </div>
            <div class="mt-1 flex flex-wrap items-center gap-2 text-12-regular text-foreground-subtle">
              <span>{language.t("settings.market.source.filterOption", { name: props.source })}</span>
              <span
                class="inline-flex items-center gap-1"
                classList={{ "text-text-success-base": props.trust === language.t("settings.market.trust.verified") }}
              >
                <Show when={props.trust === language.t("settings.market.trust.verified")}>
                  <Icon name="circle-check" size="small" />
                </Show>
                {props.trust}
              </span>
              <Show when={props.compatibility}>
                <span>{props.compatibility}</span>
              </Show>
            </div>
          </div>
        </div>
        <div class="max-h-[min(45vh,360px)] overflow-y-auto whitespace-pre-wrap break-words text-13-regular leading-6 text-foreground-subtle">
          {props.entry.longDescription ?? props.entry.description ?? language.t("settings.market.empty")}
        </div>
        <div class="grid gap-2 rounded-lg border border-border/70 bg-background px-3 py-2 text-12-regular text-foreground-subtle sm:grid-cols-2">
          <Show when={props.entry.author}>
            <span>作者：{props.entry.author}</span>
          </Show>
          <Show when={props.entry.license}>
            <span>许可证：{props.entry.license}</span>
          </Show>
          <Show when={props.entry.runtimeTargets?.length}>
            <span>运行时：{props.entry.runtimeTargets?.join(", ")}</span>
          </Show>
          <Show when={props.entry.capabilities?.length}>
            <span>能力：{props.entry.capabilities?.join(", ")}</span>
          </Show>
          <Show when={props.entry.categories?.length}>
            <span>分类：{props.entry.categories?.map(marketCategoryLabel).join(", ")}</span>
          </Show>
          <Show when={props.entry.releaseNotes}>
            <span class="sm:col-span-2">更新说明：{props.entry.releaseNotes}</span>
          </Show>
          <Show when={props.entry.sha256}>
            <span class="break-all font-mono sm:col-span-2">SHA-256：{props.entry.sha256}</span>
          </Show>
        </div>
        <div class="flex justify-end border-t border-border pt-3">
          <Button variant="secondary" onClick={() => dialog.close()}>
            {language.t("common.close")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

const MarketplaceIcon: Component<{ src?: string; fallbackSrc?: string; seed: string }> = (props) => {
  const [attempt, setAttempt] = createSignal(0)
  const candidates = () => [props.src, props.fallbackSrc].filter((value): value is string => Boolean(value))
  const source = () => candidates()[attempt()]
  return (
    <Show when={source()} fallback={<AppIcon seed={props.seed} fallback="mcp" class="shrink-0" />}>
      <img
        src={source()}
        alt=""
        class="size-9 shrink-0 rounded-[10px] object-cover"
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setAttempt((value) => value + 1)}
      />
    </Show>
  )
}

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

type MarketplaceSourcesDialogProps = {
  sources: () => MarketplaceSource[]
  sourceName: () => string
  sourceUrl: () => string
  sourceType: () => MarketplaceSource["type"]
  editingSource: () => string | undefined
  sourceBusy: () => string
  sourceLabelOf: (source: MarketplaceSource | undefined, fallback?: string) => string
  onSourceName: (value: string) => void
  onSourceUrl: (value: string) => void
  onSourceType: (value: MarketplaceSource["type"]) => void
  onSave: () => void
  onCancelEdit: () => void
  onToggle: (source: MarketplaceSource) => void
  onRefresh: (source: MarketplaceSource) => void
  onEdit: (source: MarketplaceSource) => void
  onRemove: (source: MarketplaceSource) => void
}

const MarketplaceSourcesDialog: Component<MarketplaceSourcesDialogProps> = (props) => {
  const language = useLanguage()
  const dialog = useDialog()
  return (
    <Dialog title={language.t("settings.market.sources")} class="w-[min(calc(100vw-40px),860px)]">
      <div class="flex max-h-[min(75vh,720px)] flex-col gap-4 overflow-y-auto">
        <div>
          <div class="text-14-medium text-foreground">{language.t("settings.market.sources")}</div>
          <div class="mt-1 text-12-regular text-foreground-subtle">{language.t("settings.market.sourcesHint")}</div>
        </div>
        <div class="flex flex-col gap-2 sm:flex-row">
          <input
            class="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-2 text-ui-xs text-foreground outline-none focus:border-border-focus"
            value={props.sourceName()}
            onInput={(event) => props.onSourceName(event.currentTarget.value)}
            placeholder={language.t("settings.market.source.name")}
            aria-label={language.t("settings.market.source.name")}
            disabled={props.sourceBusy() !== ""}
          />
          <select
            class="rounded-md border border-border bg-background px-2.5 py-2 text-ui-xs text-foreground outline-none focus:border-border-focus"
            value={props.sourceType()}
            onChange={(event) => props.onSourceType(event.currentTarget.value as MarketplaceSource["type"])}
            aria-label={language.t("settings.market.source.type")}
            disabled={props.sourceBusy() !== ""}
          >
            <option value="auto">auto</option>
            <option value="novaway">NovaWay</option>
            <option value="claude">Claude</option>
          </select>
          <input
            class="min-w-0 flex-[2] rounded-md border border-border bg-background px-2.5 py-2 text-ui-xs text-foreground outline-none focus:border-border-focus"
            value={props.sourceUrl()}
            onInput={(event) => props.onSourceUrl(event.currentTarget.value)}
            placeholder="https://example.com/catalog.json"
            aria-label="URL"
            spellcheck={false}
            autocapitalize="off"
            autocomplete="off"
            disabled={props.sourceBusy() !== ""}
          />
          <Button size="small" disabled={props.sourceBusy() !== ""} onClick={props.onSave}>
            {props.editingSource()
              ? language.t("settings.market.source.save")
              : language.t("settings.market.source.add")}
          </Button>
        </div>
        <Show when={props.editingSource()}>
          <Button variant="ghost" size="small" class="self-start" onClick={props.onCancelEdit}>
            {language.t("common.cancel")}
          </Button>
        </Show>
        <div class="flex flex-col gap-2">
          <For each={props.sources()}>
            {(source) => (
              <div data-source-id={source.id} class="rounded-xl border border-border/70 bg-background/50 px-3 py-3">
                <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-1.5">
                      <span class="truncate text-13-medium text-foreground">{props.sourceLabelOf(source)}</span>
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
                    <div class="mt-1 break-all text-11-regular text-foreground-subtlest">{source.url}</div>
                    <Show when={source.lastError}>
                      <div class="mt-1 break-words text-11-regular text-warning-base">{source.lastError}</div>
                    </Show>
                  </div>
                  <div class="flex shrink-0 flex-wrap items-center gap-1">
                    <Button
                      variant="ghost"
                      size="small"
                      disabled={props.sourceBusy() !== ""}
                      onClick={() => props.onToggle(source)}
                    >
                      {source.enabled
                        ? language.t("settings.market.source.disable")
                        : language.t("settings.market.source.enable")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="small"
                      disabled={props.sourceBusy() !== ""}
                      onClick={() => props.onRefresh(source)}
                    >
                      {language.t("settings.market.source.refresh")}
                    </Button>
                    <Show when={!source.builtin}>
                      <Button
                        variant="ghost"
                        size="small"
                        disabled={props.sourceBusy() !== ""}
                        onClick={() => props.onEdit(source)}
                      >
                        {language.t("settings.market.source.edit")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="small"
                        disabled={props.sourceBusy() !== ""}
                        onClick={() => props.onRemove(source)}
                      >
                        {language.t("settings.market.source.remove")}
                      </Button>
                    </Show>
                  </div>
                </div>
              </div>
            )}
          </For>
        </div>
        <div class="flex justify-end border-t border-border pt-3">
          <Button variant="secondary" onClick={() => dialog.close()}>
            {language.t("common.close")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
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
  pendingAction: "" | "install" | "update" | "uninstall" | "rollback"
}

type CatalogSnapshot = Pick<
  MarketStore,
  "installed" | "sources" | "legacy" | "migrations" | "zcode" | "claude" | "novaway" | "updates" | "errors"
>

type CatalogCacheEntry = {
  snapshot: CatalogSnapshot
  fetchedAt: number
}

const MARKET_CATALOG_CACHE_TTL = 30 * 60 * 1000
const marketplaceCache = new Map<string, CatalogCacheEntry>()

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

type UpdateConfirmation = {
  description: JSX.Element
  variant: "danger" | "normal"
  resolve: (confirmed: boolean) => void
}

const text = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Gitee raw 重定向在部分桌面网络环境中无法加载时，改用同仓库 jsDelivr 镜像。 */
function cdnMirrorOfIcon(url: string | undefined): string | undefined {
  if (!url) return undefined
  const match = url.match(/^https:\/\/gitee\.com\/([^/]+)\/([^/]+)\/raw\/([^/]+)\/(.+)$/)
  if (!match) return undefined
  return `https://cdn.jsdelivr.net/gh/${match[1]}/${match[2]}@${match[3]}/${match[4]}`
}

/**
 * Marketplace sources are external data. Older servers, failed catalog
 * requests, and third-party source adapters may omit collection fields, so
 * the UI must never trust an API array to exist before rendering `.length`,
 * iterating it, or mapping it.
 */
function arrayValue<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function objectArrayValue<T extends object>(value: unknown): T[] {
  return arrayValue<unknown>(value).filter((item): item is T => item !== null && typeof item === "object")
}

function stringArrayValue(value: unknown): string[] {
  return arrayValue<unknown>(value).filter((item): item is string => typeof item === "string")
}

function recordValue(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter(([, item]) => typeof item === "string"))
}

function updatePreviewValue(value: unknown): UpdatePreview | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const preview = value as Record<string, unknown>
  return {
    currentVersion: typeof preview.currentVersion === "string" ? preview.currentVersion : undefined,
    targetVersion: typeof preview.targetVersion === "string" ? preview.targetVersion : undefined,
    sourceChanged: preview.sourceChanged === true,
    currentSourceId: typeof preview.currentSourceId === "string" ? preview.currentSourceId : undefined,
    targetSourceId: typeof preview.targetSourceId === "string" ? preview.targetSourceId : undefined,
    sourceUrlChanged: preview.sourceUrlChanged === true,
    permissionsAdded: stringArrayValue(preview.permissionsAdded),
    permissionsRemoved: stringArrayValue(preview.permissionsRemoved),
    dependenciesAdded: recordValue(preview.dependenciesAdded),
    dependenciesRemoved: stringArrayValue(preview.dependenciesRemoved),
    conflictsAdded: stringArrayValue(preview.conflictsAdded),
    conflictsRemoved: stringArrayValue(preview.conflictsRemoved),
    digestChanged: preview.digestChanged === true,
    requiresConfirmation: preview.requiresConfirmation === true,
  }
}

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
    pendingAction: "" as "" | "install" | "update" | "uninstall" | "rollback",
  })
  const [sourceName, setSourceName] = createSignal("")
  const [sourceUrl, setSourceUrl] = createSignal("")
  const [sourceType, setSourceType] = createSignal<MarketplaceSource["type"]>("auto")
  const [editingSource, setEditingSource] = createSignal<string>()
  const [sourceBusy, setSourceBusy] = createSignal("")
  const [search, setSearch] = createSignal("")
  const [category, setCategory] = createSignal("all")
  const [typeFilter, setTypeFilter] = createSignal<MarketType | "all">("all")
  const [sourceFilter, setSourceFilter] = createSignal("all")
  const [sort, setSort] = createSignal<"featured" | "name" | "updated">("featured")
  const dialog = useDialog()
  const [updateConfirmation, setUpdateConfirmation] = createSignal<UpdateConfirmation>()

  const updatePreviewDescription = (preview: UpdatePreview): JSX.Element => {
    const changes = [
      preview.sourceChanged
        ? {
            label: language.t("settings.market.preview.source"),
            value: `${preview.currentSourceId ?? preview.currentVersion ?? language.t("settings.market.preview.current")} → ${preview.targetSourceId ?? preview.targetVersion ?? language.t("settings.market.preview.target")}`,
            danger: false,
          }
        : undefined,
      preview.permissionsAdded.length
        ? {
            label: language.t("settings.market.preview.permissionsAdded"),
            value: preview.permissionsAdded.join(", "),
            danger: true,
          }
        : undefined,
      preview.permissionsRemoved.length
        ? {
            label: language.t("settings.market.preview.permissionsRemoved"),
            value: preview.permissionsRemoved.join(", "),
            danger: false,
          }
        : undefined,
      Object.keys(preview.dependenciesAdded).length
        ? {
            label: language.t("settings.market.preview.dependenciesAdded"),
            value: Object.entries(preview.dependenciesAdded)
              .map(([name, version]) => `${name} (${version})`)
              .join(", "),
            danger: false,
          }
        : undefined,
      preview.dependenciesRemoved.length
        ? {
            label: language.t("settings.market.preview.dependenciesRemoved"),
            value: preview.dependenciesRemoved.join(", "),
            danger: false,
          }
        : undefined,
      preview.conflictsAdded.length
        ? {
            label: language.t("settings.market.preview.conflictsAdded"),
            value: preview.conflictsAdded.join(", "),
            danger: true,
          }
        : undefined,
      preview.conflictsRemoved.length
        ? {
            label: language.t("settings.market.preview.conflictsRemoved"),
            value: preview.conflictsRemoved.join(", "),
            danger: false,
          }
        : undefined,
      preview.digestChanged
        ? {
            label: language.t("settings.market.preview.digestChanged"),
            value: language.t("settings.market.preview.artifactChanged"),
            danger: false,
          }
        : undefined,
    ].filter((item): item is NonNullable<typeof item> => item !== undefined)

    return (
      <div class="flex flex-col gap-3">
        <p class="text-13-regular leading-5 text-foreground-subtle">{language.t("settings.market.preview.confirm")}</p>
        <Show
          when={changes.length > 0}
          fallback={
            <div class="rounded-lg border border-border bg-surface px-3 py-2 text-12-regular text-foreground-subtle">
              {language.t("settings.market.preview.noDetails")}
            </div>
          }
        >
          <div class="overflow-hidden rounded-lg border border-border bg-surface">
            <For each={changes}>
              {(change) => (
                <div
                  class="flex items-start gap-3 border-b border-border px-3 py-2.5 last:border-b-0"
                  classList={{ "bg-surface-critical-weak/60": change.danger }}
                >
                  <span
                    class="w-28 shrink-0 text-12-medium"
                    classList={{ "text-text-critical-base": change.danger, "text-foreground-subtle": !change.danger }}
                  >
                    {change.label}
                  </span>
                  <span
                    class="min-w-0 break-words text-12-regular"
                    classList={{ "text-text-critical-base": change.danger, "text-foreground": !change.danger }}
                  >
                    {change.value}
                  </span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    )
  }

  const loadOperations = () =>
    operationsRequest({ directory: props.directory })
      .then((result) => {
        const operations = objectArrayValue<MarketplaceOperation>(result.data)
        setStore("operations", operations)
        return operations
      })
      .catch(() => [] as MarketplaceOperation[])

  const activeOperations = createMemo(() =>
    objectArrayValue<MarketplaceOperation>(store.operations).filter(
      (operation) => operation.phase !== "completed" && operation.phase !== "failed",
    ),
  )

  const operationOf = (identity: string) =>
    [...objectArrayValue<MarketplaceOperation>(store.operations)]
      .reverse()
      .find(
        (operation) =>
          operation.packageId === identity && operation.phase !== "completed" && operation.phase !== "failed",
      )

  const busyLabel = (identity: string, installed: boolean) => {
    const operation = operationOf(identity)
    if (operation) return `${language.t(PHASE_LABEL_KEY[operation.phase])} ${operation.progress}%`
    if (store.pendingAction === "uninstall") return language.t("settings.market.uninstalling")
    if (store.pendingAction === "update") return language.t("settings.market.updating")
    if (store.pendingAction === "rollback") return language.t("settings.market.rollingBack")
    return installed ? language.t("settings.market.uninstalling") : language.t("settings.market.installing")
  }

  const load = (options: { force?: boolean } = {}) => {
    const cached = marketplaceCache.get(props.directory)
    const cacheAge = cached ? Date.now() - cached.fetchedAt : Number.POSITIVE_INFINITY
    if (cached) {
      setStore(cached.snapshot)
      if (!options.force && cacheAge < MARKET_CATALOG_CACHE_TTL) {
        return
      }
    }

    const silent = Boolean(cached && !options.force)
    if (!silent) setStore("loading", true)
    void loadOperations()
    void sdk.client.extension
      .marketplaceCatalog({ directory: props.directory })
      .then(async (result) => {
        const data = result.data
        if (!data) return
        const catalog = data as unknown as {
          installed?: unknown
          legacy?: unknown
          sources?: unknown
          novaway?: unknown
          zcode?: unknown
          claude?: unknown
          updates?: unknown
          errors?: unknown
        }
        const official = objectArrayValue<ServerNativeEntry>(catalog.novaway).map((entry) => ({
          ...entry,
          sourceId: entry.sourceId ?? "novaway-official",
          kind:
            entry.kind ??
            (Array.isArray(entry.runtimeTargets) && entry.runtimeTargets.includes("legacy-extension") ? "git" : "zip"),
        }))
        const fallback: CatalogEntry[] = NOVAWAY_MARKETPLACE_ENTRIES.map((entry) => ({
          name: entry.name,
          version: entry.version,
          description: entry.description,
          descriptionKey: entry.descriptionKey,
          icon: entry.icon,
          url: entry.url,
          sourceId: "novaway-official",
          ref: entry.ref,
          subdir: entry.subdir,
          kind: entry.kind,
          keywords: entry.keywords,
        }))
        const merged = new Map<string, CatalogEntry>()
        for (const entry of fallback) merged.set(entry.packageId ?? entry.name, entry)
        for (const entry of official) {
          const key = entry.packageId ?? entry.name
          const previous = merged.get(key)
          // 保留本地官方清单里的头像，兼容旧服务端尚未返回 icon 的情况。
          merged.set(key, {
            ...previous,
            ...entry,
            ...(entry.icon || !previous?.icon ? {} : { icon: previous.icon }),
          })
        }
        const migrations = await legacyClient()
          .marketplaceLegacyMigrations({ directory: props.directory })
          .then((response) => objectArrayValue<LegacyMigration>(response.data))
          .catch(() => [])
        const snapshot: CatalogSnapshot = {
          installed: objectArrayValue<InstalledEntry>(catalog.installed),
          legacy: objectArrayValue<LegacyEntry>(catalog.legacy),
          migrations,
          sources: objectArrayValue<MarketplaceSource>(catalog.sources),
          novaway: [...merged.values()],
          zcode: objectArrayValue<Omit<CatalogEntry, "kind">>(catalog.zcode).map((entry) => ({
            ...entry,
            kind: "zip" as const,
          })),
          claude: objectArrayValue<Omit<CatalogEntry, "kind">>(catalog.claude).map((entry) => ({
            ...entry,
            kind: "git" as const,
          })),
          updates: objectArrayValue<UpdateEntry>(catalog.updates),
          errors: arrayValue<unknown>(catalog.errors).filter((entry): entry is string => typeof entry === "string"),
        }
        marketplaceCache.set(props.directory, { snapshot, fetchedAt: Date.now() })
        setStore(snapshot)
      })
      .catch((error: unknown) => {
        if (!silent) setStore("errors", [text(error)])
      })
      .finally(() => {
        if (!silent) setStore("loading", false)
      })
  }

  onMount(() => {
    load()
    const timer = setInterval(() => {
      if (activeOperations().length > 0 || store.pending !== "") void loadOperations()
    }, 120)
    const cacheTimer = setInterval(() => load(), MARKET_CATALOG_CACHE_TTL)
    onCleanup(() => {
      clearInterval(timer)
      clearInterval(cacheTimer)
    })
  })

  onCleanup(() => {
    const pending = updateConfirmation()
    if (!pending) return
    setUpdateConfirmation(undefined)
    pending.resolve(false)
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
        load({ force: true })
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
        load({ force: true })
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
        load({ force: true })
      })
      .catch((error: unknown) => {
        void load({ force: true })
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
        load({ force: true })
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
        load({ force: true })
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
        load({ force: true })
      })
      .catch((error: unknown) => showToast({ title: language.t("common.requestFailed"), description: text(error) }))
      .finally(() => setStore("pending", ""))
  }

  const installedNames = createMemo(
    () => new Set(objectArrayValue<InstalledEntry>(store.installed).map((item) => item.name)),
  )
  const entryIdentity = (entry: CatalogEntry) => entry.packageId ?? entry.name
  const entries = createMemo(() => [
    ...arrayValue<CatalogEntry>(store.novaway),
    ...arrayValue<CatalogEntry>(store.claude),
    ...arrayValue<CatalogEntry>(store.zcode),
  ])
  const categories = createMemo(() => {
    const present = entries().flatMap((entry) => entry.categories ?? [])
    return ["all", ...new Set([...MARKET_CATEGORIES, ...present])]
  })
  const marketTypeOptions = createMemo<("all" | MarketType)[]>(() => [
    "all",
    "workbench",
    ...MARKET_TYPES.filter(
      (type) => type !== "workbench" && entries().some((entry) => marketTypesOf(entry).includes(type)),
    ),
  ])
  const marketTypesOfEntry = (entry: CatalogEntry) => marketTypesOf(entry)
  const sourceOptions = createMemo(() => [
    "all",
    ...new Set(
      entries()
        .map((entry) => entry.sourceId)
        .filter((value): value is string => Boolean(value)),
    ),
  ])
  const displayNameOf = (entry: Pick<CatalogEntry, "name" | "displayName" | "displayNameI18n" | "packageId">) => {
    const locale = language.intl()
    const translations = entry.displayNameI18n ?? {}
    const languageCode = locale.split("-")[0]
    return (
      translations[locale] ?? translations[languageCode] ?? entry.displayName ?? entry.name ?? entry.packageId ?? ""
    )
  }
  // Keep these helpers above visibleEntries: createMemo may evaluate immediately,
  // so sorting must not close over a const that is still in its TDZ.
  const sourceOf = (entry: CatalogEntry) =>
    arrayValue<MarketplaceSource>(store.sources).find((source) => source.id === entry.sourceId)
  const sourceOrderOf = (entry: CatalogEntry) => {
    const source = sourceOf(entry)
    if (source?.id === "novaway-official") return 0
    if (source?.type === "claude") return 1
    if (source?.type === "zcode") return 2
    return 3
  }
  const updateOf = (entry: CatalogEntry) =>
    arrayValue<UpdateEntry>(store.updates).find((item) => item.name === entryIdentity(entry))
  const installedOf = (entry: CatalogEntry) =>
    arrayValue<InstalledEntry>(store.installed).find((item) => item.name === entryIdentity(entry))
  const outdated = (entry: CatalogEntry) =>
    updateOf(entry)?.state === "outdated" || updateAvailable(installedOf(entry), entry.version)
  const visibleEntries = createMemo(() => {
    const needle = search().trim().toLocaleLowerCase()
    const selectedSource = sourceFilter()
    const filtered = entries().filter((entry) => {
      const haystack = [
        displayNameOf(entry),
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
        (typeFilter() === "all" || marketTypesOfEntry(entry).includes(typeFilter() as MarketType)) &&
        (category() === "all" || entry.categories?.includes(category())) &&
        (selectedSource === "all" || entry.sourceId === selectedSource)
      )
    })
    return [...filtered].sort((left, right) => {
      const sourceOrder = sourceOrderOf(left) - sourceOrderOf(right)
      if (sourceOrder !== 0) return sourceOrder
      if (sort() === "name") return displayNameOf(left).localeCompare(displayNameOf(right))
      if (sort() === "updated") return Number(outdated(right)) - Number(outdated(left))
      return Number(outdated(right)) - Number(outdated(left)) || displayNameOf(left).localeCompare(displayNameOf(right))
    })
  })
  const descriptionOf = (entry: CatalogEntry) =>
    entry.descriptionKey ? language.t(entry.descriptionKey as never) : entry.description
  const sourceLabelOf = (source: MarketplaceSource | undefined, fallback?: string) => {
    if (source?.trust === "official" && source.id === "novaway-official")
      return language.t("settings.market.source.official")
    if (source?.trust === "official" && source.type === "claude") return "Claude 官方"
    if (source?.trust === "official" && source.type === "zcode") return "ZCode 官方"
    return source?.name ?? fallback ?? language.t("settings.market.source.unknown")
  }
  const sourceNameOf = (entry: CatalogEntry) => sourceLabelOf(sourceOf(entry), entry.sourceId)
  const avatarUrlOf = (entry: CatalogEntry) => {
    if (entry.icon) return entry.icon
    const candidate = entry.repository ?? (entry.kind === "git" ? entry.url : undefined)
    try {
      if (candidate) {
        const url = new URL(candidate)
        if (url.hostname === "github.com" || url.hostname === "www.github.com") {
          const owner = url.pathname.split("/").filter(Boolean)[0]
          if (owner) return `https://github.com/${encodeURIComponent(owner)}.png?size=80`
        }
      }
    } catch {
      // Fall through to the marketplace source avatar.
    }
    const source = sourceOf(entry)
    if (source?.type === "claude") return "https://github.com/anthropics.png?size=80"
    if (source?.type === "zcode") return "https://z.ai/favicon.ico"
    return undefined
  }
  const compatibilityLabelOf = (entry: CatalogEntry) => {
    const source = sourceOf(entry)
    if (source?.type === "claude") return language.t("settings.market.compatibility.claude")
    if (source?.type === "zcode") return language.t("settings.market.compatibility.zcode")
    return undefined
  }
  const trustOf = (entry: CatalogEntry): NonNullable<CatalogEntry["verifiedStatus"]> =>
    entry.verifiedStatus ??
    (sourceOf(entry)?.trust === "official" || entry.sourceId === "novaway-official" ? "verified" : "community")
  const trustLabel = (entry: CatalogEntry) => language.t(`settings.market.trust.${trustOf(entry)}` as never)
  const trustClass = (entry: CatalogEntry) =>
    trustOf(entry) === "verified"
      ? "border-border-success-base/30 bg-surface-success-weak text-text-success-base"
      : trustOf(entry) === "community"
        ? "border-accent-base/30 bg-accent-base/10 text-accent-base"
        : "border-warning-base/30 bg-warning-base/10 text-warning-base"
  // 官方仓库有新提交时（后端比对提交哈希 / 归档 ETag）在条目上标出来。

  const install = (entry: CatalogEntry) => {
    const identity = entryIdentity(entry)
    setStore("pending", identity)
    setStore("pendingAction", "install")
    void loadOperations()
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
        showToast({ title: language.t("settings.market.installed", { name: displayNameOf(entry) }) })
        load({ force: true })
        props.onInstalled?.()
      })
      .catch((error: unknown) => {
        void load({ force: true })
        showToast({ title: language.t("common.requestFailed"), description: text(error) })
      })
      .finally(() => {
        setStore("pending", "")
        setStore("pendingAction", "")
      })
  }

  const update = (entry: InstalledEntry, target: CatalogEntry) => {
    setStore("pending", entry.name)
    setStore("pendingAction", "update")
    void loadOperations()
    void (async () => {
      const previewResult = await previewRequest({
        directory: props.directory,
        name: entry.name,
      })
      const preview = updatePreviewValue(previewResult.data)
      if (!preview) throw new Error(language.t("settings.market.preview.failed"))
      if (preview.requiresConfirmation) {
        const confirmed = await new Promise<boolean>((resolve) => {
          setUpdateConfirmation({
            description: updatePreviewDescription(preview),
            variant: preview.permissionsAdded.length > 0 || preview.conflictsAdded.length > 0 ? "danger" : "normal",
            resolve,
          })
        })
        if (!confirmed) return
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
      showToast({ title: language.t("settings.market.updated", { name: displayNameOf(entry) }) })
      load({ force: true })
      props.onInstalled?.()
    })()
      .catch((error: unknown) => {
        void load({ force: true })
        showToast({ title: language.t("common.requestFailed"), description: text(error) })
      })
      .finally(() => {
        setStore("pending", "")
        setStore("pendingAction", "")
      })
  }

  const uninstall = (entry: InstalledEntry) => {
    setStore("pending", entry.name)
    setStore("pendingAction", "uninstall")
    void loadOperations()
    void sdk.client.extension
      .marketplaceUninstall({ directory: props.directory, name: entry.root.split(/[/\\]/).pop() ?? entry.name })
      .then(() => {
        showToast({ title: language.t("settings.market.uninstalled", { name: displayNameOf(entry) }) })
        load({ force: true })
        props.onInstalled?.()
      })
      .catch((error: unknown) => {
        void load({ force: true })
        showToast({ title: language.t("common.requestFailed"), description: text(error) })
      })
      .finally(() => {
        setStore("pending", "")
        setStore("pendingAction", "")
      })
  }

  const rollback = (entry: InstalledEntry) => {
    setStore("pending", entry.name)
    setStore("pendingAction", "rollback")
    void loadOperations()
    void sdk.client.extension
      .marketplaceRollback({ directory: props.directory, name: entry.name })
      .then(() => {
        showToast({ title: language.t("settings.market.rolledBack", { name: displayNameOf(entry) }) })
        load({ force: true })
        props.onInstalled?.()
      })
      .catch((error: unknown) => {
        void load({ force: true })
        showToast({ title: language.t("common.requestFailed"), description: text(error) })
      })
      .finally(() => {
        setStore("pending", "")
        setStore("pendingAction", "")
      })
  }

  return (
    <section data-component="marketplace" class="pb-8">
      <ConfirmDialog
        open={Boolean(updateConfirmation())}
        title={language.t("settings.market.preview.title")}
        description={updateConfirmation()?.description ?? ""}
        variant={updateConfirmation()?.variant ?? "normal"}
        confirmText={language.t("settings.market.preview.update")}
        onConfirm={() => {
          const pending = updateConfirmation()
          if (!pending) return
          setUpdateConfirmation(undefined)
          pending.resolve(true)
        }}
        onClose={() => {
          const pending = updateConfirmation()
          if (!pending) return
          setUpdateConfirmation(undefined)
          pending.resolve(false)
        }}
      />
      <div class="flex flex-wrap items-center justify-end gap-2 py-3">
        <input
          class="mr-auto w-full rounded-lg border border-border bg-transparent px-3 py-2 text-13-regular text-foreground outline-none focus:border-border-focus sm:max-w-sm"
          value={search()}
          onInput={(event) => setSearch(event.currentTarget.value)}
          placeholder={language.t("settings.market.search")}
          aria-label={language.t("settings.market.search")}
          spellcheck={false}
        />
        <Button
          variant="ghost"
          size="small"
          disabled={store.loading}
          onClick={load}
          aria-label={language.t("settings.market.refresh")}
        >
          <Icon name="refresh" size="small" class={store.loading ? "animate-spin" : undefined} />
        </Button>
        <Button
          variant="secondary"
          size="small"
          onClick={() =>
            dialog.show(() => (
              <MarketplaceSourcesDialog
                sources={() => arrayValue<MarketplaceSource>(store.sources)}
                sourceName={sourceName}
                sourceUrl={sourceUrl}
                sourceType={sourceType}
                editingSource={editingSource}
                sourceBusy={sourceBusy}
                sourceLabelOf={sourceLabelOf}
                onSourceName={setSourceName}
                onSourceUrl={setSourceUrl}
                onSourceType={setSourceType}
                onSave={saveSource}
                onCancelEdit={cancelSourceEdit}
                onToggle={toggleSource}
                onRefresh={refreshSource}
                onEdit={editSource}
                onRemove={(source) => {
                  if (window.confirm(language.t("settings.market.source.removeConfirm", { name: source.name }))) {
                    removeSource(source)
                  }
                }}
              />
            ))
          }
        >
          <Icon name="plus-small" size="small" />
          {language.t("settings.market.sources")}
        </Button>
      </div>
      <div
        data-component="marketplace-hero"
        class="flex min-h-[190px] items-center justify-between gap-8 py-10 sm:py-14"
      >
        <div class="min-w-0">
          <div class="mb-3 text-13-medium tracking-wide text-foreground-subtle">NovaWay / Extensions</div>
          <h1 class="text-[28px] leading-tight font-semibold tracking-tight text-foreground sm:text-[32px]">
            {language.t("settings.market.discoverTitle")}
          </h1>
          <p class="mt-3 text-base text-foreground-subtle">{language.t("settings.market.discoverHint")}</p>
        </div>
        <div class="hidden shrink-0 items-center gap-3 pr-5 sm:flex" aria-hidden="true">
          <div class="-rotate-12 rounded-2xl border border-border bg-surface p-5">
            <Icon name="archive" size="large" />
          </div>
          <div class="translate-y-4 rotate-6 rounded-2xl border border-border bg-surface p-5">
            <Icon name="mcp" size="large" />
          </div>
        </div>
      </div>

      <Show
        when={
          arrayValue<LegacyEntry>(store.legacy).length > 0 || arrayValue<LegacyMigration>(store.migrations).length > 0
        }
      >
        <details class="mb-4 rounded-lg border border-border px-4 py-3">
          <summary class="cursor-pointer text-13-medium text-foreground">
            {language.t("settings.market.legacy.title")}
          </summary>
          <div class="pt-3">
            <div class="mb-2 text-13-medium text-foreground">{language.t("settings.market.legacy.title")}</div>
            <div class="mb-2 text-12-regular text-foreground-subtle">{language.t("settings.market.legacy.hint")}</div>
            <div class="flex flex-col gap-1.5">
              <For each={arrayValue<LegacyEntry>(store.legacy)}>
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
              <For each={arrayValue<LegacyMigration>(store.migrations)}>
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
        </details>
      </Show>

      <Show when={arrayValue<string>(store.errors).length > 0}>
        <div class="border-b border-border px-4 py-2" data-component="market-catalog-errors">
          <For each={arrayValue<string>(store.errors)}>
            {(error) => <div class="text-11-regular text-warning-base">{error}</div>}
          </For>
        </div>
      </Show>

      <div
        class="flex items-center gap-2 overflow-x-auto pb-5"
        aria-label={language.t("settings.market.type") as string}
      >
        <For each={marketTypeOptions()}>
          {(value) => (
            <button
              type="button"
              class="shrink-0 rounded-lg px-4 py-2 text-13-medium transition-colors"
              classList={{
                "bg-surface text-foreground": typeFilter() === value,
                "text-foreground-subtle hover:bg-hover": typeFilter() !== value,
              }}
              aria-pressed={typeFilter() === value}
              onClick={() => setTypeFilter(value)}
            >
              {value === "all"
                ? language.t("settings.market.typeAll")
                : language.t(`settings.market.type.${value}` as never)}
            </button>
          )}
        </For>
      </div>

      <div data-component="marketplace-filters" class="flex flex-wrap items-center gap-2 py-5">
        <h2 class="mr-auto text-15-medium text-foreground">
          {language.t("settings.market.categoryAll")}
          <Show
            when={!store.loading}
            fallback={
              <span class="ml-2 inline-flex items-center gap-1.5 text-12-regular text-foreground-subtlest">
                <span
                  class="size-3.5 shrink-0 animate-spin rounded-full border-2 border-border border-t-foreground"
                  aria-hidden="true"
                />
                {language.t("settings.market.loading")}
              </span>
            }
          >
            <span class="ml-2 text-12-regular text-foreground-subtlest">{visibleEntries().length}</span>
          </Show>
        </h2>
        <select
          class="rounded-lg border border-border bg-panel px-3 py-2 text-ui-xs text-foreground outline-none focus:border-border-focus"
          value={category()}
          onChange={(event) => setCategory(event.currentTarget.value)}
          aria-label={language.t("settings.market.category")}
        >
          <option value="all">{language.t("settings.market.categoryAll")}</option>
          <For each={categories().slice(1)}>
            {(value) => <option value={value}>{marketCategoryLabel(value)}</option>}
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
                  name: sourceLabelOf(
                    arrayValue<MarketplaceSource>(store.sources).find((source) => source.id === value),
                    value,
                  ),
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

      <Show when={arrayValue<MarketplaceOperation>(store.operations).length > 0}>
        <details class="mb-4 rounded-lg border border-border px-4 py-3" data-component="market-operation-history">
          <summary class="cursor-pointer text-12-medium text-foreground-subtle">
            {language.t("settings.market.operationsDetails")}
            <Show when={activeOperations().length > 0}>
              <span class="ml-2">({activeOperations().length})</span>
            </Show>
          </summary>
          <div class="flex flex-col gap-1.5">
            <For each={arrayValue<MarketplaceOperation>(store.operations).slice(-5).reverse()}>
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
        </details>
      </Show>

      <div class="grid grid-cols-1 gap-x-12 gap-y-2 xl:grid-cols-2" data-component="marketplace-results">
        <For
          each={visibleEntries()}
          fallback={
            <Show
              when={store.loading}
              fallback={
                <div class="col-span-full rounded-xl border border-dashed border-border px-3 py-8 text-center text-ui-xs text-foreground-subtle">
                  {language.t("settings.market.empty")}
                </div>
              }
            >
              <div
                class="col-span-full flex items-center justify-center gap-2 rounded-xl border border-dashed border-border px-3 py-8 text-ui-xs text-foreground-subtle"
                data-component="market-loading"
              >
                <span
                  class="size-4 shrink-0 animate-spin rounded-full border-2 border-border border-t-foreground"
                  aria-hidden="true"
                />
                {language.t("settings.market.loading")}
              </div>
            </Show>
          }
        >
          {(entry, index) => {
            const identity = entryIdentity(entry)
            const installed = () => installedNames().has(identity)
            const installedEntry = () =>
              arrayValue<InstalledEntry>(store.installed).find((item) => item.name === identity)
            const busy = () => store.pending === identity || operationOf(identity) !== undefined
            const busyText = () => busyLabel(identity, installed())
            const secondaryActionBusy = () =>
              busy() && installed() && (outdated(entry) || Boolean(installedEntry()?.previous))
            const sourceGroup = () => entry.sourceId ?? sourceOf(entry)?.type ?? "unknown"
            const sourceGroupChanged = () => {
              const previous = visibleEntries()[index() - 1]
              return (
                index() === 0 ||
                sourceGroup() !== (previous ? (previous.sourceId ?? sourceOf(previous)?.type) : "unknown")
              )
            }
            return (
              <>
                <Show when={sourceGroupChanged()}>
                  <div class="col-span-full flex items-center gap-3 py-3" data-component="market-source-divider">
                    <div class="h-px flex-1 bg-border" />
                    <span class="text-12-medium text-foreground-subtle">{sourceNameOf(entry)}</span>
                    <div class="h-px flex-1 bg-border" />
                  </div>
                </Show>
                <article
                  data-component="market-entry"
                  data-market-source={entry.sourceId ?? "unknown"}
                  data-market-trust={trustOf(entry)}
                  class="group grid min-w-0 grid-cols-[36px_minmax(0,1fr)_auto] content-start gap-x-3 rounded-xl px-3 py-5 transition-colors hover:bg-hover/40"
                >
                  <div class="col-span-2 flex min-w-0 items-start gap-3">
                    <MarketplaceIcon
                      src={avatarUrlOf(entry)}
                      fallbackSrc={cdnMirrorOfIcon(avatarUrlOf(entry))}
                      seed={displayNameOf(entry)}
                    />
                    <div class="min-w-0 flex-1">
                      <div class="flex min-w-0 items-start justify-between gap-2">
                        <div class="flex min-w-0 flex-wrap items-center gap-1.5">
                          <span class="min-w-0 break-words text-ui-base font-medium text-foreground">
                            {displayNameOf(entry)}
                          </span>
                          <Show when={entry.version}>
                            <Tag>{entry.version}</Tag>
                          </Show>
                        </div>
                        <Show when={trustOf(entry) === "verified"}>
                          <span
                            class="inline-flex shrink-0 items-center gap-1 rounded-full border border-border-success-base/30 bg-surface-success-weak px-1.5 py-0.5 text-11-medium text-text-success-base"
                            title={trustLabel(entry)}
                            aria-label={trustLabel(entry)}
                          >
                            <Icon name="circle-check" size="small" />
                            {trustLabel(entry)}
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
                        <Show when={compatibilityLabelOf(entry)}>
                          <span class="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-foreground-subtle">
                            {compatibilityLabelOf(entry)}
                          </span>
                        </Show>
                      </div>
                    </div>
                  </div>

                  <div class="col-start-2 row-start-2 mt-2 flex flex-col gap-1.5">
                    <Show when={descriptionOf(entry)}>
                      <div class="line-clamp-2 text-ui-xs leading-5 text-foreground-subtle">{descriptionOf(entry)}</div>
                    </Show>
                    <Show when={marketTypesOfEntry(entry).length > 0}>
                      <div class="flex flex-wrap gap-1">
                        <For each={marketTypesOfEntry(entry)}>
                          {(type) => <Tag>{language.t(`settings.market.type.${type}` as never)}</Tag>}
                        </For>
                      </div>
                    </Show>
                    <Show when={entry.categories?.length}>
                      <div class="flex flex-wrap gap-1">
                        <For each={entry.categories?.slice(0, 3)}>
                          {(item) => <Tag>{marketCategoryLabel(item)}</Tag>}
                        </For>
                      </div>
                    </Show>
                  </div>

                  <Show when={installed()}>
                    <div class="col-span-3 mt-2 flex min-w-0 flex-wrap items-center gap-1.5 pl-12 [&>[data-component=tag]]:max-w-full [&>[data-component=tag]]:truncate">
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
                              <Tag>
                                {language.t("settings.market.updateAvailable", { version: entry.version ?? "" })}
                              </Tag>
                            </Show>
                          </>
                        )}
                      </Show>
                    </div>
                  </Show>

                  <div class="col-start-3 row-start-1 row-span-2 flex flex-col items-end gap-1 self-start">
                    <Button
                      variant="ghost"
                      size="small"
                      icon="eye"
                      aria-label={language.t("settings.market.details")}
                      title={language.t("settings.market.details")}
                      class="border border-border/70 bg-surface/40 hover:bg-hover"
                      onClick={() =>
                        dialog.show(() => (
                          <MarketplaceDetailsDialog
                            entry={entry}
                            title={displayNameOf(entry)}
                            source={sourceNameOf(entry)}
                            trust={trustLabel(entry)}
                            compatibility={compatibilityLabelOf(entry)}
                          />
                        ))
                      }
                    ></Button>
                    <Show when={installed() && outdated(entry)}>
                      <Button
                        variant="secondary"
                        size="small"
                        disabled={busy()}
                        icon="download"
                        onClick={() => update(installedEntry()!, entry)}
                      >
                        <Show when={busy()} fallback={language.t("settings.market.update")}>
                          <span class="flex items-center gap-1.5">
                            <span
                              class="size-3.5 shrink-0 animate-spin rounded-full border-2 border-border border-t-foreground"
                              aria-hidden="true"
                            />
                            {busyText()}
                          </span>
                        </Show>
                      </Button>
                    </Show>
                    <Show when={installedEntry()?.previous && !outdated(entry)}>
                      <Button
                        variant="ghost"
                        size="small"
                        disabled={busy()}
                        icon="refresh"
                        onClick={() => rollback(installedEntry()!)}
                      >
                        <Show when={busy()} fallback={language.t("settings.market.rollback")}>
                          <span class="flex items-center gap-1.5">
                            <span
                              class="size-3.5 shrink-0 animate-spin rounded-full border-2 border-border border-t-foreground"
                              aria-hidden="true"
                            />
                            {busyText()}
                          </span>
                        </Show>
                      </Button>
                    </Show>
                    <Show when={!secondaryActionBusy()}>
                      <Button
                        class="ml-auto"
                        classList={{
                          "text-text-critical-base hover:bg-surface-critical-weak hover:text-text-critical-base":
                            installed(),
                        }}
                        variant={installed() ? "ghost" : "primary"}
                        size="small"
                        disabled={busy()}
                        aria-label={
                          installed() ? language.t("settings.market.remove") : language.t("settings.market.install")
                        }
                        title={
                          installed() ? language.t("settings.market.remove") : language.t("settings.market.install")
                        }
                        icon={busy() ? undefined : installed() ? "trash" : "download"}
                        onClick={() => (installed() ? uninstall(installedEntry()!) : install(entry))}
                      >
                        <Show when={busy()} fallback={installed() ? null : language.t("settings.market.install")}>
                          <span class="flex items-center gap-1.5">
                            <span
                              class="size-3.5 shrink-0 animate-spin rounded-full border-2 border-border border-t-foreground"
                              aria-hidden="true"
                            />
                            {busyText()}
                          </span>
                        </Show>
                      </Button>
                    </Show>
                  </div>
                </article>
              </>
            )
          }}
        </For>
      </div>
    </section>
  )
}
