import { For, Show, createMemo } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useCommandShortcut } from "../keymap"
import { tint, useTheme } from "../context/theme"
import { displayWidth, truncateToWidth } from "../util/locale"
import { Logo } from "./logo"
import { AgentShowcase } from "./agent-showcase"
import { NeonCard } from "./neon-card"
import { Pill } from "./pill"

/**
 * slogan 的分段。原型 card-design-v7.html:897 是
 * `///<span class="sep">·</span>任务拆解<span class="sep">·</span>多体协作<span class="sep">·</span>自动推进<span class="sep">·</span>///`,
 * 也就是「词之间夹一个更暗的 `·`」,首尾两段是 `///`。
 *
 * 原型 `.hero .slogan` 用 pink、`.sep`(`color: #7a3a56`)是更暗的一档。终端里没有 pink 这种
 * 中间色可借,于是正文落到 theme.textMuted,分隔符再朝背景方向压一档(见 SEP_MIX)。
 */
const SLOGAN_WORDS = ["任务拆解", "多体协作", "自动推进"]

/** 分隔符的混合比:比正文更靠近背景色(原型是比 slogan 正文暗一档)。 */
const SEP_MIX = 0.45

// 摊成一段一段的着色片段,而不是靠 JSX 嵌套:`<text>` 的子节点就是着色块,摊平后每一段
// 能各自取色,也不必让 Solid 的 fragment 走进文本渲染器的子节点里。
//
// 分隔符两侧各留 1 列空格:原型是 `.hero .slogan .sep { margin: 0 7px }`,`·` 两侧各有一小段
// 空白;7px 折到终端不足 1 列,取 1 列最贴近原型观感。四段分隔符把三段词与首尾两个 `///` 隔开。
const SLOGAN_SEGMENTS: { text: string; separator: boolean }[] = ["///", ...SLOGAN_WORDS, "///"].flatMap(
  (word, index) => {
    const leading = index > 0 ? [{ text: " · ", separator: true }] : []
    return [...leading, { text: word, separator: false }]
  },
)

/**
 * chips 行(原型 card-design-v7.html:898-902)。
 *
 * **每一条都必须是真在本仓库能敲出来的东西** —— 首屏上写一个按不动的键位,比不写更糟。
 * 这里只放**斜杠命令**、不放键位:斜杠命令由 app.tsx 的命令注册表定义,能逐条核对;
 * 键位则要跟随用户的 tui.json 覆盖,写死一个字面量必然会在某台机器上是错的。
 *   · `/new`    → app.tsx 的 `session.new`(slashName "new",别名 "clear")
 *   · `/models` → app.tsx 的 `model.list`(slashName "models",别名 "mo")
 *
 * 原型还有第三颗 `ctrl+alt+k 快捷键`,**这里刻意不做**:那对键属于 which-key 插件
 * (config/keybind.ts 的 which_key_toggle = "ctrl+alt+k"),而
 * feature-plugins/system/which-key.tsx 的插件声明是 `enabled: false` ——
 * 那颗键在当前构建里按下去没有任何反应。「查看键盘快捷键」在本仓库的真入口是
 * EmptySessionHero 底部那行 help.show 提示(键位由 useCommandShortcut 取,配成 none 时
 * 整行自动消失),它已经覆盖了原型第三颗 chip 的意图。
 */
const CHIPS = [
  { key: "/new", label: "新建会话" },
  { key: "/models", label: "切换模型" },
]

/** 相邻两颗 chip 之间的空隙(原型 `.chips { gap: 9px }`)。 */
const CHIP_GAP = 1

/**
 * hero 卡里那两行「静态提示」:slogan + chips。
 *
 * **只依赖 useTheme()** —— Logo 与 AgentShowcase 之外的部分都不碰 local/session context,
 * 所以测试能直接挂载它量真实几何(与导出的 NeonCard / BlockTool 同理)。不这么切的话,
 * hero 的测试就得把 LocalProvider 那一整串(SDK/Sync/Event/Route/Toast)拖进来,而那一串
 * 与这两行的正确性毫无关系。
 */
export function HeroHints() {
  const { theme } = useTheme()
  return (
    <box alignItems="center" flexShrink={0}>
      <text fg={theme.textMuted} wrapMode="none">
        <For each={SLOGAN_SEGMENTS}>
          {(segment) => (
            <span
              style={{ fg: segment.separator ? tint(theme.background, theme.textMuted, SEP_MIX) : theme.textMuted }}
            >
              {segment.text}
            </span>
          )}
        </For>
      </text>
      <box height={1} flexShrink={0} />
      {/* chip 直接复用 Pill:低对比底色 + textMuted 文字 —— 原型 `.chip` 就是
          `background: var(--element)` + `color: var(--muted)` + 圆角。终端画不出圆角,
          于是和 Pill 一样退化成「左右内边距撑出的药丸」(见 pill.tsx 的 PAD)。
          不给 onClick:原型 `.chip` 是 <span> 而非 <button>,而「点一下 chip 该干什么」
          本来就没有定义(填 `/new` 再提交?把焦点挪到输入框?),猜一个动作不如只当提示。 */}
      <box flexDirection="row" gap={CHIP_GAP} flexShrink={0}>
        <For each={CHIPS}>{(chip) => <Pill label={`${chip.key} ${chip.label}`} />}</For>
      </box>
    </box>
  )
}

