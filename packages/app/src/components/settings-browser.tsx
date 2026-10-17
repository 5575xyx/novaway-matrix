import type { Config, McpStatus } from "@novaway/sdk/v2/client"
import { Switch } from "@novaway/ui/switch"
import { Tag } from "@novaway/ui/tag"
import { useQuery } from "@tanstack/solid-query"
import { createMemo, Show, type Component } from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { SettingsGroup, SettingsRow } from "./settings-parts"

const statusLabels = {
  connected: "mcp.status.connected",
  failed: "mcp.status.failed",
  needs_auth: "mcp.status.needs_auth",
  needs_client_registration: "mcp.status.needs_client_registration",
  disabled: "mcp.status.disabled",
} as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value)

/**
 * 浏览器控制（对齐 ZCode 的 Browser 设置区）。
 *
 * 我们的浏览器能力由内置的 Playwright MCP 提供（`browser` 服务），
 * 所以这一页只做两件事：开关它、显示它的连接状态。
 * 不再重复 MCP 页的那套增删改 —— 那是"管理任意 MCP 服务"，
 * 这里是"浏览器这个能力现在能不能用"。
 */
export const SettingsBrowser: Component = () => {
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()

  const status = useQuery(() => ({
    queryKey: ["settings", "mcp"],
    queryFn: () => globalSDK.client.mcp.status().then((response) => response.data ?? {}),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  }))

  const browser = createMemo<McpStatus | undefined>(() => {
    const data = status.data
    if (!isRecord(data)) return undefined
    return data.browser as McpStatus | undefined
  })

  const configured = createMemo(() => {
    const mcp = globalSync.data.config.mcp
    return isRecord(mcp) ? mcp : {}
  })

  const entry = createMemo<Record<string, unknown>>(() => {
    const value = configured().browser
    return isRecord(value) ? value : {}
  })

  const enabled = createMemo(() => entry()["enabled"] !== false)

  const update = (value: boolean) =>
    globalSync.updateConfig({
      mcp: { ...configured(), browser: { ...entry(), enabled: value } },
    } as Config)

  const label = createMemo(() => {
    const current = browser()?.status
    return current ? language.t(statusLabels[current] as never) : language.t("settings.browser.status.unknown" as never)
  })

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--popover)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8 w-full">
          <h2 class="text-16-medium text-foreground">{language.t("settings.browser.title" as never)}</h2>
          <p class="text-13-regular text-foreground-subtle">{language.t("settings.browser.description" as never)}</p>
        </div>
      </div>

      <div class="flex flex-col gap-8 w-full">
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
            label={language.t("settings.browser.status.title" as never)}
            description={language.t("settings.browser.status.description" as never)}
            control={<Tag>{label()}</Tag>}
            detail={
              <Show when={browser()?.status === "failed" ? (browser() as { error?: string }).error : undefined}>
                {(error) => <p class="text-12-regular text-foreground-subtle">{error()}</p>}
              </Show>
            }
          />
        </SettingsGroup>
      </div>
    </div>
  )
}
