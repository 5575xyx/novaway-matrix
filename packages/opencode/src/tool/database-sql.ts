import { Effect, Schema } from "effect"
import { existsSync } from "fs"
import { execSync } from "child_process"
import * as Tool from "./tool"
import { AppProcess } from "@opencode-ai/core/process"
import { ChildProcess } from "effect/unstable/process"

export const Parameters = Schema.Struct({
  type: Schema.Union([Schema.Literal("mysql"), Schema.Literal("postgresql"), Schema.Literal("sqlite"), Schema.Literal("sqlserver"), Schema.Literal("mariadb")]),
  host: Schema.String,
  port: Schema.Number,
  user: Schema.String,
  password: Schema.String,
  database: Schema.String,
  sql: Schema.String,
})

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

const CMD_MAP: Record<string, string> = {
  mysql: "mysql",
  mariadb: "mysql",
  postgresql: "psql",
  sqlite: "sqlite3",
  sqlserver: "sqlcmd",
}

type ConnParams = { host: string; port: number; user: string; password: string; database: string; sql: string }

export const DatabaseSqlTool = Tool.define(
  "database_sql",
  Effect.gen(function* () {
    const appProcess = yield* AppProcess.Service

    return {
      description: [
        "执行 SQL 语句并返回结果。支持 MySQL、PostgreSQL、SQLite、SQL Server、MariaDB。",
        "参数：type, host, port, user, password, database, sql",
        "SELECT 返回表格，DDL/DML 返回状态。",
      ].join("\n"),
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "database_sql",
            patterns: [`${params.type}:${params.host}:${params.port}/${params.database}`],
            always: [],
            metadata: { type: params.type, database: params.database },
          })

          const cmdName = CMD_MAP[params.type as string]
          if (!cmdName) {
            return { title: "", metadata: {}, output: `不支持的数据库类型：${params.type}` }
          }
          const bin = findCommand(cmdName)
          if (!bin) {
            return { title: "", metadata: {}, output: `未找到 ${params.type} 客户端` }
          }

          const cmd = buildChildProcess(bin, cmdName, params as { host: string; port: number; user: string; password: string; database: string; sql: string })
          if (!cmd) {
            return { title: "", metadata: {}, output: `无法构建 ${params.type} 命令` }
          }

          const result = yield* appProcess.run(cmd, { timeout: 30000 }).pipe(
            Effect.catch(() =>
              Effect.succeed({
                exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from(""),
                command: "", stdoutTruncated: false, stderrTruncated: false,
              }),
            ),
          )

          const stdout = cleanOutput(result.stdout)
          const stderr = cleanOutput(result.stderr)

          if (result.exitCode !== 0) {
            return { title: "", metadata: {}, output: `执行失败：${stderr || stdout || `退出码 ${result.exitCode}`}` }
          }

          if (!stdout) return { title: "", metadata: {}, output: "执行成功" }

          const isSelect = /^\s*(SELECT|SHOW|DESCRIBE|EXPLAIN)\s/i.test(params.sql as string)
          if (!isSelect) return { title: "", metadata: {}, output: `执行成功\n\n${stdout}` }

          const parsed = parseOutput(stdout)
          if (parsed.columns.length === 0) return { title: "", metadata: {}, output: stdout }

          const header = parsed.columns.join(" | ")
          const sep = parsed.columns.map(() => "---").join(" | ")
          const rows = parsed.rows.map((row) =>
            parsed.columns.map((col) => String(row[col] ?? "NULL")).join(" | ")
          )
          return {
            title: `${params.database}: ${parsed.rows.length} 行`,
            metadata: {},
            output: `${header}\n${sep}\n${rows.join("\n")}`,
          }
        }),
    }
  }),
)

function buildChildProcess(bin: string, type: string, p: ConnParams): ChildProcess.Command | null {
  switch (type) {
    case "mysql":
    case "mariadb":
      return ChildProcess.make(bin, [
        `--default-character-set=utf8`, `-h${p.host}`, `-P${String(p.port)}`,
        `-u${p.user}`, `-p${p.password}`, p.database, `-sN`, `-e`, p.sql,
      ], { stdin: "ignore" })
    case "postgresql":
      return ChildProcess.make(bin, [
        `-h${p.host}`, `-p${String(p.port)}`, `-U${p.user}`, `-d${p.database}`, `-t`, `-A`, `-c`, p.sql,
      ], { stdin: "ignore" })
    case "sqlite":
      return ChildProcess.make(bin, [p.database, p.sql], { stdin: "ignore" })
    case "sqlserver":
      return ChildProcess.make(bin, [
        `-S`, `${p.host},${p.port}`, `-U`, p.user, `-P`, p.password, `-d`, p.database, `-Q`, p.sql, `-W`,
      ], { stdin: "ignore" })
    default:
      return null
  }
}

function parseOutput(stdout: string): { columns: string[]; rows: Record<string, unknown>[] } {
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
