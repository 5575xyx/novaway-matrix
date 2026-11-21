import { createSignal, type Component } from "solid-js"
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
  const [tab, setTab] = createSignal<Tab>("market")
  const [refreshKey, setRefreshKey] = createSignal(0)

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "installed", label: language.t("settings.extensions.tab.installed") },
    { id: "market", label: language.t("settings.extensions.tab.market") },
  ]

  return (
    <div class="flex h-full min-h-0 flex-col bg-background">
      <div
        class="flex shrink-0 flex-wrap items-center justify-between gap-3 px-6 py-4"
        data-window-drag
        data-component="extensions-header"
      >
        <div class="flex items-center gap-2">
          <Button variant="ghost" size="small" onClick={() => props.onBack()}>
            <Icon name="arrow-left" size="small" />
            {language.t("common.goBack")}
          </Button>
          <span class="text-14-medium text-foreground">{language.t("settings.extensions.title")}</span>
        </div>
        <div class="flex-1" />
      </div>

      <div class="flex min-h-0 flex-1">
        <aside class="w-44 shrink-0 border-r border-border/80 bg-surface/30 px-3 py-5">
          <nav class="flex flex-col gap-1" aria-label={language.t("settings.extensions.navigation")}>
            {tabs.map((item) => (
              <button
                type="button"
                class="flex h-10 items-center rounded-lg px-3 text-left text-13-medium transition-colors"
                classList={{
                  "bg-background text-foreground shadow-sm": tab() === item.id,
                  "text-foreground-subtle hover:bg-hover hover:text-foreground": tab() !== item.id,
                }}
                aria-current={tab() === item.id ? "page" : undefined}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </aside>

        <main class="min-w-0 flex-1 overflow-y-auto px-5 pb-10 sm:px-8">
          <div class="mx-auto w-full max-w-[960px]" hidden={tab() !== "installed"}>
            <div class="flex items-center justify-between gap-4 py-10">
              <div>
                <h1 class="text-[26px] leading-tight font-semibold text-foreground">
                  {language.t("settings.market.manageTitle")}
                </h1>
                <p class="mt-2 text-13-regular text-foreground-subtle">{language.t("settings.market.manageHint")}</p>
              </div>
              <Button variant="secondary" onClick={() => setTab("market")}>
                {language.t("settings.extensions.tab.market")}
              </Button>
            </div>
            <div class="flex flex-col gap-8">
              <InstalledExtensions directory={props.directory} refreshKey={refreshKey()} />
              <BuiltinExtensions />
            </div>
          </div>
          <div class="mx-auto w-full max-w-[1120px]" hidden={tab() !== "market"}>
            <MarketCatalog directory={props.directory} onInstalled={() => setRefreshKey((value) => value + 1)} />
          </div>
        </main>
      </div>
    </div>
  )
}
