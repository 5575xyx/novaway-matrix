import path from "node:path"
import { LANGUAGE_EXTENSIONS } from "../../util/filetype"
import { truncateMiddleToWidth } from "../../util/locale"
import { messageColumns } from "./message-anchor"

/*
 * 「分析中」那一行的标题(原型 card-design-v7.html:948 的 `.th-row`):
 * `✦ 分析 <目标> <动词>`,右边对齐一个已用时长。
 *
 * **目标与动词都从真实数据里取,取不到就不画那一段。** 原型那一行里的目标是
 * `session/index.tsx`(文件路径)、动词是 `布局` —— 两者都不是协议里能拿到的字段,
 * 所以不能照抄。这里从**最后一个 part** 上取,来源只有两处,可靠性从高到低:
 *
 *   1. **在飞的工具调用的输入路径** —— `pending` / `running` 的工具 part 的
 *      `filePath` / `path`。这是结构化数据,就是它接下来真要读或写的那个文件,
 *      比从散文里猜可靠得多。
 *   2. **最新那块推理正文里提到的路径**,再退到**符号**(`a.b` 成员 / `foo()` 调用 /
 *      驼峰标识符)。推理正文是模型自己写的,里面提到的路径/符号就是它在想的东西。
 *
 * 两处都没有 → 目标整段省略。**不拿别的东西凑**:猜出来的目标是一句假信息,而这一行
 * 存在的全部价值就是「它在看什么」;与其给一个认不出的字符串,不如只留 `✦ 分析` 与计时。
 *
 * 动词反过来:它由「这一步是哪种 part」直接决定(三种 part 三种动词),不需要猜。
 *
 * 这一层是纯函数(不碰渲染),所以判定规则与列预算都能脱开组件直接单测。
 */

/** 这一步的种类:由 part 的 `type` 判定 —— part 本身就是真数据。 */
export type WorkingStepKind = "reasoning" | "tool" | "text"

/** 三档穷举。part 的其余类型(step-start / step-finish / file …)不带正文也不带输入,
 *  不构成「一步」,所以判定不出种类时是 undefined 而不是随便挑一个词。 */
const STEP_VERBS: Record<WorkingStepKind, string> = {
  reasoning: "推理",
  tool: "执行",
  text: "作答",
}

/**
 * 只取判定标题要用的那几个字段。写成结构类型而不是 SDK 的 `Part`:
 * 纯函数不必把整个 SDK 类型树拖进来,而 SDK `Part` 联合里的每个成员都能 assignable
 * 到它(多出来的字段直接被忽略)。
 */
export type WorkingPart = {
  type: string
  text?: string
  state?: { status?: string; input?: Record<string, unknown> }
}

/** 标题行左侧那一段的排版结果。`target` 缺失 = 那一段不画。 */
export type WorkingStepTitle = {
  /** 动词;判定不出步骤种类时没有 —— 同样不拿别的词凑。 */
  verb?: string
  /** 目标(渲染时加粗/强调的那一段);判定不出时没有。 */
  target?: string
}

/** 这一行自己的缩进(`paddingLeft`)。标题行的列预算要把它先扣掉。 */
export const WORKING_LINE_INDENT = 2

/**
 * `✦ 分析 ` 的列数:`✦` 实测 1 列(`Bun.stringWidth("\u2726") === 1`,东宽歧义),
 * 两个汉字各 2 列,最后一个空格 1 列 → 1 + 1 + 4 + 1 = 7。
 */
const PREFIX_COLUMNS = 7

/**
 * 目标之外那些定长段的合计 —— 也就是目标能占的上限要从列预算里先扣掉多少:
 *   `✦ 分析 `(7) + 目标与动词之间的 1 列 + 动词(4,三个动词都是两个汉字)
 *   + 与计时之间至少 1 列弹性空隙(原型 `.th-row { gap: 12px }`)+ 计时(8)
 *   = 21。
 *
 * **计时为什么按最宽的一档 8 列预留**:`Locale.duration` 的输出有 `0ms`(3)、
 * `12.3s`(5)、`59m 59s`(8) 三档,列数会随这一轮跑了多久而变。按最宽预留换来的是
 * 「这一行在任何时刻都放得下」—— 计时右对齐,变宽时吃掉的只会是中间的弹性空隙,
 * 而左段(前缀 + 目标 + 动词)的列数从头到尾不变。按当前秒数现算预算的话,
 * 目标会随着计时长出数字而一格一格地变短,那是在动的那一行里最不该有的抖动。
 */
const FIXED_COLUMNS = PREFIX_COLUMNS + 1 + 4 + 1 + 8

/**
 * 目标低于这个列数就**整段不画**。截剩两三个字符的目标既认不出文件名也认不出扩展名,
 * 而画一个认不出的目标比不画更糟:用户会以为那就是它在看的东西。
 * 原型的气泡是固定 470px,终端这边只有列数,所以必须给目标一个下限而不是一路截。
 *
 * 截断用 `truncateMiddleToWidth` 而不是 `truncateToWidth`:目标九成是路径,而路径的
 * 两头都比中间重要 —— 头(`src/`、`packages/`)说明在哪个模块,尾(`queue-dock.tsx`)说明
 * 是哪个文件。尾截掉就只剩 `src/rou…` 那种认不出的碎片,而那恰恰是「它在看哪个文件」这条
 * 信息的全部。符号目标(`messageColumns`)走同一个函数也没有副作用:它多半整个放得下。
 */
