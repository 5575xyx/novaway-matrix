import { createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { Popover } from "@novaway/ui/popover"
import { Icon } from "@novaway/ui/icon"
import { useLanguage } from "@/context/language"
import { useLayout, type AppModeConfig } from "@/context/layout"
import { ModeGlyph } from "./mode-visual"

/**
 * 工作台选择器：Creova 保留为直接入口，插件工作台集中在第二颗胶囊里。
 * 鼠标移入、键盘 focus 或点击工作台胶囊都会打开选择面板；选择后胶囊标题
 * 直接变成新的工作台名称（例如「办公」→「运营」）。
 */
export function ModeSwitchButton(props: {
  onSelect: (mode: AppModeConfig) => void
  /** 顶带里的小胶囊形态：和图标按钮同高（h-7）。 */
  compact?: boolean
}) {
  const layout = useLayout()
  const language = useLanguage()
  const modes = () => layout.mode.all()
  const workbenches = createMemo(() => modes().filter((mode) => mode.id !== "forge"))
  const currentWorkbench = createMemo(() => {
    const current = layout.mode.current()
    return workbenches().find((mode) => mode.id === current) ?? workbenches()[0]
  })
  const [open, setOpen] = createSignal(false)
  let closeTimer: number | undefined

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
    setOpen(false)
    props.onSelect(mode)
  }
  onCleanup(cancelClose)

  return (
    <div class="flex shrink-0 items-center gap-1">
      <For each={modes().filter((mode) => mode.id === "forge")}>
        {(mode) => (
          <button
            type="button"
            role="radio"
            aria-checked={layout.mode.current() === mode.id}
            class="relative flex h-7 items-center gap-1 rounded-full border px-2 text-12-semibold transition-colors hover:bg-hover"
            classList={{
              "text-foreground": layout.mode.current() === mode.id,
              "text-foreground-subtle": layout.mode.current() !== mode.id,
            }}
            style={{
              "border-color": `color-mix(in srgb, ${mode.color} 45%, var(--border))`,
              color: layout.mode.current() === mode.id ? mode.color : undefined,
            }}
            onClick={() => select(mode)}
          >
            <ModeGlyph mode={mode} class="size-3.5 shrink-0" />
            <span>{mode.shortName}</span>
          </button>
        )}
      </For>
      <Show when={currentWorkbench()}>
        {(active) => (
          <Popover
            open={open()}
            onOpenChange={(value) => {
              cancelClose()
              setOpen(value)
            }}
            placement="bottom-start"
            gutter={6}
            class="w-64 rounded-xl border border-border bg-popover p-1.5 shadow-[var(--shadow-md)]"
          >
            <button
              type="button"
              role="combobox"
              aria-label={language.t("mode.switch.ariaLabel")}
              aria-expanded={open()}
              class="flex h-7 max-w-[150px] items-center gap-1.5 rounded-full border px-2 text-12-semibold text-foreground transition-colors hover:bg-hover data-[state=open]:bg-hover"
              style={{ "border-color": `color-mix(in srgb, ${active().color} 45%, var(--border))` }}
              onMouseEnter={cancelClose}
              onMouseLeave={scheduleClose}
              onFocus={() => {
                cancelClose()
                setOpen(true)
              }}
              onClick={() => {
                cancelClose()
                setOpen((value) => !value)
              }}
            >
              <ModeGlyph mode={active()} class="size-3.5 shrink-0" />
              <span class="truncate">{active().shortName}</span>
              <Icon name="chevron-down" size="small" class="shrink-0 text-foreground-subtlest" />
            </button>
            <div
              data-slot="mode-switch-popover"
              class="flex flex-col gap-0.5"
              onMouseEnter={cancelClose}
              onMouseLeave={scheduleClose}
            >
              <div class="px-2 pb-1 pt-1 text-11-medium text-foreground-subtle">选择工作台</div>
              <For each={workbenches()}>
                {(mode) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={layout.mode.current() === mode.id}
                    class="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-hover"
                    classList={{ "bg-hover": layout.mode.current() === mode.id }}
                    onClick={() => select(mode)}
                  >
                    <ModeGlyph mode={mode} class="mt-0.5 size-4 shrink-0" />
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-12-medium text-foreground">{mode.name}</span>
                      <span class="mt-0.5 block truncate text-11-regular text-foreground-subtle">
                        {mode.description}
                      </span>
                    </span>
                    <Show when={layout.mode.current() === mode.id}>
                      <Icon name="check" size="small" class="mt-0.5 shrink-0 text-success-base" />
                    </Show>
                  </button>
                )}
              </For>
            </div>
          </Popover>
        )}
      </Show>
    </div>
  )
}
