# TUI 霓虹玻璃视觉基础 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 TUI 会话界面升级为「霓虹玻璃」卡片视觉：渐变描边卡片原语 + 主题 token 驱动 + TabBar 霓虹导轨 + 侧栏/消息卡片化 + 聚焦流动导轨 + crush 乱码带加宽。

**Architecture:** 先加 3 个可选主题 token（老 JSON 主题零改动、`resolveTheme` 兜底），再沉淀两个纯函数（渐变插值、卡片周长格子），在其上构建 `NeonBox` 自绘圆角渐变边框渲染器（不走 `<box border>` 的单色边框，`renderSelf` 后按周长逐格重绘字符与颜色）与 `NeonRail` 导轨组件，最后逐点替换 TabBar / 侧栏 / 消息卡片 / prompt 聚焦态。全部颜色走 `theme.*`，深浅模式与 33 个内置主题自动适配。

**Tech Stack:** Bun monorepo · `@opentui/core@0.4.5` + `@opentui/solid@0.4.5`（BoxRenderable 子类 + `extend` 自定义元素）· SolidJS · `bun:test`（`testRender` / `captureCharFrame`）· `tsgo --noEmit` · oxlint。

**设计文档:** `docs/superpowers/specs/2026-10-01-tui-neon-card-design.md`（本计划覆盖其 §3–§6；§7–§8 流程图双视图为第二份计划）。

**与设计文档的偏差（实现时按此执行）:**

- 卡片阶梯入场 / 侧滑换页动画不实现：消息列表有窗口化滚动（`util/message-window.ts`），入场动画会在滚动加载新窗口时误触发闪烁（风险大于收益）。
- prompt「扫光」由聚焦导轨的相位滚动（流动渐变）替代。
- HUD 独立角标字符不单独实现：`NeonBox` 圆角四字符 `╭╮╰╯`（渐变端色）即角标。
- `routes/session/footer.tsx` 是死代码（全仓无渲染点），状态 pill 不在其上做。
- crush 乱码带宽度取 24（设计文档写「约 60」，为会话行宽预算取 24；思考中指示保持 7）。
- 侧栏做整栏卡片 + 右缘渐变边框；设计文档 §4 的「分区面板各自成卡」与「选中行内衬高亮」降级（面板包卡会与 `scrollbox` 高度计算打架，选中行高亮价值低）。
- Tab 栏「视图·气泡/流程图」状态 pill 属于 `/layout` 命令，归第二份计划。
- 已知交互保留：`BlockTool` 悬停变色、`UserMessage` 悬停变底色；旧的用户消息右缘 `▌` 聚焦条随卡片化移除（卡片描边本身承担聚焦语义）。

**所有测试命令的工作目录均为 `packages/tui`**（仓库根 `bunfig.toml` 禁止从根跑测试）。提交只在本地，**绝不 push**。

---

### Task 1: 霓虹渐变三端主题 token

**Files:**

- Modify: `packages/tui/src/theme/index.ts`（`Theme` 类型 ~:51、`ThemeJson` ~:120、`resolveTheme` ~:266）
- Test: `packages/tui/test/theme/neon-tokens.test.ts`（新建）

- [ ] **Step 1: 跑全量基线测试**

Run: `bun test --timeout 30000`（workdir `packages/tui`）
Expected: 全绿。若基线本就有失败，记录失败清单，后续任务只对新增失败负责。

- [ ] **Step 2: 写失败测试**

新建 `packages/tui/test/theme/neon-tokens.test.ts`：

```ts
import { describe, expect, test } from "bun:test"
import { resolveTheme, type ThemeJson } from "../../src/theme"
import novaway from "../../src/theme/assets/novaway.json" with { type: "json" }

describe("霓虹渐变三端 token", () => {
  test("主题 JSON 未定义时兜底到 primary/secondary/accent", () => {
    const theme = resolveTheme(novaway as ThemeJson, "dark")
    expect(theme.neonStart).toEqual(theme.primary)
    expect(theme.neonMid).toEqual(theme.secondary)
    expect(theme.neonEnd).toEqual(theme.accent)
  })

  test("主题 JSON 显式定义时按定义解析", () => {
    const custom: ThemeJson = {
      ...novaway,
      theme: {
        ...novaway.theme,
        neonStart: "#ff0000",
        neonMid: "#00ff00",
        neonEnd: "#0000ff",
      },
    }
    const theme = resolveTheme(custom, "dark")
    expect(theme.neonStart.r).toBeCloseTo(1, 2)
    expect(theme.neonMid.g).toBeCloseTo(1, 2)
    expect(theme.neonEnd.b).toBeCloseTo(1, 2)
  })

  test("light 模式同样解析出兜底值", () => {
    const theme = resolveTheme(novaway as ThemeJson, "light")
    expect(theme.neonStart).toEqual(theme.primary)
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `bun test neon-tokens --timeout 30000`（workdir `packages/tui`）
Expected: FAIL——`theme.neonStart` 为 `undefined`，`toEqual(theme.primary)` 断言失败（bun 剥离类型不报类型错，运行时字段缺失即断言失败）。

- [ ] **Step 4: 实现（`packages/tui/src/theme/index.ts` 四处编辑）**

4a. `Theme` 类型里 `borderSubtle: RGBA`（约 :51）之后加三个字段：

```ts
  readonly neonStart: RGBA
  readonly neonMid: RGBA
  readonly neonEnd: RGBA
