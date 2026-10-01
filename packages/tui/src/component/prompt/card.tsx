import { createMemo, createSignal, Show, type JSX } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useKV } from "../../context/kv"
import { useTheme } from "../../context/theme"
import { useCommandShortcut } from "../../keymap"
import { semanticStops } from "../../ui/neon"
import { Locale } from "../../util/locale"
import "../../ui/card"

// 输入区霓虹输入卡的壳。与 routes/session 的 AssistantCard 同一条规矩:
// 这里只依赖 useTheme() 与 useKV(),不碰 session/local context,测试能直接挂载真壳量几何 ——
// 手抄一份 neonbox 到测试里的话,改这里的 padding 不会让任何测试变红。
// padding 四边各 1 格:NeonBox 的边框画在最外行/列上,内容从第 1 行/列开始,
// 所以内容压不到边框字符,卡内可用宽度 = 卡宽 − 2。
// 注意 padding=1 的那一格**就是**边框所在的那一格(上下同理)—— 卡片上下没有额外留白,
// 与助手气泡卡(AssistantCard)一致。想加留白要把 padding 提到 2,别只改一半。
// animated 只在聚焦时开:聚焦流动与扫光是「正在输入」的信号,失焦就该安静下来。
export function PromptCard(props: { focused: boolean; children: JSX.Element }) {
  const { theme } = useTheme()
  const kv = useKV()
  return (
    <neonbox
      gradientStops={semanticStops(theme, "input")}
      animated={props.focused}
      animationsEnabled={() => kv.get("animations_enabled", true)}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={1}
      paddingRight={1}
      width="100%"
      flexShrink={0}
    >
      {props.children}
    </neonbox>
  )
}

// 模型芯片里模型名的长度上限。
// 推导(全部按 1 列 = 1 个终端格算,CJK 按 2 列):
//   卡内可用宽 = 终端宽 − 卡 padding(1+1)
//   定长开销 = ">" 盒 2 + 行内 gap 1 + 行内 gap 1 + 芯片 padding(1+1) + "◆ " 2
//            + 芯片与按钮的 gap 1 + 按钮 "发送"(2 汉字 = 4 列)+ padding(1+1) = 15
//   剩下给「模型名 + 输入框」;输入框至少留 12 列,所以
//   模型名上限 = 终端宽 − 2 − 15 − 12 = 终端宽 − 29。
// 60 列终端:min(28, 31) = 28 → 输入框还剩 58 − 15 − 28 = 15 列。
// 40 列终端:max(8, 11) = 11 → 输入框剩 38 − 15 − 11 = 12 列(不吃掉 12 的下限)。
const MODEL_CHIP_MARGIN = 29
const MODEL_CHIP_MAX = 28
const MODEL_CHIP_MIN = 8

// 输入行右端:模型芯片 + 发送按钮。
// 点击按钮只是 submit() 的又一个入口 —— 能不能发仍由 submit() 自己判定,
// canSend 只是同一组条件的视觉预告(空输入/disabled/正在建会话/自动补全弹着/没有 agent
// 时不高亮、点了也不发)。
// 按钮底色/hover 照 routes/session/queue-dock 的行内按钮(hover 换 backgroundElement,
// 左右各留 1 格),onMouseUp 里先 stopPropagation —— 不拦住的话点击会冒到输入框上。
export function PromptSend(props: { model: string; canSend: boolean; onSend(): void }) {
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const [hover, setHover] = createSignal(false)
  const model = createMemo(() => {
    const limit = Math.max(MODEL_CHIP_MIN, Math.min(MODEL_CHIP_MAX, dimensions().width - MODEL_CHIP_MARGIN))
    return Locale.oneLine(props.model, limit)
  })
  return (
    <box flexDirection="row" gap={1} alignItems="center" alignSelf="flex-start" flexShrink={0}>
      <Show when={props.model}>
        {/* 芯片可压缩(flexShrink + overflow hidden):窄终端上宁可把模型名裁掉,
            也不能把整行撑到折行 —— 折行会把「发送」甩到下一行,输入框高度失控。
            minWidth=10 保底 10 列,再窄就轮到输入框了。 */}
        <box
          backgroundColor={theme.backgroundPanel}
          paddingLeft={1}
          paddingRight={1}
          flexShrink={1}
          minWidth={10}
          overflow="hidden"
        >
          <text fg={theme.textMuted} wrapMode="none">
            {"◆ "}
            {model()}
          </text>
        </box>
      </Show>
      <box
        onMouseUp={(e) => {
          e.stopPropagation()
          if (!props.canSend) return
          props.onSend()
        }}
        onMouseOver={() => setHover(true)}
        onMouseOut={() => setHover(false)}
        backgroundColor={props.canSend && hover() ? theme.backgroundElement : theme.backgroundPanel}
        paddingLeft={1}
        paddingRight={1}
      >
        <text fg={props.canSend ? theme.text : theme.textMuted}>发送</text>
      </box>
    </box>
  )
}

