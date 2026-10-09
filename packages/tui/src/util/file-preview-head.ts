import path from "node:path"
import { Locale } from "./locale"
import { SIDEBAR_CARD_MIN_CONTENT } from "./sidebar-metrics"

/**
 * 侧栏「快速预览」卡的**纯计算**部分:徽标取名、预览宽度预算、读完之后怎么裁/怎么降级。
 * 渲染层(component/quick-preview-card.tsx)只管读盘与画,所有「显示几行、按几列裁、
 * 什么情况说哪句话」都在这里 —— 于是这三条降级规则能脱离终端单测。
 */

/**
 * 预览显示的行数**上限**。侧栏文件页上半截是文件树,预览卡不该把整屏吃掉;
 * 12 行够看出一个文件在干什么,再多就该双击进主区标签页看全文了。
 *
 * 实际给几行由 previewMaxLines 按终端高度再压一道 —— 这个数只是天花板。
 */
export const PREVIEW_MAX_LINES = 12

// 预览卡能占的行数是**减法**出来的,减的每一项都对应一个真实存在的行:
//
//   SIDEBAR_FILES_CHROME_ROWS = 侧栏固定开销:根卡 paddingTop 1 + 标签行(1 行标签 +
//     1 行 paddingBottom)= 2 + 品牌页脚(paddingTop 1 + 1 行)= 2 + 根卡 paddingBottom 1。
//   SIDEBAR_FILES_TREE_MIN_ROWS = 「资源管理器」卡至少要留这么多行。少了它,预览卡会长到
//     把整列吃完,树连一条标题都露不出来(预览卡在树**下面**、待在 scrollbox 外面,
//     见 routes/session/sidebar 的那段注释)。
//   PREVIEW_CARD_ROWS = 预览卡自己的固定行:上下两行边框(内边距行就是边框行)+ 1 行卡头。
//   PREVIEW_NOTICE_ROWS = 「… 还有 N 行」那一行。只在真截断时出现,但先扣掉 —— 反过来算的
//     话,一个 3 行的文件会把文件树少分 3 行,为了一个用不上的提示去挤压另一张卡不划算。
//
// 24 行的终端:24 − 6 − 5 − 3 − 1 = 9 行正文(+1 行提示),预览卡 13 行,文件树还剩 5 行。
// 30 行及以上才轮到 PREVIEW_MAX_LINES 那个天花板。
export const SIDEBAR_FILES_CHROME_ROWS = 6
export const SIDEBAR_FILES_TREE_MIN_ROWS = 5
const PREVIEW_CARD_ROWS = 3
const PREVIEW_NOTICE_ROWS = 1

/**
 * 终端有 `height` 行高时,预览正文最多给几行。
 *
 * 不封顶的话那张卡会吃掉几乎整列:根侧栏卡是 `height="100%"` 且**没有** overflow="hidden",
 * 固定开销 6 行 + 预览 16 行 = 22 行,20 行的终端上文件树分到 0 行、品牌页脚被顶出屏幕。
 * 这里把「树至少要有的行数」当成硬预算先扣掉,剩下的才是预览的。
 */
export function previewMaxLines(terminalHeight: number) {
  const room =
    terminalHeight - SIDEBAR_FILES_CHROME_ROWS - SIDEBAR_FILES_TREE_MIN_ROWS - PREVIEW_CARD_ROWS - PREVIEW_NOTICE_ROWS
  return Math.max(0, Math.min(PREVIEW_MAX_LINES, room))
}

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
  // 列预算默认取**窄的那一档**分区卡内容宽(sidebar-metrics 里 info/git 页的 36):
  // 预览卡挂在文件页(那一档是 37),按 36 算就天然留 1 列余量,写死 37 的话哪天挪到别的
  // 页就会顶到右边框上,而那种溢出在字符帧里看起来仍然「有内容」。
  const columns = input.columns ?? SIDEBAR_CARD_MIN_CONTENT
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