```

4b. `ThemeJson`（约 :120）把三个新键设为可选（照 `backgroundMenu` 的既有范式，否则 33 个内置 JSON 全部类型报错）：

```ts
export type ThemeJson = {
  $schema?: string
  defs?: Record<string, HexColor | RefName>
  theme: Omit<
    Record<ThemeColor, ColorValue>,
    "selectedListItemText" | "backgroundMenu" | "neonStart" | "neonMid" | "neonEnd"
  > & {
    selectedListItemText?: ColorValue
    backgroundMenu?: ColorValue
    neonStart?: ColorValue
    neonMid?: ColorValue
    neonEnd?: ColorValue
    thinkingOpacity?: number
  }
}
```

4c. `resolveTheme` 主循环的 filter（约 :268）把三个新键排除（与 `backgroundMenu` 同理，保证走后面的兜底分支）：

```ts
  const resolved = Object.fromEntries(
    Object.entries(theme.theme)
      .filter(
        ([key]) =>
          key !== "selectedListItemText" &&
          key !== "backgroundMenu" &&
          key !== "thinkingOpacity" &&
          key !== "neonStart" &&
          key !== "neonMid" &&
          key !== "neonEnd",
      )
      .map(([key, value]) => {
        return [key, resolveColor(value as ColorValue)]
      }),
  ) as Partial<Record<ThemeColor, RGBA>>
```

4d. 在 `backgroundMenu` 兜底块（约 :289）之后、`thinkingOpacity` 之前插入：

```ts
  // 霓虹渐变三端色:可选 token,未定义时(含 generateSystem 生成的主题)回落到
  // primary/secondary/accent,内置 JSON 主题一个都不用改。
  resolved.neonStart = theme.theme.neonStart !== undefined ? resolveColor(theme.theme.neonStart) : resolved.primary
  resolved.neonMid = theme.theme.neonMid !== undefined ? resolveColor(theme.theme.neonMid) : resolved.secondary
  resolved.neonEnd = theme.theme.neonEnd !== undefined ? resolveColor(theme.theme.neonEnd) : resolved.accent
```

- [ ] **Step 5: 跑测试确认通过**

Run: `bun test neon-tokens --timeout 30000`（workdir `packages/tui`）
Expected: PASS（3 个用例）。

- [ ] **Step 6: 类型检查 + 全量回归**

Run: `bun typecheck`（workdir `packages/tui`）
Expected: 无错误（`generateSystem()` 返回 `ThemeJson`，新键可选故无需改它）。

Run: `bun test --timeout 30000`（workdir `packages/tui`）
Expected: 全绿。若有序列化整个 theme 对象的旧用例因此失败，把三个新键补进其期望值。

- [ ] **Step 7: Commit**

```bash
git add packages/tui/src/theme/index.ts packages/tui/test/theme/neon-tokens.test.ts
git commit -m "feat(tui): 新增霓虹渐变三端主题 token（可选带兜底）"
```

---

### Task 2: 渐变插值与卡片周长格子纯函数

**Files:**

- Create: `packages/tui/src/ui/neon.ts`
- Test: `packages/tui/test/ui/neon.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `packages/tui/test/ui/neon.test.ts`：

```ts
import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { gradientAt, perimeterCells } from "../../src/ui/neon"

describe("gradientAt", () => {
  const red = RGBA.fromHex("#ff0000")
  const blue = RGBA.fromHex("#0000ff")

  test("单色直接返回原对象", () => {
    expect(gradientAt([red], 0.5)).toBe(red)
  })

  test("端点返回对应端色", () => {
    expect(gradientAt([red, blue], 0)).toEqual(red)
    expect(gradientAt([red, blue], 1)).toEqual(blue)
  })

  test("中点为两色均值", () => {
    const mid = gradientAt([red, blue], 0.5)
    expect(mid.r).toBeCloseTo(0.5, 2)
    expect(mid.b).toBeCloseTo(0.5, 2)
    expect(mid.g).toBeCloseTo(0, 2)
  })

  test("t 越界被夹紧到端点", () => {
    expect(gradientAt([red, blue], -1)).toEqual(red)
    expect(gradientAt([red, blue], 2)).toEqual(blue)
  })

  test("三段渐变中点落在中间色", () => {
    const green = RGBA.fromHex("#00ff00")
    const mid = gradientAt([red, green, blue], 0.5)
    expect(mid.g).toBeCloseTo(1, 2)
    expect(mid.r).toBeCloseTo(0, 2)
    expect(mid.b).toBeCloseTo(0, 2)
  })
})

describe("perimeterCells", () => {
  test("边长 < 2 返回空", () => {
    expect(perimeterCells(1, 5)).toEqual([])
    expect(perimeterCells(5, 1)).toEqual([])
  })

  test("周长格数 = 2w+2h-4,四角字符正确", () => {
    const cells = perimeterCells(12, 4)
    expect(cells).toHaveLength(2 * 12 + 2 * 4 - 4)
    expect(cells[0]).toMatchObject({ x: 0, y: 0, ch: "╭" })
    expect(cells[11]).toMatchObject({ x: 11, y: 0, ch: "╮" })
    expect(cells.find((cell) => cell.x === 11 && cell.y === 3)?.ch).toBe("╯")
    expect(cells.find((cell) => cell.x === 0 && cell.y === 3)?.ch).toBe("╰")
  })

  test("格子互不重复且全部落在边缘", () => {
    const cells = perimeterCells(8, 5)
    const keys = new Set(cells.map((cell) => `${cell.x},${cell.y}`))
    expect(keys.size).toBe(cells.length)
    for (const cell of cells) {
      expect(cell.x === 0 || cell.x === 7 || cell.y === 0 || cell.y === 4).toBe(true)
    }
  })

  test("t 从 0 单调升到 1", () => {
    const cells = perimeterCells(8, 5)
    expect(cells[0]!.t).toBe(0)
    expect(cells[cells.length - 1]!.t).toBe(1)
    expect(cells.every((cell, index) => index === 0 || cell.t >= cells[index - 1]!.t)).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test ui/neon --timeout 30000`（workdir `packages/tui`）
