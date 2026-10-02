import path from "node:path"
import { Locale } from "./locale"
import { SIDEBAR_CARD_MIN_CONTENT } from "./sidebar-metrics"

/**
 * 侧栏「快速预览」卡的**纯计算**部分:徽标取名、预览宽度预算、读完之后怎么裁/怎么降级。
 * 渲染层(component/quick-preview-card.tsx)只管读盘与画,所有「显示几行、按几列裁、
 * 什么情况说哪句话」都在这里 —— 于是这三条降级规则能脱离终端单测。
 */

/**
 * 预览显示的最大行数。侧栏文件页下面还有文件树,预览卡不该把整屏吃掉;
 * 12 行够看出一个文件在干什么,再多就该双击进主区标签页看全文了。
 */
export const PREVIEW_MAX_LINES = 12

/**
 * 体积上限。侧栏预览是「随手看一眼」,不是编辑器:超过这个体积就不读正文,
 * 直接说文件过大 —— 省掉把几百 MB 读进内存再截前 12 行的那次 IO。
 * 512KB 与主区 file-preview.tsx 的 100KB 上限是同一个量级上的两档(那边要能编辑,这边只读)。
 */
export const PREVIEW_MAX_BYTES = 512 * 1024

export type PreviewModel =
  /** 有正文可画:<code> 的 content 与「还剩多少行」的提示。 */
  | { kind: "code"; content: string; truncated: boolean; remaining: number }
  /** 降级:一行明确文案,绝不静默留白。 */
  | { kind: "notice"; text: string }

type CodePreview = Extract<PreviewModel, { kind: "code" }>

/**
 * 判别联合的收窄。渲染层要把它劈成「有正文」和「只有降级文案」两条渲染路径,而 Solid 的
 * `<Show when={model()}>{(item) => ...}</Show>` 给的是整个联合(每次读 accessor 都是新表达式,
 * TypeScript 不会跨调用保持收窄),所以收窄放在这里一次做完,渲染层就不用写 `as`。
 */
export function isCodeModel(model: PreviewModel): model is CodePreview {
  return model.kind === "code"
}

/** 卡头徽标 = 文件名。path.basename 对 Windows 反斜杠同样有效。 */
export function previewBadge(filePath: string) {
  return path.basename(filePath)
}

/**
 * 预览正文的列预算。默认取**窄的那一档**分区卡内容宽(sidebar-metrics 里 info/git 页的 36):
 * 预览卡挂在文件页(那一档是 37),按 36 算就天然留 1 列余量,写死 37 的话哪天挪到别的
 * 页就会顶到右边框上,而那种溢出在字符帧里看起来仍然「有内容」。
 */
export function previewColumns(columns = SIDEBAR_CARD_MIN_CONTENT) {
  return columns
}

/** 二进制判定:正文里有 NUL 字节就不是可预览的文本。 */
export function isBinaryText(text: string) {
  return text.includes("\0")
}

/**
 * 读完之后把正文裁成预览。降级阶梯按「越不可读越靠前」排,每一步都给**明确**文案:
 *
 *   1. 没读到内容(不存在 / 没权限)→「无法读取该文件」。
 *   2. 体积超上限 → 「文件过大（x KB），不做快速预览」。这一步在读正文**之前**判,
 *      所以大文件根本不会被读进内存。
 *   3. 有 NUL → 「二进制文件，不做快速预览」。
 *   4. 全是空白 → 「空文件」。
 *   5. 其余 → 前 maxLines 行,每行按 columns 显示列截断。
 *
 * 尾部多余空行先去掉:文件几乎都以换行结尾,不去掉就会凭空多出一行空正文、
 * 还把 remaining 数错。
 */
export function previewModel(input: {
  path: string
  /** 读到的正文;undefined 表示没读到。 */
  text?: string
  /** 文件字节数,用来在读正文之前判过大。 */
  bytes?: number
  columns?: number
  maxLines?: number
}): PreviewModel {
  if (input.text === undefined) return { kind: "notice", text: "无法读取该文件" }

  if (input.bytes !== undefined && input.bytes > PREVIEW_MAX_BYTES) {
    return { kind: "notice", text: `文件过大(${kb(input.bytes)} KB),不做快速预览` }
  }

  if (isBinaryText(input.text)) return { kind: "notice", text: "二进制文件,不做快速预览" }

  const lines = trimTrailingBlankLines(input.text)
  if (lines.length === 0) return { kind: "notice", text: "空文件" }

  const maxLines = input.maxLines ?? PREVIEW_MAX_LINES
  const columns = previewColumns(input.columns)
  const kept = lines.slice(0, maxLines).map((line) => Locale.truncateToWidth(line, columns))
  return {
    kind: "code",
    content: kept.join("\n"),
    truncated: lines.length > maxLines,
    remaining: Math.max(0, lines.length - maxLines),
  }
}

function kb(bytes: number) {
  return (bytes / 1024).toFixed(1)
}

/** 丢掉尾部连续的空行/纯空白行(文件末尾那个换行不算一行正文)。 */
function trimTrailingBlankLines(text: string) {
  const lines = text.split("\n")
  while (lines.length > 0 && (lines[lines.length - 1] ?? "").trim() === "") lines.pop()
  return lines
}
