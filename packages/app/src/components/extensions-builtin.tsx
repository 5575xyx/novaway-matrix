import { For, Show, type Component } from "solid-js"
import { Switch } from "@novaway/ui/switch"
import { Tag } from "@novaway/ui/tag"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { AppIcon } from "./app-icon"
import { BUILTIN_EXTENSIONS, type BuiltinExtension } from "./builtin-extensions-data"
import { extensionConfigPatch, extensionEnabled } from "./extension-config"
import { SettingsGroup } from "./settings-parts"

export { BUILTIN_EXTENSIONS, type BuiltinExtension }

/**
 * 内置扩展。
 *
 * 这些能力随应用提供（内置技能 / 浏览器控制 / 记忆服务），不是从市场下载的，
 * 因此单独成组：开关只写对应配置项（`skills.disabled` / `browser.enabled` /
 * `memory.enabled` / `experimental.computer_control` / `tools.<id>`），
 * 关掉只是隐藏，不删任何文件。
 */
export const BuiltinExtensions: Component = () => {
  const language = useLanguage()
  const globalSync = useGlobalSync()

  // 开关语义和办公模式的插件选择器共用一份纯函数，见 extension-config.ts。
  const enabled = (item: BuiltinExtension) => extensionEnabled(globalSync.data.config, item)

  const set = (item: BuiltinExtension, value: boolean) => {
    const patch = extensionConfigPatch(globalSync.data.config, item, value)
    if (!patch) return
    void globalSync.updateConfig(patch as never)
  }

  return (
    <SettingsGroup>
      <div class="flex items-center gap-2 border-b border-border px-4 py-2">
        <div class="min-w-0 flex-1">
          <div class="text-13-medium text-foreground">{language.t("settings.extensions.builtin")}</div>
          <div class="mt-0.5 text-12-regular text-foreground-subtle">
            {language.t("settings.extensions.builtinHint")}
          </div>
        </div>
      </div>
      <div class="flex flex-col gap-2 border-t border-border p-2">
        <For each={BUILTIN_EXTENSIONS}>
          {(item) => (
            <div
              data-component="builtin-extension-row"
              class="flex min-w-0 items-start gap-3 rounded-xl border border-border bg-panel px-3 py-2.5 transition-colors hover:border-border-hover hover:bg-hover/40"
            >
              <AppIcon seed={item.id} glyph={item.icon} class="mt-0.5" />
              <div class="min-w-0 flex-1">
                <div class="flex min-w-0 flex-wrap items-center gap-2">
                  <span class="truncate text-ui-base font-medium text-foreground">{item.name}</span>
                  <Show when={item.available === false}>
                    <Tag>{language.t("settings.extensions.unavailable")}</Tag>
                  </Show>
                </div>
                <div class="mt-0.5 line-clamp-2 text-ui-xs leading-5 text-foreground-subtle">{item.description}</div>
                <Show when={item.available === false && item.unavailableReason}>
                  {(reason) => <div class="mt-0.5 text-ui-xs text-foreground-subtlest">{reason()}</div>}
                </Show>
              </div>
              <Switch
                checked={enabled(item)}
                disabled={item.available === false}
                onChange={(value) => set(item, value)}
                hideLabel
              >
                {item.name}
              </Switch>
            </div>
          )}
        </For>
      </div>
    </SettingsGroup>
  )
}
