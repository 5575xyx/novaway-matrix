import { useTheme, type ColorScheme } from "@novaway/ui/theme/context"
import { Tooltip } from "@novaway/ui/tooltip"
import { useLanguage } from "@/context/language"
import { revealThemeChange } from "@/utils/theme-reveal"

export function ThemeSchemeToggle(props: { variant?: "row" | "icon" }) {
  const theme = useTheme()
  const language = useLanguage()
  const isDark = () => theme.mode() === "dark"
  const nextScheme = (): ColorScheme => (isDark() ? "light" : "dark")
  const title = () => language.t(isDark() ? "theme.toggle.light" : "theme.toggle.dark")
  // 主题切换沿用圆形扩散效果（见 utils/theme-reveal）。
  const toggle = (event: MouseEvent) => revealThemeChange(event, () => theme.setColorScheme(nextScheme()))

  const icon = () => (
    <span
      class="flex size-6.5 shrink-0 items-center justify-center rounded-[7px] [&_svg]:size-[17px]"
      style={{
        color: "var(--icon-interactive-base)",
        background: "color-mix(in srgb, currentColor 14%, transparent)",
      }}
    >
      {isDark() ? <MoonIcon /> : <SunIcon />}
    </span>
  )

  // 图标条形态：只留图标，名称靠 hover 的 Tooltip（和同一列的其他图标一致）。
  if (props.variant === "icon") {
    return (
      <Tooltip value={title()} placement="right" gutter={10}>
        <button
          type="button"
          data-component="sidebar-rail-item"
          class="group flex size-10 shrink-0 items-center justify-center rounded-[10px] text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
          aria-label={title()}
          onClick={toggle}
        >
          {icon()}
        </button>
      </Tooltip>
    )
  }

  // 侧栏顶部菜单是一行一项的竖排形态:标签直接写在行内,不再靠 tooltip 认功能。
  return (
    <button
      type="button"
      class="group flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-[15px] font-medium text-foreground transition-colors hover:bg-hover"
      aria-label={title()}
      onClick={toggle}
    >
      {icon()}
      <span class="flex-1 truncate text-left">{title()}</span>
    </button>
  )
}

function SunIcon() {
  return (
    <svg
      class="size-4 transition-transform duration-200 group-hover:rotate-45 group-hover:scale-110"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M10 1.875V4.16667M10 15.8333V18.125M4.16667 10H1.875M18.125 10H15.8333M5.875 5.875L4.25 4.25M15.75 15.75L14.125 14.125M14.125 5.875L15.75 4.25M4.25 15.75L5.875 14.125M13.3333 10C13.3333 11.841 11.841 13.3333 10 13.3333C8.15905 13.3333 6.66667 11.841 6.66667 10C6.66667 8.15905 8.15905 6.66667 10 6.66667C11.841 6.66667 13.3333 8.15905 13.3333 10Z"
        stroke="currentColor"
        stroke-linecap="square"
      />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg
      class="size-4 transition-transform duration-200 group-hover:-rotate-12 group-hover:scale-110"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M16.25 12.5529C15.3187 13.1367 14.2172 13.4738 13.0364 13.4738C9.68333 13.4738 6.9654 10.7559 6.9654 7.40277C6.9654 6.28242 7.26896 5.23299 7.79829 4.33228C4.89114 5.12415 2.85718 7.7719 2.85718 10.8334C2.85718 14.5603 5.88026 17.143 9.58342 17.143C12.6437 17.143 15.2088 15.1067 16.25 12.5529Z"
        stroke="currentColor"
        stroke-linejoin="round"
      />
    </svg>
  )
}
