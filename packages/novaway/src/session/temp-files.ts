/**
 * 会话临时文件追踪与清理。
 *
 * 背景：AI 在任务中会写 `tmp-*.mjs`、`debug-*.ts`、`*.tmp` 这类一次性文件，
 * 任务结束后它们既不在 Git 里、也没人记得删，越积越多。
 *
 * 策略（保守优先）：
 * 1. **只记录工具新建的文件**（write / apply_patch 的 add），不记录修改已有文件；
 * 2. **只认定严格命名的临时文件**：`.tmp/`、`tmp/`、`temp/` 目录，或
 *    `tmp-*`、`temp-*`、`scratch-*`、`debug-*`、`*.tmp|.bak|.orig|.rej|.swp|~`；
 * 3. 清理前校验 **内容 hash 未变**：用户/AI 后来又改过的文件不动；
 * 4. 自动清理只在会话空闲时触发，并且文件创建满 30 秒（避免删掉正在用的文件）。
 *
 * 记录存在 `~/.novaway/temp-files/<sessionID>.json`，不写工作区。
 */
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { Global } from "@novaway/core/global"

export type TempFile = {
  /** 绝对路径 */
  path: string
  /** 相对工作区的路径，用于展示 */
  relative: string
  tool: string
  createdAt: number
  /** 写入时的内容 sha1，清理前用来判断"是否被改过" */
  hash: string
  size: number
}

export type TempFileState = {
  sessionID: string
  files: TempFile[]
}

export type CleanResult = {
  removed: string[]
  skipped: Array<{ path: string; reason: string }>
}

const ID = /^[A-Za-z0-9_-]+$/
const MIN_AGE_MS = 30_000
const IGNORED_SEGMENTS = new Set([".git", "node_modules", ".novaway"])

const rootDir = () => path.join(Global.Path.data, "temp-files")
const stateFile = (sessionID: string) => path.join(rootDir(), sessionID + ".json")

function assertID(value: string, label: string) {
  if (!ID.test(value)) throw new Error("Invalid " + label + ": " + value)
}

export function contentHash(content: Buffer | string) {
  return createHash("sha1").update(content).digest("hex")
}

/**
 * 是否是"临时文件"。
 *
 * 刻意只认非常明确的名字：宁可漏删，也不能把源码当临时文件删掉。
 */
export function isTemporaryPath(relative: string) {
  const normalized = relative.split(path.sep).join("/")
  if (!normalized || normalized.startsWith("..")) return false
  const segments = normalized.split("/").filter(Boolean)
  if (segments.some((segment) => IGNORED_SEGMENTS.has(segment))) return false

  // 目录级：位于 tmp / temp / .tmp / scratch 之下
  const dirs = segments.slice(0, -1)
  if (dirs.some((dir) => ["tmp", "temp", ".tmp", "scratch"].includes(dir.toLowerCase()))) return true

  const base = segments[segments.length - 1]?.toLowerCase() ?? ""
  if (!base) return false
  if (/^(tmp|temp|scratch|debug)[-_.]/.test(base)) return true
  if (/\.(tmp|bak|orig|rej|swp)$/.test(base)) return true
  if (base.endsWith("~")) return true
  return false
}

async function readState(sessionID: string): Promise<TempFileState> {
  assertID(sessionID, "session id")
  try {
    const value = JSON.parse(await fs.readFile(stateFile(sessionID), "utf8")) as TempFileState
    return { sessionID, files: Array.isArray(value.files) ? value.files : [] }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { sessionID, files: [] }
    if (error instanceof SyntaxError) return { sessionID, files: [] }
    throw error
  }
}

async function writeState(state: TempFileState) {
  const file = stateFile(state.sessionID)
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = file + "." + process.pid + "." + Date.now() + ".tmp"
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf8")
  await fs.rename(tmp, file)
}

/**
 * 记录一个由工具新建的文件。
 *
 * 调用方负责判断"确实是新建"（写入前不存在）；这里只做临时文件过滤与去重。
 * 非临时文件直接忽略，不会占任何存储。
 */
