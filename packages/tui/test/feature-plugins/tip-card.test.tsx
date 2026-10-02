/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import type { JSX } from "solid-js"
import { MouseEvent } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { ThemeReady, ThemeTestProviders } from "../fixture/providers"
import { Locale } from "../../src/util/locale"
import {
  fitTipActions,
  TIP_ACTION_MIN_LABEL,
  TIP_CARD_CHROME,
  TIP_DISMISS_LABEL,
  TIP_LABEL,
  TIP_LABEL_COLUMNS,
  TIP_TEXT_MIN,
  TipCard,
  tipActionColumns,
  tipCardContentWidth,
  tipCardLayout,
  tipPlainText,
  truncateParts,
} from "../../src/feature-plugins/home/tip-card"

const UPGRADE = { label: "升级", command: "app.upgrade" }
const DISMISS = { label: TIP_DISMISS_LABEL, command: "tips.dismiss" }

test("tipPlainText 去掉 highlight 标记,作为提示的身份标识", () => {
  expect(tipPlainText("运行 {highlight}NovaWay upgrade{/highlight} 更新到最新版本")).toBe(
    "运行 NovaWay upgrade 更新到最新版本",
  )
})

test("提示标签的列数就是 ● 加空格加「提示」三个片段之和", () => {
  expect(TIP_LABEL).toBe("● 提示")
  expect(TIP_LABEL_COLUMNS).toBe(Locale.displayWidth(TIP_LABEL))
})

test("按钮列数 = 胶囊左右内边距各 1 列加文案,与 Pill 的 pillColumns 同一口径", () => {
  expect(tipActionColumns("升级")).toBe(2 + Locale.displayWidth("升级"))
})

test("宽度够时按钮一颗都不动", () => {
  const fitted = fitTipActions([UPGRADE, DISMISS], 20)
  expect(fitted.actions).toEqual([UPGRADE, DISMISS])
  expect(fitted.columns).toBe(tipActionColumns("升级") + 1 + tipActionColumns("稍后"))
})

test("宽度不够时先压最宽的那颗文案,压到下限为止", () => {
  // 两颗 4 列文案 + 1 列间隙 = 13 列,给 12 列就必须压一颗。
  const fitted = fitTipActions([UPGRADE, DISMISS], 12)
  expect(fitted.columns).toBeLessThanOrEqual(12)
  // 「升级」/「稍后」都是 4 列,两颗平手 —— 先按传入顺序压第一颗,所以第二颗保持原样。
  expect(fitted.actions[1]?.label).toBe("稍后")
})

test("文案都压到下限仍放不下时,从末尾整颗丢掉(先丢「稍后」再丢动作)", () => {
  // 4 列文案被 truncateToWidth 砍到底是 3 列的「升…」(再砍一次只剩 1 列的「…」,跨过下限
  // 就不砍了),于是两颗都到底时是 (2+3) + 1 + (2+3) = 11 列。给 10 列就只能整颗丢一颗。
  const floor = 2 * (2 + 3) + 1
  const fitted = fitTipActions([UPGRADE, DISMISS], floor - 1)
  expect(fitted.actions).toHaveLength(1)
  // 末尾那颗是「稍后」,先被丢;主动作留到最后。
  expect(fitted.actions[0]?.command).toBe("app.upgrade")
  expect(Locale.displayWidth(fitted.actions[0]!.label)).toBeLessThan(Locale.displayWidth(UPGRADE.label))
  expect(fitted.columns).toBeLessThanOrEqual(floor - 1)

  const empty = fitTipActions([UPGRADE, DISMISS], 1)
  expect(empty.actions).toEqual([])
  expect(empty.columns).toBe(0)
})

test("宽终端下正文与按钮同行,按钮组占掉的列从正文预算里扣掉", () => {
  const layout = tipCardLayout({ width: 60, actions: [UPGRADE, DISMISS] })
  expect(layout.separateRow).toBe(false)
  expect(layout.textColumns).toBe(60 - TIP_LABEL_COLUMNS - layout.actionsColumns - 1)
  expect(layout.textColumns).toBeGreaterThanOrEqual(TIP_TEXT_MIN)
})

test("窄到正文放不下最低宽度时按钮换到第二行,正文拿回除标签外的全部列", () => {
  const layout = tipCardLayout({ width: 24, actions: [UPGRADE, DISMISS] })
  expect(layout.separateRow).toBe(true)
  expect(layout.textColumns).toBe(24 - TIP_LABEL_COLUMNS)
  expect(layout.actionsColumns).toBeLessThanOrEqual(24)
})

test("没有动作的提示只有一行,正文拿卡内除标签外的全部列", () => {
  const layout = tipCardLayout({ width: 30, actions: [] })
  expect(layout.separateRow).toBe(false)
  expect(layout.textColumns).toBe(30 - TIP_LABEL_COLUMNS)
})

test("卡内宽度 = 外层容器宽减去 NeonCard 的内边距三列", () => {
  expect(TIP_CARD_CHROME).toBe(3)
  expect(tipCardContentWidth(75)).toBe(72)
  // 容器比内边距还窄时不许出负数。
  expect(tipCardContentWidth(1)).toBe(0)
})

const LONG_PART = { text: "运行 NovaWay upgrade 更新到最新版本并自动重启当前应用", highlight: false }

test("正文按列截断,只有最后一段带省略号", () => {
  const cut = truncateParts([LONG_PART], 20)
  expect(cut).toHaveLength(1)
  expect(Locale.displayWidth(cut[0]!.text)).toBeLessThanOrEqual(20)
  expect(cut[0]!.text.endsWith("…")).toBe(true)
})

