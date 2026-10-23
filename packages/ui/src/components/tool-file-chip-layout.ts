/**
 * 工具摘要行里的「动了哪些文件」列表。
 *
 * 对齐 ZCode 的 file chip：`编辑 [icon] index.html [icon] app.js [icon] styles.css +N`。
 * 一行里直接看出这次动了什么，不用逐个展开工具行。
 *
 * 这里只放**纯逻辑**（挑哪几枚、溢出多少），组件在 tool-file-chips.tsx。
 * 之所以不做基于 DOM 测量的响应式裁剪（ZCode 那套 ResizeObserver + 逐枚测量）：
 * 那需要在布局阶段反复 setState，且测量时机和虚拟滚动容易打架。固定上限 +
 * 溢出计数既确定、又可直接单测，窄屏下也只是多出几像素的截断。
 */

export type ToolFileChip = {
  path: string
  additions?: number
  deletions?: number
}

export type ToolFileChipsLayout = {
  visible: ToolFileChip[]
  /** 被折叠掉的数量；0 表示全都显示了。 */
  overflow: number
}

/** 一行里最多直接列出几个文件名。 */
export const TOOL_FILE_CHIP_LIMIT = 3

export function layoutToolFileChips(files: readonly ToolFileChip[], limit = TOOL_FILE_CHIP_LIMIT): ToolFileChipsLayout {
  if (files.length <= limit) return { visible: [...files], overflow: 0 }
  // 有溢出时少显示一枚，给 `+N` 腾位置，避免"3 枚文件名 + +5"挤成一团。
  const visibleCount = Math.max(1, limit - 1)
  return { visible: files.slice(0, visibleCount), overflow: files.length - visibleCount }
}

/** 路径分隔符：Windows 反斜杠与 POSIX 斜杠都要认。 */
const SEPARATORS = /[\\/]/

/** 取路径末段（chip 里只显示文件名，完整路径放 title）。 */
export function fileChipLabel(path: string): string {
  const parts = path.split(SEPARATORS).filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1]! : path
}
