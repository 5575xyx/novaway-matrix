import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
const platformName = process.platform === "win32" ? "windows" : process.platform
const binaryAbi = process.env.NOVAWAY_BINARY_ABI === "musl" ? "-musl" : ""
const binaryName = `xymt-novaway-${platformName}-${process.arch}${binaryAbi}/bin/novaway${process.platform === "win32" ? ".exe" : ""}`
const binary = path.join(root, "dist", binaryName)
const runRoot = path.join(root, "test-results", `production-operations-${Date.now()}`)
const workspace = path.join(runRoot, "workspace")
const database = path.join(runRoot, "production.sqlite")
const backup = path.join(runRoot, "production.sqlite.backup")
const cert = path.join(runRoot, "localhost.crt")
const key = path.join(runRoot, "localhost.key")
const log = path.join(runRoot, "server.log")
const stdoutLog = `${log}.stdout`
const stderrLog = `${log}.stderr`
const username = "novaway"
const password = "production-operations-secret"
const auth = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`

const reservePort = () => {
  const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } })
  const port = listener.port
  listener.stop()
  return port
}
const backendPort = reservePort()
const proxyPort = reservePort()
const backend = `http://127.0.0.1:${backendPort}`
const proxy = `https://localhost:${proxyPort}`

await mkdir(workspace, { recursive: true })
await Bun.spawn(
  [
    "openssl",
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    key,
    "-out",
    cert,
    "-days",
    "1",
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=DNS:localhost",
  ],
  { stdout: "ignore", stderr: "ignore" },
).exited

const start = () =>
  Bun.spawn([binary, "serve", "--hostname=127.0.0.1", `--port=${backendPort}`], {
    env: {
      ...process.env,
      NOVAWAY_DB: database,
      NOVAWAY_SERVER_USERNAME: username,
      NOVAWAY_SERVER_PASSWORD: password,
      NOVAWAY_DISABLE_MODELS_FETCH: "1",
    },
    stdout: Bun.file(stdoutLog),
    stderr: Bun.file(stderrLog),
  })

const waitFor = async (predicate: () => Promise<boolean>, timeoutMs: number, label: string) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await Bun.sleep(250)
  }
  const diagnostics = await Promise.all([
    readFile(stdoutLog, "utf8").catch(() => ""),
    readFile(stderrLog, "utf8").catch(() => ""),
  ])
  throw new Error(`production operations smoke timeout: ${label}\n${diagnostics.join("\n")}`)
}
const direct = (pathname: string, init: RequestInit = {}) =>
  fetch(`${backend}${pathname}`, {
    ...init,
    headers: {
      authorization: auth,
      "content-type": "application/json",
      "x-novaway-directory": workspace,
      ...(init.headers ?? {}),
    },
  })

let server = start()
let tlsProxy: ReturnType<typeof Bun.serve> | undefined
try {
  await waitFor(async () => {
    try {
      return (await direct("/global/health")).ok
    } catch {
      return false
    }
  }, 60_000, "backend health")

  const session = await direct("/session", { method: "POST", body: JSON.stringify({ title: "operations smoke" }) })
  if (!session.ok) throw new Error(`could not create backup test session: ${session.status}`)

  tlsProxy = Bun.serve({
    hostname: "127.0.0.1",
    port: proxyPort,
    tls: { cert: Bun.file(cert), key: Bun.file(key) },
    async fetch(request) {
      const url = new URL(request.url)
      const headers = new Headers(request.headers)
      headers.delete("host")
      return fetch(`${backend}${url.pathname}${url.search}`, {
        method: request.method,
        headers,
        body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      })
    },
  })

  const curl = async (pathname: string) => {
    const result = Bun.spawn(
      ["curl", "--silent", "--show-error", "--insecure", "--user", `${username}:${password}`, `${proxy}${pathname}`],
      { stdout: "pipe", stderr: "pipe" },
    )
    const [code, body, error] = await Promise.all([
      result.exited,
      new Response(result.stdout).text(),
      new Response(result.stderr).text(),
    ])
    if (code !== 0) throw new Error(`TLS reverse proxy request failed: ${error}`)
    return body
  }
  const proxiedHealth = await curl("/global/health")
  if (proxiedHealth.length === 0) throw new Error("TLS reverse proxy returned an empty health response")
  tlsProxy.stop()
  tlsProxy = undefined

  // Stop before copying SQLite so the database and any WAL sidecar form a
  // consistent backup set. Restore the exact set into a fresh process below.
  server.kill()
  await server.exited.catch(() => undefined)
  const checkpoint = Bun.spawn(
    ["sqlite3", database, "PRAGMA wal_checkpoint(TRUNCATE); VACUUM;"],
    { stdout: "ignore", stderr: "pipe" },
  )
  if ((await checkpoint.exited) !== 0) throw new Error(`SQLite checkpoint failed: ${await new Response(checkpoint.stderr).text()}`)
  await copyFile(database, backup)
  await rm(`${database}-wal`, { force: true })
  await rm(`${database}-shm`, { force: true })
  await rm(database, { force: true })
  await copyFile(backup, database)

  server = start()
  await waitFor(async () => {
    try {
      return (await direct("/global/health")).ok
    } catch {
      return false
    }
  }, 60_000, "health after backup restore")
  const [stdoutStat, stderrStat] = await Promise.all([stat(stdoutLog), stat(stderrLog)])
  const logBytes = stdoutStat.size + stderrStat.size
  if (logBytes === 0) throw new Error("production server emitted no captured log output")
  const evidence = {
    platform: process.platform,
    arch: process.arch,
    tlsReverseProxy: "pass",
    backupRestore: "pass",
    capturedLogBytes: logBytes,
    createdAt: new Date().toISOString(),
  }
  await writeFile(
    path.join(root, "test-results", "production-operations-smoke.json"),
    JSON.stringify(evidence, null, 2) + "\n",
  )
  console.log("PRODUCTION_OPERATIONS_SMOKE=PASS")
  console.log("PRODUCTION_TLS_REVERSE_PROXY=PASS")
  console.log("PRODUCTION_BACKUP_RESTORE=PASS")
  console.log(`PRODUCTION_LOG_BYTES=${logBytes}`)
} finally {
  tlsProxy?.stop()
  server.kill()
  await server.exited.catch(() => undefined)
  await rm(runRoot, { recursive: true, force: true })
}
