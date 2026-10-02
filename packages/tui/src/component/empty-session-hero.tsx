import { For, Show } from "solid-js"
import { useCommandShortcut } from "../keymap"
import { tint, useTheme } from "../context/theme"
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
export function EmptySessionHero(props: { paddingTop?: number }) {
  const { theme } = useTheme()
  const helpShortcut = useCommandShortcut("help.show")

  return (
    <box alignItems="center" width="100%" paddingTop={props.paddingTop ?? 3} flexShrink={0}>
      {/* 不传 enterDelay:hero 是静态内容,不随消息流一张张长出来,阶梯入场在这里没有对象可跟。
          宽度 "auto":原型的 `.hero` 是 `align-self: center`,宽度由内容决定(见 NeonCard 的 width)。 */}
      <NeonCard width="auto">
        <box alignItems="center">
          <Logo />
          <box height={1} flexShrink={0} />
          <HeroHints />
          <box height={1} flexShrink={0} />
          <AgentShowcase />
          <box height={1} flexShrink={0} />
          <Show when={helpShortcut()}>
            <text fg={theme.textMuted} wrapMode="none">
              按 <span style={{ fg: theme.text }}>{helpShortcut()}</span> 显示键盘快捷键
            </text>
          </Show>
        </box>
      </NeonCard>
    </box>
  )
}
