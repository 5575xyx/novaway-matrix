import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { execSync } from "child_process"
import path from "path"
import { AppProcess } from "@opencode-ai/core/process"
import { ChildProcess } from "effect/unstable/process"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { WorkspaceRouteContext } from "../middleware/workspace-routing"
import { DatabaseColumnsPayload, DatabaseColumnsResult, DatabaseConnectionsResult, DatabaseExecutePayload, DatabaseExecuteResult, DatabaseListResult, DatabaseQueryPayload, DatabaseQueryResult, DatabaseSaveConnectionsPayload, DatabaseTablesPayload, DatabaseTablesResult, DatabaseTestPayload, DatabaseTestResult } from "../groups/database"

const ANSI_RE = /\x1B\[[0-9;]*[a-zA-Z]/g

function cleanOutput(buf: Buffer): string {
  return buf.toString("utf8").replace(ANSI_RE, "").trim()
}

const COMMON_PATHS: Record<string, string[]> = {
  mysql: [
    "C:\\Program Files\\MySQL\\MySQL Server 8.4\\bin\\mysql.exe",
    "C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysql.exe",
    "C:\\Program Files\\MySQL\\MySQL Server 5.7\\bin\\mysql.exe",
    "C:\\Program Files\\MariaDB 11.4\\bin\\mysql.exe",
    "C:\\Program Files\\MariaDB 10.11\\bin\\mysql.exe",
    "C:\\Program Files\\MariaDB 10.6\\bin\\mysql.exe",
    "C:\\Program Files\\MariaDB 10.5\\bin\\mysql.exe",
    "/usr/bin/mysql",
    "/usr/local/bin/mysql",
    "/opt/homebrew/bin/mysql",
  ],
  psql: [
    "C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe",
    "C:\\Program Files\\PostgreSQL\\16\\bin\\psql.exe",
    "C:\\Program Files\\PostgreSQL\\15\\bin\\psql.exe",
    "C:\\Program Files\\PostgreSQL\\14\\bin\\psql.exe",
    "/usr/bin/psql",
    "/usr/local/bin/psql",
    "/opt/homebrew/bin/psql",
  ],
  sqlite3: [
    "C:\\Program Files\\SQLite\\sqlite3.exe",
    "/usr/bin/sqlite3",
    "/usr/local/bin/sqlite3",
    "/opt/homebrew/bin/sqlite3",
  ],
  sqlcmd: [
    "C:\\Program Files\\Microsoft SQL Server\\Client SDK\\ODBC\\170\\Tools\\Binn\\sqlcmd.exe",
    "C:\\Program Files\\Microsoft SQL Server\\160\\Tools\\Binn\\sqlcmd.exe",
    "C:\\Program Files\\Microsoft SQL Server\\150\\Tools\\Binn\\sqlcmd.exe",
    "/opt/mssql-tools/bin/sqlcmd",
  ],
}

function findCommand(name: string): string | null {
  try {
    const result = execSync(`where ${name}`, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] })
    const firstLine = result.split("\n")[0].trim()
    if (firstLine && existsSync(firstLine)) return firstLine
  } catch {}

  const paths = COMMON_PATHS[name]
  if (paths) {
    for (const p of paths) {
      if (existsSync(p)) return p
    }
  }

  return null
}