Expected: FAIL——找不到模块 `../../src/ui/neon`。

- [ ] **Step 3: 实现**

新建 `packages/tui/src/ui/neon.ts`：

```ts
import { RGBA } from "@opentui/core"
import type { Theme } from "../theme"

// 卡片/导轨的默认霓虹三端色,来自主题 token(缺省兜底见 theme/index.ts 的 resolveTheme)。
export function neonStops(theme: Theme): RGBA[] {
  return [theme.neonStart, theme.neonMid, theme.neonEnd]
}

// 沿 stops 做分段线性插值;t 越界夹紧到 [0,1];单色直接返回。
export function gradientAt(stops: readonly RGBA[], t: number): RGBA {
  if (stops.length === 0) throw new Error("gradientAt: 需要至少一个颜色")
  if (stops.length === 1) return stops[0]!
  const clamped = Math.min(1, Math.max(0, t))
  const scaled = clamped * (stops.length - 1)
  const index = Math.min(stops.length - 2, Math.floor(scaled))
  const local = scaled - index
  const from = stops[index]!
  const to = stops[index + 1]!
  return RGBA.fromValues(
    from.r + (to.r - from.r) * local,
    from.g + (to.g - from.g) * local,
    from.b + (to.b - from.b) * local,
    from.a + (to.a - from.a) * local,
  )
}

export type BorderCell = { x: number; y: number; ch: string; t: number }

// 矩形周长格子,按「上(左→右) → 右(上→下) → 下(右→左) → 左(下→上)」顺序连续一圈,
// t 是该格在整圈上的归一化进度 —— NeonBox 用它把渐变色沿边框绕一圈。
export function perimeterCells(width: number, height: number): BorderCell[] {
  if (width < 2 || height < 2) return []
  const cells: Array<{ x: number; y: number; ch: string }> = []
  for (let x = 0; x < width; x++) {
    cells.push({ x, y: 0, ch: x === 0 ? "╭" : x === width - 1 ? "╮" : "─" })
  }
  for (let y = 1; y < height - 1; y++) {
    cells.push({ x: width - 1, y, ch: "│" })
  }
  for (let x = width - 1; x >= 0; x--) {
    cells.push({ x, y: height - 1, ch: x === width - 1 ? "╯" : x === 0 ? "╰" : "─" })
  }
  for (let y = height - 2; y >= 1; y--) {
    cells.push({ x: 0, y, ch: "│" })
  }
  const last = cells.length - 1
  return cells.map((cell, index) => ({ ...cell, t: last === 0 ? 0 : index / last }))
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test ui/neon --timeout 30000`（workdir `packages/tui`）
Expected: PASS（10 个用例）。

- [ ] **Step 5: Commit**

```bash
git add packages/tui/src/ui/neon.ts packages/tui/test/ui/neon.test.ts
git commit -m "feat(tui): 新增渐变插值与卡片周长格子工具"
```

---

### Task 3: NeonBox 渐变描边卡片原语

**Files:**

- Create: `packages/tui/src/ui/card.ts`
- Test: `packages/tui/test/ui/card.test.tsx`

- [ ] **Step 1: 写失败测试**

新建 `packages/tui/test/ui/card.test.tsx`：

```tsx
/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { RGBA } from "@opentui/core"
import "../../src/ui/card"

describe("NeonBox 渐变卡片", () => {
  test("自绘圆角边框,内容画在边框内侧", async () => {
    const app = await testRender(
      () => (
        <neonbox
          width={12}
          height={4}
          backgroundColor={RGBA.fromHex("#101010")}
          gradientStops={[RGBA.fromHex("#ff0000"), RGBA.fromHex("#0000ff")]}
        >
          <text>hi</text>
        </neonbox>
      ),
      { width: 20, height: 6 },
    )
    try {
      await app.renderOnce()
      const frame = app.captureCharFrame()
      const lines = frame.split("\n")
      expect(lines[0]).toContain("╭──────────╮")
      expect(frame).toContain("│")
      expect(frame).toContain("╯")
      expect(frame).toContain("│hi")
    } finally {
      app.renderer.destroy()
    }
  })

  test("不给 gradientStops 时不画边框(退回普通 box 行为)", async () => {
    const app = await testRender(
      () => (
        <neonbox width={8} height={3} backgroundColor={RGBA.fromHex("#101010")}>
          <text>plain</text>
        </neonbox>
      ),
      { width: 20, height: 6 },
    )
    try {
      await app.renderOnce()
      const frame = app.captureCharFrame()
      expect(frame).toContain("plain")
      expect(frame).not.toContain("╭")
    } finally {
      app.renderer.destroy()
    }
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test ui/card --timeout 30000`（workdir `packages/tui`）
Expected: FAIL——`neonbox` 元素未注册（渲染报错或内容落空）。

- [ ] **Step 3: 实现**

新建 `packages/tui/src/ui/card.ts`：

