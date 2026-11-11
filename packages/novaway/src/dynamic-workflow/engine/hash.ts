/**
 * 输入指纹。
 *
 * 恢复时要回答的问题是：「这个实例，这一轮拿到的输入，和第一次生命里那一轮是不是同一个？」
 * 不是的话就不能拿缓存答案顶上去——子代理当时回答的是另一个问题，缓存会张冠李戴。
 *
 * 用 FNV-1a 32 位：够短（8 个十六进制字符，能塞进日志行而不喧宾夺主）、够快（无需 crypto、
 * 无需异步）、对「同一份 JSON 序列化结果」是确定的。它不是密码学哈希，也不需要是——指纹只防
 * 手滑，不防攻击者。
 */

/** 把字符串哈希成 8 位十六进制。 */
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    // 乘 16777619，用移位避免超过 32 位精度。
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0
  }
  return hash.toString(16).padStart(8, "0")
}

/**
 * 规范化 JSON：对象键按字典序排列。
 *
 * 不这样做的话，`{a:1,b:2}` 与 `{b:2,a:1}` 会得到不同指纹——而它们在语义上是同一个输入。
 * 脚本里同一处调用两次的参数顺序由作者代码决定，通常是稳定的；但 `world.run` 的 opts 可能由
 * 展开语法拼出来，键序不保证。排序一劳永逸。
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const sorted: Record<string, unknown> = {}
      for (const key of Object.keys(item as Record<string, unknown>).sort()) {
        sorted[key] = (item as Record<string, unknown>)[key]
      }
      return sorted
    }
    return item
  })
}

/** 输入指纹：规范化 JSON 之后取 FNV-1a。 */
export function inputHash(value: unknown): string {
  return fnv1a(canonicalJson(value))
}
