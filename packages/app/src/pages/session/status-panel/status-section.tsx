import { Show, type JSX } from "solid-js"
import { Icon } from "@novaway/ui/icon"

export function StatusSection(props: {
  id: string
  title: string
  summary?: JSX.Element
  open: boolean
  onToggle: () => void
  bodyHeight?: string
  children: JSX.Element
}): JSX.Element {
  return (
    <section data-component="status-section" data-section={props.id}>
      <button
        type="button"
        data-component="status-section-toggle"
        aria-expanded={props.open}
        class="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={props.onToggle}
      >
        <span class="text-ui-base font-medium text-foreground truncate">{props.title}</span>
        {/* 摘要只在**收起**时显示（对齐 ZCode 的 `trailing: (isOpen) => isOpen ? null : ...`）：
            展开后同样的数字就在「更改」行里，两处并排只是重复。 */}
        <Show when={props.summary && !props.open}>
          {(summary) => <span class="text-ui-sm tabular-nums text-foreground-subtle shrink-0">{summary()}</span>}
        </Show>
        <Icon
          name="chevron-down"
          size="small"
          class="text-foreground-subtle transition-transform shrink-0"
          classList={{ "rotate-180": props.open }}
        />
      </button>
      <Show when={props.open}>
        <div class={`${props.bodyHeight ?? "max-h-48"} overflow-y-auto no-scrollbar`}>{props.children}</div>
      </Show>
    </section>
  )
}
