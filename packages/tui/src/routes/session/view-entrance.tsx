import { createEffect, createMemo, createSignal, on, onCleanup, type JSX } from "solid-js"
import type { ChatView } from "./chat-view"

/**
 * 聊天视图切换的入场过渡(任务 D4)。
 *
 * **原型实际做的事**(card-design-v7.html:637-639 与 :1206-1210),别把它当成侧滑换页:
 * ```css
 * .chat-view.show { display: flex; animation: viewIn .45s var(--ease) both; }
 * @keyframes viewIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
 * ```
 * ```js
 * off.classList.remove("show"); on.classList.remove("show"); void on.offsetWidth; on.classList.add("show");
 * ```
 * 三件事:① **旧视图当场消失** —— 没有退场动画,更没有横向滑动;② 只有**进场的那一个**视图
 * 在动;③ 动的是 opacity 0→1 加 12px 的上移(`--ease` 即图例里说的 expo-out)。
 *
 * 终端里的对应与已知的近似:
 *   · translateY 12px → **整行位移**。单元格没法做亚像素,12px 按常见终端单元格约 4px 高折成
 *     3 行(`ENTRANCE_ROWS`)。代价是位移被量化成 3 档,所以帧数取行数的两倍
 *     (`ENTRANCE_FRAMES = 6`):每行停 2 帧,看起来仍是匀速而不是三级跳。
 *   · opacity 0→1 → **opentui 的真 opacity**:Renderable 的 `opacity < 1` 会给整棵子树压一层
 *     alpha,渲染器在写进终端之前先把颜色混到背后(实测 opacity=0.4 时 #ffffff 的正文被采成
 *     #666666)。所以正文、底色、滚动条都是真淡入,不是近似。
 *     唯一不参与的是 **NeonBox 自绘的描边** —— 它走 `buffer.setCell`,那条路径不吃 opacity 栈
 *     (见 ui/card.ts 里 `getCurrentOpacity()` 那一段:那一档是这里补上的)。
 *   · 时长 0.45s → 300ms(6 帧 × 50ms)。终端每一帧都要重排整屏字符,而且位移只有 3 行,
 *     再长只是让用户在等;300ms 已经跨过「看得出在动」的全部信息。
 *
 * 「旧视图当场消失」这个原型行为同时简化了两处:TUI 不需要让两个视图同帧共存(所以没有
 * 双视图抢占消息区高度的问题),翻页命令按当前视图挑滚动容器就够(见 routes/session 的
 * activeScroll)。
 */

/** 位移的总行数,`translateY(12px)` 的终端等价。3 行的来历见上面的换算。 */
export const ENTRANCE_ROWS = 3

/** 入场的总帧数。取行数的两倍 —— 每行停 2 帧,避免 3 帧走 3 行的三级跳。 */
export const ENTRANCE_FRAMES = 6

/** 一帧多少毫秒。6 × 50 = 300ms,取原型的 .45s 的三分之二,理由见上。 */
export const ENTRANCE_FRAME_MS = 50

/** 缓动:ease-out 二次 `1 − (1 − t)²`,对应原型的 `--ease`(起手快、收尾慢)。 */
export function entranceEase(progress: number) {
  const k = Math.min(1, Math.max(0, progress))
  return 1 - (1 - k) * (1 - k)
}

/**
 * 进度 → 位移行数(向下为正)。
 *
 * 向上取整是刻意的:`ceil(rows × (1 − k))` 让每一行都恰好停满两帧
 * (6 帧走 3 行 = 3,3,2,2,1,1,0)。用四舍五入会变成 3,3,2,2,1,0 —— 最后一帧直接落到 0,
 * 收尾比起步快,看着像被「拽」回去的。
 */
export function entranceOffset(progress: number, rows = ENTRANCE_ROWS) {
  return Math.max(0, Math.ceil(rows * (1 - Math.min(1, Math.max(0, progress)))))
}

/** 进度 → 不透明度。与位移同一个缓动,两者始终同步(原型里 opacity 与 transform 同一条曲线)。 */
export function entranceOpacity(progress: number) {
  return entranceEase(progress)
}

