import { Show, type JSX } from "solid-js"
import { Icon } from "@novaway/ui/icon"

export function StatusSection(props: {
  id: string
  title: string
  summary?: JSX.Element
  open: boolean
  onToggle: () => void
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
        <span class="text-ui-base font-medium text-text-strong truncate">{props.title}</span>
        <Show when={props.summary}>
          {(summary) => <span class="text-ui-sm tabular-nums text-text-weak shrink-0">{summary()}</span>}
        </Show>
        <Icon
          name="chevron-down"
          size="small"
          class="text-icon-base transition-transform shrink-0"
          classList={{ "rotate-180": props.open }}
        />
      </button>
      <Show when={props.open}>
        <div class="max-h-48 overflow-y-auto no-scrollbar">{props.children}</div>
      </Show>
    </section>
  )
}
