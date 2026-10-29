import { createSignal, Show, type Component } from "solid-js"
import { Icon } from "@novaway/ui/icon"
import { Button } from "@novaway/ui/button"
import { useLanguage } from "@/context/language"
import { InstalledExtensions } from "@/components/settings-installed-extensions"
import { MarketCatalog } from "@/components/settings-market-catalog"
import { BuiltinExtensions } from "@/components/extensions-builtin"

type Tab = "installed" | "market"

/**
 * 扩展页。
 *
 * 这里只回答「装了什么、还能装什么」：
 * - 已安装：内置能力开关 + 内核实际加载的扩展
 * - 市场：ZCode / Claude 目录，占满剩余高度
 *
 * 「内核能力」和「Hook」已经搬走：前者是这台实例的运行时状态，后者是回合
 * 里的拦截点，都和插件市场不是一个问题，混在一起只会让人分不清。
 *
 * 市场只保留内核版（`MarketCatalog`）：它直连
 * `POST /extension/marketplace/install`，Web / 终端 / 桌面三条路径共用一套
 * 安装逻辑与安装记录。
 */
export const ExtensionsPage: Component<{
  directory: string
  onBack: () => void
}> = (props) => {
  const language = useLanguage()
  const [tab, setTab] = createSignal<Tab>("installed")
  const [refreshKey, setRefreshKey] = createSignal(0)

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "installed", label: language.t("settings.extensions.tab.installed") },
    { id: "market", label: language.t("settings.extensions.tab.market") },
  ]

  return (
    <div class="flex h-full min-h-0 flex-col bg-background">
      <div class="shrink-0 border-b border-border px-4 pt-3">
        <div class="flex items-center gap-2">
          <Button variant="ghost" size="small" onClick={() => props.onBack()}>
            <Icon name="arrow-left" size="small" />
            {language.t("common.goBack")}
          </Button>
          <span class="text-14-medium text-foreground">{language.t("settings.extensions.title")}</span>
          <div class="flex-1" />
        </div>
        <div class="mt-2 flex items-center gap-1">
          {tabs.map((item) => (
            <button
              type="button"
              class="h-8 rounded-full px-3.5 text-13-medium transition-colors"
              classList={{
                "bg-surface text-foreground": tab() === item.id,
                "text-foreground-subtle hover:text-foreground": tab() !== item.id,
              }}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <Show when={tab() === "installed"}>
          <div class="flex flex-col gap-3">
            <BuiltinExtensions />
            <InstalledExtensions directory={props.directory} refreshKey={refreshKey()} />
          </div>
        </Show>

        <Show when={tab() === "market"}>
          <MarketCatalog directory={props.directory} onInstalled={() => setRefreshKey((value) => value + 1)} />
        </Show>
      </div>
    </div>
  )
}
