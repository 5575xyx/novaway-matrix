// 侧栏"数据"页:数据库连接管理,功能对齐桌面端(packages/app/src/pages/database.tsx)。
// 数据源是 dbx MCP 工具(经服务端 /experimental/tool/call),面板只负责树形浏览 +
// 表数据/结构预览 + SQL 查询;连接的增删管理桌面端怎么做的这里就怎么做。
import { createSignal, For, Show } from "solid-js"
import { TextAttributes, type TextareaRenderable } from "@opentui/core"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { DialogConfirm } from "../ui/dialog-confirm"
import { DialogPrompt } from "../ui/dialog-prompt"
import { DialogSelect } from "../ui/dialog-select"
import { useToast } from "../ui/toast"
import { useAutoRefresh } from "../util/auto-refresh"
import { Locale } from "../util/locale"
import {
  dbxAddConnection,
  dbxDescribeTable,
  dbxExecuteQuery,
  dbxListConnections,
  dbxListDatabases,
  dbxListTables,
  dbxRemoveConnection,
  tablePreviewSql,
  type DbColumnInfo,
  type DbConnection,
} from "../util/dbx-api"

const TREE_KEY_SEP = "\0"
const treeKey = (parts: string[]) => parts.join(TREE_KEY_SEP)

// 侧栏 44~60 列,预览行统一截到这个宽。
const PREVIEW_MAX = 34
// 数据预览最多展示的行数,免得长结果把面板撑爆。
const PREVIEW_ROW_MAX = 12
const QUERY_ROW_MAX = 20
// 每行最多取几个单元格做预览。
const PREVIEW_CELL_MAX = 4
const CELL_MAX = 10
const QUERY_MESSAGE_MAX = 200

// dbx 支持的连接类型(sqlite 没有主机/端口概念,host 填文件路径)。
const DB_TYPES: Array<{ value: string; label: string; port: string }> = [
  { value: "postgres", label: "PostgreSQL", port: "5432" },
  { value: "mysql", label: "MySQL", port: "3306" },
  { value: "sqlite", label: "SQLite", port: "" },
  { value: "redis", label: "Redis", port: "6379" },
  { value: "mariadb", label: "MariaDB", port: "3306" },
  { value: "clickhouse", label: "ClickHouse", port: "8123" },
  { value: "sqlserver", label: "SQL Server", port: "1433" },
  { value: "mongodb", label: "MongoDB", port: "27017" },
]

function previewRow(row: string[]): string {
  const cells = row
    .slice(0, PREVIEW_CELL_MAX)
    .map((cell) => Locale.oneLine(cell, CELL_MAX))
  const more = row.length > PREVIEW_CELL_MAX ? ` …${row.length - PREVIEW_CELL_MAX}列` : ""
  return Locale.oneLine(cells.join(" · ") + more, PREVIEW_MAX)
}

