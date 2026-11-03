// 「只打改动」的揭示：文件预览跟写时的打字机**只作用于新增的行**。
//
// 之前是把整篇新内容当成一条要逐字打出来的字符串（前缀增长）：未改动的行也
// 得跟着一个字一个字冒出来，而且打到一半时后面的内容全都还没出现 —— 在对照视图
// 里就是一大片"被删掉"的红块，用户看到的是"最底下一直在跳"。
//
// 这里改成按**这一笔写盘前后**的内容差定位新增行：未改动的行原样显示，
// 只有真正新写的行按预算逐字揭示。
//
// 为什么不用补丁（vcs 的 patch）：那份补丁是"相对 HEAD 的累计改动"。随着任务
// 推进，里面的新增行会越积越多，每次写盘都按它从头打一遍 —— 界面上就是整块
// 内容先消失再长回来，一直在闪。用前后两版内容的差异，才是"这一笔新写了什么"。

import { diffArrays } from "diff"

/** 相对上一版内容，`next` 里有哪些行是新写的（0 基，按新文件顺序）。 */
export function newLineIndexes(previous: string, next: string): number[] {
  if (previous === next) return []
  let parts
  try {
    // 按"行数组"比较而不是按文本比较：文本 diff 会被末尾换行/合并段影响，
    // 把未改动的行也判成新增（于是整块都在打）。
    parts = diffArrays(previous.split("\n"), next.split("\n"))
  } catch {
    return []
  }
  const result: number[] = []
  let line = 0
  for (const part of parts) {
    const count = part.count ?? 0
    if (part.removed) continue
    if (part.added) {
      for (let index = 0; index < count; index++) result.push(line + index)
      line += count
      continue
    }
    line += count
  }
  return result
}

/** 新增行一共多少字符（打字机的总预算）。 */
export function addedCharCount(after: string, added: readonly number[]) {
  const lines = after.split("\n")
  let total = 0
  for (const index of added) total += lines[index]?.length ?? 0
  return total
}

/**
 * 按预算揭示新增行，其余行原样保留。
 *
 * `revealed` 是已经打出来的新增字符数：还没轮到的新增行先显示成空行（占位），
 * 正在打的那一行给前缀。**不能直接把这些行删掉**：行数一变，下面的内容就会
 * 整体上移/下移，每打一行跳一下；保留空行则版面稳定，只有文字在长出来。
 */
export function revealAdded(after: string, added: readonly number[], revealed: number) {
  if (added.length === 0) return after
  const lines = after.split("\n")
  const targets = new Set(added)
  let budget = Math.max(0, revealed)
  const out: string[] = []
  for (let index = 0; index < lines.length; index++) {
    const text = lines[index] ?? ""
    if (!targets.has(index)) {
      out.push(text)
      continue
    }
    if (budget <= 0) {
      out.push("")
      continue
    }
    if (budget >= text.length) {
      out.push(text)
      budget -= text.length
      continue
    }
    out.push(text.slice(0, budget))
    budget = 0
  }
  return out.join("\n")
}
