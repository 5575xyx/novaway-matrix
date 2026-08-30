// crush 式 anim spinner 的纯逻辑,从组件里拆出来以便单测。
// 规格(见 crush-design-reference 记忆):38 字符池伪随机扰动 + 渐变沿列滚动 +
// 每列 0~19 帧错峰"出生"(出生前显示渐变色的 ".")、20fps、确定性随机(不碰 Math.random,
// 同一列同一帧永远渲染同一个字符,重绘不闪)。
import { RGBA, type ColorInput } from "@opentui/core"

// 0-9 + a-f + A-F + 16 个符号 = 38,和 crush 的池一致。
const POOL = "0123456789abcdefABCDEF~!@#$£€%^&*()+=_"

// 整数散列:两入参定一输出。用 imul 保证 32 位乘法不丢精度,位运算前 >>>0 归到无符号域。
function hash2(a: number, b: number): number {
  let h = (Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x85ebca6b, 0xc2b2ae35)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x27d4eb2f) >>> 0
  return (h ^ (h >>> 16)) >>> 0
}

// 出生帧偏移用独立种子,免得和"第 0 帧的字符"撞同一个散列值。
const BIRTH_SEED = 0xa5a5

export function animFrames(width: number, count: number, birth = 20): string[] {
  return Array.from({ length: count }, (_, frame) =>
    Array.from({ length: width }, (_, column) => {
      if (frame < hash2(column, BIRTH_SEED) % birth) return "."
      return POOL[hash2(column, frame) % POOL.length]!
    }).join(""),
  )
}

// 亮度波:同一色相沿列做 0.45~1.0 的明暗渐变,相位随帧递增形成"沿列滚动"。
// 不往里混第二种色相 —— 调用方传进来的语义色(warning/accent/…)保持原 hue 不被冲掉。
export function animColors(base: RGBA) {
  return (frameIndex: number, charIndex: number, _totalFrames: number, totalChars: number): ColorInput => {
    const t = ((charIndex + frameIndex) % totalChars) / totalChars
    const factor = 0.45 + 0.55 * t
    return RGBA.fromValues(
      Math.min(1, base.r * factor),
      Math.min(1, base.g * factor),
      Math.min(1, base.b * factor),
      base.a,
    )
  }
}
