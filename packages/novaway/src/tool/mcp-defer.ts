/**
 * MCP 工具默认全量塞进每一轮请求。9 个 server、上百个工具时，
 * 光 schema 就能吃掉 60k+ tokens；小窗口模型（如 128k）会因此永远处于
 * 压缩阈值之上，压缩无法收敛。
 *
 * 超过阈值时把 MCP 工具改为按需加载：首轮只发一个 `mcp_tool_search`，
 * 模型搜索/激活后才带上完整 schema。少量 MCP 工具仍保持直出，避免为了
 * 省几个 token 破坏正常体验。
 */
export const MCP_DEFER_THRESHOLD_TOKENS = 20_000

export function shouldDeferMcpTools(input: { configured?: boolean; schemaTokens: number }) {
  return input.configured ?? input.schemaTokens >= MCP_DEFER_THRESHOLD_TOKENS
}
