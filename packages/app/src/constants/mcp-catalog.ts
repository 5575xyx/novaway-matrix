/**
 * MCP 市场目录。
 *
 * 对齐 ZCode 的 MCP Settings（`settings/McpServerList.tsx` + `McpServerForm.tsx`）：
 * 它的安装面板是一个「扫一眼就能添加」的目录，而不是让用户手写 command/args。
 *
 * 这里是一份**内置精选目录**（离线可用，不依赖远端 marketplace 源）。
 * 后端 config 的 `mcp` 段已支持 local / remote 两种形态，所以「安装」= 把 template 写进 config，
 * 复用既有的 config.update 通道，不需要新端点。
 *
 * 每个条目：
 * - `id`：写进 config 的键名，与 DEFAULT_MCP_SERVERS 里的键保持一致（同名即视为已安装）
 * - `template`：完整的 config 片段（含 enabled），安装时原样写入
 * - `requires`：需要用户自备的环境变量名，用于在 UI 上提示（不阻塞安装）
 */
export type McpCatalogEntry = {
  id: string
  name: string
  descriptionKey: string
  category: "search" | "browser" | "docs" | "data" | "dev" | "productivity"
  template: Record<string, unknown>
  requires?: string[]
}

// Windows 上 npx 是 .cmd，直接 spawn 会 ENOENT，所以统一走 cmd /c 包装（与后端种子一致）。
const NPX = (pkg: string, ...args: string[]) =>
  typeof navigator !== "undefined" && navigator.userAgent.includes("Windows")
    ? ["cmd", "/c", "npx", "-y", pkg, ...args]
    : ["npx", "-y", pkg, ...args]

export const MCP_CATALOG: McpCatalogEntry[] = [
  {
    id: "context7",
    name: "Context7",
    descriptionKey: "settings.mcp.catalog.context7",
    category: "docs",
    template: { type: "local", command: NPX("@upstash/context7-mcp"), enabled: true },
  },
  {
    id: "sequential-thinking",
    name: "Sequential Thinking",
    descriptionKey: "settings.mcp.catalog.sequentialThinking",
    category: "dev",
    template: { type: "local", command: NPX("@modelcontextprotocol/server-sequential-thinking"), enabled: true },
  },
  {
    id: "memory",
    name: "Memory",
    descriptionKey: "settings.mcp.catalog.memory",
    category: "data",
    template: { type: "local", command: NPX("@modelcontextprotocol/server-memory"), enabled: true },
  },
  {
    id: "fetch",
    name: "Fetch",
    descriptionKey: "settings.mcp.catalog.fetch",
    category: "browser",
    template: { type: "local", command: ["uvx", "mcp-server-fetch"], enabled: true },
  },
  {
    id: "browser",
    name: "Playwright",
    descriptionKey: "settings.mcp.catalog.playwright",
    category: "browser",
    template: { type: "local", command: NPX("@playwright/mcp"), enabled: true },
  },
  {
    id: "everything",
    name: "Everything (官方样例)",
    descriptionKey: "settings.mcp.catalog.everything",
    category: "dev",
    template: { type: "local", command: NPX("@modelcontextprotocol/server-everything"), enabled: true },
  },
  {
    id: "filesystem",
    name: "Filesystem",
    descriptionKey: "settings.mcp.catalog.filesystem",
    category: "data",
    template: {
      type: "local",
      command: NPX("@modelcontextprotocol/server-filesystem", "."),
      enabled: true,
    },
  },
  {
    id: "git",
    name: "Git",
    descriptionKey: "settings.mcp.catalog.git",
    category: "dev",
    template: { type: "local", command: ["uvx", "mcp-server-git"], enabled: true },
  },
  {
    id: "github",
    name: "GitHub",
    descriptionKey: "settings.mcp.catalog.github",
    category: "dev",
    template: {
      type: "local",
      command: NPX("@modelcontextprotocol/server-github"),
      environment: { GITHUB_PERSONAL_ACCESS_TOKEN: "{env:GITHUB_PERSONAL_ACCESS_TOKEN}" },
      enabled: true,
    },
    requires: ["GITHUB_PERSONAL_ACCESS_TOKEN"],
  },
  {
    id: "brave-search",
    name: "Brave Search",
    descriptionKey: "settings.mcp.catalog.braveSearch",
    category: "search",
    template: {
      type: "local",
      command: NPX("@modelcontextprotocol/server-brave-search"),
      environment: { BRAVE_API_KEY: "{env:BRAVE_API_KEY}" },
      enabled: true,
    },
    requires: ["BRAVE_API_KEY"],
  },
  {
    id: "tavily",
    name: "Tavily",
    descriptionKey: "settings.mcp.catalog.tavily",
    category: "search",
    template: {
      type: "local",
      command: NPX("tavily-mcp"),
      environment: { TAVILY_API_KEY: "{env:TAVILY_API_KEY}" },
      enabled: true,
    },
    requires: ["TAVILY_API_KEY"],
  },
  {
    id: "postgres",
    name: "PostgreSQL",
    descriptionKey: "settings.mcp.catalog.postgres",
    category: "data",
    template: {
      type: "local",
      command: NPX("@modelcontextprotocol/server-postgres", "{env:POSTGRES_URL}"),
      enabled: true,
    },
    requires: ["POSTGRES_URL"],
  },
  {
    id: "sqlite",
    name: "SQLite",
    descriptionKey: "settings.mcp.catalog.sqlite",
    category: "data",
    template: { type: "local", command: ["uvx", "mcp-server-sqlite", "--db-path", "./data.db"], enabled: true },
  },
  {
    id: "puppeteer",
    name: "Puppeteer",
    descriptionKey: "settings.mcp.catalog.puppeteer",
    category: "browser",
    template: { type: "local", command: NPX("@modelcontextprotocol/server-puppeteer"), enabled: true },
  },
  {
    id: "slack",
    name: "Slack",
    descriptionKey: "settings.mcp.catalog.slack",
    category: "productivity",
    template: {
      type: "local",
      command: NPX("@modelcontextprotocol/server-slack"),
      environment: {
        SLACK_BOT_TOKEN: "{env:SLACK_BOT_TOKEN}",
        SLACK_TEAM_ID: "{env:SLACK_TEAM_ID}",
      },
      enabled: true,
    },
    requires: ["SLACK_BOT_TOKEN", "SLACK_TEAM_ID"],
  },
  {
    id: "notion",
    name: "Notion",
    descriptionKey: "settings.mcp.catalog.notion",
    category: "productivity",
    template: {
      type: "local",
      command: NPX("@notionhq/notion-mcp-server"),
      environment: { NOTION_TOKEN: "{env:NOTION_TOKEN}" },
      enabled: true,
    },
    requires: ["NOTION_TOKEN"],
  },
  {
    id: "deepwiki",
    name: "DeepWiki",
    descriptionKey: "settings.mcp.catalog.deepwiki",
    category: "docs",
    template: { type: "remote", url: "https://mcp.deepwiki.com/mcp", enabled: true },
  },
]

/** 已安装 = config 的 mcp 段里已有同名键（与后端种子共用同一套键名）。 */
export function catalogEntryInstalled(entry: McpCatalogEntry, configured: Record<string, unknown>): boolean {
  return Object.hasOwn(configured, entry.id)
}
