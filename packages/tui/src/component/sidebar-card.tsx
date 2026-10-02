import { createEffect, createMemo, createSignal, on, Show, type Accessor, type JSX } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "../context/theme"
import { treeArrow } from "../util/panel-icons"
import { semanticStops } from "../ui/neon"
import { Locale } from "../util/locale"
import { sidebarCardContentWidth, type SidebarCardPage } from "../util/sidebar-metrics"
import { sidebarWidth } from "../util/sidebar-width"
import "../ui/card"

// 卡头里两段固定内容之间、徽标与右边框之间的余量。留 0 的话徽标会顶到边框上,
// 标题又因为 flexShrink 被压到 0 宽(整张卡只剩一个徽标,标题凭空消失)。
const HEAD_GAP = 1
const HEAD_MARGIN = 2
// 标题的保底宽度:再挤也至少留这么多列,否则「资源管理器」这类标题会被徽标整段吃掉。
const TITLE_MIN = 8

export interface SidebarCardProps {
  title: string
  /** 标题左侧的图标字形。调用方给(panel-icons 的 icon(...) 之类),这里不猜风格。 */
  icon?: string
  /** 右对齐徽标:计数、名字、路径一类「一眼要看到」的状态。 */
  badge?: string
  /** header 上的动作文字(例如「+ 新建分支」)。 */
  action?: string
  onAction?: () => void
  /** 超过这个项数才出现折叠箭头,由 CollapsibleSidebarCard 传。 */
  collapsible?: boolean
  collapsed?: boolean
  onToggle?: () => void
  /**
   * 这张卡所在的外层结构,决定它按哪一档宽度预算截断(见 util/sidebar-metrics)。
   * 省略就是 info / git 页那一档;文件页要显式写 "files"(外面少一层 paddingRight 的盒子,宽 1 列)。
   */
  page?: SidebarCardPage
  children: JSX.Element
}

/**
 * 侧栏分区卡:侧栏里每个分区(资源管理器 / 上下文 / 消息 / MCP / LSP / 待办事项 /
 * 修改的文件 / 分支 / 变更)各自一张霓虹卡,首行是 header(图标 + 标题 + 可选动作 +
 * 右对齐徽标),其余是正文。
 *
 * 与助手气泡卡(AssistantCard)、输入卡(PromptCard)同一条规矩:只依赖 useTheme(),
 * 不碰 session/local context,所以测试能直接挂载真壳量真实几列。手抄一个 neonbox 到
 * 测试里的话,改这里的 padding 不会让任何测试变红,sidebar-metrics 里的列数推导也会悄悄失准。
 *
 * padding 四边 1:NeonBox 把边框画在最外行/列上,内容从第 1 行/列开始,所以内容压不到
 * 边框字符。**内边距行/列就是边框行/列**,所以卡内可用宽度 = 卡宽 − 2(不是 − 4)。
 *
 * 徽标与动作的封顶做在这里而不是各调用点:卡头的宽度是这张卡自己算得出来的,而调用点
 * 只有各自的语义上限(`1024 条 · 仅显示 5 条` 这种会随数据涨的字符串,任何调用点常量都拦不住)。
 * 两者取更严的那个,所以调用点仍然可以按语义再压一档。
 *
 * 折叠箭头与头部动作不同时出现:今天带箭头的都是「列表可折叠」的分区卡,带动作的只有
 * Git 页的分支卡(不可折叠)。两者都在 header 上挂鼠标事件,真要同时用得再拆。
 */
