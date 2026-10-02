import { displayWidth, truncateToWidth } from "./locale"

export function webSearchProviderLabel(provider: unknown) {
  if (provider === "parallel") return "Parallel Web Search"
  if (provider === "exa") return "Exa Web Search"
  return "Web Search"
}

export function toolDisplayMetadata(state: unknown): Record<string, unknown> {
  if (!state || typeof state !== "object" || Array.isArray(state)) return {}
  if (!("status" in state) || state.status === "pending") return {}
  if (!("structured" in state) || !state.structured || typeof state.structured !== "object") return {}
  if (Array.isArray(state.structured)) return {}
  return state.structured as Record<string, unknown>
}

// ---------- 工具卡 head 行的状态摘要 ----------

/** 工具输出里统计出来的测试计数。 */
export interface ToolStatusSummary {
  passed: number
  failed: number
}

/**
 * 通过 / 失败计数。原型那句 `12 passed · 0 failed` 是 jest 的写法,而本仓库自己的
 * `bun test` 打印的是 ` 12 pass` / ` 1 fail`(bun 1.3 实测),vitest 是
 * `Tests  1 failed | 11 passed (12)`,pytest 是 `1 failed, 1 passed in 0.12s`。
 * 两种拼写都要认:只认原型那一种的话,绝大多数工具输出命中不了 —— 而这张摘要存在的
 * 唯一场景就是「工具跑的是测试」。
 *
 * 词尾的 `\b` 不是装饰:`\d+\s+pass\b` 不会命中 `1 password` / `2 passing`,
 * `\d+\s+fail\b` 不会命中 `3 failover`。
 */
const PASSED = /\b(\d+)\s+pass(?:ed)?\b/i
const FAILED = /\b(\d+)\s+fail(?:ed)?\b/i
/**
 * 兜底计数:有些运行器(vitest 的 stderr 段、pytest 的 ERROR 段)只报 error 数。
 * 它**只**用来把 failed 顶高,自己不足以让摘要出现 —— 否则任何含 `3 errors` 的输出
 * (编译日志、LSP 诊断、被 grep 到的日志)都会凭空长出一个「0 通过」的状态摘要,
 * 那比不显示更糟:用户会以为这条命令跑了测试。
 */
const ERRORS = /\b(\d+)\s+errors?\b/i

/**
 * 从工具输出里解析出测试结果;**没解析到就返回 undefined**,由调用方整项省略。
 *
 * 刻意不返回「0 passed / 0 failed」这种默认值:`✓ 0 passed` 是一条假信息,而摘要的唯一
 * 价值就是「这条命令的结论」。所以只有 pass / fail 至少命中一个才给摘要。
 *
 * 命中第一个就够:同一段输出里 bun 会打 ` 12 pass` 也可能再打一句 `Ran 12 tests`,
 * 后者不含 pass/fail 词,不会干扰;而重复的 pass 行(流式输出被重放)取第一个仍然是同一个数。
 *
 * 调用方负责先 stripAnsi 再传进来 —— 带色码时数字与单词之间可能插进转义序列。
 */
export function toolStatusSummary(output: string | undefined): ToolStatusSummary | undefined {
  const passed = output?.match(PASSED)?.[1]
  const failed = output?.match(FAILED)?.[1]
  if (passed === undefined && failed === undefined) return undefined
  return {
    passed: passed === undefined ? 0 : Number(passed),
    failed: Math.max(failed === undefined ? 0 : Number(failed), Number(output?.match(ERRORS)?.[1] ?? 0)),
  }
}

/** 成功色那一段:`✓ 12 passed`(原型 `.status .ok`)。 */
export function toolStatusPassedText(summary: ToolStatusSummary) {
  return `✓ ${summary.passed} passed`
}

/**
 * 失败色那一段:`· 2 failed`;没有失败时是空串。
 * 原型把 `· 0 failed` 也画出来,但「零失败」不是信息 —— `✓ 12 passed` 已经把话说完了,
 * 再挂一个红色的 `0 failed` 只会让人多扫一眼。
 */
export function toolStatusFailedText(summary: ToolStatusSummary) {
  return summary.failed > 0 ? `· ${summary.failed} failed` : ""
}

/** head 行里相邻两段之间的 1 列分隔(原型 `.tool-head { gap: 9px }` 的终端等价)。 */
const HEAD_GAP = 1

export interface ToolHeadLayout {
  /** 已按显示列截断的标题;空串 = 这一行不画标题。 */
  title: string
  /** 已按显示列截断的通过段(success 色);空串 = 这一行不画摘要。 */
  passed: string
  /** 已按显示列截断的失败段(error 色);空串 = 没有失败,或宽度不够只剩通过段。 */
  failed: string
}

/**
 * 工具卡 head 行在 `width` 列里怎么摆下标题与状态摘要。纯函数,渲染层只按它摆。
 *
 * **为什么摘要优先于标题**:摘要是这一行里唯一带「结论」的一段(命令跑完怎么样),
 * 而标题在卡片的正文里还会以别的形式再出现一次(命令原文就在下一行的 `$ …` 里)。
 * 宽度不够时先牺牲标题 —— 窄终端下留一句「✓ 12 passed」比留半句路径有用得多。
 *
 * **为什么必须自己截**:`<text>` 的默认 wrapMode 是 `"none"`,超宽的行不会被折到下一行,
 * 而是被渲染器从右边直接切掉 —— 切掉多少看不见,于是「摘要不见了」和「摘要在那儿」长得一样。
 * 显式按列截断至少让它留一个 `…`,让人知道右边还有东西。
 *
 * 三段之间的 1 列分隔不额外扣两次:失败段自带前导 `· `,那 1 列就是它与通过段之间的分隔。
 */
export function toolHeadLayout(input: { title?: string; summary?: ToolStatusSummary; width: number }): ToolHeadLayout {
  const summary = input.summary
  const passed = summary ? truncateToWidth(toolStatusPassedText(summary), input.width) : ""
  const failed =
    summary && passed ? truncateToWidth(toolStatusFailedText(summary), input.width - displayWidth(passed)) : ""
  // 让给摘要的列:两段摘要各自的宽度,加上通过段与失败段之间的 1 列分隔。
  const summaryColumns = displayWidth(passed) + displayWidth(failed) + (passed && failed ? HEAD_GAP : 0)
  // 标题与通过段之间的 1 列分隔 —— 只在标题真的存在时才扣,否则那列会白留在行尾。
  const titleGap = passed && input.title ? HEAD_GAP : 0
  return {
    title: truncateToWidth(input.title ?? "", input.width - summaryColumns - titleGap),
    passed,
    failed,
  }
}
