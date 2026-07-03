import { createSignal, For, Show, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { useSDK } from "@/context/sdk"
import { useFile } from "@/context/file"
import { useSessionLayout } from "./session-layout"

type DBType = "mysql" | "postgresql" | "sqlite" | "sqlserver" | "mariadb"

interface DBConnection {
  id: string
  name: string
  type: DBType
  host: string
  port: number
  user: string
  password: string
  database: string
  connected: boolean
  databases: string[]
}

const DB_DEFAULTS: Record<DBType, { port: number; placeholder: { host: string; database: string } }> = {
  mysql: { port: 3306, placeholder: { host: "localhost", database: "mydb" } },
  postgresql: { port: 5432, placeholder: { host: "localhost", database: "mydb" } },
  sqlite: { port: 0, placeholder: { host: "", database: "/path/to/database.db" } },
  sqlserver: { port: 1433, placeholder: { host: "localhost", database: "mydb" } },
  mariadb: { port: 3306, placeholder: { host: "localhost", database: "mydb" } },
}

const DB_LABELS: Record<DBType, string> = {
  mysql: "MySQL",
  postgresql: "PostgreSQL",
  sqlite: "SQLite",
  sqlserver: "SQL Server",
  mariadb: "MariaDB",
}

function generateId() {
  return `db_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function loadConnections(): DBConnection[] {
  try {
    const raw = localStorage.getItem("novaway_db_connections")
    if (raw) return JSON.parse(raw)
  } catch {}
  return []
}

function saveConnections(conns: DBConnection[]) {
  localStorage.setItem("novaway_db_connections", JSON.stringify(conns))
}

async function testDatabaseConnection(
  baseUrl: string,
  payload: { type: DBType; host: string; port: number; user: string; password: string; database: string },
): Promise<{ success: boolean; message: string; version?: string; pingMs?: number }> {
  const res = await fetch(`${baseUrl}/database/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const text = await res.text()
    return { success: false, message: `HTTP ${res.status}: ${text}` }
  }
  return res.json()
}

