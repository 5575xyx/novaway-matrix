import type { Config } from "@novaway/sdk/v2/client"
import JSZip from "jszip"
import { Button } from "@novaway/ui/button"
import { useDialog } from "@novaway/ui/context/dialog"
import { Dialog } from "@novaway/ui/dialog"
import { DropdownMenu } from "@novaway/ui/dropdown-menu"
import { Icon } from "@novaway/ui/icon"
import { IconButton } from "@novaway/ui/icon-button"
import { Switch } from "@novaway/ui/switch"
import { Tag } from "@novaway/ui/tag"
import { createMemo, createSignal, For, onMount, Show, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import {
  parseZcodeMarketplace,
  ZCODE_MARKETPLACE,
  ZCODE_MARKETPLACE_URL,
  type ZcodeMarketplaceEntry,
} from "@/constants/zcode-marketplace"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { SettingsGroup } from "./settings-parts"
import { PluginStoreSection } from "./settings-runtime"

const INSTALLED_FIELD = "plugin.marketplace.v1"
const MANIFEST_FIELD = "plugin.marketplace.manifest.v1"

type InstalledPlugin = {
  name: string
  version: string
  dir: string
  /** 安装时注册到 config.skills.paths 的路径（没有 skills 则为空）。 */
  skillPath?: string
  /** 安装时注册到 config.mcp 的服务名。 */
  mcpNames: string[]
}

/**
 * 内置扩展：直接来自本产品已具备的能力（内置技能 / 内置 MCP / 记忆服务）。
 *
 * 对齐 ZCode 的「内置」区：这些不是从市场下载的东西，而是随应用提供的、
 * 可以在列表里看到并开关的能力包。开关直接写回对应配置，改完立即生效。
 */
type BuiltinExtension = {
  id: string
  name: string
  description: string
  icon: "list" | "mcp" | "brain" | "review"
  components: string[]
  /** 配置键：mcp.browser / memory；没有开关的只展示。 */
  toggle?: "browser" | "memory"
  /** 本产品是否真的具备该能力；false 时条目仍展示并说明原因。 */
  available?: boolean
  unavailableReason?: string
}

export const BUILTIN_EXTENSIONS: BuiltinExtension[] = [
  // 目录口径对齐 ZCode 的官方内置插件（FreeCodeZ bootstrap 的 official-plugin-definitions）：
  // PDF / 演示文档 / 电子表格 / Word文档 / 交互视图 / 浏览器操作 / 电脑控制 / 技能与插件创建 / 使用指南。
  // 其中部分能力本产品暂未内置执行引擎，列表里保留条目并标注「未内置」，
  // 打开详情能看到具体缺什么 —— 比凭空给一个点了没反应的开关更诚实。
  {
    id: "pdf",
    name: "PDF",
    description: "创建、编辑与审阅 PDF。",
    icon: "review",
    components: ["skill"],
    available: false,
    unavailableReason: "当前版本未内置 PDF 生成/解析引擎，可以先让 AI 生成 HTML 后另存为 PDF。",
  },
  {
    id: "presentations",
    name: "演示文档",
    description: "创建、编辑与审阅演示文档（PPTX）。",
    icon: "review",
    components: ["skill"],
  },
  {
    id: "spreadsheets",
    name: "电子表格",
    description: "创建、编辑与审阅电子表格（XLSX）。",
    icon: "review",
    components: ["skill"],
  },
  {
    id: "documents",
    name: "Word 文档",
    description: "创建、编辑与审阅 Word 文档（DOCX）。",
    icon: "review",
    components: ["skill"],
  },
  {
    id: "visualize",
    name: "交互视图",
    description: "在对话中创建交互图表、数据看板与单页演示页面。",
    icon: "chart",
    components: ["skill"],
  },
  {
    id: "browser-use",
    name: "浏览器操作",
    description: "操作真实浏览器：打开网页、点击、输入、截图并校验页面结果。",
    icon: "mcp",
    components: ["mcp"],
    toggle: "browser",
  },
  {
    id: "computer-use",
    name: "电脑控制",
    description: "读取本机应用界面并执行点击、键入、滚动等桌面操作。",
    icon: "autopilot",
    components: ["skill"],
    available: false,
    unavailableReason: "当前版本未内置电脑控制执行引擎（需要桌面自动化运行时）。",
  },
  {
    id: "skill-tools",
    name: "技能与插件创建",
    description: "帮助发现、安装并编写 Agent 技能与插件，把重复流程沉淀下来。",
    icon: "list",
    components: ["skill"],
  },
  {
    id: "guide",
    name: "NovaWay 使用指南",
    description: "NovaWay 配置、插件、技能、MCP、命令与钩子的使用与诊断说明。",
    icon: "help",
    components: ["skill"],
  },
]

const CATEGORY_ORDER = ["developer-tools", "productivity", "finance"] as const
const categoryLabel: Record<string, string> = {
  "developer-tools": "settings.plugins.market.category.developer",
  productivity: "settings.plugins.market.category.productivity",
  finance: "settings.plugins.market.category.finance",
}
const componentLabel: Record<string, string> = {
  skill: "settings.plugins.market.component.skill",
  mcp: "settings.plugins.market.component.mcp",
  ui: "settings.plugins.market.component.ui",
  memory: "settings.plugins.market.component.memory",
  command: "settings.plugins.market.component.command",
  hook: "settings.plugins.market.component.hook",
  agent: "settings.plugins.market.component.agent",
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value)

const joinPath = (dir: string, segment: string) =>
  `${dir.replace(/[\/]+$/, "")}${dir.includes("\\") ? "\\" : "/"}${segment}`

const decodeBase64Text = (value: string) => {
  const binary = atob(value)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/**
 * ZCode 插件市场（对齐 ZCode 的 PluginStorePage）。
 *
 * 版面与 ZCode 一致：
 * - 顶部标题 + 刷新/添加；
 * - 搜索框；
 * - 「已安装」一排图标；
 * - 「公开 / 个人」分段；公开按分类两列铺插件行（图标 + 名称 + 描述 + 安装）。
 *
 * 目录优先拉线上 manifest（46+ 插件）；拉不到时回退到随包的快照目录。
 * 下载在主进程（绕开 CORS），解压用 JSZip，写盘回到主进程；
 * 安装后自动注册 skills 路径与 MCP 服务。
 */
export const PluginMarketplaceSection: Component<{ onBack?: () => void }> = (props) => {
  const language = useLanguage()
  const platform = usePlatform()
  const globalSync = useGlobalSync()
  const dialog = useDialog()
  const [installed, setInstalled] = createStore<{ list: InstalledPlugin[] }>({ list: [] })
  const [catalog, setCatalog] = createSignal<ZcodeMarketplaceEntry[]>(ZCODE_MARKETPLACE)
  const [tab, setTab] = createSignal<"public" | "personal">("public")
  const [pending, setPending] = createSignal<string | undefined>()
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | undefined>()
  const [query, setQuery] = createSignal("")

  const storage = () => platform.storage?.()
  const supported = () => typeof window !== "undefined" && !!window.api?.marketplaceInstall

  const loadManifest = async () => {
    if (!window.api?.marketplaceDownload) return
    setLoading(true)
    try {
      const base64 = await window.api.marketplaceDownload(ZCODE_MARKETPLACE_URL)
      const entries = parseZcodeMarketplace(JSON.parse(decodeBase64Text(base64)))
      if (entries.length > 0) {
        setCatalog(entries)
        void storage()?.setItem(MANIFEST_FIELD, JSON.stringify(entries))
      }
      setError(undefined)
    } catch (err) {
      // 线上拉取失败不算错误：继续用缓存/内置目录。
      console.warn("[marketplace] manifest fetch failed", err)
    } finally {
      setLoading(false)
    }
  }

  onMount(async () => {
    const rawInstalled = await storage()?.getItem(INSTALLED_FIELD)
    if (typeof rawInstalled === "string") {
      try {
        const parsed: unknown = JSON.parse(rawInstalled)
        if (Array.isArray(parsed)) {
          setInstalled(
            "list",
            parsed.filter((item): item is InstalledPlugin => isRecord(item) && typeof item.name === "string"),
          )
        }
      } catch {
        // 忽略损坏的安装记录
      }
    }
    const rawManifest = await storage()?.getItem(MANIFEST_FIELD)
    if (typeof rawManifest === "string") {
      try {
        const parsed: unknown = JSON.parse(rawManifest)
        if (Array.isArray(parsed) && parsed.length > 0) setCatalog(parsed as ZcodeMarketplaceEntry[])
      } catch {
        // 忽略损坏的缓存目录
      }
    }
    await loadManifest()
  })

  const persist = (list: InstalledPlugin[]) => {
    setInstalled("list", list)
    void storage()?.setItem(INSTALLED_FIELD, JSON.stringify(list))
  }

  const find = (name: string) => installed.list.find((item) => item.name === name)
  const entryOf = (name: string) => catalog().find((item) => item.name === name)

  const displayName = (entry: ZcodeMarketplaceEntry) =>
    entry.displayName || entry.displayNameEn || entry.name.replace(/(^|[\s-])([a-z])/g, (_, sep, char) => `${sep}${char.toUpperCase()}`)

  const filtered = createMemo(() => {
    const value = query().trim().toLowerCase()
    if (!value) return catalog()
    return catalog().filter((entry) =>
      [entry.name, entry.displayName, entry.displayNameEn, entry.description, entry.descriptionEn, entry.author ?? "", ...entry.keywords]
        .join(" ")
        .toLowerCase()
        .includes(value),
    )
  })

  /** 按分类分组；分类顺序固定，未知分类排在最后。 */
  const groups = createMemo(() => {
    const map = new Map<string, ZcodeMarketplaceEntry[]>()
    for (const entry of filtered()) {
      const key = entry.category ?? "other"
      const list = map.get(key)
      if (list) list.push(entry)
      else map.set(key, [entry])
    }
    const known = CATEGORY_ORDER.filter((key) => map.has(key))
    const rest = [...map.keys()].filter((key) => !(CATEGORY_ORDER as readonly string[]).includes(key))
    return [...known, ...rest].map((key) => ({ key, entries: map.get(key) ?? [] }))
  })

  const readManifest = async (zip: JSZip, names: string[]) => {
    const pluginJson = names.find((name) => name.endsWith("/.zcode-plugin/plugin.json") || name === ".zcode-plugin/plugin.json")
    const mcpJson = names.find((name) => name.endsWith("/.mcp.json") || name === ".mcp.json")
    const manifest = pluginJson ? safeJson(await zip.file(pluginJson)?.async("string")) : undefined
    const mcp = mcpJson ? safeJson(await zip.file(mcpJson)?.async("string")) : undefined
    return {
      version: isRecord(manifest) && typeof manifest.version === "string" ? manifest.version : undefined,
      mcpServers: isRecord(mcp) && isRecord(mcp.mcpServers) ? mcp.mcpServers : undefined,
    }
  }

  const install = async (entry: ZcodeMarketplaceEntry) => {
    const api = window.api
    if (!supported() || !api?.marketplaceDownload || !api.marketplaceInstall) {
      setError(language.t("settings.plugins.market.unsupported" as never))
      return
    }
    setPending(entry.name)
    setError(undefined)
    try {
      const base64 = await api.marketplaceDownload(entry.url)
      const zip = await JSZip.loadAsync(base64, { base64: true })
      const names = Object.keys(zip.files).filter((name) => !zip.files[name]?.dir)
      // 所有条目都在一个顶层目录里；去掉它，安装目录本身作为插件根。
      const prefix = names[0]?.includes("/") ? names[0].split("/")[0] + "/" : ""
      const files = await Promise.all(
        names.map(async (name) => ({
          path: prefix && name.startsWith(prefix) ? name.slice(prefix.length) : name,
          data: await zip.files[name]!.async("base64"),
        })),
      )
      const meta = await readManifest(zip, names)
      const version = entry.version || meta.version || "0.0.0"
      const dir = await api.marketplaceInstall({ dir: `${entry.name}@${version}`, files })

      const config = globalSync.data.config
      const hasSkills = files.some((file) => file.path.startsWith("skills/") && file.path.endsWith("/SKILL.md"))
      const skillPath = hasSkills ? joinPath(dir, "skills") : undefined
      const nextSkills = skillPath
        ? { ...(config.skills ?? {}), paths: [...new Set([...(config.skills?.paths ?? []), skillPath])] }
        : config.skills
      const mcpNames: string[] = []
      let nextMcp = config.mcp
      if (meta.mcpServers) {
        const merged: Record<string, unknown> = isRecord(config.mcp) ? { ...config.mcp } : {}
        for (const [name, value] of Object.entries(meta.mcpServers)) {
          if (!isRecord(value)) continue
          const command = typeof value.command === "string" ? value.command : undefined
          const args = Array.isArray(value.args) ? value.args.filter((item): item is string => typeof item === "string") : []
          // 已存在的同名服务不覆盖：用户自己的配置优先。
          if (merged[name]) continue
          merged[name] = {
            type: "local",
            enabled: value.enabled !== false,
            ...(command ? { command: [command, ...args] } : {}),
            ...(isRecord(value.env) ? { environment: value.env } : {}),
          }
          mcpNames.push(name)
        }
        nextMcp = merged as Config["mcp"]
      }
      await globalSync.updateConfig({ skills: nextSkills, mcp: nextMcp } as Config)
      persist([
        ...installed.list.filter((item) => item.name !== entry.name),
        { name: entry.name, version, dir, skillPath, mcpNames },
      ])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(undefined)
    }
  }

  const uninstall = async (entry: InstalledPlugin) => {
    const api = window.api
    setPending(entry.name)
    setError(undefined)
    try {
      const config = globalSync.data.config
      const nextSkills = entry.skillPath
        ? { ...(config.skills ?? {}), paths: (config.skills?.paths ?? []).filter((path) => path !== entry.skillPath) }
        : config.skills
      let nextMcp = config.mcp
      if (entry.mcpNames.length && isRecord(config.mcp)) {
        const merged = { ...config.mcp }
        for (const name of entry.mcpNames) delete merged[name]
        nextMcp = merged as Config["mcp"]
      }
      await globalSync.updateConfig({ skills: nextSkills, mcp: nextMcp } as Config)
      await api?.marketplaceRemove?.(entry.dir)
      persist(installed.list.filter((item) => item.name !== entry.name))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(undefined)
    }
  }

  const builtinEnabled = (item: BuiltinExtension) => {
    if (item.toggle === "browser") {
      const mcp = globalSync.data.config.mcp
      const browser = isRecord(mcp) && isRecord(mcp.browser) ? mcp.browser : undefined
      return browser?.enabled !== false
    }
    if (item.toggle === "memory") return globalSync.data.config.memory?.enabled !== false
    return true
  }

  const setBuiltin = (item: BuiltinExtension, value: boolean) => {
    const config = globalSync.data.config
    if (item.toggle === "browser") {
      const mcp = isRecord(config.mcp) ? config.mcp : {}
      const browser = isRecord(mcp.browser) ? mcp.browser : {}
      void globalSync.updateConfig({ mcp: { ...mcp, browser: { ...browser, enabled: value } } } as Config)
      return
    }
    if (item.toggle === "memory") {
      void globalSync.updateConfig({ memory: { ...(config.memory ?? {}), enabled: value } } as Config)
    }
  }

  const openDetail = (input: {
    entry?: ZcodeMarketplaceEntry
    builtin?: BuiltinExtension
    installed?: InstalledPlugin
  }) => {
    const item = input.builtin
    dialog.show(() => (
      <ExtensionDetail
        entry={input.entry}
        builtin={item}
        installed={input.installed}
        enabled={item ? builtinEnabled(item) : undefined}
        supported={supported()}
        pending={pending() === (input.entry?.name ?? item?.id)}
        onToggle={item ? (value) => setBuiltin(item, value) : undefined}
        onInstall={input.entry && !input.installed ? () => void install(input.entry!) : undefined}
        onUninstall={input.installed ? () => void uninstall(input.installed!) : undefined}
      />
    ))
  }

  const installButton = (entry: ZcodeMarketplaceEntry) => (
    <Show
      when={find(entry.name)}
      fallback={
        <Button
          variant="secondary"
          size="small"
          class="shrink-0 rounded-full"
          disabled={pending() === entry.name || !supported()}
          onClick={() => void install(entry)}
        >
          {pending() === entry.name
            ? language.t("settings.plugins.market.installing" as never)
            : language.t("settings.plugins.store.install" as never)}
        </Button>
      }
    >
      {(item) => (
        <DropdownMenu gutter={4} placement="bottom-end">
          <DropdownMenu.Trigger
            as={IconButton}
            icon="dot-grid"
            variant="ghost"
            size="small"
            class="shrink-0 text-foreground-subtle"
            aria-label={language.t("common.moreOptions")}
          />
          <DropdownMenu.Portal>
            <DropdownMenu.Content style={{ "min-width": "160px" }}>
              <DropdownMenu.Item disabled>
                <DropdownMenu.ItemLabel>
                  {language.t("settings.plugins.market.installed" as never)} · v{item().version}
                </DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
              <DropdownMenu.Separator />
              <DropdownMenu.Item onSelect={() => void uninstall(item())}>
                <DropdownMenu.ItemLabel>{language.t("settings.plugins.store.uninstall" as never)}</DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu>
      )}
    </Show>
  )

  const pluginRow = (entry: ZcodeMarketplaceEntry) => (
    <div
      role="button"
      tabindex="0"
      class="flex min-w-0 cursor-pointer items-start gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-hover"
      onClick={() => openDetail({ entry, installed: find(entry.name) })}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          openDetail({ entry, installed: find(entry.name) })
        }
      }}
    >
      <span class="grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-surface">
        <Show
          when={entry.icon}
          fallback={<Icon name="dot-grid" class="size-5 text-foreground-subtle" />}
        >
          <img src={entry.icon} alt="" class="size-6 object-contain" loading="lazy" />
        </Show>
      </span>
      <div class="flex min-w-0 flex-1 flex-col">
        <div class="flex min-w-0 items-center gap-2">
          <span class="truncate text-13-medium text-foreground">{displayName(entry)}</span>
          <Show when={entry.requiresPaidPlan}>
            <Tag>{language.t("settings.plugins.market.paid" as never)}</Tag>
          </Show>
        </div>
        <span class="mt-0.5 line-clamp-2 text-12-regular leading-5 text-foreground-subtle">
          {entry.description || entry.descriptionEn}
        </span>
        <span class="mt-1 flex flex-wrap items-center gap-1.5">
          <For each={entry.components ?? []}>
            {(component) => (
              <span class="rounded bg-surface px-1.5 py-0.5 text-10-medium text-foreground-subtlest">
                {componentLabel[component] ? language.t(componentLabel[component] as never) : component}
              </span>
            )}
          </For>
        </span>
      </div>
      <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
        {installButton(entry)}
      </div>
    </div>
  )

  const builtinRow = (item: BuiltinExtension) => (
    <div
      role="button"
      tabindex="0"
      class="flex min-w-0 cursor-pointer items-start gap-3 border-t border-border px-4 py-3 text-left transition-colors first:border-t-0 hover:bg-hover"
      onClick={() => openDetail({ builtin: item })}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          openDetail({ builtin: item })
        }
      }}
    >
      <span class="grid size-10 shrink-0 place-items-center rounded-xl bg-surface">
        <Icon name={item.icon} class="size-5 text-foreground-subtle" />
      </span>
      <div class="flex min-w-0 flex-1 flex-col">
        <div class="flex min-w-0 flex-wrap items-center gap-2">
          <span class="truncate text-13-medium text-foreground">{item.name}</span>
          <Tag>{language.t("settings.plugins.market.builtin" as never)}</Tag>
          <Show when={item.available === false}>
            <Tag>{language.t("settings.plugins.market.unavailable" as never)}</Tag>
          </Show>
        </div>
        <span class="mt-0.5 line-clamp-2 text-12-regular leading-5 text-foreground-subtle">{item.description}</span>
        <span class="mt-1 flex flex-wrap items-center gap-1.5">
          <For each={item.components}>
            {(component) => (
              <span class="rounded bg-surface px-1.5 py-0.5 text-10-medium text-foreground-subtlest">
                {componentLabel[component] ? language.t(componentLabel[component] as never) : component}
              </span>
            )}
          </For>
        </span>
      </div>
      <Show
        when={item.available !== false && item.toggle}
        fallback={
          <span class="shrink-0 text-11-regular text-foreground-subtlest">
            {item.available === false
              ? language.t("settings.plugins.market.unavailable" as never)
              : language.t("settings.plugins.market.alwaysOn" as never)}
          </span>
        }
      >
        <div onClick={(event) => event.stopPropagation()}>
          <Switch checked={builtinEnabled(item)} onChange={(value) => setBuiltin(item, value)} hideLabel>
            {item.name}
          </Switch>
        </div>
      </Show>
    </div>
  )

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--popover)_calc(100%_-_24px),transparent)]">
        <div class="flex items-start justify-between gap-4 pt-6 pb-6">
          <div class="flex min-w-0 flex-col gap-1">
            <Show when={props.onBack}>
              <div class="-mt-2 mb-1 flex items-center gap-2">
                <button
                  type="button"
                  class="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-13-medium text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
                  onClick={() => props.onBack?.()}
                >
                  <Icon name="arrow-left" size="small" />
                  {language.t("common.goBack")}
                </button>
              </div>
            </Show>
            <h2 class="text-16-medium text-foreground">{language.t("settings.plugins.market.title" as never)}</h2>
            <p class="text-13-regular text-foreground-subtle">
              {language.t("settings.plugins.market.description" as never)}
            </p>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <IconButton
              icon="reset"
              variant="ghost"
              aria-label={language.t("settings.plugins.store.refresh" as never)}
              disabled={loading() || !window.api?.marketplaceDownload}
              onClick={() => void loadManifest()}
            />
          </div>
        </div>
      </div>

      <div class="flex flex-col gap-6 w-full">
        <label class="flex h-10 w-full items-center gap-2 rounded-lg border border-border bg-background px-3">
          <Icon name="magnifying-glass" size="small" class="shrink-0 text-foreground-subtle" />
          <input
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
            placeholder={language.t("settings.plugins.market.search" as never)}
            class="h-full min-w-0 flex-1 bg-transparent text-13-regular text-foreground outline-none placeholder:text-foreground-subtlest"
          />
        </label>

        <div class="flex flex-col gap-2">
          <h3 class="text-14-medium text-foreground">
            {language.t("settings.plugins.market.builtinSection" as never)}
          </h3>
          <SettingsGroup>
            <For each={BUILTIN_EXTENSIONS}>{(item) => builtinRow(item)}</For>
          </SettingsGroup>
        </div>

        <Show when={installed.list.length > 0}>
          <div class="flex flex-col gap-2">
            <h3 class="text-14-medium text-foreground">{language.t("settings.plugins.market.installedSection" as never)}</h3>
            <div class="flex flex-wrap gap-2">
              <For each={installed.list}>
                {(item) => (
                  <button
                    type="button"
                    title={`${displayName(entryOf(item.name) ?? (item as ZcodeMarketplaceEntry))} v${item.version}`}
                    class="grid size-10 place-items-center overflow-hidden rounded-xl border border-border bg-surface transition-colors hover:border-border-hover"
                    aria-label={displayName(entryOf(item.name) ?? (item as ZcodeMarketplaceEntry))}
                    onClick={() => openDetail({ entry: entryOf(item.name), installed: item })}
                  >
                    <Show
                      when={entryOf(item.name)?.icon}
                      fallback={<Icon name="dot-grid" class="size-5 text-foreground-subtle" />}
                    >
                      <img src={entryOf(item.name)!.icon} alt="" class="size-6 object-contain" />
                    </Show>
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>

        <div class="flex items-center gap-1">
          <button
            type="button"
            class="h-8 rounded-full px-3.5 text-13-medium transition-colors"
            classList={{
              "bg-surface text-foreground": tab() === "public",
              "text-foreground-subtle hover:text-foreground": tab() !== "public",
            }}
            onClick={() => setTab("public")}
          >
            {language.t("settings.plugins.market.tab.public" as never)}
          </button>
          <button
            type="button"
            class="h-8 rounded-full px-3.5 text-13-medium transition-colors"
            classList={{
              "bg-surface text-foreground": tab() === "personal",
              "text-foreground-subtle hover:text-foreground": tab() !== "personal",
            }}
            onClick={() => setTab("personal")}
          >
            {language.t("settings.plugins.market.tab.personal" as never)}
          </button>
        </div>

        <Show when={tab() === "public"}>
          <Show
            when={filtered().length > 0}
            fallback={
              <div class="rounded-xl border border-dashed border-border px-4 py-10 text-center text-13-regular text-foreground-subtle">
                {language.t("settings.plugins.market.empty" as never)}
              </div>
            }
          >
            <For each={groups()}>
              {(group) => (
                <div class="flex flex-col gap-2">
                  <h3 class="text-14-medium text-foreground">
                    {categoryLabel[group.key]
                      ? language.t(categoryLabel[group.key] as never)
                      : language.t("settings.plugins.market.category.other" as never)}
                  </h3>
                  <div class="grid grid-cols-1 gap-x-8 md:grid-cols-2">
                    <For each={group.entries}>{(entry) => pluginRow(entry)}</For>
                  </div>
                </div>
              )}
            </For>
          </Show>
        </Show>

        <Show when={tab() === "personal"}>
          <PluginStoreSection installed={[]} onInstall={() => undefined} onUninstall={() => undefined} hideTitle />
        </Show>

        <Show when={!supported()}>
          <p class="text-12-regular text-foreground-subtle">
            {language.t("settings.plugins.market.unsupported" as never)}
          </p>
        </Show>
        <Show when={error()}>
          {(message) => <p class="break-words text-12-regular text-destructive">{message()}</p>}
        </Show>
      </div>
    </div>
  )
}

