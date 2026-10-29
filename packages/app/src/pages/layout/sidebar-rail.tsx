import { For, Show, type Component, type JSX } from "solid-js"
import { Icon, type IconProps } from "@novaway/ui/icon"
import { Tooltip } from "@novaway/ui/tooltip"

/**
 * 侧栏最左侧的窄图标条（对齐 Codex 的 activity rail）。
 *
 * 数据库 / 知识库 / 自动化 / 扩展 / 设置这些是**低频的全局页面**，
 * 之前和"任务列表"平铺在同一列里，每项占一整行（图标 + 文字 + 上下留白），
 * 把任务区压得很短。挪到宽度刚好放一个图标的窄条里之后：
 *  - 不占任务列表的垂直空间；
 *  - 只留图标，靠 hover 的 Tooltip 显示名称（rail 本身不变宽，避免布局抖动）；
 *  - 打开某个页面时图标高亮，用户始终知道自己在哪一层。
 *
 * 这条 rail **不参与侧栏折叠**：折叠只收起右边的会话面板，rail 常驻（对齐 Codex），
 * 否则收起后连返回入口都没有。顶部是品牌 logo，往下才是导航图标，两者之间一条细线分隔。
 */
export type SidebarRailItem = {
  id: string
  icon: IconProps["name"]
  label: string
  /** 选中态（对应页面已打开）。 */
  active?: boolean
  /** 图标色相：与侧栏旧版菜单一致（数据库蓝、知识库绿…）。 */
  tone?: string
  onClick: () => void
}

/** 单个 rail 按钮。移动端抽屉没有竖向窄条，会把同一组按钮折成一排复用。 */
export function SidebarRailButton(props: { item: SidebarRailItem }) {
  return (
    <Tooltip value={props.item.label} placement="right" gutter={10}>
      <button
        type="button"
        data-component="sidebar-rail-item"
        data-active={props.item.active ? "true" : undefined}
        aria-label={props.item.label}
        aria-current={props.item.active ? "page" : undefined}
        class="group relative flex size-10 shrink-0 items-center justify-center rounded-[10px] text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground data-[active]:bg-surface data-[active]:text-foreground"
        onClick={() => props.item.onClick()}
      >
        <Icon
          name={props.item.icon}
          size="normal"
          style={props.item.tone ? { color: props.item.tone } : undefined}
          class="transition-transform duration-150 group-hover:scale-105"
        />
        {/* 选中指示条：rail 是竖排，用左侧短条比整块底色更轻。 */}
        <Show when={props.item.active}>
          {/* 位置贴按钮左沿：rail 外层是 overflow-hidden，再往外会被裁掉。 */}
          <span class="pointer-events-none absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-[var(--mode-accent,var(--border-hover))]" />
        </Show>
      </button>
    </Tooltip>
  )
}

export const SidebarRail: Component<{
  items: SidebarRailItem[]
  footer?: SidebarRailItem[]
  /** 顶部品牌区（logo）。 */
  header?: JSX.Element
  /** 品牌区下、导航区上的额外入口（主题切换这类有自定义动效的按钮）。 */
  leading?: JSX.Element
  /** 底部区上方（设置之上）的额外入口：主题切换现在落在这里，对齐 ZCode 的底部工具区。 */
  footerLeading?: JSX.Element
  /** 额外类名：macOS 桌面端要避开左上角的红绿灯。 */
  class?: string
}> = (props) => {
  return (
    <div
      data-component="sidebar-rail"
      // 图标 20px / 按钮 40px / 间距 8px：比之前的 16px + 4px 松一档，点起来不挤。
      // 右边界一条 hairline 与会话面板分开（用户要求"两个区域要分开"）。
      // 上边距不写死：macOS 桌面端要避开左上角红绿灯，由调用方用 class 覆盖 `pt-*`。
      class={`flex h-full w-12 shrink-0 flex-col items-center gap-2 border-r border-border pb-2 ${props.class ?? "pt-2"}`}
      // 窄条只放图标，鼠标悬停用 Tooltip 展示名称；不参与面板的滚动。
      aria-label="sidebar rail"
    >
      <Show when={props.header}>
        <div class="flex h-10 w-full shrink-0 items-center justify-center">{props.header}</div>
        <span class="mb-1 h-px w-6 shrink-0 bg-border" />
      </Show>
      <Show when={props.leading}>{props.leading}</Show>
      <For each={props.items}>{(item) => <SidebarRailButton item={item} />}</For>
      <div class="min-h-2 flex-1" />
      <Show when={props.footerLeading}>{props.footerLeading}</Show>
      <For each={props.footer ?? []}>{(item) => <SidebarRailButton item={item} />}</For>
    </div>
  )
}
