/** @jsxImportSource @opentui/solid */
// D4 聊天视图侧滑过渡的**渲染**测试。
//
// 纯函数那一半(方向、缓动、两视图各自的偏移列数)在文件后半的单测里;这里钉的是「屏幕上真的
// 发生了什么」:
//   1. 过渡期间**两个视图同帧、首尾相接** —— 这既是侧滑的定义,也顺带钉住「两个视图之间没有缝、
//      没有重叠」这个最容易写错的算式;
//   2. 过渡中连着两帧内容不同 —— 真的动了,不是换了一张图;
//   3. 过渡结束后只剩目标视图 —— 旧视图的 renderable 真的被销毁了;
//   4. animate={false} 时**一帧都不多** —— 直接切换,没有任何中间帧。
//
// animate / frameMs 都是注入口,理由与 FlowCanvas 的 reveal 一样:测试不能从 KV 那一侧拨
// animations_enabled(KVProvider 写的是**共享**的 state/kv.json,见 test/component/prompt-card.test.tsx:319)。
import { expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { testRender } from "@opentui/solid"
import type { ChatView } from "../../../src/routes/session/chat-view"
import {
  ChatViewStage,
  slideDirection,
  slideEase,
  slideOffsets,
  SLIDE_FRAMES,
} from "../../../src/routes/session/view-slide"

const WIDTH = 48
const HEIGHT = 12

/**
 * 挂一个受控的舞台。两个视图是**带标记的普通盒子**,不是真的会话页 —— 被测的是过渡本身
 * (偏移 / 共存 / 销毁),不是消息流或画布的内容。
 *
 * 标记贴着两个视图的**接缝**那一侧:旧视图靠右(alignItems 在纵向盒子里管的是横轴),
 * 新视图靠左。侧滑中途两个盒子首尾相接,于是同一行上就是「BUBBLE-VIEWFLOW-VIEW」这种
 * 首尾相接的形状 —— 缝与重叠都能一眼看出来。放在盒子中间的话两个标记只在 e≈0.5 那一帧同时
 * 可见,断言就得去赌采样恰好落在那一帧上。
 */
async function mount(options: { animate?: boolean; frameMs?: number } = {}) {
  const [view, setView] = createSignal<ChatView>("bubble")
  const app = await testRender(
    () => (
      <ChatViewStage
        view={view()}
        width={WIDTH}
        animate={options.animate}
        frameMs={options.frameMs ?? 10}
        bubble={() => (
          <box width="100%" height="100%" flexShrink={0} alignItems="flex-end">
            <text>BUBBLE-VIEW</text>
          </box>
        )}
        flow={() => (
          <box width="100%" height="100%" flexShrink={0}>
            <text>FLOW-VIEW</text>
          </box>
        )}
      />
    ),
    { width: WIDTH, height: HEIGHT },
  )
  return { app, setView, view }
}

const frame = (app: { captureCharFrame(): string }) =>
  app
    .captureCharFrame()
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")

/** 连着采 count 帧。采样间隔必须短于一帧的时长,否则两帧会落在同一个相位上。 */
async function sample(app: Awaited<ReturnType<typeof mount>>["app"], count: number) {
  const frames: string[] = []
  for (let index = 0; index < count; index++) {
    await app.renderOnce()
    frames.push(frame(app))
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  return frames
}

/** 采样到满足 want 为止(或采样完),返回采样到的帧序列。 */
async function sampleUntil(
  app: Awaited<ReturnType<typeof mount>>["app"],
  want: (value: string) => boolean,
  count = 80,
) {
  const frames: string[] = []
  for (let index = 0; index < count; index++) {
    await app.renderOnce()
    const current = frame(app)
    frames.push(current)
    if (want(current)) return frames
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  return frames
}

/**
 * 采样到画面稳定为止(连续 3 帧逐字相同),返回最后一帧。
 *
 * 不用固定「再采 8 帧」:过渡多长取决于 setInterval 与 renderOnce 的相对节奏,写死帧数就是
 * 拿一个跟实现耦合的数去断言 —— 机器慢一点就变成「动画还没走完」的假红。
 * 3 帧连续相同 ≈ 15ms 静默,而一帧最短 10ms,所以「还在动」不会被误判成「稳定」。
 */
async function settled(app: Awaited<ReturnType<typeof mount>>["app"], count = 80) {
  let previous = ""
  let stable = 0
  let current = ""
  for (let index = 0; index < count; index++) {
    await app.renderOnce()
    current = frame(app)
    stable = current === previous ? stable + 1 : 0
    previous = current
    if (stable >= 3) return current
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  return current
}

// ---------- 纯函数 ----------

test("侧滑:方向按视图在 CHAT_VIEWS 里的左右次序定 —— 往右切时旧视图向左滑出", () => {
  // bubble 在下标 0、flow 在下标 1,所以 bubble→flow 是「往右切」= 旧视图往左走(负方向)。
  expect(slideDirection("bubble", "flow")).toBe(-1)
  expect(slideDirection("flow", "bubble")).toBe(1)
  // 同一个视图没有方向可言(调用方不会问,但纯函数得给个确定答案而不是 NaN)。
  expect(slideDirection("bubble", "bubble")).toBe(1)
})

test("侧滑:缓动两端是 0/1、中点先快后慢,单调不回头", () => {
  expect(slideEase(0)).toBe(0)
  expect(slideEase(1)).toBe(1)
  // ease-out 二次:中点 = 1 − 0.25 = 0.75。前 50% 的进度走掉 75% 的位移 —— 起手快、收尾慢。
  expect(slideEase(0.5)).toBeCloseTo(0.75, 10)
  let previous = -1
  for (let step = 0; step <= 20; step++) {
    const value = slideEase(step / 20)
    expect(value, `第 ${step} 档应单调不减`).toBeGreaterThan(previous)
    previous = value
  }
})

test("侧滑:偏移两端精确落在 0 与 ∓宽度(两端必须能对齐成同一条静态布局)", () => {
  expect(slideOffsets(0, 40, -1)).toEqual({ outgoing: 0, incoming: 40 })
  expect(slideOffsets(1, 40, -1)).toEqual({ outgoing: -40, incoming: 0 })
  // 反方向(往左切)整段镜像
  expect(slideOffsets(0, 40, 1)).toEqual({ outgoing: 0, incoming: -40 })
  expect(slideOffsets(1, 40, 1)).toEqual({ outgoing: 40, incoming: 0 })
  // 进度越界要被夹住:宁可停在一个端点,也不能把视图推出终端之外。
  expect(slideOffsets(2, 40, -1)).toEqual(slideOffsets(1, 40, -1))
  expect(slideOffsets(-1, 40, -1)).toEqual(slideOffsets(0, 40, -1))
})

test("侧滑:任意一帧两个视图都首尾相接(间距恒等于一个视图宽,不是互为相反数)", () => {
  // 这一条是整段动画最容易写错的算式:incoming 必须是 outgoing − direction×width。
  // 写成「互为相反数」时两块内容会各自滑开、中间空出一大段。
  for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
    for (const direction of [-1, 1] as const) {
      const offsets = slideOffsets(progress, 48, direction)
      const start = slideOffsets(0, 48, direction)
      // 间距恒等于一个视图宽:旧视图的右缘就是新视图的左缘。
      expect(offsets.incoming - offsets.outgoing, `progress=${progress} direction=${direction}`).toBe(-direction * 48)
      if (progress === 0) continue
      // 两个视图朝**同一个**方向平移(它们是一条连续的带子,不是各滑各的):
      // 往右切时旧视图向右走、新视图从左边追进来。
      expect(Math.sign(offsets.outgoing - start.outgoing)).toBe(direction)
      expect(Math.sign(offsets.incoming - start.incoming)).toBe(direction)
    }
  }
})

// ---------- 渲染 ----------

test("侧滑:过渡期间两个视图同帧、首尾相接,连着两帧内容不同", async () => {
  const { app, setView } = await mount()
  try {
    const before = await sample(app, 4)
    expect(before.at(-1)).toContain("BUBBLE-VIEW")
    expect(before.at(-1)).not.toContain("FLOW-VIEW")
    // 静止时不该有任何抖动
    expect(new Set(before).size).toBe(1)

    setView("flow")
    const during = await sampleUntil(app, (value) => value.includes("BUBBLE-VIEW") && value.includes("FLOW-VIEW"))
    const coexisting = during.filter((value) => value.includes("BUBBLE-VIEW") && value.includes("FLOW-VIEW"))
    expect(coexisting.length, "过渡期间应当有旧视图与新视图同帧的帧").toBeGreaterThan(0)
    // 真的动了:过渡过程中出现过不止一帧不同内容
    expect(new Set(during).size, "过渡过程中应当有多帧不同内容").toBeGreaterThan(1)

    // 共存的那一帧:旧视图的右缘紧接新视图的左缘 —— 中间没有缝,也没有压在一起。
    const row = coexisting[0]!.split("\n").find((line) => line.includes("BUBBLE-VIEW"))!
    expect(row.indexOf("FLOW-VIEW")).toBe(row.indexOf("BUBBLE-VIEW") + "BUBBLE-VIEW".length)
    // 新视图还在半路上:它的标记没有落在第 0 列
    expect(row.indexOf("FLOW-VIEW")).toBeGreaterThan(0)
  } finally {
    app.renderer.destroy()
  }
})

test("侧滑:过渡结束后只剩目标视图(旧视图的 renderable 真的被销毁)", async () => {
  const { app, setView } = await mount()
  try {
    await sample(app, 3)
    setView("flow")
    const after = await settled(app)
    expect(after).toContain("FLOW-VIEW")
    expect(after).not.toContain("BUBBLE-VIEW")
    // 稳定下来之后旧视图不会再被谁重新挂回来
    expect(await sample(app, 3)).toEqual([after, after, after])

    // 反向切回去同理(方向镜像,销毁逻辑是同一条)
    setView("bubble")
    const back = await settled(app)
    expect(back).toContain("BUBBLE-VIEW")
    expect(back).not.toContain("FLOW-VIEW")
  } finally {
    app.renderer.destroy()
  }
})

test("侧滑:animate={false} 时直接切换 —— 没有任何两视图共存的帧", async () => {
  const { app, setView } = await mount({ animate: false })
  try {
    const before = await sample(app, 3)
    expect(before.at(-1)).toContain("BUBBLE-VIEW")
    setView("flow")
    const after = await sample(app, 6)
    // 一次都没共存过 —— 关掉动画就是直接切换,不留中间帧、不留残影。
    expect(after.filter((value) => value.includes("BUBBLE-VIEW") && value.includes("FLOW-VIEW")).length).toBe(0)
    // 第一帧就是终态:一次 render 就已经只剩新视图,而且它落在第 0 列
    expect(after[0]).toContain("FLOW-VIEW")
    expect(after[0]).not.toContain("BUBBLE-VIEW")
    expect(after[0]!.indexOf("FLOW-VIEW")).toBe(0)
  } finally {
    app.renderer.destroy()
  }
})

test("侧滑:不给 animate 就播动画(默认走的是动起来的那条路)", async () => {
  const { app, setView } = await mount()
  try {
    await sample(app, 3)
    setView("flow")
    const during = await sampleUntil(app, (value) => value.includes("FLOW-VIEW") && value.includes("BUBBLE-VIEW"))
    expect(during.some((value) => value.includes("BUBBLE-VIEW") && value.includes("FLOW-VIEW"))).toBe(true)
    expect(SLIDE_FRAMES).toBeGreaterThan(1)
  } finally {
    app.renderer.destroy()
  }
})