async function listDatabases(
  baseUrl: string,
  payload: { type: DBType; host: string; port: number; user: string; password: string; database: string },
): Promise<string[]> {
  const res = await fetch(`${baseUrl}/database/list`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  if (!res.ok) return []
  const data = await res.json()
  return data.databases ?? []
}

async function executeSql(
  baseUrl: string,
  payload: { type: DBType; host: string; port: number; user: string; password: string; database: string; sql: string },
): Promise<{ success: boolean; message: string; columns?: string[]; rows?: Record<string, unknown>[]; affectedRows?: number }> {
  const res = await fetch(`${baseUrl}/database/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const text = await res.text()
    return { success: false, message: `HTTP ${res.status}: ${text}` }
  }
  return res.json()
}

function trimConnFields<T extends { host: string; port: number; user: string; password: string; database: string }>(obj: T): T {
  return { ...obj, host: obj.host.trim(), user: obj.user.trim(), password: obj.password.trim(), database: obj.database.trim() }
}

async function listTables(
  baseUrl: string,
  payload: { type: DBType; host: string; port: number; user: string; password: string; database: string },
): Promise<string[]> {
  const res = await fetch(`${baseUrl}/database/tables`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  if (!res.ok) return []
  const data = await res.json()
  return data.tables ?? []
}

interface ColumnInfo {
  name: string
  type: string
  nullable: boolean
  key?: string
  defaultValue?: string
  comment?: string
}

async function getColumns(
  baseUrl: string,
  payload: { type: DBType; host: string; port: number; user: string; password: string; database: string; table: string },
): Promise<ColumnInfo[]> {
  const res = await fetch(`${baseUrl}/database/columns`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  if (!res.ok) return []
  const data = await res.json()
  return data.columns ?? []
}

async function queryTable(
  baseUrl: string,
  payload: { type: DBType; host: string; port: number; user: string; password: string; database: string; sql: string },
): Promise<{ columns: string[]; rows: Record<string, unknown>[]; total: number }> {
  const res = await fetch(`${baseUrl}/database/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  if (!res.ok) return { columns: [], rows: [], total: 0 }
  return res.json()
}

export function DatabaseTab() {
  const sdk = useSDK()
  const dialog = useDialog()
  const file = useFile()
  const { tabs } = useSessionLayout()
  const [connections, setConnections] = createStore<DBConnection[]>(loadConnections())
  const [activeId, setActiveId] = createSignal<string | null>(null)
  const [result, setResult] = createSignal<{ columns: string[]; rows: Record<string, unknown>[]; message?: string; error?: string } | null>(null)
  const [executing, setExecuting] = createSignal(false)
  const [expandedDbs, setExpandedDbs] = createSignal<Record<string, boolean>>({})
  const [dbTables, setDbTables] = createSignal<Record<string, string[]>>({})
  const [loadingTables, setLoadingTables] = createSignal<Record<string, boolean>>({})
  const [viewerTable, setViewerTable] = createSignal<{ connId: string; dbName: string; tableName: string } | null>(null)
  const [viewerColumns, setViewerColumns] = createSignal<ColumnInfo[]>([])
  const [viewerData, setViewerData] = createSignal<{ columns: string[]; rows: Record<string, unknown>[] }>({ columns: [], rows: [] })
  const [viewerLoading, setViewerLoading] = createSignal(false)
  const [contextMenu, setContextMenu] = createSignal<{ x: number; y: number; connId: string; dbName: string } | null>(null)
  const [consoleOpen, setConsoleOpen] = createSignal(false)
  const [consoleDb, setConsoleDb] = createSignal<{ connId: string; dbName: string } | null>(null)
  const [consoleSql, setConsoleSql] = createSignal("")
  const [consoleResult, setConsoleResult] = createSignal<{ columns: string[]; rows: Record<string, unknown>[]; error?: string } | null>(null)
  const [consoleExecuting, setConsoleExecuting] = createSignal(false)

  const active = createMemo(() => connections.find((c) => c.id === activeId()))

  const databaseList = createMemo(() => {
    const conn = active()
    if (!conn) return []
    return conn.databases.map((db) => ({ connId: conn.id, db, isActive: conn.database === db }))
  })

  const persist = (next: DBConnection[]) => {
    setConnections(() => next)
    saveConnections(next)
    const payload = next.map((c) => ({
      name: c.name,
      type: c.type,
      host: c.host,
      port: c.port,
      user: c.user,
      password: c.password,
      database: c.database,
    }))
    fetch(`${sdk.url}/database/connections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connections: payload }),
    }).catch(() => {})
  }

  const toggleDatabase = async (connId: string, dbName: string) => {
    const key = `${connId}:${dbName}`
    const isExpanded = expandedDbs()[key]
    setExpandedDbs((prev) => ({ ...prev, [key]: !isExpanded }))

    if (!isExpanded && !dbTables()[key]) {
      setLoadingTables((prev) => ({ ...prev, [key]: true }))
      const conn = connections.find((c) => c.id === connId)
      if (conn) {
        const tables = await listTables(sdk.url, trimConnFields({
          type: conn.type,
          host: conn.host,
          port: conn.port,
          user: conn.user,
          password: conn.password,
          database: dbName,
        }))
        setDbTables((prev) => ({ ...prev, [key]: tables }))
      }
      setLoadingTables((prev) => ({ ...prev, [key]: false }))
    }
  }

  const removeConnection = (id: string) => {
    const next = connections.filter((c) => c.id !== id)
    persist(next)
    if (activeId() === id) setActiveId(next[0]?.id ?? null)
  }

  const refreshDatabases = async () => {
    const conn = active()
    if (!conn) return
    const databases = await listDatabases(sdk.url, trimConnFields({
      type: conn.type,
      host: conn.host,
      port: conn.port,
      user: conn.user,
      password: conn.password,
      database: conn.database,
    }))
    const next = connections.map((c) => (c.id === conn.id ? { ...c, databases } : c))
    persist(next)
  }

  const openTableViewer = async (connId: string, dbName: string, tableName: string) => {
    setViewerTable({ connId, dbName, tableName })
    setViewerLoading(true)
    setViewerColumns([])
    setViewerData({ columns: [], rows: [] })
    const conn = connections.find((c) => c.id === connId)
    if (!conn) { setViewerLoading(false); return }
    const payload = trimConnFields({ type: conn.type, host: conn.host, port: conn.port, user: conn.user, password: conn.password, database: dbName })
    const [cols, data] = await Promise.all([
      getColumns(sdk.url, { ...payload, table: tableName }),
      queryTable(sdk.url, { ...payload, sql: `SELECT * FROM \`${tableName}\` LIMIT 200` }),
    ])
    setViewerColumns(cols)
    setViewerData({ columns: data.columns, rows: data.rows })
    setViewerLoading(false)
  }

  const showNewDialog = () => {
    dialog.show(() => (
      <DialogDatabaseConnection
        baseUrl={sdk.url}
        onSave={(conn) => {
          const next = [...connections, conn]
          persist(next)
          setActiveId(conn.id)
          dialog.close()
        }}
      />
    ))
  }

  const showCreateDatabaseDialog = () => {
    const conn = active()
    if (!conn) return
    dialog.show(() => (
      <DialogCreateDatabase
        baseUrl={sdk.url}
        connection={conn}
        onCreated={async () => {
          await refreshDatabases()
          dialog.close()
        }}
      />
    ))
  }

  const executeCurrentFile = async () => {
    const conn = active()
    if (!conn) return
    const t = tabs()
    const activeTab = t.active()
    if (!activeTab || activeTab === "review" || activeTab === "context" || activeTab === "empty") {
      setResult({ columns: [], rows: [], error: "请先打开一个 SQL 文件" })
      return
    }
    const filePath = file.pathFromTab(activeTab)
    if (!filePath || !filePath.endsWith(".sql")) {
      setResult({ columns: [], rows: [], error: "当前文件不是 SQL 文件" })
      return
    }
    setExecuting(true)
    setResult(null)
    try {
      const res = await sdk.client.file.read({ path: filePath })
      const content = res.data?.content
      if (!content) {
        setResult({ columns: [], rows: [], error: "无法读取文件内容" })
        return
      }
      const execRes = await executeSql(sdk.url, trimConnFields({
        type: conn.type,
        host: conn.host,
        port: conn.port,
        user: conn.user,
        password: conn.password,
        database: conn.database,
        sql: content,
      }))
      if (!execRes.success) {
        setResult({ columns: [], rows: [], error: execRes.message })
      } else if (execRes.columns && execRes.rows) {
        setResult({ columns: execRes.columns, rows: execRes.rows, message: execRes.message })
      } else {
        setResult({ columns: [], rows: [], message: execRes.message || "执行成功" })
      }
      if (execRes.success) await refreshDatabases()
    } catch (e) {
      setResult({ columns: [], rows: [], error: String(e) })
    } finally {
      setExecuting(false)
    }
  }

  const handleContextMenu = (e: MouseEvent, connId: string, dbName: string) => {
    e.preventDefault()
    const idx = connections.findIndex((c) => c.id === connId)
    if (idx >= 0) setConnections(idx, "database", dbName)
    saveConnections(connections.map((c) => (c.id === connId ? { ...c, database: dbName } : c)) as DBConnection[])
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setContextMenu({ x: rect.left, y: rect.bottom + 2, connId, dbName })
  }

  const openConsole = (connId: string, dbName: string) => {
    setConsoleOpen(true)
    setConsoleDb({ connId, dbName })
    setConsoleSql("")
    setConsoleResult(null)
    setContextMenu(null)
  }

  const executeConsoleSql = async () => {
    const dbInfo = consoleDb()
    if (!dbInfo || !consoleSql().trim()) return
    const conn = connections.find((c) => c.id === dbInfo.connId)
    if (!conn) return
    setConsoleExecuting(true)
    setConsoleResult(null)
    try {
      const res = await executeSql(sdk.url, trimConnFields({
        type: conn.type,
        host: conn.host,
        port: conn.port,
        user: conn.user,
        password: conn.password,
        database: dbInfo.dbName,
        sql: consoleSql(),
      }))
      if (!res.success) {
        setConsoleResult({ columns: [], rows: [], error: res.message })
      } else if (res.columns && res.rows) {
        setConsoleResult({ columns: res.columns, rows: res.rows })
      } else {
        setConsoleResult({ columns: [], rows: [], error: res.message || "执行成功" })
      }
    } catch (e) {
      setConsoleResult({ columns: [], rows: [], error: String(e) })
    } finally {
      setConsoleExecuting(false)
    }
  }

  return (
    <>
      <style>{`
        @keyframes menu-in {
          from { opacity: 0; transform: scale(0.85) translateY(-6px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        .animate-in { animation: menu-in 0.15s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
        @keyframes slide-down {
          from { opacity: 0; max-height: 0; }
          to { opacity: 1; max-height: 50vh; }
        }
        .animate-slide-down { animation: slide-down 0.2s ease-out forwards; overflow: hidden; }
      `}</style>
      <div class="h-full flex flex-col overflow-hidden text-12-regular">
      {/* 连接列表 */}
      <div class="shrink-0 px-3 py-2 border-b border-border-weaker-base">
        <div class="flex items-center gap-1 flex-wrap">
          <For each={connections}>
            {(conn) => (
              <button
                class={`px-2 py-1 rounded text-12-medium transition-all duration-150 active:scale-95 active:bg-background-accent-stronger flex items-center gap-1 ${
                  activeId() === conn.id
                    ? "bg-surface-success-weak text-text-on-success-base"
                    : "text-text-weak hover:text-text-base hover:bg-background-stronger"
                }`}
                onClick={() => setActiveId(conn.id)}
              >
                <Show
                  when={conn.connected}
                  fallback={<span class="w-2 h-2 rounded-full bg-surface-critical-weak inline-block" />}
                >
                  <span class="w-2 h-2 rounded-full bg-surface-success-base inline-block" />
                </Show>
                {conn.host || "未配置"}:{conn.port}
              </button>
            )}
          </For>
          <button
            class="w-6 h-6 flex items-center justify-center rounded hover:bg-background-stronger text-text-weak transition-all duration-150 active:scale-95 active:bg-background-accent-stronger"
            onClick={showNewDialog}
          >
            +
          </button>
        </div>
      </div>

      {/* 当前连接信息 */}
      <Show when={active()}>
        {(conn) => (
          <div class="shrink-0 px-3 py-2 border-b border-border-weaker-base">
            <div class="flex items-center justify-between mb-2">
              <div class="text-11-medium text-text-weak">
                {DB_LABELS[conn().type]} {conn().host}:{conn().port}
              </div>
              <div class="flex items-center gap-1">
                <Show when={conn().connected}>
                  <span class="text-11-regular text-surface-success-base">已连接</span>
                </Show>
                <button
                  class="text-11-regular text-text-weak hover:text-text-error px-1 transition-all duration-150 active:scale-95 active:bg-background-accent-stronger"
                  onClick={() => removeConnection(conn().id)}
                >
                  删除
                </button>
              </div>
            </div>
            <div class="text-11-regular text-text-weaker">
              用户：{conn().user} | 数据库：{conn().database || "(未选择)"}
            </div>
          </div>
        )}
      </Show>

      {/* 数据库列表 */}
      <Show when={active()?.connected && (active()?.databases?.length ?? 0) > 0}>
        <div class="shrink-0 px-2 py-2 border-b border-border-weaker-base max-h-64 overflow-auto">
          <div class="flex items-center justify-between mb-1 px-1">
            <span class="text-11-medium text-text-weak">数据库</span>
            <div class="flex items-center gap-1">
              <button
                class="text-11-regular text-text-accent hover:text-text-accent-stronger disabled:opacity-50 transition-all duration-150 active:scale-95 active:bg-background-accent-stronger"
                onClick={executeCurrentFile}
                disabled={executing()}
                title="执行当前文件 (Ctrl+Enter)"
              >
                ▶ 执行文件
              </button>
              <button
                class="text-11-regular text-text-weak hover:text-text-base transition-all duration-150 active:scale-95 active:bg-background-accent-stronger"
                onClick={refreshDatabases}
                title="刷新"
              >
                ↻
              </button>
              <button
                class="text-11-regular text-text-accent hover:text-text-accent-stronger transition-all duration-150 active:scale-95 active:bg-background-accent-stronger"
                onClick={showCreateDatabaseDialog}
              >
                + 新建
              </button>
            </div>
          </div>
          <For each={databaseList()}>
            {(item) => {
              const key = `${item.connId}:${item.db}`
              const isExpanded = () => expandedDbs()[key] ?? false
              const tables = () => dbTables()[key] ?? []
              const isLoading = () => loadingTables()[key] ?? false
              return (
                <div>
                  <div
                    class={`flex items-center gap-1 px-1 py-0.5 text-12-regular rounded cursor-pointer transition-all duration-150 active:scale-95 active:bg-background-accent-stronger ${
                      item.isActive
                        ? "bg-surface-success-weak text-text-on-success-base"
                        : "text-text-weak hover:text-text-base hover:bg-background-stronger"
                    }`}
                    onClick={() => {
                      const conn = active()
                      if (!conn) return
                      const next = connections.map((c) => (c.id === conn.id ? { ...c, database: item.db } : c))
                      persist(next)
                    }}
                    onContextMenu={(e) => handleContextMenu(e, item.connId, item.db)}
                  >
                    <span
                      class="text-10-regular text-text-weaker w-3 shrink-0 text-center cursor-pointer hover:text-text-base transition-all duration-100 active:scale-[0.90]"
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleDatabase(item.connId, item.db)
                      }}
                    >
                      {isExpanded() ? "▼" : "▶"}
                    </span>
                    <span class="truncate">{item.db}</span>
                  </div>
                  <Show when={isExpanded()}>
                    <div class="ml-4">
                      <Show
                        when={!isLoading()}
                        fallback={<div class="px-2 py-0.5 text-11-regular text-text-weaker">加载中...</div>}
                      >
                        <Show
                          when={tables().length > 0}
                          fallback={<div class="px-2 py-0.5 text-11-regular text-text-weaker">无表</div>}
                        >
                          <For each={tables()}>
                            {(table) => (
                              <div
                                class="flex items-center gap-1 px-2 py-0.5 text-11-regular text-text-weaker hover:text-text-base hover:bg-background-stronger rounded cursor-pointer transition-all duration-150 active:scale-95 active:bg-background-accent-stronger"
                                onClick={() => openTableViewer(item.connId, item.db, table)}
                              >
                                <span class="text-10-regular text-text-weaker">◇</span>
                                <span class="truncate">{table}</span>
                              </div>
                            )}
                          </For>
                        </Show>
                      </Show>
                    </div>
                  </Show>
                </div>
              )
            }}
          </For>
        </div>
      </Show>
      {/* 表查看器 */}
      <Show when={viewerTable()}>
        {(vt) => (
          <div class="shrink-0 border-b border-border-weaker-base">
            <div class="flex items-center justify-between px-3 py-2">
              <div class="flex items-center gap-2">
                <span class="text-12-medium text-text-base">{vt().tableName}</span>
                <span class="text-11-regular text-text-weaker">/ {vt().dbName}</span>
              </div>
              <button
                class="text-11-regular text-text-weak hover:text-text-base transition-all duration-150 active:scale-95 active:bg-background-accent-stronger"
                onClick={() => setViewerTable(null)}
              >
                ✕
              </button>
            </div>
            <div class="max-h-64 overflow-auto">
              <Show when={!viewerLoading()} fallback={<div class="px-3 py-2 text-11-regular text-text-weaker">加载中...</div>}>
                <Show when={viewerColumns().length > 0} fallback={<div class="px-3 py-2 text-11-regular text-text-weaker">无结构信息</div>}>
                  <table class="w-full text-11-regular">
                    <thead>
                      <tr class="border-b border-border-weaker-base">
                        <For each={viewerColumns()}>
                          {(col) => <th class="px-2 py-1 text-left text-10-medium text-text-weak whitespace-nowrap">{col.name}<span class="text-text-weaker ml-1">{col.type}</span></th>}
                        </For>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={viewerData().rows}>
                        {(row) => (
                          <tr class="border-b border-border-weaker-base">
                            <For each={viewerColumns()}>
                              {(col) => <td class="px-2 py-0.5 text-text-base whitespace-nowrap">{String(row[col.name] ?? "NULL")}</td>}
                            </For>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </Show>
              </Show>
            </div>
          </div>
        )}
      </Show>

      {/* 结果 */}
      <div class="flex-1 overflow-auto px-3 py-2">
        <Show when={result()}>
          {(res) => (
            <Show
              when={!res().error}
              fallback={<div class="whitespace-pre-wrap text-12-regular text-text-error">{res().error}</div>}
            >
              <Show when={res().message}>
                <div class="mb-2 px-2 py-1 rounded bg-surface-success-weak text-11-medium text-text-on-success-base">{res().message}</div>
              </Show>
              <Show when={res().columns.length > 0}>
                <div class="overflow-auto">
                  <table class="w-full text-12-regular">
                    <thead>
                      <tr class="border-b border-border-weaker-base">
                        <For each={res().columns}>
                          {(col) => (
                            <th class="px-2 py-1 text-left text-11-medium text-text-weak whitespace-nowrap">{col}</th>
                          )}
                        </For>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={res().rows}>
                        {(row) => (
                          <tr class="border-b border-border-weaker-base">
                            <For each={res().columns}>
                              {(col) => (
                                <td class="px-2 py-1 text-text-base whitespace-nowrap">
                                  {String(row[col] ?? "NULL")}
                                </td>
                              )}
                            </For>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>
              </Show>
            </Show>
          )}
        </Show>
      </div>

      {/* SQL 控制台 */}
      <Show when={consoleOpen()}>
        <div class="shrink-0 border-b border-border-weaker-base flex flex-col animate-slide-down" style={{ "max-height": "50%" }}>
          <div class="flex items-center justify-between px-3 py-2 border-b border-border-weaker-base">
            <div class="flex items-center gap-2">
              <span class="text-12-medium text-text-base">SQL 控制台</span>
              <span class="text-11-regular text-text-weaker">{consoleDb()?.dbName}</span>
            </div>
            <button
              class="text-11-regular text-text-weaker hover:text-text-base transition-all duration-150 active:scale-95 active:bg-background-accent-stronger"
              onClick={() => setConsoleOpen(false)}
            >
              ✕
            </button>
          </div>
          <div class="px-3 py-2 border-b border-border-weaker-base">
            <textarea
              class="w-full h-20 px-2 py-1 rounded border border-border-weaker-base bg-background-stronger text-text-base text-12-regular font-mono resize-none"
              placeholder="输入 SQL 语句... (Ctrl+Enter 执行)"
              value={consoleSql()}
              onInput={(e) => setConsoleSql(e.currentTarget.value)}
              onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); executeConsoleSql() } }}
            />
            <div class="flex items-center gap-2 mt-2">
              <button
                class="px-3 py-1 rounded bg-surface-success-base text-text-on-success-base text-12-medium transition-all duration-150 active:scale-95 active:bg-background-accent-stronger hover:opacity-80 disabled:opacity-50"
                onClick={executeConsoleSql}
                disabled={consoleExecuting() || !consoleSql().trim()}
              >
                {consoleExecuting() ? "执行中..." : "执行"}
              </button>
            </div>
          </div>
          <Show when={consoleResult()}>
            {(res) => (
              <div class="flex-1 overflow-auto p-3">
                <Show
                  when={res().error}
                  fallback={
                    <table class="w-full text-12-regular">
                      <thead>
                        <tr>
                          <For each={res().columns}>
                            {(col) => (
                              <th class="px-2 py-1 text-left text-11-medium text-text-weak whitespace-nowrap">{col}</th>
                            )}
                          </For>
                        </tr>
                      </thead>
                      <tbody>
                        <For each={res().rows}>
                          {(row) => (
                            <tr class="border-b border-border-weaker-base">
                              <For each={res().columns}>
                                {(col) => (
                                  <td class="px-2 py-1 text-text-base whitespace-nowrap">
                                    {String(row[col] ?? "NULL")}
                                  </td>
                                )}
                              </For>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                  }
                >
                  <div class="text-12-regular text-text-on-critical-base">{res().error}</div>
                </Show>
              </div>
            )}
          </Show>
        </div>
      </Show>
      </div>

      {/* 右键菜单 - 在主容器外，避开 CSS transform/overflow */}
      <Show when={contextMenu()}>
        <div
          class="fixed inset-0 z-40"
          onClick={() => setContextMenu(null)}
          onContextMenu={(e) => { e.preventDefault(); setContextMenu(null) }}
        />
        <div
          class="fixed z-50 bg-background-stronger border border-border-base rounded shadow-lg py-1 min-w-[160px] animate-in"
          style={{
            left: `${contextMenu()!.x}px`,
            top: `${contextMenu()!.y}px`,
          }}
        >
          <button
            class="w-full px-3 py-1.5 text-left text-12-regular text-text-base transition-all duration-150 active:scale-95 active:bg-background-accent-stronger bg-background-stronger hover:bg-background-accent-stronger"
            onClick={() => {
              const cm = contextMenu()
              if (cm) openConsole(cm.connId, cm.dbName)
            }}
          >
            📝 打开 SQL 控制台
          </button>
        </div>
      </Show>
    </>
  )
}

