/**
 * 把一次 run 的结果渲染成给模型看的文本。
 *
 * 这一层存在的原因是：工具的输出就是模型的输入。引擎的记录是结构化的，但模型需要的是
 * 「发生了什么、结论是什么、还有什么没覆盖」。中间这一步做得好，模型就不用再去翻节点表。
 *
 * 三条取舍：
 *   - **先结论**。结算值与失败原因放在最前面；模型最常需要的就是它。
 *   - **报告给摘要不给全文**。一条报告可能很大，全部铺开只会挤掉别的上下文。
 *   - **用量与节点数照实说**。用户会问「这次花了多少」，模型得能答上来。
 */

import type { Settlement } from "./engine/types"
import type { RunEntry } from "./runtime/registry"

/** 摘要里最多列几条报告。 */
const REPORT_LIMIT = 8
/** 单条报告渲染出来的最大字符数。 */
const REPORT_CHARS = 600
/** 结算值的最大字符数。 */
const RESULT_CHARS = 2000

function clip(text: string, limit: number): string {
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}…（共 ${text.length} 字符，已截断）`
}

function preview(value: unknown): string {
  if (value === undefined) return "（无）"
  try {
    return clip(JSON.stringify(value) ?? "（无法序列化）", RESULT_CHARS)
  } catch {
    return clip(String(value), RESULT_CHARS)
  }
}

function usageLine(settlement: Settlement): string {
  const tokens = settlement.spentTokens
  return tokens > 0 ? `用量：约 ${tokens} tokens` : "用量：未记录"
}

/** 一次 run 的完整摘要。`create_workflow` 与 `get_workflow_run` 共用。 */
export function renderRun(entry: RunEntry, settlement: Settlement | undefined): string {
  const lines: string[] = []
  const status = settlement?.status ?? "running"
  lines.push(`run ${entry.runId}${entry.name ? `（${entry.name}）` : ""}：${status}`)

  if (settlement?.status === "completed") {
    lines.push(`结果：${preview(settlement.value)}`)
  } else if (settlement?.status === "errored") {
    lines.push(`失败：${settlement.error.name}: ${settlement.error.message}`)
    if (settlement.error.code) lines.push(`错误码：${settlement.error.code}`)
  } else if (settlement?.status === "stopped") {
    const reason = {
      user: "用户停止",
      model: "主代理停止",
      provider: "模型服务中断（修好原因后可以恢复）",
      interrupted: "宿主中断（可恢复）",
    }[settlement.reason]
    lines.push(`停止原因：${reason}`)
    if (settlement.error) lines.push(`附带信息：${settlement.error.message}`)
  }

  if (settlement) lines.push(usageLine(settlement))
  if (entry.phaseNames.length > 0) lines.push(`阶段：${entry.phaseNames.join(" → ")}`)

  if (entry.reports.length > 0) {
    const shown = entry.reports.slice(0, REPORT_LIMIT)
    lines.push(`报告（共 ${entry.reports.length} 条，显示前 ${shown.length} 条）：`)
    for (const item of shown) lines.push(`- ${clip(preview(item), REPORT_CHARS)}`)
    if (entry.reports.length > shown.length) lines.push(`…还有 ${entry.reports.length - shown.length} 条`)
  }

  return lines.join("\n")
}

/** 列表页的一行。 */
export function renderRow(entry: RunEntry): string {
  const status = entry.settlement?.status ?? "running"
  const label = entry.name ? `${entry.name} ` : ""
  const tokens = entry.settlement?.spentTokens
  return `${entry.runId}  ${label}[${status}]${tokens ? ` ${tokens} tokens` : ""}`
}

/**
 * 从 journal 头部还原一次 run 的摘要。
 *
 * 与 {@link renderRun} 的差别只在数据来源：那个用的是进程内登记表（有报告、有阶段），
 * 这个用的是库里的一行（报告要看节点表，阶段可以从事件里重建）。跨进程查询走这条。
 */
export function renderStoredRun(header: {
  readonly runId: string
  readonly name?: string
  readonly status: string
  readonly stopReason?: string
  readonly spentTokens: number
  readonly result?: unknown
  readonly failure?: unknown
}): string {
  const lines = [`run ${header.runId}${header.name ? `（${header.name}）` : ""}：${header.status}`]
  if (header.status === "completed") lines.push(`结果：${preview(header.result)}`)
  if (header.status === "errored") {
    const failure = (header.failure ?? {}) as { name?: string; message?: string }
    lines.push(`失败：${failure.name ?? "Error"}: ${failure.message ?? "（没有留下原因）"}`)
  }
  if (header.status === "stopped") {
    const reason = {
      user: "用户停止",
      model: "主代理停止",
      provider: "模型服务中断（修好原因后可以恢复）",
      interrupted: "宿主中断（可恢复）",
    }[header.stopReason ?? "interrupted"]!
    lines.push(`停止原因：${reason}`)
  }
  lines.push(header.spentTokens > 0 ? `用量：约 ${header.spentTokens} tokens` : "用量：未记录")
  return lines.join("\n")
}