/**
 * 视图舞台:把「进场的那一个视图」包起来,在它**挂载/换视图**的那一拍重播一次入场。
 *
 * 三层盒子,各司其职:
 *   · 外层 = 布局盒。`flexGrow={1} minHeight={0}` 撑满消息区,`overflow="hidden"` 是**裁剪口**:
 *     位移期间内容会探出舞台上下沿,必须在这里裁掉,否则会盖住底栏与输入卡。
 *     它的尺寸只由父列盒的 flexGrow 决定,与里面的位移无关 —— 所以动画期间消息区高度不跳。
 *   · 内层 = 位移/透明度盒。`position="relative"` + `top` 让视图**整体下移若干行再回到 0**
 *     (Yoga 的相对定位在布局之后偏移,不影响任何兄弟的高度),`opacity` 压整棵子树。
 *
 * 旧视图不共存:换视图时 `props.view` 一变,调用方的两个 `<Show>` 当场把旧视图销毁、把新视图
 * 建出来(原型的 `off.remove('show')` + `on.add('show')`),所以这一层只需要「新视图从 0 播到终态」。
 *
 * 注入口(`animate` / `frameMs` / `rows`):测试不能从 KV 那一侧拨 animations_enabled ——
 * KVProvider 写的是**共享**的 state/kv.json(test/component/prompt-card.test.tsx:319 记着这件事),
 * 而「关动画 ⇒ 直接终态」恰恰是最该被测试的那条分支。
 */
export function ViewEntrance(props: {
  /** 当前视图。它一变就重播一次入场 —— 这是原型 switchView 的触发点。 */
  view: ChatView
  /** 是否播入场。省略 = 播。这是**终态乘子**:false 时直接是终态,不留残影(ui/card 的同一约定)。 */
  animate?: boolean
  /** 一帧多少毫秒,测试里调小。省略 = ENTRANCE_FRAME_MS。 */
  frameMs?: number
  /** 位移总行数,测试里调小。省略 = ENTRANCE_ROWS。 */
  rows?: number
  /** 进场视图。传 JSX(惰性 getter),组件不在这一层决定渲染哪个视图 —— 那是调用方的两个 Show。 */
  children: JSX.Element
}) {
  const animate = () => props.animate ?? true
  const frameMs = () => props.frameMs ?? ENTRANCE_FRAME_MS
  // 相位从满帧起步 = **一挂载就是终态**:首次挂载不播(会话刚打开时消息流不该抖一下),
  // 只有换视图那一下才从头播。
  const [frame, setFrame] = createSignal(ENTRANCE_FRAMES)
  const settled = createMemo(() => frame() >= ENTRANCE_FRAMES)

  createEffect(
    on(
      () => props.view,
      (_next, previous) => {
        // on() 在**首次执行**时也会调 fn(previous 是 undefined),那一次是「挂载」而不是「换视图」。
        // 挂载不播:会话页这一层会跟着标签切换反复重挂(开会话文件再切回来),
        // 挂一次播一次就是每次切标签都闪一下。原型首屏那次 viewIn 对应的是「打开会话」,
        // 而那时消息流本身正在走 C0 的阶梯入场,不再叠一层整屏淡入。
        if (previous === undefined) return
        // 关掉动画 = 直接切换(见 ui/card 与 neon-rail 的同一个约定:该 flag 是终态乘子)。
        if (!animate()) return
        setFrame(0)
      },
    ),
  )

  // 相位表:只在入场期间存在,推满即停。与 NeonBox 的相位表 / NeonRail 的流动同一个取向 ——
  // 画完即静止,空闲零开销。快速连切视图时这一段会被重跑(上一次的 onCleanup 先清表)。
  createEffect(() => {
    if (settled()) return
    const timer = setInterval(() => {
      setFrame((value) => Math.min(ENTRANCE_FRAMES, value + 1))
    }, frameMs())
    onCleanup(() => clearInterval(timer))
  })

  const progress = createMemo(() => (settled() ? 1 : frame() / ENTRANCE_FRAMES))
  return (
    <box flexGrow={1} minHeight={0} position="relative" overflow="hidden">
      <box
        position="relative"
        top={entranceOffset(progress(), props.rows ?? ENTRANCE_ROWS)}
        opacity={entranceOpacity(progress())}
        flexGrow={1}
        minHeight={0}
      >
        {props.children}
      </box>
    </box>
  )
}
