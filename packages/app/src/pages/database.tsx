import { createMemo, createResource, createSignal, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useParams } from "@solidjs/router"
import type { DatabaseQueryResult } from "@novaway/sdk/v2"
import { Button } from "@novaway/ui/button"
import { Checkbox } from "@novaway/ui/checkbox"
import { Icon } from "@novaway/ui/icon"
import { IconButton } from "@novaway/ui/icon-button"
import { Dialog } from "@novaway/ui/dialog"
import { Select } from "@novaway/ui/select"
import { Popover } from "@novaway/ui/popover"
import { Spinner } from "@novaway/ui/spinner"
import { TextField } from "@novaway/ui/text-field"
import { showToast } from "@novaway/ui/toast"
import { useDialog } from "@novaway/ui/context/dialog"
import { ConfirmDialog } from "@/components/dialog-confirm"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { decode64 } from "@/utils/base64"
import { Persist, persisted } from "@/utils/persist"
import { sqlRisk, sqlRiskKeyword, sqlStatementCount } from "@/utils/sql-guard"
import { useGlobalSDK } from "@/context/global-sdk"

type Connection = {
  /** 后端生成的连接 id（增删改查都用它）。 */
  id: string
  name: string
  type: DbType
  host: string
  port: number
  database?: string
  file?: string
  db?: number
  httpPath?: string
  sshEnabled: boolean
  sshHost?: string
}

/** 与后端 `DbType` 保持一致：mariadb / starrocks / doris 走 MySQL 协议。 */
const DB_TYPES = [
  "postgres",
  "mysql",
  "mariadb",
  "sqlite",
  "rqlite",
  "redis",
  "mongodb",
  "clickhouse",
  "starrocks",
  "doris",
] as const
type DbType = (typeof DB_TYPES)[number]

const DEFAULT_PORTS: Record<DbType, string> = {
  postgres: "5432",
  mysql: "3306",
  mariadb: "3306",
  sqlite: "",
  rqlite: "4001",
  redis: "6379",
  mongodb: "27017",
  clickhouse: "8123",
  starrocks: "9030",
  doris: "9030",
}

const MYSQL_TYPES: ReadonlySet<DbType> = new Set(["mysql", "mariadb", "starrocks", "doris"])

/**
 * 传给后端的 database 参数。
 *
 * SQLite / rqlite 只有一个库；Redis 这里传的是逻辑库序号，
 * 其余类型传数据库名（PostgreSQL 会据此切换连接库）。
 */
function targetDatabase(type: DbType, database?: string) {
  if (type === "sqlite" || type === "rqlite") return undefined
  return database
}