```ts
import {
  BoxRenderable,
  RGBA,
  type BoxOptions,
  type OptimizedBuffer,
  type RenderContext,
} from "@opentui/core"
import { extend } from "@opentui/solid"
import { gradientAt, perimeterCells } from "./neon"

export type NeonBoxOptions = BoxOptions<NeonBoxRenderable> & {
  gradientStops?: readonly RGBA[]
}

// 霓虹玻璃卡片:不走 <box border> 的单色边框,而是在 renderSelf 之后
// 按周长格子逐格重绘圆角边框字符 + 渐变色,对齐 mockup 的渐变描边。
// 约定:四边 padding ≥ 1(构造时强制),否则内容首行/首列会被边框字符盖住。
export class NeonBoxRenderable extends BoxRenderable {
  private stops: readonly RGBA[] | undefined

  constructor(ctx: RenderContext, options: NeonBoxOptions = {}) {
    const { gradientStops, ...rest } = options
    super(ctx, {
      ...rest,
      paddingTop: Math.max(1, options.paddingTop ?? 0),
      paddingBottom: Math.max(1, options.paddingBottom ?? 0),
      paddingLeft: Math.max(1, options.paddingLeft ?? 0),
      paddingRight: Math.max(1, options.paddingRight ?? 0),
    })
    this.stops = gradientStops
  }

  get gradientStops(): readonly RGBA[] | undefined {
    return this.stops
  }

  set gradientStops(value: readonly RGBA[] | undefined) {
    this.stops = value
    this.requestRender()
  }

  protected override renderSelf(buffer: OptimizedBuffer, deltaTime = 0): void {
    super.renderSelf(buffer, deltaTime)
    const stops = this.stops
    if (!stops?.length) return
    const cells = perimeterCells(this.width, this.height)
    if (cells.length === 0) return
    const originX = this.screenX
    const originY = this.screenY
    const background = this.backgroundColor
    for (const cell of cells) {
      buffer.setCell(originX + cell.x, originY + cell.y, cell.ch, gradientAt(stops, cell.t), background)
    }
  }
}

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    neonbox: typeof NeonBoxRenderable
  }
}

extend({ neonbox: NeonBoxRenderable })
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test ui/card --timeout 30000`（workdir `packages/tui`）
Expected: PASS（2 个用例）。若 `│hi` 断言失败，先看 frame 实际内容确认 padding 是否生效（`Math.max(1, …)` 强制了四边 1 格 padding，内容应从 (1,1) 起画）。

- [ ] **Step 5: Commit**

```bash
git add packages/tui/src/ui/card.ts packages/tui/test/ui/card.test.tsx
git commit -m "feat(tui): 新增 NeonBox 渐变描边卡片原语"
```

---

### Task 4: NeonRail 导轨组件 + TabBar 下沿导轨

**Files:**

- Create: `packages/tui/src/component/neon-rail.tsx`
- Modify: `packages/tui/src/component/tab-bar.tsx`
- Test: `packages/tui/test/component/tab-bar.test.tsx`（新建）

- [ ] **Step 1: 写失败测试**

新建 `packages/tui/test/component/tab-bar.test.tsx`：

```tsx
/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { KVProvider } from "../../src/context/kv"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { ArgsProvider } from "../../src/context/args"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { TestTuiContexts } from "../fixture/tui-environment"
import { TabBar } from "../../src/component/tab-bar"

test("TabBar 底边是霓虹导轨(全宽 ━ 行)", async () => {
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <TuiConfigProvider config={createTuiResolvedConfig()}>
          <ArgsProvider>
            <KVProvider>
              <ThemeProvider mode="dark">
                <TabBar
                  tabs={[{ id: "chat", title: "会话", type: "chat", closable: false }]}
                  activeTabId="chat"
                  onTabClick={() => {}}
                  onTabClose={() => {}}
                />
              </ThemeProvider>
            </KVProvider>
          </ArgsProvider>
        </TuiConfigProvider>
      </TestTuiContexts>
    ),
    { width: 40, height: 4 },
  )
  try {
    await app.renderOnce()
    const lines = app.captureCharFrame().split("\n")
    expect(lines[0]).toContain("会话")
    expect(lines[1]).toContain("━")
  } finally {
    app.renderer.destroy()
  }
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test tab-bar --timeout 30000`（workdir `packages/tui`）
Expected: FAIL——当前 TabBar 底边是 `border={["bottom"]}`（`─`/`border` 字符），第 2 行没有 `━`。

- [ ] **Step 3: 实现 NeonRail**

新建 `packages/tui/src/component/neon-rail.tsx`：

```tsx
import { createMemo, createSignal, For, onCleanup, onMount } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import type { RGBA } from "@opentui/core"
import { useKV } from "../context/kv"
import { gradientAt } from "../ui/neon"

// 霓虹导轨:一行(或一列)全宽的渐变色条,替代原 TabBar 下边框/侧栏分隔线。
// animated 时相位每 80ms 滚动一格,整条渐变像水流一样沿轨道移动;
// animations_enabled 关闭时相位停止,静态渐变保留。
export function NeonRail(props: { stops: readonly RGBA[]; vertical?: boolean; animated?: boolean }) {
  const dimensions = useTerminalDimensions()
  const kv = useKV()
  const [phase, setPhase] = createSignal(0)

  onMount(() => {
    if (!props.animated) return
    const timer = setInterval(() => {
      if (!kv.get("animations_enabled", true)) return
      setPhase((value) => (value + 1) % 100)
    }, 80)
    onCleanup(() => clearInterval(timer))
  })

  const count = createMemo(() => (props.vertical ? dimensions().height : dimensions().width))
  const spans = createMemo(() => {
    const total = count()
    const ch = props.vertical ? "┃" : "━"
    return Array.from({ length: total }, (_, index) => {
      const base = total <= 1 ? 0 : index / (total - 1)
      const t = props.animated ? (base + phase() / 100) % 1 : base
      return { ch, fg: gradientAt(props.stops, t) }
    })
  })

  return (
    <box width={props.vertical ? 1 : "100%"} height={props.vertical ? "100%" : 1} flexShrink={0} overflow="hidden">
      <text wrapMode="none">
        <For each={spans()}>{(span) => <span style={{ fg: span.fg }}>{span.ch}</span>}</For>
      </text>
    </box>
  )
}
```

