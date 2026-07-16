import { createEffect, createMemo, type Accessor, type JSX } from "solid-js"

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
    <div class="flex h-full w-full min-w-0 overflow-hidden">
      <div
        ref={(el) => {
          panel = el
        }}
        classList={{ "flex-1 flex h-full min-h-0 min-w-0 overflow-hidden": true, "pointer-events-none": !expanded() }}
        aria-hidden={!expanded()}
      >
        {props.renderPanel()}
      </div>
    </div>
  )
}
