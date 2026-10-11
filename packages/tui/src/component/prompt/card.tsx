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
// **上下不对称,是有意的**:顶部 padding=2 留一行呼吸区,底部 padding=1 让最后一行紧贴下边框。
//
// 「padding 格就是边框格」这条没变:NeonBox 把圆角边框画在自己第 0 行/列与最后一行/列上,
// 所以 padding = 1 时内容与边框之间一行留白都没有,padding = 2 才空得出一整行。
// 顶部必须是 2 —— 内容从边框下一行开始,紧贴着读起来就是「挤成一团」(用户报过)。
// 底部反过来:这张卡贴在屏幕最底下,最后一行之下再空一行,那行空白在卡里、在屏幕上都
// 没有任何内容对齐它,读起来就是「卡里多了一行没用的东西」(用户报的「底部还有空行」)。
// 于是底部收到 1,最后一行直接压在下边框上。
//
// 原型那边是 `padding: 12px 16px`(card-design-v7.html 的 `.prompt`),四边对称 —— 但浏览器里
// 12px 折不满一个终端行,而终端里「一行」是最小单位,对称就只能在「上疏下紧」与「上紧下疏」
// 二选一。选上疏下紧。
//
// 连带后果只在**左右**:卡内可用宽仍是「卡宽 − 4」,列宽账见下面的 MODEL_CHIP_MARGIN。
// 纵向不影响任何宽度预算。
//
// **卡内是三行**(按这个顺序摆进来,摆法见 component/prompt/index.tsx 与本文件的 PromptBottomRow):
//   1. 输入行 —— ">" 提示符 + 输入框 + 右端的自动批准开关(PromptAutoApprove);
//   2. 呼吸行 —— 一个 height={1} 的空盒;
//   3. 底部行 —— 左:插件槽 + agent/模型 meta + 上下文占用;右:模型芯片 + 发送按钮(PromptBottomRow)。
// shell 模式额外多一行 PromptShellHint(`esc exit shell mode`),normal 模式没有那一行 ——
// 原来常驻的键位提示行(tab agents / ctrl+p commands / 换行)已按用户要求撤掉,理由见 PromptShellHint。
// 呼吸行必须是**真的一行布局高度**,padding 给不了这个效果:padding 格就是边框格(上面那条),
// 再往 padding 上加只会在四边各多缩两列,不会在两行之间插出空隙。
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
      // 1:最后一行紧贴下边框 —— 底部那行空白没有任何内容对齐它,读起来像卡里多了一行。
      // 与顶部的 2 不对称,理由见文件头那段注释。
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
      width="100%"
      flexShrink={0}
    >
      {props.children}
    </neonbox>
  )
}

// 模型芯片里模型名的长度上限。芯片在卡内**底部行的右端**(见 PromptBottomRow),不再与输入框
// 同行 —— 这一版量的是另一笔账,与上一版分开记:
//
// 本文所有列数按「1 列 = 1 个终端格」算,并采用同一套字宽约定:
//   ASCII 1 列;CJK 全角字 2 列(「发送」= 2 字 × 2);East-Asian Ambiguous 字形按目标终端的
//   常规行为记 1 列(「◆」U+25C6 就是 Ambiguous,在 CJK 终端里可能被渲成 2 列 —— 那种终端上
//   本卡的可用宽度整体少 1,不是这里要解决的问题)。
//
// **输入行不再为芯片让宽度**:输入行只有 ">" 盒(2)+ gap 1 + textarea,而 textarea 那一格是
// flexGrow=1 / minWidth=4,没有上限盒 —— 模型名再长也吃不到输入框。「芯片把输入框挤窄」
// 这个上一版要防的问题,随输入行清空一起消失了。
//
// 要护住的是**底部行**:PromptSend 整组是 flexShrink={0},芯片自己虽然能压但只压到
// minWidth=10,再窄就轮到左边的 agent / 模型 meta(它才是这一行里该被牺牲的那一段)。
// 于是上限 = 终端宽 − 卡 padding − 底部行定长 − meta 下限:
//     卡 padding                     = 2 + 2 = 4
//     底部行定长(按**除 usage 外**各段都渲染出来的最坏情况算,行内 gap 都在):
//         行内 gap 2 × 2              = 4   (插件槽 / meta / 芯片三段之间)
//         芯片保底                     = 10  (PromptSend 里那个 minWidth)
//         芯片↔按钮 gap               = 1
//         按钮(padding 1+1 + "发送 " 5 + 键名 "enter" 5) = 12
//                                   = 27
//     meta 下限                      = 12(与上一版留给输入框的是同一档,现在留给左边的 agent 名)
//   → 上限 = 终端宽 − 4 − 27 − 12 = 终端宽 − 43。
// 这里取 **37**(比 43 少让 6 列)是不把 usage 算进这笔账:usage 段自己有预算
// (见下面的 usageRowColumns),它与 meta、插件槽是同一批「可压缩段」,三者在 leftover 里
// 按 yoga 的比例分 —— 芯片组是 flexShrink={0} 且芯片有 minWidth={10},所以
// **芯片与发送按钮永远不会消失**,被压缩的只有模型名。多让出来的 6 列在终端 ≥ 45 列
// (usage 整段不画)时归模型名;更窄时归 usage 与 meta。
// 按钮那 12 列是按**默认键位** input_submit = return 算的(formatKeySequence 渲染成 5 格的
// "enter");用户把提交键改成长序列(如 shift+return = 11)时按钮会相应变宽、吃掉底部行的 meta。
// 截断按**字符数**算(Locale.oneLine 内部是 str.length),这里成立的前提是模型 id 是
// ASCII slug(gpt-5-codex / claude-sonnet-4 之类),字符数 == 列数;模型名里出现 CJK 就偏窄。
const MODEL_CHIP_MARGIN = 37
const MODEL_CHIP_MAX = 28
const MODEL_CHIP_MIN = 8

