import { expect, test } from "bun:test"
import { sweepBehind, sweepMix } from "../../src/ui/card"
import { perimeterCells } from "../../src/ui/neon"

// 扫光的数学契约。集成层(卡片测试)只能做「动画时颜色变 / 静止时不变」这类差分断言 ——
// 任何依赖「第一帧恰好落在某个相位」的断言都会在慢机器上红。这里全部按纯函数锁死。

const WIDTH = 0.12
const PEAK = 0.55

test("t = 0 与 t = 1 是周长上的同一个接缝,都算「头部」", () => {
  // perimeterCells 给首格 t = 0、末格 t = 1,两者在周长上是同一点。
  expect(sweepBehind(0, 0)).toBe(0)
  expect(sweepBehind(0, 1)).toBe(0)
  expect(sweepMix(0, 0)).toBeCloseTo(PEAK, 10)
  expect(sweepMix(0, 1)).toBeCloseTo(PEAK, 10)
  // 不管相位走到哪,接缝格始终紧跟相位头
  expect(sweepBehind(0.5, 0.5)).toBeCloseTo(0, 10)
  expect(sweepBehind(0.5, 1.5)).toBeCloseTo(0, 10)
})

test("相位回绕处窗口连续:0.99 之后紧接 0.00,窗口不跳", () => {
  // 头在 0.98 时的「后方 0.01 格」= 0.99;头绕回 0.00 后的「后方 0.01 格」= 0.99。
  // 直接相减会在这两帧之间算出 +0.99(窗口整段跳走),mod-1 必须是 0.01。
  expect(sweepBehind(0.99, 0.98)).toBeCloseTo(0.01, 10)
  expect(sweepBehind(0, 0.99)).toBeCloseTo(0.01, 10)
  // 两端的提亮量也要连续,否则接缝处会看到扫光带闪一下
  expect(sweepMix(0.99, 0.98)).toBeCloseTo(sweepMix(0, 0.99), 10)
})

test("窗口边界:behind 恰好等于 WIDTH 归零,窗口内严格为正", () => {
  expect(sweepBehind(0.5, 0.5 - WIDTH)).toBeCloseTo(WIDTH, 10)
  // 判定是 behind > WIDTH 才归零,所以正好落在窗口尾的那一格提亮量是 0
  expect(sweepMix(0.5, 0.5 - WIDTH)).toBe(0)
  expect(sweepMix(0.5, 0.5 - WIDTH + 0.001)).toBeGreaterThan(0)
  // 再远一格必然在窗口外
  expect(sweepMix(0.5, 0.5 - WIDTH - 0.001)).toBe(0)
})

test("提亮量随落后距离单调递减,且恒落在 [0, PEAK]", () => {
  let previous = PEAK
  for (let behind = 0; behind <= 1; behind += 0.01) {
    const t = (0.3 - behind + 1) % 1
    const mix = sweepMix(0.3, t)
    expect(mix).toBeGreaterThanOrEqual(0)
    expect(mix).toBeLessThanOrEqual(PEAK)
    expect(mix).toBeLessThanOrEqual(previous + 1e-12)
    previous = mix
  }
  expect(sweepMix(0.3, 0.3)).toBeCloseTo(PEAK, 10)
})

test("只取决于环形距离:相位与 t 同时加同一个整数,结果不变", () => {
  expect(sweepMix(0.3, 0.2)).toBeCloseTo(sweepMix(1.3, 1.2), 10)
  expect(sweepMix(0.3, 0.9)).toBeCloseTo(sweepMix(2.3, 2.9), 10)
})

test("窗口折成格数是窄高光,不是整条边框", () => {
  // perimeterCells 的四段循环给出周长格数 = 2×宽 + 2×(高−2)。
  const perimeter = perimeterCells(12, 4).length
  expect(perimeter).toBe(2 * 12 + 2 * (4 - 2))
  // 12% × 28 格 ≈ 3.4 格 —— 120 列 × 4 行的输入卡(244 格)也只有约 29 格。
  expect(WIDTH * perimeter).toBeGreaterThan(3)
  expect(WIDTH * perimeter).toBeLessThan(perimeter / 4)
})
