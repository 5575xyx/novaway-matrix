// 侧栏顶部的分段控件:一行标签 + 一枚**会滑**的指示条。
//
// 原型那边是一枚绝对定位的 `.seg-ind`(card-design-v7.html:127-135),`segTo()` 把它的
// transform 改到被点的那一段上,配 `transition: transform .42s var(--ease), width .42s` ——
// 于是切页时高亮是「滑过去」的,而不是跳过去。终端里没有 transform/transition,
// 同一件事只能自己插值:记下起点与终点,每 16ms 走一格 easeOut,写回指示条的 left/width。
//
// **几何一律现算,不缓存像素**:每段的宽度就是那段标签自己的显示列数,起点是「前面各段宽度
// + 每道 gap」的累加(gap 随终端宽度在 1/2 之间跳)。窗口一变、图标风格一变(/icon),
// 累加出来的起点就变 —— 缓存下来的像素于是会指向一个已经不存在的位置。这三行 memo
// 读的就是当前这三条输入,所以「重算」是 Solid 的默认行为,不是谁记得去刷新。
import { createEffect, createMemo, createSignal, For, onCleanup, untrack } from "solid-js"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import { useKV } from "../context/kv"
import { useTheme } from "../context/theme"
import { Locale } from "../util/locale"

export interface SegmentTab<T extends string> {
  id: T
  text: string
  /** 标签左边的字形。省略就没有那一列。 */
  glyph?: string
}

export interface SegmentTabsProps<T extends string> {
  tabs: readonly SegmentTab<T>[]
  active: T
  onSelect: (id: T) => void
  /**
   * 指示条滑不滑。
   *
   * 「要不要动」由调用方决定,animations_enabled 这类用户设置在调用方折进来(与 NeonBox 的
   * `animated` 同一套约定,见 ui/card.ts):关掉是直接落终态、打开是接着滑,两边对称。
   * 省略 = 读 KV 里那个 animations_enabled(默认开)。
   */
  animate?: boolean
}

export type SegmentSlot = { left: number; width: number }

/** 标签的完整文本 = 字形 + 一个空格 + 文字。侧栏三个标签都是这个形状。 */
function labelText(tab: SegmentTab<string>) {
  return tab.glyph ? `${tab.glyph} ${tab.text}` : tab.text
}

/**
 * 每段相对**行左缘**的 [起点, 宽度]。
 *
 * 宽度就是标签自己的显示列数 —— 那正是渲染器给这个 `<text>` 的宽度(yoga 按内容宽度排它,
 * 而 Locale.displayWidth 与渲染器用的是同一套字素宽度,Bun.stringWidth 逐字素量)。
 * 起点是前面各段宽度加每道 gap 的累加,与 flex row + gap 的排版结果一致。
 */
export function segmentSlots(widths: readonly number[], gap: number): SegmentSlot[] {
  let left = 0
  return widths.map((width) => {
    const slot = { left, width }
    left += width + gap
    return slot
  })
}

// 一次滑动走多久。原型是 `transform .42s var(--ease)`(card-design-v7.html:134),
// 那一族 --ease 就是 ease-out。终端一格就是 42ms 里的一步,420ms 在这里偏慢
// (那是给浏览器过渡用的,这里没有合成层),收到 140ms:仍跨过 8~9 帧,肉眼读得出「滑过去」,
// 又不至于让「切页」这件事等半秒才落定。步长与霓虹相位表(80ms)无关,自己走 16ms。
export const SEGMENT_SLIDE_MS = 140
const FRAME_MS = 16

/** easeOutCubic:起步快、收尾稳,和原型那一族过渡同形状。 */
function easeOut(t: number) {
  const k = Math.min(1, Math.max(0, t))
  return 1 - (1 - k) ** 3
}

/**
 * 滑动到 elapsed 毫秒时指示条该在的位置。
 *
 * 两端都取整:终端没有半格,`left`/`width` 必须是整数,否则渲染器会自己截,落点就偏一格。
 * k = 1 时**精确**等于 to —— 这是「一定落到位」这条断言的根据(动画只是过程,终态不许有误差)。
 */