function buildTestCommand(payload: typeof DatabaseTestPayload.Type): ChildProcess.StandardCommand | null {
  const { type, host, port, user, password, database } = payload
  switch (type) {
    case "sqlite": {
      const bin = findCommand("sqlite3")
      if (!bin) return null
      return ChildProcess.make(bin, [database, "SELECT 1"], { stdin: "ignore" })
    }
    case "mysql":
    case "mariadb": {
      const bin = findCommand("mysql")
      if (!bin) return null
      return ChildProcess.make(
        bin,
        [`--default-character-set=utf8`, `-h${host}`, `-P${String(port)}`, `-u${user}`, `-p${password}`, database, `-sN`, `-e`, "SELECT 1"],
        { stdin: "ignore" },
      )
    }
    case "postgresql": {
      const bin = findCommand("psql")
      if (!bin) return null
      return ChildProcess.make(bin, [`-h${host}`, `-p${String(port)}`, `-U${user}`, `-d${database}`, `-c`, "SELECT 1"], {
        stdin: "ignore",
      })
    }
    case "sqlserver": {
      const bin = findCommand("sqlcmd")
      if (!bin) return null
      return ChildProcess.make(bin, [`-S`, `${host},${port}`, `-U`, user, `-P`, password, `-d`, database, `-Q`, "SELECT 1"], {
        stdin: "ignore",
      })
    }
    default:
      return null
  }
}

function buildListCommand(payload: typeof DatabaseTestPayload.Type): ChildProcess.StandardCommand | null {
  const { type, host, port, user, password, database } = payload
  switch (type) {
    case "sqlite":
      return null
    case "mysql":
    case "mariadb": {
      const bin = findCommand("mysql")
      if (!bin) return null
      return ChildProcess.make(bin, [`--default-character-set=utf8`, `-h${host}`, `-P${String(port)}`, `-u${user}`, `-p${password}`, `-sN`, `-e`, "SHOW DATABASES"], {
        stdin: "ignore",
      })
    }
    case "postgresql": {
      const bin = findCommand("psql")
      if (!bin) return null
      return ChildProcess.make(
        bin,
        [`-h${host}`, `-p${String(port)}`, `-U${user}`, `-d${database}`, `-t`, `-A`, `-c`, "SELECT datname FROM pg_database WHERE NOT datistemplate ORDER BY datname"],
        { stdin: "ignore" },
      )
    }
    case "sqlserver": {
      const bin = findCommand("sqlcmd")
      if (!bin) return null
      return ChildProcess.make(
        bin,
        [`-S`, `${host},${port}`, `-U`, user, `-P`, password, `-Q`, "SELECT name FROM sys.databases WHERE name NOT IN ('master','tempdb','model','msdb')"],
        { stdin: "ignore" },
      )
    }
    default:
      return null
  }
}

const NOT_FOUND_MESSAGES: Record<string, string> = {
  mysql: "未找到 mysql 客户端，请将其加入 PATH 或确认 MySQL 安装路径",
  mariadb: "未找到 mariadb 客户端，请将其加入 PATH 或确认 MariaDB 安装路径",
  psql: "未找到 psql 客户端，请将其加入 PATH 或确认 PostgreSQL 安装路径",
  sqlite3: "未找到 sqlite3 客户端，请将其加入 PATH 或确认 SQLite 安装路径",
  sqlcmd: "未找到 sqlcmd 客户端，请将其加入 PATH 或确认 SQL Server 安装路径",
}

const CMD_NAME: Record<string, string> = {
  mysql: "mysql",
  mariadb: "mysql",
  psql: "psql",
  sqlite: "sqlite3",
  sqlserver: "sqlcmd",
}

function getNotFoundMessage(type: string): string {
  return NOT_FOUND_MESSAGES[CMD_NAME[type] ?? type] || `未找到 ${type} 客户端`
}

function buildExecuteCommand(payload: typeof DatabaseExecutePayload.Type): ChildProcess.StandardCommand | null {
  const { type, host, port, user, password, database, sql } = payload
  switch (type) {
    case "sqlite": {
      const bin = findCommand("sqlite3")
      if (!bin) return null
      return ChildProcess.make(bin, [database, sql], { stdin: "ignore" })
    }
    case "mysql":
    case "mariadb": {
      const bin = findCommand("mysql")
      if (!bin) return null
      return ChildProcess.make(
        bin,
        [`--default-character-set=utf8`, `-h${host}`, `-P${String(port)}`, `-u${user}`, `-p${password}`, database, `-sN`, `-e`, sql],
        { stdin: "ignore" },
      )
    }
    case "postgresql": {
      const bin = findCommand("psql")
      if (!bin) return null
      return ChildProcess.make(
        bin,
        [`-h${host}`, `-p${String(port)}`, `-U${user}`, `-d${database}`, `-t`, `-A`, `-F`, "\\t", `-c`, sql],
        { stdin: "ignore" },
      )
    }
    case "sqlserver": {
      const bin = findCommand("sqlcmd")
      if (!bin) return null
      return ChildProcess.make(
        bin,
        [`-S`, `${host},${port}`, `-U`, user, `-P`, password, `-d`, database, `-Q`, sql, `-s`, "\\t", `-W`],
        { stdin: "ignore" },
      )
    }
    default:
      return null
  }
}

