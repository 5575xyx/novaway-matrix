import { createEffect, createMemo, createSignal, on, onCleanup, Show, type JSX } from "solid-js"
import { CHAT_VIEWS, type ChatView } from "./chat-view"

/**
 * 聊天视图的侧滑换页舞台(任务 D4)。
 *
 * 原型 card-design-v7.html 的 `switchView()`(:1206)靠 CSS transform 让旧视图退场、新视图进场;
 * 终端没有 transform,等效手法是**逐帧改绝对定位盒子的 left** —— 视图容器绝对定位、
 * 每帧把偏移量推进一点,动画走完再把旧视图卸载。
 *
 * 为什么偏移量要折成纯函数(`slideOffsets`):进度→列数这条映射是整个过渡里唯一有算术的部分,
 * 缓动曲线、方向取负、越界夹取都在这里。它是纯函数,单测直接盯它 —— 而逐帧定时器、
 * renderable 的挂载销毁只有渲染测试能盖到,两边不重叠。
 */

/**
 * 一帧的时长。8 帧 × 25ms = 200ms。
 *
 * 怎么来的:原型那条 CSS transition 是 .45s,照搬到终端就是「点了半秒没反应」—— 每一帧都要重排
 * 整屏字符,200ms 内已经跨过 8 次相位,方向看得清。它比流程图边的揭示(EDGE_FRAME_MS = 60)快
 * 一倍多:揭边是背景动画,换页是用户刚按下的手势,要的是「立刻动起来」;但也不能快到 3~4 帧
 * (那时在逐帧重排的字符画布上只剩闪一下,看不出在滑)。
 */
export const SLIDE_FRAME_MS = 25

/**
 * 过渡的总帧数。8 = 200ms / SLIDE_FRAME_MS。
 *
 * 与 NeonBox 的阶梯入场同一个取向:相位推到上限就停,空闲零开销(见下面 createEffect 里
 * 那一处 clearInterval)。给到 8 帧而不是 12 是因为偏移是**线性距离**:8 帧里每帧要走满宽的
 * 1/8,再多帧只是把同一段路走得更碎。
 */
export const SLIDE_FRAMES = 8

/**
 * 切换方向:新视图在**右边**就返回 -1(旧视图向左滑出),在左边返回 1。
 *
 * CHAT_VIEWS 的下标就是原型的左右次序(`bubble` 在 0、`flow` 在 1,原型里 #viewBubble 在左、
 * #viewFlow 在右),所以方向不用另存一份映射 —— 换视图就是往下标大的那边切。
 * 同一个视图给 1:调用方不会问,但纯函数不该在这种输入上返回 NaN。
 */
export function slideDirection(from: ChatView, to: ChatView): 1 | -1 {
  return CHAT_VIEWS.indexOf(to) > CHAT_VIEWS.indexOf(from) ? -1 : 1
}

/**
 * 缓动:ease-out 二次,`1 − (1 − t)²`。
 *
 * 为什么是它:原型那条 transition 用的是 CSS 的 `var(--ease)`(cubic-bezier(.22,.61,.36,1)),
 * 形状是「起手快、收尾慢」。这个曲线同向,但只有一次乘法 —— 不查表、不插值数组,窄终端上算
 * 一次成本可以忽略,而且能被单测精确断言(中点 0.75)。中途的线性移动在字符画布上看起来像卷帘
 * 快速关闭,与「换页」这件事的语义相反。
 */
export function slideEase(progress: number): number {
  const k = Math.min(1, Math.max(0, progress))
  return 1 - (1 - k) * (1 - k)
}

/**
 * 进度 → 两个视图各自的横向偏移(列,正数向右)。
 *
 * `outgoing` 是正在退场的旧视图,`incoming` 是正在进场的新视图。两者的关系是
 * **`incoming = outgoing − direction × width`**,不是「互为相反数」—— 这一步是整段动画对不对的
 * 关键:两个视图各占舞台整整一列宽,并排时必须**首尾相接**。
 *   取 progress = 0.5、width = 48、direction = -1:outgoing = −36,盒身占 [−36, 12);
 *   incoming = +12,盒身占 [12, 60)。旧视图的右缘正好是 12,新视图的左缘也是 12 ——
 *   中间没有缝(那是「两块屏对穿」),也没有重叠(那是「两层糊在一起」)。
 * 若写成 incoming = −outgoing,中点会变成 outgoing = −36 / incoming = +36,中间空出 36 列,
 * 屏幕上就是两块内容各自滑开、中间一片空 —— 看不出是换页,只看出是错位。
 *
 * 进度夹到 [0,1]:定时器多走一拍、或者帧数被谁调大,偏移量最多停在「整屏移出」那一档 ——
 * 绝不能让一个视图被推到终端之外(那之后是空白,不是动画)。
 */
export function slideOffsets(progress: number, width: number, direction: 1 | -1) {
  // 距离为 0 时 `direction * distance` 是 -0(负零),而 -0 在 Object.is 下不等于 0,
  // 还会一路当成 left=-0 传给盒子;所以先判零再乘。
  const distance = width * slideEase(progress)
  const shift = (sign: number) => (distance === 0 ? 0 : sign * distance)
  return { outgoing: shift(direction), incoming: shift(direction) - direction * width }
}