export async function record(input: {
  sessionID: string
  worktree: string
  file: string
  tool: string
}): Promise<TempFile | undefined> {
  const absolute = path.resolve(input.file)
  const relative = path.relative(input.worktree, absolute)
  if (!isTemporaryPath(relative)) return undefined

  let stat
  try {
    stat = await fs.stat(absolute)
  } catch {
    return undefined
  }
  if (!stat.isFile()) return undefined

  const content = await fs.readFile(absolute).catch(() => undefined)
  if (!content) return undefined

  const state = await readState(input.sessionID)
  const entry: TempFile = {
    path: absolute,
    relative,
    tool: input.tool,
    createdAt: Date.now(),
    hash: contentHash(content),
    size: stat.size,
  }
  const files = [...state.files.filter((item) => item.path !== absolute), entry]
  await writeState({ sessionID: input.sessionID, files })
  return entry
}

export async function list(sessionID: string): Promise<TempFile[]> {
  const state = await readState(sessionID)
  return state.files.slice().sort((a, b) => a.createdAt - b.createdAt)
}

/**
 * 清理。
 *
 * - `auto=true`：只删"创建超过 30 秒且内容未变"的文件（会话空闲时调用）
 * - 手动清理允许删刚创建的文件，但内容被改过的仍然跳过（除非 force）
 */
export async function clean(input: {
  sessionID: string
  worktree: string
  paths?: string[]
  auto?: boolean
  force?: boolean
}): Promise<CleanResult> {
  const state = await readState(input.sessionID)
  const wanted = input.paths ? new Set(input.paths.map((item) => path.resolve(item))) : undefined
  const removed: string[] = []
  const skipped: Array<{ path: string; reason: string }> = []
  const keep: TempFile[] = []
  // 删除后顺手清理空目录（只清理工作区内的临时目录）。
  const directories = new Set<string>()

  for (const entry of state.files) {
    if (wanted && !wanted.has(entry.path)) {
      keep.push(entry)
      continue
    }
    const relative = path.relative(input.worktree, entry.path)
    if (!isTemporaryPath(relative)) {
      skipped.push({ path: entry.relative, reason: "not-temporary" })
      continue
    }
    if (input.auto && Date.now() - entry.createdAt < MIN_AGE_MS) {
      keep.push(entry)
      continue
    }
    const current = await fs.readFile(entry.path).catch(() => undefined)
    if (!current) continue // 已经不存在：从清单移除即可
    if (!input.force && contentHash(current) !== entry.hash) {
      skipped.push({ path: entry.relative, reason: "modified" })
      keep.push(entry)
      continue
    }
    try {
      await fs.rm(entry.path, { force: true })
      removed.push(entry.relative)
      directories.add(path.dirname(entry.path))
    } catch (error) {
      skipped.push({ path: entry.relative, reason: error instanceof Error ? error.message : String(error) })
      keep.push(entry)
    }
  }

  // 只删空目录，且必须在工作区内。
  for (const directory of directories) {
    const relative = path.relative(input.worktree, directory)
    if (!relative || relative.startsWith("..")) continue
    await fs.rmdir(directory).catch(() => undefined)
  }

  await writeState({ sessionID: input.sessionID, files: keep })
  return { removed, skipped }
}

/** 会话结束时自动清理；失败不影响主流程。 */
export async function autoClean(sessionID: string, worktree: string): Promise<CleanResult | undefined> {
  if (!ID.test(sessionID)) return
  const entries = await list(sessionID)
  if (entries.length === 0) return
  return clean({ sessionID, worktree, auto: true }).catch(() => undefined)
}

/** 会话被删除时丢弃清单（文件本身由用户决定是否保留）。 */
export async function forget(sessionID: string) {
  if (!ID.test(sessionID)) return
  await fs.rm(stateFile(sessionID), { force: true }).catch(() => undefined)
}

export * as TempFiles from "./temp-files"
