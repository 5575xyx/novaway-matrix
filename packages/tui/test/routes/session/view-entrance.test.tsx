/** @jsxImportSource @opentui/solid */
// D4 聊天视图切换过渡的**渲染**测试。
//
// 原型 card-design-v7.html:637-639 / 1206-1210 实际做的事:
//   `.chat-view.show { animation: viewIn .45s var(--ease) both }`,`viewIn` = opacity 0→1 +
//   translateY(12px)→none;而 `switchView()` 是 `off.remove('show'); on.add('show')` ——
//   **旧视图当场消失**(没有退场动画、没有侧滑),只有进场的那一个视图在动。
// 所以这里测的是「入场」,不是「换页」:
//   1. 入场期间至少两帧内容不同(真的在动);
//   2. 入场期间正文是**暗的**(opacity 栈真的压到了整棵子树),走完之后回到终态色;
//   3. 走完之后停在终态:偏移 0 行、画面稳定、连着几帧逐字与逐色都不变;
//   4. animate={false} 时第一帧就是终态。
//
// animate / frameMs / rows 都是注入口:测试不能从 KV 那一侧拨 animations_enabled —— KVProvider
// 写的是**共享**的 state/kv.json(见 test/component/prompt-card.test.tsx:319)。
import { expect, test } from "bun:test"
import { createSignal, Show } from "solid-js"
import { testRender } from "@opentui/solid"
import { RGBA, type CapturedFrame } from "@opentui/core"
import type { ChatView } from "../../../src/routes/session/chat-view"
import {
  ENTRANCE_FRAMES,
  ENTRANCE_ROWS,
  entranceEase,
  entranceOffset,
  entranceOpacity,
  ViewEntrance,
} from "../../../src/routes/session/view-entrance"
import "../../../src/ui/card"

const WIDTH = 40
const HEIGHT = 8
const BORDER = RGBA.fromHex("#5fd7ff")

/**
 * 挂一个受控的舞台。进场视图是一张真霓虹卡(与生产同壳),标记写在卡内第一行 ——
 * 断言的是**整棵子树的位移与透明度**,所以里面得有正文和自绘描边两种东西可看。
 */
async function mount(options: { animate?: boolean; frameMs?: number; rows?: number } = {}) {
  const [view, setView] = createSignal<ChatView>("bubble")
  const app = await testRender(
    () => (
      <ViewEntrance view={view()} animate={options.animate} frameMs={options.frameMs ?? 30} rows={options.rows}>
        <Show when={view() === "bubble"}>
          <box width={WIDTH}>
            <neonbox gradientStops={[BORDER]} paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={1}>
              <text fg={RGBA.fromHex("#ffffff")}>BUBBLE-VIEW</text>
            </neonbox>
          </box>
        </Show>
        <Show when={view() === "flow"}>
          <box width={WIDTH}>
            <neonbox gradientStops={[RGBA.fromHex("#ff2d7b")]} paddingTop={1} paddingBottom={1} paddingLeft={2}>
              <text fg={RGBA.fromHex("#ffffff")}>FLOW-VIEW</text>
            </neonbox>
          </box>
        </Show>
      </ViewEntrance>
    ),
    { width: WIDTH, height: HEIGHT },
  )
  return { app, setView }
}

const rows = (app: { captureCharFrame(): string }) =>
  app
    .captureCharFrame()
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))

/** 连着采 count 帧;gapMs 是两次采样之间的空档,必须短于一帧,否则两帧会落在同一个相位上。 */
async function sample(app: Awaited<ReturnType<typeof mount>>["app"], count: number, gapMs = 5) {
  const frames: string[] = []
  for (let index = 0; index < count; index++) {
    await app.renderOnce()
    frames.push(rows(app).join("\n"))
    await new Promise((resolve) => setTimeout(resolve, gapMs))
  }
  return frames
}

