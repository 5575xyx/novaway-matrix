/**
 * MCP tools are deferred by default, matching Claude Code: every MCP tool is
 * loaded on demand via `mcp_tool_search` unless it opts into `alwaysLoad`.
 * The old policy only deferred once schemas exceeded 20k tokens, which still
 * put dozens of unrelated tool schemas in every request and left less room for
 * the actual task.
 *
 * `experimental.defer_mcp_loading: false` restores eager loading.
 */
export const MCP_DEFER_THRESHOLD_TOKENS = 20_000

export function shouldDeferMcpTools(input: { configured?: boolean; schemaTokens: number }) {
  return input.configured ?? true
}
