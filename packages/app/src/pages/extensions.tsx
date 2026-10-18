import type { Component } from "solid-js"
import { PluginMarketplaceSection } from "@/components/settings-plugin-market"

/**
 * 扩展页（整帧覆盖，与「数据库」同级）。
 *
 * 之前扩展市场塞在 设置 → 插件 里，和「配置里的 npm 插件」混在一起 ——
 * 两者概念不同：设置里的插件是服务端加载的 npm/git 包，这里的是
 * 「技能 + MCP」的能力包（内置 + 官方市场）。拆成独立入口后，
 * 左下角可以直接进入，不用先开设置再找 tab。
 */
export const ExtensionsPage: Component<{ onBack: () => void }> = (props) => (
  <div class="flex h-full flex-col bg-background">
    <div class="flex-1 min-h-0">
      <PluginMarketplaceSection onBack={props.onBack} />
    </div>
  </div>
)