/* ──── 新建连接弹窗 ──── */

function DialogDatabaseConnection(props: { baseUrl: string; onSave: (conn: DBConnection) => void }) {
  const [type, setType] = createSignal<DBType>("mysql")
  const [host, setHost] = createSignal("localhost")
  const [port, setPort] = createSignal(3306)
  const [user, setUser] = createSignal("root")
  const [password, setPassword] = createSignal("")
  const [database, setDatabase] = createSignal("")
  const [testing, setTesting] = createSignal(false)
  const [testResult, setTestResult] = createSignal<{ success: boolean; message: string; version?: string; pingMs?: number } | null>(null)

  const handleTypeChange = (t: DBType) => {
    setType(t)
    setPort(DB_DEFAULTS[t].port)
  }

  const testConnection = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await testDatabaseConnection(props.baseUrl, trimConnFields({
        type: type(),
        host: host(),
        port: port(),
        user: user(),
        password: password(),
        database: database(),
      }))
      setTestResult(res)
    } catch (e) {
      setTestResult({ success: false, message: String(e) })
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    if (!testResult()?.success) return
    const databases = await listDatabases(props.baseUrl, trimConnFields({
      type: type(),
      host: host(),
      port: port(),
      user: user(),
      password: password(),
      database: database(),
    }))
    props.onSave({
      id: generateId(),
      name: `${DB_LABELS[type()]} ${host()}:${port()}`,
      type: type(),
      host: host(),
      port: port(),
      user: user(),
      password: password(),
      database: database(),
      connected: true,
      databases,
    })
  }

  return (
    <Dialog
      title="新建数据库连接"
      action={<IconButton icon="close" variant="ghost" aria-label="关闭" />}
      class="w-full max-w-[480px] mx-auto"
    >
      <div class="flex flex-col gap-3 p-6 pt-0">
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-11-medium text-text-weak mb-1">类型</label>
            <select
              class="w-full px-2 py-1 rounded border border-border-weaker-base bg-background-stronger text-text-base text-12-regular"
              value={type()}
              onChange={(e) => handleTypeChange(e.currentTarget.value as DBType)}
            >
              <For each={Object.keys(DB_LABELS) as DBType[]}>
                {(t) => <option value={t}>{DB_LABELS[t]}</option>}
              </For>
            </select>
          </div>
          <div>
            <label class="block text-11-medium text-text-weak mb-1">数据库</label>
            <input
              type="text"
              class="w-full px-2 py-1 rounded border border-border-weaker-base bg-background-stronger text-text-base text-12-regular"
              placeholder={type() === "sqlite" ? "/path/to/db.sqlite" : "数据库名"}
              value={database()}
              onInput={(e) => setDatabase(e.currentTarget.value)}
            />
          </div>
        </div>

        <Show when={type() !== "sqlite"}>
          <div class="grid grid-cols-3 gap-3">
            <div class="col-span-2">
              <label class="block text-11-medium text-text-weak mb-1">主机</label>
              <input
                type="text"
                class="w-full px-2 py-1 rounded border border-border-weaker-base bg-background-stronger text-text-base text-12-regular"
                value={host()}
                onInput={(e) => setHost(e.currentTarget.value)}
              />
            </div>
            <div>
              <label class="block text-11-medium text-text-weak mb-1">端口</label>
              <input
                type="number"
                class="w-full px-2 py-1 rounded border border-border-weaker-base bg-background-stronger text-text-base text-12-regular"
                value={port()}
                onInput={(e) => setPort(parseInt(e.currentTarget.value) || 0)}
              />
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-11-medium text-text-weak mb-1">用户名</label>
              <input
                type="text"
                class="w-full px-2 py-1 rounded border border-border-weaker-base bg-background-stronger text-text-base text-12-regular"
                value={user()}
                onInput={(e) => setUser(e.currentTarget.value)}
              />
            </div>
            <div>
              <label class="block text-11-medium text-text-weak mb-1">密码</label>
              <input
                type="password"
                class="w-full px-2 py-1 rounded border border-border-weaker-base bg-background-stronger text-text-base text-12-regular"
                value={password()}
                onInput={(e) => setPassword(e.currentTarget.value)}
              />
            </div>
          </div>
        </Show>

        <Show when={testResult()}>
          {(res) => (
            <div
              class={`px-2 py-1 rounded text-11-medium ${
                res().success
                  ? "bg-surface-success-weak text-text-on-success-base"
                  : "bg-surface-critical-weak text-text-on-critical-base"
              }`}
            >
              <div>{res().message}</div>
              <Show when={res().version}>
                <div class="text-10-regular text-text-weaker mt-1">版本：{res().version}</div>
              </Show>
              <Show when={res().pingMs !== undefined}>
                <div class="text-10-regular text-text-weaker">Ping：{res().pingMs}ms</div>
              </Show>
            </div>
          )}
        </Show>

        <div class="flex justify-end gap-2">
          <button
            class="px-3 py-1 rounded bg-surface-success-base text-text-on-success-base text-12-medium transition-all duration-150 active:scale-95 active:bg-background-accent-stronger hover:opacity-80 disabled:opacity-50"
            onClick={testConnection}
            disabled={testing()}
          >
            {testing() ? "测试中..." : "测试连接"}
          </button>
          <button
            class="px-3 py-1 rounded bg-background-accent-stronger text-text-accent text-12-medium transition-all duration-150 active:scale-95 active:bg-background-accent-stronger hover:opacity-80 disabled:opacity-50"
            onClick={handleSave}
            disabled={!testResult()?.success}
          >
            保存
          </button>
        </div>
      </div>
    </Dialog>
  )
}

