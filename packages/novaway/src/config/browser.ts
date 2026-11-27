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
  open_in_app: Schema.optional(Schema.Boolean).annotate({
    description: "检测到任务中的本地服务或网页时，默认在桌面端右侧内置浏览器打开。默认开启。",
  }),
  persistent_session: Schema.optional(Schema.Boolean).annotate({
    description: "保留浏览器 Cookie、localStorage 和登录状态。默认开启。",
  }),
  profile_dir: Schema.optional(Schema.String).annotate({
    description: "浏览器 user-data-dir；相对路径以当前 worktree 为基准。",
  }),
  cdp_url: Schema.optional(Schema.String).annotate({
    description: "连接已有 Chrome/Edge DevTools 调试地址；设置后不启动隔离浏览器。",
  }),
  cookie_file: Schema.optional(Schema.String).annotate({
    description: "可选 JSON 或 Netscape cookies.txt 文件；浏览器会话启动时导入。",
  }),
})
