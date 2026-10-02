import { createMemo, createSignal, For } from "solid-js"
import { useTheme } from "../context/theme"
import { Locale } from "../util/locale"

/**
 * 状态胶囊(原型 card-design-v7.html:883-888 的 `.tb-right` 里的四颗):标签行右端那一排
 * 「◱ 视图·气泡 / / 命令 / session #12 / 8.2k ctx」。
 *
 * 三个尺寸常量都是「列」而不是像素,理由与 SidebarCard / SessionFooterBar 一样:终端里唯一
 * 能算的量就是显示列(Locale.displayWidth)。
 *
 *   PAD   1  胶囊左右各 1 列内边距。原型是 `padding: 2px 10px` + `border-radius: 99px`,
 *              终端画不出圆角,也画不出「只占一行的 1px 边框」—— 上下加边框会占掉标签行本
 *              来就有的 1 行(整条标签栏高度是钉死的),所以圆角退化成「左右内边距撑出的药丸」。
 *   GAP   1  相邻两颗之间的空隙(原型 gap:8px)。
 *   SPACER 1 弹性空隙与标签之间的**最小**距离。挤到 0 列胶囊就贴到最后一个标签上,看起来
 *              像那个标签的后缀而不是一个独立控件,所以宽度预算里先扣掉这一列。
 */
const PAD = 1
const GAP = 1
const SPACER = 1

export type PillTone = "default" | "accent"

export interface PillProps {
  label: string
  /** 图标字形,由调用方给(panel-icons 的 icon(...) 之类),这里不猜风格。label 为空串时只渲染图标。 */
  icon?: string
  /** 给了才是可点的;不给就是纯状态展示,不挂任何鼠标事件。 */
  onClick?: () => void
  /** accent = 「这一项现在是激活状态」(当前视图那种):文字直接用 primary。 */
  tone?: PillTone
}

/**
 * 一颗胶囊占多少**显示列**。Pill 与 PillRow 共用这一个口径 —— 渲染层和宽度账分开写的话,
 * 少算一列就会让右端被渲染器裁掉,而那种截断在字符帧里看起来仍然「有内容」。
 *
 * 图标与文案之间那 1 列空格在 label 为空(降级成纯图标)时不渲染,否则会留一个悬空的空格。
 */
export function pillColumns(input: { label: string; icon?: string }) {
  const glyph = input.icon ? Locale.displayWidth(input.icon) + (input.label ? 1 : 0) : 0
  return PAD * 2 + glyph + Locale.displayWidth(input.label)
}

/**
 * 单颗胶囊:低对比底色 + textMuted 文字,可点的悬停时底色抬到 backgroundElement、文字抬到
 * primary(与队列 dock 的「悬停即提亮」同一套)。accent 档只是把静止态的文字换成 primary,
 * 底色不变 —— 于是「悬停一定换底色」对两档都成立,降级逻辑不必分辨 tone。
 *
 * 只依赖 useTheme():标签栏在会话页与首页都用它,而这两处的胶囊数据完全不同,所以胶囊本身
 * 不该知道 session、用量这些东西(那属于调用方)。
 */
export function Pill(props: PillProps) {
  const { theme } = useTheme()
  const [hover, setHover] = createSignal(false)
  const clickable = () => typeof props.onClick === "function"
  const hovered = () => hover() && clickable()
  const foreground = createMemo(() => {
    if (hovered() || props.tone === "accent") return theme.primary
    return theme.textMuted
  })
  const content = createMemo(() => {
    if (!props.icon) return props.label
    return props.label ? `${props.icon} ${props.label}` : props.icon
  })
  return (
    <box
      flexDirection="row"
      flexShrink={0}
      paddingLeft={PAD}
      paddingRight={PAD}
      backgroundColor={hovered() ? theme.backgroundElement : theme.backgroundPanel}
      // 事件只给可点的胶囊:只读状态胶囊悬停变色会让人以为它能点。
      onMouseUp={clickable() ? () => props.onClick?.() : undefined}
      onMouseOver={clickable() ? () => setHover(true) : undefined}
      onMouseOut={clickable() ? () => setHover(false) : undefined}
    >
      {/* wrapMode="none":标签行高度钉死,任何折行都会顶掉下面的会话区(见 tab-bar.tsx)。 */}
      <text fg={foreground()} wrapMode="none">
        {content()}
      </text>
    </box>
  )
}