export function SidebarCard(props: SidebarCardProps) {
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const columns = createMemo(() => sidebarCardContentWidth(sidebarWidth(dimensions().width), props.page))

  // 卡头里除徽标外的固定开销:折叠箭头 + 图标 + 标题 + 动作,段间各 1 列。
  const head = createMemo(() => {
    const available = columns()
    const arrow = (props.collapsible ? 1 + HEAD_GAP : 0) + (props.icon ? Locale.displayWidth(props.icon) + HEAD_GAP : 0)
    const title = Locale.displayWidth(props.title)
    // 动作是本仓库自己的短文案,给它剩下的全部;徽标再拿剩下的 —— 顺序即优先级。
    const actionColumns = props.action
      ? Math.max(0, Math.min(Locale.displayWidth(props.action), available - arrow - title - HEAD_MARGIN))
      : 0
    const actionCost = actionColumns > 0 ? actionColumns + HEAD_GAP : 0
    return {
      action: Locale.truncateToWidth(props.action ?? "", actionColumns),
      badge: Locale.truncateToWidth(
        props.badge ?? "",
        Math.max(0, available - arrow - title - actionCost - HEAD_MARGIN),
      ),
    }
  })

  return (
    <neonbox
      gradientStops={semanticStops(theme, "tool")}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={1}
      paddingRight={1}
      width="100%"
      flexShrink={0}
    >
      <box flexDirection="row" gap={HEAD_GAP} flexShrink={0} onMouseDown={() => props.onToggle?.()}>
        <Show when={props.collapsible}>
          <text flexShrink={0} fg={theme.text}>
            {/* 箭头跟着 icons 风格走(ascii / nerdfont 下不该混进 ▼▶ 这类几何字形) */}
            {treeArrow(!props.collapsed)}
          </text>
        </Show>
        <Show when={props.icon}>
          <text flexShrink={0}>{props.icon}</text>
        </Show>
        <text fg={theme.text} wrapMode="none" minWidth={Math.min(Locale.displayWidth(props.title), TITLE_MIN)}>
          <b>{props.title}</b>
        </text>
        <Show when={head().action}>
          <text flexShrink={0} fg={theme.primary} onMouseUp={props.onAction}>
            {head().action}
          </text>
        </Show>
        {/* 标题与徽标之间的弹性留白:徽标因此永远贴在卡内右边框前 1 列。 */}
        <box flexGrow={1} />
        <Show when={head().badge}>
          <text flexShrink={0} fg={theme.textMuted} wrapMode="none">
            {head().badge}
          </text>
        </Show>
      </box>
      {props.children}
    </neonbox>
  )
}

export interface CollapsibleSidebarCardProps {
  title: string
  icon?: string
  badge?: string
  /** 列表项数。超过 collapseAt 才出现折叠箭头(和「少于一屏就不必折」是同一条判断)。 */
  count: number
  /** 超过多少项开始折叠。 */
  collapseAt: number
  /** 初始是否展开;默认展开。 */
  defaultOpen?: boolean
  /**
   * 折叠时是否把正文整个收起来,默认是。只有一种例外:消息列表折叠时不是「没有内容」,
   * 而是「只留最近几条」—— 那份可见集合由它自己按 open 算,所以要关掉这一层。
   */
  hideWhenCollapsed?: boolean
  /** 换会话/换 key 时回到初始态(消息列表要这个,否则上个会话手动折过的状态会被带过来)。 */
  resetKey?: string
  /** 和 SidebarCard 同义:这张卡所在的外层结构,决定按哪一档宽度预算截断。 */
  page?: SidebarCardPage
  /**
   * 正文。入参是「当前是否展开」:折叠状态下**正文整体不会被渲染**,所以多数插件直接
   * 忽略它;消息列表这种「折叠时只显示最近几条」的需要拿它算自己的可见集合
   * —— 这也是 children 做成函数而不是 JSX 的唯一原因。
   */
  children: (open: Accessor<boolean>) => JSX.Element
}

/**
 * 可折叠的分区卡:折叠箭头、阈值判断、「折叠后藏内容」三件事都在这里,
 * 调用方只给项数和正文。之前这四件套在四个插件里各抄了一遍,阈值一旦调整要改四个地方。
 *
 * `SidebarCard` 本身仍是纯表现壳(收什么显示什么),折叠这套状态留给这一层。
 */
export function CollapsibleSidebarCard(props: CollapsibleSidebarCardProps) {
  const [open, setOpen] = createSignal(props.defaultOpen ?? true)
  const collapsible = createMemo(() => props.count > props.collapseAt)
  const show = createMemo(() => !collapsible() || open())
  createEffect(
    on(
      () => props.resetKey,
      () => setOpen(props.defaultOpen ?? true),
      { defer: true },
    ),
  )
  return (
    <SidebarCard
      title={props.title}
      icon={props.icon}
      badge={props.badge}
      page={props.page}
      collapsible={collapsible()}
      collapsed={!open()}
      onToggle={() => collapsible() && setOpen((value) => !value)}
    >
      <Show when={show() || props.hideWhenCollapsed === false}>{props.children(open)}</Show>
    </SidebarCard>
  )
}
