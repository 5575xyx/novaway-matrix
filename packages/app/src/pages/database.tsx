import { createMemo, createResource, createSignal, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useParams } from "@solidjs/router"
import { Button } from "@novaway/ui/button"
import { Checkbox } from "@novaway/ui/checkbox"
import { Icon } from "@novaway/ui/icon"
import { Popover } from "@novaway/ui/popover"
import { Spinner } from "@novaway/ui/spinner"
import { TextField } from "@novaway/ui/text-field"
import { showToast } from "@novaway/ui/toast"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { decode64 } from "@/utils/base64"
import { Persist, persisted } from "@/utils/persist"
import { callTool } from "@/utils/tool-call"

type Connection = {
  name: string
  type: string
  host: string
  port: number
  database?: string
}

type ColumnInfo = {
  name: string
  type: string
  nullable: string
  default: string
  comment: string
}

function extractResultText(data: unknown): string {
  if (typeof data === "string") return data
  if (data && typeof data === "object" && "content" in data && Array.isArray(data.content)) {
    const first = data.content[0]
    if (first && typeof first === "object" && "text" in first && typeof first.text === "string") {
      return first.text
    }
  }
  return ""
}

function parseMarkdownTable(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split("\n").filter((line) => line.trim() !== "")
  if (lines.length === 0) return { headers: [], rows: [] }

  const headerLine = lines.find((line) => line.includes("|"))
  if (!headerLine) return { headers: [], rows: [] }

  const headers = headerLine
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim())

  const separatorIndex = lines.findIndex((line) => /^\s*\|(\s*[-:]+\s*\|)+$/.test(line))
  const rowLines = separatorIndex === -1 ? lines.slice(1) : lines.slice(separatorIndex + 1)

  const rows = rowLines
    .filter((line) => line.includes("|"))
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim()),
    )

  return { headers, rows }
}

function isMysqlLike(type: string): boolean {
  return ["mysql", "mariadb", "doris", "starrocks"].includes(type)
}

function listDatabasesSql(type: string): string | undefined {
  if (isMysqlLike(type)) {
    return "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME"
  }
  switch (type) {
    case "postgres":
    case "postgresql":
    case "redshift":
    case "clickhouse":
      return "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname"
    case "sqlite":
    case "duckdb":
    case "h2":
      return "SHOW DATABASES"
    case "sqlserver":
      return "SELECT name FROM sys.databases ORDER BY name"
    default:
      return undefined
  }
}

function databaseListFromResult(type: string, text: string, defaultDatabase?: string): string[] {
  const { rows } = parseMarkdownTable(text)
  if (rows.length === 0 && defaultDatabase) return [defaultDatabase]
  return rows.map((row) => row[0]).filter((name): name is string => !!name)
}

function tableListFromResult(text: string): string[] {
  const { rows } = parseMarkdownTable(text)
  return rows.map((row) => row[0]).filter((name): name is string => !!name)
}

function columnListFromResult(text: string): ColumnInfo[] {
  const { headers, rows } = parseMarkdownTable(text)
  if (rows.length === 0) return []

  const get = (row: string[], names: string[]) => {
    for (const name of names) {
      const index = headers.findIndex((h) => h.toLowerCase() === name.toLowerCase())
      if (index !== -1) return row[index] ?? ""
    }
    return ""
  }

  return rows.map((row) => ({
    name: get(row, ["column", "name", "field"]),
    type: get(row, ["type", "data_type", "datatype"]),
    nullable: get(row, ["nullable", "is_nullable", "null"]),
    default: get(row, ["default", "column_default", "default_value"]),
    comment: get(row, ["comment", "column_comment"]),
  }))
}

function treeKey(parts: string[]): string {
  return parts.join("\0")
}