/** 采样到满足 want 为止(或采样完),返回采样到的帧序列。 */
async function sampleUntil(
  app: Awaited<ReturnType<typeof mount>>["app"],
  want: (frame: string) => boolean,
  count = 80,
) {
  const frames: string[] = []
  for (let index = 0; index < count; index++) {
    await app.renderOnce()
    const current = rows(app).join("\n")
    frames.push(current)
    if (want(current)) return frames
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  return frames
}

/** 逐字与逐色都读到,用来断言「淡入」真的落到颜色上(captureCharFrame 只有字符)。 */
async function sampleColors(app: Awaited<ReturnType<typeof mount>>["app"], count: number, gapMs = 5) {
  const frames: ReturnType<typeof colorFrame>[] = []
  for (let index = 0; index < count; index++) {
    await app.renderOnce()
    frames.push(colorFrame(app))
    await new Promise((resolve) => setTimeout(resolve, gapMs))
  }
  return frames
}

/** 把 captureSpans 摊成「每帧每行每个字符一个字色」的快照。 */
function colorFrame(app: { captureCharFrame(): string; captureSpans(): CapturedFrame }) {
  const captured = app.captureSpans()
  return {
    text: rows(app).join("\n"),
    cells: captured.lines.map((line) =>
      line.spans.flatMap((span) =>
        [...span.text].map(() => [span.fg.buffer[0]!, span.fg.buffer[1]!, span.fg.buffer[2]!] as const),
      ),
    ),
  }
}

/** 帧里 marker 那一格的字色。 */
function cellOf(frame: { text: string; cells: (readonly (readonly number[])[])[] }, marker: string) {
  const lines = frame.text.split("\n")
  const line = lines.findIndex((row) => row.includes(marker))
  if (line === -1) return undefined
  return frame.cells[line]?.[lines[line]!.indexOf(marker)]
}

// ---------- 纯函数 ----------

test("入场:位移两端是 ENTRANCE_ROWS 行与 0 行,中间按整行量化(不出现小数行)", () => {
  expect(entranceOffset(0)).toBe(ENTRANCE_ROWS)
  expect(entranceOffset(1)).toBe(0)
  for (const progress of [0, 0.17, 0.33, 0.5, 0.66, 0.83, 1]) {
    const value = entranceOffset(progress)
    expect(Number.isInteger(value), `progress=${progress}`).toBe(true)
    expect(value).toBeGreaterThanOrEqual(0)
    expect(value).toBeLessThanOrEqual(ENTRANCE_ROWS)
  }
  // 越界夹取:定时器多走一拍也不能把视图推到舞台外面
  expect(entranceOffset(2)).toBe(0)
  expect(entranceOffset(-1)).toBe(ENTRANCE_ROWS)
})

test("入场:每一行都停够 2 帧(6 帧走 3 行),不会三级跳", () => {
  // 原型是 0.45s 的连续 transform;终端只能整行位移,所以帧数取行数的两倍 ——
  // 每行停 2 帧看起来才是匀速,只给 3 帧就是三级跳。
  expect(ENTRANCE_FRAMES).toBe(ENTRANCE_ROWS * 2)
  const ladder = Array.from({ length: ENTRANCE_FRAMES + 1 }, (_, frame) => entranceOffset(frame / ENTRANCE_FRAMES))
  expect(ladder).toEqual([ENTRANCE_ROWS, ENTRANCE_ROWS, 2, 2, 1, 1, 0])
})

test("入场:透明度是 ease-out 二次,起手快收尾慢、两端精确", () => {
  expect(entranceEase(0)).toBe(0)
  expect(entranceEase(1)).toBe(1)
  expect(entranceEase(0.5)).toBeCloseTo(0.75, 10)
  let previous = -1
  for (let step = 0; step <= 20; step++) {
    const value = entranceEase(step / 20)
    expect(value, `第 ${step} 档应单调不减`).toBeGreaterThan(previous)
    previous = value
  }
  // opacity 与位移同一个缓动,所以两者始终同步;越界夹取。
  expect(entranceOpacity(0)).toBe(0)
  expect(entranceOpacity(1)).toBe(1)
  expect(entranceOpacity(2)).toBe(1)
  expect(entranceOpacity(-1)).toBe(0)
})

// ---------- 渲染 ----------

// 卡片的上边框那一行 = 视图当前的纵向位置(NeonBox 把上边框画在自己第 0 行,所以正文在下一行)。
// 用它当锚点而不是正文那一行,有两个理由:① 入场的前几帧 opacity 接近 0,混合后的字符可能整行
// 是空的,那时正文行数根本不存在,而「卡片上边框在第几行」任何时候都量得到;② 位移是按整行量化的
// (3 帧走 3 行 = 每行停 2 帧),所以**不能**用「连续几帧相同」当稳定的判据 —— 每一行本来就要停两帧。
const anchorRow = (frame: string, ch = "╭") => frame.split("\n").findIndex((row) => row.includes(ch))

test("入场:动画期间至少两帧内容不同(真的在动),而且进场视图从下面爬上来", async () => {
  const { app, setView } = await mount()
  try {
    const before = await sample(app, 3)
    expect(before.at(-1)).toContain("BUBBLE-VIEW")
    expect(new Set(before).size, "静止时不该有抖动").toBe(1)
    expect(anchorRow(before.at(-1)!)).toBe(0)

    setView("flow")
    const during = await sampleUntil(app, (frame) => frame.includes("FLOW-VIEW"))
    expect(new Set(during).size, "入场期间应当有多帧不同内容").toBeGreaterThan(1)
    // 进场那一刻新视图不在第 0 行(translateY 12px 的终端等价:往下最多 3 行)
    const displaced = during.filter((frame) => anchorRow(frame) > 0)
    expect(displaced.length, "应当有若干帧里卡片上边框不在第 0 行").toBeGreaterThan(0)
    // 旧视图是**当场消失**的:切过去的第一帧里就已经没有 BUBBLE-VIEW 了
    expect(during[0]).not.toContain("BUBBLE-VIEW")
  } finally {
    app.renderer.destroy()
  }
})

test("入场:走完之后停在终态 —— 偏移 0 行,且画面稳定", async () => {
  const { app, setView } = await mount()
  try {
    await sample(app, 3)
    setView("flow")
    // 判据是「回到第 0 行」而不是「连续几帧相同」:位移按整行量化,每一行都要停两帧。
    const during = await sampleUntil(app, (frame) => anchorRow(frame) === 0 && frame.includes("FLOW-VIEW"))
    const after = during.at(-1)!
    expect(anchorRow(after)).toBe(0)
    expect(after).not.toContain("BUBBLE-VIEW")
    // 稳定下来:再采 3 帧逐字相同(动画已经彻底结束)
    expect(await sample(app, 3)).toEqual([after, after, after])
  } finally {
    app.renderer.destroy()
  }
})

test("入场:animate={false} 时第一帧就是终态(不播)", async () => {
  const { app, setView } = await mount({ animate: false })
  try {
    const before = await sample(app, 3)
    expect(before.at(-1)).toContain("BUBBLE-VIEW")
    setView("flow")
    await app.renderOnce()
    const first = rows(app).join("\n")
    // 不播 = 没有位移、没有压暗:上边框在第 0 行,正文是纯白(FLOW-VIEW 完整可见)
    expect(anchorRow(first)).toBe(0)
    expect(first).not.toContain("BUBBLE-VIEW")
  } finally {
    app.renderer.destroy()
  }
})

test("入场:淡入真的落到颜色上 —— 入场期间正文与卡片描边都比**同一张卡的终态**暗", async () => {
  const { app, setView } = await mount({ frameMs: 40 })
  try {
    await sample(app, 2)
    setView("flow")
    // 一路采到入场走完(回到第 0 行),期间每一帧都记下来 —— 于是「同一张流程图卡」既有入场中的
    // 颜色,也有终态颜色,比较的是**只差一个 opacity** 的两帧,不是两张不同的卡。
    const frames = await sampleColors(app, 12, 25)
    const final = frames.at(-1)!
    expect(final.text).toContain("FLOW-VIEW")
    expect(anchorRow(final.text)).toBe(0)
    const finalText = cellOf(final, "FLOW-VIEW")
    const finalBorder = cellOf(final, "╭")
    expect(finalText, "终态正文应是纯白").toEqual([255, 255, 255])
    expect(finalBorder, "终态描边应是这张卡自己的粉").toEqual([255, 45, 123])

    const dimmed = (marker: string) =>
      frames.filter((frame) => {
        const color = cellOf(frame, marker)
        return color !== undefined && color.join() !== cellOf(final, marker)!.join()
      })
    // opacity 栈压到了整棵子树:正文是暗的
    expect(dimmed("FLOW-VIEW").length, "入场期间正文应当有几帧更暗").toBeGreaterThan(0)
    // 描边同样跟着暗 —— NeonBox 自己按 buffer.getCurrentOpacity() 折算(见 ui/card.ts)。
    // 不折算的话就是「正文在淡入、卡片已经满亮」,一眼假。
    const borders = dimmed("╭")
    expect(borders.length, "入场期间描边应当有几帧更暗").toBeGreaterThan(0)
    const sum = (color: readonly number[]) => color[0]! + color[1]! + color[2]!
    expect(sum(cellOf(borders[0]!, "╭")!)).toBeLessThan(sum(finalBorder!))
  } finally {
    app.renderer.destroy()
  }
})
