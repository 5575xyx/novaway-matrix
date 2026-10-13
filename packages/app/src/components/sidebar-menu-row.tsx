import { type JSX } from "solid-js"

// 侧栏顶部导航改成一行一项的竖排菜单：图标 + 文字标签。此前是四个 icon-only 按钮挤在一行，
// 没有文字时只能靠记忆辨认功能，数据库/设置尤其难分。
export function SidebarMenuRow(props: {
  icon: JSX.Element
  label: string
  trailing?: JSX.Element
  onClick: () => void
}) {
  return (
    <button
      type="button"
      class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-ui-base font-medium text-text-strong transition-colors hover:bg-surface-raised-base-hover"
      onClick={props.onClick}
    >
      <span class="flex size-4 shrink-0 items-center justify-center text-icon-base">{props.icon}</span>
      <span class="flex-1 truncate text-left">{props.label}</span>
      {props.trailing}
    </button>
  )
}