- [ ] **Step 4: 实现 TabBar 改造**

`packages/tui/src/component/tab-bar.tsx`：顶部 import 区追加

```ts
import { neonStops } from "../ui/neon"
import { NeonRail } from "./neon-rail"
```

把 `HEIGHT` 的注释（:15）改为：

```ts
// 标签条的高度是钉死的:1 行标签 + 1 行霓虹渐变导轨。
// 它是一个横排的条,任何让它变高的东西(过长的标题折行、标题里的 \n、被 flex 压缩)
// 都会顶掉下面的会话区。所以高度写死、不参与压缩、内容溢出直接裁掉。
```

把 `TabBar` 的 return（:31–84）整体替换为（标签行内容不变，仅外包一层列布局 + 底行换导轨）：

```tsx
  return (
    <box flexDirection="column" height={HEIGHT} flexShrink={0} overflow="hidden">
      <box
        flexDirection="row"
        flexGrow={1}
        overflow="hidden"
        paddingTop={0}
        paddingBottom={0}
        paddingLeft={1}
        paddingRight={1}
      >
        <For each={props.tabs}>
          {(tab) => {
            const isActive = () => tab.id === props.activeTabId
            return (
              <box
                flexDirection="row"
                flexShrink={0}
                paddingLeft={1}
                paddingRight={1}
                paddingTop={0}
                paddingBottom={0}
                backgroundColor={isActive() ? theme.backgroundPanel : theme.backgroundElement}
                onMouseUp={() => props.onTabClick(tab.id)}
              >
                <text
                  wrapMode="none"
                  fg={isActive() ? theme.primary : theme.textMuted}
                  attributes={isActive() ? TextAttributes.BOLD : undefined}
                >
                  {tab.type === "chat" ? `${icon("chat")} ` : `${icon("doc")} `}
                  {Locale.oneLine(tab.title, TITLE_MAX)}
                </text>
                <Show when={tab.closable}>
                  <text
                    wrapMode="none"
                    fg={theme.textMuted}
                    paddingLeft={1}
                    onMouseUp={(e) => {
                      e.stopPropagation()
                      props.onTabClose(tab.id)
                    }}
                  >
                    ✕
                  </text>
                </Show>
              </box>
            )
          }}
        </For>
      </box>
      {/* 原 border={["bottom"]} 换成主题驱动的霓虹导轨 */}
      <NeonRail stops={neonStops(theme)} />
    </box>
  )
```

- [ ] **Step 5: 跑测试确认通过**

Run: `bun test tab-bar --timeout 30000`（workdir `packages/tui`）
Expected: PASS。

- [ ] **Step 6: 类型检查**

Run: `bun typecheck`（workdir `packages/tui`）
Expected: 无错误。

- [ ] **Step 7: Commit**

```bash
git add packages/tui/src/component/neon-rail.tsx packages/tui/src/component/tab-bar.tsx packages/tui/test/component/tab-bar.test.tsx
git commit -m "feat(tui): TabBar 下边框换成霓虹渐变导轨"
```

---

### Task 5: 侧栏改为霓虹卡片容器

**Files:**

- Modify: `packages/tui/src/routes/session/sidebar.tsx`（import 区、根 box ~:87）

- [ ] **Step 1: 编辑 import 区**

在 `packages/tui/src/routes/session/sidebar.tsx` import 区追加（`import "../ui/card"` 是副作用导入，负责注册 `neonbox` 元素）：

```ts
import "../ui/card"
import { neonStops } from "../../ui/neon"
```

- [ ] **Step 2: 根 box 换 neonbox**

把根元素（~:87–98）：

```tsx
    <box
      backgroundColor={theme.backgroundPanel}
      width={sidebarWidth(dimensions().width)}
      height="100%"
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
      position={props.overlay ? "absolute" : "relative"}
      flexDirection="column"
    >
```

替换为：

```tsx
    <neonbox
      backgroundColor={theme.backgroundPanel}
      gradientStops={neonStops(theme)}
      width={sidebarWidth(dimensions().width)}
      height="100%"
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
      position={props.overlay ? "absolute" : "relative"}
      flexDirection="column"
    >
```

闭合标签：把 `Sidebar` return JSX 的最后一个 `</box>`（:225，紧跟品牌页脚 box 之后）改为 `</neonbox>`。右缘渐变边框即设计文档里「与聊天区之间的竖向发光导轨」，不再单独加导轨组件。

- [ ] **Step 3: 跑既有侧栏测试（回归）**

Run: `bun test sidebar --timeout 30000`（workdir `packages/tui`）
Expected: PASS——既有断言用 `toContain("文件")` 等子串匹配，新增边框字符不破坏断言。若有失败，先确认是边框遮挡内容还是宽度挤压，再调 padding（不要直接改断言）。

- [ ] **Step 4: 类型检查**

