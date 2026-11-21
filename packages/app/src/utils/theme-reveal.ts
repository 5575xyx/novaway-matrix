/**
 * 主题/明暗切换的圆形扩散动效：从触发元素中心扩散遮罩，再应用新配色。
 * 放在这里是为了让「外观」弹层与独立的主题切换按钮共用同一套过渡效果。
 */
export function revealThemeChange(event: MouseEvent, apply: () => void) {
  const target = event.currentTarget
  if (!(target instanceof HTMLElement) || typeof document === "undefined") {
    apply()
    return
  }
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
    `background:${readPageBackground()}`,
  ].join(";")

  setRevealMask(overlay, x, y, 0, 0)
  document.body.append(overlay)
  apply()

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

function readPageBackground() {
  const bodyBackground = getComputedStyle(document.body).backgroundColor
  if (bodyBackground && bodyBackground !== "rgba(0, 0, 0, 0)" && bodyBackground !== "transparent") return bodyBackground

  const rootBackground = getComputedStyle(document.documentElement).backgroundColor
  if (rootBackground && rootBackground !== "rgba(0, 0, 0, 0)" && rootBackground !== "transparent") return rootBackground

  return "var(--background-base)"
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
