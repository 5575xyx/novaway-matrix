import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { ComponentProps, JSXElement, ParentProps, Show } from "solid-js"
import { useI18n } from "../context/i18n"
import { IconButton } from "./icon-button"

export interface DrawerProps extends ParentProps {
  title?: JSXElement
  description?: JSXElement
  action?: JSXElement
  class?: ComponentProps<"div">["class"]
  classList?: ComponentProps<"div">["classList"]
  transition?: boolean
}

export function Drawer(props: DrawerProps) {
  const i18n = useI18n()
  return (
    <div data-component="drawer" data-transition={props.transition ? true : undefined}>
      <div data-slot="drawer-container">
        <Kobalte.Content
          data-slot="drawer-content"
          data-no-header={!props.title && !props.action ? "" : undefined}
          classList={{
            ...props.classList,
            [props.class ?? ""]: !!props.class,
          }}
          onOpenAutoFocus={(e) => {
            const target = e.currentTarget as HTMLElement | null
            const autofocusEl = target?.querySelector("[autofocus]") as HTMLElement | null
            if (autofocusEl) {
              e.preventDefault()
              autofocusEl.focus()
            }
          }}
        >
          <Show when={props.title || props.action}>
            <div data-slot="drawer-header">
              <Show when={props.title}>
                <Kobalte.Title data-slot="drawer-title">{props.title}</Kobalte.Title>
              </Show>
              <Show when={props.action}>
                {props.action}
              </Show>
              <Show when={!props.action}>
                <Kobalte.CloseButton
                  data-slot="drawer-close-button"
                  as={IconButton}
                  icon="close"
                  variant="ghost"
                  aria-label={i18n.t("ui.common.close")}
                />
              </Show>
            </div>
          </Show>
          <Show when={props.description}>
            <Kobalte.Description data-slot="drawer-description">{props.description}</Kobalte.Description>
          </Show>
          <div data-slot="drawer-body">{props.children}</div>
        </Kobalte.Content>
      </div>
    </div>
  )
}