export interface PillSpec {
  label: string
  icon?: string
  tone?: PillTone
  onClick?: () => void
  /**
   * 保留优先级,数值大的先留下;相同优先级按传入顺序。
   * 优先级就是「丢了之后用户还能不能自己查到」:当前视图只有这一个入口,排最前;ctx 用量在
   * 输入卡的状态行里还有一份完整写法,排最后。
   */
  priority: number
  /**
   * 极窄时允许退化成「只剩图标」。只对「图标本身已经表意」的那颗有意义(视图胶囊),
   * 其余胶囊退化掉文字就只剩一个看不懂的符号,不如整颗丢掉。
   *
   * 一排里最多有一颗带它:PillRow 把「带 iconOnly 的、优先级最高的那颗」当作留底,其余全排在
   * 它之前被整颗丢掉。
   */
  iconOnly?: boolean
}

/**
 * 一排胶囊 + 它们的宽度降级。**宽度预算是这里唯一的职责**,TabBar 只负责把它摆到标签行右端。
 *
 * 降级阶梯(固定顺序,不随各颗胶囊的宽窄变化):
 *
 *   1. 宽度够 → 全在。
 *   2. 不够 → 按 priority **从低到高整颗丢**:ctx → session # → / 命令。丢到「留底的那颗」为止。
 *   3. 还不够 → 留底的那颗(唯一带 iconOnly 的那颗)退化成只剩图标。
 *   4. 还不够 → 连它也丢掉,整排为空。
 *
 * 为什么是「固定阶梯」而不是「按优先级贪心塞满」:贪心会让**便宜的低优先级项反超**贵的高优先级项
 * —— `8.2K ctx` 只要 10 列,`/ 命令 ctrl+p` 要 16 列,贪心下窄终端里 `/ 命令` 会被丢掉而 ctx 留着,
 * 而后者在输入卡的状态行里本来就有一份完整写法。阶梯把「先丢什么」钉死成与宽度无关的一条规则。
 *
 * 每一步的取舍理由:越靠后丢的越「别处也有」(用量在输入卡状态行里有一份完整写法;session 短 id 在
 * /status 对话框里查得到),越靠前留的越「只有这一处」(当前视图、命令面板入口都只挂在标签行上)。
 *
 * 渲染顺序还原成传入顺序(视图在最左),而不是优先级顺序 —— 否则窄终端下四颗胶囊会重排位置,
 * 和宽屏对不上,看着像另一套 UI。
 *
 * 「放不下就丢」而不是「截断」是对的:这些文案都是本仓库自己的固定串(视图·气泡 / session #xxx),
 * 截断出来的「视图·气…」和「session #a1…」比整颗丢掉更费解。
 *
 * 「一定不超预算」是可证的:最后交出去的那一列是 cost(kept) ≤ budget = width − SPACER,而渲染宽度
 * = Σ 各颗列数 + 相邻间隙之和 = cost(kept)。没有任何一颗 iconOnly 时阶梯退化成「按优先级从低到高
 * 丢到放得下为止」,结论同样是 ≤ 预算;预算被 clamp 到 0 时整排为空。
 */
export function PillRow(props: { width: number; pills: PillSpec[] }) {
  const kept = createMemo(() => {
    const budget = Math.max(0, props.width - SPACER)
    const present = props.pills
      .map((spec, index) => ({ spec, index, label: spec.label }))
      // label 与 icon 都为空的胶囊(例如还没有用量时的 ctx)本来就不该画,不占阶梯的一格。
      .filter((item) => item.spec.label || item.spec.icon)
    const cost = (list: { spec: PillSpec; label: string }[]) =>
      list.reduce((sum, item) => sum + pillColumns({ label: item.label, icon: item.spec.icon }), 0) +
      Math.max(0, list.length - 1) * GAP
    // 「留底」的那颗:带 iconOnly 的、按优先级最高的那一颗。它排在阶梯的最后一步(退化成纯图标),
    // 其余胶囊都在它之前被整颗丢掉。
    const keeper = present.filter((item) => item.spec.iconOnly).toSorted((a, b) => b.spec.priority - a.spec.priority)[0]
    const droppable = present.filter((item) => item !== keeper).toSorted((a, b) => a.spec.priority - b.spec.priority)
    let list = present
    for (const victim of droppable) {
      if (cost(list) <= budget) break
      list = list.filter((item) => item !== victim)
    }
    const slim =
      keeper && cost(list) > budget ? list.map((item) => (item === keeper ? { ...item, label: "" } : item)) : list
    const final = cost(slim) <= budget ? slim : list.filter((item) => item !== keeper)
    return final.toSorted((a, b) => a.index - b.index).map((item) => ({ spec: item.spec, label: item.label }))
  })

  return (
    <box flexDirection="row" gap={GAP} flexShrink={0}>
      <For each={kept()}>
        {(item) => <Pill label={item.label} icon={item.spec.icon} tone={item.spec.tone} onClick={item.spec.onClick} />}
      </For>
    </box>
  )
}
