import { Show, type JSX } from "solid-js"
import { Icon } from "@novaway/ui/icon"

/**
 * Shared Orca-style process group shell.
 * The timeline supplies the localized summary and process rows; this component
 * owns the stable DOM contract used by the desktop UI and browser regression tests.
 */
export function TurnFoldView(props: {
  label: string
  open: boolean
  working?: boolean
  bare?: boolean
  onToggle?: () => void
  children: JSX.Element
}): JSX.Element {
  const rows = () => props.children

  return (
    <Show
      when={!props.bare}
      fallback={
        <div data-component="turn-fold" data-open="true" class="w-full">
          {rows()}
        </div>
      }
    >
      <div data-component="turn-fold" data-open={props.open} class="w-full">
        <button
          type="button"
          data-component="turn-fold-trigger"
          class="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-hover"
          aria-expanded={props.open}
          data-working={props.working ? "true" : undefined}
          onClick={() => props.onToggle?.()}
        >
          <span class="grid size-4 shrink-0 place-items-center text-foreground-subtle">
            <Icon
              name={props.working ? "lu-loader" : "lu-wrench"}
              size="small"
              classList={{ "animate-spin": props.working }}
            />
          </span>
          <span class="min-w-0 truncate text-13-regular text-foreground-subtle">{props.label}</span>
          <span
            class="grid size-4 shrink-0 place-items-center text-foreground-subtlest transition-transform duration-200"
            classList={{ "rotate-180": props.open }}
          >
            <Icon name="lu-chevron-down" size="small" />
          </span>
        </button>
        <div
          data-component="turn-fold-detail"
          class="grid transition-[grid-template-rows] duration-300 ease-out"
          style={{ "grid-template-rows": props.open ? "1fr" : "0fr" }}
          aria-hidden={!props.open}
        >
          <div class="overflow-hidden">{rows()}</div>
        </div>
      </div>
    </Show>
  )
}