/**
 * 视图舞台:静止时只渲染目标视图(原样占据消息区);切换时两个视图同帧共存,旧视图按方向滑出、
 * 新视图反向滑入,走完即卸载旧视图。
 *
 * 三个注入口(`animate` / `frameMs` / `width`)的理由与 FlowCanvas 的 `reveal` 一样:
 * **测试不能从 KV 那一侧拨 animations_enabled** —— KVProvider 写的是**共享**的 state/kv.json,
 * 拨一下会脏掉别的用例(test/component/prompt-card.test.tsx:319 记着这件事)。
 * 而「关动画 ⇒ 直接切换」恰恰是最该被测试的那条分支。
 *
 * 两个视图各画在自己的绝对定位盒子里,与舞台同宽同高 —— 于是**过渡期间谁都不占消息区的
 * 布局高度**:舞台自己的高度来自父列盒的 flexGrow,两个子盒是 absolute,不参与分配。
 * 动画结束卸载旧盒子、目标视图回到普通流式布局,舞台高度前后一致,底栏与输入卡不会跳。
 */
export function ChatViewStage(props: {
  /** 目标视图。受控:切换由它变化驱动,组件自己不持有「当前视图」之外的第二份真相。 */
  view: ChatView
  /** 舞台可视宽度(列)。整段偏移就是这么多列 —— 旧视图滑到 ±宽度 时刚好整屏移出。 */
  width: number
  /** 是否播侧滑。省略 = 播。这是**终态乘子**:false 时直接切换,不留中间帧、不留残影。 */
  animate?: boolean
  /** 一帧多少毫秒,测试里调小。省略 = SLIDE_FRAME_MS。 */
  frameMs?: number
  /** 两个视图各是一个「返回 JSX 的函数」而不是 JSX 本身:惰性,没轮到的那个分支根本不会被求值。 */
  bubble: () => JSX.Element
  flow: () => JSX.Element
}) {
  const animating = () => props.animate ?? true
  const frameMs = () => props.frameMs ?? SLIDE_FRAME_MS
  /** 正在滑走的旧视图。undefined = 静止,只渲染目标视图。 */
  const [outgoing, setOutgoing] = createSignal<ChatView | undefined>()
  const [frame, setFrame] = createSignal(0)

  // 只在**目标视图变了**时起一次过渡。on 的回调拿到的 previous 就是这一刻还挂在屏幕上的那个,
  // 所以不需要另存一份「当前视图」:静止期的真相就是 props.view 本身。
  createEffect(
    on(
      () => props.view,
      (next, previous) => {
        if (!previous) return
        if (previous === next) return
        // 关掉动画 = 直接切换(见 ui/card 与 neon-rail 的同一个约定:该 flag 是终态乘子)。
        if (!animating()) return
        setFrame(0)
        setOutgoing(previous)
      },
    ),
  )

  // 相位表:只在过渡期间存在,推满即停并卸载旧视图。与 NeonBox 的相位表 / NeonRail 的流动
  // 同一个取向 —— 画完即静止,空闲零开销。快速连按切换时这一段会被重跑(上一次的 onCleanup
  // 先清表),旧视图取的是上一拍的 from,不会串。
  createEffect(() => {
    if (outgoing() === undefined) return
    const timer = setInterval(() => {
      if (frame() + 1 >= SLIDE_FRAMES) {
        setOutgoing(undefined)
        return
      }
      setFrame((value) => value + 1)
    }, frameMs())
    onCleanup(() => clearInterval(timer))
  })

  const offsets = createMemo(() =>
    slideOffsets(frame() / SLIDE_FRAMES, props.width, slideDirection(outgoing() ?? props.view, props.view)),
  )
  const node = (view: ChatView) => (view === "flow" ? props.flow() : props.bubble())

  return (
    // position="relative" 给两个绝对定位盒子当参照系;overflow="hidden" 是**裁剪口** ——
    // 滑到一半的视图超出舞台的部分必须被裁掉,否则会盖住标签栏和底下的输入卡。
    <box flexGrow={1} minHeight={0} position="relative" overflow="hidden">
      {/* 静止期:目标视图就是舞台的普通流式子节点(与改造前的布局逐行一致)。
          两个分支各用一个 <Show> 而不是 Show 的 fallback 属性:fallback 是普通 prop,
          会被**立即**求值 —— 那样即使正在滑动,非目标视图也已经建出来了。Show 的 children
          是惰性 getter,只在条件成立时才建。 */}
      <Show when={outgoing() === undefined}>{node(props.view)}</Show>
      <Show when={outgoing()}>
        {(from) => (
          <>
            {/* 旧视图在上层:它正在离开,压在新视图之上更接近「旧页盖着新页滑走」的观感。 */}
            <box position="absolute" top={0} left={offsets().outgoing} width="100%" height="100%" overflow="hidden">
              {node(from())}
            </box>
            <box position="absolute" top={0} left={offsets().incoming} width="100%" height="100%" overflow="hidden">
              {node(props.view)}
            </box>
          </>
        )}
      </Show>
    </box>
  )
}
