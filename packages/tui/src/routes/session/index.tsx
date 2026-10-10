import {
  batch,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
  untrack,
  useContext,
  type Accessor,
} from "solid-js"
import { createStore } from "solid-js/store"
import { Dynamic } from "solid-js/web"
import path from "node:path"
import { mkdir, writeFile } from "node:fs/promises"
import { useRoute, useRouteData } from "../../context/route"
import { useProject } from "../../context/project"
import { useSync } from "../../context/sync"
import { useEvent } from "../../context/event"
import { SplitBorder } from "../../ui/border"
import { useTuiPaths, useTuiTerminalEnvironment } from "../../context/runtime"
import { Spinner, SPINNER_FRAMES, WorkingSpinner } from "../../component/spinner"
import { animGradient } from "../../util/anim-spinner"
import { FilePreview } from "../../component/file-preview"
import { GitDiffView } from "../../component/git-diff-view"
import { GitCommitView } from "../../component/git-commit-view"
import { GitWorkspace } from "../../component/git-workspace"
import { TabBar, type TabItem } from "../../component/tab-bar"
import { PillRow, type PillSpec } from "../../component/pill"
import {
  CHAT_VIEW_ITEMS,
  CHAT_VIEW_KEY,
  DEFAULT_CHAT_VIEW,
  LAYOUT_COMMAND_ALIASES,
  LAYOUT_COMMAND_NAME,
  chatViewArgumentError,
  chatViewShort,
  otherChatView,
  resolveChatViewCommand,
  type ChatView,
} from "./chat-view"
import { ViewEntrance } from "./view-entrance"
import { EmptySessionHero } from "../../component/empty-session-hero"
import { FlowCanvas } from "../../component/flow/canvas"
import { createSyntaxStyleMemo, generateSubtleSyntax, useTheme } from "../../context/theme"
import "../../ui/card"
import { neonStops, semanticStops } from "../../ui/neon"
import { createEnterBaselineStore } from "../../ui/enter"
import { useCardHover } from "../../ui/hover"
import { BoxRenderable, ScrollBoxRenderable, addDefaultParsers, TextAttributes, RGBA } from "@opentui/core"
import { Prompt, type PromptRef } from "../../component/prompt"
import type {
  AssistantMessage,
  Part,
  Provider,
  ToolPart,
  UserMessage,
  TextPart,
  ReasoningPart,
  SessionStatus,
} from "@novaway/sdk-v2-latest/v2"
import { useLocal } from "../../context/local"
import { Locale } from "../../util/locale"
import { icon } from "../../util/panel-icons"
import {
  toolCommandParts,
  toolStatusFailedText,
  toolStatusPassedText,
  webSearchProviderLabel,
  toolHeadLayout,
  toolStatusSummary,
  type ToolStatusSummary,
} from "../../util/tool-display"
import { useRenderer, useTerminalDimensions, type JSX } from "@opentui/solid"
import { useSDK } from "../../context/sdk"
import { useEditorContext } from "../../context/editor"
import { openEditor } from "../../editor"
import { useDialog } from "../../ui/dialog"
import { DialogAlert } from "../../ui/dialog-alert"
import { TodoItem } from "../../component/todo-item"
import { DialogMessage } from "./dialog-message"
import type { PromptInfo } from "../../component/prompt/history"
import { DialogConfirm } from "../../ui/dialog-confirm"
import { DialogTimeline } from "./dialog-timeline"
import { DialogForkFromTimeline } from "./dialog-fork-from-timeline"
import { QueueDock } from "./queue-dock"
import type { QueueDraft } from "../../prompt/queue"
import { DialogSessionRename } from "../../component/dialog-session-rename"
import { Sidebar, SIDEBAR_TABS, cycleSidebarTab, setSidebarTab } from "./sidebar"
import { DiffStatList, uniqueDiffStats } from "../../component/diff-stat-list"
import { SubagentFooter } from "./subagent-footer.tsx"
import { Footer } from "./footer"
import { filetype } from "../../util/filetype"
import parsers from "../../parsers-config"
import { errorMessage } from "../../util/error"
import { agentDisplayName } from "../../util/agent-name"
import { Toast, useToast } from "../../ui/toast"
import { useKV } from "../../context/kv.tsx"
import stripAnsi from "strip-ansi"
import { usePromptRef } from "../../context/prompt"
import { useEpilogue } from "../../context/epilogue"
import { normalizePath } from "../../util/path"
import { PermissionPrompt } from "./permission"
import { QuestionPrompt } from "./question"
import { DialogExportOptions } from "../../ui/dialog-export-options"
import * as Model from "../../util/model"
import { formatTranscript } from "../../util/transcript"
import { sessionEpilogue } from "../../util/presentation"
import { setPreLayoutSiblingMargin } from "../../util/layout"
import { useTuiConfig } from "../../config"
import { useClipboard } from "../../context/clipboard"
import { nextThinkingMode, reasoningSummary, useThinkingMode, type ThinkingMode } from "../../context/thinking"
import { getScrollAcceleration, scrollIfAlive } from "../../util/scroll"
import { collapseToolOutput } from "../../util/collapse-tool-output"
import { subscribeMessageJump } from "../../util/message-jump"
import { sidebarWidth } from "../../util/sidebar-width"
import { sessionUsage } from "../../util/usage"
import { usePluginRuntime } from "../../plugin/runtime"
import { DialogRetryAction } from "../../component/dialog-retry-action"
import { getRevertDiffFiles } from "../../util/revert-diff"
import { expandMessageWindow, MESSAGE_WINDOW_INITIAL, messageWindow } from "../../util/message-window"
import { NovaWay_BASE_MODE, useBindings, useCommandShortcut, useNovaWayKeymap } from "../../keymap"
import { usePathFormatter } from "../../context/path-format"
import { LocationProvider } from "../../context/location"

addDefaultParsers(parsers.parsers)

const GO_UPSELL_FREE_TIER_LAST_SEEN_AT = "go_upsell_last_seen_at"
const GO_UPSELL_FREE_TIER_DONT_SHOW = "go_upsell_dont_show"
const GO_UPSELL_ACCOUNT_RATE_LIMIT_LAST_SEEN_AT = "go_upsell_account_rate_limit_last_seen_at"
const GO_UPSELL_ACCOUNT_RATE_LIMIT_DONT_SHOW = "go_upsell_account_rate_limit_dont_show"
const GO_UPSELL_WINDOW = 86_400_000 // 24 hrs
const GO_UPSELL_PROVIDERS = new Set(["NovaWay", "NovaWay-go"])

/**
 * 消息锚点壳(每条消息最外层那个带 message id 的盒子)与 alwaysSeparate 都住在同目录的
 * message-anchor:锚点壳必须能脱离会话区挂载测试,依赖这一页就成环。
 *
 * 这里 re-export alwaysSeparate,既有 import 路径不变 ——
 * test/cli/tui/inline-tool-wrap-snapshot.test.tsx 与 test/routes/session/assistant-card.test.tsx
 * 都是从这儿拿的。
 */
import { alwaysSeparate, messageColumns, MessageAnchor, MESSAGE_MAX_WIDTH } from "./message-anchor"
export { alwaysSeparate, messageColumns, MessageAnchor, MESSAGE_MAX_WIDTH }
import { WORKING_LINE_INDENT, workingStepTitle, workingTitleColumns, type WorkingPart } from "./thinking-step"

// 会话页的占位符。会话页之前**一个都没传**,聚焦时输入框里只有光标 —— 原型的
// 输入卡靠「问我任何事... "示例"」占位,空着的话整张卡左半边是白的。
// 「继续刚才的任务」就是原型 card-design-v7.html 里那一行示例。
export const SESSION_PLACEHOLDERS = {
  normal: ["继续刚才的任务", "总结目前的进展", "解释这段代码", "把失败的测试修好"],
  shell: ["ls -la", "git status", "pwd"],
} as const

// 助手气泡卡内 part 的顶 margin 策略:卡内首个子节点的 previous 是 undefined → 拿 0
// (那一行空行由气泡 wrapper 的 marginTop=1 承担),**只要有前一个兄弟就给 1**。
// 判定只看「有没有前兄弟」,不看前兄弟的行数、也不看它在不在 alwaysSeparate 里:
//   - Read/Glob/Grep/WebFetch/WebSearch/Write 等行内工具是单行,且 InlineToolRow 只在
//     separate 为真时才注册(alwaysSeparate),只有 Task 传了;
//   - Read 还会再吐一个没有 ref 的「↳ Loaded」单行框。
// 这两类前兄弟拿不到 1,正文就会紧贴上来,整张卡变成一坨。改造前 TextPart/ReasoningPart
// 是静态 marginTop={1},恒有 1 行空行 —— 这里等价地把那个「恒 1」换成「有前兄弟就 1」。
// TextPart / ReasoningPart 共用,避免两处策略各改各的漂移。
export function partSiblingRef(el: BoxRenderable) {
  alwaysSeparate.add(el)
  setPreLayoutSiblingMargin(el, (previous) => (previous ? 1 : 0))
}

// meta 行里模型名的截断上限。26 是个经验值,不是精确推导:
// 能算准的固定开销是 ◆(1) + 它后面的空格(1) + 两个「 · 」(2×3=6) + 时间戳最长一档
// 「14:32 · 2026/1/2」(locale.ts 的 `time · localDate` = 5+3+8 = 16),合计 24;
// 余下 2 列是保守余量。它**没有**把 agentDisplayName 算进去 —— agent 名通常 4~6 列,
// 名字特别长时会进一步挤掉模型名,这是「保住 agent 与时间、优先丢模型」的有意取舍。
// 下限 12:再窄也要给模型名留一截,否则只剩个「 · 」很难看。
export function metaModelLimit(width: number) {
  return Math.max(12, width - 26)
}

// 霓虹卡壳住在 component/neon-card:助手气泡与流程图节点卡共用它(名字与理由见那边),
// 而画布挂在这一页里 —— 壳留在这一页就成环。re-export 保住既有 import 路径。
import { NeonCard } from "../../component/neon-card"
export { NeonCard }

// 助手气泡的 meta 行。agent 颜色由调用方注入,所以这里只依赖 useTheme(),
// 测试能直接挂载 —— 顺序和截断都是可见行为,值得让测试盯住,而不是在测试里抄一份。
//
// **一处有意的偏离原型**:原型 `.msg.assistant .msg-meta .who` 是固定的 --cyan,而这里的 ◆
// 取 `local.agent.color(agent)` —— 哪个子代理答的就带哪个颜色。这是本仓库已有的约定
// (节标题 ◇ 与思考/工具卡的语义色都取同一处),色相本来就编码了「谁在说话」,
// 压成一个固定的青反而把信息丢了。
export function AssistantMeta(props: {
  agentColor: RGBA
  agent: string
  created: number
  model: string
  width: number
}) {
  const { theme } = useTheme()
  return (
    <box flexDirection="row" gap={1} paddingLeft={1} flexShrink={0}>
      <text wrapMode="none">
        <span style={{ fg: props.agentColor }}>◆</span>
        <span style={{ fg: theme.text }}> {agentDisplayName(props.agent)}</span>
        {/* 顺序是「agent · 时间 · 模型」而不是原型的「agent · 模型 · 时间」:
            wrapMode="none" 是尾部裁切,把不受控的模型名排在定长的时间前面,窄终端上
            时间戳会先被裁掉。模型名放最后 = 被裁时优先丢模型名、保住时间;
            再用 metaModelLimit 按剩余宽度截一次,不指望它被终端裁。 */}
        <span style={{ fg: theme.textMuted }}>
          {" · "}
          {Locale.todayTimeOrDateTime(props.created)}
          {" · "}
          {Locale.oneLine(props.model, metaModelLimit(props.width))}
        </span>
      </text>
    </box>
  )
}

type RetryAction = Extract<SessionStatus, { type: "retry" }>["action"]

/**
 * 用户消息 meta 行的默认值。原型 card-design-v7.html:918 的 meta 是**常显**的,所以默认 show。
 * 已经在旧版本里存过 `timestamps: "hide"` 的用户仍然拿到 hide —— 那是他自己拨过的开关,
 * 不该被一次默认值变更悄悄推翻。
 */
export const USER_META_DEFAULT_KV: "hide" | "show" = "show"

/**
 * 用户消息的 meta 行显不显示。
 *
 * `timestamps` 这个 KV 的语义在 C2 之后**变了一格**:原来它管的是「气泡卡内那行小字时间戳」,
 * 默认 hide;时间戳搬成 meta 行(卡外、常显)之后,再让它只管时间戳就会出现「meta 行在、
 * 时间不在」的半截状态。所以它现在管的是**整条 meta 行**,默认 show(见 USER_META_DEFAULT_KV)。
 *
 * 旗标本身留着而不是删掉:它外面挂着 `session.toggle.timestamps` 命令、
 * `/timestamps` 斜杠命令(config/keybind.ts 的 session_toggle_timestamps 键位 + keymap.tsx 的
 * 斜杠名与优先级表都登记着它),删旗标要连带删这三处,还要处理用户 keybind.json 里已经写进去的
 * `session_toggle_timestamps` 变成悬空绑定。而「我想要更紧凑的会话流」是个真实需求 ——
 * 留一个开关比删掉更划算。
 */
export function userMetaVisible(timestamps: "hide" | "show") {
  return timestamps === "show"
}

/**
 * 用户消息的 meta 行:`14:32 你`(原型 card-design-v7.html:918)。
 *
 * 颜色照原型的两段规则走(card-design-v7.html:397-399):
 * ```css
 * .msg-meta { color: var(--muted); }                    ← 整行默认 muted:时间戳那一段
 * .msg-meta .who { color: var(--cyan); font-weight: 700; }
 * .msg.user .msg-meta .who { color: var(--pink); }      ← 用户那条的「你」是 user 语义色
 * ```
 * 所以**时间戳 muted、「你」user 语义色**:这里取 semanticStops(theme, "user")[0],它就是
 * theme.accent(novaway 深色 #ff2d7b),即原型那条 `--pink`。终端没有 font-weight,所以原型
 * 那个加粗只能靠颜色本身顶着(整行 muted 时它就是那一行唯一的彩色)。
 *
 * **别把这一处的粉当成「用户气泡描边的首端色」**:气泡卡那一圈走的是 neonStops(theme)
 * (三端霓虹,#00e5ff → #4d7cff → #ff2d7b),粉在**末端**,不在首端 —— 那套色板是更早的
 * 视觉计划(2026-10-01-tui-neon-card-visual)给气泡卡定的,今天不动。`semanticStops(theme,
 * "user")` 那一套粉紫两段唯一的消费者是流程图的「用户输入」节点卡(见 component/flow/canvas
 * 的 roleOf),所以想改气泡卡的配色,改的也不是这里这一行。
 *
 * 形状与助手那条对称:没有 ◆(标的是人不是智能体)、没有模型名,meta 在**卡外**的上一行,
 * 卡内第一行留给正文。时间格式与助手 meta 共用 Locale.todayTimeOrDateTime
 * (今天只显示时分,更早显示「时间 · 日期」)。
 *
 * **对齐方向与助手那条相反,而且这是对的**:原型 `.msg.user` 是
 * `align-self: flex-end; align-items: flex-end`(card-design-v7.html:395),用户那条的 meta 与气泡
 * 共享同一条右缘;`.msg.assistant` 是 `align-self: flex-start`(:396),助手那条的 meta 从左缘起。
 * 右对齐由下面那两个属性给,理由与**为什么必须带 `paddingRight`** 见那句 `justifyContent` 的注释。
 * 调用点那一处的注释与断言见 UserMessage 与 test/routes/session/message-meta.test.tsx。
 */
export function UserMeta(props: { created: number }) {
  const { theme } = useTheme()
  return (
    // **右对齐**,靠 `justifyContent="flex-end"`。
    //
    // **为什么不写成 `alignSelf="flex-end"` 让这一行按内容收窄**:那样这一行的宽度就变成
    // 「按内容算」,而 opentui/yoga 在这一档下给不出高度 —— 这一行直接变成 0 高,文字盖到下一张卡
    // 的顶边框上(实测:meta 与卡顶边框叠在同一行)。所以**外层那个盒子仍然撑满整列**,
    // 右对齐在这一行内部做。
    //
    // **为什么必须带 `paddingRight={1}`**:同样实测出来的 —— 去掉它,`justifyContent: flex-end`
    // 与 `height: 1` 都会让这一行塌成 0 高;加上就稳定。那一列也正好是原型
    // `.msg-meta { padding: 0 4px }`(:397)那对内边距在终端里的落点,所以断言里它是算得出的
    // 那一列,不是凑出来的偏移。
    <box flexDirection="row" gap={1} paddingLeft={1} paddingRight={1} flexShrink={0} justifyContent="flex-end">
      <text wrapMode="none">
        <span style={{ fg: theme.textMuted }}>{Locale.todayTimeOrDateTime(props.created)} </span>
        <span style={{ fg: semanticStops(theme, "user")[0] }}>你</span>
      </text>
    </box>
  )
}

/**
 * 思考块的 meta 行:`◆ 正在工作`(原型 card-design-v7.html:946)。
 *
 * **为什么不能照抄助手那行的形状**:助手 meta 回答的是「这条消息是谁发的、用什么模型、什么时候」;
 * 这一行回答的是「**这一块**正在干什么」。原型里 thinking 是一条**独立消息**,所以它的 meta 里
 * 只剩状态;而本实现里思考块是助手气泡卡内的 part(A1 把所有 part 包进同一张卡),于是这句状态
 * 被放在思考卡**上方、仍在助手卡内** —— 与助手 meta 平级会让人以为是第二条助手消息。
 *
 * **不印智能体名**:那正是把上面 AssistantMeta 那行的名字原样抄一遍(用户报的「显示这么多个
 * agents-orchestrator」)。这一格只回答「在干嘛」,不回答「是谁」—— 是谁由上面那行说了算。
 * agentColor 因此也只用在 `◆` 上:颜色仍然编码「谁在说话」,文字不再重复一遍。
 */
export function ThinkingMeta(props: { agentColor: RGBA }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="row" gap={1} paddingLeft={1} flexShrink={0}>
      <text wrapMode="none">
        <span style={{ fg: props.agentColor }}>◆</span>
        <span style={{ fg: theme.textMuted }}> 正在工作</span>
      </text>
    </box>
  )
}

function goUpsellKeys(action: RetryAction) {
  if (!action) return
  if (!GO_UPSELL_PROVIDERS.has(action.provider)) return
  if (action.reason === "free_tier_limit") {
    return {
      lastSeenAt: GO_UPSELL_FREE_TIER_LAST_SEEN_AT,
      dontShow: GO_UPSELL_FREE_TIER_DONT_SHOW,
    }
  }
  if (action.reason === "account_rate_limit") {
    return {
      lastSeenAt: GO_UPSELL_ACCOUNT_RATE_LIMIT_LAST_SEEN_AT,
      dontShow: GO_UPSELL_ACCOUNT_RATE_LIMIT_DONT_SHOW,
    }
  }
}

const sessionBindingCommands = [
  "session.share",
  "session.rename",
  "session.timeline",
  "session.fork",
  "session.compact",
  "session.unshare",
  "session.undo",
  "session.redo",
  "session.sidebar.toggle",
  "session.toggle.conceal",
  "session.toggle.timestamps",
  "session.toggle.thinking",
  "session.toggle.actions",
  "session.toggle.scrollbar",
  "session.toggle.generic_tool_output",
  "session.first",
  "session.last",
  "session.messages_last_user",
  "session.message.next",
  "session.message.previous",
  "messages.copy",
  "session.copy",
  "session.export",
  "session.child.first",
  "session.parent",
  "session.child.next",
  "session.child.previous",
] as const

const sessionGlobalBindingCommands = [
  "session.page.up",
  "session.page.down",
  "session.line.up",
  "session.line.down",
  "session.half.page.up",
  "session.half.page.down",
] as const

const sessionGlobalUnfocusedBindingCommands = ["session.first", "session.last"] as const

const context = createContext<{
  width: number
  sessionID: string
  conceal: () => boolean
  thinkingMode: () => ThinkingMode
  showThinking: () => boolean
  /** 用户消息的 meta 行(时间 + 「你」)显不显示;由 `timestamps` 旗标驱动,默认常显。 */
  showUserMeta: () => boolean
  showDetails: () => boolean
  showGenericToolOutput: () => boolean
  diffWrapMode: () => "word" | "none"
  /**
   * 聊天区当前视图(bubble 气泡 / flow 流程图)。D2 把它备好并挂在 context 上,
   * 真正按它渲染流程图画布的是 D3 —— 那里直接读这个 accessor 即可,不必再从 KV 读一遍。
   */
  chatView: Accessor<ChatView>
  providers: () => ReadonlyMap<string, Provider>
  sync: ReturnType<typeof useSync>
  tui: ReturnType<typeof useTuiConfig>
  /** 这条消息的卡片入场延迟(毫秒);undefined = 不入场。判定见 ui/enter.ts。 */
  enterDelayFor: (messageID: string) => number | undefined
}>()

