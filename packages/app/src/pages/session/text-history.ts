/**
 * 文本编辑器的撤销历史（按文件路径分开）。
 *
 * 浏览器 textarea 自带撤销，但组件一卸载（切标签、切文件）栈就没了 ——
 * 「切走再切回来，撤销历史还在」在原生 textarea 上做不到。
 * 这里在内存里按路径记快照：切回来时把这一篇的历史接上，撤销仍然能一路退回去。
 *
 * 只记「有变化」的步骤；连续打字在 COALESCE_MS 内合并成一步，
 * 和编辑器的打字撤销手感一致（一次撤销退掉一小段，而不是一个字）。
 * 历史只活在当前会话里，不落盘：崩溃恢复靠的是草稿，不是撤销栈。
 */

export type TextSnapshot = {
  text: string
  /** 选区锚点（0 起字符偏移）。 */
  anchor: number
  /** 选区终点；和 anchor 相等就是光标。 */
  head: number
}

type Entry = TextSnapshot & { at: number; kind: "typing" | "command" }
type Slot = { undo: Entry[]; redo: Entry[] }

/** 每个文件最多记多少步，防止大文件把内存吃满。 */
const LIMIT = 200
/** 这一段时间内的连续输入合并成一步撤销。 */
const COALESCE_MS = 600

const slots = new Map<string, Slot>()

function slotOf(path: string): Slot {
  const found = slots.get(path)
  if (found) return found
  const created: Slot = { undo: [], redo: [] }
  slots.set(path, created)
  return created
}

/**
 * 记一步变更：把「变更前」压进撤销栈，清空重做栈。
 * 连续的输入（kind = "typing"）在时间窗口内合并，避免一次撤销只退一个字。
 */
export function recordTextChange(
  path: string,
  before: TextSnapshot,
  after: TextSnapshot,
  kind: "typing" | "command" = "command",
  now = Date.now(),
): void {
  if (before.text === after.text) return
  const slot = slotOf(path)
  const last = slot.undo[slot.undo.length - 1]
  const merge = kind === "typing" && last?.kind === "typing" && now - last.at <= COALESCE_MS
  if (!merge) {
    slot.undo.push({ ...before, at: now, kind })
    if (slot.undo.length > LIMIT) slot.undo.shift()
  } else {
    // 合并时只延后时间戳，快照仍是这段输入开始前的样子。
    last!.at = now
  }
  slot.redo = []
}

/** 撤销：返回要恢复的快照，并把当前状态压进重做栈。 */
export function undoText(path: string, current: TextSnapshot, now = Date.now()): TextSnapshot | undefined {
  const slot = slotOf(path)
  const entry = slot.undo.pop()
  if (!entry) return undefined
  slot.redo.push({ ...current, at: now, kind: "command" })
  return { text: entry.text, anchor: entry.anchor, head: entry.head }
}

/** 重做：和撤销对称。 */
export function redoText(path: string, current: TextSnapshot, now = Date.now()): TextSnapshot | undefined {
  const slot = slotOf(path)
  const entry = slot.redo.pop()
  if (!entry) return undefined
  slot.undo.push({ ...current, at: now, kind: "command" })
  return { text: entry.text, anchor: entry.anchor, head: entry.head }
}

export function canUndoText(path: string): boolean {
  return (slots.get(path)?.undo.length ?? 0) > 0
}

export function canRedoText(path: string): boolean {
  return (slots.get(path)?.redo.length ?? 0) > 0
}

/** 关闭标签时调用：这个文件不再有编辑器实例，历史一起丢掉。 */
export function forgetTextHistory(path: string): void {
  slots.delete(path)
}

export function resetTextHistory(): void {
  slots.clear()
}
