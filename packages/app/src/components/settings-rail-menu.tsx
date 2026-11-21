import { For, Show, createResource, onCleanup, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon } from "@novaway/ui/icon"
import { Popover } from "@novaway/ui/popover"
import { useTheme, type ColorScheme } from "@novaway/ui/theme/context"
import { useLanguage } from "@/context/language"
import { MAX_CONTENT_WIDTH, MIN_CONTENT_WIDTH, serifStack, useSettings } from "@/context/settings"
import { revealThemeChange } from "@/utils/theme-reveal"

type FontStyleValue = "sans" | "serif" | "kai" | "fangsong" | "yuan" | "xingkai" | "lishu"

const quickThemeIds = ["novaway", "osaka-jade", "gruvbox", "lucent-orng", "dracula"]
const fontStyleOptions: { value: FontStyleValue; label: string }[] = [
  { value: "sans", label: "无衬线" },
  { value: "serif", label: "衬线" },
  { value: "kai", label: "楷体" },
  { value: "fangsong", label: "仿宋" },
  { value: "yuan", label: "圆体" },
  { value: "xingkai", label: "行楷" },
  { value: "lishu", label: "隶书" },
]

/**
 * 图标条最底部的设置入口：点击先弹出小菜单（打开设置 / 外观）。
 * 「外观」悬停时在右侧另起一个独立浮层（外层菜单保持原尺寸，不被撑宽），
 * 调节明暗、主题、字体、字号、内容宽度。
 */