function parseMysqlOutput(stdout: string): { columns: string[]; rows: Record<string, unknown>[] } {
  const lines = stdout.split("\n").filter((l) => l.trim())
  if (lines.length === 0) return { columns: [], rows: [] }
  const columns = lines[0]!.split("\t").map((c) => c.trim())
  const rows: Record<string, unknown>[] = []
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i]!.split("\t")
    const row: Record<string, unknown> = {}
    for (let j = 0; j < columns.length; j++) {
      row[columns[j]!] = (values[j] ?? "").trim() || null
    }
    rows.push(row)
  }
  return { columns, rows }
}

function isSelectQuery(sql: string): boolean {
  const trimmed = sql.trim().toUpperCase()
  return trimmed.startsWith("SELECT") || trimmed.startsWith("SHOW") || trimmed.startsWith("DESCRIBE") || trimmed.startsWith("EXPLAIN")
}

export const databaseHandlers = HttpApiBuilder.group(InstanceHttpApi, "database", (handlers) =>
  Effect.gen(function* () {
    const appProcess = yield* AppProcess.Service

    const test = Effect.fn("DatabaseHttpApi.test")(function* (ctx: { payload: typeof DatabaseTestPayload.Type }) {
      const cmd = buildTestCommand(ctx.payload)
      if (!cmd) {
        return { success: false, message: getNotFoundMessage(ctx.payload.type) } satisfies typeof DatabaseTestResult.Type
      }

      const start = Date.now()
      const result = yield* appProcess
        .run(cmd, { timeout: 10000 })
        .pipe(Effect.catch(() => Effect.succeed({ exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("") })))
      const pingMs = Date.now() - start

      const stdout = cleanOutput(result.stdout)
      const stderr = cleanOutput(result.stderr)

      if (result.exitCode === 0 && stdout) {
        return {
          success: true,
          message: "连接成功",
          version: stdout,
          pingMs,
        } satisfies typeof DatabaseTestResult.Type
      }

      const errorMsg = stderr || stdout || `退出码 ${result.exitCode}`
      return {
        success: false,
        message: `连接失败：${errorMsg}`,
        pingMs,
      } satisfies typeof DatabaseTestResult.Type
    })

    const list = Effect.fn("DatabaseHttpApi.list")(function* (ctx: { payload: typeof DatabaseTestPayload.Type }) {
      const cmd = buildListCommand(ctx.payload)
      if (!cmd) {
        return { databases: [] } satisfies typeof DatabaseListResult.Type
      }

      const result = yield* appProcess
        .run(cmd, { timeout: 10000 })
        .pipe(Effect.catch(() => Effect.succeed({ exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("") })))

      const stdout = cleanOutput(result.stdout)

      if (result.exitCode === 0 && stdout) {
        const databases = stdout.split("\n").filter((line: string) => line.trim())
        return { databases } satisfies typeof DatabaseListResult.Type
      }

      return { databases: [] } satisfies typeof DatabaseListResult.Type
    })

    const execute = Effect.fn("DatabaseHttpApi.execute")(function* (ctx: { payload: typeof DatabaseExecutePayload.Type }) {
      const cmd = buildExecuteCommand(ctx.payload)
      if (!cmd) {
        return { success: false, message: getNotFoundMessage(ctx.payload.type) } satisfies typeof DatabaseExecuteResult.Type
      }

      const result = yield* appProcess
        .run(cmd, { timeout: 30000 })
        .pipe(Effect.catch(() => Effect.succeed({ exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("") })))

      const stdout = cleanOutput(result.stdout)
      const stderr = cleanOutput(result.stderr)

      if (result.exitCode !== 0) {
        const errorMsg = stderr || stdout || `退出码 ${result.exitCode}`
        return { success: false, message: `执行失败：${errorMsg}` } satisfies typeof DatabaseExecuteResult.Type
      }

      if (isSelectQuery(ctx.payload.sql)) {
        if (!stdout) {
          return { success: true, message: "查询成功，无结果" } satisfies typeof DatabaseExecuteResult.Type
        }
        const { columns, rows } = parseMysqlOutput(stdout)
        return { success: true, message: `查询成功，共 ${rows.length} 行`, columns, rows } satisfies typeof DatabaseExecuteResult.Type
      }

      const affected = stdout.match(/Affected rows:\s*(\d+)/i)
      const rowsChanged = affected ? parseInt(affected[1]!, 10) : undefined
      return {
        success: true,
        message: stdout || "执行成功",
        affectedRows: rowsChanged,
      } satisfies typeof DatabaseExecuteResult.Type
    })

    const tables = Effect.fn("DatabaseHttpApi.tables")(function* (ctx: { payload: typeof DatabaseTablesPayload.Type }) {
      const { type, host, port, user, password, database } = ctx.payload
      let sql = ""
      switch (type) {
        case "mysql":
        case "mariadb":
          sql = `SELECT table_name FROM information_schema.tables WHERE table_schema = '${database}' AND table_type = 'BASE TABLE' ORDER BY table_name`
          break
        case "postgresql":
          sql = `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
          break
        case "sqlserver":
          sql = `SELECT table_name FROM information_schema.tables WHERE table_catalog = '${database}' AND table_type = 'BASE TABLE' ORDER BY table_name`
          break
        case "sqlite":
          sql = `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`
          break
      }

      const cmd = buildExecuteCommand({ type, host, port, user, password, database, sql })
      if (!cmd) {
        return { tables: [] } satisfies typeof DatabaseTablesResult.Type
      }

      const result = yield* appProcess
        .run(cmd, { timeout: 10000 })
        .pipe(Effect.catch(() => Effect.succeed({ exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("") })))

      const stdout = cleanOutput(result.stdout)
      if (result.exitCode !== 0 || !stdout) {
        return { tables: [] } satisfies typeof DatabaseTablesResult.Type
      }

      const tables = stdout.split("\n").map((l) => l.trim()).filter(Boolean)
      return { tables } satisfies typeof DatabaseTablesResult.Type
    })

    const columns = Effect.fn("DatabaseHttpApi.columns")(function* (ctx: { payload: typeof DatabaseColumnsPayload.Type }) {
      const { type, host, port, user, password, database, table } = ctx.payload
      let sql = ""
      switch (type) {
        case "mysql":
        case "mariadb":
          sql = `SELECT column_name AS col_name, column_type AS col_type, is_nullable AS col_nullable, column_key AS col_key, column_default AS col_default, column_comment AS col_comment FROM information_schema.columns WHERE table_schema = '${database}' AND table_name = '${table}' ORDER BY ordinal_position`
          break
        case "postgresql":
          sql = `SELECT c.column_name AS col_name, c.data_type AS col_type, CASE WHEN c.is_nullable = 'YES' THEN 'true' ELSE 'false' END AS col_nullable, CASE WHEN pk.column_name IS NOT NULL THEN 'PRI' ELSE '' END AS col_key, c.column_default AS col_default, col_description((SELECT oid FROM pg_class WHERE relname = '${table}'), c.ordinal_position) AS col_comment FROM information_schema.columns c LEFT JOIN (SELECT ku.column_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name WHERE tc.table_name = '${table}' AND tc.constraint_type = 'PRIMARY KEY') pk ON c.column_name = pk.column_name WHERE c.table_name = '${table}' ORDER BY c.ordinal_position`
          break
        case "sqlserver":
          sql = `SELECT c.name AS col_name, t.name AS col_type, CASE WHEN c.is_nullable = 1 THEN 'true' ELSE 'false' END AS col_nullable, CASE WHEN pk.column_id IS NOT NULL THEN 'PRI' ELSE '' END AS col_key, dc.definition AS col_default, ep.value AS col_comment FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id LEFT JOIN sys.default_constraints dc ON c.default_object_id = dc.object_id LEFT JOIN (SELECT ic.column_id FROM sys.index_columns ic JOIN sys.indexes i ON ic.object_id = i.object_id AND ic.index_id = i.index_id WHERE i.is_primary_key = 1 AND OBJECT_NAME(i.object_id) = '${table}') pk ON c.column_id = pk.column_id LEFT JOIN sys.extended_properties ep ON ep.major_id = OBJECT_ID('${table}') AND ep.minor_id = c.column_id AND ep.name = 'MS_Description' WHERE OBJECT_NAME(c.object_id) = '${table}' ORDER BY c.column_id`
          break
        case "sqlite":
          sql = `PRAGMA table_info('${table}')`
          break
      }

      // For MySQL/MariaDB, use -s (with column names) instead of -sN so parseMysqlOutput works correctly
      let cmd: ChildProcess.StandardCommand | null = null
      if (type === "mysql" || type === "mariadb") {
        const bin = findCommand("mysql")
        if (bin) {
          cmd = ChildProcess.make(
            bin,
            [`--default-character-set=utf8`, `-h${host}`, `-P${String(port)}`, `-u${user}`, `-p${password}`, database, `-s`, `-e`, sql],
            { stdin: "ignore" },
          )
        }
      } else {
        cmd = buildExecuteCommand({ type, host, port, user, password, database, sql })
      }
      if (!cmd) {
        return { columns: [] } satisfies typeof DatabaseColumnsResult.Type
      }

      const result = yield* appProcess
        .run(cmd, { timeout: 10000 })
        .pipe(Effect.catch(() => Effect.succeed({ exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("") })))

      const stdout = cleanOutput(result.stdout)
      if (result.exitCode !== 0 || !stdout) {
        return { columns: [] } satisfies typeof DatabaseColumnsResult.Type
      }

      const lines = stdout.split("\n").filter((l) => l.trim())
      const cols: { name: string; type: string; nullable: boolean; key?: string; defaultValue?: string; comment?: string }[] = []

      if (type === "sqlite") {
        for (const line of lines) {
          const parts = line.split("|")
          if (parts.length >= 5) {
            cols.push({
              name: parts[1]!.trim(),
              type: parts[2]!.trim(),
              nullable: parts[3]!.trim() === "0",
              key: parts[5]?.trim() === "1" ? "PRI" : undefined,
              defaultValue: parts[4]?.trim() || undefined,
            })
          }
        }
      } else {
        // -s mode: no column headers, parse by position
        const lines = stdout.split("\n").filter((l) => l.trim())
        for (const line of lines) {
          const parts = line.split("\t")
          if (parts.length >= 4) {
            cols.push({
              name: (parts[0] ?? "").trim(),
              type: (parts[1] ?? "").trim(),
              nullable: (parts[2] ?? "").trim() === "true",
              key: (parts[3] ?? "").trim() || undefined,
              defaultValue: (parts[4] ?? "").trim() || undefined,
              comment: (parts[5] ?? "").trim() || undefined,
            })
          }
        }
      }

      return { columns: cols } satisfies typeof DatabaseColumnsResult.Type
    })

    const query = Effect.fn("DatabaseHttpApi.query")(function* (ctx: { payload: typeof DatabaseQueryPayload.Type }) {
      const { type, host, port, user, password, database, sql } = ctx.payload
      // For MySQL/MariaDB, use -v (verbose with column names) so we can parse headers
      let cmd: ChildProcess.StandardCommand | null = null
      if (type === "mysql" || type === "mariadb") {
        const bin = findCommand("mysql")
        if (bin) {
          cmd = ChildProcess.make(
            bin,
            [`--default-character-set=utf8`, `-h${host}`, `-P${String(port)}`, `-u${user}`, `-p${password}`, database, `-v`, `-e`, sql],
            { stdin: "ignore" },
          )
        }
      } else {
        cmd = buildExecuteCommand({ type, host, port, user, password, database, sql })
      }
      if (!cmd) {
        return { success: false, message: getNotFoundMessage(type), columns: [], rows: [], total: 0 } satisfies typeof DatabaseQueryResult.Type
      }

      const result = yield* appProcess
        .run(cmd, { timeout: 30000 })
        .pipe(Effect.catch(() => Effect.succeed({ exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("") })))

      const stdout = cleanOutput(result.stdout)
      const stderr = cleanOutput(result.stderr)

      if (result.exitCode !== 0) {
        return { success: false, message: stderr || stdout || `退出码 ${result.exitCode}`, columns: [], rows: [], total: 0 } satisfies typeof DatabaseQueryResult.Type
      }

      if (!stdout) {
        return { success: true, message: "查询成功，无结果", columns: [], rows: [], total: 0 } satisfies typeof DatabaseQueryResult.Type
      }

      // -v mode outputs: ----\nSQL\n----\n\ncol1\tcol2\nval1\tval2\n...
      // Filter out ---- separators and empty lines
      const lines = stdout.split("\n").filter((l) => l.trim() && !l.startsWith("----"))
      if (lines.length <= 1) {
        return { success: true, message: "查询成功，无结果", columns: [], rows: [], total: 0 } satisfies typeof DatabaseQueryResult.Type
      }

      // lines[0] is SQL statement, lines[1] is column names, lines[2+] are data rows
      const colLine = lines[1]!.split("\t").map((c) => c.trim())
      const dataLines = lines.slice(2)
      const rows: Record<string, unknown>[] = []
      for (const line of dataLines) {
        const vals = line.split("\t")
        const row: Record<string, unknown> = {}
        for (let j = 0; j < colLine.length; j++) {
          row[colLine[j]!] = (vals[j] ?? "").trim() || null
        }
        rows.push(row)
      }

      return { success: true, message: `查询成功，共 ${rows.length} 行`, columns: colLine, rows, total: rows.length } satisfies typeof DatabaseQueryResult.Type
    })

    const saveConnections = Effect.fn("DatabaseHttpApi.saveConnections")(function* (ctx: { payload: typeof DatabaseSaveConnectionsPayload.Type }) {
      const route = yield* WorkspaceRouteContext
      const dir = path.join(route.directory, ".novaway")
      mkdirSync(dir, { recursive: true })
      writeFileSync(path.join(dir, "db-connections.json"), JSON.stringify(ctx.payload.connections, null, 2), "utf8")
      return { success: true, message: "连接已保存" } satisfies typeof DatabaseConnectionsResult.Type
    })

    const loadConnections = Effect.fn("DatabaseHttpApi.loadConnections")(function* () {
      const route = yield* WorkspaceRouteContext
      const filePath = path.join(route.directory, ".novaway", "db-connections.json")
      if (!existsSync(filePath)) {
        return { connections: [] } satisfies typeof DatabaseSaveConnectionsPayload.Type
      }
      const raw = readFileSync(filePath, "utf8")
      const connections = JSON.parse(raw)
      return { connections: Array.isArray(connections) ? connections : [] } satisfies typeof DatabaseSaveConnectionsPayload.Type
    })

    return handlers.handle("test", test).handle("list", list).handle("execute", execute).handle("tables", tables).handle("columns", columns).handle("query", query).handle("saveConnections", saveConnections).handle("loadConnections", loadConnections)
  }),
)
