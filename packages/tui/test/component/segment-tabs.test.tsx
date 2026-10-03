/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import {
  SEGMENT_SLIDE_MS,
  SegmentTabs,
  segmentSlide,
  segmentSlots,
  type SegmentTab,
} from "../../src/component/segment-tabs"
import { Locale } from "../../src/util/locale"
import { ThemeReady, ThemeTestProviders } from "../fixture/providers"

// 原型那边 `.seg-ind` 是绝对定位 + `transition: transform .42s`(card-design-v7.html:127-135),
// `segTo()` 把它 transform 到被点的那一段 —— 切页时高亮**滑过去**。这一组钉的就是「滑过去
// 而且落在那一段上」,以及窗口一变之后仍然落在那一段上。

type TabId = "files" | "info" | "git"

// 与侧栏那三个标签同形(字形 + 一个空格 + 文字);字形宽度按 emoji 风格算:2 列。
const TABS: SegmentTab<TabId>[] = [
  { id: "files", text: "文件", glyph: "📁" },
  { id: "info", text: "待办与统计", glyph: "📋" },
  { id: "git", text: "Git", glyph: "🌿" },
]

type Node = { screenX: number; width: number; constructor: { name: string }; getChildren(): unknown[]; parent: Node }

// 收集子树里所有节点。没排过版的节点 screenX 是 undefined,所以断言一律在 renderOnce 之后。
function flatten(node: Node): Node[] {
  const children = node.getChildren() as Node[]
  return children.length > 0 ? children.flatMap((child) => [child, ...flatten(child)]) : []
}

/**
 * 那一行里的三个标签文本,按列从左到右。
 *
 * 不能直接取「树里所有 TextRenderable」:同一棵树里还有就绪哨兵 ThemeReady,它也是一行文本,
 * 混进来之后每一段的下标都错一位(它自己也在第 0 列)。按「同一个父盒」分组再取文本最多的
 * 那一组 —— 标签行是唯一有三个文本兄弟的盒子。
 */
function labels(app: { renderer: { root: unknown } }) {
  const texts = flatten(app.renderer.root as Node).filter((node) => node.constructor.name === "TextRenderable")
  const groups = new Map<Node, Node[]>()
  for (const node of texts) groups.set(node.parent, [...(groups.get(node.parent) ?? []), node])
  const row = [...groups.values()].sort((a, b) => b.length - a.length)[0]
  return row.sort((a, b) => a.screenX - b.screenX)
}

/**
 * 指示条 = 那一行的子节点里唯一不是文本的那个盒子。
 *
 * 不能按 screenX 找:第一段的指示条左边沿恰好就是行左缘(两列都是 0),按下标区分会把
 * 标签行自己认成指示条。也不能按 position 找:opentui 只暴露了 `position` 的 setter,
 * 渲染树上读不到当前值(见 Renderable.d.ts:218)。
 */
function pill(app: { renderer: { root: unknown } }) {
  const row = labels(app)[0].parent
  return row.getChildren().find((node) => (node as Node).constructor.name !== "TextRenderable") as Node | undefined
}

