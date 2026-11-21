import type { Config } from "@novaway/sdk/v2/client"
import { Switch } from "@novaway/ui/switch"
import { Tag } from "@novaway/ui/tag"
import { createMemo, type Component } from "solid-js"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { browserEmbeddedEnabled } from "@/utils/browser-preferences"
import { SettingsGroup, SettingsPage, SettingsRow } from "./settings-parts"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value)

/**
 * 浏览器控制。
 *
 * 能力由内核自带（`browser_*` 工具直接说 Chrome DevTools 协议，拉起的是本机
 * 已安装的 Chrome / Edge 的 headless 模式），不经过任何 MCP 服务 —— 设置页提供能力开关，
 * 以及任务页面默认使用右侧内置浏览器的偏好，加上「它到底怎么跑」的说明。
 */
export const SettingsBrowser: Component = () => {
  const language = useLanguage()
  const globalSync = useGlobalSync()

  const entry = createMemo<Record<string, unknown>>(() => {
    const value = globalSync.data.config.browser
    return isRecord(value) ? value : {}
  })

  const enabled = createMemo(() => entry()["enabled"] !== false)
  const openInApp = createMemo(() => browserEmbeddedEnabled({ browser: entry() }))

  const update = (value: boolean) =>
    globalSync.updateConfig({
      browser: { ...entry(), enabled: value },
    } as Config)

  const updateOpenInApp = (value: boolean) =>
    globalSync.updateConfig({
      browser: { ...entry(), open_in_app: value },
    } as Config)

  return (
    <SettingsPage
      title={language.t("settings.browser.title" as never)}
      description={language.t("settings.browser.description" as never)}
    >
      <SettingsGroup>
        <SettingsRow
          label={language.t("settings.browser.enabled.title" as never)}
          description={language.t("settings.browser.enabled.description" as never)}
          control={
            <Switch checked={enabled()} onChange={update} hideLabel>
              {language.t("settings.browser.enabled.title" as never)}
            </Switch>
          }
        />
        <SettingsRow
          label={language.t("settings.browser.openInApp.title" as never)}
          description={language.t("settings.browser.openInApp.description" as never)}
          control={
            <Switch checked={openInApp()} onChange={updateOpenInApp} hideLabel>
              {language.t("settings.browser.openInApp.title" as never)}
            </Switch>
          }
        />
        <SettingsRow
          label={language.t("settings.browser.runtime.title" as never)}
          description={language.t("settings.browser.runtime.description" as never)}
          control={<Tag>{language.t("settings.browser.runtime.tag" as never)}</Tag>}
        />
        <SettingsRow
          label={language.t("settings.browser.permission.title" as never)}
          description={language.t("settings.browser.permission.description" as never)}
          control={<Tag>{language.t("settings.browser.permission.tag" as never)}</Tag>}
        />
      </SettingsGroup>

      <div class="rounded-xl border border-border bg-surface px-4 py-3">
        <div class="text-13-medium text-foreground">{language.t("settings.browser.usage.title" as never)}</div>
        <ul class="mt-1.5 flex flex-col gap-1 text-12-regular text-foreground-subtle">
          <li>{language.t("settings.browser.usage.1" as never)}</li>
          <li>{language.t("settings.browser.usage.2" as never)}</li>
          <li>{language.t("settings.browser.usage.3" as never)}</li>
        </ul>
      </div>
    </SettingsPage>
  )
}
