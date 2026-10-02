import { Show, type JSX } from "solid-js"
import { useTheme } from "../context/theme"
import { semanticStops } from "../ui/neon"
import "../ui/card"

/**
 * 侧栏分区卡:侧栏里每个分区(资源管理器 / 上下文 / 消息 / MCP / LSP / 待办事项 /
 * 修改的文件 / 分支 / 变更)各自一张霓虹卡,首行是 header(图标 + 标题 + 可选动作 +
 * 右对齐徽标),其余是正文。
 *
 * 与助手气泡卡(AssistantCard)、输入卡(PromptCard)同一条规矩:只依赖 useTheme(),
 * 不碰 session/local context,所以测试能直接挂载真壳量真实几列。手抄一个 neonbox 到
 * 测试里的话,改这里的 padding 不会让任何测试变红,`util/sidebar-metrics.ts` 里的
 * 列数推导也会悄悄失准。
 *
 * padding 四边 1:NeonBox 把边框画在最外行/列上,内容从第 1 行/列开始,所以内容压不到
 * 边框字符。卡内可用宽度 = 卡宽 − 2(边框),侧栏根卡再减去自己的内边距,得到的就是
 * sidebarCardContentWidth() 那个数(最窄侧栏 44 时是 35 列)。
 *
 * 折叠箭头与头部动作不同时出现:今天带箭头的都是「列表可折叠」的分区卡(消息 / MCP /
 * LSP / 待办 / 修改的文件),带动作的只有 Git 页的分支卡(不可折叠)。两者都在 header 上
 * 挂鼠标事件,真要同时用得再拆。
 */
export interface SidebarCardProps {
  title: string
  /** 标题左侧的图标字形。调用方给(panel-icons 的 icon() 之类),这里不猜风格。 */
  icon?: string
  /** 右对齐徽标:计数、名字、路径一类「一眼要看到」的状态。 */
  badge?: string
  /** header 上的动作文字(例如「+ 新建分支」)。 */
  action?: string
  onAction?: () => void
  /** 为真时 header 显示 ▼/▶,点 header 切折叠态。 */
  collapsible?: boolean
  collapsed?: boolean
  onToggle?: () => void
  children: JSX.Element
}

export function SidebarCard(props: SidebarCardProps) {
  const { theme } = useTheme()
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
      <box flexDirection="row" gap={1} flexShrink={0} onMouseDown={() => props.onToggle?.()}>
        <Show when={props.collapsible}>
          <text flexShrink={0} fg={theme.text}>
            {props.collapsed ? "▶" : "▼"}
          </text>
        </Show>
        <Show when={props.icon}>
          <text flexShrink={0}>{props.icon}</text>
        </Show>
        <text fg={theme.text} wrapMode="none" flexShrink={1}>
          <b>{props.title}</b>
        </text>
        <Show when={props.action}>
          <text flexShrink={0} fg={theme.primary} onMouseUp={props.onAction}>
            {props.action}
          </text>
        </Show>
        {/* 标题与徽标之间的弹性留白:徽标因此永远贴在卡内右边框前 1 列。 */}
        <box flexGrow={1} />
        <Show when={props.badge}>
          <text flexShrink={0} fg={theme.textMuted} wrapMode="none">
            {props.badge}
          </text>
        </Show>
      </box>
      {props.children}
    </neonbox>
  )
}
