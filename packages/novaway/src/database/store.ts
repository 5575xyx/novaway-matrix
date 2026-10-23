/**
 * 连接配置存储。
 *
 * 放在 NovaWay 数据目录下的 `database/connections.json`：
 * - 密码字段加密后写入（见 ./secrets.ts），文件本身可以直接备份；
 * - 读取时只回传 `hasPassword`，密码永远不出现在 API 响应里；
 * - 写入用 tmp + rename 原子替换。
 */
import fs from "node:fs/promises"
import path from "node:path"
import { Global } from "@novaway/core/global"
import { Identifier } from "@/id/id"
import { decryptSecret, encryptSecret } from "./secrets"
import type { ConnectionInput, ConnectionSummary, DbType } from "./schema"

type StoredConnection = {
  id: string
  name: string
  type: DbType
  host?: string
  port?: number
  database?: string
  user?: string
  file?: string
  ssl?: boolean
  db?: number
  httpPath?: string
  /** SSH 隧道配置（密码、私钥内容、口令均加密）。 */
  ssh?: {
    enabled: boolean
    host: string
    port?: number
    user: string
    secret?: string
    privateKeyPath?: string
    privateKeySecret?: string
    passphraseSecret?: string
  }
  /** 加密后的密码。 */
  secret?: string
  createdAt: number
  updatedAt: number
}

type StoredFile = {
  version: 1
  connections: StoredConnection[]
}

export const databaseRoot = () => path.join(Global.Path.data, "database")
const connectionsFile = (root: string) => path.join(root, "connections.json")

async function readFile(root: string): Promise<StoredFile> {
  try {
    const parsed = JSON.parse(await fs.readFile(connectionsFile(root), "utf8")) as StoredFile
    if (Array.isArray(parsed?.connections)) return parsed
  } catch {
    // 文件不存在或损坏：当作空列表，下次写入会重建。
  }
  return { version: 1, connections: [] }
}

async function writeFile(root: string, data: StoredFile) {
  await fs.mkdir(root, { recursive: true })
  const file = connectionsFile(root)
  const tmp = file + "." + process.pid + "." + Date.now() + ".tmp"
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8")
  await fs.rename(tmp, file)
}

function summary(item: StoredConnection): ConnectionSummary {
  return {
    id: item.id,
    name: item.name,
    type: item.type,
    ...(item.host ? { host: item.host } : {}),
    ...(item.port !== undefined ? { port: item.port } : {}),
    ...(item.database ? { database: item.database } : {}),
    ...(item.user ? { user: item.user } : {}),
    ...(item.file ? { file: item.file } : {}),
    ...(item.db !== undefined ? { db: item.db } : {}),
    ...(item.httpPath ? { httpPath: item.httpPath } : {}),
    sshEnabled: Boolean(item.ssh?.enabled),
    ...(item.ssh?.host ? { sshHost: item.ssh.host } : {}),
    hasPassword: Boolean(item.secret),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }
}

export async function listConnections(root = databaseRoot()): Promise<ConnectionSummary[]> {
  const data = await readFile(root)
  return data.connections.map(summary).sort((a, b) => a.createdAt - b.createdAt)
}

export async function getConnection(id: string, root = databaseRoot()): Promise<ConnectionSummary | undefined> {
  const data = await readFile(root)
  const item = data.connections.find((entry) => entry.id === id || entry.name === id)
  return item ? summary(item) : undefined
}

/** 取完整配置（含明文密码），仅供内部建立连接使用。 */
export async function resolveConnection(id: string, root = databaseRoot()) {
  const data = await readFile(root)
  const item = data.connections.find((entry) => entry.id === id || entry.name === id)
  if (!item) return undefined
  return {
    ...item,
    password: await decryptSecret(root, item.secret),
    ssh: item.ssh
      ? {
          enabled: item.ssh.enabled,
          host: item.ssh.host,
          port: item.ssh.port,
          user: item.ssh.user,
          privateKeyPath: item.ssh.privateKeyPath,
          password: await decryptSecret(root, item.ssh.secret),
          privateKey: await decryptSecret(root, item.ssh.privateKeySecret),
          passphrase: await decryptSecret(root, item.ssh.passphraseSecret),
        }
      : undefined,
  }
}

/**
 * 新增或更新连接（同名视为更新，保留 id 与创建时间）。
 *
 * `password` 省略时保留旧密码；传空字符串表示清除密码。
 */
export async function saveConnection(input: ConnectionInput, root = databaseRoot()): Promise<ConnectionSummary> {
  const name = input.name.trim()
  if (!name) throw new Error("连接名不能为空")
  const data = await readFile(root)
  const index = data.connections.findIndex((entry) => entry.name === name)
  const now = Date.now()
  const existing = index === -1 ? undefined : data.connections[index]

  const secret =
    input.password === undefined
      ? existing?.secret
      : input.password === ""
        ? undefined
        : await encryptSecret(root, input.password)

  // SSH：密码 / 私钥内容 / 口令都加密；字段未传时沿用旧值。
  const ssh = input.ssh
  const nextSsh =
    ssh === undefined
      ? existing?.ssh
      : ssh === null || ssh.enabled === false
        ? undefined
        : {
            enabled: true,
            host: ssh.host.trim(),
            port: ssh.port,
            user: ssh.user.trim(),
            ...(ssh.password === undefined
              ? existing?.ssh?.secret
                ? { secret: existing.ssh.secret }
                : {}
              : ssh.password === ""
                ? {}
                : { secret: await encryptSecret(root, ssh.password) }),
            ...(ssh.privateKeyPath?.trim() ? { privateKeyPath: ssh.privateKeyPath.trim() } : {}),
            ...(ssh.privateKey === undefined
              ? existing?.ssh?.privateKeySecret
                ? { privateKeySecret: existing.ssh.privateKeySecret }
                : {}
              : ssh.privateKey === ""
                ? {}
                : { privateKeySecret: await encryptSecret(root, ssh.privateKey) }),
            ...(ssh.passphrase === undefined
              ? existing?.ssh?.passphraseSecret
                ? { passphraseSecret: existing.ssh.passphraseSecret }
                : {}
              : ssh.passphrase === ""
                ? {}
                : { passphraseSecret: await encryptSecret(root, ssh.passphrase) }),
          }

  const next: StoredConnection = {
    id: existing?.id ?? Identifier.create("db", "ascending"),
    name,
    type: input.type,
    ...(input.host?.trim() ? { host: input.host.trim() } : {}),
    ...(input.port !== undefined ? { port: input.port } : {}),
    ...(input.database?.trim() ? { database: input.database.trim() } : {}),
    ...(input.user?.trim() ? { user: input.user.trim() } : {}),
    ...(input.file?.trim() ? { file: input.file.trim() } : {}),
    ...(input.ssl !== undefined ? { ssl: input.ssl } : {}),
    ...(input.db !== undefined ? { db: input.db } : {}),
    ...(input.httpPath?.trim() ? { httpPath: input.httpPath.trim() } : {}),
    ...(nextSsh ? { ssh: nextSsh } : {}),
    ...(secret ? { secret } : {}),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }

  if (index === -1) data.connections.push(next)
  else data.connections[index] = next
  await writeFile(root, data)
  return summary(next)
}

export async function removeConnection(id: string, root = databaseRoot()): Promise<boolean> {
  const data = await readFile(root)
  const next = data.connections.filter((entry) => entry.id !== id && entry.name !== id)
  if (next.length === data.connections.length) return false
  data.connections = next
  await writeFile(root, data)
  return true
}