async function renderTabs(input: { width: number; animate?: boolean }) {
  const [active, setActive] = createSignal<TabId>("files")
  const app = await testRender(
    () => (
      <ThemeTestProviders>
        <ThemeReady />
        <SegmentTabs tabs={TABS} active={active()} onSelect={setActive} animate={input.animate} />
      </ThemeTestProviders>
    ),
    { width: input.width, height: 4 },
  )
  for (let attempt = 0; attempt < 100; attempt++) {
    await app.renderOnce()
    if (app.captureCharFrame().includes("READY")) break
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return { app, setActive }
}

/** 指示条停在这一段上:左边沿与宽度都与那个标签逐列对齐。 */
function expectLanded(app: { renderer: { root: unknown } }, index: number) {
  const label = labels(app)[index]
  const bar = pill(app)!
  expect(bar.screenX, "指示条左边沿应当与该段标签对齐").toBe(label.screenX)
  expect(bar.width, "指示条宽度应当等于该段标签的宽度").toBe(label.width)
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// 纯几何:起点是「前面各段宽度 + 每道 gap」的累加,宽度就是标签自己的显示列数。
test("分段几何:起点按前段宽度与 gap 累加,宽度按标签的显示列", () => {
  expect(segmentSlots([7, 13, 6], 1)).toEqual([
    { left: 0, width: 7 },
    { left: 8, width: 13 },
    { left: 22, width: 6 },
  ])
  expect(segmentSlots([7, 13, 6], 2)).toEqual([
    { left: 0, width: 7 },
    { left: 9, width: 13 },
    { left: 24, width: 6 },
  ])
  // 与渲染器给的宽度一致:标签列 = 字形 + 空格 + 文字。
  for (const tab of TABS) expect(Locale.displayWidth(`${tab.glyph} ${tab.text}`)).toBeGreaterThan(0)
})

// 滑动本身:k = 1 精确落在终态(动画只是过程,终态不许有误差),途中严格夹在两端之间。
test("滑动插值:途中在两端之间,走完之后精确等于终点", () => {
  const from = { left: 0, width: 7 }
  const to = { left: 22, width: 6 }
  const middle = segmentSlide(from, to, SEGMENT_SLIDE_MS / 2)
  expect(middle.left).toBeGreaterThan(from.left)
  expect(middle.left).toBeLessThan(to.left)
  expect(segmentSlide(from, to, SEGMENT_SLIDE_MS)).toEqual(to)
  expect(segmentSlide(from, to, SEGMENT_SLIDE_MS * 10)).toEqual(to)
  // 取整:终端没有半格,left/width 必须是整数。
  for (let elapsed = 0; elapsed <= SEGMENT_SLIDE_MS; elapsed += 7) {
    const slot = segmentSlide(from, to, elapsed)
    expect(Number.isInteger(slot.left)).toBe(true)
    expect(Number.isInteger(slot.width)).toBe(true)
  }
})

test("分段控件:指示条落在当前段上,切段之后滑到新的一段并对齐", async () => {
  const { app, setActive } = await renderTabs({ width: 120 })
  try {
    // 首帧就在第一段上(不播入场:它是「选中在哪」的状态指示)。
    expectLanded(app, 0)

    setActive("git")
    // 动画走完(SEGMENT_SLIDE_MS 之上留足余量)之后逐列对齐第三段。
    await wait(SEGMENT_SLIDE_MS * 4)
    await app.renderOnce()
    expectLanded(app, 2)

    // 中间那一段此刻是空的:指示条没有把两段之间的整块都铺上。
    const between = labels(app)[1]
    const bar = pill(app)!
    expect(bar.screenX === between.screenX).toBe(false)
  } finally {
    app.renderer.destroy()
  }
})

// 窗口宽度会改这一行的 gap(>160 给 2 列,否则 1 列),于是**每一段的起点都变**。
// 指示条必须跟着重算:这是「不能缓存像素」那条要求的直接验收。
test("分段控件:窗口拉宽(gap 从 1 变 2)之后指示条重新落在那一段上", async () => {
  const { app, setActive } = await renderTabs({ width: 120 })
  try {
    const narrow = labels(app).map((node) => node.screenX)
    app.resize(200, 4)
    await app.renderOnce()
    expectLanded(app, 0)
    const wide = labels(app).map((node) => node.screenX)
    // gap 真的变了 —— 否则这条用例只是把同一帧量了两遍。
    expect(wide[1] - narrow[1]).toBeGreaterThan(0)

    setActive("info")
    await wait(SEGMENT_SLIDE_MS * 4)
    await app.renderOnce()
    expectLanded(app, 1)
  } finally {
    app.renderer.destroy()
  }
})

// animations_enabled 关掉:一帧之内直接落到终态,不留中间位置、不留还在走的表。
test("分段控件:关掉动画时切换后一帧即到位(没有中间态)", async () => {
  const { app, setActive } = await renderTabs({ width: 120, animate: false })
  try {
    expectLanded(app, 0)
    setActive("git")
    await app.renderOnce()
    expectLanded(app, 2)
    // 再等一会儿也不能漂走(没有表在走)。
    await wait(SEGMENT_SLIDE_MS * 2)
    await app.renderOnce()
    expectLanded(app, 2)
  } finally {
    app.renderer.destroy()
  }
})