/**
 * 底部行里 usage 段(上下文占用/花费)能拿到的列数上限。
 *
 * 减掉的与 MODEL_CHIP_MARGIN 是同一笔账,只是把「插件槽那一段」也算进 gap 里取最坏情况:
 *     卡 padding 左右              = 2 + 2 = 4
 *     meta 下限                    = 12
 *     行内 gap 2 × 3               = 6   (插件槽 / meta / usage 三段之间,全渲染时)
 *     芯片保底                     = 10
 *     芯片↔按钮 gap                = 1
 *     发送按钮                     = 12
 *                                   = 45
 * 插件槽本身不计入:它与 meta 一样是可压缩段,真挤起来它先没。
 *
 * 为什么要一个预算而不是直接 `flexShrink` 裁:usage 是右端一小截数字,渲染器从右边裁,
 * 裁到只剩「7」就是一个**假数字**(见 util/usage 的 usageLabel)。这里把预算交回给
 * usageLabel 去按档降级,末档整段不画 —— 宁可没有,也不能显示错的数。
 */
export function usageRowColumns(terminalWidth: number) {
  return Math.max(0, terminalWidth - 45)
}

// 底部行右端:模型芯片 + 发送按钮(PromptBottomRow 的 trailing 槽)。
//
// **与原型的有意偏离**:原型(card-design-v7.html:1114-1131)把模型芯片与发送按钮都放在
// **输入行**的右端。用户明确要求「agent、模型、发送等这几个都显示在输入的最底下排列」,
// 所以这里跟着用户走 —— 输入行只留提示符 + 输入框,芯片与按钮搬到卡内底部行。
// 别按原型「修」回去:那正是用户报的「挤成一团」。
//
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
// 渲染出来是小写的 "enter"(formatKeySequence 不做大写化),与输入行右端那颗开关的
// 全小写风格一致。
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
            也不能把整行撑到折行 —— 折行会把「发送」甩到下一行,底部行高度失控。
            minWidth=10 保底 10 列,再窄就轮到左边的 agent/模型 meta 了
            (那一段才是这一行里该被牺牲的:meta 盒 minWidth=0,可以一路压到 0)。
            modelColor 由调用方给:模型名要跟 meta 里的 provider / variant 用同一个
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

// 输入卡**第一行右端**的「自动批准权限」开关。
//
// 用户要的是「开关在输入框右上角」:当前这一行只有提示符 + 输入框(模型芯片与发送按钮已经按
// 用户要求搬到卡内底部行,见 PromptBottomRow),右端是空的,正好摆它。
// 写法照抄 PromptSend 那个按钮(同一文件、同一视觉语言),而**不是**复用 component/pill.tsx
// 的 Pill:Pill 的 tone 只映射到 theme.primary,而这一颗开态要的是 theme.warning ——
// 它是个危险开关,安静地亮成 primary 会让人误以为只是「换个模型」这种无害切换。
// 为这一个场景给共享组件加一个 warning 档,波及的是标签栏等所有用 Pill 的地方,不划算。
//
// 只有**关→开**这一向要过 DialogConfirm(ui/auto-approve.ts 的 requestAutoApprove):
// 误触一下就把所有权限请求自动批掉,代价太大。开→关是安全动作,点了直接生效。
// flexShrink={0} 是这一行唯一的宽度代价:textarea 是 flexGrow + minWidth=4,自己会缩 ——
// 这与 card.tsx 顶部那条「不再为芯片让宽度」不冲突,当年挤成一团的是模型芯片那一档
// (28 列起,能吃到 40+),这颗是固定 12 列上下。
export function PromptAutoApprove(props: { enabled: boolean; onToggle(): void }) {
  const { theme } = useTheme()
  const [hover, setHover] = createSignal(false)
  const foreground = createMemo(() => {
    if (props.enabled) return theme.warning
    return hover() ? theme.text : theme.textMuted
  })
  // ● / ○ 是 East Asian Ambiguous 字形,在 CJK 终端里可能被渲成 2 列 —— 与 PromptSend 里那个
  // 「◆」同一笔账(见本文件顶部的字宽约定),不是这里要解决的问题。
  return (
    <box
      onMouseUp={(e) => {
        e.stopPropagation()
        props.onToggle()
      }}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      backgroundColor={hover() ? theme.backgroundElement : theme.backgroundPanel}
      paddingLeft={1}
      paddingRight={1}
      flexShrink={0}
    >
      <text fg={foreground()} wrapMode="none">
        {props.enabled ? "●" : "○"} 自动批准
      </text>
    </box>
  )
}

