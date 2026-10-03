import { expect, test } from "bun:test"
import { FLOW_TRAVEL, SWEEP_STRENGTH, SWEEP_WIDTH, sweepBehind, sweepMix, travelAt } from "../../src/ui/card"
import { perimeterCells } from "../../src/ui/neon"

// 扫光的数学契约。集成层(卡片测试)只能做「动画时颜色变 / 静止时不变」这类差分断言 ——
// 任何依赖「第一帧恰好落在某个相位」的断言都会在慢机器上红。这里全部按纯函数锁死。
//
// **WIDTH / PEAK 直接从生产常量里取**,不在这里另抄一份:抄一份的话,调小扫光时这个文件
// 会因为「实现的 PEAK 已经不是我写的 0.55」而红 —— 那是一条与被测行为无关的红,
// 只会让人以为扫光坏了(当初就是它把 0.55 → 0.30 那次改动挡在门外)。
const WIDTH = SWEEP_WIDTH
const PEAK = SWEEP_STRENGTH

// 用户反馈「聚焦时那道白带太亮太宽,像探照灯」。现在这一档是**温和的微光**:
//   · 窗口 12% → 5%:120 列 × 4 行的输入卡(周长 244 格)上从约 29 格缩到约 12 格;
//   · 峰值 55% → 30% 朝白插值:原型的 `.card:hover` 外发光是 `rgba(255,92,158,.14)`,
//     也就是 14%;终端没有外发光,只能拿描边色自己往白里插,取 30% 已经比原型强一档还多。
// 效果是「扫过去有一道亮一下」,不是「一道白光扫过整圈」。这两条断言把量级钉住。
test("扫光是微光,不是探照灯:窗口 ≤ 一圈的 6%,峰值 ≤ 朝白插 35%", () => {
  expect(SWEEP_WIDTH).toBeLessThanOrEqual(0.06)
  expect(SWEEP_STRENGTH).toBeLessThanOrEqual(0.35)
  // 仍然是可见的:窗口折到 244 格的输入卡上还有十来格,峰值也还在三成上下。
  expect(SWEEP_WIDTH * perimeterCells(120, 4).length).toBeGreaterThan(8)
  expect(SWEEP_WIDTH * perimeterCells(120, 4).length).toBeLessThan(20)
})

// 流动时的「色相漂移窗口」。见 FLOW_TRAVEL 的注释:相位推进期间色带只在色板**中间那一段**
// 上来回走,不再把整条色板扫一遍 —— 常驻流动与悬停那一族的最宽色板(三段霓虹,色相跨度 152°)
// 因此只露出约六成。
test("流动窗口:FLOW_TRAVEL 落在 0.5~0.7,travelAt 把 [0,1] 压进 [0.5 ± 它/2]", () => {
  expect(FLOW_TRAVEL).toBeGreaterThanOrEqual(0.5)
  expect(FLOW_TRAVEL).toBeLessThanOrEqual(0.7)
  expect(travelAt(0.5)).toBeCloseTo(0.5, 10)
  expect(travelAt(0)).toBeCloseTo(0.5 - FLOW_TRAVEL / 2, 10)
  expect(travelAt(1)).toBeCloseTo(0.5 + FLOW_TRAVEL / 2, 10)
  // 单调、不越界:窗口是纯压缩,不会把 t 折回去。
  let previous = travelAt(0)
  for (let t = 0; t <= 1; t += 0.02) {
    const value = travelAt(t)
    expect(value).toBeGreaterThanOrEqual(previous - 1e-12)
    expect(value).toBeGreaterThanOrEqual(0)
    expect(value).toBeLessThanOrEqual(1)
    previous = value
  }
  // FLOW_TRAVEL = 1 时是恒等 —— 静止卡那条「逐格等于 gradientAt(stops, t)」不受影响。
  expect(travelAt(0.25, 1)).toBe(0.25)
})

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
  // 5% × 28 格 ≈ 1.4 格 —— 小卡上只有一两格,于是「整圈都在亮」那种观感不可能出现。
  expect(WIDTH * perimeter).toBeLessThan(perimeter / 4)
})