function defaultQueryFor(type: DbType, table: string) {
  if (type === "mongodb") return `db.${table}.find({}).limit(100)`
  if (type === "redis") return `GET ${table}`
  return `SELECT * FROM ${table.includes(" ") ? `\`${table.replace(/`/g, "``")}\`` : table} LIMIT 100`
}

/** 直接用 SDK 生成的结果类型，避免手写类型与 schema 漂移。 */
type QueryResult = DatabaseQueryResult

type ColumnInfo = {
  name: string
  type: string
  nullable: boolean
  default?: string
  primary?: boolean
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
        fallback={<div class="text-12-medium text-foreground-subtle p-1">{language.t("database.databases.empty")}</div>}
      >
        <For each={props.databases()}>
          {(database) => {
            const key = treeKey(["db", props.connection.name, database])
            const expanded = () => props.expandedDatabases().has(key)
            return (
              <div class="flex flex-col">
                <button
                  type="button"
                  class="text-left w-full rounded-md px-2 py-1 text-12-medium text-foreground hover:bg-hover transition-colors flex items-center gap-1.5"
                  onClick={() => props.onToggleDatabase(props.connection.name, database)}
                >
                  <Icon size="small" name={expanded() ? "chevron-down" : "chevron-right"} />
                  <Icon size="small" name="database" class="text-foreground-subtle" />
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
        fallback={<div class="text-12-medium text-foreground-subtle p-1">{language.t("database.tables.empty")}</div>}
      >
        <For each={props.tables()}>
          {(table) => {
            const columnKey = treeKey(["columns", props.connection, props.database, table])
            const columnLoading = () => props.loadingNodes[columnKey] ?? false
            return (
              <div
                class="group text-left w-full rounded-md px-2 py-1 text-12-regular text-foreground hover:bg-hover transition-colors flex items-center gap-1.5 cursor-pointer"
                onClick={() => props.onSelectTable(props.connection, props.database, table)}
              >
                <Icon size="small" name="table" class="text-foreground-subtle" />
                <span class="flex-1 truncate">{table}</span>
                <Show when={columnLoading()}>
                  <Spinner class="size-3" />
                </Show>
                <button
                  type="button"
                  class="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-selected"
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

/** 每页行数。后端支持 offset，超过时 UI 会显示「加载更多」。 */
const PAGE_SIZE = 200

/**
 * 查询结果表格。
 *
 * 上游最多返回 100 行且无分页，用户很容易以为「数据就这么多」。
 * 命中上限时明确提示，并给出 LIMIT/OFFSET 的替代写法。
 */
/**
 * 查询结果表格。
 *
 * 与旧实现的关键差别：数据是**结构化的**（columns / rows / truncated），
 * 不再解析 markdown 文本，单元格含 `|` 或换行都不会错位。
 * 结果被截断时显示「加载更多」。
 */
function QueryResultTable(props: { result: QueryResult; loading?: boolean; onLoadMore?: () => void }) {
  const language = useLanguage()
  const headers = () => props.result.columns
  const rows = () => props.result.rows

  return (
    <div class="flex min-w-0 flex-col gap-2">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-11-regular text-foreground-subtle">
        <span>{language.t("database.result.rows", { count: Number(props.result.rowCount) })}</span>
        <span>{language.t("database.result.duration", { ms: Number(props.result.durationMs) })}</span>
        <Show when={props.result.affected !== undefined}>
          <span>{language.t("database.result.affected", { count: Number(props.result.affected ?? 0) })}</span>
        </Show>
        <Show when={props.result.truncated}>
          <span class="text-[#b45309]">{language.t("database.result.truncated")}</span>
        </Show>
      </div>

      <Show
        when={headers().length > 0}
        fallback={
          <pre class="whitespace-pre-wrap font-mono text-12-regular text-foreground">
            {props.result.affected !== undefined
              ? language.t("database.result.affectedOnly", { count: props.result.affected })
              : language.t("database.result.empty")}
          </pre>
        }
      >
        <table class="w-full text-12-regular border-collapse border border-border rounded-md overflow-hidden">
          <thead class="bg-surface text-foreground text-12-semibold sticky top-0">
            <tr>
              <For each={headers()}>
                {(header) => <th class="px-3 py-2 text-left border-b border-border whitespace-nowrap">{header}</th>}
              </For>
            </tr>
          </thead>
          <tbody>
            <Show
              when={rows().length > 0}
              fallback={
                <tr>
                  <td
                    colSpan={Math.max(headers().length, 1)}
                    class="px-3 py-8 text-center text-13-medium text-foreground-subtle"
                  >
                    {language.t("database.result.empty")}
                  </td>
                </tr>
              }
            >
              <For each={rows()}>
                {(row) => (
                  <tr class="border-b border-border last:border-b-0 hover:bg-hover">
                    <For each={row}>
                      {(cell) => (
                        <td class="px-3 py-1.5 text-foreground whitespace-nowrap">
                          <Show
                            when={cell !== null && cell !== undefined}
                            fallback={<span class="text-foreground-subtlest italic">NULL</span>}
                          >
                            <span>{formatCell(cell)}</span>
                          </Show>
                        </td>
                      )}
                    </For>
                  </tr>
                )}
              </For>
            </Show>
          </tbody>
        </table>

        <Show when={props.result.truncated}>
          <div class="flex justify-center pt-1">
            <Button size="small" variant="secondary" disabled={props.loading} onClick={() => props.onLoadMore?.()}>
              {props.loading ? language.t("common.loading") : language.t("database.result.loadMore")}
            </Button>
          </div>
        </Show>
      </Show>
    </div>
  )
}

/** 单元格渲染：对象转 JSON、其余转字符串。 */
export function formatCell(value: unknown) {
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
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
        <h2 class="text-14-semibold text-foreground">
          {language.t("database.structure.title")}: {props.table}
        </h2>
        <Button variant="secondary" size="small" onClick={props.onRun}>
          {language.t("database.query.run")}
        </Button>
      </div>
      <Show
        when={props.columns().length > 0}
        fallback={
          <div class="text-13-medium text-foreground-subtle flex items-center justify-center flex-1">
            {language.t("database.columns.empty")}
          </div>
        }
      >
        <table class="w-full text-12-regular border-collapse border border-border rounded-md overflow-hidden">
          <thead class="bg-surface text-foreground text-12-semibold">
            <tr>
              <th class="px-3 py-2 text-left border-b border-border">{language.t("database.columns.name")}</th>
              <th class="px-3 py-2 text-left border-b border-border">{language.t("database.columns.type")}</th>
              <th class="px-3 py-2 text-left border-b border-border">{language.t("database.columns.nullable")}</th>
              <th class="px-3 py-2 text-left border-b border-border">{language.t("database.columns.default")}</th>
              <th class="px-3 py-2 text-left border-b border-border">{language.t("database.columns.primary")}</th>
            </tr>
          </thead>
          <tbody>
            <For each={props.columns()}>
              {(column) => (
                <tr class="border-b border-border last:border-b-0 hover:bg-hover">
                  <td class="px-3 py-1.5 font-mono text-foreground">{column.name}</td>
                  <td class="px-3 py-1.5 text-foreground-subtle">{column.type}</td>
                  <td class="px-3 py-1.5 text-foreground-subtle">
                    {column.nullable ? language.t("database.columns.yes") : language.t("database.columns.no")}
                  </td>
                  <td class="px-3 py-1.5 text-foreground-subtle font-mono">{column.default}</td>
                  <td class="px-3 py-1.5 text-foreground-subtle">{column.primary ? "PK" : ""}</td>
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
  const globalSDK = useGlobalSDK()
  const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))
  /** 数据库接口挂在实例上，按当前目录建客户端。 */
  const client = () => globalSDK.createClient({ directory: directory(), throwOnError: true })

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
  const [result, setResult] = createSignal<QueryResult>()
  const dialog = useDialog()
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
    setResult(undefined)
    void loadConnections()
  }

  const loadConnections = async () => {
    const dir = directory()
    setLoadingConnections(true)
    try {
      const result = await client().database.list({ directory: dir })
      setConnections(
        (result.data ?? []).map((item) => ({
          id: item.id,
          name: item.name,
          type: item.type as DbType,
          host: item.host ?? "",
          port: Number(item.port ?? 0),
          database: item.database ?? undefined,
          file: item.file ?? undefined,
          db: item.db === undefined ? undefined : Number(item.db),
          httpPath: item.httpPath ?? undefined,
          sshEnabled: Boolean(item.sshEnabled),
          sshHost: item.sshHost ?? undefined,
        })),
      )
    } catch (error) {
      showToast({ title: language.t("database.connections.loadFailed"), description: messageOf(error) })
    } finally {
      setLoadingConnections(false)
    }
  }

  /** 添加连接：本地保存配置，保存后立即测试连通性。 */
  const addConnection = () => {
    const [form, setForm] = createStore({
      name: "",
      type: "sqlite" as DbType,
      host: "127.0.0.1",
      port: DEFAULT_PORTS.sqlite,
      database: "",
      user: "",
      password: "",
      file: "",
      db: "0",
      httpPath: "",
      ssl: false,
      sshEnabled: false,
      sshHost: "",
      sshPort: "22",
      sshUser: "",
      sshPassword: "",
      sshKeyPath: "",
      sshKey: "",
      sshPassphrase: "",
    })
    const [saving, setSaving] = createSignal(false)

    const save = async () => {
      if (!form.name.trim()) return
      setSaving(true)
      try {
        const network = form.type !== "sqlite"
        const port = form.port.trim() ? Number(form.port) : Number(DEFAULT_PORTS[form.type]) || undefined
        const saved = await client().database.save({
          directory: directory(),
          databaseConnectionInput: {
            name: form.name.trim(),
            type: form.type,
            host: network ? form.host.trim() || undefined : undefined,
            port: network ? port : undefined,
            database: form.type === "sqlite" || form.type === "redis" ? undefined : form.database.trim() || undefined,
            user: network ? form.user.trim() || undefined : undefined,
            password: network ? form.password || undefined : undefined,
            file: form.type === "sqlite" ? form.file.trim() || undefined : undefined,
            db: form.type === "redis" ? Number(form.db || 0) : undefined,
            httpPath: form.type === "rqlite" ? form.httpPath.trim() || undefined : undefined,
            ssl: network ? form.ssl || undefined : undefined,
            ssh:
              network && form.sshEnabled
                ? {
                    enabled: true,
                    host: form.sshHost.trim(),
                    port: form.sshPort.trim() ? Number(form.sshPort) : undefined,
                    user: form.sshUser.trim(),
                    password: form.sshPassword || undefined,
                    privateKeyPath: form.sshKeyPath.trim() || undefined,
                    privateKey: form.sshKey.trim() || undefined,
                    passphrase: form.sshPassphrase || undefined,
                  }
                : undefined,
          },
        })
        const id = saved.data?.id
        if (id) {
          const tested = await client().database.testConnection({ directory: directory(), connectionID: id })
          showToast({
            variant: tested.data?.ok ? "success" : "error",
            icon: tested.data?.ok ? "circle-check" : "circle-x",
            title: language.t(tested.data?.ok ? "database.connections.form.saved" : "database.connections.testFailed"),
            description: tested.data?.message,
          })
        }
        dialog.close()
        await loadConnections()
      } catch (error) {
        showToast({ title: language.t("common.requestFailed"), description: messageOf(error) })
      } finally {
        setSaving(false)
      }
    }

    dialog.show(() => (
      <Dialog title={language.t("database.connections.form.title")} transition class="w-[min(calc(100vw-40px),560px)]">
        <form
          class="flex flex-col gap-3 px-2.5 pb-3 max-h-[70vh] overflow-y-auto"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <TextField
            label={language.t("database.connections.form.name")}
            value={form.name}
            onChange={(value) => setForm("name", value)}
            autofocus
          />
          <Select
            options={[...DB_TYPES]}
            current={form.type}
            value={(value) => value}
            label={(value) => value}
            onSelect={(value) => {
              if (!value) return
              setForm("type", value)
              // 换类型时把端口带成该类型的默认值，避免 mysql 连接还留着 5432。
              setForm("port", DEFAULT_PORTS[value])
            }}
            variant="secondary"
            size="small"
          />

          <Show when={form.type === "sqlite"}>
            <TextField
              label={language.t("database.connections.form.file")}
              value={form.file}
              onChange={(value) => setForm("file", value)}
              placeholder="C:\data\app.db"
            />
          </Show>

          <Show when={form.type !== "sqlite"}>
            <div class="grid grid-cols-2 gap-3">
              <TextField
                label={language.t("database.connections.form.host")}
                value={form.host}
                onChange={(value) => setForm("host", value)}
              />
              <TextField
                label={language.t("database.connections.form.port")}
                value={form.port}
                onChange={(value) => setForm("port", value)}
                placeholder={DEFAULT_PORTS[form.type]}
              />
            </div>
            <Show when={form.type === "redis"}>
              <TextField
                label={language.t("database.connections.form.db")}
                value={form.db}
                onChange={(value) => setForm("db", value)}
                placeholder="0"
              />
            </Show>
            <Show when={form.type !== "redis" && form.type !== "rqlite"}>
              <TextField
                label={language.t("database.connections.form.database")}
                value={form.database}
                onChange={(value) => setForm("database", value)}
                placeholder={form.type === "mongodb" ? "test" : form.type === "clickhouse" ? "default" : ""}
              />
            </Show>
            <Show when={form.type === "rqlite"}>
              <TextField
                label={language.t("database.connections.form.httpPath")}
                value={form.httpPath}
                onChange={(value) => setForm("httpPath", value)}
                placeholder="/db"
              />
            </Show>
            <div class="grid grid-cols-2 gap-3">
              <TextField
                label={language.t("database.connections.form.user")}
                value={form.user}
                onChange={(value) => setForm("user", value)}
              />
              <TextField
                label={language.t("database.connections.form.password")}
                type="password"
                value={form.password}
                onChange={(value) => setForm("password", value)}
              />
            </div>
            <Checkbox checked={form.ssl} onChange={(checked: boolean) => setForm("ssl", checked)}>
              {language.t("database.connections.form.ssl")}
            </Checkbox>

            <div class="rounded-md border border-border p-3 flex flex-col gap-2">
              <Checkbox checked={form.sshEnabled} onChange={(checked: boolean) => setForm("sshEnabled", checked)}>
                {language.t("database.connections.form.ssh.enabled")}
              </Checkbox>
              <Show when={form.sshEnabled}>
                <div class="grid grid-cols-2 gap-3">
                  <TextField
                    label={language.t("database.connections.form.ssh.host")}
                    value={form.sshHost}
                    onChange={(value) => setForm("sshHost", value)}
                    placeholder="jump.example.com"
                  />
                  <TextField
                    label={language.t("database.connections.form.ssh.port")}
                    value={form.sshPort}
                    onChange={(value) => setForm("sshPort", value)}
                    placeholder="22"
                  />
                </div>
                <div class="grid grid-cols-2 gap-3">
                  <TextField
                    label={language.t("database.connections.form.ssh.user")}
                    value={form.sshUser}
                    onChange={(value) => setForm("sshUser", value)}
                  />
                  <TextField
                    label={language.t("database.connections.form.ssh.password")}
                    type="password"
                    value={form.sshPassword}
                    onChange={(value) => setForm("sshPassword", value)}
                  />
                </div>
                <TextField
                  label={language.t("database.connections.form.ssh.keyPath")}
                  value={form.sshKeyPath}
                  onChange={(value) => setForm("sshKeyPath", value)}
                  placeholder="C:\Users\me\.ssh\id_rsa"
                />
                <TextField
                  label={language.t("database.connections.form.ssh.key")}
                  multiline
                  value={form.sshKey}
                  onChange={(value) => setForm("sshKey", value)}
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                />
                <TextField
                  label={language.t("database.connections.form.ssh.passphrase")}
                  type="password"
                  value={form.sshPassphrase}
                  onChange={(value) => setForm("sshPassphrase", value)}
                />
              </Show>
            </div>
          </Show>

          <div class="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={
                saving() || !form.name.trim() || (form.sshEnabled && (!form.sshHost.trim() || !form.sshUser.trim()))
              }
            >
              {language.t("database.connections.form.save")}
            </Button>
          </div>
        </form>
      </Dialog>
    ))
  }

  const removeConnection = async (connectionName: string) => {
    const target = connectionByName(connectionName)
    if (!target) return
    try {
      await client().database.removeConnection({ directory: directory(), connectionID: target.id })
      showToast({ title: language.t("database.connections.disconnected") })
      void loadConnections()
    } catch (error) {
      showToast({ title: language.t("database.connections.disconnectFailed"), description: messageOf(error) })
    }
  }

  /**
   * 列出连接下的「数据库」。
   *
   * - SQLite / rqlite：单库 `main`
   * - Redis：16 个逻辑库（切换后查询会自动 SELECT 对应序号）
   * - MySQL 系：information_schema
   * - PostgreSQL：pg_database
   * - ClickHouse：system.databases
   * - MongoDB：show dbs
   */
  const loadDatabases = async (connectionName: string) => {
    const connection = connectionByName(connectionName)
    if (!connection) return
    const key = treeKey(["databases", connectionName])
    setLoadingNodes(key, true)
    try {
      if (connection.type === "sqlite" || connection.type === "rqlite") {
        setDatabases(connectionName, ["main"])
        return
      }
      if (connection.type === "redis") {
        setDatabases(
          connectionName,
          Array.from({ length: 16 }, (_, index) => String(index)),
        )
        return
      }
      const sql =
        connection.type === "mongodb"
          ? "show dbs"
          : connection.type === "clickhouse"
            ? "select name from system.databases order by name"
            : connection.type === "postgres"
              ? "select datname as name from pg_database where datistemplate = false order by datname"
              : MYSQL_TYPES.has(connection.type)
                ? "select schema_name as name from information_schema.schemata order by schema_name"
                : "select datname as name from pg_database where datistemplate = false order by datname"
      const result = await client().database.query({
        directory: directory(),
        connectionID: connection.id,
        sql,
        limit: 500,
      })
      const rows = (result.data?.rows ?? []) as unknown[][]
      setDatabases(connectionName, rows.map((row) => String(row[0] ?? "")).filter(Boolean))
    } catch (error) {
      showToast({ title: language.t("database.databases.loadFailed"), description: messageOf(error) })
    } finally {
      setLoadingNodes(key, false)
    }
  }

  const loadTables = async (connectionName: string, database: string) => {
    const cacheKey = treeKey(["tables", connectionName, database])
    const connection = connectionByName(connectionName)
    if (!connection) return
    setLoadingNodes(cacheKey, true)
    try {
      const result = await client().database.tables({
        directory: directory(),
        connectionID: connection.id,
        database: targetDatabase(connection.type, database),
      })
      setTables(
        cacheKey,
        (result.data ?? []).map((table) => table.name),
      )
    } catch (error) {
      showToast({ title: language.t("database.tables.loadFailed"), description: messageOf(error) })
    } finally {
      setLoadingNodes(cacheKey, false)
    }
  }

  const loadColumns = async (connectionName: string, database: string, table: string) => {
    const cacheKey = treeKey(["columns", connectionName, database, table])
    if (columns[cacheKey]) return
    const connection = connectionByName(connectionName)
    if (!connection) return
    setLoadingNodes(cacheKey, true)
    try {
      const result = await client().database.columns({
        directory: directory(),
        connectionID: connection.id,
        table,
        database: targetDatabase(connection.type, database),
      })
      setColumns(cacheKey, (result.data ?? []) as ColumnInfo[])
    } catch (error) {
      showToast({ title: language.t("database.columns.loadFailed"), description: messageOf(error) })
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
    const connection = connectionByName(connectionName)
    if (!connection) return
    setRunning(true)
    setResult(undefined)
    try {
      const response = await client().database.query({
        directory: directory(),
        connectionID: connection.id,
        sql: defaultQueryFor(connection.type, table),
        database: targetDatabase(connection.type, database),
        limit: PAGE_SIZE,
        offset: 0,
      })
      setResult(response.data ?? undefined)
    } catch (error) {
      showToast({ title: language.t("database.query.failed"), description: messageOf(error) })
    } finally {
      setRunning(false)
    }
  }

  const insertTableQuery = (table: string) => {
    const selected = selectedTable()
    if (!selected) return
    const connection = connectionByName(selected.connection)
    if (!connection) return
    setQuery(defaultQueryFor(connection.type, table))
  }

  /**
   * 执行 SQL。
   *
   * 查询框是直连执行：之前 DELETE / DROP 点一下就发出去了。
   * 现在写操作（INSERT / UPDATE / CREATE…）先确认一次，
   * 破坏性操作（DELETE / DROP / TRUNCATE / ALTER…）用红色确认并写明风险。
   */
  const runQuery = async (confirmed = false) => {
    const q = query().trim()
    if (!q) {
      showToast({ title: language.t("database.query.empty") })
      return
    }
    const risk = sqlRisk(q)
    if (!confirmed && risk !== "safe") {
      const destructive = risk === "destructive"
      const statements = sqlStatementCount(q)
      dialog.show(() => (
        <ConfirmDialog
          open
          variant={destructive ? "danger" : "normal"}
          title={language.t(destructive ? "database.query.danger.title" : "database.query.write.title")}
          description={
            <>
              <span class="block">
                {language.t(destructive ? "database.query.danger.description" : "database.query.write.description", {
                  keyword: sqlRiskKeyword(q) ?? "",
                })}
              </span>
              <Show when={statements > 1}>
                <span class="mt-2 block">{language.t("database.query.multiWarning", { count: statements })}</span>
              </Show>
            </>
          }
          confirmText={language.t(destructive ? "database.query.danger.confirm" : "common.confirm")}
          onConfirm={() => void runQuery(true)}
          onClose={() => dialog.close()}
        />
      ))
      return
    }

    const target = selectedTable()?.connection ?? connections()[0]?.name
    const connection = target ? connectionByName(target) : undefined
    if (!connection) {
      showToast({ title: language.t("database.query.noConnection") })
      return
    }
    setRunning(true)
    setResult(undefined)
    setPageOffset(0)
    try {
      // 每一页都带 offset：结果被截断时 UI 可以"加载更多"。
      const [limit, offset] = [PAGE_SIZE, pageOffset()]
      const database = selectedTable()?.database
      const response = await client().database.query({
        directory: directory(),
        connectionID: connection.id,
        sql: q,
        database: database ? targetDatabase(connection.type, database) : undefined,
        limit,
        offset,
      })
      setResult(response.data ?? undefined)
    } catch (error) {
      showToast({ title: language.t("database.query.failed"), description: messageOf(error) })
    } finally {
      setRunning(false)
    }
  }

  /** 翻页：把上次查询的 offset 往前推一页。 */
  const [pageOffset, setPageOffset] = createSignal(0)
  const loadMore = async () => {
    const current = result()
    if (!current) return
    const target = selectedTable()?.connection ?? connections()[0]?.name
    const connection = target ? connectionByName(target) : undefined
    if (!connection) return
    setRunning(true)
    try {
      const next = pageOffset() + PAGE_SIZE
      const database = selectedTable()?.database
      const response = await client().database.query({
        directory: directory(),
        connectionID: connection.id,
        sql: current.sql,
        database: database ? targetDatabase(connection.type, database) : undefined,
        limit: PAGE_SIZE,
        offset: next,
      })
      const data = response.data
      if (data) {
        setPageOffset(next)
        setResult({
          ...data,
          // 追加而不是替换：用户在看连续结果。
          rows: [...(current.rows as unknown[][]), ...(data.rows as unknown[][])] as never,
          rowCount: Number(current.rowCount) + Number(data.rowCount),
        })
      }
    } catch (error) {
      showToast({ title: language.t("database.query.failed"), description: messageOf(error) })
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
    <div class="flex flex-col h-full bg-background">
      {/* 顶行同时是窗口拖拽区。页面动作（刷新）跟在标题后面**靠左**放：
          右上角 108px 是覆盖层补的窗控条，右侧放按钮会被压在下面点不到。 */}
      <div class="flex items-center justify-between border-b border-border px-4 py-3 pr-[108px]" data-window-drag>
        <div class="flex items-center gap-3">
          <Button variant="ghost" size="small" icon="arrow-left" onClick={props.onBack}>
            {language.t("common.goBack")}
          </Button>
          <span
            class="grid size-8 shrink-0 place-items-center rounded-lg"
            style={{ color: "#2563eb", background: "color-mix(in srgb, #3b82f6 16%, transparent)" }}
          >
            <Icon name="database" size="normal" />
          </span>
          <div class="flex flex-col">
            <h1 class="text-16-semibold text-foreground">{language.t("database.title")}</h1>
            <span class="text-11-regular text-foreground-subtle">{language.t("database.subtitle")}</span>
          </div>
          <Button variant="ghost" size="small" icon="refresh" onClick={refreshAll}>
            {language.t("common.refresh")}
          </Button>
        </div>
      </div>

      <div class="flex-1 min-h-0 flex">
        <div class="w-72 flex flex-col border-r border-border">
          <div class="flex items-center gap-2 border-b border-border px-3 py-2.5">
            <Icon name="server" size="small" class="text-foreground-subtle" />
            <span class="text-12-semibold text-foreground-subtle uppercase tracking-wide">
              {language.t("database.connections.title")}
            </span>
            <div class="flex-1" />
            <IconButton
              icon="plus-small"
              size="small"
              variant="ghost"
              aria-label={language.t("database.connections.add")}
              onClick={addConnection}
            />
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
                  <div class="text-13-medium text-foreground-subtle p-2">
                    {language.t("database.connections.empty")}
                  </div>
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
                            class="text-left flex-1 rounded-md px-2 py-1.5 text-13-medium text-foreground hover:bg-hover transition-colors flex items-center gap-2"
                            onClick={() => toggleConnection(connection.name)}
                          >
                            <Icon size="small" name={expanded() ? "chevron-down" : "chevron-right"} />
                            <Icon size="small" name="server" class="text-foreground-subtle" />
                            <span class="flex-1 truncate">{connection.name}</span>
                            <span class="text-11-regular text-foreground-subtle shrink-0">
                              {connection.type}
                              {connection.sshEnabled ? " · SSH" : ""}
                            </span>
                            <Show when={dbLoading()}>
                              <Spinner class="size-3.5" />
                            </Show>
                          </button>
                          <Show when={totalCount() > 0}>
                            <span class="text-12-medium text-foreground-subtle px-1">
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
                              <div class="text-12-semibold text-foreground-subtle px-1 pb-1.5 mb-1 border-b border-border">
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
              <div class="flex-1 flex items-center justify-center text-13-medium text-foreground-subtle">
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
                        ? "bg-surface text-foreground"
                        : "text-foreground-subtle hover:bg-hover hover:text-foreground"
                    }`}
                    onClick={() => setActiveTab("data")}
                  >
                    {language.t("database.tab.data")}
                  </button>
                  <button
                    type="button"
                    class={`px-3 py-1.5 text-13-medium rounded-md transition-colors ${
                      activeTab() === "structure"
                        ? "bg-surface text-foreground"
                        : "text-foreground-subtle hover:bg-hover hover:text-foreground"
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
                        <div class="flex h-full items-center justify-center text-13-medium text-foreground-subtle">
                          {running() ? language.t("common.loading") : language.t("database.result.empty")}
                        </div>
                      }
                    >
                      <QueryResultTable result={result()!} loading={running()} onLoadMore={loadMore} />
                    </Show>
                  </Show>
                  <Show when={activeTab() === "structure"}>
                    <TableStructure
                      connection={selected().connection}
                      database={selected().database}
                      table={selected().table}
                      columns={selectedColumns}
                      onRun={() => {
                        const type = connectionByName(selected().connection)?.type ?? "postgres"
                        setQuery(defaultQueryFor(type, selected().table))
                        void runQuery()
                      }}
                    />
                  </Show>
                </div>
              </>
            )}
          </Show>

          <div class="h-48 flex flex-col border-t border-border">
            <div class="px-3 py-2 text-12-semibold text-foreground-subtle uppercase tracking-wide border-b border-border">
              {language.t("database.query.label")}
            </div>
            <div class="flex-1 min-h-0 p-3 flex gap-3">
              <TextField
                class="flex-1 min-h-0"
                inputClass="size-full resize-none font-mono text-13-regular bg-surface rounded-md border border-border px-3 py-2 focus:outline-none focus:ring-1 focus:ring-border-hover"
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
            <div class="h-1/2 min-h-0 border-t border-border p-3 overflow-auto">
              <Show
                when={result()}
                fallback={
                  <div class="text-13-medium text-foreground-subtle flex items-center justify-center h-full">
                    {language.t("database.result.empty")}
                  </div>
                }
              >
                <QueryResultTable result={result()!} loading={running()} onLoadMore={loadMore} />
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
              class="absolute min-w-[140px] p-1 bg-surface border border-border rounded-lg shadow-lg"
              style={{ left: `${menu().x}px`, top: `${menu().y}px` }}
            >
              <button
                type="button"
                class="w-full text-left flex items-center gap-2 px-2 py-1.5 text-12-medium text-foreground rounded-md hover:bg-hover cursor-pointer outline-none"
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