// 卡内第三行(底部行):左 = 插件槽 + agent/权限/提供商/变体 meta,右 = 模型芯片 + 发送按钮。
// 三段的可压缩性是这一行唯一要守住的东西,和上一版提示行同一条纪律:
//   插件槽、meta、usage —— 可截断(minWidth={0} + overflow hidden),压不下了从右边裁;
//   trailing(发送组)—— 不截断,它是这一行的「我现在能不能发」。
// minWidth={0} 是关键:不写的话 yoga 用内容的 min-content 当下界,meta 盒根本压不下去,
// 里头的 <text> 被挤到 1~2 列就会折成好几行 —— 底部行会长高,把输入区顶变形。
// 行内 gap={2} 只在**渲染出来的段之间**生效:插件槽没内容时那个盒子不存在,
// 于是 gap 从两个变一个,模型名那一侧凭空多出 2 列(MODEL_CHIP_MARGIN 按最坏情况封顶,
// 这里留出的 2 列就当余量,不另作他用)。
//
// **usage 段(上下文占用/花费)原先在卡外那一行**,用户报的是「输入卡下面空了一行」——
// 那行 80 列里只有右端 5 列有字,读起来就是一条空行。折进来之后输入卡底下什么都不剩,
// 底边直接贴着屏幕底。原型的 `.prompt`(card-design-v7.html:1114-1131)底下也没有统计行,
// 所以这是往原型靠,不是离开原型。
// 它的可压缩性排在 meta 之后被牺牲:usage 是一个数字,`/status` 与标签行的 `8.2K ctx` 胶囊
// 都查得到;meta 那段是「我现在在用哪个 agent / 哪个提供商」,丢了要重新去翻。
export function PromptBottomRow(props: {
  right?: JSX.Element
  meta?: JSX.Element
  usage?: JSX.Element
  trailing?: JSX.Element
}) {
  return (
    <box flexDirection="row" gap={2} alignItems="center" width="100%" flexShrink={0}>
      {/* 插件槽也是可压缩的一段:它有没有内容、宽度多大由第三方决定,
          不钉 flexShrink 的话,一旦被塞进一个宽 chip,底部行会被撑到折行。 */}
      <Show when={props.right}>
        <box flexDirection="row" gap={1} alignItems="center" flexShrink={1} minWidth={0} overflow="hidden">
          {props.right}
        </box>
      </Show>
      <box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
        {props.meta}
      </box>
      <Show when={props.usage}>
        <box flexShrink={1} minWidth={0} overflow="hidden">
          {props.usage}
        </box>
      </Show>
      {props.trailing}
    </box>
  )
}

// shell 模式才有的那一行(提示行):**只有 `esc exit shell mode`**,normal 模式整行不画。
//
// 原先这一行还有 `tab agents` / `ctrl+p commands` / `<键> 换行` 三条常规键位提示,已按用户要求
// 整条撤掉:它们在卡里长期是噪音,而且其中「换行」那条还骗过人 —— 显示的永远是 shift+enter,
// 那是因为 input_newline 在 keybind.ts 里绑的是**一串**
// (`shift+return,ctrl+return,alt+return,ctrl+j`),formatKeySequence 取第一个,而很多终端
// (Windows 终端尤其)根本分不出 shift+enter,用户实际用的是 ctrl+enter。
// 提示行没了就不会再假。**没有去改那串键位的顺序**:四个键都还在,顺序只影响显示,没有收益。
//
// shell 那一条留着,因为它是**唯一**写明怎么退出 shell 模式的入口 —— 底部行的 meta 只写了
// 「Shell」标出当前模式,没写退出键,整行删掉就只剩猜 esc。
// normal 模式调用方不渲染它(prompt/index.tsx 包了一层 Show),卡内于是只有三行。
export function PromptShellHint() {
  const { theme } = useTheme()
  return (
    <box width="100%" flexShrink={0}>
      <text fg={theme.text} wrapMode="none">
        esc <span style={{ fg: theme.textMuted }}>exit shell mode</span>
      </text>
    </box>
  )
}
