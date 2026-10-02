// 侧栏「分区卡」的可用列数。侧栏里每一个分区(资源管理器 / 上下文 / 消息 / MCP / LSP /
// 待办事项 / 修改的文件 / 分支 / 变更)现在都是一张自己的霓虹卡,所以凡是按宽度截断文本的地方
// (文件名、分支名、远程地址)真正的预算不是侧栏宽,而是这张卡**里面**的宽度 —— 算错就会
// 在窄终端上压到右边框上。
//
// 从外往里数固定开销(每项都是一列):
//   4 = 根侧栏卡 neonbox 的 paddingLeft 2 + paddingRight 2(sidebar.tsx)
//   1 = 插件槽容器给右侧滚动条留的 paddingRight(info / git 页的 scrollbox 子盒)
//   2 = 分区卡 neonbox 的左右边框(NeonBox 把边框画在最外两列)
//   2 = 分区卡 neonbox 的左右内边距
// 合计 9 列。于是最窄侧栏(44)剩 35 列,最宽侧栏(60)剩 51 列。
//
// 有一处不对称:文件页的 scrollbox 里没有那层 paddingRight 的盒子,所以「资源管理器」卡
// 比这里多 1 列。这里一律按最保守的 35 算 —— 所有截断上限都以最窄情况为准,
// 宽终端上只是多留白,不会溢出。
//
// 注意 NeonBox 的 padding 行/列**就是**边框所在的那一行/列(渲染时把边框字符画上去),
// 所以卡内可用宽度 = 卡宽 − 2,上面那 4 列「边框 2 + 内边距 2」在几何上是同一批格子。
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from "./sidebar-width"

const SIDEBAR_ROOT_PADDING = 4
const SIDEBAR_SCROLLBAR_RESERVE = 1
const SIDEBAR_CARD_CHROME = 4

/** 入参是**侧栏宽**(sidebarWidth() 的输出),不是终端宽。 */
export function sidebarCardContentWidth(sidebarColumns: number): number {
  return sidebarColumns - SIDEBAR_ROOT_PADDING - SIDEBAR_SCROLLBAR_RESERVE - SIDEBAR_CARD_CHROME
}

export const SIDEBAR_CARD_MIN_CONTENT = sidebarCardContentWidth(SIDEBAR_MIN_WIDTH)
export const SIDEBAR_CARD_MAX_CONTENT = sidebarCardContentWidth(SIDEBAR_MAX_WIDTH)

// Git 变更文件行的固定开销:行左内边距 1 + 状态码列 2 + 统计左内边距 1
// + 统计最坏情况「+999 -999」= 4+1+4 = 9 + 悬停才显形的「 丢弃」= 空格 1 + 丢弃 4 = 5。
// 合计 18;再留 2 列给字体宽度误差(ASCII 记 1 列、CJK 记 2 列的估算余量)。
export const GIT_FILE_LABEL_MAX = SIDEBAR_CARD_MIN_CONTENT - 18 - 2

// 文件树一行的固定开销:缩进 2×深度 + 箭头段 2 + 文件图标 2 + 名字前空格 1 + 右内边距 1
// = 2×深度 + 6(图标按 2 列算 —— ASCII 风格是 1 列,emoji/nerdfont 是 2 列,取宽的那边)。
// 名字上限 18 时第 5 层是 2×5+6+18 = 34,还剩 1 列余量;第 6 层开始由 yoga 裁掉尾部,
// 不会顶穿边框。
export const FILE_TREE_NAME_MAX = 18
