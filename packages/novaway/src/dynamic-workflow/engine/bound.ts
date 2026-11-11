/**
 * 单条记录的**有界化**。
 *
 * journal 不是日志文件：它的每一行日后都要被读回来，所以不能出现「半截 JSON」。
 * 超限或不可序列化时换成一个说明对象，比截断字符串安全——至少读的人知道这里少了东西，
 * 而不会以为结果本身长这样。
 *
 * 内存与 SQLite 两个实现共用这一份，尺寸上限也因此只有一处可调。
 */

/** 默认上限：64 KiB。脚本的一次 ask 结果通常远小于它；超过的多半是作者把整个文件塞进了 report。 */
export const DEFAULT_MAX_RECORD_BYTES = 64 * 1024

export function boundRecord(value: unknown, maxBytes: number = DEFAULT_MAX_RECORD_BYTES): unknown {
  try {
    const text = JSON.stringify(value)
    if (text !== undefined && Buffer.byteLength(text, "utf8") <= maxBytes) return value
  } catch {
    return { truncated: true, reason: "无法序列化为 JSON" }
  }
  return { truncated: true, reason: `超过 ${maxBytes} 字节` }
}

/** 有界化之后的 JSON 文本。`undefined` 表示「没有这个值」，调用方据此写 NULL。 */
export function boundJson(value: unknown, maxBytes: number = DEFAULT_MAX_RECORD_BYTES): string | undefined {
  if (value === undefined) return undefined
  return JSON.stringify(boundRecord(value, maxBytes))
}
