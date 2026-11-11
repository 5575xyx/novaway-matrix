import type { JSX } from "solid-js"

/**
 * 思考强度颜色从主题的交互色渐变到计划色：级别仍有连续的视觉变化，
 * 但色相完全由当前主题 palette 决定，不再固定为青绿到紫色。
 */
export function effortRatio(index: number, count: number) {
  return count <= 1 ? 0 : index / (count - 1)
}

function color(ratio: number) {
  const progress = Math.max(0, Math.min(1, ratio))
  return `color-mix(in oklab, var(--icon-interactive-base) ${(1 - progress) * 100}%, var(--icon-agent-plan-base) ${progress * 100}%)`
}

/** 填充色：低档到高档在主题交互色与计划色之间渐变。 */
export function effortFill(ratio: number) {
  return color(ratio)
}

/** 文字色：保持同一主题渐变，级别差异由颜色混合比例表达。 */
export function effortText(ratio: number): JSX.CSSProperties {
  return { color: color(ratio) }
}