function DatabaseList(props: {
  connection: Connection
  databases: () => string[]
  loading: () => boolean
  expandedDatabases: () => Set<string>
  tables: Record<string, string[]>
  columns: Record<string, ColumnInfo[]>
  loadingNodes: Record<string, boolean>
  onToggleDatabase: (connection: string, database: string) => void
  onSelectTable: (connection: string, database: string, table: string) => void
  onInsertTable: (table: string) => void
}) {
  const language = useLanguage()
  return (
    <Show
      when={!props.loading()}
      fallback={
        <div class="flex items-center justify-center p-2">
          <Spinner class="size-3.5" />
        </div>
      }
    >
      <Show
        when={props.databases().length > 0}
        fallback={<div class="text-12-medium text-text-weak p-1">{language.t("database.databases.empty")}</div>}
      >
        <For each={props.databases()}>
          {(database) => {
            const key = treeKey(["db", props.connection.name, database])
            const expanded = () => props.expandedDatabases().has(key)
            return (
              <div class="flex flex-col">
                <button
                  type="button"
                  class="text-left w-full rounded-md px-2 py-1 text-12-medium text-text-base hover:bg-surface-base-hover transition-colors flex items-center gap-1.5"
                  onClick={() => props.onToggleDatabase(props.connection.name, database)}
                >
                  <Icon size="small" name={expanded() ? "chevron-down" : "chevron-right"} />
                  <Icon size="small" name="database" class="text-text-weak" />
                  <span>{database}</span>
                </button>
                <Show when={expanded()}>
                  <div class="pl-6 flex flex-col gap-0.5">
                    <TableList
                      connection={props.connection.name}
                      database={database}
                      tables={() => props.tables[treeKey(["tables", props.connection.name, database])] ?? []}
                      loading={() => props.loadingNodes[treeKey(["tables", props.connection.name, database])] ?? false}
                      columns={props.columns}
                      loadingNodes={props.loadingNodes}
                      onSelectTable={props.onSelectTable}
                      onInsertTable={props.onInsertTable}
                    />
                  </div>
                </Show>
              </div>
            )
          }}
        </For>
      </Show>
    </Show>
  )
}

function TableList(props: {
  connection: string
  database: string
  tables: () => string[]
  loading: () => boolean
  columns: Record<string, ColumnInfo[]>
  loadingNodes: Record<string, boolean>
  onSelectTable: (connection: string, database: string, table: string) => void
  onInsertTable: (table: string) => void
}) {
  const language = useLanguage()
  return (
    <Show
      when={!props.loading()}
      fallback={
        <div class="flex items-center justify-center p-2">
          <Spinner class="size-3.5" />
        </div>
      }
    >
      <Show
        when={props.tables().length > 0}
        fallback={<div class="text-12-medium text-text-weak p-1">{language.t("database.tables.empty")}</div>}
      >
        <For each={props.tables()}>
          {(table) => {
            const columnKey = treeKey(["columns", props.connection, props.database, table])
            const columnLoading = () => props.loadingNodes[columnKey] ?? false
            return (
              <div
                class="group text-left w-full rounded-md px-2 py-1 text-12-regular text-text-base hover:bg-surface-base-hover transition-colors flex items-center gap-1.5 cursor-pointer"
                onClick={() => props.onSelectTable(props.connection, props.database, table)}
              >
                <Icon size="small" name="table" class="text-text-weak" />
                <span class="flex-1 truncate">{table}</span>
                <Show when={columnLoading()}>
                  <Spinner class="size-3" />
                </Show>
                <button
                  type="button"
                  class="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-surface-base-active"
                  onClick={(e) => {
                    e.stopPropagation()
                    props.onInsertTable(table)
                  }}
                  title={language.t("database.quickQuery")}
                >
                  <Icon size="small" name="play" />
                </button>
              </div>
            )
          }}
        </For>
      </Show>
    </Show>
  )
}

function QueryResultTable(props: { text: string }) {
  const language = useLanguage()
  const { headers, rows } = parseMarkdownTable(props.text)
  if (headers.length === 0) {
    return <pre class="whitespace-pre-wrap font-mono text-12-regular text-text-base">{props.text}</pre>
  }
  return (
    <table class="w-full text-12-regular border-collapse border border-border-weak-base rounded-md overflow-hidden">
      <thead class="bg-surface-base text-text-strong text-12-semibold sticky top-0">
        <tr>
          <For each={headers}>
            {(header) => (
              <th class="px-3 py-2 text-left border-b border-border-weak-base whitespace-nowrap">{header}</th>
            )}
          </For>
        </tr>
      </thead>
      <tbody>
        <Show
          when={rows.length > 0}
          fallback={
            <tr>
              <td colSpan={headers.length} class="px-3 py-8 text-center text-13-medium text-text-weak">
                {language.t("database.result.empty")}
              </td>
            </tr>
          }
        >
          <For each={rows}>
            {(row) => (
              <tr class="border-b border-border-weak-base last:border-b-0 hover:bg-surface-base-hover">
                <For each={row}>{(cell) => <td class="px-3 py-1.5 text-text-base whitespace-nowrap">{cell}</td>}</For>
              </tr>
            )}
          </For>
        </Show>
      </tbody>
    </table>
  )
}

