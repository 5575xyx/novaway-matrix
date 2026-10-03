import { createMemo, For, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { Pill, pillColumns } from "../../component/pill"
import { NeonCard } from "../../component/neon-card"
import { Locale } from "../../util/locale"
import { semanticStops } from "../../ui/neon"
import "../../ui/card"

/**
 * 提示卡(原型 card-design-v7.html:906-912 的 `.card.tip`):琥珀霓虹描边 + 「● 提示」+
 * 正文 + 可选的「升级 / 稍后」两颗小按钮。
 *
 * 与 SidebarCard / PromptCard / NeonCard 同一条规矩:**只依赖 useTheme()**,所以测试能直接
 * 挂载它量真实几何。它也不碰 plugin runtime —— 提示的挑选、快捷键取值、动作派发都在
 * tips-view / tips.tsx 那一层,这里只负责「把一条提示画成一张卡」。理由与 A1 AssistantCard /
 * A3 SidebarCard 的 seam 一致:插件组件挂在真keymap context 下才能跑,那层留给集成测试。
 *
 * 三件事分工:
 *   - `tipPlainText` 去标记 → 提示的身份(「稍后」按它记住已 dismiss 的那一条)。
 *   - `fitTipActions` / `tipCardLayout` → 宽度账。渲染层和宽度账分开写的话,少算一列就会
 *     让按钮被渲染器裁掉,而那种截断在字符帧里看起来仍然「有内容」。
 *   - `truncateParts` → 正文按列截断(高亮分段不能按码元数砍,一条中文提示按字符数砍会顶到边框)。
 */

/** 一段提示正文里的一段:要么普通色,要么强调色(原型 `<code>` 那部分)。 */
export type TipPart = { text: string; highlight: boolean }

/** 一颗动作按钮:文案 + 要派发的命令名。派发通道由调用方给(见 tips-view 的 dispatch)。 */
export type TipAction = { label: string; command: string }

/** fitTipActions 只按文案算账,所以它对具体形状无感 —— 「稍后」那颗没有 command 也照样能过。 */
type Labelled = { label: string }

export const TIP_LABEL = "● 提示"
export const TIP_LABEL_COLUMNS = Locale.displayWidth(TIP_LABEL)
export const TIP_DISMISS_LABEL = "稍后"

/**
 * NeonCard 的固定内边距:开 inset 那一档是左 2 + 右 2(见 component/neon-card 的 inset)。
 * 与 sidebar-metrics 里的 SIDEBAR_CARD_BORDER 同源 —— **padding 列就是边框列**,所以边框
 * 不额外扣。四列是卡壳吃掉的内边距,不是卡内容宽度。
 *
 * 数字跟着 NeonCard 的 inset 一起改:那一档之前是左 2 + 右 1 = 3 列。改的时候两处必须同时改,
 * 否则这里会按旧的扣减量算预算,正文与按钮组一起右移一列顶到右边框上 ——
 * 而那在字符帧里仍然「看起来有内容」,只有宽度账的断言会红。
 */
export const TIP_CARD_CHROME = 4

/**
 * 正文同行时至少留这么多列。低于它「● 提示」后面就只剩半句话了,读起来比换行更费解。
 * 16 是「运行 xxx 更新到最新版本」这类短提示刚好放得下的量级。
 */
export const TIP_TEXT_MIN = 16

/**
 * 提示卡的描边叠色档。导出给测试直接引用,免得测试里再抄一个 0.75。
 *
 * 照抄原型 `.tip` 的那一档(card-design-v7.html:369-371):
 * `linear-gradient(135deg, rgba(245,184,61,.85), rgba(245,140,61,.65))` —— 两端均值
 * (.85 + .65) / 2 = 0.75,见 ui/neon 的 BORDER_ALPHA_DEFAULT 注释表。
 *
 * 为什么不给气泡卡那 0.62:这张卡是 `.card.tip`(HTML :906),原型给它的描边本来就比
 * `.bubble` 一族**更实**(.75 vs .675/.80),而它自己又是 `.card` 那一族里唯一带
 * 常驻 `flow` 的小卡 —— 用户盯着提示条读提示时,那一圈琥珀边正一格一格地走,
 * 「描边在动」这件事会被读成「这一圈的色偏得更重了」。折算成实色之后,0.62 叠在
 * novaway 深色的面板底(#0a0e14)上是 #a27708,与面板底的对比度 4.8:1;0.75 是 #c28d05,
 * 6.5:1 —— 抬到后者的那一档才配得上「一直在动的边」。
 */
export const TIP_CARD_ALPHA = 0.75

/** 相邻两颗按钮之间的空隙(原型 .tip-act 的 gap:6px)。 */
const TIP_ACTION_GAP = 1
/** 正文与按钮组之间的空隙。 */
const TIP_TEXT_GAP = 1
/**
 * 按钮文案的列下限:再压就不是词了。truncateToWidth 的省略号本身占 1 列,所以「升…」(3 列)
 * 再砍一次会变成「…」(1 列)—— 那已经跨过下限,这时不再砍,改为整颗丢掉。
 */
export const TIP_ACTION_MIN_LABEL = 2

/** 卡内可用列 = 外层容器宽 − 卡壳内边距。容器比内边距还窄时夹到 0,不出现负数预算。 */
export function tipCardContentWidth(containerWidth: number) {
  return Math.max(0, containerWidth - TIP_CARD_CHROME)
}

/** 去掉 {highlight} 标记,得到提示的纯文本 —— 它的身份标识(dismiss 按它记)。 */
export function tipPlainText(tip: string) {
  return tip.replace(/\{\/?highlight\}/g, "")
}

/**
 * 一颗按钮占多少显示列。口径与 Pill 的 pillColumns 完全一致(左右内边距各 1 列 + 文案):
 * 复用 Pill 就要用它的账,否则渲染宽度和预算会差一列,窄终端下按钮被裁掉而看不出来。
 */
export function tipActionColumns(label: string) {
  return pillColumns({ label })
}

function actionCost(actions: readonly Labelled[]) {
  return (
    actions.reduce((sum, action) => sum + tipActionColumns(action.label), 0) +
    Math.max(0, actions.length - 1) * TIP_ACTION_GAP
  )
}

/**
 * 把一组按钮塞进 budget 列。降级阶梯(固定顺序,不随各颗宽窄变化):
 *
 *   1. 放得下 → 一颗不动。
 *   2. 放不下 → 反复把**最宽的那颗**按列砍(平手按传入顺序先砍靠前的),砍到下限为止。
 *   3. 还放不下 → 从末尾整颗丢。末尾是「稍后」那类「不做也行」的按钮,主动作留到最后。
 *   4. 只剩一颗还放不下 → 连它一起丢,返回空数组。
 *
 * 为什么不是「按宽度贪心塞满」:贪心下窄终端里会为了多塞一颗而把每颗文案都砍成半个词,
 * 而砍成半个词的「升…」比整颗丢掉更难猜。
 *
 * 「砍一列」交给 truncateToWidth(它的预算单位就是列),但**不假设它一定只掉一列**:
 * 省略号本身占 1 列,所以「升…」(3 列)再砍一次会直接变成「…」(1 列),跨过了下限 2。
 * 于是每一轮都验一次「候选仍然 ≥ 下限」,不合法就停 —— 这一步是死循环的保险,不是风格选择。
 */
export function fitTipActions<T extends Labelled>(
  actions: readonly T[],
  budget: number,
): { actions: T[]; columns: number } {
  const limit = Math.max(0, budget)
  let list = actions.map((action) => ({ ...action }))
  for (;;) {
    if (actionCost(list) <= limit || list.length === 0) break
    // 用「谁的列数最多」定位,不用对象身份 —— 每次替换都产出新对象,身份比较会失效。
    let widest = 0
    for (let index = 1; index < list.length; index++) {
      if (tipActionColumns(list[index]!.label) > tipActionColumns(list[widest]!.label)) widest = index
    }
    const target = list[widest]!
    const shrunk = Locale.truncateToWidth(target.label, Locale.displayWidth(target.label) - 1)
    if (Locale.displayWidth(shrunk) < TIP_ACTION_MIN_LABEL) break
    list = list.map((action, index) => (index === widest ? { ...target, label: shrunk } : action))
  }
  while (actionCost(list) > limit && list.length > 1) list = list.slice(0, -1)
  if (actionCost(list) > limit) list = []
  return { actions: list, columns: actionCost(list) }
}

/**
 * 提示卡的宽度账。入参是**卡内**可用列(tipCardContentWidth 的输出)。
 *
 * 阶梯固定为三步,顺序是「先保住按钮」而不是「先保住同行」:
 *   1. 全部按钮与正文同行放得下(正文至少 TIP_TEXT_MIN 列)→ 同行,按钮贴右。
 *   2. 否则按钮组独占第二行(预算 = 整个卡宽)。提示条只有一行高,多一行代价很小,
 *      而为了同行把「稍后」砍成半个词代价更大 —— 所以先换行。
 *   3. 连独占一行都放不下(卡宽不足一颗按钮)→ 按钮区整个消失,回到单行正文。
 *
 * 「一定不超预算」是可证的:交出去的是 textColumns + TIP_LABEL_COLUMNS(+ 同行时的
 * TIP_TEXT_GAP + actionsColumns)≤ width,换行时 actionsColumns 单独 ≤ width。
 */
export function tipCardLayout<T extends Labelled>(input: { width: number; actions: readonly T[] }) {
  const label = TIP_LABEL_COLUMNS
  if (input.actions.length === 0) {
    return { separateRow: false, textColumns: Math.max(0, input.width - label), actionsColumns: 0, actions: [] as T[] }
  }
  const inline = fitTipActions(input.actions, input.width - label - TIP_TEXT_GAP - TIP_TEXT_MIN)
  if (inline.columns > 0 && inline.actions.length === input.actions.length) {
    return {
      separateRow: false,
      textColumns: Math.max(0, input.width - label - TIP_TEXT_GAP - inline.columns),
      actionsColumns: inline.columns,
      actions: inline.actions,
    }
  }
  const own = fitTipActions(input.actions, input.width)
  if (own.actions.length > 0) {
    return {
      separateRow: true,
      textColumns: Math.max(0, input.width - label),
      actionsColumns: own.columns,
      actions: own.actions,
    }
  }
  return { separateRow: false, textColumns: Math.max(0, input.width - label), actionsColumns: 0, actions: [] as T[] }
}

/**
 * 正文按显示列截断。逐段累加,超预算的那一段被 truncateToWidth 砍到还剩的列数(自带「…」),
 * 再往后的整段丢掉 —— 逐段各砍一刀会在一行里出现好几个省略号,读起来像坏掉的字符串。
 * highlight 标记在渲染时才解释,这里砍的是纯文本。
 */
export function truncateParts(parts: readonly TipPart[], columns: number) {
  let left = Math.max(0, columns)
  const out: TipPart[] = []
  for (const part of parts) {
    if (left <= 0) break
    const width = Locale.displayWidth(part.text)
    if (width <= left) {
      out.push(part)
      left -= width
      continue
    }
    out.push({ text: Locale.truncateToWidth(part.text, left), highlight: part.highlight })
    break
  }
  return out
}

/**
 * 提示卡本体。`width` 是**卡内**可用列(tipCardContentWidth 的输出),由调用方算 ——
 * 容器宽度是它自己的布局事实,卡片不该去读终端尺寸。
 *
 * 按钮直接复用 Pill:它已经有「低对比底色 + 悬停抬到 backgroundElement、文字抬到 primary」
 * 那一套(与队列 dock、Tab 栏胶囊同一语言),这里再抄一份只会让两处慢慢分叉。
 * 「稍后」不是动作而是**消解**,所以它由 onDismiss 决定出不出场,不和动作混在同一串里。
 */
// inset:原型 `.card.tip` 走的是 `.card` 那一档 padding(card-design-v7.html:906),不是
// `.prompt` 的 12/16 —— 但终端里 12px 那点纵向差折不满一行,而这张卡只有「标签 + 正文 + 按钮」
// 一到两行内容,上下各空一行既不会挤掉任何一行(宽度账在 TIP_CARD_CHROME 里已经跟着改成 4 列),
// 也让这张常驻流动的小卡不再紧贴描边。
export function TipCard(props: {
  parts: readonly TipPart[]
  actions?: readonly TipAction[]
  width: number
  onAction?: (command: string) => void
  onDismiss?: () => void
}) {
  const { theme } = useTheme()
  // 动作按钮由调用点给,「稍后」这一颗在这里补上 —— 它的语义(消解当前提示)只有卡片知道。
  const buttons = createMemo(() => [
    ...(props.actions ?? []).map((action) => ({ label: action.label, run: () => props.onAction?.(action.command) })),
    ...(props.onDismiss ? [{ label: TIP_DISMISS_LABEL, run: () => props.onDismiss?.() }] : []),
  ])
  // 宽度账一次算完:布局顺带把「最终放得下哪几颗、文案压到多短」交回来,渲染层不再自己 fit 一遍。
  const layout = createMemo(() => tipCardLayout({ width: props.width, actions: buttons() }))
  const body = createMemo(() => truncateParts(props.parts, layout().textColumns))

  const ButtonRow = () => (
    <box flexDirection="row" flexShrink={0}>
      {/* 弹性空隙把按钮组推到卡内右侧(与 SidebarCard 的徽标同一个手法)。 */}
      <box flexGrow={1} />
      <For each={layout().actions}>{(action) => <Pill label={action.label} onClick={() => action.run()} />}</For>
    </box>
  )

  return (
    <NeonCard gradientStops={semanticStops(theme, "tip")} borderAlpha={TIP_CARD_ALPHA} flow inset>
      <box flexDirection="column">
        <box flexDirection="row" flexShrink={0}>
          <text flexShrink={0} fg={theme.warning} wrapMode="none">
            {TIP_LABEL}{" "}
          </text>
          <text flexShrink={1} fg={theme.textMuted} wrapMode="none">
            <For each={body()}>
              {(part) => <span style={{ fg: part.highlight ? theme.text : theme.textMuted }}>{part.text}</span>}
            </For>
          </text>
          <Show when={!layout().separateRow}>
            <ButtonRow />
          </Show>
        </box>
        <Show when={layout().separateRow}>
          <ButtonRow />
        </Show>
      </box>
    </NeonCard>
  )
}
