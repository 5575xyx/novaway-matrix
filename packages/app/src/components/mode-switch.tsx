import { For, Show } from "solid-js"
import { DropdownMenu } from "@novaway/ui/dropdown-menu"
import { Icon } from "@novaway/ui/icon"
import { useLanguage } from "@/context/language"
import { useLayout, type AppModeConfig } from "@/context/layout"

export function ModeSwitchButton(props: {
  onSelect: (mode: AppModeConfig) => void
  /** 侧栏顶部的主入口形态：整宽、大字重、带模式的色彩底板。 */
  prominent?: boolean
  /** 顶带里的小胶囊形态：和"新建任务"同高，放在 logo 右侧的留白里。 */
  compact?: boolean
  fullWidth?: boolean
}) {
  const layout = useLayout()
  const language = useLanguage()
  const current = () => layout.mode.all.find((m) => m.id === layout.mode.current())
  const prominent = () => !!props.prominent

  return (
    <DropdownMenu placement="bottom" gutter={8}>
      <DropdownMenu.Trigger
        classList={{
          "flex items-center gap-2 rounded-md px-2 text-foreground transition-colors": true,
          // 默认（表单里的中等尺寸）。
          "h-8 border border-border bg-surface text-14-semibold hover:bg-hover data-[expanded]:border-border-hover":
            !props.fullWidth && !prominent() && !props.compact,
          "w-full py-1.5 text-14-semibold hover:bg-hover data-[expanded]:bg-surface":
            !!props.fullWidth && !prominent() && !props.compact,
          // 顶部的「模式」是全局最重的入口：字号抬到 ui-xl、字重 600、
          // 底色取自当前模式色（12% 混色），展开时再加深一档。
          "w-full h-11 rounded-xl border px-3 text-ui-xl font-semibold": prominent(),
          "border-[color-mix(in_srgb,var(--mode-accent)_45%,var(--border))] bg-[color-mix(in_srgb,var(--mode-accent)_12%,var(--background))] hover:bg-[color-mix(in_srgb,var(--mode-accent)_18%,var(--background))]":
            prominent(),
          // 顶带胶囊：高度和侧栏顶带里的图标按钮一致，不再撑出第二条工具栏。
          "h-7 shrink-0 rounded-lg border px-2 text-13-semibold": props.compact,
          "border-[color-mix(in_srgb,var(--mode-accent)_45%,var(--border))] bg-[color-mix(in_srgb,var(--mode-accent)_10%,var(--background))] hover:bg-[color-mix(in_srgb,var(--mode-accent)_20%,var(--background))]":
            props.compact,
        }}
        style={{ "--mode-accent": current()?.color ?? "var(--border-hover)" }}
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
              <span
                class={`shrink-0 rounded-full ${prominent() ? "size-2.5" : "size-2"}`}
                style={{ background: mode().color }}
              />
              <span class="min-w-0 flex-1 truncate text-left text-foreground">{mode().shortName}</span>
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