Run: `bun typecheck`（workdir `packages/tui`）
Expected: 无错误。

- [ ] **Step 5: Commit**

```bash
git add packages/tui/src/routes/session/sidebar.tsx
git commit -m "feat(tui): 侧栏改为霓虹卡片容器"
```

---

### Task 6: 会话消息卡片化（用户消息 / 错误 / 思考 / 工具折叠）

**Files:**

- Modify: `packages/tui/src/routes/session/index.tsx`（import 区、`UserMessage` ~:1763–1832、错误块 ~:1915、`ReasoningPart` ~:2031、`BlockTool` ~:2493）

- [ ] **Step 1: 编辑 import 区**

在 `packages/tui/src/routes/session/index.tsx` import 区追加（`import "../../ui/card"` 负责注册 `neonbox`）：

```ts
import "../../ui/card"
import { neonStops } from "../../ui/neon"
```

- [ ] **Step 2: UserMessage 卡片化**

2a. 删除 `color` memo（:1765）与 `local` 声明（:1750）——卡片化后不再有 agent 色右缘条，`local` 在本函数内只有 `color` memo 这一个引用，一并删掉否则 lint 报未使用：

```ts
  const local = useLocal()
  ...
  const color = createMemo(() => local.agent.color(props.message.agent))
```

2b. 把外层右缘条 box + 内层气泡 box（:1772–1832 的两个 box 开头标签，children 不动）替换为外层容器 + `neonbox` 气泡：

```tsx
      <Show when={text()}>
        {/* crush 式用户气泡:霓虹渐变描边卡片,靠右对齐;悬停只提亮底色。 */}
        <box
          id={props.message.id}
          ref={(el: BoxRenderable) => alwaysSeparate.add(el)}
          marginTop={props.index === 0 ? 0 : 1}
          alignItems="flex-end"
          width="100%"
          onMouseOver={() => setHover(true)}
          onMouseOut={() => setHover(false)}
        >
          <neonbox
            onMouseUp={props.onMouseUp}
            gradientStops={neonStops(theme)}
            backgroundColor={hover() ? theme.backgroundElement : theme.backgroundPanel}
            paddingTop={1}
            paddingBottom={1}
            paddingLeft={2}
            paddingRight={2}
            flexShrink={0}
            maxWidth="70%"
            alignItems="flex-end"
          >
```

原内层 box 的 `<text fg={theme.text}>{text()}</text>` 起到 `</Show files>` / `</Show timestamps>` 为止的 children 全部保留；原内层 `</box>`（:1831）改为 `</neonbox>`，外层 `</box>`（:1832）保留。原 :1799–1801 的注释（关于右对齐与 width 的约束）保留在 `neonbox` 上方。

- [ ] **Step 3: 错误块卡片化**

把错误块（:1915–1929）：

```tsx
        <box
          ref={(el: BoxRenderable) => alwaysSeparate.add(el)}
          border={["left"]}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          marginTop={1}
          backgroundColor={theme.backgroundPanel}
          customBorderChars={SplitBorder.customBorderChars}
          borderColor={theme.error}
        >
          <text fg={theme.textMuted}>{errorMessage(props.message.error)}</text>
        </box>
```

替换为：

```tsx
        <neonbox
          ref={(el: BoxRenderable) => alwaysSeparate.add(el)}
          gradientStops={[theme.error]}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          paddingRight={1}
          marginTop={1}
          backgroundColor={theme.backgroundPanel}
        >
          <text fg={theme.textMuted}>{errorMessage(props.message.error)}</text>
        </neonbox>
```

- [ ] **Step 4: ReasoningPart 卡片化**

把思考块的灰底 box（:2031）：

```tsx
        <box backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
```

替换为（紫青语义描边 = `neonMid→neonEnd`；开/关逻辑与子内容不动）：

```tsx
        <neonbox
          gradientStops={[theme.neonMid, theme.neonEnd]}
          backgroundColor={theme.backgroundElement}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          paddingRight={2}
        >
```

对应地，把该块的闭合 `</box>`（:2055——其上一行是内容 `</Show>`，其下一行是外层 box 的 `</box>`，别改错成 :2056）改为 `</neonbox>`。:2030 的注释更新为：

```tsx
        {/* crush 式思考块:紫青渐变描边卡片 + 第 2 级灰底,和工具输出同一套弱对比语言 */}
```

- [ ] **Step 5: BlockTool 卡片化**

把工具折叠块（:2493–2509 的开标签）：

```tsx
    <box
      ref={(el: BoxRenderable) => alwaysSeparate.add(el)}
      border={["left"]}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      marginTop={1}
      gap={1}
      backgroundColor={hover() ? theme.backgroundMenu : theme.backgroundElement}
      customBorderChars={SplitBorder.customBorderChars}
      borderColor={theme.background}
      onMouseOver={() => props.onClick && setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={() => {
        if (renderer.getSelection()?.getSelectedText()) return
        props.onClick?.()
      }}
    >
```

替换为：

```tsx
    <neonbox
      ref={(el: BoxRenderable) => alwaysSeparate.add(el)}
      gradientStops={neonStops(theme)}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={1}
      marginTop={1}
      gap={1}
      backgroundColor={hover() ? theme.backgroundMenu : theme.backgroundElement}
      onMouseOver={() => props.onClick && setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={() => {
        if (renderer.getSelection()?.getSelectedText()) return
        props.onClick?.()
      }}
    >
```

对应闭合 `</box>`（:2529）改为 `</neonbox>`。

- [ ] **Step 6: 类型检查 + 全量测试（含快照处理）**