// 空会话首屏:一张抱内容的霓虹卡 —— 大 Logo + slogan + 当前智能体的特征行 + chips + 快捷键提示。
// 原型是 `.card.hero`(card-design-v7.html:895-903);此前本组件只有 Logo 与一条提示,
// 裸在消息区里,与原型差的就是这张壳和 slogan / chips 这两行。
// 首页(尚无会话)与会话页(会话里还没有消息)共用同一块,保证两边布局一致不跳变;
// 发出第一条消息后随消息流自然上移消失。

/**
 * hero 卡里那行快捷键提示(原型 card-design-v7.html:913 的 `.hint-line`):
 * `⌨<kbd>ctrl</kbd>+<kbd>alt</kbd>+<kbd>k</kbd> 查看键盘快捷键`。
 *
 * **原型那个 <kbd> 是带边框的,而终端里带边框的盒子画不出单行**:`border` 是渲染物自己的属性,
 * 一个 1 行高的盒子加了 border 就变成 3 行(上边框 / 内容 / 下边框),而这一行是卡内最后一行,
 * 让它长高会把整张 hero 卡顶高一格。所以描边那一半(1px 实线 + 圆角)在单行里没有对应物,
 * 能落地的只有它的另一半 —— 一枚**被点亮的面**(`background: var(--element)`)配比正文亮一档的字
 * (`color: var(--text)`,而句子本身是 `--muted`)。这正是本仓库已经给「键」的那一套:
 * component/prompt/card 的 PromptSend 发送按钮(`backgroundPanel` 底 + `theme.text` 字 +
 * 左右各 1 列内边距),queue-dock 的「发送 / 删除 / 清空全部」行内按钮同款。
 * **不另造第三种键帽样式** —— 首屏上多一种键的画法,只会让人分不清哪一颗能按。
 *
 * 键位**不写死**:走 `useCommandShortcut("help.show")` 现取,与输入卡发送按钮上那个键名
 * (`PromptSend`)、排队 dock 的「· <键>追加」是同一套取法。用户改键之后这一行跟着变;
 * 写死 `ctrl+alt+k` 会在改键后变成一句按不动的假提示(而 help.show 的默认值恰恰是 "none",
 * 见 config/keybind.ts 的 help_show —— 默认构建里这一行整行不画)。
 */

/** 原型那句的前半:`按 `。`按` 一个全角字 2 列 + 1 列空格。 */
const HINT_LEAD = "按 "

/** 原型那句的后半,一字不改(原 :913 的「查看键盘快捷键」)。 */
const HINT_TAIL = "查看键盘快捷键"

/** 键帽左右各 1 列内边距(与 PromptSend 的按钮、Pill 的 PAD 同一档)。 */
const KEYCAP_PAD = 1

/** 键帽在 `budget` 列里占多少显示列:键名 + 左右内边距。 */
export function keycapColumns(key: string) {
  return KEYCAP_PAD * 2 + displayWidth(key)
}

/**
 * hero 卡内左右 padding 合计的列数(inset 档:paddingLeft 2 + paddingRight 2,见 component/neon-card)。
 * 提示行的预算就是「终端宽 − 这一笔」—— 与 MODEL_CHIP_MARGIN / usageRowColumns 同一套算法
 * (都用 useTerminalDimensions 的终端宽减去卡自己的固定开销)。
 */
export const HERO_HINT_CHROME = 4