// 终端窄到放不下完整键位提示组时,整条丢掉「换行」而不是让它被裁成半个词。
// 推导(1 列 = 1 终端格,CJK 按 2 列):提示组的定长部分是
// 「<键> agents」7 + 「<键> commands」9 + 「<键> 换行」5 + 组内两个 gap 4 = 25 列,
// 键名按常见的 tab(3)/ ctrl+p(6)/ shift+return(11) 算 20 列 → 45 列,
// 再加卡片左右 padding 各 1 → 需要 47 列,取整到 48。
// 40~47 列这一档只剩前两条:25 − 5(整条换行) − 2(少一个 gap) = 18 列,
// 加 tab(3) + ctrl+p(6) = 27 列,再加 padding 2 = 29 列 ≤ 40,放得下。
const HINT_ROW_MIN_WIDTH = 48

// 卡内第二行(提示行)。左段是插件槽 + agent/权限/提供商/变体 meta —— 可截断,
// 压不下了先丢 meta;右段是键位提示 —— 不截断,因为它就是这行的可发现性本身。
// 键位一律 useCommandShortcut 现取,禁止硬编码:键位能在配置里改,
// 硬编码的 "tab" / "ctrl+p" 会在用户改键后变成假提示。
export function PromptHints(props: { right?: JSX.Element; meta?: JSX.Element; shell?: boolean }) {
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const agentShortcut = useCommandShortcut("agent.cycle")
  const paletteShortcut = useCommandShortcut("command.palette.show")
  const newlineShortcut = useCommandShortcut("input.newline")
  return (
    <box flexDirection="row" gap={2} alignItems="center" width="100%" flexShrink={0}>
      {/* 插件槽也是可压缩的一段:它有没有内容、宽度多大由第三方决定,
          不钉 flexShrink 的话,一旦被塞进一个宽 chip,提示行会被撑到折行。 */}
      <Show when={props.right}>
        <box flexDirection="row" gap={1} alignItems="center" flexShrink={1} minWidth={0} overflow="hidden">
          {props.right}
        </box>
      </Show>
      {/* minWidth={0} 是关键:不写的话 yoga 用内容的 min-content 当下界,meta 盒根本压不下去,
          里头的 <text> 被挤到 1~2 列就会折成好几行 —— 提示行会长高,把输入区顶变形。 */}
      <box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
        {props.meta}
      </box>
      <box flexDirection="row" gap={2} flexShrink={0}>
        <Show
          when={!props.shell}
          fallback={
            <text fg={theme.text}>
              esc <span style={{ fg: theme.textMuted }}>exit shell mode</span>
            </text>
          }
        >
          <text fg={theme.text}>
            {agentShortcut()} <span style={{ fg: theme.textMuted }}>agents</span>
          </text>
          <text fg={theme.text}>
            {paletteShortcut()} <span style={{ fg: theme.textMuted }}>commands</span>
          </text>
        </Show>
        <Show when={dimensions().width >= HINT_ROW_MIN_WIDTH}>
          <text fg={theme.text}>
            {newlineShortcut()} <span style={{ fg: theme.textMuted }}>换行</span>
          </text>
        </Show>
      </box>
    </box>
  )
}
