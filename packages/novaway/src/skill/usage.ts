// 技能使用账本：`skill` 工具每次加载技能时记一笔，供生命周期巡检（curator）
// 和技能排序使用。
//
// 存成项目目录下的 JSON，而不是走 DB：技能本身是磁盘文件，使用记录跟着项目
// 目录走，迁移/备份时不会出现「文件在、记录没了」。写入按目录串行化，避免同一
// 进程内并发加载技能时互相覆盖。

import fs from "node:fs/promises"
import path from "node:path"

export const USAGE_FILE = path.join(".novaway", "skill-usage.json")

export type Usage = { count: number; lastUsed: number }
export type Ledger = Record<string, Usage>

const locks = new Map<string, Promise<unknown>>()

async function file(directory: string) {
  return path.join(directory, USAGE_FILE)
}

export async function read(directory: string): Promise<Ledger> {
  const raw = await fs.readFile(await file(directory), "utf8").catch(() => undefined)
  if (!raw) return {}
  const parsed: unknown = (() => {
    try {
      return JSON.parse(raw)
    } catch {
      return undefined
    }
  })()
  if (!parsed || typeof parsed !== "object") return {}
  const ledger: Ledger = {}
  for (const [name, value] of Object.entries(parsed)) {
    if (!value || typeof value !== "object") continue
    const entry = Object.fromEntries(Object.entries(value))
    if (typeof entry.count !== "number" || typeof entry.lastUsed !== "number") continue
    ledger[name] = { count: entry.count, lastUsed: entry.lastUsed }
  }
  return ledger
}

/** 记录一次技能加载；同一目录的写入串行执行，失败不影响调用方。 */
export async function record(input: { directory: string; name: string; now?: number }) {
  const target = await file(input.directory)
  const previous = locks.get(target) ?? Promise.resolve()
  const next = previous.then(async () => {
    const ledger = await read(input.directory)
    const current = ledger[input.name]
    ledger[input.name] = { count: (current?.count ?? 0) + 1, lastUsed: input.now ?? Date.now() }
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, JSON.stringify(ledger, null, 2) + "\n", "utf8")
  })
  locks.set(
    target,
    next.catch(() => undefined),
  )
  return next
}
