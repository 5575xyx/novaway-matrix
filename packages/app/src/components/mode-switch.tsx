import { For, Show } from "solid-js"
import { DropdownMenu } from "@novaway/ui/dropdown-menu"
import { Icon } from "@novaway/ui/icon"
import { useLanguage } from "@/context/language"
import { useLayout, type AppModeConfig } from "@/context/layout"

export function ModeSwitchButton(props: { onSelect: (mode: AppModeConfig) => void; fullWidth?: boolean }) {
  const layout = useLayout()
  const language = useLanguage()
  const current = () => layout.mode.all.find((m) => m.id === layout.mode.current())

  return (
    <DropdownMenu placement="bottom" gutter={8}>
      <DropdownMenu.Trigger
        classList={{
          "flex items-center gap-2 rounded-md px-2 text-ui-base font-medium text-foreground transition-colors": true,
          "h-8 border border-border bg-surface hover:bg-hover data-[expanded]:border-border-hover":
            !props.fullWidth,
          "w-full py-1.5 hover:bg-hover data-[expanded]:bg-surface": !!props.fullWidth,
        }}
        aria-label={language.t("mode.switch.ariaLabel")}
      >
        <Show
          when={current()}
          fallback={
            <>
              <span class="size-2 shrink-0 rounded-full bg-border-hover" />
              <span class="text-foreground-subtle">{language.t("mode.select.placeholder")}</span>
            </>
          }
        >
          {(mode) => (
            <>
              <span class="size-2 shrink-0 rounded-full" style={{ background: mode().color }} />
              <span class="text-foreground">{mode().shortName}</span>
            </>
          )}
        </Show>
        <Icon name="chevron-down" size="small" class="shrink-0 text-foreground-subtlest" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="z-50 w-72 rounded-lg border border-border bg-popover p-1.5 shadow-[var(--shadow-md)]">
          <For each={layout.mode.all}>
            {(mode) => (
              <DropdownMenu.Item
                class="flex items-center gap-2 rounded-md px-2 py-1.5 text-ui-caption text-foreground hover:bg-hover"
                onSelect={() => props.onSelect(mode)}
              >
                <span class="size-2 shrink-0 rounded-full" style={{ background: mode.color }} />
                <span class="flex-1 text-left">{mode.shortName}</span>
                <Show when={layout.mode.current() === mode.id}>
                  <Icon name="check" size="small" class="text-foreground-subtlest" />
                </Show>
              </DropdownMenu.Item>
            )}
          </For>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  )
}
