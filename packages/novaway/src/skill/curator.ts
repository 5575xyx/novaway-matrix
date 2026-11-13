// 技能生命周期巡检（curator）。
//
// 目标不是「自动删技能」，而是把长期不用的技能标出来并归档到项目目录的
// `.novaway/.archive/skills/` 下：技能加载器扫的是 `skills/**/SKILL.md`，
// 归档目录不在扫描范围内，所以归档后立刻对模型不可见，但文件仍在、可恢复。
//
// 默认关闭（`evolution.curator_enabled=false`）。启用后每周最多跑一次，
// 由已经常驻的 cron tick 驱动，不需要额外的进程或会话。

import fs from "node:fs/promises"
import path from "node:path"
import type { Ledger } from "./usage"

export const STATE_FILE = path.join(".novaway", "curator-state.json")
export const ARCHIVE_ROOT = path.join(".novaway", ".archive", "skills")
export const RUN_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

export type SkillEntry = {
  name: string
  location: string
  builtIn?: boolean
  /** Epoch ms of the last observed activity (usage or file mtime). */
  lastActivity: number
  /** A `.stale` marker from a previous run already exists. */
  staleMarked?: boolean
}

export type Decision = {
  name: string
  location: string
  action: "stale" | "archive"
  days: number
}

/** Pure decision function: what should happen to each skill right now. */
export function plan(input: {
  skills: readonly SkillEntry[]
  now: number
  staleDays: number
  archiveDays: number
}): Decision[] {
  const decisions: Decision[] = []
  for (const skill of input.skills) {
    if (skill.builtIn) continue
    if (!skill.lastActivity) continue
    const days = Math.floor((input.now - skill.lastActivity) / DAY_MS)
    if (input.archiveDays > 0 && days >= input.archiveDays) {
      decisions.push({ name: skill.name, location: skill.location, action: "archive", days })
      continue
    }
    if (input.staleDays > 0 && days >= input.staleDays && !skill.staleMarked) {
      decisions.push({ name: skill.name, location: skill.location, action: "stale", days })
    }
  }
  return decisions
}

async function lastActivityOf(location: string, ledger: Ledger, name: string) {
  const used = ledger[name]?.lastUsed
  if (used) return used
  const mtime = await fs
    .stat(location)
    .then((info) => info.mtimeMs)
    .catch(() => undefined)
  return mtime ?? 0
}

async function staleMarked(location: string) {
  return fs
    .stat(path.join(path.dirname(location), ".stale"))
    .then(() => true)
    .catch(() => false)
}

async function archive(directory: string, decision: Decision, now: number) {
  const source = path.dirname(decision.location)
  if (!source.split(path.sep).includes("skills")) return false
  const target = path.join(directory, ARCHIVE_ROOT, `${decision.name}-${now}`)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.rename(source, target).catch(() => undefined)
  return fs
    .stat(target)
    .then(() => true)
    .catch(() => false)
}

async function markStale(location: string, now: number) {
  await fs.mkdir(path.dirname(location), { recursive: true })
  await fs.writeFile(path.join(path.dirname(location), ".stale"), JSON.stringify({ since: now }) + "\n", "utf8")
}

export async function due(directory: string, now: number) {
  const raw = await fs.readFile(path.join(directory, STATE_FILE), "utf8").catch(() => undefined)
  if (!raw) return true
  const parsed: unknown = (() => {
    try {
      return JSON.parse(raw)
    } catch {
      return undefined
    }
  })()
  if (!parsed || typeof parsed !== "object") return true
  const last = Object.entries(parsed).find(([key]) => key === "lastRunAt")?.[1]
  if (typeof last !== "number") return true
  return now - last >= RUN_INTERVAL_MS
}

export async function run(input: {
  directory: string
  skills: readonly SkillEntry[]
  ledger: Ledger
  now: number
  staleDays: number
  archiveDays: number
}): Promise<Decision[]> {
  const skills = await Promise.all(
    input.skills.map(async (skill) => ({
      ...skill,
      lastActivity: skill.lastActivity || (await lastActivityOf(skill.location, input.ledger, skill.name)),
      staleMarked: skill.staleMarked ?? (await staleMarked(skill.location)),
    })),
  )
  const decisions = plan({ skills, now: input.now, staleDays: input.staleDays, archiveDays: input.archiveDays })
  for (const decision of decisions) {
    if (decision.action === "archive") {
      if (await archive(input.directory, decision, input.now)) continue
      // Archiving failed (permissions/locked file): degrade to a stale marker.
      await markStale(decision.location, input.now)
      continue
    }
    await markStale(decision.location, input.now)
  }
  await fs.mkdir(path.join(input.directory, path.dirname(STATE_FILE)), { recursive: true })
  await fs.writeFile(
    path.join(input.directory, STATE_FILE),
    JSON.stringify({ lastRunAt: input.now, decisions }, null, 2) + "\n",
    "utf8",
  )
  return decisions
}
