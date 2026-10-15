import { type Accessor, createEffect, createSignal, onCleanup } from "solid-js"

/**
 * 给「瞬间挂载/卸载」的浮层补上**退出**动画。
 *
 * `<Show>` 只有两种状态：在或不在，中间没有过渡帧，所以关闭永远是"啪"地消失。
 * 这个 helper 把状态拆成两个：
 *
 * - `mounted`：要不要留在 DOM 里（关闭后延迟 `durationMs` 才置 false）
 * - `closing`：方向开关，绑到元素的 `data-state` 上，由 CSS **animation** 驱动
 *
 * 这里刻意用 `animation` 而不是 `transition`：
 * transition 要求「元素已在 DOM 里 + 样式从 A 变到 B」，新插入的节点必须先把隐藏态
 * 渲染一帧再改成可见态，否则浏览器把它当成初始样式、一帧过渡都不跑。
 * 而拿「下一帧」的常规手段（rAF）在窗口被遮挡/最小化时会被节流甚至停掉，
 * 面板就会卡在隐藏态（实测出现过 open 之后 opacity 一直是 0）。
 * 新插入元素上的 animation 一定会从头播一次，没有这个时序问题。
 *
 * CSS 侧配对规则见 app/src/index.css 的 `[data-panel-transition]`：
 * `[data-state="open"]` 播入场、`[data-state="closed"]` 播退场。
 */
export function createMountTransition(open: Accessor<boolean>, durationMs = 1000) {
  const [mounted, setMounted] = createSignal(open())
  const [closing, setClosing] = createSignal(!open())
  let timer: ReturnType<typeof setTimeout> | undefined
  let token = 0

  const clear = () => {
    token += 1
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  }

  // 只依赖 open 变化（用上一个值比对），竞态用 token 判断而不是读 mounted()，
  // 免得 mounted 也变成依赖、在自身 effect 里写自己导致重复触发。
  createEffect<boolean | undefined>((prev) => {
    const next = open()
    if (prev === next) return next
    clear()
    if (next) {
      setClosing(false)
      setMounted(true)
      return next
    }
    if (!mounted()) return next
    setClosing(true)
    const mine = token
    timer = setTimeout(() => {
      timer = undefined
      if (mine !== token) return
      setMounted(false)
    }, durationMs)
    return next
  })

  onCleanup(clear)

  return { mounted, closing, durationMs }
}

/**
 * 让一个**常驻**元素的入场动画可以被重复触发。
 *
 * 路由切换时挂载的组件其实没变（Solid 只更新内容，不会重建外层容器），
 * 所以 `.page-transition` 这类 `animation` 只会跑一次。
 * 这里在依赖变化时把类名摘掉再装回去 —— 中间强制一次重排，
 * 否则同一帧内的两次 class 变更会被浏览器合并，动画不会重放。
 */
export function replayAnimation(el: HTMLElement | undefined, className: string) {
  if (!el) return
  el.classList.remove(className)
  void el.offsetWidth
  el.classList.add(className)
}
