import { Locale } from "../../util/locale"

/**
 * 聊天区的两种视图(原型 card-design-v7.html 的 `#viewBubble` / `#viewFlow`):
 *
 *   bubble  气泡视图 —— 消息流一列排下来。
 *   flow    流程图卡片视图 —— 节点链式连接的画布(component/flow/canvas.tsx)。
 *
 * 这里只管**取舍**:状态、持久化、斜杠命令解析、以及那两条命令的文案。
 * 真正把消息画成流程图的是画布自己的事。
 */

/** KV 键名。放 KV 而不是组件内 signal:视图是用户挑的偏好,换一次终端、换一次会话都该还在。 */
export const CHAT_VIEW_KEY = "chat_view"

export const CHAT_VIEWS = ["bubble", "flow"] as const
export type ChatView = (typeof CHAT_VIEWS)[number]
export const DEFAULT_CHAT_VIEW: ChatView = "bubble"

/**
 * 每种视图对应的那条斜杠命令。`command` 是英文原名(斜杠菜单里显示中文名,英文原名与 label
 * 都保留为可输入别名,见 keymap.tsx 的 SLASH_ZH);`description` 是命令标题与斜杠菜单说明列
 * 共用的那段文案 —— 原型 card-design-v7.html:1111-1112 那两行的说明。
 *
 * 「✓ 当前」不写在这里:它取决于当前状态,由调用方按 chatView() 拼到标题后面(见 routes/session)。
 */
export const CHAT_VIEW_ITEMS: {
  view: ChatView
  command: string
  label: string
  description: string
}[] = [
  { view: "bubble", command: "layout-bubble", label: "气泡视图", description: "气泡视图(默认)" },
  {
    view: "flow",
    command: "layout-flow",
    label: "流程图视图",
    description: "流程图卡片视图 · 节点链式连接",
  },
]

/** 无参切换用的命令:斜杠菜单里显示为 `/布局`,英文原名 layout 与别名「视图」也都能直接打。 */
export const LAYOUT_COMMAND_NAME = "layout"
export const LAYOUT_COMMAND_ALIASES = ["布局", "视图"]

/** 标签行那颗胶囊上的短名(「视图·气泡」)。比 CHAT_VIEW_ITEMS.label 短,胶囊没那么多列。 */
export function chatViewShort(view: ChatView) {
  return view === "bubble" ? "气泡" : "流程图"
}

export function otherChatView(view: ChatView): ChatView {
  return view === "bubble" ? "flow" : "bubble"
}

// 两个「ok」变体各留一个 `undefined` 字段作显式判别位,调用方才能在 !result.ok 之后
// 直接读 result.view(否则 TS 不会把「ok + view」和「ok + toggle」两支合起来推成同一种类型)。
export type ChatViewCommand =
  /** 目标视图已经确定。 */
  | { ok: true; view: ChatView; toggle?: undefined }
  /** 没给参数:在两个视图之间切换。 */
  | { ok: true; view?: undefined; toggle: true }
  /** 参数不是 bubble/flow(或给了多余的词):调用方据此明确报错,不静默吞掉。 */
  | { ok: false; argument: string }

/**
 * 解析一条客户端视图命令(打回车的那一行)。返回 undefined = 不是本地视图命令,调用方继续
 * 走正常的发送路径。
 *
 * 认得三种写法,都是斜杠菜单里真实存在的名字:
 *   `/布局` `/视图` `/layout`              → 无参,切换
 *   `/布局 flow` `/layout bubble`          → 带参,切到指定视图
 *   `/气泡视图` `/flow` `/layout-flow`     → 直接就是某个视图(斜杠菜单里那两条命令)
 *
 * 斜杠菜单里选中的命令是**立刻派发**的(keymap.tsx 的 useCommandSlashes → dispatchCommand),
 * 不经过输入框;这里是给「手打整行再回车」的那条路用的 —— 与 prompt 里的 exit/quit 同一类。
 */
export function resolveChatViewCommand(line: string): ChatViewCommand | undefined {
  const trimmed = line.trim()
  // 必须真的以斜杠开头:调用方只在输入以「/」开头时才问这里,自己也不该认裸名字 ——
  // 「layout flow」这种句子可能是用户在正常提问。
  if (!trimmed.startsWith("/")) return undefined
  const body = trimmed.slice(1)
  if (!body) return undefined
  const [head = "", ...rest] = body.split(/\s+/)
  const argument = rest.join(" ")

  const direct = CHAT_VIEW_ITEMS.find((item) => item.view === head || item.label === head || item.command === head)
  if (direct) {
    // 直说了是哪个视图,再跟一个参数就是打错了(而不是让它悄悄按 bubble 处理)。
    if (argument) return { ok: false, argument }
    return { ok: true, view: direct.view }
  }

  if (head !== LAYOUT_COMMAND_NAME && !LAYOUT_COMMAND_ALIASES.includes(head)) return undefined
  if (!argument) return { ok: true, toggle: true }
  const view = CHAT_VIEWS.find((item) => item === argument)
  if (!view) return { ok: false, argument }
  return { ok: true, view }
}

/** 参数出错时的提示文案。两个合法值都列出来,用户不用去翻别处。 */
export function chatViewArgumentError(argument: string) {
  return `未知的聊天视图「${Locale.oneLine(argument, 32)}」,可选 ${CHAT_VIEWS.join(" / ")}`
}
