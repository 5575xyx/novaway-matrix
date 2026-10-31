import { redactSecrets } from "@/browser/redact"

/**
 * 证据脱敏（§11.3）。
 *
 * 验证器写回来的 `measured` / `evidenceRef` 是模型原样输出的文本，里面可能带着
 * 带凭据的 URL、命令里的 token、`Authorization:` 头。这些内容会被落库、进打回意见、
 * 显示在看板上 —— 按既有约束（命令与 URL 一律不得原样展示）必须在**入库前**处理，
 * 而不是指望界面自己小心。
 *
 * 规则：
 *
 * 1. 文本里的 URL 保留协议 + 主机 + 路径，**查询串与凭据段一律替换**（§11.3 原文
 *    「URL 保存 host + path 模板；query 与凭据段替换为 ***」）—— 不猜哪个参数敏感，
 *    因为签名参数的名字永远列不全；
 * 2. 其余文本按秘密模式打码（Bearer / Basic / JWT / 常见厂商 key / `password=…` 之类赋值），
 *    与浏览器侧共用同一份（`src/browser/redact.ts`）。
 *
 * 只存脱敏后的文本：原始秘密永不落库。因此界面不需要「查看原始」这个
 * 会把秘密重新铺开的入口。
 */

/** 文本里内嵌的 URL：带协议即可，结尾常见标点不吞进来。 */
const URL_IN_TEXT = /\b(?:https?|ftp):\/\/[^\s"'<>`]+/g

/** URL → 模板：协议 + 主机 + 路径保留，查询串、凭据段、锚点一律打码。 */
function template(raw: string): string {
  try {
    const url = new URL(raw)
    if (url.username) url.username = "***"
    if (url.password) url.password = "***"
    for (const key of [...url.searchParams.keys()]) url.searchParams.set(key, "***")
    if (url.hash) url.hash = "***"
    return url.toString()
  } catch {
    return redactSecrets(raw)
  }
}

export function sanitizeEvidence(text: string): string {
  return redactSecrets(text.replace(URL_IN_TEXT, (url) => template(url)))
}

export const sanitizeOptional = (text: string | undefined): string | undefined =>
  text === undefined ? undefined : sanitizeEvidence(text)