Run: `bun typecheck`（workdir `packages/tui`）
Expected: 无错误。若 `SplitBorder` 变成未使用导入（index.tsx 内 :1580、:1835、:1962 仍引用它，按实际结果保留或删除）。

Run: `bun test --timeout 30000`（workdir `packages/tui`）
Expected: 全绿。若 `inline-tool-*` 快照失败：先 `git diff packages/tui/test/` 确认差异只来自卡片边框字符（无内容丢失），再执行 `bun test --update-snapshots --timeout 30000` 更新快照，然后复查 `git diff packages/tui/test/` 中的 `.snap` 文件内容合理。**不许**在未看 diff 的情况下直接更新快照。

- [ ] **Step 7: Commit**

```bash
git add packages/tui/src/routes/session/index.tsx
git add packages/tui/test/   # 若快照被更新
git commit -m "feat(tui): 会话消息卡片化（用户/错误/思考/工具折叠）"
```

---

### Task 7: crush 工作指示乱码带加宽

**Files:**

- Modify: `packages/tui/src/util/anim-spinner.ts`（新增 `animFramesCached`）
- Modify: `packages/tui/src/component/spinner.tsx`（`WorkingSpinner` 加 `width` 可选属性）
- Modify: `packages/tui/src/routes/session/index.tsx`（`WorkingLine` ~:2108）
- Test: `packages/tui/test/util/anim-spinner.test.ts`（追加用例）

- [ ] **Step 1: 写失败测试**

在 `packages/tui/test/util/anim-spinner.test.ts` 的 import 行追加 `animFramesCached`，并在 `describe("anim spinner 帧生成")` 末尾追加：

```ts
  test("animFramesCached:同参数复用同一数组,宽度正确", () => {
    expect(animFramesCached(24)).toBe(animFramesCached(24))
    expect(animFramesCached(24)[0]).toHaveLength(24)
    expect(animFramesCached(24)).toEqual(animFrames(24, 120))
  })
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test anim-spinner --timeout 30000`（workdir `packages/tui`）
Expected: FAIL——`animFramesCached` 未导出（import 报错）。

- [ ] **Step 3: 实现**

3a. `packages/tui/src/util/anim-spinner.ts` 末尾追加：

```ts
// 同参数复用同一套帧:WorkingSpinner 的可选宽度会随组件重渲染反复请求,
// 缓存避免重复生成;键含 count/birth,参数不同不串台。
const FRAME_CACHE = new Map<string, string[]>()

export function animFramesCached(width: number, count = 120, birth = 20): string[] {
  const key = `${width}:${count}:${birth}`
  const cached = FRAME_CACHE.get(key)
  if (cached) return cached
  const frames = animFrames(width, count, birth)
  FRAME_CACHE.set(key, frames)
  return frames
}
```

3b. `packages/tui/src/component/spinner.tsx`：import 行把 `animColors, animFrames, animGradient` 扩为 `animColors, animFrames, animFramesCached, animGradient`；`WorkingSpinner` 改为：

```tsx
// crush 的"工作指示"专用变体:扰动字符带主题双色(primary→secondary)沿列渐变,
// 标签文字用最弱对比的 muted 灰 —— 颜色固定,不跟 agent 色走。
// 用在:回答中指示、思考中、工具执行中、底部状态条。
// width 可调:回答中指示用 24 格加宽带,思考中等紧凑场景仍用默认 7。
export function WorkingSpinner(props: { children?: JSX.Element; width?: number }) {
  const { theme } = useTheme()
  const kv = useKV()
  const frames = () => animFramesCached(props.width ?? ANIM_WIDTH)
  return (
    <Show when={kv.get("animations_enabled", true)} fallback={<text fg={theme.textMuted}>⋯ {props.children}</text>}>
      <box flexDirection="row" gap={1}>
        <spinner frames={frames()} interval={ANIM_INTERVAL} color={animGradient(theme.primary, theme.secondary)} />
        <Show when={props.children}>
          <text fg={theme.textMuted}>{props.children}</text>
        </Show>
      </box>
    </Show>
  )
}
```

3c. `packages/tui/src/routes/session/index.tsx` 的 `WorkingLine`（~:2108）：

```tsx
      <WorkingSpinner width={24}>
        {props.thinking ? "思考中" : "正在回答"}
        <span style={{ fg: theme.textMuted }}> · {Locale.duration(seconds() * 1000)}</span>
      </WorkingSpinner>
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test anim-spinner --timeout 30000`（workdir `packages/tui`）
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/tui/src/util/anim-spinner.ts packages/tui/src/component/spinner.tsx packages/tui/src/routes/session/index.tsx packages/tui/test/util/anim-spinner.test.ts
git commit -m "feat(tui): 工作指示乱码带支持加宽"
```

---

### Task 8: prompt 聚焦流动霓虹导轨

**Files:**

- Modify: `packages/tui/src/component/prompt/index.tsx`（信号区 ~:182、textarea props ~:1463、锚点 box ~:1385）

- [ ] **Step 1: 加聚焦信号**

在 `packages/tui/src/component/prompt/index.tsx` 的 `animationsEnabled` memo（:182）附近追加（该文件已有 `createSignal` 导入）：

```ts
  // 聚焦态驱动输入框上方的流动霓虹导轨:on:focused/on:blurred 是 Renderable 的
  // EventEmitter 事件,由 solid 的 on: 前缀接线。
  const [promptFocused, setPromptFocused] = createSignal(false)
