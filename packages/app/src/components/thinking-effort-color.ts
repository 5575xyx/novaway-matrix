import type { JSX } from "solid-js"

/**
 * 思考强度的配色斜坡：低档安静、高档活跃。
 *
 * 用 OKLCH 而不是 HSL：同样"加饱和"，OKLCH 的明度不会跟着发灰，
 * 高低档之间的观感差距才是线性的。
 *
 * - 色相 162°（青绿）→ 280°（紫），并且做了 `^1.5` 缓入：
 *   低档还留在绿色区（安静），高档才明显往蓝紫走（活跃）。
 * - 彩度随档位升高，终点最艳；明度只是微微抬一点，避免高档发暗。
 *
 * 采样点按档位数均分，所以 3 档 / 5 档 / 6 档模型都落在同一条斜坡上。
 */
const HUE_CALM = 162
const HUE_ACTIVE = 280

export function effortRatio(index: number, count: number) {
  return count <= 1 ? 0 : index / (count - 1)
}

function color(ratio: number, lightness: number, chroma: number) {
  const hue = HUE_CALM + (HUE_ACTIVE - HUE_CALM) * Math.pow(ratio, 1.5)
  return `oklch(${lightness} ${chroma} ${hue})`
}

/** 填充色：越往上越艳。 */
export function effortFill(ratio: number) {
  return color(ratio, 0.58 + 0.06 * ratio, 0.1 + 0.15 * Math.pow(ratio, 1.2))
}

/** 文字色：同一条斜坡，压暗一点保证小字号可读。 */
export function effortText(ratio: number): JSX.CSSProperties {
  return { color: color(ratio, 0.54 + 0.07 * ratio, 0.1 + 0.1 * Math.pow(ratio, 1.2)) }
}