export function segmentSlide(from: SegmentSlot, to: SegmentSlot, elapsed: number): SegmentSlot {
  const k = easeOut(elapsed / SEGMENT_SLIDE_MS)
  if (k >= 1) return to
  return {
    left: Math.round(from.left + (to.left - from.left) * k),
    width: Math.round(from.width + (to.width - from.width) * k),
  }
}

export function SegmentTabs<T extends string>(props: SegmentTabsProps<T>) {
  const { theme } = useTheme()
  const kv = useKV()
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()

  // 行内 gap:宽终端 2 列、窄的 1 列。**它是随终端宽度变的**,而每段的起点是
  // 「前面各段宽度 + 每道 gap」的累加 —— 所以窗口一变,后面每一段的起点都跟着挪。
  const gap = createMemo(() => (dimensions().width > 160 ? 2 : 1))
  const slots = createMemo(() =>
    segmentSlots(
      props.tabs.map((tab) => Locale.displayWidth(labelText(tab))),
      gap(),
    ),
  )
  const target = createMemo(
    () =>
      slots()[
        Math.max(
          0,
          props.tabs.findIndex((tab) => tab.id === props.active),
        )
      ] ?? { left: 0, width: 0 },
  )

  // 指示条当前的位置。首帧就是终态(不播入场):它是「选中在哪」的状态指示,
  // 从 0 滑进来会被读成「刚切过页」。
  const [pill, setPill] = createSignal(target())
  let from = pill()
  let startedAt = 0
  let timer: ReturnType<typeof setInterval> | undefined

  const stop = () => {
    if (!timer) return
    clearInterval(timer)
    timer = undefined
  }

  createEffect(() => {
    const to = target()
    // 当前位置用 untrack 读:它是被这个 effect 自己写的,读了就等于每帧重启一次动画。
    const current = untrack(pill)
    if (current.left === to.left && current.width === to.width) return
    stop()
    if (!(props.animate ?? kv.get("animations_enabled", true))) {
      // 直接落到终态:不留中间位置,也不留一张还在走的表(留着的话用户重新打开动画时它会
      // 接着往一个早就作废的目标上走)。
      from = to
      setPill(to)
      return
    }
    // 从**当前**位置起滑,而不是从上一段的起点:连点第三个标签时动画不会回跳一下。
    from = current
    startedAt = Date.now()
    timer = setInterval(() => {
      const next = segmentSlide(from, to, Date.now() - startedAt)
      setPill(next)
      // 这一版 opentui 不消费渲染物的 dirty 标志(见 routes/session/sidebar 那个 flow= 的
      // 代价注释),动画每一格都要自己叫一次重绘。
      renderer.requestRender()
      if (next.left === to.left && next.width === to.width) stop()
    }, FRAME_MS)
  })

  onCleanup(stop)

  return (
    <box flexDirection="row" gap={gap()} paddingBottom={1} flexShrink={0}>
      {/* 指示条画在标签**之前**:兄弟节点按顺序绘制,放前面标签才压在这枚底色上。
          绝对定位 —— 它不能参与这一行的排版,一动就会把标签的起点顶走。

          底色这一档:原型那枚是 `rgba(79,209,224,.10)` 的玻璃底 + 一圈青色描边
          (card-design-v7.html:127-135)。终端里一格就是一格,0.10 的叠色读不出来,而那圈
          描边在 1 行的条上就是另一行 —— 所以只保留「一枚被点亮的面」这一半,取
          backgroundElement:那正是本仓库给「这一行被选中」用的面(文件树的选中行、
          会话页的激活标签都是它),按定义就与 backgroundPanel 在明暗两种主题下都分得开。
          不做叠色折算:主题声明 transparent 时 alphaOver 会拿纯黑当底,浅色终端上就是
          一块脏斑(理由见 ui/neon 的 softenOver)。 */}
      <box
        position="absolute"
        left={pill().left}
        top={0}
        width={pill().width}
        height={1}
        backgroundColor={theme.backgroundElement}
      />
      <For each={props.tabs}>
        {(tab) => (
          <text
            fg={props.active === tab.id ? theme.primary : theme.textMuted}
            wrapMode="none"
            onMouseUp={() => props.onSelect(tab.id)}
          >
            {labelText(tab)}
          </text>
        )}
      </For>
    </box>
  )
}
