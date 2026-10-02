/** @jsxImportSource @opentui/solid */
// 「切回气泡视图要滚到最新消息」的渲染回归。
//
// 原型 card-design-v7.html:1221(switchView 末行):
//   `chat.scrollTop = v === "flow" ? 0 : chat.scrollHeight;`
// 也就是**切到流程图看顶部、切回气泡看底部**(最新消息)。
//
// 这条行为在本仓库**已经由 stickyScroll 天然满足**,所以这里测的是那个天然满足本身,
// 而不是另加一段滚动逻辑:
//   · 气泡视图的 scrollbox 带 `stickyScroll` + `stickyStart="bottom"`(routes/session 的
//     消息列表那一个)。opentui 在 scrollbox 的 **viewport 尺寸落定**那一次
//     `recalculateBarProps()` 里会 `applyStickyStart("bottom")`,把 scrollPosition 压到
//     `scrollHeight − viewport.height`;而新实例的 `_hasManualScroll` 是 false,所以
//     「按一次方向键」之前它一直贴着底。视图切换是 `<Show>` 当场销毁旧建新,拿到的正是
//     一个**全新的** scrollbox —— 所以「切回来必然在底部」是 stickyScroll 的固有行为。
//   · 流程图画布那个 scrollbox(components/flow/canvas.tsx)**不带** stickyScroll,
//     于是它天生停在 scrollTop = 0,也就是原型要的「切到流程图看顶部」。
//
// 断言的是**渲染结果**(帧里出现的是第几行)加上 scrollTop 的数值,两者都钉住;
// 只断言 props 的话,opentui 哪天改了 applyStickyStart 的触发时机,这个文件还会全绿。
import { expect, test } from "bun:test"
import { createSignal, For, Show } from "solid-js"
import { testRender } from "@opentui/solid"
import type { ScrollBoxRenderable } from "@opentui/core"
import { ViewEntrance } from "../../../src/routes/session/view-entrance"
import type { ChatView } from "../../../src/routes/session/chat-view"

const WIDTH = 30
const HEIGHT = 8
// 内容比视口高出一大截,确保两个视图都真的可滚动(不可滚动时 scrollTop 恒为 0,
// 「在底部」与「在顶部」会变成同一件事,测试就白写了)。
const ROWS = Array.from({ length: 40 }, (_, index) => `ROW-${index}`)
/** 首行与末行:「看顶部」= 看得见 FIRST,「看最新」= 看得见 LAST。 */
const FIRST = ROWS[0]!
const LAST = ROWS.at(-1)!

/** 与 routes/session 的两个 Show 同构:旧视图当场销毁,新视图建出来。 */
async function mountViews(animate: boolean) {
  const [view, setView] = createSignal<ChatView>("bubble")
  const boxes: { bubble?: ScrollBoxRenderable; flow?: ScrollBoxRenderable } = {}
  const app = await testRender(
    () => (
      <ViewEntrance view={view()} animate={animate} frameMs={20} rows={1}>
        <Show when={view() === "flow"}>
          <scrollbox
            ref={(box: ScrollBoxRenderable) => (boxes.flow = box)}
            flexGrow={1}
            minHeight={0}
            viewportOptions={{ paddingRight: 0 }}
          >
            <For each={ROWS}>{(row) => <text wrapMode="none">{row}</text>}</For>
          </scrollbox>
        </Show>
        <Show when={view() !== "flow"}>
          <scrollbox
            ref={(box: ScrollBoxRenderable) => (boxes.bubble = box)}
            stickyScroll={true}
            stickyStart="bottom"
            flexGrow={1}
            minHeight={0}
            viewportOptions={{ paddingRight: 0 }}
          >
            <For each={ROWS}>{(row) => <text wrapMode="none">{row}</text>}</For>
          </scrollbox>
        </Show>
      </ViewEntrance>
    ),
    { width: WIDTH, height: HEIGHT },
  )
  return { app, setView, boxes }
}