export function DbPanel(props: { directory?: string }) {
  const sdk = useSDK()
  const { theme } = useTheme()
  const dialog = useDialog()
  const toast = useToast()

  const [connections, setConnections] = createSignal<DbConnection[]>([])
  const [expanded, setExpanded] = createSignal(new Set<string>())
  // 树节点缓存:库列表 / 表列表 / 列信息,键 = treeKey
  const [databases, setDatabases] = createSignal<Record<string, string[]>>({})
  const [tables, setTables] = createSignal<Record<string, string[]>>({})
  const [columns, setColumns] = createSignal<Record<string, DbColumnInfo[]>>({})
  const [loadingNodes, setLoadingNodes] = createSignal<Record<string, boolean>>({})
  const [selected, setSelected] = createSignal<{ connection: string; database: string; table: string }>()
  const [view, setView] = createSignal<"data" | "structure">("data")
  const [query, setQuery] = createSignal("")
  const [result, setResult] = createSignal<string>("")
  const [running, setRunning] = createSignal(false)
  const [queryInput, setQueryInput] = createSignal<TextareaRenderable>()
  const [error, setError] = createSignal("")
  const [loading, setLoading] = createSignal(true)

  const dir = () => props.directory ?? ""

  const guard = () => {
    if (!props.directory) {
      toast.show({ variant: "warning", message: "先进入一个会话再使用数据库面板" })
      return false
    }
    return true
  }

  const loadConnections = async () => {
    if (!props.directory) return
    setLoading(true)
    try {
      setConnections(await dbxListConnections(sdk.client, dir()))
      setError("")
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useAutoRefresh(loadConnections)

  const loadDatabases = async (connection: DbConnection) => {
    const key = treeKey(["databases", connection.name])
    setLoadingNodes((prev) => ({ ...prev, [key]: true }))
    try {
      const list = await dbxListDatabases(sdk.client, dir(), connection)
      setDatabases((prev) => ({ ...prev, [key]: list }))
    } catch (e) {
      toast.show({ variant: "error", message: e instanceof Error ? e.message : String(e) })
    } finally {
      setLoadingNodes((prev) => ({ ...prev, [key]: false }))
    }
  }

  const loadTables = async (connectionName: string, database: string) => {
    const key = treeKey(["tables", connectionName, database])
    setLoadingNodes((prev) => ({ ...prev, [key]: true }))
    try {
      const list = await dbxListTables(sdk.client, dir(), connectionName, database)
      setTables((prev) => ({ ...prev, [key]: list }))
    } catch (e) {
      toast.show({ variant: "error", message: e instanceof Error ? e.message : String(e) })
    } finally {
      setLoadingNodes((prev) => ({ ...prev, [key]: false }))
    }
  }

  const loadColumns = async (connectionName: string, database: string, table: string) => {
    const key = treeKey(["columns", connectionName, database, table])
    if (columns()[key]) return
    setLoadingNodes((prev) => ({ ...prev, [key]: true }))
    try {
      const list = await dbxDescribeTable(sdk.client, dir(), connectionName, database, table)
      setColumns((prev) => ({ ...prev, [key]: list }))
    } catch (e) {
      toast.show({ variant: "error", message: e instanceof Error ? e.message : String(e) })
    } finally {
      setLoadingNodes((prev) => ({ ...prev, [key]: false }))
    }
  }

  const toggle = async (key: string, load: () => Promise<void>) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
    if (!expanded().has(key)) return
    await load()
  }

  const selectTable = async (connection: string, database: string, table: string) => {
    setSelected({ connection, database, table })
    setView("data")
    void loadColumns(connection, database, table)
    await runQuerySql(tablePreviewSql(table), connection, database)
  }

  const runQuerySql = async (sql: string, connectionName?: string, database?: string) => {
    setRunning(true)
    setResult("")
    try {
      setResult(await dbxExecuteQuery(sdk.client, dir(), connectionName, database, sql))
    } catch (e) {
      toast.show({ variant: "error", message: e instanceof Error ? e.message : String(e) })
    } finally {
      setRunning(false)
    }
  }

  const runQuery = async () => {
    const q = query().trim()
    if (!q) {
      toast.show({ variant: "warning", message: "先输入 SQL" })
      return
    }
    if (!guard()) return
    const target = selected()
    await runQuerySql(q, target?.connection, target?.database)
  }

  const removeConnection = async (connectionName: string) => {
    const confirmed = await DialogConfirm.show(dialog, "断开连接", `将移除连接 ${connectionName}，确定?`)
    if (!confirmed) return
    try {
      await dbxRemoveConnection(sdk.client, dir(), connectionName)
      toast.show({ variant: "success", message: "已断开连接" })
      await loadConnections()
    } catch (e) {
      toast.show({ variant: "error", message: e instanceof Error ? e.message : String(e) })
    }
  }

  // 添加连接:类型选择 → 名称/主机/端口/账号分步弹窗,最后交给 dbx_add_connection。
  // 可选字段留空就不传。
  // 注意关闭时序:弹窗的 onClose(esc/遮罩/显式 clear)都会触发,而 clear() 会先调
  // onClose —— 所以"选中值"必须先记在局部变量里,onClose 读它结算;
  // 在 onSelect 里先写 picked 再 clear(),顺序就对了(否则 clear 的 onClose 会把
  // 结果抢跑成 null,选完类型就"没有下一步")。
  const addConnection = async () => {
    if (!guard()) return
    let pickedType: string | undefined
    const type = await new Promise<string | null>((resolve) => {
      dialog.replace(
        () => (
          <DialogSelect
            title="数据库类型"
            skipFilter={true}
            renderFilter={false}
            options={DB_TYPES.map((item) => ({
              title: item.label,
              value: item.value,
              onSelect: (d: { clear: () => void }) => {
                pickedType = item.value
                d.clear()
              },
            }))}
          />
        ),
        () => resolve(pickedType ?? null),
      )
    })
    if (!type) return
    const meta = DB_TYPES.find((item) => item.value === type)!
    const isSqlite = type === "sqlite"

    const abort = () => dialog.clear()
    const name = await DialogPrompt.show(dialog, "连接名称", { placeholder: "如 prod-db" })
    if (!name?.trim()) return abort()
    const host = await DialogPrompt.show(dialog, isSqlite ? "数据库文件路径" : "主机地址", {
      placeholder: isSqlite ? "C:/data/db.sqlite" : "db.example.com",
    })
    if (!host?.trim()) return abort()

    let port = 0
    if (meta.port) {
      const entered = await DialogPrompt.show(dialog, "端口", { value: meta.port })
      if (!entered?.trim()) return abort()
      port = Number(entered.trim())
      if (!Number.isFinite(port) || port <= 0) {
        toast.show({ variant: "warning", message: "端口得是个正整数" })
        return abort()
      }
    }

    const username = await DialogPrompt.show(dialog, "用户名（可留空）", {})
    if (username === null) return abort()
    const password = await DialogPrompt.show(dialog, "密码（可留空）", {})
    if (password === null) return abort()
    const database = await DialogPrompt.show(dialog, "默认数据库（可留空）", {})
    if (database === null) return abort()
    dialog.clear()

    try {
      await dbxAddConnection(sdk.client, dir(), {
        name: name.trim(),
        db_type: type,
        host: host.trim(),
        ...(port > 0 ? { port } : {}),
        ...(username?.trim() ? { username: username.trim() } : {}),
        ...(password ? { password } : {}),
        ...(database?.trim() ? { database: database.trim() } : {}),
      })
      toast.show({ variant: "success", message: `已添加连接 ${name.trim()}` })
      await loadConnections()
    } catch (e) {
      toast.show({ variant: "error", message: e instanceof Error ? e.message : String(e) })
    }
  }

  // ---- 渲染 ----

  const Toggle = (p: { open: boolean; label: string; onToggle: () => void; fg?: string }) => (
    <text wrapMode="none" onMouseUp={p.onToggle}>
      <span style={{ fg: theme.textMuted }}>{p.open ? "▼ " : "▶ "}</span>
      <span style={{ fg: p.fg ?? theme.text }}>{p.label}</span>
    </text>
  )

  const selectedColumns = () => {
    const target = selected()
    if (!target) return []
    return columns()[treeKey(["columns", target.connection, target.database, target.table])] ?? []
  }

  // 查询结果:markdown 表格压成侧栏放得下的多行预览
  const ResultPreview = (p: { text: string; rowMax: number }) => {
    const lines = p.text.split("\n").filter((line) => line.trim() !== "")
    if (lines.length === 0 || !lines.some((line) => line.includes("|"))) {
      return <text fg={theme.textMuted}>{Locale.oneLine(p.text, PREVIEW_MAX) || "空结果"}</text>
    }
    // 表头 + 分隔行之后的数据行,每行压成 "单元格 · 单元格" 预览
    const separatorIndex = lines.findIndex((line) => /^\s*\|(\s*[-:]+\s*\|)+$/.test(line))
    const headerLine = lines.find((line) => line.includes("|"))!
    const headers = headerLine.split("|").slice(1, -1).map((cell) => cell.trim())
    const dataLines = separatorIndex === -1 ? lines.slice(1) : lines.slice(separatorIndex + 1)
    const rows = dataLines
      .filter((line) => line.includes("|"))
      .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()))
    const shown = rows.slice(0, p.rowMax)
    return (
      <box flexDirection="column">
        <text fg={theme.text} wrapMode="none" attributes={TextAttributes.BOLD}>
          {previewRow(headers)}
        </text>
        <For each={shown}>{(row) => <text fg={theme.textMuted} wrapMode="none">{previewRow(row)}</text>}</For>
        <Show when={rows.length > shown.length}>
          <text fg={theme.textMuted}>… 还有 {rows.length - shown.length} 行</text>
        </Show>
      </box>
    )
  }

  return (
    <box flexDirection="column" gap={1}>
      <Show when={!error()} fallback={<text fg={theme.textMuted}>{error()}</text>}>
        {/* 连接树:连接 → 库 → 表;连接行悬停可断开;标题行带添加入口 */}
        <box flexDirection="row">
          <text fg={theme.text}>连接 ({connections().length})</text>
          <text fg={theme.primary} onMouseUp={() => void addConnection()}>
            {"  + 添加连接"}
          </text>
        </box>
        <Show when={!loading()} fallback={<text fg={theme.textMuted}>读取连接中...</text>}>
          <Show when={connections().length > 0} fallback={<text fg={theme.textMuted}>暂无连接,点上方"+ 添加连接"</text>}>
            <For each={connections()}>
              {(connection) => {
                const dbKey = treeKey(["databases", connection.name])
                const dbList = () => databases()[dbKey] ?? []
                const isOpen = () => expanded().has(connection.name)
                return (
                  <box flexDirection="column" paddingLeft={1}>
                    <box flexDirection="row">
                      <box flexGrow={1}>
                        <Toggle
                          open={isOpen()}
                          label={`${connection.name} (${connection.type})`}
                          onToggle={() => void toggle(connection.name, () => loadDatabases(connection))}
                        />
                      </box>
                      <ConnectionDelete onDelete={() => void removeConnection(connection.name)} />
                    </box>
                    <Show when={isOpen()}>
                      <box flexDirection="column" paddingLeft={1}>
                        <Show when={!loadingNodes()[dbKey]} fallback={<text fg={theme.textMuted}>读取库列表...</text>}>
                          <Show when={dbList().length > 0} fallback={<text fg={theme.textMuted}>暂无库</text>}>
                            <For each={dbList()}>
                              {(database) => {
                                const tableKey = treeKey(["tables", connection.name, database])
                                const tableList = () => tables()[tableKey] ?? []
                                const dbOpen = () => expanded().has(treeKey(["db", connection.name, database]))
                                return (
                                  <box flexDirection="column" paddingLeft={1}>
                                    <Toggle
                                      open={dbOpen()}
                                      label={database}
                                      onToggle={() =>
                                        void toggle(treeKey(["db", connection.name, database]), () =>
                                          loadTables(connection.name, database),
                                        )
                                      }
                                    />
                                    <Show when={dbOpen()}>
                                      <box flexDirection="column" paddingLeft={1}>
                                        <Show
                                          when={!loadingNodes()[tableKey]}
                                          fallback={<text fg={theme.textMuted}>读取表列表...</text>}
                                        >
                                          <Show when={tableList().length > 0} fallback={<text fg={theme.textMuted}>暂无表</text>}>
                                            <For each={tableList()}>
                                              {(table) => {
                                                const active = () =>
                                                  selected()?.connection === connection.name &&
                                                  selected()?.database === database &&
                                                  selected()?.table === table
                                                return (
                                                  <text
                                                    wrapMode="none"
                                                    fg={active() ? theme.primary : theme.textMuted}
                                                    onMouseUp={() =>
                                                      void selectTable(connection.name, database, table)
                                                    }
                                                  >
                                                    {active() ? "▪ " : "· "}
                                                    {Locale.oneLine(table, PREVIEW_MAX - 2)}
                                                  </text>
                                                )
                                              }}
                                            </For>
                                          </Show>
                                        </Show>
                                      </box>
                                    </Show>
                                  </box>
                                )
                              }}
                            </For>
                          </Show>
                        </Show>
                      </box>
                    </Show>
                  </box>
                )
              }}
            </For>
          </Show>
        </Show>

        {/* 选中表:数据 | 结构 切换 */}
        <Show when={selected()}>
          {(target) => (
            <box flexDirection="column" gap={1}>
              <box flexDirection="row" gap={2}>
                <text
                  fg={view() === "data" ? theme.primary : theme.textMuted}
                  onMouseUp={() => setView("data")}
                >
                  数据
                </text>
                <text
                  fg={view() === "structure" ? theme.primary : theme.textMuted}
                  onMouseUp={() => setView("structure")}
                >
                  结构
                </text>
                <text fg={theme.textMuted} wrapMode="none">
                  {Locale.oneLine(target().table, PREVIEW_MAX - 8)}
                </text>
              </box>
              <Show
                when={view() === "data"}
                fallback={
                  <box flexDirection="column">
                    <Show
                      when={selectedColumns().length > 0}
                      fallback={
                        <text fg={theme.textMuted}>
                          {loadingNodes()[
                            treeKey(["columns", target().connection, target().database, target().table])
                          ]
                            ? "读取列信息..."
                            : "暂无列信息"}
                        </text>
                      }
                    >
                      <For each={selectedColumns()}>
                        {(column) => (
                          <text fg={theme.textMuted} wrapMode="none">
                            <span style={{ fg: theme.text }}>{Locale.oneLine(column.name, 14)}</span>{" "}
                            <span style={{ fg: theme.textMuted }}>{Locale.oneLine(column.type, 8)}</span>
                            {column.nullable.toLowerCase().includes("no")
                              ? ""
                              : ` ${Locale.oneLine(column.default, 8)}`.trimEnd()}
                          </text>
                        )}
                      </For>
                    </Show>
                  </box>
                }
              >
                <Show when={result()} fallback={<text fg={theme.textMuted}>{running() ? "查询中..." : "空结果"}</text>}>
                  <ResultPreview text={result()} rowMax={PREVIEW_ROW_MAX} />
                </Show>
              </Show>
            </box>
          )}
        </Show>

        {/* SQL 查询:输入框 + 运行 + 结果预览 */}
        <box flexDirection="column" gap={1}>
          <text fg={theme.text}>SQL {selected() ? "（对选中表的库执行）" : "（先选一个表）"}</text>
          <textarea
            height={3}
            ref={(val: TextareaRenderable) => setQueryInput(val)}
            initialValue=""
            onContentChange={() => {
              const input = queryInput()
              if (input) setQuery(input.plainText)
            }}
            onMouseUp={() => queryInput()?.focus()}
            placeholder="点击这里输入 SQL，如 SELECT * FROM 表名 LIMIT 10"
            placeholderColor={theme.textMuted}
            backgroundColor={theme.backgroundElement}
            textColor={theme.text}
            focusedTextColor={theme.text}
            wrapMode="none"
          />
          <box
            height={1}
            justifyContent="center"
            backgroundColor={theme.backgroundMenu}
            onMouseUp={() => void runQuery()}
          >
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
              {running() ? "运行中..." : "▶ 运行查询"}
            </text>
          </box>
          <Show when={result()}>
            <ResultPreview text={result()} rowMax={QUERY_ROW_MAX} />
          </Show>
        </box>
      </Show>
    </box>
  )
}

// 连接行的"删"按钮,抽成小组件以持有自己的 hover 状态(和 Git 页同一招:
// 平时用背景色渲染,占位恒定不抖动,悬停才显红)。
function ConnectionDelete(props: { onDelete: () => void }) {
  const { theme } = useTheme()
  const [hover, setHover] = createSignal(false)
  return (
    <text
      flexShrink={0}
      fg={hover() ? theme.error : theme.backgroundPanel}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={props.onDelete}
    >
      {" 断开"}
    </text>
  )
}
