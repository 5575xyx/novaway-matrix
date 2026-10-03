import { createMemo, createSignal, Show, type JSX } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import type { RGBA } from "@opentui/core"
import { useKV } from "../../context/kv"
import { useTheme } from "../../context/theme"
import { useCommandShortcut } from "../../keymap"
import { semanticStops } from "../../ui/neon"
import { Locale } from "../../util/locale"
import "../../ui/card"

// 输入卡的叠色档。导出给测试直接引用,免得测试里再抄一个 0.45。
export const INPUT_CARD_ALPHA = 0.45

// 输入区霓虹输入卡的壳。与助手气泡卡 / 流程图节点卡共用的那张壳(NeonCard)同一条规矩:
// 这里只依赖 useTheme() 与 useKV(),不碰 session/local context,测试能直接挂载真壳量几何 ——
// 手抄一份 neonbox 到测试里的话,改这里的 padding 不会让任何测试变红。
//
// **padding 四边 2 —— 关键在于「padding 格就是边框格」**:NeonBox 把圆角边框画在自己第 0 行/列
// 与最后一行/列上,所以 padding = 1 时内容紧贴着上下边框,卡内一行留白都没有(用户报的就是
// 「挤成一团」)。padding ≥ 2 才会真的空出**一整行/列**的呼吸区:内容从第 1 行/列开始,
// 上边框(第 0 行)与内容之间有第 1 行空着。原型那边是 `padding: 12px 16px`
// (card-design-v7.html 的 `.prompt`),折到终端正是这个量级。
// 四边必须一起改(与 NeonCard 的同一条纪律):只改一边会得到「上疏下紧」这种更难看的偏心。
// 连带后果:卡内可用宽从「卡宽 − 2」变成「卡宽 − 4」,整行多两行 ——
// 列宽账见下面的 MODEL_CHIP_MARGIN,提示行的门槛见 HINT_ROW_MIN_WIDTH。
//
// animated 是响应式算出来的,三个条件缺一不可:
//   focused  —— 流动与扫光是「正在输入」的信号,失焦就该安静下来;
//   visible —— 隐藏时宿主盒子还挂在那儿(visible={false} 只是不画),不掐掉定时器的话
//              会 12.5 次/秒地空 requestRender 一棵没人看的树;
//   animations_enabled —— 用户显式关掉动画。此时不是「空转但跳过相位」,而是
//              animated 直接变 false、setter 把表停掉;KV 再打开时 setter 又把表起回来。
//
// **不叠悬停流动**。聚焦已经是这张卡唯一的「我在工作」信号,鼠标恰好停在这张卡上是常态
// (输入区就贴在光标下面),叠上去的结果是这圈描边永远在动,聚焦反而看不出差别了。
// 同理不加悬停提亮:聚焦时已经有扫光这一层高光,再混 20%(HOVER_BOOST 那一档)提亮只会把扫光洗平。
// 原型那边也是同一套判断 —— `.prompt.hot`(聚焦)是常态,`.card:hover` 才带 gbFlow。
// 另外也不加 enterDelay:输入卡是常驻的,不存在「入场」这回事。
export function PromptCard(props: { focused: boolean; visible?: boolean; children: JSX.Element }) {
  const { theme } = useTheme()
  const kv = useKV()
  return (
    <neonbox
      gradientStops={semanticStops(theme, "input")}
      animated={props.focused && props.visible !== false && kv.get("animations_enabled", true)}
      // 输入卡照抄原型 `.prompt` 的那一档:`linear-gradient(135deg, rgba(79,209,224,.5),
      // rgba(74,158,255,.4))` —— 两端均值 0.45,是原型所有描边里最淡的一档(见 ui/neon 的
      // BORDER_ALPHA_DEFAULT 注释表)。输入卡是唯一一张「先要读正文、再看边框」的卡:
      // 边框抢戏就等于正文被框住,所以它比气泡卡(0.62)还淡一档。
      borderAlpha={INPUT_CARD_ALPHA}
      // 透明卡:叠色底一路往上到 app 根盒子的 theme.background。
      borderBackdrop={theme.background}
      paddingTop={2}
      paddingBottom={2}
      paddingLeft={2}
      paddingRight={2}
      width="100%"
      flexShrink={0}
    >
      {props.children}
    </neonbox>
  )
}