const TARGET_MIN_COLUMNS = 8

/** 工具输入里「这次要动哪个东西」的字段,按可靠性排序。
 *  刻意**不含** `command` / `url` / `description`:一整条 shell 命令或一个网址不是
 *  「目标」,而且几乎必然长到只剩尾巴,截出来的那截是误导。 */
const TARGET_INPUT_FIELDS = ["filePath", "path"] as const

/**
 * 路径候选:带分隔符的一段,或一个「有扩展名」的裸文件名。
 * 命中之后还要过 `isPathToken` —— 形状像不代表是路径(`e.g`、`3.5s` 都像)。
 */
const PATH_TOKEN = /[\w@.~+-]+(?:[/\\][\w@.~+-]+)+|\b[\w@-]+\.[A-Za-z][\w]{0,7}\b/g

/** 符号候选。散文里不会出现这三种形状,所以命中即当代码符号:
 *   `foo()`   调用点 —— 形状唯一;
 *   `a.b`     成员访问 —— 每段至少 2 个字符,把 `e.g` / `i.e` 这类缩写挡在外面;
 *   `fooBar`  驼峰标识符 —— 小写起头且中间有大写。 */
const SYMBOL_TOKENS = [
  /\b[A-Za-z_$][\w$]*\(\)/g,
  /\b[A-Za-z_$][\w$]{1,}(?:\.[A-Za-z_$][\w$]{1,})+\b/g,
  /\b[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*\b/g,
] as const

/** 一个 token 算路径,当且仅当它的扩展名在本仓库已知的语言表里(util/filetype 的
 *  LANGUAGE_EXTENSIONS 就是那张表 —— 不另抄一份扩展名清单,免得两边漂)。 */
function isPathToken(token: string) {
  return LANGUAGE_EXTENSIONS[path.extname(token)] !== undefined
}

/** 正文里提到的第一个目标:先找路径,一个都没有再找符号。 */
function targetFromText(text: string) {
  const path = (text.match(PATH_TOKEN) ?? []).find(isPathToken)
  if (path) return path
  for (const pattern of SYMBOL_TOKENS) {
    const symbol = text.match(pattern)?.[0]
    if (symbol) return symbol
  }
  return undefined
}

/** 目标:结构化输入里的路径 → 最新那块推理正文里的路径 → 里面的符号。 */
function targetOf(last: WorkingPart | undefined, parts: readonly WorkingPart[] | undefined) {
  if (last?.type === "tool" && (last.state?.status === "pending" || last.state?.status === "running")) {
    for (const field of TARGET_INPUT_FIELDS) {
      const value = last.state?.input?.[field]
      if (typeof value === "string" && value.trim()) return value.trim()
    }
  }
  const reasoning = parts?.findLast((part) => part.type === "reasoning")
  return reasoning?.text ? targetFromText(reasoning.text) : undefined
}

/** 最后一个有正文或有输入的 part 的种类。 */
function stepKind(part: WorkingPart | undefined): WorkingStepKind | undefined {
  if (part?.type === "reasoning" || part?.type === "tool" || part?.type === "text") return part.type
  return undefined
}

/**
 * 标题行左段在 `columns` 列里摆成什么样。
 *
 * **列预算怎么算**:目标之外全是定长段(合计 `FIXED_COLUMNS` = 21,见那里的逐项拆解),
 * 所以目标能占的上限就是 `columns − 21`。目标按这个上限**从中间**截(头尾各留一段,
 * 见 TARGET_MIN_COLUMNS 上面那段);上限低于 `TARGET_MIN_COLUMNS` 就整段不画 ——
 * 窄终端上的降级是「少一个加粗的目标」,而不是「多一截认不出的路径碎片」,动词与计时
 * 始终完整。
 */
export function workingStepTitle(parts: readonly WorkingPart[] | undefined, columns: number): WorkingStepTitle {
  const last = parts?.findLast((part) => stepKind(part) !== undefined)
  const kind = stepKind(last)
  // 判定不出种类就没有「这一步」,也就没有它在想什么 —— 此时连正文里的路径都不取,
  // 动词同样不拿别的词凑(整行只剩 `✦ 分析` 与计时)。
  if (!kind) return {}
  const verb = STEP_VERBS[kind]
  const raw = targetOf(last, parts)
  const budget = columns - FIXED_COLUMNS
  if (!raw || budget < TARGET_MIN_COLUMNS) return { verb }
  return { verb, target: truncateMiddleToWidth(raw, budget) }
}

/**
 * 标题行的列预算 = 消息列 − 这一行自己的缩进。
 *
 * 用消息列(`ctx.width` 的 78%,见 message-anchor)而不是整列:助手气泡卡的右边框就落在
 * 消息列的右缘上,计时与它同列,这一行读起来才是「消息流里的一行」而不是浮在整列边上。
 * 扣掉 `WORKING_LINE_INDENT` 是因为这一行本来就缩进 2 列,预算是**行内可用列数**。
 */
export function workingTitleColumns(ctxWidth: number) {
  return Math.max(0, messageColumns(ctxWidth) - WORKING_LINE_INDENT)
}
