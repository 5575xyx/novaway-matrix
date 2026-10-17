import type { Config } from "@novaway/sdk/v2/client"
import JSZip from "jszip"
import { Button } from "@novaway/ui/button"
import { Icon } from "@novaway/ui/icon"
import { Tag } from "@novaway/ui/tag"
import { createSignal, For, onMount, Show, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { ZCODE_MARKETPLACE, type ZcodeMarketplaceEntry } from "@/constants/zcode-marketplace"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { SettingsGroup } from "./settings-parts"

const INSTALLED_FIELD = "plugin.marketplace.v1"

type InstalledPlugin = {
  name: string
  version: string
  dir: string
  /** 安装时注册到 config.skills.paths 的路径（没有 skills 则为空）。 */
  skillPath?: string
  /** 安装时注册到 config.mcp 的服务名。 */
  mcpNames: string[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value)

const joinPath = (dir: string, segment: string) =>
  `${dir.replace(/[\/]+$/, "")}${dir.includes("\\") ? "\\" : "/"}${segment}`

/**
 * ZCode 官方插件市场（目录来自 FreeCodeZ 的 official-snapshot.json）。
 *
 * ZCode 的插件不是 npm 包，而是「技能 + MCP 清单」的 zip：
 * - `skills/**` 注册到 `config.skills.paths`，由技能扫描器加载；
 * - `.mcp.json` 里的 `mcpServers` 合并进 `config.mcp`。
 *
 * 下载在 Electron 主进程做（绕开 CORS），解压用 JSZip，写盘回到主进程。
 * 浏览器环境没有写盘能力，按钮会提示不可用而不是假装成功。
 */
export const PluginMarketplaceSection: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()
  const globalSync = useGlobalSync()
  const [installed, setInstalled] = createStore<{ list: InstalledPlugin[] }>({ list: [] })
  const [pending, setPending] = createSignal<string | undefined>()
  const [error, setError] = createSignal<string | undefined>()
  const [query, setQuery] = createSignal("")

  const storage = () => platform.storage?.()

  const supported = () => typeof window !== "undefined" && !!window.api?.marketplaceInstall

  onMount(async () => {
    const raw = await storage()?.getItem(INSTALLED_FIELD)
    if (typeof raw !== "string") return
    try {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        setInstalled("list", parsed.filter((item): item is InstalledPlugin => isRecord(item) && typeof item.name === "string"))
      }
    } catch {
      // 解析失败当作没有安装记录。
    }
  })

  const persist = (list: InstalledPlugin[]) => {
    setInstalled("list", list)
    void storage()?.setItem(INSTALLED_FIELD, JSON.stringify(list))
  }

  const find = (name: string) => installed.list.find((item) => item.name === name)

  const filtered = () => {
    const value = query().trim().toLowerCase()
    if (!value) return ZCODE_MARKETPLACE
    return ZCODE_MARKETPLACE.filter((entry) =>
      [entry.name, entry.description, entry.descriptionEn, entry.author ?? "", ...entry.keywords]
        .join(" ")
        .toLowerCase()
        .includes(value),
    )
  }

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

  return (
    <div>
      <div class="flex flex-col gap-1 pb-2">
        <h3 class="text-14-medium text-foreground">{language.t("settings.plugins.market.title" as never)}</h3>
        <p class="text-12-regular text-foreground-subtle">
          {language.t("settings.plugins.market.description" as never)}
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2 pb-3">
        <input
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
          placeholder={language.t("settings.plugins.market.search" as never)}
          class="h-8 w-full max-w-md rounded-md border border-border bg-background px-2.5 text-13-regular text-foreground outline-none focus:border-border-hover"
        />
        <Tag>{`${ZCODE_MARKETPLACE.length}`}</Tag>
      </div>
      <SettingsGroup>
        <Show
          when={filtered().length > 0}
          fallback={
            <div class="px-4 py-6 text-center text-13-regular text-foreground-subtle">
              {language.t("settings.plugins.market.empty" as never)}
            </div>
          }
        >
          <For each={filtered()}>
            {(entry) => {
              const current = () => find(entry.name)
              return (
                <div class="flex min-w-0 items-center gap-3 border-t border-border px-4 py-3 transition-colors first:border-t-0 hover:bg-hover">
                  <span class="grid size-9 shrink-0 place-items-center overflow-hidden rounded-xl bg-background">
                    <Show
                      when={entry.icon}
                      fallback={<Icon name="dot-grid" class="size-4.5 icon-strong-base" />}
                    >
                      <img src={entry.icon} alt="" class="size-6 object-contain" />
                    </Show>
                  </span>
                  <div class="flex min-w-0 flex-1 flex-col">
                    <div class="flex min-w-0 flex-wrap items-center gap-2">
                      <span class="truncate text-13-medium text-foreground">{entry.name}</span>
                      <Tag>{entry.version || "—"}</Tag>
                      <Show when={entry.author}>
                        <span class="truncate text-11-regular text-foreground-subtlest">{entry.author}</span>
                      </Show>
                    </div>
                    <span class="mt-0.5 line-clamp-2 text-12-regular text-foreground-subtle">{entry.description}</span>
                  </div>
                  <Show
                    when={current()}
                    fallback={
                      <Button
                        variant="secondary"
                        size="small"
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
                      <div class="flex shrink-0 items-center gap-2">
                        <span class="text-11-regular text-foreground-subtlest">
                          {language.t("settings.plugins.market.installed" as never)}
                        </span>
                        <Button
                          variant="ghost"
                          size="small"
                          disabled={pending() === entry.name}
                          onClick={() => void uninstall(item())}
                        >
                          {language.t("settings.plugins.store.uninstall" as never)}
                        </Button>
                      </div>
                    )}
                  </Show>
                </div>
              )
            }}
          </For>
        </Show>
      </SettingsGroup>
      <Show when={!supported()}>
        <p class="pt-2 text-12-regular text-foreground-subtle">
          {language.t("settings.plugins.market.unsupported" as never)}
        </p>
      </Show>
      <Show when={error()}>
        {(message) => <p class="pt-2 break-words text-12-regular text-destructive">{message()}</p>}
      </Show>
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