test("正文不够宽时按段砍,先砍掉的整段直接不出现", () => {
  const parts = [
    { text: "运行 ", highlight: false },
    { text: "NovaWay upgrade", highlight: true },
    { text: " 更新到最新版本", highlight: false },
  ]
  const cut = truncateParts(parts, 9)
  const head = Locale.displayWidth(parts[0]!.text)
  expect(cut).toHaveLength(2)
  expect(cut[0]).toEqual(parts[0])
  // 第二段只拿到剩下的那几列,第三段没有位置了。
  expect(cut[1]!.text).toBe(Locale.truncateToWidth(parts[1]!.text, 9 - head))
  expect(cut[1]!.highlight).toBe(true)
})

test("预算够宽时正文一段都不动", () => {
  const parts = [
    { text: "运行 ", highlight: false },
    { text: "NovaWay upgrade", highlight: true },
  ]
  expect(truncateParts(parts, 40)).toEqual(parts)
})

async function renderTipCard(
  body: () => JSX.Element,
  options: { width: number; height: number },
  ready: (text: string) => boolean,
) {
  const app = await testRender(body, options)
  let text = ""
  for (let attempt = 0; attempt < 200; attempt++) {
    await app.renderOnce()
    text = app.captureCharFrame()
    if (ready(text)) break
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  expect(text).toContain("READY")
  return app
}

test("提示卡:琥珀描边卡壳里是「● 提示」+ 正文,两个按钮可点", async () => {
  let ran: string[] = []
  const app = await renderTipCard(
    () => (
      <ThemeTestProviders>
        <ThemeReady />
        <TipCard
          parts={[
            { text: "运行 ", highlight: false },
            { text: "NovaWay upgrade", highlight: true },
            { text: " 更新到最新版本", highlight: false },
          ]}
          actions={[UPGRADE]}
          width={72}
          onAction={(command) => ran.push(command)}
          onDismiss={() => ran.push("tips.dismiss")}
        />
      </ThemeTestProviders>
    ),
    { width: 75, height: 8 },
    (text) => text.includes("升级") && text.includes("稍后"),
  )
  try {
    const frame = app.captureCharFrame()
    // 霓虹卡壳的四个圆角字符:没有它就不是卡片化。
    expect(frame).toContain("╭")
    expect(frame).toContain("╯")
    expect(frame).toContain("提示")
    expect(frame).toContain("NovaWay upgrade")
    // 按钮挂在卡内。
    expect(frame).toContain("升级")
    expect(frame).toContain("稍后")
  } finally {
    app.renderer.destroy()
  }
})

test("提示卡:窄终端下按钮仍可见(换到第二行),不与正文挤成一行", async () => {
  const app = await renderTipCard(
    () => (
      <ThemeTestProviders>
        <ThemeReady />
        <TipCard
          parts={[{ text: "运行 NovaWay upgrade 更新到最新版本", highlight: false }]}
          actions={[UPGRADE]}
          width={24}
          onAction={() => {}}
          onDismiss={() => {}}
        />
      </ThemeTestProviders>
    ),
    { width: 30, height: 10 },
    (text) => text.includes("升级") && text.includes("稍后"),
  )
  try {
    const rows = app
      .captureCharFrame()
      .split("\n")
      .map((row) => row.replace(/\s+$/, ""))
    const labelRow = rows.findIndex((row) => row.includes("提示"))
    const buttonRow = rows.findIndex((row) => row.includes("升级"))
    expect(labelRow).toBeGreaterThanOrEqual(0)
    expect(buttonRow).toBeGreaterThan(labelRow)
  } finally {
    app.renderer.destroy()
  }
})

type Node = {
  getChildren(): unknown[]
  processMouseEvent: (event: MouseEvent) => void
  /** opentui 把 onMouseUp 存进 _mouseListeners.up,没有公开 getter —— 按实现里的字段找。 */
  _mouseListeners?: Record<string, unknown>
}

/** 找出挂着 mouseup 的那颗盒子(Pill 的可点外壳),按渲染顺序返回。 */
function clickableBoxes(node: Node, found: Node[] = []) {
  if (typeof node._mouseListeners?.up === "function") found.push(node)
  for (const child of node.getChildren()) clickableBoxes(child as Node, found)
  return found
}

function click(node: Node) {
  node.processMouseEvent(
    new MouseEvent(node as never, {
      type: "up",
      button: 0,
      x: 0,
      y: 0,
      modifiers: { shift: false, alt: false, ctrl: false },
    }),
  )
}

// 「升级」派发命令名、「稍后」走 onDismiss —— 这两条是这张卡唯一的行为,不能只靠肉眼。
test("提示卡:点「升级」派发命令名,点「稍后」走消解回调", async () => {
  const ran: string[] = []
  const app = await renderTipCard(
    () => (
      <ThemeTestProviders>
        <ThemeReady />
        <TipCard
          parts={[{ text: "运行 NovaWay upgrade 更新到最新版本", highlight: false }]}
          actions={[UPGRADE]}
          width={72}
          onAction={(command) => ran.push(command)}
          onDismiss={() => ran.push("dismiss")}
        />
      </ThemeTestProviders>
    ),
    { width: 75, height: 8 },
    (text) => text.includes("升级") && text.includes("稍后"),
  )
  try {
    const buttons = clickableBoxes(app.renderer.root as Node)
    // 两颗:「升级」与「稍后」(按 Pill 的渲染顺序即点击顺序)。
    expect(buttons).toHaveLength(2)
    click(buttons[0]!)
    click(buttons[1]!)
    expect(ran).toEqual(["app.upgrade", "dismiss"])
  } finally {
    app.renderer.destroy()
  }
})