// 模型芯片里模型名的长度上限。
// 本文所有列数按「1 列 = 1 个终端格」算,并采用同一套字宽约定:
//   ASCII 1 列;CJK 全角字 2 列(「发送」= 2 字 × 2);East-Asian Ambiguous 字形按目标终端的
//   常规行为记 1 列(「◆」U+25C6 就是 Ambiguous,在 CJK 终端里可能被渲成 2 列 —— 那种终端上
//   本卡的可用宽度整体少 1,不是这里要解决的问题)。
//   卡内可用宽 = 终端宽 − 卡 padding(2+2)                 ← 卡内留白那一档的四边 padding
//   定长开销 = ">" 盒 2 + 行内 gap 1 + 行内 gap 1 + 芯片(padding 1+1 + "◆ " 2)= 4
//            + 芯片与按钮的 gap 1 + 按钮(padding 1+1 + "发送 " 6 + 键名)= 12
//            = 21
//   剩下分给「模型名 + 输入框」;输入框留 12 列,所以
//   模型名上限 = 终端宽 − 4 − 21 − 12 = 终端宽 − 37。
// (padding 从 1+1 提到 2+2 时这个数从 35 变成 37:扣减里只有卡 padding 那一项在变,
// 定长开销 21 与输入框下限 12 都与卡 padding 无关 —— 它们量的是卡**里面**那几个盒子的宽窄。)
// 按钮那 12 列是按**默认键位** input_submit = return 算的(formatKeySequence 渲染成 5 格的
// "enter");用户把提交键改成长序列(如 shift+return = 11)时按钮会相应变宽、吃掉输入框,
// 输入框那一侧还有 minWidth=4 兜底。
// 顺带把输入框那一侧的余量也记下来,公式是同一套:输入框 = 卡内可用宽 − 21 − 模型名上限。
//   40 列:模型名上限 = max(8, min(28, 3)) = 8(MODEL_CHIP_MIN 抬上来的)→ 输入框 36 − 21 − 8 = 7 列。
//      芯片自己的 minWidth=10 这一档在这里不是约束:芯片内容已经有 4 + 8 = 12 列。
//      7 列够显示光标和几个字,不够放长占位符 —— 那是预期行为(留白那一档之前是 9 列)。
//   60 列:模型名上限 = min(28, 23) = 23 → 输入框 56 − 21 − 23 = 12 列,正好是留的下限。
//      巧的是这一档与留白之前一样是 12:padding 多吃的 2 列正好由模型名上限从 25 掉到 23 补上。
//   80 列:封顶在 28 → 输入框 76 − 21 − 28 = 27 列(留白之前 29)。
//  120 列:同样封顶在 28 → 输入框 116 − 21 − 28 = 67 列(留白之前 69)。
// 上面四档的数字都有渲染级断言兜着(见 test/component/prompt-card 的 CHIP_CASES),改 padding
// 而忘了重推这里,那组会红。
// 截断按**字符数**算(Locale.oneLine 内部是 str.length),这里成立的前提是模型 id 是
// ASCII slug(gpt-5-codex / claude-sonnet-4 之类),字符数 == 列数;模型名里出现 CJK 就偏窄。
const MODEL_CHIP_MARGIN = 37
const MODEL_CHIP_MAX = 28
const MODEL_CHIP_MIN = 8

// 输入行右端:模型芯片 + 发送按钮。
// 点击按钮只是 submit() 的又一个入口 —— 能不能发仍由 submit() 自己判定,
// canSend 只是同一组条件的视觉预告(空输入/disabled/正在建会话/自动补全弹着/没有 agent
// 时不高亮、点了也不发)。
// 按钮底色/hover 照 routes/session/queue-dock 的行内按钮(hover 换 backgroundElement,
// 左右各留 1 格),onMouseUp 里先 stopPropagation —— 不拦住的话点击会冒到输入框上。
//
// 按钮上的键名走 useCommandShortcut("input.submit") 现取,和提示行里的
// agent.cycle / command.palette.show / input.newline 是同一套取法 ——
// input_submit 在 keybind.ts 里是 `keybind("return", …)`(不是 prompt_submit 那个 "none",
// 那是另一条命令),并且由 keymap.tsx 的托管输入层 gather("input", inputCommands) 注册,
// 所以它是可配置、可查的。用户改键之后这一行会跟着变;写死 "Enter" 会在改键后变成假提示。
// 渲染出来是小写的 "enter"(formatKeySequence 不做大写化),和提示行里
// tab / ctrl+p / shift+enter 的全小写风格一致。
export function PromptSend(props: { model: string; canSend: boolean; modelColor?: RGBA; onSend(): void }) {
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const submitShortcut = useCommandShortcut("input.submit")
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
            minWidth=10 保底 10 列,再窄就轮到输入框了。
            modelColor 由调用方给:模型名要跟提示行里的 provider / variant 用同一个
            fadeColor(…, modelMetaAlpha()) —— 挂载淡入 + leader 压暗都在那个表达式里,
            在这里重算一遍只会漂。 */}
        <box
          backgroundColor={theme.backgroundPanel}
          paddingLeft={1}
          paddingRight={1}
          flexShrink={1}
          minWidth={10}
          overflow="hidden"
        >
          <text fg={props.modelColor ?? theme.text} wrapMode="none">
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
        <text fg={props.canSend ? theme.text : theme.textMuted}>发送 {submitShortcut()}</text>
      </box>
    </box>
  )
}

// 终端窄到放不下完整键位提示组时,整条丢掉「换行」而不是让它被裁成半个词。
// 推导(1 列 = 1 个终端格,CJK 按 2 列):提示组的定长部分是
// 「<键> agents」7 + 「<键> commands」9 + 「<键> 换行」5 + 组内两个 gap 4 = 25 列
// (这里只量标签与间隙,键名本身另算),键名按常见的 tab(3)/ ctrl+p(6)/ shift+return(11)
// 算 20 列 → 45 列,再加卡片左右 padding 各 2 → 需要 49 列,取整到 50(留 1 列余量)。
// 40~49 列这一档只剩前两条:25 − 5(整条换行) − 2(少一个 gap) = 18 列,
// 加 tab(3) + ctrl+p(6) = 27 列,再加 padding 4 = 31 列 ≤ 40,放得下。
// 提交键不在这一行 —— 它跟着「发送 Enter」按钮走(见 PromptSend 里的理由)。
const HINT_ROW_MIN_WIDTH = 50

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