/**
 * 提示行在 `budget` 列里怎么摆。返回 `{ tail }` = 这一行要画(`tail` 是键帽右边那句话,
 * 可能带省略号、也可能空串);返回 undefined = **整行不画**。
 *
 * **`undefined` 与 `tail: ""` 是两件事,不能合并**:预算刚好够 `按 <键帽>` 而一列都不剩给
 * 句子时,画出来的是「按 [键帽]」——键帽那一枚仍然完整、仍然看得见。所以返回值是一个对象,
 * 外层的 `<Show>` 判的是这个对象而不是那句尾巴(空串是 falsy,直接拿来判会让整行消失,
 * 那一档就是这么丢过一次)。
 *
 * 三档阶梯,牺牲的顺序是「句子 → 整行」,键帽一个字符都不动:
 *   1. 预算够(≥30 列)→ 整句。`按 ` 3 + 键帽 12 + 分隔 1 + `查看键盘快捷键` 14。
 *   2. 只够键帽与 `按 `(≥15 列)→ 句子按显示列截尾,留一个 `…`;`查看键盘快捷键` 14 列里
 *      只放得下 4 列时就是 `查…`。**截的是句子而不是键名**:键名被截一半的话,那一行就成了
 *      「按 ctrl+alt… 看」—— 一个按不动的提示,比没有提示更糟(本组件对 chips 也是这个判断,
 *      见上面 CHIPS 的注释)。
 *   3. 连 `按 <键帽>` 都放不下 → 整行不画。半枚键帽(底色被右边框切掉一截)比没有键帽更糟。
 *
 * 空键位(help.show 配成 none,`formatKeySequence` 给的就是空串)直接落到第 3 档 ——
 * 否则会画出一枚**空键帽**:两格底色夹着一个什么都没有,读起来像一个出错的控件。
 */
export function heroHintLayout(key: string, budget: number) {
  if (!key) return undefined
  const lead = displayWidth(HINT_LEAD) + keycapColumns(key)
  if (budget < lead) return undefined
  // 键帽右边那一列分隔空格也要占预算;剩不到 1 列时它与句子一起让光,不留行尾空格。
  const room = budget - lead - 1
  if (room >= displayWidth(HINT_TAIL)) return { tail: HINT_TAIL }
  if (room <= 0) return { tail: "" }
  return { tail: truncateToWidth(HINT_TAIL, room) }
}

/**
 * 快捷键提示行。与 HeroHints 一样单独导出:它只依赖 useTheme() / useCommandShortcut /
 * useTerminalDimensions,不碰 LocalProvider 那一串,所以测试能直接挂载它量真实几何与真实配色。
 */
export function HeroShortcutHint() {
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const helpShortcut = useCommandShortcut("help.show")
  const layout = createMemo(() => heroHintLayout(helpShortcut(), dimensions().width - HERO_HINT_CHROME))
  return (
    // 三个盒子排在同一行,各自 flexShrink={0}:键帽是**一枚底色盒子**,折行会把它劈成两半,
    // 而这一行是卡内最后一行,长高就把整张卡顶高一格(与 PromptHints 的 wrapMode="none" 同理)。
    // 外层 Show 判的是 layout 这个对象(见 heroHintLayout 的注释):判那句尾巴的话,
    // 「只够键帽」那一档会因为空串是 falsy 而把整行吃掉。
    <Show when={layout()}>
      {(row) => (
        <box flexDirection="row" alignItems="center" flexShrink={0}>
          <text fg={theme.textMuted} wrapMode="none">
            {HINT_LEAD}
          </text>
          {/* 键帽 = 发送按钮那一档:backgroundPanel 底(原型的 --element)+ theme.text 字
              (原型的 --text)+ 左右各 1 列内边距。不给 onClick:原型那个 <kbd> 是 <kbd> 而非
              <button>,而且 help.show 的真实入口是 app.tsx 注册的那条命令,不是首屏这一枚。 */}
          <box flexShrink={0} backgroundColor={theme.backgroundPanel} paddingLeft={1} paddingRight={1}>
            <text fg={theme.text} wrapMode="none">
              {helpShortcut()}
            </text>
          </box>
          <Show when={row().tail}>
            {(tail) => (
              <text fg={theme.textMuted} wrapMode="none">
                {" "}
                {tail()}
              </text>
            )}
          </Show>
        </box>
      )}
    </Show>
  )
}

export function EmptySessionHero(props: { paddingTop?: number }) {
  return (
    <box alignItems="center" width="100%" paddingTop={props.paddingTop ?? 3} flexShrink={0}>
      {/* 不传 enterDelay:hero 是静态内容,不随消息流一张张长出来,阶梯入场在这里没有对象可跟。
          宽度 "auto":原型的 `.hero` 是 `align-self: center`,宽度由内容决定(见 NeonCard 的 width)。
          inset:整屏首屏上唯一一张「只有内容、没有第二行」的大卡,原型给的是
          `padding: 36px 56px`(card-design-v7.html:895-903)—— 折到终端正是上下各留一行。
          而这张卡开 inset **在布局上一定安全**:宽度是 hug-content,多出来的那一行/一列
          只会把卡撑大,里面每一行的宽度账一行都没变(slogan 42 列、chips 各自自然宽)。 */}
      <NeonCard width="auto" inset>
        <box alignItems="center">
          <Logo />
          <box height={1} flexShrink={0} />
          <HeroHints />
          <box height={1} flexShrink={0} />
          <AgentShowcase />
          <box height={1} flexShrink={0} />
          <HeroShortcutHint />
        </box>
      </NeonCard>
    </box>
  )
}