function safeJson(raw: string | undefined): unknown {
  if (typeof raw !== "string") return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

/**
 * 扩展详情弹窗。
 *
 * 市场条目、内置扩展、已安装条目共用同一套详情：点击列表项就能看到
 * 「这是什么、装了哪些组件、装到哪里、怎么调用」，而不是只有一个安装按钮。
 */
const ExtensionDetail: Component<{
  entry?: ZcodeMarketplaceEntry
  builtin?: BuiltinExtension
  installed?: InstalledPlugin
  enabled?: boolean
  supported: boolean
  pending: boolean
  onToggle?: (value: boolean) => void
  onInstall?: () => void
  onUninstall?: () => void
}> = (props) => {
  const language = useLanguage()
  const dialog = useDialog()
  const name = () => props.entry?.displayName || props.builtin?.name || props.installed?.name || ""
  const description = () => props.entry?.description || props.entry?.descriptionEn || props.builtin?.description || ""
  const components = () => props.entry?.components ?? props.builtin?.components ?? []
  const version = () => props.installed?.version ?? props.entry?.version

  const infoRow = (label: string, value: string) => (
    <div class="flex items-start justify-between gap-4 border-t border-border py-2 text-12-regular first:border-t-0">
      <span class="shrink-0 text-foreground-subtle">{label}</span>
      <span class="min-w-0 break-all text-right text-foreground">{value}</span>
    </div>
  )

  return (
    <Dialog title={name()} transition class="w-[min(calc(100vw-40px),560px)]">
      <div class="flex flex-col gap-3 px-2.5 pb-3">
        <p class="text-13-regular leading-6 text-foreground-subtle">{description()}</p>
        <Show when={props.builtin?.available === false}>
          <p class="rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-12-regular leading-5 text-foreground-subtle">
            {props.builtin?.unavailableReason}
          </p>
        </Show>

        <div class="flex flex-wrap items-center gap-1.5">
          <For each={components()}>
            {(component) => (
              <Tag>{componentLabel[component] ? language.t(componentLabel[component] as never) : component}</Tag>
            )}
          </For>
          <Show when={props.entry?.requiresPaidPlan}>
            <Tag>{language.t("settings.plugins.market.paid" as never)}</Tag>
          </Show>
        </div>

        <div class="rounded-lg border border-border bg-surface px-3 py-1.5">
          <Show when={version()}>{infoRow(language.t("settings.plugins.market.detail.version" as never), version()!)}</Show>
          <Show when={props.entry?.author}>
            {(author) => infoRow(language.t("settings.plugins.market.detail.author" as never), author())}
          </Show>
          <Show when={props.entry?.category}>
            {infoRow(
              language.t("settings.plugins.market.detail.category" as never),
              categoryLabel[props.entry!.category!]
                ? language.t(categoryLabel[props.entry!.category!] as never)
                : props.entry!.category!,
            )}
          </Show>
          <Show when={props.installed}>
            {(item) => (
              <>
                {infoRow(language.t("settings.plugins.market.detail.installedAt" as never), item().dir)}
                <Show when={item().skillPath}>
                  {infoRow(
                    language.t("settings.plugins.market.detail.skillPath" as never),
                    item().skillPath!,
                  )}
                </Show>
                <Show when={item().mcpNames.length > 0}>
                  {infoRow(
                    language.t("settings.plugins.market.detail.mcpServers" as never),
                    item().mcpNames.join("、"),
                  )}
                </Show>
              </>
            )}
          </Show>
        </div>

        <p class="text-12-regular leading-5 text-foreground-subtle">
          {language.t("settings.plugins.market.detail.usage" as never)}
        </p>

        <div class="flex items-center justify-end gap-2 pt-1">
          <Show when={props.onUninstall}>
            <Button
              variant="ghost"
              size="small"
              disabled={props.pending}
              onClick={() => {
                props.onUninstall?.()
                dialog.close()
              }}
            >
              {language.t("settings.plugins.store.uninstall" as never)}
            </Button>
          </Show>
          <Show when={props.onInstall}>
            <Button
              variant="primary"
              size="small"
              disabled={props.pending || !props.supported}
              onClick={() => {
                props.onInstall?.()
                dialog.close()
              }}
            >
              {language.t("settings.plugins.store.install" as never)}
            </Button>
          </Show>
          <Show when={props.onToggle && props.builtin?.available !== false}>
            <div class="flex items-center gap-2">
              <span class="text-12-regular text-foreground-subtle">
                {language.t("settings.plugins.market.detail.enabled" as never)}
              </span>
              <Switch checked={props.enabled ?? true} onChange={(value) => props.onToggle?.(value)}>
                {name()}
              </Switch>
            </div>
          </Show>
          <Button variant="secondary" size="small" onClick={() => dialog.close()}>
            {language.t("common.close")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
