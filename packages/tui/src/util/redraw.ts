import type { CliRenderer } from "@opentui/core"

export type Size = { width: number; height: number }

/**
 * 算出"强制全量重绘"需要走的 resize 步骤。
 *
 * 为什么要绕这么一圈:opentui 的 `processResize` 开头就是
 * `if (width === this._terminalWidth && height === this._terminalHeight) return`,
 * 尺寸没变就直接返回。而 SIGWINCH 是唯一的 resize 来源,所以一旦画面画花了
 * (脏格、滚动错位、启动时按 80x24 兜底尺寸画出来的"显示不全"),
 * 除了手动拉伸窗口之外**没有任何**自愈路径 —— 这也是现在整个 TUI 没有重绘键位的后果。
 *
 * 所以:
 * - 终端真实尺寸和渲染器当前记的不一样(典型情况:启动时拿到的是 80x24 兜底值),
 *   直接喂真实尺寸,一步就同时修好尺寸和重绘;
 * - 尺寸本来就是对的,先喂一个窄 1 列的假尺寸再喂回真实尺寸,逼它重排两次。
 */
export function redrawSteps(input: { current: Size; actual: Partial<Size> }): Size[] {
  const width = input.actual.width && input.actual.width > 0 ? input.actual.width : input.current.width
  const height = input.actual.height && input.actual.height > 0 ? input.actual.height : input.current.height
  const target = { width, height }
  if (width !== input.current.width || height !== input.current.height) return [target]
  return [{ width: Math.max(1, width - 1), height }, target]
}

/** 重新读一遍终端真实尺寸,然后强制重排 + 全量重绘。 */
export function redraw(renderer: CliRenderer) {
  if (renderer.isDestroyed) return
  const steps = redrawSteps({
    current: { width: renderer.terminalWidth, height: renderer.terminalHeight },
    actual: { width: process.stdout.columns, height: process.stdout.rows },
  })
  for (const step of steps) renderer.resize(step.width, step.height)
  renderer.requestRender()
}
