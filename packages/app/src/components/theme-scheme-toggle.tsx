import { Tooltip } from "@novaway/ui/tooltip"
import { useTheme, type ColorScheme } from "@novaway/ui/theme/context"

export function ThemeSchemeToggle() {
  const theme = useTheme()
  const isDark = () => theme.mode() === "dark"
  const nextScheme = (): ColorScheme => (isDark() ? "light" : "dark")
  const title = () => (isDark() ? "切换为浅色模式" : "切换为深色模式")
  const toggle = (event: MouseEvent) => {
    const next = nextScheme()
    const target = event.currentTarget as HTMLElement
    const rect = target.getBoundingClientRect()
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
    const overlay = document.createElement("div")

    overlay.style.cssText = [
      "position:fixed",
      "inset:0",
      "pointer-events:none",
      "z-index:2147483647",
      `background:${readPageBackground(next)}`,
    ].join(";")

    setRevealMask(overlay, x, y, 0, 0)
    document.body.append(overlay)
    theme.setColorScheme(next)

    const startedAt = performance.now()
    const duration = 3000
    const animate = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration)
      const eased = 1 - Math.pow(1 - progress, 3)
      setRevealMask(overlay, x, y, radius * eased, progress)
      if (progress < 1) {
        requestAnimationFrame(animate)
        return
      }
      overlay.style.opacity = "0"
      window.setTimeout(() => overlay.remove(), 420)
    }

    requestAnimationFrame(() => {
      overlay.style.transition = "opacity 420ms ease"
      requestAnimationFrame(animate)
    })
  }

  return (
    <Tooltip value={title()} placement="bottom">
      <button
        type="button"
        class="group grid size-9 place-items-center rounded-[8px] border border-border-weak-base bg-background-base/80 text-text-base shadow-[0_8px_24px_rgba(15,23,42,0.08)] outline-none transition-all hover:-translate-y-px hover:border-cyan-300/50 hover:bg-cyan-300/10 hover:text-cyan-600 focus-visible:border-cyan-300/70 focus-visible:ring-2 focus-visible:ring-cyan-300/25 active:translate-y-0 active:scale-[0.98] dark:shadow-[0_8px_24px_rgba(0,0,0,0.24)] dark:hover:text-cyan-100"
        aria-label={title()}
        onClick={toggle}
      >
        {isDark() ? <MoonIcon /> : <SunIcon />}
      </button>
    </Tooltip>
  )
}

function readPageBackground(next: ColorScheme) {
  const bodyBackground = getComputedStyle(document.body).backgroundColor
  if (bodyBackground && bodyBackground !== "rgba(0, 0, 0, 0)" && bodyBackground !== "transparent") return bodyBackground

  const rootBackground = getComputedStyle(document.documentElement).backgroundColor
  if (rootBackground && rootBackground !== "rgba(0, 0, 0, 0)" && rootBackground !== "transparent") return rootBackground

  return next === "dark" ? "#F8FAFC" : "#020817"
}

function setRevealMask(element: HTMLElement, x: number, y: number, radius: number, progress: number) {
  const width = window.innerWidth
  const height = window.innerHeight
  const points = Array.from({ length: 96 }, (_, index) => {
    const angle = (index / 96) * Math.PI * 2
    const waveStrength = Math.min(18, radius * 0.035) * Math.sin(Math.PI * progress)
    const wavedRadius =
      radius +
      Math.sin(angle * 7 + progress * Math.PI * 4) * waveStrength +
      Math.sin(angle * 13 - progress * Math.PI * 3) * waveStrength * 0.45

    return `${x + Math.cos(angle) * wavedRadius},${y + Math.sin(angle) * wavedRadius}`
  }).join(" L ")
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<path fill="black" fill-rule="evenodd" d="M0 0H${width}V${height}H0Z M${points} Z"/>`,
    "</svg>",
  ].join("")
  const mask = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
  element.style.maskImage = mask
  element.style.webkitMaskImage = mask
}

function SunIcon() {
  return (
    <svg
      class="size-5 transition-transform duration-200 group-hover:rotate-45 group-hover:scale-110"
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
      class="size-5 transition-transform duration-200 group-hover:-rotate-12 group-hover:scale-110"
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
