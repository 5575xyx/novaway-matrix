import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { Global } from "@novaway/core/global"
import { isRecord } from "@/util/record"
import { NOVAWAY_MARKETPLACE_REPOSITORY, NOVAWAY_MARKETPLACE_URLS, CLAUDE_MARKETPLACE_URLS } from "./catalog"

export type SourceType = "novaway" | "claude" | "zcode" | "auto"
export type SourceTrust = "official" | "unverified"

export type Source = {
  id: string
  name: string
  type: SourceType
  url: string
  enabled: boolean
  trust: SourceTrust
  builtin?: boolean
  createdAt: number
  updatedAt: number
  lastRefreshAt?: number
  lastError?: string
}

type Stored = { version: 1; sources: Source[] }
const FILE = "marketplace-sources.json"
const OFFICIAL_ID = "novaway-official"

export const official: Source = {
  id: OFFICIAL_ID,
  name: "NovaWay Official",
  type: "novaway",
  url: NOVAWAY_MARKETPLACE_URLS[0],
  enabled: true,
  trust: "official",
  builtin: true,
  createdAt: 0,
  updatedAt: 0,
}

const builtinSources: Source[] = [
  official,
  {
    id: "claude-official",
    name: "Claude Official",
    type: "claude",
    url: CLAUDE_MARKETPLACE_URLS[0],
    enabled: true,
    trust: "official",
    builtin: true,
    createdAt: 0,
    updatedAt: 0,
  },
]
const builtinIDs = new Set(builtinSources.map((item) => item.id))

export function urlsFor(source: Pick<Source, "id" | "url">): readonly string[] {
  return source.id === OFFICIAL_ID ? NOVAWAY_MARKETPLACE_URLS : [source.url]
}

function file(config = Global.Path.data) {
  return path.join(config, FILE)
}

function validType(value: unknown): value is SourceType {
  return value === "novaway" || value === "claude" || value === "zcode" || value === "auto"
}

function validTrust(value: unknown): value is SourceTrust {
  return value === "official" || value === "unverified"
}

function httpUrl(value: unknown) {
  if (typeof value !== "string" || value.trim() === "") return undefined
  try {
    const url = new URL(value.trim())
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined
    if (url.username || url.password) return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

function source(value: unknown): Source | undefined {
  if (!isRecord(value)) return undefined
  const id = typeof value.id === "string" && /^[a-z0-9][a-z0-9._-]{0,100}$/.test(value.id) ? value.id : undefined
  const name = typeof value.name === "string" && value.name.trim() ? value.name.trim().slice(0, 120) : undefined
  const url = httpUrl(value.url)
  if (!id || !name || !url || !validType(value.type)) return undefined
  return {
    id,
    name,
    type: value.type,
    url,
    enabled: value.enabled !== false,
    trust: validTrust(value.trust) ? value.trust : "unverified",
    ...(typeof value.createdAt === "number" ? { createdAt: value.createdAt } : { createdAt: 0 }),
    ...(typeof value.updatedAt === "number" ? { updatedAt: value.updatedAt } : { updatedAt: 0 }),
    ...(typeof value.lastRefreshAt === "number" ? { lastRefreshAt: value.lastRefreshAt } : {}),
    ...(typeof value.lastError === "string" ? { lastError: value.lastError.slice(0, 500) } : {}),
  }
}

function decode(value: unknown): Source[] {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.sources)) return []
  const result: Source[] = []
  const ids = new Set<string>()
  for (const item of value.sources) {
    const parsed = source(item)
    if (!parsed || ids.has(parsed.id)) continue
    ids.add(parsed.id)
    result.push(parsed)
  }
  return result
}

async function read(config = Global.Path.data): Promise<Source[]> {
  try {
    return decode(JSON.parse(await fs.readFile(file(config), "utf8")))
  } catch {
    return []
  }
}

