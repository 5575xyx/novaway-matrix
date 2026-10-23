/**
 * 「从点击位置展开」动效的共享工具。
 *
 * 弹窗、整帧面板、下拉层都希望从用户刚才点击的位置「长出来」，
 * 而不是永远从正中间缩放进场。浏览器只给我们 pointerdown 的坐标，
 * 这里把它记下来并折算成元素的 transform-origin。
 */

export type Point = { x: number; y: number }

let current: Point | undefined
let installed = false

/** 惰性安装一次全局监听，避免每个组件各加一个。 */
function install() {
  if (installed || typeof window === "undefined") return
  installed = true
  window.addEventListener(
    "pointerdown",
    (event) => {
      current = { x: event.clientX, y: event.clientY }
      // 根节点也记一份：整帧面板（settings / 数据库 / 扩展…）在 CSS 里
      // 直接用 `transform-origin: var(--last-pointer-x) var(--last-pointer-y)`
      // 就能从点击处展开，不需要每个面板各自接 JS。
      document.documentElement.style.setProperty("--last-pointer-x", event.clientX + "px")
      document.documentElement.style.setProperty("--last-pointer-y", event.clientY + "px")
      // 顺带给 `[data-pressable]` 元素写入涟漪中心，CSS 里用 :active 播放。
      const target = event.target as Element | null
      const pressable = target?.closest?.("[data-pressable]") as HTMLElement | null
      if (!pressable) return
      const rect = pressable.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      pressable.style.setProperty("--ripple-x", event.clientX - rect.left + "px")
      pressable.style.setProperty("--ripple-y", event.clientY - rect.top + "px")
    },
    { capture: true, passive: true },
  )
}

/** 显式安装监听（应用入口调用一次即可）；lastPointerOrigin 也会惰性安装。 */
export function installPointerTracking() {
  install()
}

export function lastPointerOrigin(): Point | undefined {
  install()
  return current
}

/**
 * 把「上次点击位置」折算成元素的 transform-origin（百分比），写到 CSS 变量。
 *
 * 只在点击确实落在元素可见范围内时才采用，否则退回中心 —— 例如用快捷键
 * 打开弹窗时，鼠标可能停在屏幕角落，从那里展开会很怪。
 */
export function applyPointerOrigin(element: HTMLElement | undefined | null) {
  if (!element) return
  const origin = lastPointerOrigin()
  if (!origin) return
  const rect = element.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return
  const inside = origin.x >= rect.left && origin.x <= rect.right && origin.y >= rect.top && origin.y <= rect.bottom
  const x = inside ? ((origin.x - rect.left) / rect.width) * 100 : 50
  const y = inside ? ((origin.y - rect.top) / rect.height) * 100 : 50
  element.style.setProperty("--pointer-origin-x", clamp(x) + "%")
  element.style.setProperty("--pointer-origin-y", clamp(y) + "%")
}

function clamp(value: number) {
  // 稍微向内收一点：origin 贴在边角上时，缩放会让内容「甩」得很明显。
  return Math.min(92, Math.max(8, value)).toFixed(2)
}

export * as PointerOrigin from "./pointer-origin"