/* ──── 新建数据库弹窗 ──── */

function DialogCreateDatabase(props: { baseUrl: string; connection: DBConnection; onCreated: () => void }) {
  const [dbName, setDbName] = createSignal("")
  const [creating, setCreating] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  const handleCreate = async () => {
    const name = dbName().trim()
    if (!name) return
    setCreating(true)
    setError(null)
    try {
      const conn = props.connection
      const createSql =
        conn.type === "postgresql" || conn.type === "sqlserver"
          ? `CREATE DATABASE "${name}"`
          : `CREATE DATABASE \`${name}\``
      const res = await executeSql(props.baseUrl, trimConnFields({
        type: conn.type,
        host: conn.host,
        port: conn.port,
        user: conn.user,
        password: conn.password,
        database: conn.database,
        sql: createSql,
      }))
      if (!res.success) {
        setError(res.message)
      } else {
        props.onCreated()
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog
      title="新建数据库"
      action={<IconButton icon="close" variant="ghost" aria-label="关闭" />}
      class="w-full max-w-[360px] mx-auto"
    >
      <div class="flex flex-col gap-3 p-6 pt-0">
        <div>
          <label class="block text-11-medium text-text-weak mb-1">数据库名称</label>
          <input
            type="text"
            class="w-full px-2 py-1 rounded border border-border-weaker-base bg-background-stronger text-text-base text-12-regular"
            placeholder="输入数据库名称..."
            value={dbName()}
            onInput={(e) => setDbName(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate()
            }}
          />
        </div>
        <Show when={error()}>
          <div class="px-2 py-1 rounded bg-surface-critical-weak text-11-medium text-text-on-critical-base">{error()}</div>
        </Show>
        <div class="flex justify-end">
          <button
            class="px-3 py-1 rounded bg-surface-success-base text-text-on-success-base text-12-medium transition-all duration-150 active:scale-95 active:bg-background-accent-stronger hover:opacity-80 disabled:opacity-50"
            onClick={handleCreate}
            disabled={creating() || !dbName().trim()}
          >
            {creating() ? "创建中..." : "创建"}
          </button>
        </div>
      </div>
    </Dialog>
  )
}