async function write(sources: Source[], config = Global.Path.data) {
  await fs.mkdir(config, { recursive: true })
  const target = file(config)
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`
  const payload: Stored = { version: 1, sources }
  await fs.writeFile(temporary, JSON.stringify(payload, null, 2), "utf8")
  await fs.rename(temporary, target).catch(async (error) => {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
    throw error
  })
}

export async function list(config = Global.Path.data): Promise<Source[]> {
  const stored = await read(config)
  const overrides = new Map(stored.filter((item) => builtinIDs.has(item.id)).map((item) => [item.id, item]))
  const custom = stored.filter((item) => !builtinIDs.has(item.id) && item.id !== "zcode-official")
  return [
    ...builtinSources.map((item) => {
      const saved = overrides.get(item.id)
      return {
        ...item,
        ...(saved
          ? {
              enabled: saved.enabled,
              updatedAt: saved.updatedAt,
              ...(saved.lastRefreshAt === undefined ? {} : { lastRefreshAt: saved.lastRefreshAt }),
              ...(saved.lastError === undefined ? {} : { lastError: saved.lastError }),
            }
          : {}),
      }
    }),
    ...custom,
  ]
}

export async function get(id: string, config = Global.Path.data) {
  return (await list(config)).find((item) => item.id === id)
}

export type AddInput = { name: string; type: SourceType; url: string }

export async function add(input: AddInput, config = Global.Path.data): Promise<Source> {
  const name = input.name.trim().slice(0, 120)
  const url = httpUrl(input.url)
  if (!name || !url || !validType(input.type)) throw new Error("invalid marketplace source")
  const sources = await read(config)
  if (sources.some((item) => item.url === url)) throw new Error("marketplace source already exists")
  const now = Date.now()
  const id = `source-${createHash("sha256").update(`${url}\0${randomUUID()}`).digest("hex").slice(0, 16)}`
  const result: Source = {
    id,
    name,
    type: input.type,
    url,
    enabled: true,
    trust: "unverified",
    createdAt: now,
    updatedAt: now,
  }
  await write([...sources, result], config)
  return result
}

export type UpdateInput = Partial<Pick<Source, "name" | "type" | "url" | "enabled">>

export async function update(id: string, input: UpdateInput, config = Global.Path.data): Promise<Source> {
  if (builtinIDs.has(id)) {
    const builtin = builtinSources.find((item) => item.id === id)!
    if (input.name !== undefined || input.type !== undefined || input.url !== undefined) {
      throw new Error(`the ${builtin.name} marketplace source cannot be edited`)
    }
    const stored = await read(config)
    const current = stored.find((item) => item.id === id)
    const result: Source = {
      ...builtin,
      ...current,
      enabled: input.enabled ?? current?.enabled ?? true,
      updatedAt: Date.now(),
      builtin: true,
      trust: "official",
    }
    await write([result, ...stored.filter((item) => item.id !== id)], config)
    return result
  }
  const sources = await read(config)
  const index = sources.findIndex((item) => item.id === id)
  if (index < 0) throw new Error("marketplace source not found")
  const current = sources[index]
  const name = input.name === undefined ? current.name : input.name.trim().slice(0, 120)
  const url = input.url === undefined ? current.url : httpUrl(input.url)
  const type = input.type === undefined ? current.type : input.type
  if (!name || !url || !validType(type)) throw new Error("invalid marketplace source")
  if (sources.some((item, itemIndex) => itemIndex !== index && item.url === url)) {
    throw new Error("marketplace source already exists")
  }
  const result: Source = {
    ...current,
    name,
    type,
    url,
    enabled: input.enabled ?? current.enabled,
    updatedAt: Date.now(),
    lastError: undefined,
  }
  sources[index] = result
  await write(sources, config)
  return result
}

export async function remove(id: string, config = Global.Path.data): Promise<boolean> {
  if (builtinIDs.has(id)) throw new Error("builtin marketplace sources cannot be removed")
  const sources = await read(config)
  const next = sources.filter((item) => item.id !== id)
  if (next.length === sources.length) return false
  await write(next, config)
  return true
}

export async function recordRefresh(id: string, result: { error?: string }, config = Global.Path.data) {
  const sources = await read(config)
  const index = sources.findIndex((item) => item.id === id)
  if (index < 0 && !builtinIDs.has(id)) return
  const current = index < 0 ? builtinSources.find((item) => item.id === id) : sources[index]
  if (!current) return
  const next: Source = {
    ...current,
    ...(result.error ? { lastError: result.error.slice(0, 500) } : { lastRefreshAt: Date.now(), lastError: undefined }),
    updatedAt: Date.now(),
    ...(builtinIDs.has(id) ? { builtin: true, trust: "official" as const } : {}),
  }
  const rest = sources.filter((item) => item.id !== id)
  await write([next, ...rest], config)
}

export const officialRepository = NOVAWAY_MARKETPLACE_REPOSITORY

export * as MarketplaceSources from "./sources"
