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
          "flex items-center gap-2 rounded-md px-2 text-ui-base font-medium text-text-strong transition-colors": true,
          "h-8 border border-border-weak-base bg-surface-base hover:bg-surface-base-hover data-[expanded]:border-border-active":
            !props.fullWidth,
          "w-full py-1.5 hover:bg-surface-raised-base-hover data-[expanded]:bg-surface-raised-base": !!props.fullWidth,
        }}
        aria-label={language.t("mode.switch.ariaLabel")}
      >
        <Show
          when={current()}
          fallback={
            <>
              <span class="size-2 shrink-0 rounded-full bg-border-strong-base" />
              <span class="text-text-weak">{language.t("mode.select.placeholder")}</span>
            </>
          }
        >
          {(mode) => (
            <>
              <span class="size-2 shrink-0 rounded-full" style={{ background: mode().color }} />
              <span class="text-text-strong">{mode().shortName}</span>
            </>
          )}
        </Show>
        <Icon name="chevron-down" size="small" class="shrink-0 text-icon-weak-base" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="z-50 w-72 rounded-lg border border-border-weak-base bg-surface-raised-stronger-non-alpha p-1.5 shadow-[var(--shadow-md)]">
          <For each={layout.mode.all}>
            {(mode) => (
              <DropdownMenu.Item
                class="flex items-center gap-2 rounded-md px-2 py-1.5 text-ui-caption text-text-base hover:bg-surface-raised-base-hover"
                onSelect={() => props.onSelect(mode)}
              >
                <span class="size-2 shrink-0 rounded-full" style={{ background: mode.color }} />
                <span class="flex-1 text-left">{mode.shortName}</span>
                <Show when={layout.mode.current() === mode.id}>
                  <Icon name="check" size="small" class="text-icon-weak-base" />
                </Show>
              </DropdownMenu.Item>
            )}
          </For>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  )
}
