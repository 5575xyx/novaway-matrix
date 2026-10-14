import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"

/**
 * 窗口控制（最小化 / 最大化-还原 / 关闭）。
 *
 * 对齐 ZCode：Windows / Linux 桌面端把这三个按钮**内联画在 Header 最右侧**，
 * 主窗口不启用原生 `titleBarOverlay`（两者并存时原生按钮会盖住自绘按钮，
 * 点击被原生按钮吃掉、视觉也重叠）。
 *
 * 按钮尺寸沿用 ZCode 的内联窗控规格：28px 按钮、16px 图标、2px 间距，
 * 关闭按钮 hover 用 destructive 色。整体 `no-drag`，否则点击会被窗口拖拽吞掉。
 */
export function WindowControls() {
  const platform = usePlatform()
  const language = useLanguage()
  const [maximized, setMaximized] = createSignal(false)

  const enabled = () => platform.platform === "desktop" && platform.os !== "macos"

  onMount(() => {
    if (!enabled()) return
    void window.api?.isWindowMaximized?.().then(setMaximized)
    const dispose = window.api?.onWindowMaximizedChange?.(setMaximized)
    onCleanup(() => dispose?.())
  })

  const glyph = (d: string) => (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" class="size-4">
      <path d={d} stroke="currentColor" stroke-width="1.1" />
    </svg>
  )

  return (
    <Show when={enabled()}>
      <div class="flex shrink-0 items-center gap-0.5 pl-1">
        <button
          type="button"
          class="grid size-7 place-items-center rounded-md text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
          aria-label={language.t("window.minimize")}
          title={language.t("window.minimize")}
          onClick={() => void window.api?.minimizeWindow?.()}
        >
          {glyph("M3.5 8h9")}
        </button>
        <button
          type="button"
          class="grid size-7 place-items-center rounded-md text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
          aria-label={language.t(maximized() ? "window.restore" : "window.maximize")}
          title={language.t(maximized() ? "window.restore" : "window.maximize")}
          onClick={() => void window.api?.toggleMaximizeWindow?.()}
        >
          {/* 最大化：一个方框；还原：两个错位的方框 */}
          <Show when={maximized()} fallback={glyph("M4.5 4.5h7v7h-7z")}>
            {glyph("M6.5 6.5h5v5h-5z M4.5 9.5v-5h5")}
          </Show>
        </button>
        <button
          type="button"
          class="grid size-7 place-items-center rounded-md text-foreground-subtle transition-colors hover:bg-destructive hover:text-destructive-foreground"
          aria-label={language.t("window.close")}
          title={language.t("window.close")}
          onClick={() => void window.api?.closeWindow?.()}
        >
          {glyph("M4.5 4.5l7 7M11.5 4.5l-7 7")}
        </button>
      </div>
    </Show>
  )
}