function TableStructure(props: {
  connection: string
  database: string
  table: string
  columns: () => ColumnInfo[]
  onRun: () => void
}) {
  const language = useLanguage()
  return (
    <div class="flex flex-col gap-3 h-full">
      <div class="flex items-center justify-between">
        <h2 class="text-14-semibold text-text-strong">
          {language.t("database.structure.title")}: {props.table}
        </h2>
        <Button variant="secondary" size="small" onClick={props.onRun}>
          {language.t("database.query.run")}
        </Button>
      </div>
      <Show
        when={props.columns().length > 0}
        fallback={
          <div class="text-13-medium text-text-weak flex items-center justify-center flex-1">
            {language.t("database.columns.empty")}
          </div>
        }
      >
        <table class="w-full text-12-regular border-collapse border border-border-weak-base rounded-md overflow-hidden">
          <thead class="bg-surface-base text-text-strong text-12-semibold">
            <tr>
              <th class="px-3 py-2 text-left border-b border-border-weak-base">
                {language.t("database.columns.name")}
              </th>
              <th class="px-3 py-2 text-left border-b border-border-weak-base">
                {language.t("database.columns.type")}
              </th>
              <th class="px-3 py-2 text-left border-b border-border-weak-base">
                {language.t("database.columns.nullable")}
              </th>
              <th class="px-3 py-2 text-left border-b border-border-weak-base">
                {language.t("database.columns.default")}
              </th>
              <th class="px-3 py-2 text-left border-b border-border-weak-base">
                {language.t("database.columns.comment")}
              </th>
            </tr>
          </thead>
          <tbody>
            <For each={props.columns()}>
              {(column) => (
                <tr class="border-b border-border-weak-base last:border-b-0 hover:bg-surface-base-hover">
                  <td class="px-3 py-1.5 font-mono text-text-base">{column.name}</td>
                  <td class="px-3 py-1.5 text-text-weak">{column.type}</td>
                  <td class="px-3 py-1.5 text-text-weak">{column.nullable}</td>
                  <td class="px-3 py-1.5 text-text-weak font-mono">{column.default}</td>
                  <td class="px-3 py-1.5 text-text-weak">{column.comment}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
    </div>
  )
}
export function DatabasePage(props: { onBack: () => void }) {
  const language = useLanguage()
  const params = useParams()
  const server = useServer()
  const directory = createMemo(() => decode64(params.dir))

  const currentServer = () => server.current

  const [connections, setConnections] = createSignal<Connection[]>([])
  const [databases, setDatabases] = createStore<Record<string, string[]>>({})
  const [tables, setTables] = createStore<Record<string, string[]>>({})
  const [columns, setColumns] = createStore<Record<string, ColumnInfo[]>>({})
  const [expandedConnections, setExpandedConnections] = createSignal(new Set<string>())
  const [expandedDatabases, setExpandedDatabases] = createSignal(new Set<string>())
  const [loadingConnections, setLoadingConnections] = createSignal(false)
  const [loadingNodes, setLoadingNodes] = createStore<Record<string, boolean>>({})
  const [selectedDatabasesStore, setSelectedDatabasesStore] = createStore<Record<string, string[]>>({})
  const [persistedSelected, setPersistedSelected] = persisted(
    Persist.global("database.selectedDatabases", ["database.selectedDatabases.v1"]),
    [selectedDatabasesStore, setSelectedDatabasesStore],
  )
  const selectedDatabases = createMemo(() => {
    const result: Record<string, Set<string>> = {}
    for (const connection of connections()) {
      result[connection.name] = new Set(persistedSelected[connection.name] ?? [])
    }
    return result
  })
  const [selectedTable, setSelectedTable] = createSignal<{ connection: string; database: string; table: string }>()
  const [activeTab, setActiveTab] = createSignal<"data" | "structure">("data")
  const [query, setQuery] = createSignal("")
  const [result, setResult] = createSignal("")
  const [running, setRunning] = createSignal(false)
  const [connectionContextMenu, setConnectionContextMenu] = createSignal<{
    name: string
    x: number
    y: number
  } | null>(null)

  const closeConnectionContextMenu = () => setConnectionContextMenu(null)
  const handleConnectionContextMenu = (e: MouseEvent, name: string) => {
    e.preventDefault()
    e.stopPropagation()
    setConnectionContextMenu({ name, x: e.clientX, y: e.clientY })
  }

  const connectionByName = (name: string) => connections().find((c) => c.name === name)

  const refreshAll = () => {
    setDatabases({})
    setTables({})
    setColumns({})
    setExpandedDatabases(new Set<string>())
    setSelectedTable(undefined)
    setQuery("")
    setResult("")
    void loadConnections()
  }

  const loadConnections = async () => {
    const conn = currentServer()
    const dir = directory()
    if (!conn) return
    setLoadingConnections(true)
    try {
      const data = await callTool({
        server: conn,
        directory: dir,
        toolId: "dbx_dbx_list_connections",
        arguments: {},
      })
      const text = extractResultText(data)
      const { rows } = parseMarkdownTable(text)
      setConnections(
        rows.map((row) => ({
          name: row[0] ?? "",
          type: (row[1] ?? "").toLowerCase(),
          host: row[2] ?? "",
          port: Number(row[3]) || 0,
          database: row[4] || undefined,
        })),
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      showToast({ title: language.t("database.connections.loadFailed"), description: message })
    } finally {
      setLoadingConnections(false)
    }
  }

  const removeConnection = async (connectionName: string) => {
    const conn = currentServer()
    const dir = directory()
    if (!conn) return
    try {
      await callTool({
        server: conn,
        directory: dir,
        toolId: "dbx_dbx_remove_connection",
        arguments: { connection_name: connectionName },
      })
      showToast({ title: language.t("database.connections.disconnected") })
      void loadConnections()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      showToast({ title: language.t("database.connections.disconnectFailed"), description: message })
    }
  }

  const loadDatabases = async (connectionName: string) => {
    const conn = currentServer()
    const dir = directory()
    const connection = connectionByName(connectionName)
    if (!conn || !connection) return
    const key = treeKey(["databases", connectionName])
    setLoadingNodes(key, true)
    try {
      const sql = listDatabasesSql(connection.type)
      let names: string[]
      if (sql) {
        const data = await callTool({
          server: conn,
          directory: dir,
          toolId: "dbx_dbx_execute_query",
          arguments: {
            connection_name: connectionName,
            sql,
            database: isMysqlLike(connection.type) ? "" : undefined,
          },
        })
        names = databaseListFromResult(connection.type, extractResultText(data), connection.database)
      } else {
        names = connection.database ? [connection.database] : []
      }
      setDatabases(connectionName, names)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      showToast({ title: language.t("database.databases.loadFailed"), description: message })
    } finally {
      setLoadingNodes(key, false)
    }
  }

  const loadTables = async (connectionName: string, database: string) => {
    const cacheKey = treeKey(["tables", connectionName, database])
    const conn = currentServer()
    const dir = directory()
    if (!conn) return
    setLoadingNodes(cacheKey, true)
    try {
      const data = await callTool({
        server: conn,
        directory: dir,
        toolId: "dbx_dbx_list_tables",
        arguments: { connection_name: connectionName, database },
      })
      setTables(cacheKey, tableListFromResult(extractResultText(data)))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      showToast({ title: language.t("database.tables.loadFailed"), description: message })
    } finally {
      setLoadingNodes(cacheKey, false)
    }
  }

  const loadColumns = async (connectionName: string, database: string, table: string) => {
    const cacheKey = treeKey(["columns", connectionName, database, table])
    if (columns[cacheKey]) return
    const conn = currentServer()
    const dir = directory()
    if (!conn) return
    setLoadingNodes(cacheKey, true)
    try {
      const data = await callTool({
        server: conn,
        directory: dir,
        toolId: "dbx_dbx_describe_table",
        arguments: { connection_name: connectionName, database, table },
      })
      setColumns(cacheKey, columnListFromResult(extractResultText(data)))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      showToast({ title: language.t("database.columns.loadFailed"), description: message })
    } finally {
      setLoadingNodes(cacheKey, false)
    }
  }

  const toggleConnection = (connectionName: string) => {
    setExpandedConnections((prev) => {
      const next = new Set(prev)
      if (next.has(connectionName)) {
        next.delete(connectionName)
      } else {
        next.add(connectionName)
        void loadDatabases(connectionName)
      }
      return next
    })
  }

  const toggleDatabase = (connectionName: string, database: string) => {
    const key = treeKey(["db", connectionName, database])
    setExpandedDatabases((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
        void loadTables(connectionName, database)
      }
      return next
    })
  }

  const selectTable = (connectionName: string, database: string, table: string) => {
    setSelectedTable({ connection: connectionName, database, table })
    void loadColumns(connectionName, database, table)
    void loadTableData(connectionName, database, table)
  }

  const loadTableData = async (connectionName: string, database: string, table: string) => {
    const conn = currentServer()
    const dir = directory()
    const connection = connectionByName(connectionName)
    if (!conn || !connection) return
    setRunning(true)
    setResult("")
    try {
      const data = await callTool({
        server: conn,
        directory: dir,
        toolId: "dbx_dbx_execute_query",
        arguments: {
          connection_name: connectionName,
          database,
          sql: `SELECT * FROM ${escapeIdentifier(table)} LIMIT 100`,
        },
      })
      setResult(extractResultText(data))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      showToast({ title: language.t("database.query.failed"), description: message })
    } finally {
      setRunning(false)
    }
  }

  const insertTableQuery = (table: string) => {
    const selected = selectedTable()
    if (!selected) return
    const q = `SELECT * FROM ${escapeIdentifier(table)} LIMIT 100`
    setQuery(q)
  }

  const escapeIdentifier = (name: string) => {
    // Simple escaping for display/query generation; backend handles real quoting.
    return name.includes(" ") ? `\`${name.replace(/`/g, "``")}\`` : name
  }

  const runQuery = async () => {
    const q = query().trim()
    if (!q) {
      showToast({ title: language.t("database.query.empty") })
      return
    }
    const selected = selectedTable()
    const conn = currentServer()
    const dir = directory()
    if (!conn) return
    setRunning(true)
    setResult("")
    try {
      const data = await callTool({
        server: conn,
        directory: dir,
        toolId: "dbx_dbx_execute_query",
        arguments: {
          connection_name: selected?.connection,
          database: selected?.database,
          sql: q,
        },
      })
      setResult(extractResultText(data))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      showToast({ title: language.t("database.query.failed"), description: message })
    } finally {
      setRunning(false)
    }
  }

  const selectedColumns = createMemo(() => {
    const selected = selectedTable()
    if (!selected) return []
    return columns[treeKey(["columns", selected.connection, selected.database, selected.table])] ?? []
  })

  createResource(() => {
    void loadConnections()
    return directory()
  })

  return (
    <div class="flex flex-col h-full bg-background-base">
      <div class="flex items-center justify-between px-4 py-3 border-b border-border-weak-base">
        <div class="flex items-center gap-3">
          <Button variant="ghost" size="small" icon="arrow-left" onClick={props.onBack}>
            {language.t("common.goBack")}
          </Button>
          <h1 class="text-16-semibold text-text-strong">{language.t("database.title")}</h1>
        </div>
        <Button variant="ghost" size="small" icon="refresh" onClick={refreshAll}>
          {language.t("common.refresh")}
        </Button>
      </div>

      <div class="flex-1 min-h-0 flex">
        <div class="w-72 flex flex-col border-r border-border-weak-base">
          <div class="px-3 py-2 text-12-semibold text-text-weak uppercase tracking-wide border-b border-border-weak-base">
            {language.t("database.connections.title")}
          </div>
          <div class="flex-1 overflow-y-auto p-2">
            <Show
              when={!loadingConnections()}
              fallback={
                <div class="flex items-center justify-center p-4">
                  <Spinner class="size-5" />
                </div>
              }
            >
              <Show
                when={connections().length > 0}
                fallback={
                  <div class="text-13-medium text-text-weak p-2">{language.t("database.connections.empty")}</div>
                }
              >
                <For each={connections()}>
                  {(connection) => {
                    const dbKey = treeKey(["databases", connection.name])
                    const dbLoading = () => loadingNodes[dbKey] ?? false
                    const expanded = () => expandedConnections().has(connection.name)
                    const allDatabases = () => databases[connection.name] ?? []
                    const selectedSet = () => selectedDatabases()[connection.name]
                    const visibleDatabases = () => {
                      const selected = selectedSet()
                      if (!selected || selected.size === 0) return []
                      return allDatabases().filter((db) => selected.has(db))
                    }
                    const selectedCount = () => selectedSet()?.size ?? 0
                    const totalCount = () => allDatabases().length
                    return (
                      <div class="flex flex-col mb-2">
                        <div
                          class="flex items-center gap-1"
                          onContextMenu={(e) => handleConnectionContextMenu(e, connection.name)}
                        >
                          <button
                            type="button"
                            class="text-left flex-1 rounded-md px-2 py-1.5 text-13-medium text-text-base hover:bg-surface-base-hover transition-colors flex items-center gap-2"
                            onClick={() => toggleConnection(connection.name)}
                          >
                            <Icon size="small" name={expanded() ? "chevron-down" : "chevron-right"} />
                            <Icon size="small" name="server" class="text-text-weak" />
                            <span class="flex-1 truncate">{connection.name}</span>
                            <Show when={dbLoading()}>
                              <Spinner class="size-3.5" />
                            </Show>
                          </button>
                          <Show when={totalCount() > 0}>
                            <span class="text-12-medium text-text-weak px-1">
                              {selectedCount()}/{totalCount()}
                            </span>
                          </Show>
                          <Popover
                            triggerAs={Button}
                            triggerProps={{
                              variant: "ghost",
                              size: "small",
                              class: "h-7 w-7 p-0 box-border",
                              "aria-label": language.t("database.connections.filterDatabases"),
                            }}
                            trigger={<Icon size="small" name="more-vertical" />}
                            style={{ "z-index": 70 }}
                            onOpenChange={(open) => {
                              if (open) void loadDatabases(connection.name)
                            }}
                          >
                            <div class="p-2 min-w-[180px] max-h-[280px] overflow-y-auto">
                              <div class="text-12-semibold text-text-weak px-1 pb-1.5 mb-1 border-b border-border-weak-base">
                                {language.t("database.connections.filterDatabases")}
                              </div>
                              <For each={databases[connection.name] ?? []}>
                                {(db) => (
                                  <div class="flex items-center gap-2 py-1">
                                    <Checkbox
                                      checked={selectedDatabases()[connection.name]?.has(db) ?? false}
                                      onChange={(checked: boolean) => {
                                        setPersistedSelected(connection.name, (prev) => {
                                          const next = new Set(prev ?? [])
                                          if (checked) next.add(db)
                                          else next.delete(db)
                                          return Array.from(next)
                                        })
                                      }}
                                    >
                                      {db}
                                    </Checkbox>
                                  </div>
                                )}
                              </For>
                            </div>
                          </Popover>
                        </div>
                        <Show when={expanded()}>
                          <div class="pl-7 flex flex-col gap-0.5">
                            <DatabaseList
                              connection={connection}
                              databases={visibleDatabases}
                              loading={dbLoading}
                              expandedDatabases={expandedDatabases}
                              tables={tables}
                              columns={columns}
                              loadingNodes={loadingNodes}
                              onToggleDatabase={toggleDatabase}
                              onSelectTable={selectTable}
                              onInsertTable={insertTableQuery}
                            />
                          </div>
                        </Show>
                      </div>
                    )
                  }}
                </For>
              </Show>
            </Show>
          </div>
        </div>

        <div class="flex-1 min-w-0 flex flex-col">
          <Show
            when={selectedTable()}
            fallback={
              <div class="flex-1 flex items-center justify-center text-13-medium text-text-weak">
                {language.t("database.connection.select")}
              </div>
            }
          >
            {(selected) => (
              <>
                <div class="flex items-center gap-1 px-4 pt-3 pb-0">
                  <button
                    type="button"
                    class={`px-3 py-1.5 text-13-medium rounded-md transition-colors ${
                      activeTab() === "data"
                        ? "bg-surface-base text-text-strong"
                        : "text-text-weak hover:bg-surface-base-hover hover:text-text-base"
                    }`}
                    onClick={() => setActiveTab("data")}
                  >
                    {language.t("database.tab.data")}
                  </button>
                  <button
                    type="button"
                    class={`px-3 py-1.5 text-13-medium rounded-md transition-colors ${
                      activeTab() === "structure"
                        ? "bg-surface-base text-text-strong"
                        : "text-text-weak hover:bg-surface-base-hover hover:text-text-base"
                    }`}
                    onClick={() => setActiveTab("structure")}
                  >
                    {language.t("database.tab.structure")}
                  </button>
                </div>
                <div class="flex-1 min-h-0 p-4 overflow-auto">
                  <Show when={activeTab() === "data"}>
                    <Show
                      when={result()}
                      fallback={
                        <div class="flex h-full items-center justify-center text-13-medium text-text-weak">
                          {running() ? language.t("common.loading") : language.t("database.result.empty")}
                        </div>
                      }
                    >
                      <QueryResultTable text={result()} />
                    </Show>
                  </Show>
                  <Show when={activeTab() === "structure"}>
                    <TableStructure
                      connection={selected().connection}
                      database={selected().database}
                      table={selected().table}
                      columns={selectedColumns}
                      onRun={() => {
                        setQuery(`SELECT * FROM ${escapeIdentifier(selected().table)} LIMIT 100`)
                        void runQuery()
                      }}
                    />
                  </Show>
                </div>
              </>
            )}
          </Show>

          <div class="h-48 flex flex-col border-t border-border-weak-base">
            <div class="px-3 py-2 text-12-semibold text-text-weak uppercase tracking-wide border-b border-border-weak-base">
              {language.t("database.query.label")}
            </div>
            <div class="flex-1 min-h-0 p-3 flex gap-3">
              <TextField
                class="flex-1 min-h-0"
                inputClass="size-full resize-none font-mono text-13-regular bg-surface-base rounded-md border border-border-weak-base px-3 py-2 focus:outline-none focus:ring-1 focus:ring-border-strong-base"
                multiline
                value={query()}
                onChange={setQuery}
                placeholder={language.t("database.query.placeholder")}
              />
              <div class="flex flex-col gap-2">
                <Button
                  variant="primary"
                  size="small"
                  icon={running() ? undefined : "play"}
                  onClick={() => void runQuery()}
                  disabled={running()}
                >
                  {running() ? language.t("common.loading") : language.t("database.query.run")}
                </Button>
              </div>
            </div>
            <div class="h-1/2 min-h-0 border-t border-border-weak-base p-3 overflow-auto">
              <Show
                when={result()}
                fallback={
                  <div class="text-13-medium text-text-weak flex items-center justify-center h-full">
                    {language.t("database.result.empty")}
                  </div>
                }
              >
                <QueryResultTable text={result()} />
              </Show>
            </div>
          </div>
        </div>
      </div>
      <Show when={connectionContextMenu()}>
        {(menu) => (
          <div
            class="fixed inset-0 z-50"
            onClick={closeConnectionContextMenu}
            onContextMenu={(e) => {
              e.preventDefault()
              closeConnectionContextMenu()
            }}
          >
            <div
              class="absolute min-w-[140px] p-1 bg-surface-raised-base border border-border-base rounded-lg shadow-lg"
              style={{ left: `${menu().x}px`, top: `${menu().y}px` }}
            >
              <button
                type="button"
                class="w-full text-left flex items-center gap-2 px-2 py-1.5 text-12-medium text-text-base rounded-md hover:bg-surface-raised-base-hover cursor-pointer outline-none"
                onClick={() => {
                  void removeConnection(menu().name)
                  closeConnectionContextMenu()
                }}
              >
                {language.t("database.connections.disconnect")}
              </button>
            </div>
          </div>
        )}
      </Show>
    </div>
  )
}
