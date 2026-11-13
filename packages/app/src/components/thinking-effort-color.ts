import type { JSX } from "solid-js"

/** 档位比例仍用于调用方布局与无障碍信息，不再映射到 Agent 身份色。 */
export function effortRatio(index: number, count: number) {
  return count <= 1 ? 0 : index / (count - 1)
}

/** 思考强度属于输入交互状态；色相由交互色语义 token 统一决定。 */
function color(_ratio: number) {
  return "var(--icon-interactive-base)"
}

/** 各档位保持一致的主题交互色，档位差异由文案与控件位置表达。 */
export function effortFill(ratio: number) {
  return color(ratio)
}

/** 文字色：使用主题交互色；档位差异由档位标签与滑块位置表达。 */
export function effortText(ratio: number): JSX.CSSProperties {
  return { color: color(ratio) }
}
