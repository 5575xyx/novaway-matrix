/**
 * 工具行的动作词：**随运行状态换时态**。
 *
 * 对齐 ZCode 的 kindLabel 机制（`chat.toolCall.edit.editing` / `chat.toolCall.edit.edited`）：
 * 运行中说是"正在做什么"，结束后说"已经做了什么"。只用一个词（"编辑"）的话，
 * 标题栏那条 `TextShimmer` 就承担了全部状态表达 —— 扫一眼列表分不出哪些还在跑。
 *
 * 这里只放纯映射（不带 JSX、不依赖 Solid/Kobalte），方便直接单测。
 */

export type ToolAction = "read" | "write" | "edit" | "patch" | "search" | "run" | "delegate"

/**
 * 工具名 → 动作分类。
 *
 * 未列出的工具不回落到某个默认动作：宁可在调用处继续用原来的固定标题，
 * 也好过把一个 MCP 工具说成"搜索"。
 */
const TOOL_ACTIONS: Record<string, ToolAction> = {
  read: "read",
  list: "search",
  glob: "search",
  grep: "search",
  webfetch: "search",
  websearch: "search",
  write: "write",
  edit: "edit",
  apply_patch: "patch",
  bash: "run",
  task: "delegate",
}

export function toolAction(tool: string): ToolAction | undefined {
  return TOOL_ACTIONS[tool]
}

/**
 * 该动作在给定状态下用的 i18n 键。
 *
 * `running` 由调用方决定（工具的 status 是 pending/running），不接受一个
 * 布尔以外的状态，免得这里再重复一遍状态机。
 */
export function toolActionKey(tool: string, running: boolean): string | undefined {
  const action = toolAction(tool)
  if (!action) return undefined
  return `ui.tool.action.${action}.${running ? "running" : "done"}`
}