type Mounted = Awaited<ReturnType<typeof mountViews>>

function frame(app: { captureCharFrame(): string }) {
  return app.captureCharFrame()
}

/** 帧里可见的行(去掉了空行)。 */
function visibleRows(app: { captureCharFrame(): string }) {
  return app
    .captureCharFrame()
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .filter((line) => line.trim().length > 0)
}

/**
 * 一路 renderOnce 到 `want` 成立(或采样用尽)。
 *
 * 必须等**帧**,不能只看 scrollTop:入场动画的前几帧 opacity 接近 0,正文被混成背景色,
 * 帧里一个字都没有 —— 那时 scrollTop 已经是对的,但画面还是空的。
 */
async function sampleUntil(mounted: Mounted, want: (frame: string) => boolean, attempts = 80) {
  for (let index = 0; index < attempts; index++) {
    await mounted.app.renderOnce()
    const current = frame(mounted.app)
    if (want(current)) return current
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return frame(mounted.app)
}

for (const animate of [false, true]) {
  test(`切视图的滚动落点:切到流程图看顶部、切回气泡看最新消息(入场动画=${animate ? "播" : "不播"})`, async () => {
    const mounted = await mountViews(animate)
    try {
      // 首屏(气泡视图):已经在底部 —— 首屏没有消息时也一样,那一行会自己消失
      await sampleUntil(mounted, (f) => f.includes(LAST))
      const bubble = mounted.boxes.bubble!
      expect(bubble.scrollHeight).toBeGreaterThan(bubble.viewport.height)
      expect(bubble.scrollTop).toBe(bubble.scrollHeight - bubble.viewport.height)
      expect(frame(mounted.app)).toContain(LAST)

      // 切到流程图:顶部。画布那个 scrollbox 没有 stickyScroll,天生停在 0。
      mounted.setView("flow")
      await sampleUntil(mounted, (f) => f.includes(FIRST))
      const flow = mounted.boxes.flow!
      expect(flow.scrollTop).toBe(0)
      expect(frame(mounted.app)).toContain(FIRST)
      expect(frame(mounted.app)).not.toContain(LAST)

      // 切回气泡:旧 scrollbox 已被销毁,新挂上来的这一个已经在底部(帧里能看到最后一行)
      mounted.setView("bubble")
      const settled = await sampleUntil(mounted, (f) => f.includes(LAST))
      const again = mounted.boxes.bubble!
      expect(again).not.toBe(bubble)
      expect(again.scrollTop).toBe(again.scrollHeight - again.viewport.height)
      expect(visibleRows(mounted.app).at(-1)).toContain(LAST)
      expect(settled).not.toContain(FIRST)
    } finally {
      mounted.app.renderer.destroy()
    }
  })
}

// stickyScroll 的 props 一旦被摘掉,上面那条渲染断言会红 —— 这条直接把「配了几项」写死,
// 让「谁负责贴底」这件事在代码里有个明确的落点,而不是靠读 stickyScroll 的语义去推。
test("贴底的责任落在气泡视图那个 scrollbox 上:stickyScroll + stickyStart=bottom", async () => {
  const mounted = await mountViews(false)
  try {
    await sampleUntil(mounted, (f) => f.includes(LAST))
    const bubble = mounted.boxes.bubble!
    expect(bubble.stickyScroll).toBe(true)
    expect(bubble.stickyStart).toBe("bottom")
    // 流程图那个必须**不带** sticky —— 否则「切到流程图看顶部」会被 sticky 顶掉
    mounted.setView("flow")
    await sampleUntil(mounted, (f) => f.includes(FIRST))
    expect(mounted.boxes.flow!.stickyScroll).toBe(false)
    expect(mounted.boxes.flow!.stickyStart).toBeUndefined()
  } finally {
    mounted.app.renderer.destroy()
  }
})
