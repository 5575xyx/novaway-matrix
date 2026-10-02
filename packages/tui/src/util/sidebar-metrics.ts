// 侧栏「分区卡」的可用列数。侧栏里每一个分区(资源管理器 / 上下文 / 消息 / MCP / LSP /
// 待办事项 / 修改的文件 / 分支 / 变更)现在都是一张自己的霓虹卡,所以凡是按宽度截断文本的地方
// (文件名、分支名、徽标)真正的预算不是侧栏宽,而是这张卡**里面**的宽度 —— 算错就会
// 在窄终端上压到右边框上。
//
// 这里的每个数都不是推出来的,是照着真实嵌套量出来的(test/component/sidebar.test.tsx 的
// 「分区卡的可用列数」渲染整个 Sidebar 后从渲染树上读回 NeonBoxRenderable.width)。
// 从侧栏宽往里数,固定开销是:
//
//   4 = 根侧栏卡 neonbox 的 paddingLeft 2 + paddingRight 2(sidebar.tsx)
//   1 = scrollbox 的纵向滚动条列。滚动条和 scrollbox 根同宽,里面的子盒只有「根宽 − 1」,
//       所以内容一多它就实打实地吃掉一列 —— 溢出时实测就是这一列。
//   2 = 分区卡 neonbox 的左右边框。**注意这里没有再算内边距**:NeonBox 把边框字符画在
//       最外两列上,而那两列本来就被 paddingLeft/paddingRight 占着,内边距行/列就是边框行/列。
//       (上一版把「边框 2 + 内边距 2」当成 4 列,多算了 2 列。)
//   1 = 仅 info / git 页:<box paddingRight={1}>(scrollbox 里的插件槽 / GitPanel 外层)
//       让内容离滚动条远一点。文件页没有这层盒子,所以宽 1 列。
//
// 于是最窄侧栏(44):文件页 37 列、info/git 页 36 列;最宽侧栏(60):53 / 52 列。
// 宽度预算一律取最窄那档 —— 宽终端上只是多留白,不会溢出。
import { SIDEBAR_MIN_WIDTH } from "./sidebar-width"

/** 分区卡所在的外层结构。两者的差别就是下面那 1 列 paddingRight。 */
export type SidebarCardPage = "files" | "slots"

const SIDEBAR_ROOT_PADDING = 4
const SIDEBAR_SCROLLBAR = 1
const SIDEBAR_CARD_BORDER = 2
const SIDEBAR_SLOT_PADDING = 1

/** 入参是**侧栏宽**(sidebarWidth() 的输出),不是终端宽。 */
export function sidebarCardContentWidth(sidebarColumns: number, page: SidebarCardPage = "slots"): number {
  const slotPadding = page === "files" ? 0 : SIDEBAR_SLOT_PADDING
  return sidebarColumns - SIDEBAR_ROOT_PADDING - SIDEBAR_SCROLLBAR - SIDEBAR_CARD_BORDER - slotPadding
}

/** info / git 页(插件槽与 GitPanel 外面多一层 paddingRight 的盒子)。 */
export const SIDEBAR_CARD_MIN_CONTENT = sidebarCardContentWidth(SIDEBAR_MIN_WIDTH)
/**
 * 分区卡**外面**那一层的内容区(Git 页的「同步 / 远程 / 历史」三个节标题和它们的行):
 * 比卡里宽 2 列 —— 那 2 列正是卡自己的左右边框。
 */
export const SIDEBAR_SECTION_MIN_CONTENT = SIDEBAR_CARD_MIN_CONTENT + 2

// Git 变更文件行的固定开销:行左内边距 1 + 状态码列 2 + 统计左内边距 1
// + 统计最坏情况「+999 -999」= 4+1+4 = 9 + 悬停才显形的「 丢弃」= 空格 1 + 丢弃 4 = 5。
// 合计 18;再留 2 列余量。
export const GIT_FILE_LABEL_MAX = SIDEBAR_CARD_MIN_CONTENT - 18 - 2

// 文件树一行的固定开销:缩进 2×深度 + 箭头段 2 + 文件图标 2 + 名字前空格 1 + 右内边距 1
// = 2×深度 + 6(图标按 2 列算 —— ASCII 风格是 1 列,emoji/nerdfont 是 2 列,取宽的那边)。
// 20 是**软上限**:名字那个 text 允许收缩(yoga 会裁尾部),所以超过上限的行是被自己的行裁掉,
// 不是顶着边框画出去。20 在第 5 层刚好 2×5+6+20 = 36,还剩 1 列余量。
export const FILE_TREE_NAME_MAX = 20