```

- [ ] **Step 2: textarea 接焦点事件**

在 textarea 的 props 里（与 `onMouseDown`（:1463）同级）追加：

```tsx
              on:focused={() => setPromptFocused(true)}
              on:blurred={() => setPromptFocused(false)}
```

- [ ] **Step 3: 锚点 box 顶部渲染导轨**

在锚点 box（:1385 `<box ref={(r: BoxRenderable) => (anchor = r)} ...>`）内部、首行编辑器 row（:1388 `<box width="100%" flexDirection="row" paddingTop={1} ...>`）之前插入：

```tsx
        <Show when={promptFocused()}>
          <NeonRail stops={neonStops(theme)} animated />
        </Show>
```

import 区追加：

```ts
import { NeonRail } from "../neon-rail"
import { neonStops } from "../../ui/neon"
```

（`Show` 与 `theme` 在该文件已存在：`Show` 见 :1529，`theme` 见 :1338，直接复用。）

- [ ] **Step 4: 类型检查 + 手工验证**

Run: `bun typecheck`（workdir `packages/tui`）
Expected: 无错误（`on:${string}` 在 ElementProps 中为合法事件名）。

手工验证：仓库根 `bun dev` 进入 TUI → 焦点在输入框时，输入框上方出现随相位流动的渐变导轨；打开任意对话框（焦点离开）导轨消失；`/animation`（命令名以 `app.tsx:1014` 为准，标题为「禁用动画」）关闭动画后导轨静止。
**若 `on:focused` 不触发（导轨始终不出现）**：回退方案是把 textarea `ref` 里拿到的 renderable 接 `r.on("focused", …)` / `r.on("blurred", …)`（EventEmitter，`on:` 前缀走同一通道），事件名以 `node_modules/@opentui/core/Renderable.d.ts` 的 emitter 声明为准，逐个试到触发为止，然后回到 Step 4 重验。

- [ ] **Step 5: Commit**

```bash
git add packages/tui/src/component/prompt/index.tsx
git commit -m "feat(tui): 输入框聚焦显示流动霓虹导轨"
```

---

### Task 9: 全量验证与收尾

**Files:** 无新增修改（只验证；发现问题则修在哪就在哪补任务）。

- [ ] **Step 1: 全量测试**

Run: `bun test --timeout 30000`（workdir `packages/tui`）
Expected: 全绿（与 Task 1 Step 1 基线一致）。

- [ ] **Step 2: 类型检查**

Run: `bun typecheck`（workdir `packages/tui`）
Expected: 无错误。

- [ ] **Step 3: Lint**

Run: `bun lint`（workdir 仓库根）
Expected: 无新增错误（oxlint `typeAware: true`）。

- [ ] **Step 4: 格式化**

Run: `./script/format.ts`（workdir 仓库根）
Expected: 只格式化本次改动文件；`git status` 确认无意外格式化扩散，有则一并纳入下次提交。

- [ ] **Step 5: 视觉验收清单（仓库根 `bun dev`）**

逐项过，任一不过就修：

1. TabBar 下沿是全宽渐变导轨（粉→紫→青随主题）。
2. 侧栏整体为圆角渐变描边卡片，右缘导轨色，内容无遮挡、窄/宽屏切换正常。
3. 用户消息为右对齐渐变卡片，悬停提亮底色。
4. 错误块红色圆角卡、思考块紫青圆角卡、工具折叠块渐变圆角卡，悬停/展开交互不回退。
5. 「正在回答」行为 24 格乱码带 + 计时；思考中指示仍为 7 格。
6. 输入框聚焦出现流动导轨、失焦消失；禁用动画后静止。
7. `/theme-mode` 切换深浅模式、切换至少 3 个内置主题（如 novaway / catppuccin / gruvbox），导轨与卡片描边随之变色、无破色。
8. 消息区滚动长会话：卡片边框在 scrollbox 内位置正确（不漂移、不残影）。

- [ ] **Step 6: 最终提交（若有验收修复）**

```bash
git add -u packages/tui
git commit -m "fix(tui): 霓虹卡片视觉验收修正"
```

验收全部通过、无需修复时跳过本步。

---

## Self-Review 记录（写计划时已执行）

- **Spec 覆盖（§3–§6 范围内）**: §3.1 ①渐变框→Task 2/3；②深色实底→NeonBox `backgroundColor` 调用方；③语义色→Task 6 错误/思考 stops；④动效（聚焦流动）→Task 4/8，HUD 角标→圆角字符（偏差清单）；⑤深浅自适应+⑥主题驱动→Task 1 token 全走 `theme.*`；⑦crush→Task 7（已有 WorkingSpinner 基础上加宽）；⑧双视图→第二份计划。§4 区域表: titlebar 导轨→Task 4，侧栏→Task 5，Tab→Task 4，消息区→Task 6，prompt→Task 8，footer→偏差清单（死代码），思考指示→既有 + Task 7，`ui/card.tsx` 原语→Task 3（文件名为 `ui/card.ts`，无 JSX）。
- **占位符扫描**: 所有步骤均含完整代码/命令/预期输出；Task 8 Step 4 的回退分支给出了具体事件通道与文件路径，不是"TODO"。
- **类型一致性**: `neonStops` / `gradientAt` / `perimeterCells` / `NeonBoxRenderable`(元素 `neonbox`, 属性 `gradientStops`) / `NeonRail`(属性 `stops|vertical|animated`) / `animFramesCached` 各任务间名称一致；`neonStart/neonMid/neonEnd` 在 Task 1 定义、Task 2/4/6/8 消费。
