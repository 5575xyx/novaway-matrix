import { useParams } from "@solidjs/router"
import { useLanguage } from "@/context/language"
import { useLayout, sidePaneSideChatTabId, type SidePaneSessionTab } from "@/context/layout"
import { useSDK } from "@/context/sdk"
import { useLocal } from "@/context/local"
import { showToast } from "@novaway/ui/toast"
import { formatServerError } from "@/utils/server-errors"
import { clearSideChatSeed, setSideChatSeed, type SideChatQuote } from "@/pages/session/side-chat-seed"

/** 并发保护：见 `open` 里的说明。 */
let opening = false

/**
 * 侧边对话：一条**不打断主线**的并行小对话。
 *
 * 对齐 ZCode 的 `selection-side-chat`：
 *
 * - 它是一条**真实的服务端会话**（`session.create`），所以有完整的多轮能力、
 *   自动继承工作区上下文（同目录、同项目、同文件可见）；
 * - 但它**不写进主对话历史** —— 主线的时间线里不会冒出这些消息，讨论不会串味；
 * - 生命周期跟着主会话：关掉标签即删除该会话（ZCode 的
 *   `closeSelectionSideChatRuntime` 也是 `closeSession`）。
 *
 * 与子代理钻取的区别就在最后一条：子会话是父任务的产物，关面板不该删；
 * 侧边对话是用户临时开的，关掉就该清掉，否则会在会话列表里堆一地。
 */
export function useSideChat() {
  const language = useLanguage()
  const layout = useLayout()
  const sdk = useSDK()
  const local = useLocal()
  // 辅助对话是**当前主任务的子会话**：parentID 指向主线会话，
  // 这样它会像 ZCode 一样挂在侧栏对应任务的下一级，跟随主线归档/删除。
  const params = useParams()

  /**
   * 打开一条新的辅助对话。同一父会话下可以有多个（用序号区分）。
   *
   * `seed.draft` 只**预填**输入框、不直接发送 —— 用户在文件里选了几行代码
   * 往往还要补一句"这段为什么这么写"。真正发出去由用户在输入框里决定。
   *
   * `opening` 是模块级的进行中标记：选区菜单和侧栏入口都可能在极短时间内
   * 连点两次，`session.create` 是异步的，没有这个标记就会建出两条并行会话
   * （用户看到两个"辅助对话 1"）。吞掉并发调用比事后去重干净。
   */
  const open = async (seed?: {
    text?: string
    draft?: string
    /** 选中内容：作为引用卡片带进输入框，发送时随消息一起给模型。 */
    quote?: SideChatQuote
    parentID?: string
  }) => {
    if (opening) return undefined
    opening = true
    try {
      return await createSideChat(seed)
    } finally {
      opening = false
    }
  }

  const createSideChat = async (seed?: {
    text?: string
    draft?: string
    quote?: SideChatQuote
    parentID?: string
  }) => {
    const parentID = seed?.parentID ?? (params.id ?? "")
    const existing = Object.values(layout.sidePane.dynamicTabs()).filter(
      (tab) => tab.kind === "sideChat" && tab.parentID === parentID,
    )
    try {
      const created = await sdk.client.session
        .create({
          ...(parentID ? { parentID } : {}),
          ...(seed?.text ? { title: seed.text.slice(0, 60) } : {}),
        })
        .then((result) => result.data)
      if (!created?.id) throw new Error("session.create returned no id")
      const tab: SidePaneSessionTab = {
        id: sidePaneSideChatTabId(created.id),
        kind: "sideChat",
        sessionID: created.id,
        parentID,
        // 标题先给占位（会话还没生成标题），用户问第一句后由服务端命名。
        title: language.t("sidePane.sideChat.title", { index: existing.length + 1 }),
      }
      // 用当前选中的 agent/model 发一条种子消息：面板里没有模型选择器，
      // 沿用主线正在用的那个才符合"继承主对话上下文"的预期。
      if (seed?.text?.trim()) {
        const agent = local.agent.current()?.name
        const model = local.model.current()
        if (agent && model) {
          void sdk.client.session
            .promptAsync({
              sessionID: created.id,
              agent,
              model: { providerID: model.provider.id, modelID: model.id },
              parts: [{ type: "text", text: seed.text }],
            })
            .catch(() => undefined)
        }
      }
      // 侧栏任务树里显示的名字：服务端标题生成会覆盖它，但在那之前
      // 「未命名任务」出现在主任务下面会让人不知道那是哪条辅助对话。
      void sdk.client.session
        .update({ sessionID: created.id, title: tab.title })
        .catch(() => undefined)
      if (seed?.draft || seed?.quote) setSideChatSeed(created.id, { draft: seed.draft, quote: seed.quote })
      layout.sidePane.openSession(tab)
      return tab
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("sidePane.sideChat.failed"),
        description: formatServerError(err, language.t, language.t("error.chain.unknown")),
      })
      return undefined
    }
  }

  /** 关闭：先删服务端会话，再移除标签（顺序反了会留下没有面板可关的孤儿会话）。 */
  const close = async (tab: SidePaneSessionTab) => {
    clearSideChatSeed(tab.sessionID)
    layout.sidePane.closeSession(tab.id)
    await sdk.client.session.delete({ sessionID: tab.sessionID }).catch(() => undefined)
  }

  /**
   * 会话在服务端已经不存在（CLI 重启后临时会话丢失）→ 静默收掉标签。
   *
   * 对齐 ZCode 的 `onSelectionSideChatUnavailable`：它监听 `sessionNotFound`
   * 并清 tab，「下一次框选按父会话重建」。这里提供同一个能力给面板调用。
   */
  const drop = (tab: SidePaneSessionTab) => {
    layout.sidePane.closeSession(tab.id)
  }

  return { open, close, drop }
}
