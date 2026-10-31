import { createSignal, For, Show, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon } from "@novaway/ui/icon"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { NOVAWAY_MARKETPLACE_ENTRIES } from "@/constants/novaway-marketplace"
import { AppIcon } from "./app-icon"

type CatalogEntry = {
  name: string
  version?: string
  description?: string
  descriptionKey?: string
  url: string
  sha256?: string
  ref?: string
  subdir?: string
  /** 远程目录里 zcode 是 zip 包、claude 和内置条目是 git 仓库。 */
  kind: "zip" | "git"
}

type InstalledEntry = { name: string; root: string; version?: string }

type Pending = { name: string; phase: "progress" | "success" | "error"; message?: string }

const text = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * 插件选择器里的「市场」段 —— 对齐 ZCode 从市场安装插件的三态。
 *
 * 内置插件随包提供（开关只是启用/停用）；真正需要"安装"的是市场上的包。
 * 这里不复制市场的整套目录 UI，只做一件事：把**还没装**的包列出来，
 * 点一下就按「安装中 → 成功 / 失败（可重试）」走完，
 * 走的是内核 `extension/marketplace/install`，和扩展页是同一套安装逻辑与记录。
 */
export const OfficePluginMarket: Component<{ directory?: string }> = (props) => {
  const sdk = useGlobalSDK()
  const language = useLanguage()
  const [store, setStore] = createStore({
    entries: [] as CatalogEntry[],
    loading: false,
    error: "",
  })
  const [pending, setPending] = createSignal<Pending>()
  const [loaded, setLoaded] = createSignal(false)

  const load = () => {
    const directory = props.directory
    if (!directory) return
    setStore("loading", true)
    void sdk.client.extension
      .marketplaceCatalog({ directory })
      .then((result) => {
        const data = result.data
        if (!data) return
        // 已安装的包不在这里重复列出 —— 它们属于「内核已加载的扩展」，
        // 在扩展页可以看详情和卸载；这个列表只回答「还能装什么」。
        const names = new Set((data.installed as InstalledEntry[]).map((item) => item.name))
        // 顺序：内置推荐 → ZCode（zip，官方插件主要来自这里）→ Claude（git）。
        // 同一条目只认第一个：内置条目和远程目录重名时以内置的安装方式为准。
        const seen = new Set<string>()
        const entries = [
          ...NOVAWAY_MARKETPLACE_ENTRIES.map((entry) => ({ ...entry })),
          ...(data.zcode as Omit<CatalogEntry, "kind">[]).map((entry) => ({ ...entry, kind: "zip" as const })),
          ...(data.claude as Omit<CatalogEntry, "kind">[]).map((entry) => ({ ...entry, kind: "git" as const })),
        ].filter((entry) => {
          if (names.has(entry.name) || seen.has(entry.name)) return false
          seen.add(entry.name)
          return true
        })
        setStore({ entries, error: "" })
      })
      .catch((error: unknown) => setStore("error", text(error)))
      .finally(() => {
        setStore("loading", false)
        setLoaded(true)
      })
  }

  const install = (entry: CatalogEntry) => {
    const directory = props.directory
    if (!directory) return
    setPending({ name: entry.name, phase: "progress" })
    void sdk.client.extension
      .marketplaceInstall({
        directory,
        kind: entry.kind,
        name: entry.name,
        url: entry.url,
        version: entry.version,
        sha256: entry.sha256,
        ref: entry.ref,
        subdir: entry.subdir,
      })
      .then(() => {
        setPending({ name: entry.name, phase: "success" })
        setStore("entries", (list) => list.filter((item) => item.name !== entry.name))
        window.setTimeout(() => setPending(undefined), 1500)
        load()
      })
      .catch((error: unknown) => setPending({ name: entry.name, phase: "error", message: text(error) }))
  }

  const phaseOf = (name: string) => (pending()?.name === name ? pending()?.phase : undefined)

  return (
    <div class="flex flex-col gap-2">
      <div class="flex items-center gap-2">
        <span class="shrink-0 text-12-medium text-foreground">{language.t("office.plugin.market.title")}</span>
        <span class="min-w-0 flex-1 truncate text-11-regular text-foreground-subtle">
          {language.t("office.plugin.market.hint")}
        </span>
        <button
          type="button"
          class="shrink-0 rounded-md px-1.5 py-0.5 text-11-regular text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
          disabled={store.loading}
          onClick={load}
        >
          {store.loading ? language.t("office.plugin.market.loading") : language.t("office.plugin.market.refresh")}
        </button>
      </div>

      <Show when={store.error}>{(message) => <div class="text-11-regular text-warning">{message()}</div>}</Show>

      <Show when={!props.directory}>
        <div class="text-11-regular text-foreground-subtle">{language.t("office.plugin.market.needProject")}</div>
      </Show>

      <Show when={props.directory && loaded() && store.entries.length === 0 && !store.error}>
        <div class="text-11-regular text-foreground-subtle">{language.t("office.plugin.market.empty")}</div>
      </Show>

      <div class="flex max-h-56 flex-col gap-1 overflow-y-auto pr-1">
        <For each={store.entries}>
          {(entry) => (
            <div
              data-component="office-plugin-market-row"
              class="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-hover/60"
            >
              <AppIcon seed={entry.name} fallback="mcp" size="xs" />
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5">
                  <span class="truncate text-12-medium text-foreground">{entry.name}</span>
                  <Show when={entry.version}>
                    <span class="shrink-0 text-10-medium text-foreground-subtlest">{entry.version}</span>
                  </Show>
                </div>
                <Show when={entry.descriptionKey ?? entry.description}>
                  <div class="truncate text-11-regular text-foreground-subtle">
                    {entry.descriptionKey ? language.t(entry.descriptionKey as never) : entry.description}
                  </div>
                </Show>
                <Show when={phaseOf(entry.name) === "error"}>
                  <div class="truncate text-11-regular text-warning" title={pending()?.message}>
                    {language.t("office.plugin.market.failed", { message: pending()?.message ?? "" })}
                  </div>
                </Show>
              </div>
              <Show when={phaseOf(entry.name) === "progress"}>
                <span class="size-3.5 shrink-0 animate-spin rounded-full border-2 border-border border-t-foreground" />
                <span class="shrink-0 text-11-regular text-foreground-subtle">
                  {language.t("office.plugin.market.installing")}
                </span>
              </Show>
              <Show when={phaseOf(entry.name) === "success"}>
                <Icon name="check" size="small" class="size-4 shrink-0 text-foreground" />
                <span class="shrink-0 text-11-regular text-foreground-subtle">
                  {language.t("office.plugin.market.installed")}
                </span>
              </Show>
              <Show when={!phaseOf(entry.name) || phaseOf(entry.name) === "error"}>
                <button
                  type="button"
                  class="h-6 shrink-0 rounded-md border border-border px-2 text-11-medium text-foreground transition-colors hover:bg-hover"
                  onClick={() => install(entry)}
                >
                  {phaseOf(entry.name) === "error"
                    ? language.t("office.plugin.action.retry")
                    : language.t("office.plugin.market.install")}
                </button>
              </Show>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}