export const SettingsRailMenu: Component<{ onOpenSettings: () => void; settingsOpen?: boolean }> = (props) => {
  const theme = useTheme()
  const language = useLanguage()
  const settings = useSettings()
  const [themePresets] = createResource(() => theme.loadThemes())
  const [state, setState] = createStore({ open: false, appearance: false })
  // 从「外观」移到右侧子面板要跨过一条间隙：离开时延迟关闭，
  // 进入子面板（或回到「外观」）时取消，避免浮层闪退。
  let closeTimer: number | undefined
  let appearanceEl: HTMLDivElement | undefined

  const openAppearance = () => {
    window.clearTimeout(closeTimer)
    setState("appearance", true)
  }
  const scheduleCloseAppearance = () => {
    window.clearTimeout(closeTimer)
    closeTimer = window.setTimeout(() => setState("appearance", false), 150)
  }
  onCleanup(() => window.clearTimeout(closeTimer))

  const schemeOptions: { value: ColorScheme; label: string }[] = [
    { value: "light", label: language.t("theme.scheme.light") },
    { value: "dark", label: language.t("theme.scheme.dark") },
    { value: "system", label: language.t("theme.scheme.system") },
  ]

  const setScheme = (scheme: ColorScheme) => (event: MouseEvent) => {
    if (theme.colorScheme() === scheme) return
    revealThemeChange(event, () => theme.setColorScheme(scheme))
  }

  const themeSwatch = (id: string) => {
    const variant = themePresets()?.[id]?.light
    return variant?.palette?.primary ?? variant?.seeds?.primary ?? "var(--interactive-base)"
  }

  const contentWidthValue = () =>
    settings.appearance.contentWidthPx() ??
    ({ small: 680, standard: 820, wide: 1080 } as const)[settings.appearance.contentWidth()]

  const sectionLabel = (text: string) => <div class="px-2 pt-2 pb-1 text-11-regular text-foreground-subtle">{text}</div>

  return (
    <Popover
      placement="right-end"
      gutter={8}
      style={{ width: "200px", padding: 0 }}
      open={state.open}
      onOpenChange={(open) => setState({ open, appearance: false })}
      onOpenAutoFocus={(event) => event.preventDefault()}
      // 子面板是独立浮层：在它里面点/聚焦不该把外层菜单关掉。
      outsideIgnore={() => [appearanceEl]}
      triggerAs="button"
      triggerProps={{
        type: "button",
        "aria-label": language.t("sidebar.settings"),
        "aria-current": props.settingsOpen ? "page" : undefined,
        class:
          "group relative flex size-10 shrink-0 items-center justify-center rounded-[10px] text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground",
        classList: { "text-foreground": !!props.settingsOpen },
      }}
      trigger={
        <>
          <Icon name="settings-gear" size="normal" class="transition-transform duration-150 group-hover:scale-105" />
          <Show when={props.settingsOpen}>
            <span class="pointer-events-none absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-[var(--mode-accent,var(--border-hover))]" />
          </Show>
        </>
      }
    >
      <div class="flex flex-col gap-0.5 p-1">
        <button
          type="button"
          data-action="rail-menu-open-settings"
          class="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-12-regular text-foreground transition-colors hover:bg-hover"
          onMouseEnter={scheduleCloseAppearance}
          onClick={() => {
            setState({ open: false, appearance: false })
            props.onOpenSettings()
          }}
        >
          <Icon name="settings-gear" size="small" class="shrink-0 text-foreground-subtle" />
          {language.t("command.settings.open")}
        </button>
        <Popover
          placement="right-start"
          gutter={6}
          style={{ width: "264px", padding: 0 }}
          open={state.appearance}
          onOpenChange={(open) => setState("appearance", open)}
          onOpenAutoFocus={(event) => event.preventDefault()}
          triggerAs="button"
          triggerProps={{
            type: "button",
            "aria-expanded": state.appearance,
            class:
              "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-12-regular text-foreground transition-colors hover:bg-hover",
            classList: { "bg-hover": state.appearance },
            onMouseEnter: openAppearance,
            onFocus: openAppearance,
            onMouseLeave: scheduleCloseAppearance,
            // 悬停已展开时再点一下不该把面板收起来，点击只负责打开。
            onClick: openAppearance,
          }}
          trigger={
            <>
              <span class="flex items-center gap-2">
                <Icon name="sliders" size="small" class="shrink-0 text-foreground-subtle" />
                {language.t("settings.general.section.appearance")}
              </span>
              <Icon name="chevron-right" size="small" class="shrink-0 text-foreground-subtle" />
            </>
          }
        >
          <div
            ref={appearanceEl}
            data-action="rail-appearance-panel"
            class="pb-2"
            onMouseEnter={openAppearance}
            onMouseLeave={scheduleCloseAppearance}
          >
            {sectionLabel("明暗模式")}
            <div class="flex gap-1 px-2">
              <For each={schemeOptions}>
                {(option) => (
                  <button
                    type="button"
                    data-quick-scheme={option.value}
                    aria-pressed={theme.colorScheme() === option.value}
                    class="flex-1 rounded-md border border-border bg-background px-2 py-1 text-12-regular text-foreground transition-colors hover:border-border-hover hover:bg-hover"
                    classList={{
                      "border-interactive-base/60 bg-surface-interactive-weak": theme.colorScheme() === option.value,
                    }}
                    onClick={setScheme(option.value)}
                  >
                    {option.label}
                  </button>
                )}
              </For>
            </div>

            {sectionLabel(language.t("settings.general.appearance.theme.title"))}
            <div class="flex flex-wrap gap-1.5 px-2">
              <For each={quickThemeIds}>
                {(id) => (
                  <button
                    type="button"
                    data-quick-theme={id}
                    aria-label={theme.name(id)}
                    title={theme.name(id)}
                    aria-pressed={theme.themeId() === id}
                    class="size-6 rounded-full border-2 border-transparent transition-transform hover:scale-110"
                    classList={{ "border-foreground": theme.themeId() === id }}
                    style={{ background: themeSwatch(id) }}
                    onClick={() => theme.setTheme(id)}
                  />
                )}
              </For>
            </div>

            {sectionLabel(language.t("settings.general.appearance.fontStyle.title"))}
            <div class="flex flex-wrap gap-1 px-2">
              <For each={fontStyleOptions}>
                {(option) => (
                  <button
                    type="button"
                    data-quick-font-style={option.value}
                    class="rounded-md border border-border bg-background px-2 py-1 text-12-regular text-foreground transition-colors hover:border-border-hover hover:bg-hover"
                    classList={{
                      "border-interactive-base/60 bg-surface-interactive-weak":
                        settings.appearance.fontStyle() === option.value,
                    }}
                    style={{ "font-family": serifStack(option.value) ?? "" }}
                    onClick={() => settings.appearance.setFontStyle(option.value)}
                  >
                    {option.label}
                  </button>
                )}
              </For>
            </div>

            {sectionLabel(
              `${language.t("settings.general.appearance.fontSize.title")} · ${settings.appearance.fontSize()}px`,
            )}
            <input
              type="range"
              min="12"
              max="16"
              step="1"
              class="mx-2 w-[calc(100%-1rem)] accent-[var(--button-primary-base)]"
              value={settings.appearance.fontSize()}
              onInput={(e) => settings.appearance.setFontSize(Number(e.currentTarget.value))}
              aria-label="文字大小"
            />

            {sectionLabel(`${language.t("settings.general.appearance.contentWidth.title")} · ${contentWidthValue()}px`)}
            <input
              type="range"
              min={MIN_CONTENT_WIDTH}
              max={MAX_CONTENT_WIDTH}
              step="20"
              class="mx-2 w-[calc(100%-1rem)] accent-[var(--button-primary-base)]"
              value={contentWidthValue()}
              onInput={(e) => settings.appearance.setContentWidthPx(Number(e.currentTarget.value))}
              aria-label="内容宽度"
            />

            <Show when={settings.appearance.contentWidthPx()}>
              <button
                type="button"
                class="mx-2 mt-1 rounded-md px-2 py-1 text-left text-11-regular text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
                onClick={() => settings.appearance.setContentWidthPx(undefined)}
              >
                恢复默认宽度档位
              </button>
            </Show>
          </div>
        </Popover>
      </div>
    </Popover>
  )
}
