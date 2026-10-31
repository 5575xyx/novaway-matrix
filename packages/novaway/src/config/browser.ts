export * as ConfigBrowser from "./browser"

import { Schema } from "effect"

/**
 * 内置浏览器能力（`browser_*` 工具 + PDF 打印共用同一个 headless 浏览器）。
 *
 * `enabled: false` 时注册表直接把 `browser_*` / `pdf_create` 从工具列表里摘掉 ——
 * 设置页和扩展页的开关都写这一项，不再借用 MCP 的 `mcp.browser.enabled`。
 */
export const Info = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "启用内置浏览器控制（打开网页、点击、输入、截图、导出 PDF）。默认开启。",
  }),
})
