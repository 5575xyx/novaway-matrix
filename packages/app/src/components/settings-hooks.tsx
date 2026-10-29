import { createMemo, createSignal, For, onMount, Show, type Component } from "solid-js"
import { Button } from "@novaway/ui/button"
import { Icon } from "@novaway/ui/icon"
import { Tag } from "@novaway/ui/tag"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { getFilename } from "@novaway/core/util/path"
import type { HookActiveView, HookRegistrationView } from "@novaway/sdk/v2"
import { HOOK_EVENTS } from "@/constants/hooks"
import { SettingsGroup } from "./settings-parts"

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Hook 设置页。
 *
 * 之前只在扩展页底部露出一小块「生效中的 Hook」，既看不到支持哪些事件，
 * 也看不出某个事件到底在什么时机触发。这里把三件事分开：
 *  - 支持的事件：固定清单 + 一句解释，没被监听也照常列出；
 *  - 注册来源：哪个文件 / 扩展注册了哪些事件（只显示路径与类型，命令体不展示）；
 *  - 正在执行：声明了 statusMessage 的 Hook，用来看「这一回合为什么慢」。
 */
export const SettingsHooks: Component<{ directory?: string }> = (props) => {
  const sdk = useGlobalSDK()
  const language = useLanguage()
  const [items, setItems] = createSignal<HookRegistrationView[]>([])
  const [active, setActive] = createSignal<HookActiveView[]>([])
  const [error, setError] = createSignal("")
  const [busy, setBusy] = createSignal(false)

  const load = () => {
    setBusy(true)
    Promise.all([
      sdk.client.hook.list({ directory: props.directory }),
      sdk.client.hook.active({ directory: props.directory }),
    ])
      .then(([list, running]) => {
        setItems((list.data ?? []) as HookRegistrationView[])
        setActive((running.data ?? []) as HookActiveView[])
        setError("")
      })
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setBusy(false))
  }

  onMount(load)

  const listened = createMemo(() => new Set(items().map((item) => item.event)))
  /** count 在 JSON 里可能是字符串，先归一化再累加。 */
  const registrations = createMemo(() => items().reduce((total, item) => total + Number(item.count), 0))

  /** 按来源文件分组：同一个文件里的事件放在一起更像配置本身。 */
  const sources = createMemo(() => {
    const map = new Map<string, HookRegistrationView[]>()
    for (const item of items()) {
      const list = map.get(item.source) ?? []
      list.push(item)
      map.set(item.source, list)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  })

  const t = (key: string, vars?: Record<string, unknown>) => language.t(key as never, vars as never)

  return (
    <div class="flex flex-col gap-3">
      <SettingsGroup>
        <div class="flex items-start gap-2 border-b border-border px-4 py-2">
          <div class="min-w-0 flex-1">
            <div class="text-13-medium text-foreground">{t("settings.hooks.tab")}</div>
            <div class="mt-0.5 text-12-regular leading-relaxed text-foreground-subtle">
              {t("settings.hooks.tabHint")}
            </div>
          </div>
          <Button variant="ghost" size="small" disabled={busy()} onClick={load}>
            <Icon name="refresh" size="small" />
            {t("settings.hooks.refresh")}
          </Button>
        </div>
        <Show when={error()}>
          <div class="border-b border-border px-4 py-1.5 text-ui-xs text-destructive">{error()}</div>
        </Show>
        <div class="flex flex-wrap items-center gap-1.5 px-4 py-2">
          <Tag>{t("settings.hooks.count", { count: registrations() })}</Tag>
          <Tag>{t("settings.hooks.supported", { count: HOOK_EVENTS.length })}</Tag>
          <Tag>{t("settings.hooks.active", { count: active().length })}</Tag>
        </div>
        <Show when={items().length === 0}>
          <div class="px-4 py-4">
            <div class="text-ui-base text-foreground">{t("settings.hooks.empty")}</div>
            <div class="mt-1 text-ui-xs leading-relaxed text-foreground-subtle">{t("settings.hooks.emptyHint")}</div>
          </div>
        </Show>
      </SettingsGroup>

      <Show when={active().length > 0}>
        <SettingsGroup>
          <div class="border-b border-border px-4 py-2">
            <div class="text-13-medium text-foreground">{t("settings.hooks.active")}</div>
            <div class="mt-0.5 text-12-regular text-foreground-subtle">{t("settings.hooks.activeHint")}</div>
          </div>
          <For each={active()}>
            {(item) => (
              <div class="flex min-w-0 items-center gap-3 px-4 py-2">
                <Icon name="lu-loader" size="small" class="shrink-0 animate-spin text-foreground" />
                <div class="min-w-0 flex-1">
                  <div class="truncate text-ui-base text-foreground">{item.message}</div>
                  <div class="mt-0.5 truncate text-ui-xs text-foreground-subtle">
                    {item.event} · {getFilename(item.source)}
                  </div>
                </div>
              </div>
            )}
          </For>
        </SettingsGroup>
      </Show>

      <Show when={sources().length > 0}>
        <SettingsGroup>
          <div class="border-b border-border px-4 py-2">
            <div class="text-13-medium text-foreground">{t("settings.hooks.sources")}</div>
            <div class="mt-0.5 text-12-regular text-foreground-subtle">{t("settings.hooks.sourcesHint")}</div>
          </div>
          <For each={sources()}>
            {([source, list]) => (
              <div class="border-b border-border px-4 py-2 last:border-b-0">
                <div class="truncate text-ui-xs text-foreground-subtle" title={source}>
                  {source}
                </div>
                <div class="mt-1 flex flex-col gap-1">
                  <For each={list}>
                    {(item) => (
                      <div class="flex min-w-0 flex-wrap items-center gap-2">
                        <span class="text-ui-base text-foreground">{item.event}</span>
                        <Show when={item.matcher}>{(matcher) => <Tag>{matcher()}</Tag>}</Show>
                        <Tag>{t("settings.hooks.count", { count: item.count })}</Tag>
                        <Show when={item.statusMessages.length > 0}>
                          <Tag title={item.statusMessages.join("\n")}>
                            {t("settings.hooks.status", { count: item.statusMessages.length })}
                          </Tag>
                        </Show>
                        <span class="truncate text-ui-xs text-foreground-subtle">· {item.types.join(", ")}</span>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            )}
          </For>
        </SettingsGroup>
      </Show>

      <SettingsGroup>
        <div class="border-b border-border px-4 py-2">
          <div class="text-13-medium text-foreground">{t("settings.hooks.supported")}</div>
          <div class="mt-0.5 text-12-regular text-foreground-subtle">
            {t("settings.hooks.supportedHint", { count: HOOK_EVENTS.length })}
          </div>
        </div>
        <For each={HOOK_EVENTS}>
          {(event) => (
            <div class="flex min-w-0 items-start gap-2 px-4 py-1.5">
              <Icon
                name={listened().has(event) ? "circle-check" : "circle-ban-sign"}
                size="small"
                class="mt-0.5 shrink-0"
                classList={{
                  "text-success": listened().has(event),
                  "text-foreground-subtlest": !listened().has(event),
                }}
              />
              <div class="min-w-0 flex-1">
                <div class="text-ui-base text-foreground">{event}</div>
                <div class="mt-0.5 text-ui-xs leading-relaxed text-foreground-subtle">
                  {t("settings.hooks.event." + event)}
                </div>
              </div>
            </div>
          )}
        </For>
      </SettingsGroup>
    </div>
  )
}