function use() {
  const ctx = useContext(context)
  if (!ctx) throw new Error("useContext must be used within a Session component")
  return ctx
}

export function Session() {
  const setEpilogue = useEpilogue()
  const clipboard = useClipboard()
  const writeExport = async (file: string, content: string) => {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, content)
  }
  const pluginRuntime = usePluginRuntime()
  const route = useRouteData("session")
  const { navigate } = useRoute()
  const sync = useSync()
  const event = useEvent()
  const project = useProject()
  const paths = useTuiPaths()
  const tuiConfig = useTuiConfig()
  const kv = useKV()
  const { theme } = useTheme()
  const promptRef = usePromptRef()
  const session = createMemo(() => sync.session.get(route.sessionID))
  const location = createMemo(() => {
    const current = session()
    return current ? { directory: current.directory, workspaceID: current.workspaceID } : undefined
  })

  createEffect(() => {
    const title = Locale.truncate(session()?.title ?? "", 50)
    setEpilogue(sessionEpilogue({ title, sessionID: session()?.id }))
  })
  onCleanup(() => setEpilogue())
  const children = createMemo(() => {
    const parentID = session()?.parentID ?? session()?.id
    return sync.data.session
      .filter((x) => x.parentID === parentID || x.id === parentID)
      .toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  })
  const messages = createMemo(() => sync.data.message[route.sessionID] ?? [])
  const messagesBeforeRevert = () => {
    const messageID = session()?.revert?.messageID
    if (!messageID) return messages()
    const index = messages().findIndex((message) => message.id === messageID)
    return index === -1 ? messages() : messages().slice(0, index)
  }
  const foregroundTasks = createMemo(() =>
    sync.data.capabilities.experimentalBackgroundSubagents
      ? messages().flatMap((message) =>
          (sync.data.part[message.id] ?? []).filter(
            (part): part is ToolPart =>
              part.type === "tool" &&
              part.tool === "task" &&
              part.state.status === "running" &&
              part.state.metadata?.background !== true,
          ),
        )
      : [],
  )
  const permissions = createMemo(() => {
    if (session()?.parentID) return []
    return children().flatMap((x) => sync.data.permission[x.id] ?? [])
  })
  const questions = createMemo(() => {
    if (session()?.parentID) return []
    return children().flatMap((x) => sync.data.question[x.id] ?? [])
  })
  const visible = createMemo(() => !session()?.parentID && permissions().length === 0 && questions().length === 0)
  const disabled = createMemo(() => permissions().length > 0 || questions().length > 0)

  const pending = createMemo(() => {
    const completed = messages().findLastIndex((message) => message.role === "assistant" && message.time.completed)
    const pending = messages().findLastIndex(
      (message, index) => index > completed && message.role === "assistant" && !message.time.completed,
    )
    return pending === -1 ? undefined : pending
  })

  const lastAssistant = createMemo(() => {
    return messages().findLast((x) => x.role === "assistant")
  })

  // 会话是否正在干活(回答/思考/执行工具),驱动聊天区末尾的工作指示。
  const sessionWorking = createMemo(() => (sync.data.session_status?.[route.sessionID]?.type ?? "idle") === "busy")
  // 思考中:最后一条助手消息还有没结束的推理块(time.end 未落)。
  const thinkingActive = createMemo(() => {
    const last = lastAssistant()
    if (!last) return false
    return (sync.data.part[last.id] ?? []).some((part) => part.type === "reasoning" && part.time.end === undefined)
  })

  const dimensions = useTerminalDimensions()
  const [sidebar, setSidebar] = kv.signal<"auto" | "hide">("sidebar", "auto")
  const [sidebarOpen, setSidebarOpen] = createSignal(false)
  const [selectedFile, setSelectedFile] = createSignal<string | null>(null)
  const [tabs, setTabs] = createSignal<TabItem[]>([{ id: "chat", title: "聊天", type: "chat", closable: false }])
  const [activeTabId, setActiveTabId] = createSignal<string>("chat")
  const [conceal, setConceal] = createSignal(true)
  const thinking = useThinkingMode()
  const thinkingMode = thinking.mode
  const showThinking = createMemo(() => true)
  const [timestamps, setTimestamps] = kv.signal<"hide" | "show">("timestamps", USER_META_DEFAULT_KV)
  const [showDetails, setShowDetails] = kv.signal("tool_details_visibility", true)
  const [showAssistantMetadata, _setShowAssistantMetadata] = kv.signal("assistant_metadata_visibility", true)
  const [showScrollbar, setShowScrollbar] = kv.signal("scrollbar_visible", false)
  const [diffWrapMode] = kv.signal<"word" | "none">("diff_wrap_mode", "word")
  // 动效总闸。调用方把它折进各处的「要不要动」,这一层自己不读全局设置(ui/card 的约定):
  // 卡片阶梯入场(enterDelayFor)、视图切换的入场过渡(ViewEntrance 的 animate)都拿它当终态乘子。
  const [animationsEnabled] = kv.signal("animations_enabled", true)
  const [showGenericToolOutput, setShowGenericToolOutput] = kv.signal("generic_tool_output_visibility", false)
  // 聊天视图(气泡 / 流程图)。存 KV 而不是组件内 signal:它是用户挑的显示偏好,
  // 换终端、换会话都该还在(与 timestamps / animations_enabled 同一类)。
  // 写值一律用函数形式 `setChatView(() => next)`:solid 的 Setter<in out T> 在「直接传一个
  // 联合类型的值」上推不出 U(会退化成 string 而报 TS2345),函数形式才过得了类型检查 ——
  // 本文件里其它 kv signal(setTimestamps / setSidebar / setQueueCollapsed)也是这么写的。
  const [chatView, setChatView] = kv.signal<ChatView>(CHAT_VIEW_KEY, DEFAULT_CHAT_VIEW)

  // 排队草稿：会话忙碌时用户提交的提示暂存在本地，等会话空闲后按顺序自动发送。
  const [queueStore, setQueueStore] = createStore({
    items: [] as QueueDraft[],
    sending: undefined as string | undefined,
    failed: undefined as string | undefined,
  })
  const [queueCollapsed, setQueueCollapsed] = kv.signal("queue_collapsed", false)

  const wide = createMemo(() => dimensions().width > 120)
  const sidebarVisible = createMemo(() => {
    if (session()?.parentID) return false
    if (sidebarOpen()) return true
    if (sidebar() === "auto" && wide()) return true
    return false
  })
  // 用户消息的 meta 行显不显示。旗标语义见 userMetaVisible 的注释(管整条 meta 行,默认常显)。
  const showUserMeta = createMemo(() => userMetaVisible(timestamps()))
  // 切面板前先确保侧栏是开着的,否则"切换到文件"这类命令会静默什么都不做。
  const showSidebar = () => {
    if (sidebarVisible()) return
    batch(() => {
      setSidebar(() => "auto")
      setSidebarOpen(true)
    })
  }
  // 侧栏宽度自适应(sidebarWidth),内容宽度要跟着算,不能再写死 42。
  const contentWidth = createMemo(
    () => dimensions().width - (sidebarVisible() ? sidebarWidth(dimensions().width) : 0) - 4,
  )
  const providers = createMemo(() => Model.index(sync.data.provider))

  // 标签行胶囊能用的列数。contentWidth 扣掉的是消息区自己的 paddingLeft/Right 各 2 列,
  // 而标签栏那一条另有自己的 paddingLeft/Right 各 1 列,所以这里要**加回** 2:
  //   标签栏内宽 = 终端宽 − 侧栏宽 − 2(它自己的 padding)= contentWidth + 2。
  // PillRow 自己还会再留 1 列作为与标签的最小间距(见 component/pill.tsx 的 SPACER)。
  const tabBarWidth = createMemo(() => contentWidth() + 2)
  const paletteShortcut = useCommandShortcut("command.palette.show")

  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))
  const toast = useToast()
  const sdk = useSDK()
  const editor = useEditorContext()

  // 排队消息发送逻辑：会话空闲时自动发送队列中的第一条。
  async function sendQueueItem(draft: QueueDraft) {
    setQueueStore("sending", draft.id)
    setQueueStore("failed", undefined)
    try {
      const parts = [
        ...(draft.editorParts ?? []),
        { type: "text" as const, text: draft.inputText },
        ...draft.nonTextParts,
      ]
      await sdk.client.session.prompt(
        {
          sessionID: draft.sessionID,
          ...draft.model,
          agent: draft.agent,
          model: draft.model,
          variant: draft.model.variant,
          parts,
        },
        { throwOnError: true },
      )
      setQueueStore("items", (items) => items.filter((x) => x.id !== draft.id))
      toBottom()
    } catch (err) {
      setQueueStore("failed", draft.id)
      toast.show({
        title: "发送排队消息失败",
        message: err instanceof Error ? err.message : "未知错误",
        variant: "error",
      })
    } finally {
      setQueueStore("sending", undefined)
    }
  }

  // 自动发送：会话空闲 + 队列非空 + 无发送中/失败项 → 发送第一条。
  createEffect(() => {
    const items = queueStore.items
    if (items.length === 0) return
    if (queueStore.sending) return
    if (queueStore.failed && queueStore.failed === items[0]?.id) return
    if (sessionWorking()) return
    if (session()?.parentID) return

    void sendQueueItem(items[0])
  })

  // Tab management functions
  const activeTab = createMemo(() => tabs().find((t) => t.id === activeTabId()))

  const openPreviewTab = (filePath: string) => {
    const fileName = filePath.split(/[\\/]/).pop() || filePath
    const tabId = `preview-${filePath}`

    // Check if tab already exists
    const existingTab = tabs().find((t) => t.id === tabId)
    if (existingTab) {
      setActiveTabId(tabId)
      setSelectedFile(filePath)
      return
    }

    // Add new tab
    setTabs((prev) => [
      ...prev,
      {
        id: tabId,
        title: fileName,
        type: "preview",
        closable: true,
        filePath: filePath,
      },
    ])
    setActiveTabId(tabId)
    setSelectedFile(filePath)
  }

  // Git 页点变更文件名打开的是"改动差异"而不是整文件编辑:差异标签页和预览标签页
  // 共用 filePath 槽位,但类型不同,渲染时按 activeTab().type 分发。
  const openDiffTab = (filePath: string) => {
    const fileName = filePath.split(/[\\/]/).pop() || filePath
    const tabId = `gitdiff-${filePath}`
    if (tabs().find((t) => t.id === tabId)) {
      setActiveTabId(tabId)
      setSelectedFile(filePath)
      return
    }
    setTabs((prev) => [...prev, { id: tabId, title: `± ${fileName}`, type: "git-diff", closable: true, filePath }])
    setActiveTabId(tabId)
    setSelectedFile(filePath)
  }

  // Git 页点提交行打开"提交详情"。与 preview/git-diff 那两档不同,它**没有 filePath** ——
  // 看的是一个 commit hash,所以走的是 activeTab().commitHash 而不是 selectedFile。
  const openCommitTab = (hash: string) => {
    const tabId = `commit-${hash}`
    if (tabs().find((t) => t.id === tabId)) {
      setActiveTabId(tabId)
      return
    }
    setTabs((prev) => [
      ...prev,
      { id: tabId, title: `⌂ ${hash}`, type: "commit-detail", closable: true, commitHash: hash },
    ])
    setActiveTabId(tabId)
  }

  // Git 工作区:整屏双栏,一个会话同时只开一个(id 固定,重复打开只是切过去)。
  const openGitWorkspaceTab = () => {
    const tabId = "git-workspace"
    const existing = tabs().find((t) => t.id === tabId)
    if (existing) {
      setActiveTabId(tabId)
      return
    }
    setTabs((prev) => [...prev, { id: tabId, title: "Git", type: "git-workspace", closable: true }])
    setActiveTabId(tabId)
    setSelectedFile(null)
  }

  const closeTab = (tabId: string) => {
    if (tabId === "chat") return // Cannot close chat tab

    setTabs((prev) => prev.filter((t) => t.id !== tabId))

    // If closing active tab, switch to chat
    if (activeTabId() === tabId) {
      setActiveTabId("chat")
      setSelectedFile(null)
    }
  }

  const switchTab = (tabId: string) => {
    setActiveTabId(tabId)
    if (tabId === "chat") {
      setSelectedFile(null)
    } else {
      // Find the tab's filePath and update selectedFile
      const tab = tabs().find((t) => t.id === tabId)
      if (tab?.filePath) {
        setSelectedFile(tab.filePath)
      }
    }
  }

  createEffect(() => {
    const sessionID = route.sessionID
    void (async () => {
      const previousWorkspace = untrack(() => project.workspace.current())
      const result = await sdk.client.session.get({ sessionID }, { throwOnError: true })
      if (!result.data) {
        toast.show({
          message: `未找到会话: ${sessionID}`,
          variant: "error",
          duration: 5000,
        })
        navigate({ type: "home" })
        return
      }

      if (result.data.workspaceID !== previousWorkspace) {
        project.workspace.set(result.data.workspaceID)

        // Sync all the data for this workspace. Note that this
        // workspace may not exist anymore which is why this is not
        // fatal. If it doesn't we still want to show the session
        // (which will be non-interactive)
        try {
          await sync.bootstrap({ fatal: false })
        } catch {}
      }
      editor.reconnect(result.data.directory)
      await sync.session.sync(sessionID)
      if (route.sessionID === sessionID) scrollTo((target) => target.scrollBy(100_000))
    })().catch((error) => {
      if (route.sessionID !== sessionID) return
      toast.show({
        message: errorMessage(error),
        variant: "error",
        duration: 5000,
      })
      navigate({ type: "home" })
    })
  })

  let lastSwitch: string | undefined = undefined
  // event.on 返回退订函数。这里原来直接把它丢了 —— 而 Session 是按 sessionID keyed 的,
  // 每开一个会话/切一次标签页就多挂一个永不摘除的监听,还把旧的 route 闭包一起留住。
  // 用久了每条事件都要在一串死监听里跑一遍,越用越慢。
  onCleanup(
    event.on("message.part.updated", (evt) => {
      const part = evt.properties.part
      if (part.type !== "tool") return
      if (part.sessionID !== route.sessionID) return
      if (part.state.status !== "completed") return
      if (part.id === lastSwitch) return

      if (part.tool === "plan_exit") {
        local.agent.set("build")
        lastSwitch = part.id
      } else if (part.tool === "plan_enter") {
        local.agent.set("plan")
        lastSwitch = part.id
      }
    }),
  )

  let seeded = false
  let scroll: ScrollBoxRenderable
  let prompt: PromptRef | undefined
  const bind = (r: PromptRef | undefined) => {
    prompt = r
    promptRef.set(r)
    if (seeded || !route.prompt || !r) return
    seeded = true
    r.set(route.prompt)
  }
  const keymap = useNovaWayKeymap()
  const dialog = useDialog()
  const renderer = useRenderer()

  // 标签行右端那四颗胶囊的数据。宽窄全交给 PillRow(降级阶梯见 component/pill.tsx),
  // 这里只负责「每一颗说的是什么」:视图(可点,accent 表示当前态)、/ 命令(可点,键位取真实
  // 键位而不是写死 ctrl+p)、session 短 id、上下文占用。
  // session 短 id 取尾部 6 位:标签栏一行放不下完整 id,而尾部那几位已经足够把两个会话分开。
  const SESSION_ID_TAIL = 6
  const chatViewPills = createMemo<PillSpec[]>(() => {
    const usage = sessionUsage(sync, route.sessionID)
    const command = paletteShortcut()
    return [
      {
        label: `视图·${chatViewShort(chatView())}`,
        icon: icon("view"),
        tone: "accent",
        onClick: () => setChatView(() => otherChatView(chatView())),
        priority: 3,
        iconOnly: true,
      },
      {
        label: command ? `/ 命令 ${command}` : "/ 命令",
        onClick: () => keymap.dispatchCommand("command.palette.show"),
        priority: 2,
      },
      {
        label: `session #${route.sessionID.slice(-SESSION_ID_TAIL)}`,
        priority: 1,
      },
      {
        // 还没有任何助手消息时整颗不画(没有 label 就是没有胶囊),而不是画一颗写着 0 ctx 的。
        label: usage ? `${Locale.number(usage.tokens)} ctx` : "",
        priority: 0,
      },
    ]
  })

  // 输入框里手打整行 `/布局 [bubble|flow]` 的那条路。斜杠菜单里选中命令是**立刻派发**的
  // (keymap.tsx 的 useCommandSlashes),不经过输入框,所以带参数的写法必须在这里拦一次 ——
  // 否则 `/布局 flow` 会作为一条提示词发给模型。
  const onLocalCommand = (line: string) => {
    const result = resolveChatViewCommand(line)
    if (!result) return false
    if (!result.ok) {
      toast.show({ message: chatViewArgumentError(result.argument), variant: "error" })
      return true
    }
    setChatView(() => result.view ?? otherChatView(chatView()))
    return true
  }

  onCleanup(
    event.on("session.status", (evt) => {
      if (evt.properties.sessionID !== route.sessionID) return
      if (evt.properties.status.type !== "retry") return
      if (!evt.properties.status.action) return
      if (dialog.stack.length > 0) return

      const keys = goUpsellKeys(evt.properties.status.action)
      if (!keys) return

      const seen = kv.get(keys.lastSeenAt)
      if (typeof seen === "number" && Date.now() - seen < GO_UPSELL_WINDOW) return

      if (kv.get(keys.dontShow)) return

      void DialogRetryAction.show(dialog, evt.properties.status.action).then((dontShowAgain) => {
        if (dontShowAgain) kv.set(keys.dontShow, true)
        kv.set(keys.lastSeenAt, Date.now())
      })
    }),
  )

  // Helper: Find next visible message boundary in direction
  const findNextVisibleMessage = (direction: "next" | "prev"): string | null => {
    // 消息滚动容器只在气泡视图下挂着:流程图视图(D3)与文件预览标签都不挂它。
    // 这里原来是无条件解引用的,切到那种视图再按「下一条消息」就会炸 —— 加一道存在性判断。
    if (!scroll || scroll.isDestroyed) return null
    const children = scroll.getChildren()
    const messagesList = messages()
    const scrollTop = scroll.y

    // Get visible messages sorted by position, filtering for valid non-synthetic, non-ignored content
    const visibleMessages = children
      .filter((c) => {
        if (!c.id) return false
        const message = messagesList.find((m) => m.id === c.id)
        if (!message) return false

        // Check if message has valid non-synthetic, non-ignored text parts
        const parts = sync.data.part[message.id]
        if (!parts || !Array.isArray(parts)) return false

        return parts.some((part) => part && part.type === "text" && !part.synthetic && !part.ignored)
      })
      .sort((a, b) => a.y - b.y)

    if (visibleMessages.length === 0) return null

    if (direction === "next") {
      // Find first message below current position
      return visibleMessages.find((c) => c.y > scrollTop + 10)?.id ?? null
    }
    // Find last message above current position
    return [...visibleMessages].reverse().find((c) => c.y < scrollTop - 10)?.id ?? null
  }

  // Helper: Scroll to message in direction or fallback to page scroll
  const scrollToMessage = (direction: "next" | "prev", dialog: ReturnType<typeof useDialog>) => {
    const targetID = findNextVisibleMessage(direction)

    if (!targetID) {
      // 滚动容器不在(流程图视图 / 文件预览标签):没有可翻的页,静默收手而不是解引用 undefined。
      if (!scroll || scroll.isDestroyed) {
        dialog.clear()
        return
      }
      scroll.scrollBy(direction === "next" ? scroll.height : -scroll.height)
      dialog.clear()
      return
    }

    const child = scroll.getChildren().find((c) => c.id === targetID)
    if (child) scroll.scrollBy(child.y - scroll.y - 1)
    dialog.clear()
  }

  function toBottom() {
    setTimeout(() => {
      if (!scroll || scroll.isDestroyed) return
      scroll.scrollTo(scroll.scrollHeight)
    }, 50)
  }

  // 两个视图各有一个滚动容器:气泡视图那个 scrollbox(气泡态挂载)、流程图画布自己那个
  // (画布通过 onScrollBox 交出来)。翻页 / 跳消息命令作用在**当前视图**那个上。
  //
  // 原型是「旧视图当场消失 + 只有新视图在入场」(见 view-entrance 的注释),所以这里**不需要**
  // 「两个容器同时活着时该选谁」的判断:换视图的那一拍旧容器就已经被销毁了。仍要过 alive() ——
  // solid 的 `ref={(r) => (box = r)}` 在元素销毁时不会被回调置空,变量会一直指着已销毁的盒子。
  let flowScroll: ScrollBoxRenderable | undefined
  const alive = (box: ScrollBoxRenderable | undefined) => (box && !box.isDestroyed ? box : undefined)
  const activeScroll = () => alive(chatView() === "flow" ? flowScroll : scroll)

  // `scroll` 只在气泡视图挂载,而 ref 在元素销毁时不会被再调用一次置空 —— 所以它会一直指着
  // 一个**已销毁**的 renderable。统一走 scrollIfAlive:没有容器就静默收手(翻页类还要把弹窗
  // 关掉,否则弹窗会留在屏幕上)。见 util/scroll 的 scrollIfAlive。
  function scrollTo(action: (target: ScrollBoxRenderable) => void) {
    return scrollIfAlive(activeScroll(), action)
  }
  function withScroll(action: (target: ScrollBoxRenderable) => void) {
    return () => {
      scrollTo(action)
      dialog.clear()
    }
  }

  const local = useLocal()

  function enterChild(sessionID: string) {
    navigate({
      type: "session",
      sessionID,
    })
    const status = sync.data.session_status[sessionID]
    if (status?.type === "retry") void DialogAlert.show(dialog, "Retry Error", status.message)
  }

  function moveFirstChild() {
    if (children().length === 1) return
    const next = children().find((x) => !!x.parentID)
    if (next) enterChild(next.id)
  }

  function moveChild(direction: number) {
    if (children().length === 1) return

    const sessions = children().filter((x) => !!x.parentID)
    let next = sessions.findIndex((x) => x.id === session()?.id) - direction

    if (next >= sessions.length) next = 0
    if (next < 0) next = sessions.length - 1
    if (sessions[next]) enterChild(sessions[next].id)
  }

  function childSessionHandler(func: () => void) {
    return () => {
      if (!session()?.parentID || dialog.stack.length > 0) return
      func()
    }
  }

  const sessionCommandList = createMemo(() => [
    // 聊天视图的三条命令(原型 card-design-v7.html:1109-1113 的「命令菜单 · 切换聊天布局视图」)。
    //
    // 为什么是「两条指定 + 一条切换」而不是只有一条 `/布局`:
    //   - 斜杠菜单是**平铺**的一列,没有子菜单 / 二级列表这种结构(useCommandSlashes 把每条命令
    //     摊成一行 display + description)。所以「二选一」只能表达成两条独立命令,而原型那两条
    //     带说明文字的选项正好一一对应上:`/气泡视图` 与 `/流程图视图`。
    //   - 说明文字挂在**标题**上而不是 SLASH_DESC_ZH:slashDescription() 先查 SLASH_DESC_ZH 的
    //     静态文案,查不到才回落到命令标题。所以这里不登记静态说明,标题就是菜单里那一列文字。
    //   - 「✓ 当前」同样只能靠标题表达:它是响应式的,写进任何静态表都会变成永远不变的死文案。
    //   - `/布局` 保留成「无参切换」,既给「我只想来回切」一个短名字,也是输入框里
    //     `/布局 flow` 的那个头(参数校验见 chat-view.ts 的 resolveChatViewCommand)。
    {
      title: chatView() === "bubble" ? "切换到流程图视图" : "切换到气泡视图",
      value: "session.layout.toggle",
      category: "会话",
      slash: {
        name: LAYOUT_COMMAND_NAME,
        aliases: [...LAYOUT_COMMAND_ALIASES, "layout-toggle"],
      },
      run: () => {
        setChatView(() => otherChatView(chatView()))
        dialog.clear()
      },
    },
    ...CHAT_VIEW_ITEMS.map((item) => ({
      title: item.description + (chatView() === item.view ? ` ${icon("check")} 当前` : ""),
      value: `session.layout.${item.view}`,
      category: "会话",
      slash: {
        name: item.command,
        aliases: [item.view, item.label],
      },
      run: () => {
        setChatView(() => item.view)
        dialog.clear()
      },
    })),
    {
      title: session()?.share?.url ? "复制分享链接" : "分享会话",
      value: "session.share",
      suggested: route.type === "session",
      category: "会话",
      enabled: sync.data.config.share !== "disabled",
      slash: {
        name: "share",
      },
      run: async () => {
        const copy = (url: string) =>
          clipboard
            .write?.(url)
            .then(() => toast.show({ message: "分享链接已复制到剪贴板！", variant: "success" }))
            .catch(() => toast.show({ message: "复制链接到剪贴板失败", variant: "error" }))
        const url = session()?.share?.url
        if (url) {
          await copy(url)
          dialog.clear()
          return
        }
        if (!kv.get("share_consent", false)) {
          const ok = await DialogConfirm.show(dialog, "分享会话", "确定要分享吗？")
          if (ok !== true) return
          kv.set("share_consent", true)
        }
        await sdk.client.session
          .share({
            sessionID: route.sessionID,
          })
          .then((res) => copy(res.data!.share!.url))
          .catch((error) => {
            toast.show({
              message: error instanceof Error ? error.message : "分享会话失败",
              variant: "error",
            })
          })
        dialog.clear()
      },
    },
    {
      title: "重命名会话",
      value: "session.rename",
      category: "会话",
      slash: {
        name: "rename",
      },
      run: () => {
        dialog.replace(() => <DialogSessionRename session={route.sessionID} />)
      },
    },
    {
      title: "跳转到消息",
      value: "session.timeline",
      category: "会话",
      slash: {
        name: "timeline",
      },
      run: () => {
        dialog.replace(() => (
          <DialogTimeline
            onMove={(messageID) => {
              scrollTo((target) => {
                const child = target.getChildren().find((c) => c.id === messageID)
                if (child) target.scrollBy(child.y - target.y - 1)
              })
            }}
            sessionID={route.sessionID}
            setPrompt={(promptInfo) => prompt?.set(promptInfo)}
          />
        ))
      },
    },
    {
      title: "分叉会话",
      value: "session.fork",
      category: "会话",
      slash: {
        name: "fork",
      },
      run: () => {
        dialog.replace(() => (
          <DialogForkFromTimeline
            onMove={(messageID) => {
              if (!messageID) return
              scrollTo((target) => {
                const child = target.getChildren().find((c) => c.id === messageID)
                if (child) target.scrollBy(child.y - target.y - 1)
              })
            }}
            sessionID={route.sessionID}
          />
        ))
      },
    },
    {
      title: "压缩会话",
      value: "session.compact",
      category: "会话",
      slash: {
        name: "compact",
        aliases: ["summarize"],
      },
      run: () => {
        const selectedModel = local.model.current()
        if (!selectedModel) {
          toast.show({
            variant: "warning",
            message: "请连接提供商以压缩此会话",
            duration: 3000,
          })
          return
        }
        void sdk.client.session.summarize({
          sessionID: route.sessionID,
          modelID: selectedModel.modelID,
          providerID: selectedModel.providerID,
        })
        dialog.clear()
      },
    },
    {
      title: "取消分享会话",
      value: "session.unshare",
      category: "会话",
      enabled: !!session()?.share?.url,
      slash: {
        name: "unshare",
      },
      run: async () => {
        await sdk.client.session
          .unshare({
            sessionID: route.sessionID,
          })
          .then(() => toast.show({ message: "会话已成功取消分享", variant: "success" }))
          .catch((error) => {
            toast.show({
              message: error instanceof Error ? error.message : "取消分享会话失败",
              variant: "error",
            })
          })
        dialog.clear()
      },
    },
    {
      title: "撤销上一条消息",
      value: "session.undo",
      category: "会话",
      slash: {
        name: "undo",
      },
      run: async () => {
        const status = sync.data.session_status?.[route.sessionID]
        if (status?.type !== "idle") await sdk.client.session.abort({ sessionID: route.sessionID }).catch(() => {})
        const message = messagesBeforeRevert().findLast((item) => item.role === "user")
        if (!message) return
        void sdk.client.session
          .revert({
            sessionID: route.sessionID,
            messageID: message.id,
          })
          .then(() => {
            toBottom()
          })
        const parts = sync.data.part[message.id]
        prompt?.set(
          parts.reduce(
            (agg, part) => {
              if (part.type === "text") {
                if (!part.synthetic) agg.input += part.text
              }
              if (part.type === "file") agg.parts.push(part)
              return agg
            },
            { input: "", parts: [] as PromptInfo["parts"] },
          ),
        )
        dialog.clear()
      },
    },
    {
      title: "重做",
      value: "session.redo",
      category: "会话",
      enabled: !!session()?.revert?.messageID,
      slash: {
        name: "redo",
      },
      run: () => {
        dialog.clear()
        const messageID = session()?.revert?.messageID
        if (!messageID) return
        const message = messages().find((x) => x.role === "user" && x.id > messageID)
        if (!message) {
          void sdk.client.session.unrevert({
            sessionID: route.sessionID,
          })
          prompt?.set({ input: "", parts: [] })
          return
        }
        void sdk.client.session.revert({
          sessionID: route.sessionID,
          messageID: message.id,
        })
      },
    },
    {
      title: sidebarVisible() ? "隐藏侧边栏" : "显示侧边栏",
      value: "session.sidebar.toggle",
      category: "会话",
      run: () => {
        batch(() => {
          const isVisible = sidebarVisible()
          setSidebar(() => (isVisible ? "hide" : "auto"))
          setSidebarOpen(!isVisible)
        })
        dialog.clear()
      },
    },
    // 侧栏面板切换原来只有 onMouseUp 一条路,标签行一旦没画出来就彻底切不动了。
    // 这里补上命令入口:ctrl+p 里能搜到,/ 面板里也能打出来,不用依赖能点到那一行。
    {
      title: "侧边栏:切换到下一个面板",
      value: "session.sidebar.cycle",
      category: "会话",
      slash: {
        name: "sidebar",
        aliases: ["侧边栏"],
      },
      run: () => {
        showSidebar()
        cycleSidebarTab()
        dialog.clear()
      },
    },
    ...SIDEBAR_TABS.map((tab) => ({
      title: `侧边栏:${tab.text}`,
      value: `session.sidebar.${tab.id}`,
      category: "会话",
      run: () => {
        showSidebar()
        setSidebarTab(tab.id)
        dialog.clear()
      },
    })),
    {
      title: conceal() ? "禁用代码隐藏" : "启用代码隐藏",
      value: "session.toggle.conceal",
      category: "会话",
      run: () => {
        setConceal((prev) => !prev)
        dialog.clear()
      },
    },
    {
      // 旗标语义已经收敛成「用户消息的整条 meta 行」(见 userMetaVisible),所以标题跟着改成
      // meta 行的说法 —— 命令名/斜杠名保持 timestamps 不变,别让老用户的肌肉记忆与 keybind 配置失效。
      title: showUserMeta() ? "隐藏用户消息 meta 行" : "显示用户消息 meta 行",
      value: "session.toggle.timestamps",
      category: "会话",
      slash: {
        name: "timestamps",
        aliases: ["toggle-timestamps"],
      },
      run: () => {
        setTimestamps((prev) => (prev === "show" ? "hide" : "show"))
        dialog.clear()
      },
    },
    {
      title: (() => {
        const next = nextThinkingMode(thinkingMode())
        if (next === "hide") return "折叠思考过程"
        return "展开思考过程"
      })(),
      value: "session.toggle.thinking",
      category: "会话",
      slash: {
        name: "thinking",
        aliases: ["toggle-thinking"],
      },
      run: () => {
        thinking.set(nextThinkingMode(thinkingMode()))
        dialog.clear()
      },
    },
    {
      title: showDetails() ? "隐藏工具详情" : "显示工具详情",
      value: "session.toggle.actions",
      category: "会话",
      run: () => {
        setShowDetails((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: "切换会话滚动条",
      value: "session.toggle.scrollbar",
      category: "会话",
      run: () => {
        setShowScrollbar((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: showGenericToolOutput() ? "隐藏通用工具输出" : "显示通用工具输出",
      value: "session.toggle.generic_tool_output",
      category: "会话",
      run: () => {
        setShowGenericToolOutput((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: "向上翻页",
      value: "session.page.up",
      category: "会话",
      hidden: true,
      run: withScroll((target) => target.scrollBy(-target.height / 2)),
    },
    {
      title: "向下翻页",
      value: "session.page.down",
      category: "会话",
      hidden: true,
      run: withScroll((target) => target.scrollBy(target.height / 2)),
    },
    {
      title: "向上滚动一行",
      value: "session.line.up",
      category: "会话",
      hidden: true,
      run: withScroll((target) => target.scrollBy(-1)),
    },
    {
      title: "向下滚动一行",
      value: "session.line.down",
      category: "会话",
      hidden: true,
      run: withScroll((target) => target.scrollBy(1)),
    },
    {
      title: "向上翻半页",
      value: "session.half.page.up",
      category: "会话",
      hidden: true,
      run: withScroll((target) => target.scrollBy(-target.height / 4)),
    },
    {
      title: "向下翻半页",
      value: "session.half.page.down",
      category: "会话",
      hidden: true,
      run: withScroll((target) => target.scrollBy(target.height / 4)),
    },
    // 横向滚动这一族:流程图画布按**内容**宽度排布之后,横向可以比视口宽
    // (两列行带 75 列,而视口落在 44~73 列那一档时装不下,见 component/flow/layout 的
    // MIN_BAND_COLUMNS)。竖滚动条只管纵向,所以右边那一截得有一条命令够得着。
    // 气泡视图没有横向溢出(内容宽度 ≤ 视口),`scrollBy({x, y: 0})` 在那里自然不动。
    {
      title: "向左翻半页",
      value: "session.scroll.left",
      category: "会话",
      hidden: true,
      run: withScroll((target) => target.scrollBy({ x: -target.viewport.width / 2, y: 0 })),
    },
    {
      title: "向右翻半页",
      value: "session.scroll.right",
      category: "会话",
      hidden: true,
      run: withScroll((target) => target.scrollBy({ x: target.viewport.width / 2, y: 0 })),
    },
    {
      title: "第一条消息",
      value: "session.first",
      category: "会话",
      hidden: true,
      // `{x: 0, y: 0}` 而不是 `scrollTo(0)`:「回到开头」在流程图上也意味着回到左沿 ——
      // 横向滚到右边之后只把纵向归零,右边那一截仍然看不见。
      run: withScroll((target) => target.scrollTo({ x: 0, y: 0 })),
    },
    {
      title: "最后一条消息",
      value: "session.last",
      category: "会话",
      hidden: true,
      run: withScroll((target) => target.scrollTo({ x: 0, y: target.scrollHeight })),
    },
    {
      title: "跳转到最近的用户消息",
      value: "session.messages_last_user",
      category: "会话",
      hidden: true,
      run: () => {
        const messages = sync.data.message[route.sessionID]
        if (!messages || !messages.length) return

        // Find the most recent user message with non-ignored, non-synthetic text parts
        for (let i = messages.length - 1; i >= 0; i--) {
          const message = messages[i]
          if (!message || message.role !== "user") continue

          const parts = sync.data.part[message.id]
          if (!parts || !Array.isArray(parts)) continue

          const hasValidTextPart = parts.some(
            (part) => part && part.type === "text" && !part.synthetic && !part.ignored,
          )

          if (hasValidTextPart) {
            scrollTo((target) => {
              const child = target.getChildren().find((c) => c.id === message.id)
              if (child) target.scrollBy(child.y - target.y - 1)
            })
            break
          }
        }
      },
    },
    {
      title: "下一条消息",
      value: "session.message.next",
      category: "会话",
      hidden: true,
      run: () => scrollToMessage("next", dialog),
    },
    {
      title: "上一条消息",
      value: "session.message.previous",
      category: "会话",
      hidden: true,
      run: () => scrollToMessage("prev", dialog),
    },
    {
      title: "复制最后一条助手消息",
      value: "messages.copy",
      category: "会话",
      run: () => {
        const lastAssistantMessage = messagesBeforeRevert().findLast((message) => message.role === "assistant")
        if (!lastAssistantMessage) {
          toast.show({ message: "未找到助手消息", variant: "error" })
          dialog.clear()
          return
        }

        const parts = sync.data.part[lastAssistantMessage.id] ?? []
        const textParts = parts.filter((part) => part.type === "text")
        if (textParts.length === 0) {
          toast.show({ message: "在最后的助手消息中未找到文本部分", variant: "error" })
          dialog.clear()
          return
        }

        const text = textParts
          .map((part) => part.text)
          .join("\n")
          .trim()
        if (!text) {
          toast.show({
            message: "未找到最后一条助手消息的文本内容",
            variant: "error",
          })
          dialog.clear()
          return
        }

        clipboard
          .write?.(text)
          .then(() => toast.show({ message: "消息已复制到剪贴板！", variant: "success" }))
          .catch(() => toast.show({ message: "复制到剪贴板失败", variant: "error" }))
        dialog.clear()
      },
    },
    {
      title: "复制会话记录",
      value: "session.copy",
      category: "会话",
      slash: {
        name: "copy",
      },
      run: async () => {
        try {
          const sessionData = session()
          if (!sessionData) return
          const sessionMessages = messages()
          const transcript = formatTranscript(
            sessionData,
            sessionMessages.map((msg) => ({ info: msg, parts: sync.data.part[msg.id] ?? [] })),
            {
              thinking: showThinking(),
              toolDetails: showDetails(),
              assistantMetadata: showAssistantMetadata(),
              providers: sync.data.provider,
            },
          )
          await clipboard.write?.(transcript)
          toast.show({ message: "会话记录已复制到剪贴板！", variant: "success" })
        } catch {
          toast.show({ message: "复制会话记录失败", variant: "error" })
        }
        dialog.clear()
      },
    },
    {
      title: "导出会话记录",
      value: "session.export",
      category: "会话",
      slash: {
        name: "export",
      },
      run: async () => {
        try {
          const sessionData = session()
          if (!sessionData) return
          const sessionMessages = messages()

          const defaultFilename = `session-${sessionData.id.slice(0, 8)}.md`

          const options = await DialogExportOptions.show(
            dialog,
            defaultFilename,
            showThinking(),
            showDetails(),
            showAssistantMetadata(),
            false,
          )

          if (options === null) return

          const transcript = formatTranscript(
            sessionData,
            sessionMessages.map((msg) => ({ info: msg, parts: sync.data.part[msg.id] ?? [] })),
            {
              thinking: options.thinking,
              toolDetails: options.toolDetails,
              assistantMetadata: options.assistantMetadata,
              providers: sync.data.provider,
            },
          )

          if (options.openWithoutSaving) {
            // Just open in editor without saving
            await openEditor({
              renderer,
              value: transcript,
              cwd:
                (project.instance.path().worktree === "/" ? undefined : project.instance.path().worktree) ||
                project.instance.directory() ||
                paths.cwd,
            })
          } else {
            const exportDir = paths.cwd
            const filename = options.filename.trim()
            const filepath = path.join(exportDir, filename)

            await writeExport(filepath, transcript)

            // Open with EDITOR if available
            const result = await openEditor({
              renderer,
              value: transcript,
              cwd:
                (project.instance.path().worktree === "/" ? undefined : project.instance.path().worktree) ||
                project.instance.directory() ||
                paths.cwd,
            })
            if (result !== undefined) {
              await writeExport(filepath, result)
            }

            toast.show({ message: `Session exported to ${filename}`, variant: "success" })
          }
        } catch {
          toast.show({ message: "导出会话失败", variant: "error" })
        }
        dialog.clear()
      },
    },
    {
      title: "后台子代理",
      value: "session.background",
      category: "会话",
      hidden: true,
      enabled: foregroundTasks().length > 0,
      run: () => {
        void sdk.client.experimental.session.background({
          sessionID: route.sessionID,
          workspace: project.workspace.current(),
        })
        dialog.clear()
      },
    },
    {
      title: queueStore.items.length > 0 ? `排队消息 (${queueStore.items.length})` : "排队消息",
      value: "session.queued_prompts",
      category: "会话",
      hidden: true,
      enabled: queueStore.items.length > 0,
      run: () => {
        setQueueCollapsed((v) => !v)
        dialog.clear()
      },
    },
    {
      title: "转到子会话",
      value: "session.child.first",
      category: "会话",
      hidden: true,
      run: () => {
        dialog.clear()
        moveFirstChild()
      },
    },
    {
      title: "转到父会话",
      value: "session.parent",
      category: "会话",
      hidden: true,
      enabled: !!session()?.parentID,
      run: childSessionHandler(() => {
        const parentID = session()?.parentID
        if (parentID) {
          navigate({
            type: "session",
            sessionID: parentID,
          })
        }
        dialog.clear()
      }),
    },
    {
      title: "下一个子会话",
      value: "session.child.next",
      category: "会话",
      hidden: true,
      enabled: !!session()?.parentID,
      run: childSessionHandler(() => {
        dialog.clear()
        moveChild(1)
      }),
    },
    {
      title: "上一个子会话",
      value: "session.child.previous",
      category: "会话",
      hidden: true,
      enabled: !!session()?.parentID,
      run: childSessionHandler(() => {
        dialog.clear()
        moveChild(-1)
      }),
    },
    {
      title: `${icon("memory")} 记忆审查`,
      value: "memory.review",
      category: "记忆",
      slash: {
        name: "memory",
      },
      run: async () => {
        const { DialogMemoryReview } = await import("./dialog-memory-review")
        dialog.replace(() => <DialogMemoryReview sessionID={route.sessionID} />)
      },
    },
    {
      title: `${icon("evolution")} 进化审查`,
      value: "evolution.review",
      category: "进化",
      slash: {
        name: "evolution",
      },
      run: async () => {
        const { DialogEvolutionReview } = await import("./dialog-evolution-review")
        dialog.replace(() => <DialogEvolutionReview sessionID={route.sessionID} />)
      },
    },
    // /图标 与 /后台并行子代理 是全局设置,已挪到 app.tsx 的全局命令表,
    // 这样在首页(还没进会话)按 / 也能找到,不会"命令不见了"。
  ])

  const sessionCommands = createMemo(() =>
    sessionCommandList().map((command) => ({
      namespace: "palette",
      name: command.value,
      desc: "description" in command ? command.description : undefined,
      slashName: "slash" in command ? command.slash?.name : undefined,
      slashAliases: "slash" in command ? command.slash?.aliases : undefined,
      ...command,
    })),
  )

  useBindings(() => ({
    commands: sessionCommands(),
  }))

  useBindings(() => ({
    bindings: tuiConfig.keybinds.gather("session.global", sessionGlobalBindingCommands),
  }))

  useBindings(() => ({
    enabled: () => renderer.currentFocusedEditor === null,
    bindings: tuiConfig.keybinds.gather("session.global.unfocused", sessionGlobalUnfocusedBindingCommands),
  }))

  useBindings(() => ({
    mode: NovaWay_BASE_MODE,
    bindings: tuiConfig.keybinds.gather("session", sessionBindingCommands),
  }))

  useBindings(() => ({
    mode: NovaWay_BASE_MODE,
    enabled: foregroundTasks().length > 0,
    priority: 1,
    bindings: tuiConfig.keybinds.get("session.background"),
  }))

  const revertInfo = createMemo(() => session()?.revert)
  const revertMessageID = createMemo(() => revertInfo()?.messageID)
  const revertMessageIndex = createMemo(() => {
    const messageID = revertMessageID()
    if (!messageID) return -1
    return messages().findIndex((message) => message.id === messageID)
  })

  const revertDiffFiles = createMemo(() => getRevertDiffFiles(revertInfo()?.diff ?? ""))

  const revertRevertedMessages = createMemo(() => {
    const messageID = revertMessageID()
    if (!messageID) return []
    const index = revertMessageIndex()
    if (index === -1) return []
    return messages()
      .slice(index)
      .filter((message) => message.role === "user")
  })

  const revert = createMemo(() => {
    const info = revertInfo()
    if (!info) return
    if (!info.messageID) return
    return {
      messageID: info.messageID,
      reverted: revertRevertedMessages(),
      diff: info.diff,
      diffFiles: revertDiffFiles(),
    }
  })

  // 消息窗口:先只从尾部挂载一段,滚到顶部再往前扩。
  // 同步上限是 100 条消息,但一条消息会展开成工具行 + markdown + 语法高亮,
  // 一口气全部挂载就是打开长会话、切换会话时那一下明显的卡顿。
  // 窗口状态放在组件里:Session 按 sessionID 重建,换会话自然回到初始窗口。
  const [messageWindowSize, setMessageWindow] = createSignal(MESSAGE_WINDOW_INITIAL)
  const visibleWindow = createMemo(() => messageWindow(messages().length, messageWindowSize()))
  const windowOffset = createMemo(() => visibleWindow().offset)
  const visibleMessages = createMemo(() => messages().slice(windowOffset()))
  const hiddenMessages = createMemo(() => visibleWindow().hidden)

  // 卡片阶梯入场的基线:Session 首次挂载时的消息 id 快照,之后只增不减。
  // 首挂载时消息通常还没从服务端回来,基线就是空的 —— 之后陆续到达的消息逐条领一个
  // 递增的入场延迟,正好就是「打开会话时消息流逐条亮起」;反过来,向上滚动补载的
  // 历史消息早就被记进基线,永远不会二次入场(这才是整屏闪烁的真正的来源)。
  //
  // `resetOn` 是**第二个**会重挂消息子树的通道,与窗口补载不同源:下面那两个
  // `Show when={chatView() ...}` 是当场销毁旧视图建新视图,`Show when={activeTabId() ===
  // "chat"}` 那一层(开文件标签页)同理。它们各自让整棵消息子树拿到全新的卡片实例,而
  // ui/card.ts 的「入场只播一次」是**按实例**记的 —— 不作废基线的话,切回气泡视图后
  // 整屏卡又会重播一遍 320ms + 150ms 的阶梯。理由与取舍见 ui/enter 的
  // createEnterBaselineStore。
  const enterBaseline = createEnterBaselineStore({
    known: () => messages().map((message) => message.id),
    resetOn: () => [chatView(), activeTabId()],
  })
  // animations_enabled 关掉时不传 enterDelay —— NeonBox 的约定是「不传即终态」,
  // 不留淡入残影。但基线照样要问:否则用户中途把动画打开时,这条消息会拿到一个
  // 「迟到」的入场延迟,凭空淡入一次。
  // 读的是本组件里那个**信号**版(animationsEnabled)而不是 kv.get:同一个 key 已经有信号了,
  // 两个访问器读同一个键必然漂 —— 响应式的那一份才能让「中途关掉动画」立刻掐掉淡入。
  const enterDelayFor = (messageID: string) => {
    const delay = enterBaseline().delayFor(messageID)
    return animationsEnabled() ? delay : undefined
  }

  // 信息页"消息"列表的跳转:切回聊天标签,必要时把消息窗口扩到包含目标,再滚过去。
  // 切标签会重建聊天区的滚动容器,所以带几次重试,等它挂载完成再定位。
  const jumpToMessage = (messageID: string) => {
    switchTab("chat")
    const index = messages().findIndex((m) => m.id === messageID)
    if (index === -1) return
    if (index < windowOffset()) {
      setMessageWindow(messages().length - index)
    }
    const tryScroll = (remaining: number) => {
      setTimeout(() => {
        if (!scroll || scroll.isDestroyed) return
        const child = scroll.getChildren().find((c) => c.id === messageID)
        if (child) {
          scroll.scrollBy(child.y - scroll.y - 1)
        } else if (remaining > 0) {
          tryScroll(remaining - 1)
        }
      }, 60)
    }
    tryScroll(4)
  }
  subscribeMessageJump(jumpToMessage)

  // 滚到顶时往前扩一段窗口。scrollTop 没有变化事件(opentui 的 ScrollBox 只暴露 getter),
  // 只能低频轮询;getter 就是读一个数,开销可忽略。
  // 扩完把滚动位置补回高度差,让正在看的那条消息不跳。
  // 冷却时间保证一次滚到顶不会连着扩好几段;而 messages() 本身被同步层封在 100 条以内,
  // 所以扩到 hiddenMessages() 为 0 就自然停下。
  const EXPAND_COOLDOWN = 400
  let lastExpand = 0
  onMount(() => {
    const timer = setInterval(() => {
      if (!scroll || scroll.isDestroyed) return
      if (scroll.scrollTop > 0) return
      if (hiddenMessages() === 0) return
      const now = Date.now()
      if (now - lastExpand < EXPAND_COOLDOWN) return
      lastExpand = now
      const before = scroll.scrollHeight
      setMessageWindow((size) => expandMessageWindow(size))
      setTimeout(() => {
        if (!scroll || scroll.isDestroyed) return
        scroll.scrollTop += scroll.scrollHeight - before
      }, 32)
    }, 150)
    onCleanup(() => clearInterval(timer))
  })

  // snap to bottom when session changes
  createEffect(on(() => route.sessionID, toBottom))

  return (
    <LocationProvider location={location()}>
      <context.Provider
        value={{
          get width() {
            return contentWidth()
          },
          sessionID: route.sessionID,
          conceal,
          thinkingMode,
          showThinking,
          showUserMeta,
          showDetails,
          showGenericToolOutput,
          diffWrapMode,
          chatView,
          providers,
          sync,
          tui: tuiConfig,
          enterDelayFor,
        }}
      >
        <box flexDirection="row" flexGrow={1} minHeight={0}>
          <Show when={sidebarVisible()}>
            <Switch>
              <Match when={wide()}>
                <Sidebar
                  sessionID={route.sessionID}
                  onFileSelect={(filePath) => openPreviewTab(filePath)}
                  onOpenDiff={(filePath) => openDiffTab(filePath)}
                  onOpenCommit={(hash) => openCommitTab(hash)}
                  onOpenGitWorkspace={openGitWorkspaceTab}
                  onFileDoubleClick={(filePath) => {
                    if (session()) {
                      const relativePath = path.relative(session()!.directory, filePath)
                      const ref = promptRef.current
                      if (ref) {
                        ref.insertText(`@${relativePath} `)
                        ref.focus()
                      }
                    }
                  }}
                />
              </Match>
              <Match when={!wide()}>
                <box
                  position="absolute"
                  top={0}
                  left={0}
                  right={0}
                  bottom={0}
                  alignItems="flex-start"
                  backgroundColor={RGBA.fromInts(0, 0, 0, 70)}
                >
                  <Sidebar
                    sessionID={route.sessionID}
                    onFileSelect={(filePath) => openPreviewTab(filePath)}
                    onOpenDiff={(filePath) => openDiffTab(filePath)}
                    onOpenCommit={(hash) => openCommitTab(hash)}
                    onOpenGitWorkspace={openGitWorkspaceTab}
                    onFileDoubleClick={(filePath) => {
                      if (session()) {
                        const relativePath = path.relative(session()!.directory, filePath)
                        const ref = promptRef.current
                        if (ref) {
                          ref.insertText(`@${relativePath} `)
                          ref.focus()
                        }
                      }
                    }}
                  />
                </box>
              </Match>
            </Switch>
          </Show>
          <box flexGrow={1} minHeight={0} flexDirection="column">
            {/* 右侧胶囊由会话页组装(用量、session 短 id 都是这一层的数据),TabBar 只负责摆位置
                并把「标签右侧还剩多少列」算出来。 */}
            <TabBar
              tabs={tabs()}
              activeTabId={activeTabId()}
              onTabClick={switchTab}
              onTabClose={closeTab}
              width={tabBarWidth()}
              pills={(available) => <PillRow width={available} pills={chatViewPills()} />}
            />
            <box flexGrow={1} minHeight={0} paddingBottom={1} paddingLeft={2} paddingRight={2} gap={1}>
              <Show when={activeTabId() === "chat"}>
                {/* 气泡 / 流程图两个视图由 ViewEntrance 包一层(任务 D4):它负责「换视图的那一拍
                    把新视图从下面 3 行、透明度 0 走回终态」——原型 viewIn 的 translateY(12px)
                    + opacity 的终端等价(px→行的换算见 view-entrance 的注释)。
                    视图的取舍留给这里的两个 Show:它们在条件翻转时**当场**销毁旧视图、建出新视图,
                    正是原型 off.remove('show') + on.add('show') 的语义,所以两个视图从不共存。
                    **重挂的这一层不只由视图切换触发**:标签切换(开文件标签页)也整层重建。
                    两者的入场动画都要作废重播 —— 卡片入场与视图入场在这一层是同一件事的两半,
                    原因见上面 enterBaseline 那段的注释。 */}
                <ViewEntrance view={chatView()} animate={animationsEnabled()}>
                  <Show when={chatView() === "flow"}>
                    {/* 流程图视图:节点链画布。数据直接取会话自己的同步数据(消息 + part),
                        不另存一份中间态。 */}
                    <FlowCanvas
                      messages={messages()}
                      parts={sync.data.part}
                      onScrollBox={(box) => (flowScroll = box)}
                    />
                  </Show>
                  <Show when={chatView() !== "flow"}>
                    {/* **原型 card-design-v7.html:1221 的滚动落点已经由下面这两个 prop 天然满足**:
                        `chat.scrollTop = v === "flow" ? 0 : chat.scrollHeight` ——
                        切到流程图看顶部、切回气泡看底部(最新消息)。所以这里**刻意不加**任何
                        「切视图时手动 scrollTo」的逻辑,加了就是第二套真相:
                          · 气泡视图:opentui 在 scrollbox 的 viewport 尺寸落定那一次
                            recalculateBarProps() 里会 applyStickyStart("bottom"),把位置压到
                            scrollHeight − viewport.height。视图切换是这两个 `<Show>` 当场销毁旧
                            建新,拿到的正是一个**全新**的 scrollbox 实例(_hasManualScroll = false),
                            所以「切回来必然贴着最新一条」是 stickyScroll 的固有行为。
                          · 流程图视图:画布那个 scrollbox(component/flow/canvas.tsx)**不带**
                            stickyScroll,天生停在 scrollTop = 0。
                        回归见 test/routes/session/chat-view-scroll.test.tsx —— 它同时覆盖
                        「播入场」与「不播入场」两种情况:入场期间整棵子树被 opacity 压暗,
                        前几帧画面是空的,但**布局高度不变**(ViewEntrance 动的是相对位移与
                        opacity,不是尺寸),所以贴底的时机不需要等动画走完。 */}
                    <scrollbox
                      ref={(r) => (scroll = r)}
                      viewportOptions={{
                        paddingRight: showScrollbar() ? 1 : 0,
                      }}
                      verticalScrollbarOptions={{
                        paddingLeft: 1,
                        visible: showScrollbar(),
                        trackOptions: {
                          backgroundColor: theme.backgroundElement,
                          foregroundColor: theme.border,
                        },
                      }}
                      stickyScroll={true}
                      stickyStart="bottom"
                      flexGrow={1}
                      scrollAcceleration={scrollAcceleration()}
                    >
                      <box height={1} />
                      {/* 空会话的首屏:Logo + 智能体特征行 + 快捷键提示(和首页首屏共用同一块) */}
                      <Show when={messages().length === 0 && !pending()}>
                        <EmptySessionHero />
                      </Show>
                      {/* 顶部还有没挂载的历史时给一行提示,滚到顶会自动往前扩 */}
                      <Show when={hiddenMessages() > 0}>
                        <box paddingLeft={3} flexShrink={0}>
                          <text fg={theme.textMuted}>上方还有 {hiddenMessages()} 条历史消息,滚到顶自动加载</text>
                        </box>
                      </Show>
                      <For each={visibleMessages()}>
                        {(message, localIndex) => {
                          // index 是**全量**下标:pending()/revertMessageIndex() 都是按 messages() 算的
                          const index = () => windowOffset() + localIndex()
                          return (
                            <Switch>
                              <Match when={message.id === revert()?.messageID}>
                                {(function () {
                                  const redoShortcut = useCommandShortcut("session.redo")
                                  const [hover, setHover] = createSignal(false)
                                  const dialog = useDialog()

                                  const handleUnrevert = async () => {
                                    const confirmed = await DialogConfirm.show(
                                      dialog,
                                      "确认重做",
                                      "确定要恢复已撤销的消息吗?",
                                    )
                                    if (confirmed) {
                                      keymap.dispatchCommand("session.redo")
                                    }
                                  }

                                  return (
                                    <box
                                      onMouseOver={() => setHover(true)}
                                      onMouseOut={() => setHover(false)}
                                      onMouseUp={handleUnrevert}
                                      marginTop={1}
                                      flexShrink={0}
                                      border={["left"]}
                                      customBorderChars={SplitBorder.customBorderChars}
                                      borderColor={theme.backgroundPanel}
                                    >
                                      <box
                                        paddingTop={1}
                                        paddingBottom={1}
                                        paddingLeft={2}
                                        backgroundColor={hover() ? theme.backgroundElement : theme.backgroundPanel}
                                      >
                                        <text fg={theme.textMuted}>已撤销 {revert()!.reverted.length} 条消息</text>
                                        <text fg={theme.textMuted}>
                                          <span style={{ fg: theme.text }}>{redoShortcut()}</span> 或 /redo 恢复
                                        </text>
                                        <Show when={revert()!.diffFiles?.length}>
                                          <box marginTop={1}>
                                            <DiffStatList
                                              files={revert()!.diffFiles!.map((file) => ({
                                                file: file.filename,
                                                additions: file.additions,
                                                deletions: file.deletions,
                                              }))}
                                            />
                                          </box>
                                        </Show>
                                      </box>
                                    </box>
                                  )
                                })()}
                              </Match>
                              <Match
                                when={
                                  revert()?.messageID && revertMessageIndex() !== -1 && index() >= revertMessageIndex()
                                }
                              >
                                <></>
                              </Match>
                              <Match when={message.role === "user"}>
                                <UserMessage
                                  index={index()}
                                  onMouseUp={() => {
                                    if (renderer.getSelection()?.getSelectedText()) return
                                    dialog.replace(() => (
                                      <DialogMessage
                                        messageID={message.id}
                                        sessionID={route.sessionID}
                                        setPrompt={(promptInfo) => prompt?.set(promptInfo)}
                                      />
                                    ))
                                  }}
                                  message={message as UserMessage}
                                  parts={sync.data.part[message.id] ?? []}
                                />
                              </Match>
                              <Match when={message.role === "assistant"}>
                                <AssistantMessage
                                  last={lastAssistant()?.id === message.id}
                                  message={message as AssistantMessage}
                                  parts={sync.data.part[message.id] ?? []}
                                />
                              </Match>
                            </Switch>
                          )
                        }}
                      </For>
                      {/* crush 式「正在干活」指示:消息流末尾挂一条标题行 + 一条主题双色扰动动画。
                        标题行的目标与动词由**最后一条助手消息的 part** 判定(判定规则见 thinking-step.ts),
                        已用时长右对齐;噪声流那一行仍按思考/回答给阶段标签。随会话状态自动出现/消失。 */}
                      <Show when={sessionWorking()}>
                        <WorkingLine
                          sessionID={route.sessionID}
                          thinking={thinkingActive()}
                          parts={sync.data.part[lastAssistant()?.id ?? ""] ?? []}
                          ctxWidth={contentWidth()}
                        />
                      </Show>
                    </scrollbox>
                  </Show>
                </ViewEntrance>
              </Show>
              {/* git-workspace 没有 filePath 也没有 commitHash,由下面单独一路渲染;selectedFile
                  可能残留着上一个文件标签的路径(switchTab 对没有 filePath 的标签不改
                  selectedFile),不挡掉就会把 FilePreview 和工作区叠着渲。 */}
              <Show
                when={
                  activeTabId() !== "chat" &&
                  activeTab()?.type !== "git-workspace" &&
                  (selectedFile() || activeTab()?.commitHash)
                }
              >
                {/* 按标签类型分发:preview = 整文件编辑,git-diff = 该文件相对 HEAD 的改动差异,
                    commit-detail = 该提交的元信息 + --stat 清单(它没有 filePath,看的是 hash)。 */}
                <Switch>
                  <Match when={activeTab()?.type === "commit-detail"}>
                    <GitCommitView
                      commitHash={activeTab()!.commitHash!}
                      rootPath={session()?.directory}
                      onClose={() => closeTab(activeTabId())}
                    />
                  </Match>
                  <Match when={activeTab()?.type === "git-diff"}>
                    <GitDiffView
                      filePath={selectedFile()!}
                      rootPath={session()?.directory}
                      onClose={() => closeTab(activeTabId())}
                    />
                  </Match>
                  <Match when>
                    <FilePreview filePath={selectedFile()!} onClose={() => closeTab(activeTabId())} />
                  </Match>
                </Switch>
              </Show>
              {/* 工作区标签自己单开一路:整屏双栏,id 固定,见 openGitWorkspaceTab。 */}
              <Show when={activeTab()?.type === "git-workspace"}>
                <GitWorkspace
                  rootPath={session()?.directory}
                  onClose={() => closeTab("git-workspace")}
                  width={contentWidth()}
                />
              </Show>
              <Show when={activeTabId() === "chat"}>
                <box flexShrink={0}>
                  <Show when={permissions().length > 0}>
                    <PermissionPrompt
                      request={permissions()[0]}
                      directory={sync.session.get(permissions()[0].sessionID)?.directory}
                    />
                  </Show>
                  <Show when={permissions().length === 0 && questions().length > 0}>
                    <QuestionPrompt
                      request={questions()[0]}
                      directory={sync.session.get(questions()[0].sessionID)?.directory}
                    />
                  </Show>
                  <Show when={session()?.parentID}>
                    <SubagentFooter />
                  </Show>
                  <Show when={queueStore.items.length > 0}>
                    <QueueDock
                      items={queueStore.items}
                      sending={queueStore.sending}
                      collapsed={queueCollapsed()}
                      onToggle={() => setQueueCollapsed((v) => !v)}
                      onSend={(id) => {
                        const item = queueStore.items.find((x) => x.id === id)
                        if (!item || queueStore.sending) return
                        setQueueStore("items", (items) => items.filter((x) => x.id !== id))
                        void sendQueueItem(item)
                      }}
                      onEdit={(id) => {
                        const item = queueStore.items.find((x) => x.id === id)
                        if (!item) return
                        setQueueStore("items", (items) => items.filter((x) => x.id !== id))
                        prompt?.set({
                          input: item.inputText,
                          parts: item.nonTextParts,
                        })
                      }}
                      onDelete={(id) => {
                        setQueueStore("items", (items) => items.filter((x) => x.id !== id))
                      }}
                      onClearAll={() => {
                        setQueueStore("items", [])
                      }}
                    />
                  </Show>
                  {/* 底栏(原型 card-design-v7.html 的 `.footer`):一行低调的小字,左组目录 /
                      LSP / MCP / 权限,右组分支 / 编码 / 品牌+版本。
                      放在 Prompt **上方**而不是下面:输入卡自己已经带一行状态行(完整目录路径 +
                      token 花费),底栏若紧贴在它下面,屏幕上就是两条连续的暗色小字行、彼此没有
                      分隔;放在上面则由输入卡的霓虹上边框把两组信息分开。宽度传 contentWidth()
                      (已扣掉侧栏与主区 padding 的净值),底栏不再重复扣。 */}
                  <Footer width={contentWidth()} />
                  <Show when={visible()}>
                    <pluginRuntime.Slot
                      name="session_prompt"
                      mode="replace"
                      session_id={route.sessionID}
                      visible={visible()}
                      disabled={disabled()}
                      on_submit={toBottom}
                      ref={bind}
                    >
                      <Prompt
                        visible={visible()}
                        ref={bind}
                        disabled={disabled()}
                        onSubmit={() => {
                          toBottom()
                        }}
                        sessionID={route.sessionID}
                        shouldQueue={() => sessionWorking() && !disabled() && !session()?.parentID}
                        onQueue={(draft) => {
                          setQueueStore("items", (items) => [...items, draft])
                          setQueueStore("failed", undefined)
                          setQueueCollapsed(() => false)
                        }}
                        right={<pluginRuntime.Slot name="session_prompt_right" session_id={route.sessionID} />}
                        placeholders={SESSION_PLACEHOLDERS}
                        onLocalCommand={onLocalCommand}
                      />
                    </pluginRuntime.Slot>
                  </Show>
                </box>
              </Show>
              <Toast />
            </box>
          </box>
        </box>
      </context.Provider>
    </LocationProvider>
  )
}

function UserMessage(props: { message: UserMessage; parts: Part[]; onMouseUp: () => void; index: number }) {
  const ctx = use()
  const text = createMemo(() => {
    const texts = props.parts
      .map((x) => {
        if (x.type === "text" && !x.synthetic) {
          return x.text
        }
        return null
      })
      .filter(Boolean)
    return texts.join("\n\n")
  })
  const files = createMemo(() => props.parts.flatMap((x) => (x.type === "file" ? [x] : [])))
  const { theme } = useTheme()
  // hover 的事件挂在外层盒子上(那一层是消息占位,内层气泡比它窄,靠右),而描边在内层卡上。
  // useCardHover 返回的是一组接线而不是「一个布尔」,所以同一个 signal 能同时喂给外层的
  // onMouseOver/onMouseOut 与内层的 animated/boost —— 不需要再往里传一遍 hover 状态。
  const hover = useCardHover()

  const compaction = createMemo(() => props.parts.find((x) => x.type === "compaction"))

  return (
    <>
      <Show when={text()}>
        {/* crush 式用户气泡:霓虹渐变描边卡片,靠右对齐;悬停提亮底色 + 描边流动与提亮。
            外层是消息锚点:那个 id 是消息跳转(跳到消息 / 上一条下一条)唯一的抓手,
            而那些查找要的是 scrollbox 的**直接子节点** —— 所以锚点必须是这一层,不能往里挪。 */}
        <MessageAnchor
          messageID={props.message.id}
          marginTop={props.index === 0 ? 0 : 1}
          /* alignSelf="flex-end" 是**右缘贴面板**的那一步,不是装饰。
             锚点有 width="100%" + maxWidth=78%,而 scrollbox 的 alignItems 是默认的 stretch ——
             没有 alignSelf 时,那个 78% 的盒子停在**左**边:锚点占 0..78%,里面的
             alignItems="flex-end" 只能把气泡推到「78% 带的右缘」,于是整屏右侧空出 22% 的死带,
             而用户那条是**右对齐**消息,按原型本该贴面板右缘(用户原话:「右边就右边框对齐」)。
             加上它之后,锚点自己被摆到交叉轴末端:带子整体右移,气泡与 meta 的右缘 = 整列右缘,
             而 78% 那道上限仍然生效(长文本在带内折行,不会撑满整列)。
             助手那条不加 —— 它是 flex-start,左边本来就是面板左缘(原型 :396 两个方向相反)。 */
          alignSelf="flex-end"
          /* alignItems="flex-end" 管的是**锚点的子元素**要不要被拉伸,与上面那个 alignSelf
             (管锚点自己摆在哪)是两回事,少一个就出一种毛病:
             · 少 alignSelf → 锚点停在左边,气泡只贴到 78% 带的右缘,右侧空出 22% 死带;
             · 少 alignItems → 锚点默认 stretch,气泡被拉满整条带,只有里面文字右对齐,
               看着就是一个装着一小截文字的宽盒子(用户原话:「应该根据文字内容自适应气泡大小和宽度」)。
             两个都要有:带子贴右 + 气泡按内容收缩、右缘落在带子右缘上。 */
          alignItems="flex-end"
          width="100%"
          onMouseOver={hover.onMouseOver}
          onMouseOut={hover.onMouseOut}
        >
          {/* meta 行(时间 + 「你」):贴在气泡卡**外面**的上一行,与助手卡的三明治结构对称。
              **右对齐**,与气泡卡同一条右缘 —— 原型的 `.msg.user` 是
              `align-self: flex-end; align-items: flex-end`(card-design-v7.html:395),
              所以 meta 与气泡是同一个 flex 列里同样靠右的两块,右缘严格对齐(:917-920)。
              之前这一行是**左**对齐的(盒子撑满整列、文字从左缘起),于是 `21:55 你` 贴在最左、
              气泡贴在最右,两者看着毫无关系 —— 用户原话:「时间和气泡分到了两边」。
              右对齐由 UserMeta 内部的 `justifyContent="flex-end"` 给(为什么不是把这里改成
              `alignSelf="flex-end"`,见 UserMeta 那段注释);**这个盒子仍然撑满消息列**,因为
              按内容收窄会让这一行没有高度。
              助手那条保持左对齐(原型的 `.msg.assistant` 是 `align-self: flex-start`,:396),
              所以两条 meta 的对齐方向本来就是相反的。
              放在带 id 的这个盒子里而不是它外面:消息跳转(跳到消息 / 上一条下一条)是按 scrollbox
              **直接子节点**的 id 查的,多一个兄弟节点就多一份要一起算的间距。 */}
          <Show when={ctx.showUserMeta()}>
            <box alignSelf="stretch" flexShrink={0}>
              <UserMeta created={props.message.time.created} />
            </box>
          </Show>
          <neonbox
            onMouseUp={props.onMouseUp}
            gradientStops={neonStops(theme)}
            backgroundColor={hover.hover() ? theme.backgroundElement : theme.backgroundPanel}
            /* 这张卡有自己的 backgroundColor,所以不传 enterFrom:淡入的起点色就是它的底色
               (ui/card.ts 的 enterFrom 默认取 backgroundColor)。 */
            enterDelay={ctx.enterDelayFor(props.message.id)}
            animated={hover.animated()}
            boost={hover.boost(theme.text)}
            paddingTop={1}
            paddingBottom={1}
            paddingLeft={2}
            paddingRight={2}
            flexShrink={0}
            alignItems="flex-end"
          >
            {/* 气泡靠右:外层 alignItems="flex-end" 把气泡推到**锚点**的右缘,内层同样右对齐
                让附件跟着靠右;而锚点自己由上一步的 alignSelf="flex-end" 贴在面板右缘 ——
                两者叠起来才是「右对齐消息贴面板右边框」,而不是「贴 78% 带的右缘」。
                宽度上限在消息锚点上(MessageAnchor 的 MESSAGE_MAX_WIDTH,原型的
                `.msg { max-width: 78% }`),**不再**是这一层自己的 70% —— 两个方向共用一个上限,
                用户那条与助手那条才会是同一套尺寸;而挂在气泡上的话,卡外的 meta 行仍然按整列
                排,「时间和气泡分到了两边」又回来了。
                这里的 text 不能再写 width="100%" —— 那会把气泡撑满锚点,右对齐就失效;
                去掉后气泡按文字自然宽度收缩,长文本到带子右缘(= 面板右缘)才折行。 */}
            <text fg={theme.text}>{text()}</text>
            <Show when={files().length}>
              <box flexDirection="row" paddingTop={1} gap={1} flexWrap="wrap">
                <For each={files()}>
                  {(file) => {
                    const directory = file.mime === "application/x-directory"
                    return (
                      <text fg={theme.text}>
                        <span style={{ bg: theme.secondary, fg: theme.background }}>
                          {directory ? " Directory " : " File "}
                        </span>
                        <span style={{ bg: theme.backgroundElement, fg: theme.textMuted }}> {file.filename} </span>
                      </text>
                    )
                  }}
                </For>
              </box>
            </Show>
          </neonbox>
        </MessageAnchor>
      </Show>
      <Show when={compaction()}>
        <box marginTop={1} border={["top"]} title=" 压缩 " titleAlignment="center" borderColor={theme.borderActive} />
      </Show>
    </>
  )
}

function AssistantMessage(props: { message: AssistantMessage; parts: Part[]; last: boolean }) {
  const ctx = use()
  const local = useLocal()
  const { theme } = useTheme()
  const sync = useSync()
  const messages = createMemo(() => sync.data.message[props.message.sessionID] ?? [])
  const model = createMemo(() => Model.name(ctx.providers(), props.message.providerID, props.message.modelID))

  const final = createMemo(() => {
    return props.message.finish && !["tool-calls", "unknown"].includes(props.message.finish)
  })

  const duration = createMemo(() => {
    if (!final()) return 0
    if (!props.message.time.completed) return 0
    const user = messages().find((x) => x.role === "user" && x.id === props.message.parentID)
    if (!user || !user.time) return 0
    return props.message.time.completed - user.time.created
  })

  const childShortcut = useCommandShortcut("session.child.first")
  const backgroundShortcut = useCommandShortcut("session.background")

  // 本轮改了哪些文件。服务端每轮结束都会把该轮的 diff 写在**父用户消息**的 summary.diffs 上
  // (packages/novaway/src/session/summary.ts:120-127,每轮由 processor.ts 触发),
  // 这里只负责显示,不自己去算,也不去解析补丁文本。
  const turnDiffs = createMemo(() => {
    const user = messages().find((x) => x.role === "user" && x.id === props.message.parentID)
    return uniqueDiffStats(user?.role === "user" ? user.summary?.diffs : undefined)
  })
  const turnAdditions = createMemo(() => turnDiffs().reduce((sum, x) => sum + x.additions, 0))
  const turnDeletions = createMemo(() => turnDiffs().reduce((sum, x) => sum + x.deletions, 0))
  // 有没有能真正渲染出来的 part。PART_MAPPING 只覆盖 text/tool/reasoning,其余类型会被
  // <Show when={component()}> 丢掉;流式早期可能一个都没有,这时只跳过卡壳,不画那个 3 行高的
  // 空霓虹卡。meta 行照常渲染 —— 它标的是「这条助手消息在这」,即使正文还没到。
  // 改造前没有卡也没有 meta,所以这里不是「恢复原样」,而是新形态下选的取舍。
  const renderableParts = createMemo(() => props.parts.filter((x) => PART_MAPPING[x.type as keyof typeof PART_MAPPING]))

  return (
    <>
      {/* 助手气泡:meta 行(智能体 · 时间 · 模型)+ 霓虹描边正文卡。meta 的顺序与截断见 AssistantMeta。
          外层是消息锚点 —— 会话跳转(跳到消息/上一条下一条)是按 scrollbox **直接子节点**的 id
          查的,那个 id 与这层盒子的形状都由 MessageAnchor 保证(见 message-anchor.tsx 的注释:
          六处寻址全靠它,删掉会静默失效)。
          锚点自己承担 marginTop=1:卡内每个 part 的 margin 由 setPreLayoutSiblingMargin 按兄弟链算,
          首 part 的 previous 是 undefined → 0,不会再多顶一行。 */}
      <MessageAnchor
        messageID={props.message.id}
        marginTop={1}
        flexShrink={0}
        /* alignItems="flex-start" 管的是**锚点的子元素**要不要被拉伸:scrollbox 的 alignItems 是
           默认的 stretch,不写的话子元素(卡与 meta)会被拉满整条 78% 的带子,一条「好的」短回复
           也拿到一个横跨 messageColumns 的空盒子(用户原话:「应该根据文字内容自适应气泡大小和宽度」)。
           写上之后子元素按内容收缩、左缘贴带子左缘,封顶仍在带子宽度(原型 `.msg.assistant`
           是 `align-self: flex-start`,card-design-v7.html:396)。
           **不加 alignSelf**:助手那条本来就在左边(78% 的带子由 stretch 停在面板左缘),
           加 flex-end 会把左对齐的消息推到右边 —— 右缘贴面板是用户那条的事(见 UserMessage)。 */
        alignItems="flex-start"
      >
        <AssistantMeta
          agentColor={local.agent.color(props.message.agent)}
          agent={props.message.agent}
          created={props.message.time.created}
          model={model()}
          // meta 的宽度上限跟着消息列走(锚点上那道 78%):按整列算的话模型名会一直排到
          // 气泡卡的右缘之外 —— 而 meta 与卡在同一条右缘上,那截模型名是白排的。
          width={messageColumns(ctx.width)}
        />
        <Show when={renderableParts().length}>
          {/* width="auto" 是**按内容收缩**的另一半,与锚点上那个 alignItems="flex-start" 缺一不可:
              卡壳默认 width="100%"(撑满父容器,流程图节点卡与提示卡都吃这一档),百分比会按
              **锚点的宽度**解析成整条 78% 的带子 —— 锚点那边已经允许子元素按内容收缩了,卡自己
              却还是写死 100%,短回复照样横跨 messageColumns 那么宽。
              改成 auto 之后卡宽 = 正文 + padding,长正文由卡壳的 maxWidth="100%" 封顶在带子上
              (封顶值就是 messageColumns,见 message-anchor 的 MESSAGE_MAX_WIDTH)。 */}
          <NeonCard enterDelay={ctx.enterDelayFor(props.message.id)} width="auto">
            <For each={props.parts}>
              {(part, index) => {
                const component = createMemo(() => PART_MAPPING[part.type as keyof typeof PART_MAPPING])
                return (
                  <Show when={component()}>
                    <Dynamic
                      last={index() === props.parts.length - 1}
                      component={component()}
                      part={part as any}
                      message={props.message}
                    />
                  </Show>
                )
              }}
            </For>
          </NeonCard>
        </Show>
      </MessageAnchor>
      <Show when={props.parts.some((x) => x.type === "tool" && x.tool === "task")}>
        <box paddingTop={1} paddingLeft={2}>
          <text fg={theme.text}>
            {childShortcut()}
            <span style={{ fg: theme.textMuted }}> 查看子代理</span>
            <Show
              when={
                sync.data.capabilities.experimentalBackgroundSubagents &&
                props.parts.some(
                  (x) =>
                    x.type === "tool" &&
                    x.tool === "task" &&
                    x.state.status === "running" &&
                    x.state.metadata?.background !== true,
                )
              }
            >
              <span style={{ fg: theme.textMuted }}> · </span>
              {backgroundShortcut()}
              <span style={{ fg: theme.textMuted }}> 后台</span>
            </Show>
          </text>
        </box>
      </Show>
      <Show when={props.message.error && props.message.error.name !== "MessageAbortedError"}>
        {/* paddingRight=1:NeonBox 不占边框格、边框画在最外列上,右留 1 格才能让文本宽度与旧 border=["left"] 版一致
            错误卡不加 enterDelay、也没有悬停:它是助手消息的附属物,跟着那张卡一起入场已经够了;
            单独再淡入一次就是同一屏里闪两下。悬停同理 —— 报错时用户要的是看清文字,不是看边框流动。 */}
        <neonbox
          ref={(el: BoxRenderable) => alwaysSeparate.add(el)}
          gradientStops={semanticStops(theme, "error")}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          paddingRight={1}
          marginTop={1}
          backgroundColor={theme.backgroundPanel}
        >
          <text fg={theme.textMuted}>{errorMessage(props.message.error)}</text>
        </neonbox>
      </Show>
      <Switch>
        <Match when={props.last || final() || props.message.error?.name === "MessageAbortedError"}>
          {/* crush 式节标题:◇ + 一行摘要 + "─" 填满剩余宽度,代替边框给会话流分区 */}
          <box
            ref={(el: BoxRenderable) => alwaysSeparate.add(el)}
            flexDirection="row"
            alignItems="center"
            gap={1}
            paddingLeft={2}
            marginTop={1}
            flexShrink={0}
          >
            <text flexShrink={0}>
              <span
                style={{
                  fg:
                    props.message.error?.name === "MessageAbortedError"
                      ? theme.textMuted
                      : local.agent.color(props.message.agent),
                }}
              >
                ◇{" "}
              </span>{" "}
              {/* mode 与 agent 同名时不印这一格 —— 那正是把上面 AssistantMeta 那行的名字
                  再抄一遍(用户报的「显示这么多个 agents-orchestrator」:meta 一行、思考卡
                  上方一行、这里又一行,连着三遍)。两者不同才印,比如 mode=plan 而
                  agent=某子代理时,这一格才真的补了信息。 */}
              <Show when={props.message.mode.toLowerCase() !== props.message.agent.toLowerCase()}>
                <span style={{ fg: theme.text }}>{Locale.titlecase(props.message.mode)}</span>
                <span style={{ fg: theme.textMuted }}> · </span>
              </Show>
              <span style={{ fg: theme.textMuted }}>{model()}</span>
              <Show when={duration()}>
                <span style={{ fg: theme.textMuted }}> · {Locale.duration(duration())}</span>
              </Show>
              <Show when={props.message.error?.name === "MessageAbortedError"}>
                <span style={{ fg: theme.textMuted }}> · 已中断</span>
              </Show>
            </text>
            <box flexGrow={1} flexShrink={1} height={1} border={["top"]} borderColor={theme.border} />
          </box>
          {/* 本轮改动:文件数固定有上限(见 DiffStatList),不会把这一屏顶掉。 */}
          <Show when={turnDiffs().length}>
            {/* paddingLeft=2:与助手气泡卡的 paddingLeft 对齐(正文起于第 2 列),三行同起一条竖线 */}
            <box ref={(el: BoxRenderable) => alwaysSeparate.add(el)} paddingLeft={2} marginTop={1} flexShrink={0}>
              <text fg={theme.textMuted}>
                本轮改动 {turnDiffs().length} 个文件
                <Show when={turnAdditions() > 0}>
                  <span style={{ fg: theme.diffAdded }}> +{turnAdditions()}</span>
                </Show>
                <Show when={turnDeletions() > 0}>
                  <span style={{ fg: theme.diffRemoved }}> -{turnDeletions()}</span>
                </Show>
              </text>
              <DiffStatList files={turnDiffs()} />
            </box>
          </Show>
        </Match>
      </Switch>
    </>
  )
}

const PART_MAPPING = {
  text: TextPart,
  tool: ToolPart,
  reasoning: ReasoningPart,
}

const INLINE_TOOL_ICON_WIDTH = 2

function ReasoningPart(props: { last: boolean; part: ReasoningPart; message: AssistantMessage }) {
  const { theme } = useTheme()
  const ctx = use()
  // meta 里的智能体名/颜色来自 local(与助手 meta 同一处),所以这一层要挂 LocalProvider 的栈。
  const local = useLocal()
  // Collapsed by default in hide mode: a single line throughout, so the
  // layout never shifts. Click to open the full markdown block, click to close.
  const [expanded, setExpanded] = createSignal(false)

  const content = createMemo(() => {
    // OpenRouter encrypts some reasoning blocks; drop the placeholder.
    return props.part.text.replace("[REDACTED]", "").trim()
  })
  const opaque = createMemo(() => !content() && Boolean(props.part.metadata))
  // Reasoning is finalized when the server sets `time.end` (see processor.ts).
  // Flips independently of the parent message completing.
  const isDone = createMemo(() => props.part.time.end !== undefined)
  const inMinimal = createMemo(() => ctx.thinkingMode() === "hide")
  const duration = createMemo(() => {
    const end = props.part.time.end
    return end === undefined ? 0 : Math.max(0, end - props.part.time.start)
  })
  const summary = createMemo(() => reasoningSummary(content()))
  const syntax = createSyntaxStyleMemo(() => generateSubtleSyntax(theme))

  const toggle = () => {
    if (!inMinimal() || opaque()) return
    setExpanded((prev) => !prev)
  }

  return (
    <Show when={content() || opaque()}>
      <box ref={partSiblingRef} flexShrink={0}>
        {/* 思考块的 meta 行(原型 card-design-v7.html:946 的 `.msg.assistant.thinking .msg-meta`):
            贴在思考卡**外面**的上一行、仍在助手气泡卡**内**。
            层级这样定的理由见 ThinkingMeta 的注释 —— 原型里 thinking 是独立消息,所以它的
            meta 与助手 meta 平级;而 A1 把所有 part 包进了同一张助手卡,平级的话这里会看起来像
            「第二条助手消息」。meta 在 part 盒子**内部**,所以它与思考卡一起被 partSiblingRef
            当成一个整体参与卡内「有前兄弟就给 1 行」的间距计算,不会多顶一行。 */}
        <ThinkingMeta agentColor={local.agent.color(props.message.agent)} />
        {/* crush 式思考块:紫青渐变描边卡片 + 第 2 级灰底,和工具输出同一套弱对比语言。
            不加 enterDelay:思考块是在流式输出**过程中**随 reasoning 到达而挂上的,
            一轮里可能来好几块,淡入会让「正在想」这件事变成「边框在闪」。
            也没有悬停 —— 折叠/展开的点击区是 header 那一行,整卡流动会让可点范围看起来是整张卡。 */}
        <neonbox
          gradientStops={semanticStops(theme, "thinking")}
          backgroundColor={theme.backgroundElement}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          paddingRight={2}
        >
          <box onMouseUp={toggle}>
            <ReasoningHeader
              toggleable={inMinimal() && !opaque()}
              open={!inMinimal() || expanded()}
              done={isDone()}
              title={summary().title}
              duration={isDone() ? Locale.duration(duration()) : undefined}
              encrypted={opaque()}
            />
          </box>
          <Show when={!opaque() && (!inMinimal() || expanded()) && summary().body}>
            <box paddingLeft={inMinimal() ? 2 : 0}>
              <code
                filetype="markdown"
                drawUnstyledText={false}
                streaming={true}
                syntaxStyle={syntax()}
                content={summary().body}
                conceal={ctx.conceal()}
                fg={theme.textMuted}
              />
            </box>
          </Show>
        </neonbox>
      </box>
    </Show>
  )
}

function ReasoningHeader(props: {
  toggleable: boolean
  open: boolean
  done: boolean
  title: string | null
  duration?: string
  encrypted?: boolean
}) {
  const { theme } = useTheme()
  const completed = () => {
    if (props.encrypted) return `思考过程${props.duration ? ` · ${props.duration}` : ""}`
    const detail = [props.title, props.duration].filter(Boolean).join(" · ")
    return `${props.toggleable ? (props.open ? "- " : "+ ") : ""}思考过程${detail ? `: ${detail}` : ""}`
  }

  return (
    <Switch>
      <Match when={!props.done}>
        <box flexDirection="row">
          {/* crush 式思考中:主题双色扰动动画 + muted 标签,颜色固定不跟语义色走 */}
          <WorkingSpinner>
            {/* title 是 provider 给的推理摘要,内容和换行都不受控;这里和图标是横排,必须压成一行。 */}
            {props.title ? `正在思考:${Locale.oneLine(props.title, 120)}` : "正在思考你的问题"}
          </WorkingSpinner>
        </box>
      </Match>
      <Match when={true}>
        {/* 完成后的思考块按 crush 的纪律降到最弱对比:muted 灰字,不再用警告色抢注意力 */}
        <text fg={theme.textMuted} wrapMode="none">
          {completed()}
        </text>
      </Match>
    </Switch>
  )
}

/**
 * crush 式「正在干活」指示:挂在消息流末尾。原型 card-design-v7.html:948-949 把它排成两行 ——
 * 上面是标题行 `✦ 分析 <目标> <动词>` + 右对齐的已用时长,下面是那条 ~60 字符的 crush 噪声流。
 *
 * 噪声流是既有的(WorkingSpinner,24 列),计时器也一直是既有实现:组件随会话状态挂载/卸载,
 * 从挂载起算正好是这一轮工作的时长。**这次只补上面那条标题行**,噪声流一行没动 ——
 * 已用时长从噪声流那一行搬到了标题行右端(原型 `.th-time` 就摆在那儿),两个地方同时显示
 * 同一个计时是重复;噪声流那一行留下的是阶段标签(思考中 / 正在回答),它说的是「哪一段」,
 * 与标题行里那个动词不是同一句话。
 *
 * **标题行不加动画**:原型 CSS 里 `.th-row` 只有 `display/flex/gap/align-items` 与两条颜色,
 * 整个文件里没有一条 `animation` 落在它身上(会动的是它下面那条由 JS 驱动的 `.crush`,
 * 以及 `.queue .arr` 的 nudge)。所以动效总闸在这一行上无事可关 —— 它下面那条噪声流仍然
 * 由 WorkingSpinner 自己读 `animations_enabled`,关掉时走 `⋯` 兜底,那一档没动过。
 *
 * 目标与动词的来源、以及没有目标时怎么降级,都在 thinking-step.ts 的注释里。
 */
export function WorkingLine(props: {
  sessionID: string
  thinking: boolean
  /** 最后一条助手消息的 part —— 标题行的目标与动词都从它上面判定。
   *  取结构类型(thinking-step 的 WorkingPart)而不是 SDK 的 `Part`:SDK 的联合类型
   *  在测试里没法随手造,而这一行真正读到的只有 type / text / state.input 那几个字段。 */
  parts: readonly WorkingPart[]
  /** 会话主区宽度(`ctx.width` 的口径):列预算的基数。 */
  ctxWidth: number
}) {
  const { theme } = useTheme()
  const [seconds, setSeconds] = createSignal(0)
  onMount(() => {
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000)
    onCleanup(() => clearInterval(timer))
  })
  const columns = createMemo(() => workingTitleColumns(props.ctxWidth))
  const title = createMemo(() => workingStepTitle(props.parts, columns()))
  // 目标与计时都用思考卡的语义色首端(与思考卡那一圈描边同源);不用 ANSI 加粗,
  // 强调交给 TextAttributes.BOLD + 这个语义色,与 meta 行里 `◆` 的做法一致。
  const accent = () => semanticStops(theme, "thinking")[0]
  return (
    <box
      ref={(el: BoxRenderable) => alwaysSeparate.add(el)}
      paddingLeft={WORKING_LINE_INDENT}
      paddingTop={1}
      flexShrink={0}
    >
      {/* maxWidth 而不是 width:预算是「行内最多能占几列」,容器比它还窄时(极小终端)
          让 Yoga 收窄这一行,而不是把右端的计时顶出可视区。行宽落到 min(容器, 行预算),
          再加上左边的 2 列缩进,计时那一格的列号正好是 messageColumns(ctxWidth)——
          与助手气泡卡的右边框同一列。 */}
      <box flexDirection="row" gap={1} maxWidth={columns()} flexShrink={0}>
        {/* `{" 分析"}` 用表达式而不是裸文本:JSX 会把独占一行的文本的首尾空白(含换行)吃掉,
            写成裸文本的话画面上是 `✦分析foo` —— 一个字都没有空格。 */}
        <text fg={theme.textMuted} wrapMode="none">
          <span style={{ fg: accent() }}>✦</span>
          {" 分析"}
          <Show when={title().target}>
            {(target) => <span style={{ fg: accent(), attributes: TextAttributes.BOLD }}> {target()}</span>}
          </Show>
          <Show when={title().verb}>{(verb) => <span style={{ fg: theme.textMuted }}> {verb()}</span>}</Show>
        </text>
        {/* 原型 `.th-row { justify-content: space-between }` 的终端等价:弹性空隙把计时顶到右缘。
            左段自己已经按 columns 截过,所以这里顶到的是右缘而不是「把左段挤扁」。 */}
        <box flexGrow={1} />
        <text fg={accent()} wrapMode="none">
          {Locale.duration(seconds() * 1000)}
        </text>
      </box>
      <WorkingSpinner width={24}>{props.thinking ? "思考中" : "正在回答"}</WorkingSpinner>
    </box>
  )
}

function TextPart(props: { last: boolean; part: TextPart; message: AssistantMessage }) {
  const ctx = use()
  const { theme, syntax } = useTheme()
  return (
    <Show when={props.part.text.trim()}>
      {/* paddingLeft 已删:缩进由助手气泡卡的 paddingLeft=2 提供,再叠 3 列会双重缩进;
          嵌套列表的层级缩进由 markdown 的 internalBlockMode="top-level" 自己给
          (回归见 test/routes/session/assistant-card.test.tsx)。 */}
      <box ref={partSiblingRef} flexShrink={0}>
        <markdown
          syntaxStyle={syntax()}
          streaming={true}
          internalBlockMode="top-level"
          content={props.part.text.trim()}
          tableOptions={{ style: "grid" }}
          conceal={ctx.conceal()}
          fg={theme.markdownText}
          bg={theme.background}
        />
      </box>
    </Show>
  )
}

// Pending messages moved to individual tool pending functions

function ToolPart(props: { last: boolean; part: ToolPart; message: AssistantMessage }) {
  const ctx = use()
  const display = createMemo(() => toolDisplay(props.part.tool))

  // Hide tool if showDetails is false and tool completed successfully
  const shouldHide = createMemo(() => {
    if (ctx.showDetails()) return false
    if (props.part.state.status !== "completed") return false
    return true
  })

  const toolprops = {
    get metadata() {
      return props.part.state.status === "pending" ? {} : (props.part.state.metadata ?? {})
    },
    get input() {
      return props.part.state.input ?? {}
    },
    get output() {
      return props.part.state.status === "completed" ? props.part.state.output : undefined
    },
    get tool() {
      return props.part.tool
    },
    get part() {
      return props.part
    },
  }

  return (
    <Show when={!shouldHide()}>
      <Switch>
        <Match when={display() === "bash"}>
          <Shell {...toolprops} />
        </Match>
        <Match when={display() === "glob"}>
          <Glob {...toolprops} />
        </Match>
        <Match when={display() === "read"}>
          <Read {...toolprops} />
        </Match>
        <Match when={display() === "grep"}>
          <Grep {...toolprops} />
        </Match>
        <Match when={display() === "webfetch"}>
          <WebFetch {...toolprops} />
        </Match>
        <Match when={display() === "websearch"}>
          <WebSearch {...toolprops} />
        </Match>
        <Match when={display() === "write"}>
          <Write {...toolprops} />
        </Match>
        <Match when={display() === "edit"}>
          <Edit {...toolprops} />
        </Match>
        <Match when={display() === "task"}>
          <Task {...toolprops} />
        </Match>
        <Match when={display() === "execute"}>
          <Execute {...toolprops} />
        </Match>
        <Match when={display() === "apply_patch"}>
          <ApplyPatch {...toolprops} />
        </Match>
        <Match when={display() === "todowrite"}>
          <TodoWrite {...toolprops} />
        </Match>
        <Match when={display() === "question"}>
          <Question {...toolprops} />
        </Match>
        <Match when={display() === "skill"}>
          <Skill {...toolprops} />
        </Match>
        <Match when={true}>
          <GenericTool {...toolprops} />
        </Match>
      </Switch>
    </Show>
  )
}

type ToolProps = {
  input: Record<string, unknown>
  metadata: Record<string, unknown>
  tool: string
  output?: string
  part: ToolPart
}

// 工具卡所在盒子的可用列数相对**消息列**要扣掉的列数,拆开是:助手气泡卡 padding 3
// (component/neon-card 的 paddingLeft 2 + paddingRight 1)+ 工具卡自己的 padding 3
// (BlockTool 里的 paddingLeft 2 + paddingRight 1,与助手卡同款算法),合计 6。
//
// **基准是消息列,不是 ctx.width**:消息列有 78% 的宽度上限(见 message-anchor 的 MESSAGE_MAX_WIDTH),
// 所以 ctx.width 是「整列」而这里是「消息列」。这一层量的是 **head 行**,而 head 是钉死的一行,
// 右边就是 neonbox 自绘的边框 —— 少算列会让状态摘要被边框切掉一截,而 head 上的标题是自己按列
// 截断的(见 toolHeadLayout),切掉的部分既不折行也不留省略号。所以按精确值算,宁可早一点省略标题。
//
// 工具**输出**那一层反过来给了余量:输出是多行文本,少算一列的代价是多折一行,
// 而多折的那一行用户看得见(见 Execute 里剩下的那个 `Math.max(20, …)`)。
export const TOOL_CARD_COLUMNS = 6

/**
 * 工具卡 head 行里,标题与状态摘要之外还要摆下的固定列:
 * head 盒子的 paddingLeft 1 + caret 1 + gap 1 + 图标 1 + gap 1 = 5。
 *
 * 为什么要单列成一个常量:caret 与图标是这一轮给 head 补的两段(原型的 `.caret` 与 `.tw`,
 * card-design-v7.html:438-451),它们各自吃掉 1 列,而 head 右边的状态摘要同样只有 1 行的位置。
 * 三段挤在同一行时,任何一段少算一列都表现为「右边被切掉一截」,而 wrapMode="none" 不会告诉你。
 */
const TOOL_HEAD_CHROME_COLUMNS = 5

/**
 * 紧凑形态 head 上,工具文案之外要摆下的固定列:head 盒子的 paddingLeft 1 + caret 1 + gap 1
 * + 状态图标列 2(INLINE_TOOL_ICON_WIDTH)+ 摘要前面的 gap 1 = 6。
 *
 * 与 TOOL_HEAD_CHROME_COLUMNS 是两笔账:展开形态的 head 由本组件自己排(caret + 齿轮 + 文案),
 * 紧凑形态的 head 是 InlineToolRow(自带图标列),所以少一个图标、多一个图标列。
 */
const COMPACT_HEAD_CHROME_COLUMNS = 6

/**
 * 工具卡 body 的行数上限(原型的 `.tool.open .tool-body { max-height: 160px }`,
 * card-design-v7.html:455-458)。
 *
 * **160px 是怎么折成行的**:原型正文 12px 字号 × 1.7 行高 ≈ 20px 一行,160 / 20 = 8 行。
 * 终端一行就是一格,所以按行折算;这里取 **9**,比折算值多一行 —— 8 行会把最后一行切成两半,
 * 而工具输出最常被看的就是最后几行(测试结果、报错栈)。
 *
 * **上限之外的内容一行都没丢**:body 是一个被 maxHeight 卡住的 scrollbox,内容高度仍然是全部输出,
 * `scrollHeight > viewport.height`,滚轮停在 body 上就能往下读。这条 scrollbox 取代了原来
 * 「JS 侧截断 + 点击展开」那套:那套把没显示的行**藏起来**了,所以才需要一个展开动作;
 * 这里它们始终在内容里,只是要滚 —— 于是 head 上那句「点击展开（还有 N 行）」也就没有存在的理由了。
 */
export const TOOL_BODY_MAX_ROWS = 9

/** body 的源行数。空输出算 1 行(卡里那条空行也是一行,不然 body 会被压成 0 高)。 */
function outputRows(output: string) {
  return Math.max(1, output.split("\n").length)
}

function GenericTool(props: ToolProps) {
  const { theme } = useTheme()
  const ctx = use()
  const output = createMemo(() => props.output?.trim() ?? "")
  // 工具名来自 MCP 服务端的声明,长度和内容都不受我们控制
  const name = createMemo(() => Locale.oneLine(props.tool, 80))

  return (
    <Show
      when={props.output && ctx.showGenericToolOutput()}
      fallback={
        <InlineTool
          pending="正在执行命令..."
          complete={true}
          part={props.part}
          label={{ name: name(), params: toolParams(props.input) }}
          // 紧凑形态也带状态摘要:MCP 工具同样可能是某个测试运行器(`mcp__ci__run_suite`),
          // 而「这条命令跑完怎么样」是 head 上唯一带结论的一段 —— 输出被关掉时它就不见了。
          status={toolStatusSummary(output())}
        />
      }
    >
      <BlockTool
        title={`${name()} ${input(props.input)}`.trim()}
        collapsible={true}
        part={props.part}
        status={toolStatusSummary(output())}
        headWidth={Math.max(0, messageColumns(ctx.width) - TOOL_CARD_COLUMNS)}
        bodyRows={outputRows(output())}
      >
        <text fg={theme.text}>{output()}</text>
      </BlockTool>
    </Show>
  )
}

function InlineTool(props: {
  color?: RGBA
  complete: unknown
  pending: string
  failure?: string
  spinner?: boolean
  /** crush 式结构化标签:工具名 + 截断过的参数;给了 label 就不再用 children 当正文 */
  label?: { name: string; params?: string }
  children?: JSX.Element
  part: ToolPart
  onClick?: () => void
  /**
   * head 行右端的状态摘要(解析规则见 util/tool-display 的 toolStatusSummary)。
   * 紧凑形态也要有:输出被关掉、或者命令还没产出输出时,head 上那一句「跑完怎么样」
   * 是唯一还留着结论的地方。
   */
  status?: ToolStatusSummary
}) {
  const { theme } = useTheme()
  const ctx = use()
  const sync = useSync()
  const [hover, setHover] = createSignal(false)
  const [errorExpanded, setErrorExpanded] = createSignal(false)

  const permission = createMemo(() => {
    const callID = sync.data.permission[ctx.sessionID]?.at(0)?.tool?.callID
    if (!callID) return false
    return callID === props.part.callID
  })

  const error = createMemo(() => (props.part.state.status === "error" ? props.part.state.error : undefined))

  const denied = createMemo(
    () =>
      error()?.includes("QuestionRejectedError") ||
      error()?.includes("rejected permission") ||
      error()?.includes("specified a rule") ||
      error()?.includes("user dismissed"),
  )

  const failed = createMemo(() => Boolean(error() && !denied()))
  const clickable = createMemo(() => Boolean(props.onClick || failed()))
  // 执行中动画:主题双色渐变固定不变,一次算好,别每帧重建生成器。
  const pendingSpinner = createMemo(() => ({
    frames: SPINNER_FRAMES,
    color: animGradient(theme.primary, theme.secondary),
  }))
  const fg = createMemo(() => {
    if (props.color) return props.color
    if (permission()) return theme.warning
    if (failed()) return theme.error
    if (hover() && props.onClick) return theme.text
    if (props.complete) return theme.textMuted
    return theme.text
  })
  // head 上要摆下的固定列:head 盒子 paddingLeft 1 + caret 1 + gap 1 + 状态图标列 2
  // (INLINE_TOOL_ICON_WIDTH)+ 摘要前面的 gap 1 = 6。摘要本身多宽由它自己算。
  const headWidth = createMemo(() => Math.max(0, messageColumns(ctx.width) - TOOL_CARD_COLUMNS))
  const statusColumns = createMemo(() => {
    const status = props.status
    if (!status) return 0
    // 两段摘要的显示列之和就是它们占的总列数 —— 通过段与失败段之间那一列分隔由失败段
    // 自己带着(见 util/tool-display 的 toolStatusFailedText),所以这里不必再加 1。
    return Locale.displayWidth(toolStatusPassedText(status)) + Locale.displayWidth(toolStatusFailedText(status))
  })
  // 有摘要时 head 压成一行(原型的 `.tool-head .cmd { white-space: nowrap; overflow: hidden }`):
  // 摘要是这一行里唯一带结论的一段,让工具名折行去挤它,等于把结论挤到第二行去。
  const labelColumns = createMemo(() =>
    props.status ? Math.max(0, headWidth() - COMPACT_HEAD_CHROME_COLUMNS - statusColumns()) : undefined,
  )

  return (
    <BlockTool
      // 紧凑形态的工具也是一张带边框的卡(原型的 `.tool`,card-design-v7.html:427-458):
      // head 行是下面那个 InlineToolRow,body 是失败详情。工具没有输出时 body 为空,
      // 卡片就只剩 head —— head 永远在,工具不会因为「没东西可显示」就从会话流里消失。
      head={
        <InlineToolRow
          color={fg()}
          errorColor={theme.error}
          successColor={theme.success}
          failed={failed()}
          denied={Boolean(denied())}
          complete={props.complete}
          pending={props.pending}
          failure={props.failure}
          spinner={props.spinner}
          pendingSpinner={pendingSpinner()}
          oneLine={props.status !== undefined}
          onMouseOver={() => clickable() && setHover(true)}
          onMouseOut={() => setHover(false)}
        >
          {props.label ? (
            <ToolLabel
              name={props.label.name}
              params={props.label.params}
              max={labelColumns()}
              failed={failed()}
              errorColor={theme.error}
            />
          ) : (
            props.children
          )}
        </InlineToolRow>
      }
      status={props.status}
      part={props.part}
      // 失败时点 head 展开的是错误详情,所以那张卡 collapsible;其余紧凑工具没有 body,
      // caret 是禁用色(见 BlockTool 里 caret 那个 Show)。
      collapsible={failed()}
      bodyRows={error() ? outputRows(error()!) : undefined}
      onClick={
        clickable()
          ? () => {
              if (failed()) {
                setErrorExpanded((value) => !value)
                return
              }
              props.onClick?.()
            }
          : undefined
      }
    >
      <Show when={failed() && errorExpanded()}>
        <text fg={theme.error}>{error()}</text>
      </Show>
    </BlockTool>
  )
}

export function InlineToolRow(props: {
  color?: RGBA
  errorColor?: RGBA
  successColor?: RGBA
  failed?: boolean
  denied?: boolean
  complete: unknown
  pending: string
  failure?: string
  spinner?: boolean
  /**
   * head 压成一行(原型的 `.tool-head .cmd { white-space: nowrap; overflow: hidden }`)。
   *
   * **什么时候才开**:head 右边有状态摘要的时候。摘要带的是结论,而工具名与参数折行之后
   * 会把结论挤到第二行 —— 那一行就既不是身份也不是结论。没有摘要时保持折行:多行 head
   * 在没有右侧对手时是划算的(长路径、长 pattern 宁可多占一行也别被切)。
   *
   * 截断由调用方做(这一层不知道自己的字符串有多宽),所以这里只负责「不许折行 + 不许溢出」。
   */
  oneLine?: boolean
  /** 执行中动画的帧与配色,由有主题的调用方注入(本组件不碰 context) */
  pendingSpinner?: {
    frames: string[]
    color: (frame: number, char: number, totalFrames: number, totalChars: number) => import("@opentui/core").ColorInput
  }
  children?: JSX.Element
  onMouseOver?: () => void
  onMouseOut?: () => void
}) {
  // crush 式状态图标:图标列只表达状态(✓ 成功 / × 失败),不再按工具各用各的符号;
  // 工具身份由后面的文字(工具名 + 参数)承担。
  // 颜色一律由外面注入(和 errorColor 同一规矩),这一层不碰主题 context ——
  // 渲染测试就是脱开 Provider 直接挂它的。
  //
  // **这一层现在只是工具卡 head 行的内容**:外缩、边框、body 与间距登记都在 BlockTool 上。
  // 它仍然脱开 Provider 就能挂载,所以「工具行的单行守卫」那组测试可以继续只测这一层。
  return (
    <box
      flexShrink={1}
      minWidth={0}
      overflow={props.oneLine ? "hidden" : undefined}
      onMouseOver={props.onMouseOver}
      onMouseOut={props.onMouseOut}
    >
      <Switch>
        <Match when={props.spinner}>
          <Spinner color={props.color} children={props.children} />
        </Match>
        <Match when={true}>
          <Show
            fallback={
              <box flexDirection="row" gap={1}>
                {/* crush 式执行中:主题双色扰动动画;InlineToolRow 脱离 Provider 挂载,
                    颜色/帧由外面注入,拿不到就退回 ● 占位 */}
                <Show
                  when={props.pendingSpinner}
                  fallback={
                    <text paddingLeft={3} fg={props.color}>
                      ● {props.pending}
                    </text>
                  }
                >
                  {(def) => (
                    <box paddingLeft={3} flexDirection="row" gap={1}>
                      <spinner frames={def().frames} interval={50} color={def().color} />
                      <text fg={props.color}>{props.pending}</text>
                    </box>
                  )}
                </Show>
              </box>
            }
            when={props.complete || props.failed}
          >
            <box flexDirection="row">
              <text
                width={INLINE_TOOL_ICON_WIDTH}
                fg={props.failed ? props.errorColor : props.successColor}
                attributes={props.denied ? TextAttributes.STRIKETHROUGH : undefined}
              >
                {props.failed ? "×" : "✓"}
              </text>
              <text
                flexGrow={1}
                flexShrink={1}
                minWidth={0}
                wrapMode={props.oneLine ? "none" : undefined}
                fg={props.failed ? props.errorColor : props.color}
                attributes={props.denied ? TextAttributes.STRIKETHROUGH : undefined}
              >
                {props.failed && !props.complete ? (props.failure ?? props.children) : props.children}
              </text>
            </box>
          </Show>
        </Match>
      </Switch>
    </box>
  )
}

// crush 式工具行文案:工具名用 info 色、参数写成截断过的 (k=v),名字是身份、参数是细节。
// 失败时整体退到 errorColor,不和状态色打架。只允许出现在 InlineToolRow 的 text 里。
//
// **名字就是原型那个被加粗的首词**:`.tool-head .cmd b { color: var(--cyan) }` 里的 `bun`。
// 这里用 info 色而不是 primary/secondary:info 是「这条信息本身」那一档,primary/secondary 已经被
// 卡片描边与图标占着;info 在 novaway 的深浅两套里都有独立的浅/深取值(见 theme/assets 的
// `{ dark, light }` 双档),所以浅色主题下它不会糊进白底。
//
// `max` 是这一整条文案(名字 + 参数)的显示列上限:head 上有状态摘要时由调用方算好传进来,
// 名字先占、剩下的给参数 —— 名字被截意味着连工具身份都认不出来了,那比参数被截更糟。
export function ToolLabel(props: { name: string; params?: string; max?: number; failed?: boolean; errorColor?: RGBA }) {
  const { theme } = useTheme()
  const fg = () => (props.failed ? props.errorColor : theme.info)
  const name = createMemo(() => (props.max === undefined ? props.name : Locale.truncateToWidth(props.name, props.max)))
  const params = createMemo(() => {
    if (!props.params || props.max === undefined) return props.params
    const left = props.max - Locale.displayWidth(name()) - 1
    if (left <= 0) return undefined
    return Locale.truncateToWidth(props.params, left)
  })
  return (
    <>
      <span style={{ fg: fg() }}>{name()}</span>
      <Show when={params()}>{(value) => <span style={{ fg: fg() }}> {value()}</span>}</Show>
    </>
  )
}

// 参数串 "(k=v, k=v)" 的截断上限:一条工具行放得下为主,超了直接断,不折行。
const TOOL_PARAMS_MAX = 60

function toolParams(params: Record<string, unknown>, omit?: string[]): string {
  const summary = input(params, omit)
  if (!summary) return ""
  // input() 返回 "[k=v, k=v]";crush 的形状是圆括号,顺手换掉。
  return `(${Locale.oneLine(summary.slice(1, -1), TOOL_PARAMS_MAX)})`
}

/**
 * 工具子卡:一张带边框的卡,里面是 **head 行 + body**(原型的 `.tool`,
 * card-design-v7.html:427-458)。
 *
 * **为什么两种形态共用这一张卡**:改造前工具只有两种形态 —— 一行没有壳的纯文本
 * (`InlineToolRow`)与展开的 `BlockTool`。中间那档(有壳、只有 head、没有 body)整个缺着,
 * 于是工具输出读起来是一片没有层次的纯文本。现在紧凑形态(Read/Glob/Grep/Task 那一类)
 * 与展开形态(Shell / GenericTool / diff / 待办那一类)都是这张卡,区别只在于有没有 body:
 *   - 有 body:caret 可点,点一下收起/展开(原型 `.tool` ↔ `.tool.open` 的那一下)。
 *   - 没有 body:caret 仍然画,但用边框色 —— 它是「这里没有可展开的东西」的禁用凭据,
 *     而 head 本身永远在,工具不会因为没有输出就从会话流里消失。
 *
 * **间距登记为什么在这一层**:`setPreLayoutSiblingMargin` 读的是 `el.parent` 的兄弟链
 * (见 util/layout),埋深一层就找错人。而这一层是助手气泡卡的**直接子节点**,与
 * TextPart / ReasoningPart 的 `partSiblingRef` 平级 —— 间距是「按兄弟链算」的,不是
 * 「这一层自己写死 marginTop」。所以固定 marginTop={1} 那套已经换掉:卡内第一个 part
 * 贴顶(与 TextPart 一致),其余一律隔一行。
 */
export function BlockTool(props: {
  /**
   * head 行的文案(展开形态那一路)。首词按命令色单独染(原型的 `.tool-head .cmd b`)。
   * 给了 `head` 就以 `head` 为准。
   */
  title?: string
  /** head 行的完整内容(紧凑形态那一路:调用方自己排 head,例如 InlineToolRow)。 */
  head?: JSX.Element
  /** head 行左侧的图标字形;省略 = ⚙(原型的 `.tool-head .tw`)。 */
  icon?: string
  /** body。省略 = 这张卡只有 head(工具没有输出)。 */
  children?: JSX.Element
  /**
   * body 的源行数(调用方数自己的输出行数给过来)。
   *
   * 给了 = 输出型 body:被 `min(bodyRows, TOOL_BODY_MAX_ROWS)` 那个 scrollbox 装下,超出的部分
   * 留着、能滚。省略 = 结构型 body(diff / 代码 / 待办列表):整块展示,不设上限 —— 那些内容的
   * 行数本来就由内容决定(一个补丁本来就可能几百行),而用户要看的就是整块。
   *
   * **为什么不写两行就把高度算出来**:body 是任意 JSX,渲染前拿不到它会占多少行。真去量的话
   * 只能在布局之后反过来改 scrollbox 的高度,那是「先渲染再撑大」,一撑大又会触发一次重排 ——
   * 与其在那儿绕,不如让最清楚行数的那一层(拿着输出字符串的那个)报个数上来。
   * 少报的行会被裁掉但仍然可滚(内容一行没丢),多报的行会留空白,所以报少比报多好。
   */
  bodyRows?: number
  /** body 能不能点 head 收起/展开。 */
  collapsible?: boolean
  /** 点 head 的额外动作(紧凑形态的「跳到子代理」走这一条)。 */
  onClick?: () => void
  /** body 初始展开?默认 true —— 工具输出是这张卡的主体,默认藏着等于把结果藏起来。 */
  open?: boolean
  part?: ToolPart
  spinner?: boolean
  /**
   * head 行右端的状态摘要(解析规则见 util/tool-display 的 toolStatusSummary)。
   * 解析在数据侧做好再传进来:这张卡只管排版,不该知道工具输出长什么样。
   */
  status?: ToolStatusSummary
  /**
   * head 行所在盒子的可用显示列数(= 工具卡内宽,见 TOOL_CARD_COLUMNS),用来给标题
   * 让出 caret、图标与摘要的位置(内部再扣 TOOL_HEAD_CHROME_COLUMNS)。
   * 省略 = 不按宽度截断 —— 单测直挂 BlockTool 时没有会话宽度可依。
   */
  headWidth?: number
}) {
  const { theme } = useTheme()
  const renderer = useRenderer()
  const tuiConfig = useTuiConfig()
  const hover = useCardHover()
  const [open, setOpen] = createSignal(props.open ?? true)
  const error = createMemo(() => (props.part?.state.status === "error" ? props.part.state.error : undefined))
  const expandable = createMemo(() => Boolean(props.collapsible) && Boolean(props.children))
  const head = createMemo(() =>
    toolHeadLayout({
      title: props.title,
      summary: props.status,
      width: (props.headWidth ?? Number.MAX_SAFE_INTEGER) - TOOL_HEAD_CHROME_COLUMNS,
    }),
  )
  const command = createMemo(() => toolCommandParts(head().title))
  // body 那个 scrollbox:onMouseScroll 要读它的几何,才能判断「这次滚轮该不该被 body 吃掉」。
  let bodyBox: ScrollBoxRenderable | undefined
  return (
    // paddingRight=1:NeonBox 不占边框格、边框画在最外列上,右留 1 格才能让文本宽度与旧 border=["left"] 版一致
    // 悬停:渐变流动 + 描边提亮。**不加 enterDelay(阶梯入场)** —— 工具卡是流式输出期间
    // 一张接一张长出来的,一轮里可能连着挂五六张;再加淡入就是工具输出「噼里啪啦」地闪,
    // 而卡本身还在长高,半亮的边框配着变动的正文比不动更乱。悬停是用户驱动的,流式输出时
    // 鼠标不在上面,两者不会打架。
    <neonbox
      ref={(el: BoxRenderable) => {
        alwaysSeparate.add(el)
        setPreLayoutSiblingMargin(el, (previous) => (previous ? 1 : 0))
      }}
      gradientStops={semanticStops(theme, "tool")}
      animated={hover.animated()}
      boost={hover.boost(theme.text)}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={1}
      gap={0}
      // **必须 flexShrink={0}**:Renderable 的 flexShrink 默认是 1,而这张卡现在有多行正文 ——
      // 在会话流那个 scrollbox 里,内容比视口高时 yoga 会去压这些子项,一压卡就比内容矮,
      // 正文于是画到了下边框那一行(实测:紧凑卡的第二行 head 直接盖在 ╰ 上)。
      // 压一张卡来「装进视口」本来就是错的方向:会话流本来就该滚。
      flexShrink={0}
      backgroundColor={hover.hover() ? theme.backgroundMenu : theme.backgroundElement}
      onMouseOver={() => (expandable() || props.onClick) && hover.onMouseOver()}
      onMouseOut={hover.onMouseOut}
    >
      {/* head 行 = 原型 card-design-v7.html:928-933 的 `.tool-head`:
          caret(▸/▾)+ 齿轮 + 命令(首词染色)+ 状态摘要。整行都是点击区。
          **为什么点击挂在 head 而不是整张卡**:body 里是要滚动/要选中复制的输出,
          在那一大片区域里判「这一下是在点卡还是在选文本」比在一行摘要上难得多
          (所以下面仍然留着 renderer.getSelection() 那道守卫)。 */}
      <box
        flexDirection="row"
        gap={1}
        paddingLeft={1}
        flexShrink={0}
        onMouseOver={() => (expandable() || props.onClick) && hover.onMouseOver()}
        onMouseOut={hover.onMouseOut}
        onMouseUp={() => {
          // 选中文本时这一下是划选,不是点击 —— 与用户消息气泡、思考块用的是同一道守卫。
          if (renderer.getSelection()?.getSelectedText()) return
          if (expandable()) setOpen((value) => !value)
          props.onClick?.()
        }}
      >
        {/* 禁用态的 caret 用边框色而不是 muted:muted 是「可点但没按」,边框色才是「按了也没用」。
            两者只差一档灰,但那一档正是原型 `.tool` 与 `.tool:hover` 的对比度。 */}
        <text fg={expandable() ? theme.textMuted : theme.border} flexShrink={0}>
          {expandable() && open() ? "▾" : "▸"}
        </text>
        <Show
          when={props.head}
          fallback={
            <box flexDirection="row" gap={1} flexShrink={1} minWidth={0}>
              <text fg={theme.secondary} flexShrink={0}>
                {props.icon ?? "⚙"}
              </text>
              <Show when={head().title}>
                {(title) => (
                  <Show
                    when={props.spinner}
                    fallback={
                      <text fg={theme.textMuted}>
                        <span style={{ fg: theme.info }}>{command().first}</span>
                        {command().rest}
                      </text>
                    }
                  >
                    <Spinner color={theme.textMuted}>{title().replace(/^# /, "")}</Spinner>
                  </Show>
                )}
              </Show>
            </box>
          }
        >
          {props.head}
        </Show>
        <Show when={head().passed}>
          <text fg={theme.success} flexShrink={0}>
            {head().passed}
            <Show when={head().failed}>{(failed) => <span style={{ fg: theme.error }}>{failed()}</span>}</Show>
          </text>
        </Show>
      </box>
      {/* body = 原型的 `.tool-body`(:455-458):一条上边框与 head 分开。
          输出型 body 被行数上限卡进一个 scrollbox —— 上限之外的内容一行没丢,它始终在内容里,
          滚轮停在上面就能往下读;结构型 body(diff / 代码 / 列表)整块展示。 */}
      <Show when={props.children && open()}>
        <box border={["top"]} borderColor={theme.border} flexShrink={0}>
          <Show when={props.bodyRows !== undefined} fallback={props.children}>
            <scrollbox
              ref={(el: ScrollBoxRenderable) => (bodyBox = el)}
              height={Math.max(1, Math.min(props.bodyRows!, TOOL_BODY_MAX_ROWS))}
              scrollAcceleration={getScrollAcceleration(tuiConfig)}
              onMouseScroll={(event) => {
                // opentui 的鼠标事件是**冒泡**的:body 在会话流那个 scrollbox 里面,不拦住的话
                // 一次滚轮会把 body 与整个会话一起滚走。只在 body 自己还剩内容时吃掉它 ——
                // 停在一条装得下的短输出上时,滚轮就该归会话流。
                if (!bodyBox) return
                if (bodyBox.scrollHeight > bodyBox.viewport.height) event.stopPropagation()
              }}
            >
              {props.children}
            </scrollbox>
          </Show>
        </box>
      </Show>
      <Show when={error()}>
        <text fg={theme.error}>{error()}</text>
      </Show>
    </neonbox>
  )
}

function Shell(props: ToolProps) {
  const { theme } = useTheme()
  const pathFormatter = usePathFormatter()
  const ctx = use()
  const isRunning = createMemo(() => props.part.state.status === "running")
  const output = createMemo(() => stripAnsi(stringValue(props.metadata.output)?.trim() ?? ""))

  const workdirDisplay = createMemo(() => {
    const workdir = stringValue(props.input.workdir)
    if (!workdir || workdir === ".") return undefined
    const formatted = pathFormatter.format(workdir)
    if (formatted === ".") return undefined
    return formatted
  })

  return (
    <Switch>
      <Match when={stringValue(props.metadata.output) !== undefined}>
        {/* head 就是命令本身(原型的 `.tool-head .cmd`:`<b>bun</b> test --timeout 30000`)。
            工作目录搬进 body 的第一行:它是「这条输出是在哪跑的」,属于输出的一部分,
            而不是一个命令的身份 —— 放在 head 里的话,首词染色染到的会是 "Running"。 */}
        <BlockTool
          title={toolLine(props.input.command)}
          spinner={isRunning()}
          collapsible={true}
          part={props.part}
          // 这正是原型那张卡的场景:`bun test --timeout 30000 … ✓ 12 passed`。
          // output() 已经 stripAnsi 过(解析要的是纯文本,色码会插在数字与单词之间)。
          status={toolStatusSummary(output())}
          headWidth={Math.max(0, messageColumns(ctx.width) - TOOL_CARD_COLUMNS)}
          bodyRows={outputRows(output())}
        >
          <box gap={1}>
            <Show when={workdirDisplay()}>{(wd) => <text fg={theme.textMuted}># Running in {wd()}</text>}</Show>
            <Show when={output()}>
              <text fg={theme.text}>{output()}</text>
            </Show>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool
          pending="正在执行命令..."
          complete={stringValue(props.input.command)}
          part={props.part}
          status={toolStatusSummary(output())}
        >
          {/* heredoc、多行管道、带反斜杠续行的命令都很常见,这一行放不下多行 */}
          {toolLine(props.input.command)}
        </InlineTool>
      </Match>
    </Switch>
  )
}

function Write(props: ToolProps) {
  const { theme, syntax } = useTheme()
  const pathFormatter = usePathFormatter()
  const code = createMemo(() => {
    return stringValue(props.input.content) ?? ""
  })

  return (
    <Switch>
      <Match when={props.metadata.diagnostics !== undefined}>
        <BlockTool title={"# 写入 " + pathFormatter.format(stringValue(props.input.filePath))} part={props.part}>
          <line_number fg={theme.textMuted} minWidth={3} paddingRight={1}>
            <code
              conceal={false}
              fg={theme.text}
              filetype={filetype(stringValue(props.input.filePath))}
              syntaxStyle={syntax()}
              content={code()}
            />
          </line_number>
          <Diagnostics diagnostics={props.metadata.diagnostics} filePath={stringValue(props.input.filePath) ?? ""} />
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool
          pending="正在准备写入..."
          complete={stringValue(props.input.filePath)}
          part={props.part}
          label={{ name: "写入", params: pathFormatter.format(stringValue(props.input.filePath)) }}
        />
      </Match>
    </Switch>
  )
}

function Glob(props: ToolProps) {
  const pathFormatter = usePathFormatter()
  return (
    <InlineTool
      pending="正在查找文件..."
      complete={stringValue(props.input.pattern)}
      part={props.part}
      label={{
        name: "匹配",
        params: [
          `"${toolLine(props.input.pattern)}"`,
          stringValue(props.input.path) ? `于 ${pathFormatter.format(stringValue(props.input.path))}` : undefined,
          numberValue(props.metadata.count) ? `${numberValue(props.metadata.count)} 个文件` : undefined,
        ]
          .filter(Boolean)
          .join(" "),
      }}
    />
  )
}

function Read(props: ToolProps) {
  const { theme } = useTheme()
  const pathFormatter = usePathFormatter()
  const isRunning = createMemo(() => props.part.state.status === "running")
  const loaded = createMemo(() => {
    if (props.part.state.status !== "completed") return []
    if (props.part.state.time.compacted) return []
    const value = props.metadata.loaded
    if (!value || !Array.isArray(value)) return []
    return value.filter((p): p is string => typeof p === "string")
  })
  return (
    <>
      <InlineTool
        pending="正在读取文件..."
        complete={stringValue(props.input.filePath)}
        spinner={isRunning()}
        part={props.part}
        label={{
          name: "读取",
          params: [pathFormatter.format(stringValue(props.input.filePath)), toolParams(props.input, ["filePath"])]
            .filter(Boolean)
            .join(" "),
        }}
      />
      <For each={loaded()}>
        {(filepath) => (
          <box paddingLeft={3}>
            <text paddingLeft={3} fg={theme.textMuted}>
              ↳ Loaded {pathFormatter.format(filepath)}
            </text>
          </box>
        )}
      </For>
    </>
  )
}

function Grep(props: ToolProps) {
  const pathFormatter = usePathFormatter()
  return (
    <InlineTool
      pending="正在搜索内容..."
      complete={stringValue(props.input.pattern)}
      part={props.part}
      label={{
        name: "搜索",
        params: [
          `"${toolLine(props.input.pattern)}"`,
          stringValue(props.input.path) ? `于 ${pathFormatter.format(stringValue(props.input.path))}` : undefined,
          numberValue(props.metadata.matches) ? `${numberValue(props.metadata.matches)} 个匹配` : undefined,
        ]
          .filter(Boolean)
          .join(" "),
      }}
    />
  )
}

function WebFetch(props: ToolProps) {
  return (
    <InlineTool
      pending="正在获取网页..."
      complete={stringValue(props.input.url)}
      part={props.part}
      label={{ name: "取网页", params: toolLine(props.input.url) }}
    />
  )
}

function WebSearch(props: ToolProps) {
  return (
    <InlineTool
      pending="正在搜索网页..."
      complete={stringValue(props.input.query)}
      part={props.part}
      label={{
        name: "搜网页",
        params: [
          webSearchProviderLabel(props.metadata.provider),
          `"${toolLine(props.input.query)}"`,
          numberValue(props.metadata.numResults) ? `${numberValue(props.metadata.numResults)} 个结果` : undefined,
        ]
          .filter(Boolean)
          .join(" "),
      }}
    />
  )
}

function Task(props: ToolProps) {
  const { theme } = useTheme()
  const { navigate } = useRoute()
  const sync = useSync()
  const dialog = useDialog()

  onMount(() => {
    const sessionID = stringValue(props.metadata.sessionId)
    if (sessionID && !sync.data.message[sessionID]?.length) void sync.session.sync(sessionID)
  })

  const sessionID = createMemo(() => stringValue(props.metadata.sessionId))
  const messages = createMemo(() => sync.data.message[sessionID() ?? ""] ?? [])

  const tools = createMemo(() => {
    return messages().flatMap((msg) =>
      (sync.data.part[msg.id] ?? [])
        .filter((part): part is ToolPart => part.type === "tool")
        .map((part) => ({ tool: part.tool, state: part.state })),
    )
  })

  const current = createMemo(() =>
    tools().findLast((x) => (x.state.status === "running" || x.state.status === "completed") && x.state.title),
  )

  const status = createMemo(() => sync.data.session_status[sessionID() ?? ""])
  const isRunning = createMemo(() => {
    const value = status()
    return (
      props.part.state.status === "running" ||
      (props.metadata.background === true && value !== undefined && value.type !== "idle")
    )
  })
  const retry = createMemo(() => {
    const value = status()
    if (value?.type !== "retry") return
    return value
  })

  const duration = createMemo(() => {
    const first = messages().find((x) => x.role === "user")?.time.created
    const assistant = messages().findLast((x) => x.role === "assistant")?.time.completed
    if (!first || !assistant) return 0
    return assistant - first
  })

  const content = createMemo(() => {
    // content 最后是用 "\n" 拼起来的:这里的每一段都必须自己就是一行,
    // 否则多出来的换行会插进 ↳ 列表中间,把这一块的行数和缩进全弄乱。
    const description = toolLine(props.input.description)
    if (!description) return ""
    let content = [
      formatSubagentTitle(
        Locale.titlecase(stringValue(props.input.subagent_type) ?? "General"),
        description,
        props.metadata.background === true,
      ),
    ]

    const retrying = retry()
    if (isRunning() && retrying) {
      // 重试原因是 provider 返回的错误串,多行的很常见 —— truncate 只截长度、不消换行
      content.push(`↳ ${formatSubagentRetry(retrying.attempt, Locale.oneLine(retrying.message, 80))}`)
    } else if (isRunning() && tools().length > 0) {
      if (current()) {
        const state = current()!.state
        const title = state.status === "running" || state.status === "completed" ? toolLine(state.title) : undefined
        content.push(`↳ ${Locale.titlecase(current()!.tool)} ${title}`)
      } else content.push(`↳ ${formatSubagentToolcalls(tools().length)}`)
    }

    if (!isRunning() && props.part.state.status === "completed") {
      content.push(`↳ ${formatCompletedSubagentDetail(tools().length, Locale.duration(duration()))}`)
    }

    return content.join("\n")
  })

  return (
    <InlineTool
      color={retry() ? theme.error : undefined}
      spinner={isRunning()}
      complete={stringValue(props.input.description)}
      pending="正在委派任务..."
      part={props.part}
      onClick={() => {
        if (sessionID()) {
          navigate({ type: "session", sessionID: sessionID()! })
        }
        const status = retry()
        if (status) void DialogAlert.show(dialog, "Retry Error", status.message)
      }}
    >
      {content()}
    </InlineTool>
  )
}

export function formatSubagentToolcalls(count: number) {
  return `${count} toolcall${count === 1 ? "" : "s"}`
}

export function formatSubagentTitle(agent: string, description: string, background: boolean) {
  return `${agent} Task${background ? " (background)" : ""} — ${description}`
}

export function formatSubagentRetry(attempt: number, message: string) {
  return `Retrying (attempt ${attempt}) · ${message}`
}

export function formatCompletedSubagentDetail(toolcalls: number, duration: string) {
  if (toolcalls === 0) return duration
  return `${formatSubagentToolcalls(toolcalls)} · ${duration}`
}

type ExecuteCall = { tool: string; status: "running" | "completed" | "error"; input?: Record<string, unknown> }

function executeCalls(value: unknown): ExecuteCall[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((call) => {
    const item = recordValue(call)
    const tool = stringValue(item?.tool)
    const status = stringValue(item?.status)
    if (!tool || !status || !["running", "completed", "error"].includes(status)) return []
    return [{ tool, status: status as ExecuteCall["status"], input: recordValue(item?.input) }]
  })
}

// The `execute` tool streams child tool calls through metadata, not a child session like Task.
function Execute(props: ToolProps) {
  const ctx = use()
  const { theme } = useTheme()
  const isLoading = createMemo(() => props.part.state.status === "pending" || props.part.state.status === "running")
  const calls = createMemo(() => executeCalls(props.metadata.toolCalls))
  const output = createMemo(() => stripAnsi(props.output?.trim() ?? ""))
  const hasRuntimeError = createMemo(() => props.metadata.error === true)
  // 这段预览的可用列数是**算得准的**:助手卡 padding 3 + 这个盒子自己的 paddingLeft 3 +
  // 里面那个 text 的 paddingLeft 3 = 9(下面那个 <box paddingLeft={3}> 与 <text paddingLeft={3}>),
  // 基准是消息列而不是整列(锚点上那道 78%,见 message-anchor 的 MESSAGE_MAX_WIDTH)。
  const outputColumns = createMemo(() => Math.max(20, messageColumns(ctx.width) - 9))
  const outputPreview = createMemo(() => collapseToolOutput(output(), 4, 4 * outputColumns()).output)
  const showOutput = createMemo(() => output() && hasRuntimeError())
  const content = createMemo(() => {
    const lines = ["execute"]
    for (const call of calls()) {
      const args = input(call.input ?? {})
      lines.push(`↳ ${call.tool}${args ? ` ${args}` : ""}${call.status === "error" ? " (failed)" : ""}`)
    }
    return lines.join("\n")
  })

  return (
    <>
      <InlineTool
        color={hasRuntimeError() ? theme.error : undefined}
        spinner={isLoading()}
        pending="execute"
        complete={true}
        part={props.part}
      >
        {content()}
      </InlineTool>
      <Show when={showOutput()}>
        <box paddingLeft={3}>
          <For each={outputPreview().split("\n")}>
            {(line, index) => (
              <text paddingLeft={3} fg={theme.error}>
                {index() === 0 ? "↳ " : "  "}
                {line}
              </text>
            )}
          </For>
        </box>
      </Show>
    </>
  )
}

// 并排 diff 的正文列数下限。改造前那一层的口径是 `ctx.width > 123`,而卡内 diff 正文是
// ctx.width − 7(助手卡 padding 3 + 工具卡 padding 3 + 下面那个 <box paddingLeft={1}> 1),
// 所以旧阈值等价于「正文 ≥ 117 列」。写成一个正数列数而不是终端宽度,是因为消息列有了 78% 的
// 上限之后,同一个终端宽度对应的正文列数不再是常数。
const DIFF_SPLIT_MIN_COLUMNS = 117

/**
 * 工具卡里那个 diff 用并排还是堆叠。
 *
 * 正文列数 = 消息列 − 助手卡 padding 3 − 工具卡 padding 3 − diff 自己的 paddingLeft 1
 *          = messageColumns(ctxWidth) − TOOL_CARD_COLUMNS − 1。
 * 折到整列上:124 列的整列 → 消息列 round(124 × 0.78) = 97 → 正文 90 < 117,所以堆叠;
 * 159 列的整列 → 消息列 124 → 正文 117 ≥ 117,并排。也就是说并排的门槛从「整列 124」挪到了
 * 「整列 159」—— 消息列收窄 22% 的代价就落在这里。
 */
function toolDiffView(ctxWidth: number, stacked: boolean) {
  if (stacked) return "unified" as const
  return messageColumns(ctxWidth) - TOOL_CARD_COLUMNS - 1 >= DIFF_SPLIT_MIN_COLUMNS
    ? ("split" as const)
    : ("unified" as const)
}

function Edit(props: ToolProps) {
  const ctx = use()
  const { theme, syntax } = useTheme()
  const pathFormatter = usePathFormatter()

  // Default to "auto" behavior
  const view = createMemo(() => toolDiffView(ctx.width, ctx.tui.diff_style === "stacked"))

  const ft = createMemo(() => filetype(stringValue(props.input.filePath)))

  const diffContent = createMemo(() => stringValue(props.metadata.diff) ?? "")

  return (
    <Switch>
      <Match when={stringValue(props.metadata.diff) !== undefined}>
        <BlockTool title={"← Edit " + pathFormatter.format(stringValue(props.input.filePath))} part={props.part}>
          <box paddingLeft={1}>
            <diff
              diff={diffContent()}
              view={view()}
              filetype={ft()}
              syntaxStyle={syntax()}
              showLineNumbers={true}
              width="100%"
              wrapMode={ctx.diffWrapMode()}
              fg={theme.text}
              addedBg={theme.diffAddedBg}
              removedBg={theme.diffRemovedBg}
              contextBg={theme.diffContextBg}
              addedSignColor={theme.diffHighlightAdded}
              removedSignColor={theme.diffHighlightRemoved}
              lineNumberFg={theme.diffLineNumber}
              lineNumberBg={theme.diffContextBg}
              addedLineNumberBg={theme.diffAddedLineNumberBg}
              removedLineNumberBg={theme.diffRemovedLineNumberBg}
            />
          </box>
          <Diagnostics diagnostics={props.metadata.diagnostics} filePath={stringValue(props.input.filePath) ?? ""} />
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool
          pending="正在准备编辑..."
          complete={stringValue(props.input.filePath)}
          part={props.part}
          label={{
            name: "编辑",
            params: [
              pathFormatter.format(stringValue(props.input.filePath)),
              toolParams({ replaceAll: props.input.replaceAll }),
            ]
              .filter(Boolean)
              .join(" "),
          }}
        />
      </Match>
    </Switch>
  )
}

function ApplyPatch(props: ToolProps) {
  const ctx = use()
  const { theme, syntax } = useTheme()
  const pathFormatter = usePathFormatter()

  const files = createMemo(() => parseApplyPatchFiles(props.metadata.files))

  // 与 Edit 同一把尺子(见 toolDiffView):阈值跟着消息列算,不写死终端宽度。
  const view = createMemo(() => toolDiffView(ctx.width, ctx.tui.diff_style === "stacked"))

  function Diff(p: { diff: string; filePath: string }) {
    return (
      <box paddingLeft={1}>
        <diff
          diff={p.diff}
          view={view()}
          filetype={filetype(p.filePath)}
          syntaxStyle={syntax()}
          showLineNumbers={true}
          width="100%"
          wrapMode={ctx.diffWrapMode()}
          fg={theme.text}
          addedBg={theme.diffAddedBg}
          removedBg={theme.diffRemovedBg}
          contextBg={theme.diffContextBg}
          addedSignColor={theme.diffHighlightAdded}
          removedSignColor={theme.diffHighlightRemoved}
          lineNumberFg={theme.diffLineNumber}
          lineNumberBg={theme.diffContextBg}
          addedLineNumberBg={theme.diffAddedLineNumberBg}
          removedLineNumberBg={theme.diffRemovedLineNumberBg}
        />
      </box>
    )
  }

  function title(file: { type: string; relativePath: string; filePath: string; deletions: number }) {
    if (file.type === "delete") return "# 删除 " + file.relativePath
    if (file.type === "add") return "# 创建 " + file.relativePath
    if (file.type === "move") return "# 移动 " + pathFormatter.format(file.filePath) + " → " + file.relativePath
    return "← 补丁 " + file.relativePath
  }

  return (
    <Switch>
      <Match when={files().length > 0}>
        <For each={files()}>
          {(file) => (
            <BlockTool title={title(file)} part={props.part}>
              <Show
                when={file.type !== "delete"}
                fallback={
                  <text fg={theme.diffRemoved}>
                    -{file.deletions} line{file.deletions !== 1 ? "s" : ""}
                  </text>
                }
              >
                <Diff diff={file.patch} filePath={file.filePath} />
                <Diagnostics diagnostics={props.metadata.diagnostics} filePath={file.movePath ?? file.filePath} />
              </Show>
            </BlockTool>
          )}
        </For>
      </Match>
      <Match when={true}>
        <InlineTool
          pending="正在准备补丁..."
          failure="补丁失败"
          complete={false}
          part={props.part}
          label={{ name: "补丁" }}
        />
      </Match>
    </Switch>
  )
}

function TodoWrite(props: ToolProps) {
  const todos = createMemo(() => parseTodos(props.input.todos))
  return (
    <Switch>
      <Match when={parseTodos(props.metadata.todos).length}>
        <BlockTool title="# 待办事项" part={props.part}>
          <box>
            <For each={todos()}>{(todo) => <TodoItem status={todo.status} content={todo.content} />}</For>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool pending="正在更新待办事项..." failure="待办事项更新失败" complete={false} part={props.part}>
          更新待办事项中...
        </InlineTool>
      </Match>
    </Switch>
  )
}

function Question(props: ToolProps) {
  const { theme } = useTheme()
  const questions = createMemo(() => parseQuestions(props.input.questions))
  const answers = createMemo(() => parseQuestionAnswers(props.metadata.answers))
  const count = createMemo(() => questions().length)

  function format(answer?: ReadonlyArray<string>) {
    if (!answer?.length) return "(未回答)"
    return answer.join(", ")
  }

  return (
    <Switch>
      <Match when={answers()}>
        <BlockTool title="# 问题" part={props.part}>
          <box gap={1}>
            <For each={questions()}>
              {(q, i) => (
                <box flexDirection="column">
                  <text fg={theme.textMuted}>{q.question}</text>
                  <text fg={theme.text}>{format(answers()?.[i()])}</text>
                </box>
              )}
            </For>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool
          pending="提问中..."
          complete={count()}
          part={props.part}
          label={{ name: "提问", params: `${count()} 个问题` }}
        />
      </Match>
    </Switch>
  )
}

function Skill(props: ToolProps) {
  return (
    <InlineTool
      pending="正在加载技能..."
      complete={stringValue(props.input.name)}
      part={props.part}
      label={{ name: "技能", params: `"${toolLine(props.input.name)}"` }}
    />
  )
}

// LSP 诊断信息的单行上限。
const DIAGNOSTIC_MESSAGE_MAX = 200

function Diagnostics(props: { diagnostics: unknown; filePath: string }) {
  const { theme } = useTheme()
  const terminalEnvironment = useTuiTerminalEnvironment()
  const errors = createMemo(() => {
    const normalized = normalizePath(
      typeof props.filePath === "string" ? props.filePath : "",
      terminalEnvironment.platform,
    )
    return parseDiagnostics(props.diagnostics, normalized)
  })

  return (
    <Show when={errors().length}>
      <box>
        <For each={errors()}>
          {(diagnostic) => (
            <text fg={theme.error}>
              错误 [{diagnostic.range.start.line + 1}:{diagnostic.range.start.character + 1}]{" "}
              {/* LSP 的 message 经常是多行的(TS 的嵌套类型错误尤其),压成一行再交给渲染器折行 */}
              {Locale.oneLine(diagnostic.message, DIAGNOSTIC_MESSAGE_MAX)}
            </text>
          )}
        </For>
      </box>
    </Show>
  )
}

// 单个参数值 / 整行参数摘要的显示上限。
// MCP 工具的参数经常是整段文本(sequential-thinking 的 thought 就是几百字带换行的思考过程),
// 原样拼进工具行会变成几十行高的一坨:换行让这一"行"不再是一行,高度失控,
// 行尾的 "]" 还会被甩到下一行的行首,看起来就是 UI 变形。
const INPUT_VALUE_MAX = 80
const INPUT_TOTAL_MAX = 240

export function input(input: Record<string, unknown>, omit?: string[]): string {
  const primitives = Object.entries(input).filter(([key, value]) => {
    if (omit?.includes(key)) return false
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
  })
  if (primitives.length === 0) return ""
  const summary = primitives
    // oneLine 而不是自己 replace:除了换行和连续空白,它还会抹掉 ESC / 响铃这类控制字符 ——
    // 工具参数里的 ESC 原样送到终端就是一段会被解释执行的转义序列。
    .map(([key, value]) => `${key}=${Locale.oneLine(String(value), INPUT_VALUE_MAX)}`)
    .join(", ")
  return `[${Locale.oneLine(summary, INPUT_TOTAL_MAX)}]`
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined
}

// 工具行的单行上限。
// 工具行是"逻辑上的一行":固定宽度的图标列 + flexGrow 的内容列并排。内容里只要有一个 \n,
// 内容列就变成 N 行高而图标列还是 1 行,行尾字符被甩到下一行的行首 —— 这就是截图里那种变形。
// wrapMode="none" 压得住软折行,压不住硬换行,所以必须在数据层压平。
const TOOL_LINE_MAX = 200

/** 取字符串参数并压成一行:凡是把模型给的字符串直接塞进工具行的地方都要走这里。 */
function toolLine(value: unknown, max = TOOL_LINE_MAX) {
  const text = stringValue(value)
  if (text === undefined) return undefined
  return Locale.oneLine(text, max)
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

const toolDisplays = new Set([
  "bash",
  "glob",
  "read",
  "grep",
  "webfetch",
  "websearch",
  "write",
  "edit",
  "task",
  "apply_patch",
  "todowrite",
  "question",
  "skill",
  "execute",
])

export function toolDisplay(tool: string) {
  return toolDisplays.has(tool) ? tool : "generic"
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return
  return value as Record<string, unknown>
}

export function parseApplyPatchFiles(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const file = recordValue(item)
    if (!file) return []
    const type = stringValue(file.type)
    const relativePath = stringValue(file.relativePath)
    const filePath = stringValue(file.filePath)
    const patch = stringValue(file.patch)
    const deletions = numberValue(file.deletions)
    if (!type || !relativePath || !filePath || patch === undefined || deletions === undefined) return []
    return [{ type, relativePath, filePath, patch, deletions, movePath: stringValue(file.movePath) }]
  })
}

export function parseTodos(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const todo = recordValue(item)
    const status = stringValue(todo?.status)
    const content = stringValue(todo?.content)
    return status && content ? [{ status, content }] : []
  })
}

export function parseQuestions(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const question = stringValue(recordValue(item)?.question)
    return question ? [{ question }] : []
  })
}

export function parseQuestionAnswers(value: unknown) {
  if (!Array.isArray(value)) return
  return value.map((answer) =>
    Array.isArray(answer) ? answer.filter((item): item is string => typeof item === "string") : [],
  )
}

export function parseDiagnostics(value: unknown, filePath: string) {
  const diagnostics = recordValue(value)?.[filePath]
  if (!Array.isArray(diagnostics)) return []
  return diagnostics
    .flatMap((item) => {
      const diagnostic = recordValue(item)
      const start = recordValue(recordValue(diagnostic?.range)?.start)
      const line = numberValue(start?.line)
      const character = numberValue(start?.character)
      const message = stringValue(diagnostic?.message)
      if (diagnostic?.severity !== 1 || line === undefined || character === undefined || !message) return []
      return [{ range: { start: { line, character } }, message }]
    })
    .slice(0, 3)
}
