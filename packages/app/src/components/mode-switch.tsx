import { For } from "solid-js"
import { useLanguage } from "@/context/language"
import { useLayout, type AppModeConfig } from "@/context/layout"
import { ModeGlyph } from "./mode-visual"

/**
 * 工作模式开关：胶囊分段控件（不是下拉）。
 * 选中项是一块带模式色的滑块，用 transform 平移过渡；
 * 模式数量 > 2 时自动变成等宽多段，无需改结构。
 */
export function ModeSwitchButton(props: {
  onSelect: (mode: AppModeConfig) => void
  /** 顶带里的小胶囊形态：和图标按钮同高（h-7）。 */
  compact?: boolean
}) {
  const layout = useLayout()
  const language = useLanguage()
  const modes = () => layout.mode.all()
  const activeIndex = () => modes().findIndex((mode) => mode.id === layout.mode.current())
  const accent = () => modes()[activeIndex()]?.color ?? "var(--border-hover)"
  const buttons: HTMLButtonElement[] = []

  const onKeyDown = (event: KeyboardEvent) => {
    const delta =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0
    if (!delta) return
    event.preventDefault()
    const from = activeIndex() >= 0 ? activeIndex() : 0
    const next = (from + delta + modes().length) % modes().length
    props.onSelect(modes()[next])
    buttons[next]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label={language.t("mode.switch.ariaLabel")}
      data-component="mode-switch"
      class="relative inline-grid shrink-0 rounded-full border border-border bg-surface p-0.5 transition-[border-color] duration-300"
      classList={{ "h-7": !!props.compact, "h-9": !props.compact }}
      style={{
        "grid-template-columns": `repeat(${modes().length}, minmax(0, 1fr))`,
        "border-color": `color-mix(in srgb, ${accent()} 28%, var(--border))`,
      }}
      onKeyDown={onKeyDown}
    >
      {/* 滑块：宽度 = 单段宽度，translateX 按段索引平移；未选择模式时淡出。 */}
      <span
        aria-hidden
        class="pointer-events-none absolute inset-y-0.5 left-0.5 rounded-full border transition-[transform,opacity,background-color,border-color,box-shadow] duration-300 ease-[cubic-bezier(0.34,1.3,0.64,1)]"
        style={{
          width: `calc((100% - 4px) / ${modes().length})`,
          transform: `translateX(${Math.max(activeIndex(), 0) * 100}%)`,
          opacity: activeIndex() >= 0 ? 1 : 0,
          background: `color-mix(in srgb, ${accent()} 16%, var(--background))`,
          "border-color": `color-mix(in srgb, ${accent()} 45%, var(--border))`,
          "box-shadow": `0 1px 8px color-mix(in srgb, ${accent()} 26%, transparent)`,
        }}
      />
      <For each={modes()}>
        {(mode, index) => (
          <button
            type="button"
            role="radio"
            aria-checked={layout.mode.current() === mode.id}
            tabIndex={layout.mode.current() === mode.id || (activeIndex() < 0 && index() === 0) ? 0 : -1}
            ref={(el) => (buttons[index()] = el)}
            class="relative z-10 flex items-center justify-center rounded-full text-foreground-subtle transition-colors duration-300 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-hover)]"
            classList={{
              "gap-1 px-2 text-12-semibold": !!props.compact,
              "gap-1.5 px-3 text-13-semibold": !props.compact,
            }}
            style={{ color: layout.mode.current() === mode.id ? mode.color : undefined }}
            onClick={() => props.onSelect(mode)}
          >
            <ModeGlyph mode={mode} class={props.compact ? "size-3.5 shrink-0" : "size-4 shrink-0"} />
            <span class="truncate">{mode.shortName}</span>
          </button>
        )}
      </For>
    </div>
  )
}
