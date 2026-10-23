/**
 * SSH 隧道。
 *
 * 很多公司的数据库只对内网开放，只能先 SSH 到跳板机再连。这里用 `ssh2`
 * 在本地起一个 TCP 转发：驱动照常连 `127.0.0.1:<随机端口>`，流量经跳板机
 * 转发到真实数据库地址，驱动本身完全无感知。
 *
 * 隧道按「连接 id + 目标地址」缓存并复用：每次查询都重新建 SSH 会话既慢，
 * 又容易被跳板机的连接数限制拒绝。空闲 5 分钟后自动关闭。
 */
import fs from "node:fs/promises"
import net from "node:net"
import path from "node:path"
import { Client, type ConnectConfig } from "ssh2"
import type { ResolvedConnection, SshConfig } from "./drivers/types"

type Tunnel = {
  key: string
  server: net.Server
  client: Client
  port: number
  lastUsed: number
  timer?: NodeJS.Timeout
}

const tunnels = new Map<string, Tunnel>()
const IDLE_MS = 5 * 60_000

function keyOf(connection: ResolvedConnection, target: { host: string; port: number }, ssh: SshConfig) {
  return [connection.id, ssh.user + "@" + ssh.host + ":" + (ssh.port ?? 22), target.host + ":" + target.port].join("|")
}

async function connectConfig(ssh: SshConfig): Promise<ConnectConfig> {
  const config: ConnectConfig = {
    host: ssh.host,
    port: ssh.port ?? 22,
    username: ssh.user,
    readyTimeout: 20_000,
    keepaliveInterval: 30_000,
  }
  if (ssh.password) config.password = ssh.password
  if (ssh.privateKey) config.privateKey = ssh.privateKey
  if (ssh.privateKeyPath) {
    try {
      config.privateKey = await fs.readFile(path.resolve(ssh.privateKeyPath))
    } catch (error) {
      throw new Error("读取 SSH 私钥失败：" + (error instanceof Error ? error.message : String(error)))
    }
  }
  if (ssh.passphrase) config.passphrase = ssh.passphrase
  if (!config.password && !config.privateKey) throw new Error("SSH 隧道需要密码或私钥")
  return config
}

/** 建立（或复用）隧道，返回本地转发端口。 */
export async function ensureTunnel(
  connection: ResolvedConnection,
  target: { host: string; port: number },
  ssh: SshConfig,
): Promise<number> {
  const key = keyOf(connection, target, ssh)
  const existing = tunnels.get(key)
  if (existing) {
    existing.lastUsed = Date.now()
    return existing.port
  }

  const client = new Client()
  const config = await connectConfig(ssh)
  await new Promise<void>((resolve, reject) => {
    // ssh2 的 connect() 返回 this、不支持 Promise；错误统一走 error 事件。
    client.once("ready", () => resolve())
    client.once("error", reject)
    try {
      client.connect(config)
    } catch (error) {
      reject(error)
    }
  }).catch((error) => {
    client.end()
    throw new Error("SSH 隧道连接失败：" + (error instanceof Error ? error.message : String(error)))
  })

  const server = net.createServer((socket) => {
    client.forwardOut("127.0.0.1", socket.remotePort ?? 0, target.host, target.port, (error, stream) => {
      if (error) {
        socket.destroy()
        return
      }
      socket.pipe(stream).pipe(socket)
      stream.on("error", () => socket.destroy())
      socket.on("error", () => stream.destroy())
      const tunnel = tunnels.get(key)
      if (tunnel) tunnel.lastUsed = Date.now()
    })
  })

  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (typeof address !== "object" || !address) {
        reject(new Error("无法分配本地隧道端口"))
        return
      }
      resolve(address.port)
    })
  })

  const tunnel: Tunnel = { key, server, client, port, lastUsed: Date.now() }
  tunnel.timer = setInterval(() => {
    if (Date.now() - tunnel.lastUsed < IDLE_MS) return
    closeTunnel(key)
  }, 60_000)
  tunnel.timer.unref?.()
  tunnels.set(key, tunnel)
  return port
}

export function closeTunnel(key: string) {
  const tunnel = tunnels.get(key)
  if (!tunnel) return
  tunnels.delete(key)
  if (tunnel.timer) clearInterval(tunnel.timer)
  tunnel.server.close()
  tunnel.client.end()
}

/** 关闭某个连接的全部隧道（删除连接时用）。 */
export function closeConnectionTunnels(connectionID: string) {
  for (const key of Array.from(tunnels.keys())) {
    if (key.startsWith(connectionID + "|")) closeTunnel(key)
  }
}

/**
 * 把连接改写成本地转发：驱动完全不感知隧道。
 *
 * 只改 host/port，数据库名等字段保持不变，因此调用方仍可按 database 切库。
 */
export async function withTunnel(connection: ResolvedConnection): Promise<ResolvedConnection> {
  const ssh = connection.ssh
  if (!ssh) return connection
  const target = {
    host: connection.host ?? "127.0.0.1",
    port: connection.port ?? defaultPort(connection.type),
  }
  const port = await ensureTunnel(connection, target, ssh)
  return { ...connection, host: "127.0.0.1", port }
}

function defaultPort(type: ResolvedConnection["type"]) {
  if (type === "postgres") return 5432
  if (type === "redis") return 6379
  if (type === "clickhouse") return 8123
  if (type === "mongodb") return 27017
  if (type === "rqlite") return 4001
  if (type === "starrocks" || type === "doris") return 9030
  return 3306
}
