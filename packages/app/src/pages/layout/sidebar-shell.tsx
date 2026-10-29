import { createEffect, createMemo, type Accessor, type JSX } from "solid-js"

/**
 * 侧栏主体：只有会话面板本身。
 *
 * 最左侧的图标条（logo / 数据库 / 知识库 / 设置…）已经移到 `sidebar-rail.tsx`，
 * 由 `layout.tsx` 作为面板的兄弟节点渲染 —— 它不参与折叠，所以不能放在这一层里面
 * （否则收窄到 0 时会被一起裁掉）。
 */
export const SidebarContent = (props: {
  mobile?: boolean
  opened: Accessor<boolean>
  renderPanel: () => JSX.Element
}): JSX.Element => {
  const expanded = createMemo(() => !!props.mobile || props.opened())
  let panel: HTMLDivElement | undefined

  createEffect(() => {
    const el = panel
    if (!el) return
    if (expanded()) {
      el.removeAttribute("inert")
      return
    }
    el.setAttribute("inert", "")
  })

  return (
    <div
      ref={(el) => {
        panel = el
      }}
      classList={{ "flex h-full w-full min-h-0 min-w-0 overflow-hidden": true, "pointer-events-none": !expanded() }}
      aria-hidden={!expanded()}
    >
      {props.renderPanel()}
    </div>
  )
}
