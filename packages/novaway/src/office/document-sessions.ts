/**
 * 按路径复用的文档编辑会话（宿主侧的撤销栈）。
 *
 * **撤销栈属于宿主，不属于编辑器**。
 * 每次编辑打开一个 `DocumentSession`（字节快照 + 版本号），把会话按路径缓存起来，
 * 于是用户能撤销 AI 刚做的修改，AI 也能接在用户的操作之后继续改，
 * 两边共享同一条历史，而不是各改各的。
 *
 * 缓存只在「磁盘字节和会话里的字节一致」时复用；文件被外部程序改过
 * （Excel / Word 另存），字节对不上就重建会话 —— 历史随之重置，
 * 不会把旧快照盖回新文件上。同一路径的编辑用 `PathLocks` 串行化。
 */
import { createHash } from "node:crypto"
import { readFile, rename, writeFile } from "fs/promises"
import type { OfficeEngine, OfficeFormat, OfficeOp, OfficeResult } from "@novaway/core/office/engine/contract"
import { fail, ok } from "@novaway/core/office/engine/contract"
import { engineFor } from "@novaway/core/office/engine/registry"
import { DocumentSession, PathLocks } from "@novaway/core/office/engine/session"
import { runtimeEngineFor, type RuntimeOfficeRegistry } from "./runtime"

export type DocumentHistory = {
  canUndo: boolean
  canRedo: boolean
  undoLabel?: string
  redoLabel?: string
}

export type DocumentEditOutcome = {
  bytes: Uint8Array
  /** 被重写的包内条目；文本类文档是 ["html"] / ["text"]。 */
  changed: string[]
  applied: unknown[]
  history: DocumentHistory
}

export type DocumentUndoOutcome = {
  bytes: Uint8Array
  label?: string
  history: DocumentHistory
}

type Entry = {
  session: DocumentSession<unknown>
  format: OfficeFormat
  /** 会话当前字节；写盘后同步，下次用它判断缓存是否还对得上磁盘。 */
  bytes: Uint8Array
}

/** 只缓存少量最近用过的文档：撤销是「刚才那几下」，不是无穷历史。 */
const MAX_SESSIONS = 8
const entries = new Map<string, Entry>()
const locks = new PathLocks()

export function historyOf(session: DocumentSession<unknown>): DocumentHistory {
  return {
    canUndo: session.canUndo,
    canRedo: session.canRedo,
    ...(session.undoLabel ? { undoLabel: session.undoLabel } : {}),
    ...(session.redoLabel ? { redoLabel: session.redoLabel } : {}),
  }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left === right) return true
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return false
  return true
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function remember(absolute: string, entry: Entry): void {
  // Map 的插入顺序就是 LRU 顺序：重新 set 一下把这条挪到队尾。
  entries.delete(absolute)
  entries.set(absolute, entry)
  while (entries.size > MAX_SESSIONS) {
    const oldest = entries.keys().next().value
    if (oldest === undefined) break
    entries.delete(oldest)
  }
}

async function writeAtomic(absolute: string, bytes: Uint8Array): Promise<void> {
  // 用户可能正开着这份文件：先写临时文件再 rename，读到的永远是完整版本。
  const temp = `${absolute}.novaway-edit-${Date.now()}`
  await writeFile(temp, bytes)
  await rename(temp, absolute)
}

async function loadSession(
  absolute: string,
  format: OfficeFormat,
  options: { password?: string; registry?: RuntimeOfficeRegistry } = {},
): Promise<OfficeResult<{ entry: Entry; reused: boolean }>> {
  const bytes = new Uint8Array(await readFile(absolute))
  const cached = entries.get(absolute)
  if (cached && cached.format === format && sameBytes(cached.bytes, bytes)) {
    remember(absolute, cached)
    return ok({ entry: cached, reused: true })
  }

  const engine = runtimeEngineFor(format, options.registry) ?? (engineFor(format) as OfficeEngine<unknown> | undefined)
  if (!engine) return fail("unsupported_format", "暂不支持 " + format + " 文件")
  const opened = await DocumentSession.open(engine, bytes, { path: absolute, ...options })
  if (!opened.ok) return opened
  const entry: Entry = { session: opened.data, format, bytes }
  remember(absolute, entry)
  return ok({ entry, reused: false })
}

/**
 * 应用一批操作并写回文件。
 * 全有或全无：引擎失败时不写盘，也不动会话状态。
 */
export async function editDocumentFile(
  absolute: string,
  format: OfficeFormat,
  ops: readonly OfficeOp[],
  options: { password?: string; registry?: RuntimeOfficeRegistry } = {},
): Promise<OfficeResult<DocumentEditOutcome>> {
  if (ops.length === 0) return fail("invalid_params", "没有要执行的操作")
  return locks.run(absolute, async () => {
    const loaded = await loadSession(absolute, format, options)
    if (!loaded.ok) return loaded
    const { entry } = loaded.data
    const session = entry.session

    const applied = await session.apply(ops, "文档编辑")
    if (!applied.ok) return applied

    // 先取版本号再写盘：写盘期间又有修改时，markSaved 不会把新改动标成已保存。
    const revision = session.saveRevision()
    await writeAtomic(absolute, applied.data.bytes)
    session.markSaved(revision)
    entry.bytes = session.bytes

    return ok({
      bytes: applied.data.bytes,
      changed: applied.data.changed,
      applied: applied.data.applied,
      history: historyOf(session),
    })
  })
}

