import { createSignal, For, onMount, Show, type Component } from "solid-js"
import { Button } from "@novaway/ui/button"
import { Icon } from "@novaway/ui/icon"
import { Tag } from "@novaway/ui/tag"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { SettingsGroup } from "./settings-parts"
import type { HookRegistrationView } from "@novaway/sdk/v2"

/**
 * 当前生效的 Hook。
 *
 * 只列「谁监听什么事件」，不显示命令与 URL —— hook 命令里经常带密钥，
 * 展示出来等于把它们抄进截图和日志。要改内容请直接编辑 hooks.json。
 */
export const HooksCard: Component<{ directory: string }> = (props) => {
  const sdk = useGlobalSDK()
  const language = useLanguage()
  const [items, setItems] = createSignal<HookRegistrationView[]>([])

  const load = () => {
    void sdk.client.hook
      .list({ directory: props.directory })
      .then((result) => setItems((result.data ?? []) as HookRegistrationView[]))
      .catch(() => setItems([]))
  }

  onMount(load)

  return (
    <Show when={items().length > 0}>
      <SettingsGroup>
        <div class="flex items-center gap-2 border-b border-border px-4 py-2">
          <div class="min-w-0 flex-1">
            <div class="text-13-medium text-foreground">{language.t("settings.hooks.title")}</div>
            <div class="mt-0.5 text-12-regular text-foreground-subtle">{language.t("settings.hooks.hint")}</div>
          </div>
          <Button variant="ghost" size="small" onClick={load}>
            <Icon name="refresh" size="small" />
            {language.t("settings.hooks.refresh")}
          </Button>
        </div>
        <For each={items()}>
          {(item) => (
            <div class="flex min-w-0 items-start gap-3 rounded-lg px-3 py-2 hover:bg-hover">
              <Icon name="prompt" size="small" class="mt-0.5 shrink-0 text-foreground" />
              <div class="min-w-0 flex-1">
                <div class="flex min-w-0 flex-wrap items-center gap-2">
                  <span class="min-w-0 truncate text-ui-base text-foreground">{item.event}</span>
                  <Show when={item.matcher}>{(matcher) => <Tag>{matcher()}</Tag>}</Show>
                  <Tag>{language.t("settings.hooks.count", { count: item.count })}</Tag>
                  <Show when={item.statusMessages?.length}>
                    <Tag title={item.statusMessages.join("\n")}>
                      {language.t("settings.hooks.status", { count: item.statusMessages!.length })}
                    </Tag>
                  </Show>
                </div>
                <div class="mt-0.5 truncate text-ui-xs text-foreground-subtle">
                  {item.types.join(", ")} · {item.source}
                </div>
              </div>
            </div>
          )}
        </For>
      </SettingsGroup>
    </Show>
  )
}
