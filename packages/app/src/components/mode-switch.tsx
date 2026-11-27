import { createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { Popover } from "@novaway/ui/popover"
import { Icon } from "@novaway/ui/icon"
import { useLanguage } from "@/context/language"
import { useLayout, type AppModeConfig } from "@/context/layout"
import { ModeGlyph } from "./mode-visual"

/**
 * 单一当前工作台切换器。
 *
 * 顶部只显示当前工作台，不再同时显示 Creova 和另一个工作台；鼠标移入、
 * focus 或点击当前工作台后，从菜单中选择目标工作台。这样顶部入口表达的
 * 是“当前工作台”，而不是一组并排的模式按钮。
 */
export function ModeSwitchButton(props: { onSelect: (mode: AppModeConfig) => void; compact?: boolean }) {
  const layout = useLayout()
  const language = useLanguage()
  const modes = createMemo(() => layout.mode.all())
  const active = createMemo(() => modes().find((mode) => mode.id === layout.mode.current()) ?? modes()[0])
  const choices = createMemo(() => modes().filter((mode) => mode.id !== active()?.id))
  const [open, setOpen] = createSignal(false)
  let closeTimer: number | undefined
  let suppressFocusOpen = false

  const cancelClose = () => {
    if (closeTimer !== undefined) window.clearTimeout(closeTimer)
    closeTimer = undefined
  }
  const scheduleClose = () => {
    cancelClose()
    closeTimer = window.setTimeout(() => setOpen(false), 180)
  }
  const select = (mode: AppModeConfig) => {
    cancelClose()
    suppressFocusOpen = true
    setOpen(false)
    props.onSelect(mode)
    window.setTimeout(() => {
      suppressFocusOpen = false
    }, 300)
  }
  onCleanup(cancelClose)

  return (
    <Show when={active()}>
      {(mode) => (
        <Popover
          triggerAs="button"
          trigger={
            <>
              <span style={{ color: mode().color }}>
                <ModeGlyph mode={mode()} class="size-3.5 shrink-0 transition-transform duration-200" />
              </span>
              <span class="truncate">{mode().name}</span>
              <Icon
                name="chevron-down"
                size="small"
                class="shrink-0 text-foreground-subtlest transition-transform duration-200"
              />
            </>
          }
          triggerProps={{
            type: "button",
            role: "combobox",
            "aria-label": language.t("mode.switch.ariaLabel"),
            "aria-expanded": open(),
            title: mode().description,
            class:
              "flex h-7 max-w-[180px] min-w-0 shrink-0 items-center gap-1.5 rounded-full border px-2 text-12-semibold transition-all duration-200 ease-out hover:bg-hover data-[state=open]:bg-hover",
            style: {
              "border-color": `color-mix(in srgb, ${mode().color} 55%, var(--border))`,
              color: mode().color,
            },
            onMouseEnter: () => {
              if (suppressFocusOpen) return
              cancelClose()
              setOpen(true)
            },
            onMouseLeave: scheduleClose,
            onFocus: () => {
              if (suppressFocusOpen) return
              cancelClose()
              setOpen(true)
            },
          }}
          open={open()}
          onOpenChange={(value) => {
            cancelClose()
            if (suppressFocusOpen && value) return
            setOpen(value)
          }}
          placement="bottom-start"
          gutter={6}
          class="w-64 rounded-xl border border-border bg-popover p-1.5 shadow-[var(--shadow-md)]"
        >
          <div
            data-slot="mode-switch-popover"
            class="flex flex-col gap-0.5"
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
          >
            <div class="px-2 pb-1 pt-1 text-11-medium text-foreground-subtle">选择工作台</div>
            <For each={choices()}>
              {(choice) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  class="flex w-full items-start gap-2 rounded-lg border border-transparent px-2.5 py-2 text-left transition-all duration-200 hover:bg-hover"
                  onClick={() => select(choice)}
                >
                  <span style={{ color: choice.color }}>
                    <ModeGlyph mode={choice} class="mt-0.5 size-4 shrink-0" />
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-12-medium text-foreground">{choice.name}</span>
                    <span class="mt-0.5 block truncate text-11-regular text-foreground-subtle">
                      {choice.description}
                    </span>
                  </span>
                </button>
              )}
            </For>
          </div>
        </Popover>
      )}
    </Show>
  )
}