/**
 * 记录一次「引擎之外算好字节」的修改并写回（PPTX 的画布编辑走这条路）。
 *
 * 撤销栈仍然是宿主这一条：记完之后 `undoDocumentFile` / 面板上的撤销按钮
 * 对它一样有效，切标签也不会丢。
 */
export async function recordDocumentWrite(
  absolute: string,
  format: OfficeFormat,
  previous: Uint8Array,
  next: Uint8Array,
  label: string,
  expectedBaselineSha256?: string,
  options: { registry?: RuntimeOfficeRegistry } = {},
): Promise<OfficeResult<DocumentEditOutcome>> {
  return locks.run(absolute, async () => {
    let current = previous
    if (expectedBaselineSha256) {
      if (!/^[0-9a-f]{64}$/i.test(expectedBaselineSha256)) {
        return fail("invalid_params", "保存版本摘要格式不正确")
      }
      current = new Uint8Array(await readFile(absolute))
      if (sha256(current) !== expectedBaselineSha256.toLowerCase()) {
        return fail("conflict", "文件在确认保存后又被外部修改", "重新读取文件并确认覆盖后再保存")
      }
    }

    const loaded = await loadSession(absolute, format, options)
    if (!loaded.ok) return loaded
    const { entry } = loaded.data
    const session = entry.session

    const recorded = await session.recordExternal(current, next, label)
    if (!recorded.ok) return recorded

    // 二次校验缩小外部进程在首次读取后、原子替换前写入的竞态窗口。
    // Windows/POSIX 都没有可移植的「仅当目标仍是指定内容时 rename」原语，
    // 因此这是 best-effort CAS；同进程服务端写入则由 PathLocks 完全串行化。
    if (expectedBaselineSha256) {
      const latest = new Uint8Array(await readFile(absolute))
      if (sha256(latest) !== expectedBaselineSha256.toLowerCase() || !sameBytes(latest, current)) {
        entries.delete(absolute)
        return fail("conflict", "文件在保存期间又被外部修改", "重新读取文件并确认覆盖后再保存")
      }
    }

    // 和 editDocumentFile 一样：先取版本号再写盘，避免把并发修改标成已保存。
    const revision = session.saveRevision()
    await writeAtomic(absolute, session.bytes)
    session.markSaved(revision)
    entry.bytes = session.bytes

    return ok({
      bytes: session.bytes,
      changed: [],
      applied: [],
      history: historyOf(session),
    })
  })
}

/** 撤销一步并写回；没有历史时返回可读错误。 */
export async function undoDocumentFile(
  absolute: string,
  format: OfficeFormat,
  options: { registry?: RuntimeOfficeRegistry } = {},
): Promise<OfficeResult<DocumentUndoOutcome>> {
  return locks.run(absolute, async () => {
    const loaded = await loadSession(absolute, format, options)
    if (!loaded.ok) return loaded
    const { entry } = loaded.data
    const session = entry.session

    const step = session.undo()
    if (!step.ok) return step

    const revision = session.saveRevision()
    await writeAtomic(absolute, session.bytes)
    session.markSaved(revision)
    entry.bytes = session.bytes
    return ok({ bytes: session.bytes, label: step.data.label, history: historyOf(session) })
  })
}

/** 重做一步并写回。 */
export async function redoDocumentFile(
  absolute: string,
  format: OfficeFormat,
  options: { registry?: RuntimeOfficeRegistry } = {},
): Promise<OfficeResult<DocumentUndoOutcome>> {
  return locks.run(absolute, async () => {
    const loaded = await loadSession(absolute, format, options)
    if (!loaded.ok) return loaded
    const { entry } = loaded.data
    const session = entry.session

    const step = session.redo()
    if (!step.ok) return step

    const revision = session.saveRevision()
    await writeAtomic(absolute, session.bytes)
    session.markSaved(revision)
    entry.bytes = session.bytes
    return ok({ bytes: session.bytes, label: step.data.label, history: historyOf(session) })
  })
}

/** 只读历史状态（面板上「撤销 / 重做」按钮是否可用）。 */
export async function documentHistory(
  absolute: string,
  format: OfficeFormat,
  options: { registry?: RuntimeOfficeRegistry } = {},
): Promise<OfficeResult<DocumentHistory>> {
  try {
    const loaded = await loadSession(absolute, format, options)
    if (!loaded.ok) return loaded
    return ok(historyOf(loaded.data.entry.session))
  } catch {
    // 文件不存在 / 读不了：没有历史，不算错误（面板刚切走时会走到这里）。
    return ok({ canUndo: false, canRedo: false })
  }
}
