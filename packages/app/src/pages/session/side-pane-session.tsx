import { createEffect, createMemo, createSignal, Index, on, onCleanup, onMount, Show } from "solid-js"
import { Button } from "@novaway/ui/button"
import { Icon } from "@novaway/ui/icon"
import { Spinner } from "@novaway/ui/spinner"
import { AssistantParts, Message } from "@novaway/ui/message-part"
import { TextShimmer } from "@novaway/ui/text-shimmer"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { SideChatComposer } from "@/pages/session/side-chat-composer"
import { useSideChat } from "@/pages/session/use-side-chat"
import { useSync } from "@/context/sync"
import { useLayout, type SidePaneSessionTab } from "@/context/layout"
import { useSettings } from "@/context/settings"
import { base64Encode } from "@novaway/core/util/encode"
import type { AssistantMessage, UserMessage } from "@novaway/sdk/v2"

/** 面板里最多渲染多少条消息（更早的请点"打开完整会话"）。 */
const MAX_ROWS = 40

/**
 * Side Pane 里的**会话面板**：子代理钻取与侧边对话共用。
 *
 * 对齐 ZCode 的 `SubagentDrilldown` / `SelectionSideChatPane`：
 * 两者都是"在右侧面板里看另一个会话"，而不是整页跳走 —— 整页跳会把主线从眼前挪走。
 *
 * 与 ZCode 的差别（刻意简化，避免把主时间线那套虚拟滚动/历史窗口搬进 360px 的面板）：
 * - **不虚拟化**，只渲染最近 `MAX_ROWS` 条；
 * - **只读**：不提供 fork / retry / 编辑。要这些能力点顶部的"在主线打开"回到完整会话。
 *
 * 两种标签的区别只在于**关闭时是否删除服务端会话**（调用方负责，见 `closeSessionTab`）：
 * 子代理的会话属于父会话的一部分，关了面板不该消失；侧边对话是关掉即删。
 */
export function SidePaneSessionPanel(props: { tab: SidePaneSessionTab }) {
  const language = useLanguage()
  const sdk = useSDK()
  const sync = useSync()
  const layout = useLayout()
  const sideChat = useSideChat()

  const directory = createMemo(() => sdk.directory)
  // `sync.data` 就是当前 directory 的会话 store（message / part 都挂在上面）。
  const store = createMemo(() => sync.data)

  /**
   * 面板一打开就把这条会话的消息拉进来。
   *
   * 子会话/辅助对话通常从没被打开过，`sync.data.message[id]` 是空的 ——
   * 不主动 sync 的话面板永远显示"还没有消息"（对齐 ZCode
   * `SubagentDrilldown` 挂载即 acquire 租约、由数据层负责取数）。
   */
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | undefined>()
  createEffect(
    on(
      () => props.tab.sessionID,
      (id) => {
        setLoading(true)
        setError(undefined)
        void sync.session
          .sync(id)
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err)
            // 会话在服务端已经不存在（CLI 重启后临时会话丢失）→ 静默收掉标签，
            // 而不是留一个永远报错的空面板。对齐 ZCode 的
            // `onSelectionSideChatUnavailable`（它监听 sessionNotFound 后清 tab，
            // 下一次框选按父会话重建）。
            if (message.includes("sessionNotFound") || message.includes("NotFound")) {
              if (props.tab.kind === "sideChat") sideChat.drop(props.tab)
              else layout.sidePane.closeSession(props.tab.id)
              return
            }
            setError(message)
          })
          .finally(() => setLoading(false))
      },
      { defer: false },
    ),
  )

  // `message[sessionID]` 直接就是按 id 排好序的 Message 数组（见 event-reducer 的单测）。
  const messages = createMemo(() => store().message[props.tab.sessionID] ?? [])

  /** 取最近 N 条：面板只有 360px 宽，渲染整条会话既慢也没意义。 */
  const rows = createMemo(() => messages().slice(-MAX_ROWS))
  const hidden = createMemo(() => Math.max(0, messages().length - rows().length))
  const emptyIcon = () => (props.tab.kind === "subagent" ? "task" : "speech-bubble")

  /**
   * 按「用户轮次」分组，渲染方式与主聊天区一致：
   * 用户消息 → 该轮的 assistant 消息（工具调用/思考/正文由 AssistantParts 统一分组）。
   * 之前这里是「一条 Message 一行」，工具调用和思考都不显示，面板看起来像空白的。
   */
  type Turn = { user: UserMessage; assistants: AssistantMessage[]; key: string }
  const turns = createMemo<Turn[]>(() => {
    const result: Turn[] = []
    for (const message of rows()) {
      if (message.role === "user") {
        result.push({ user: message, assistants: [], key: message.id })
        continue
      }
      const current = result.at(-1)
      if (!current) continue
      current.assistants.push(message)
    }
    return result
  })

  const settings = useSettings()

  const partsOf = (messageID: string) => store().part[messageID] ?? []

  const working = createMemo(() => {
    if ((store().session_status[props.tab.sessionID]?.type ?? "idle") !== "idle") return true
    // 面板里的会话不一定收到 session_status 事件，用「最后一条 assistant 还没完成」兜底。
    const last = messages().at(-1)
    return !!last && last.role === "assistant" && typeof last.time?.completed !== "number"
  })

  /**
   * 兜底轮询：侧栏里的子会话偶尔收不到实时事件（消息已落库但 store 不更新），
   * 表现为「发了消息但面板还是空的」。面板打开期间每 2 秒强制同步一次，
   * 关闭即停 —— 这是本地请求，代价远小于让用户手动重开面板。
   */
  onMount(() => {
    const timer = setInterval(() => {
      void sync.session.sync(props.tab.sessionID, { force: true }).catch(() => undefined)
    }, 2000)
    onCleanup(() => clearInterval(timer))
  })

  /**
   * 是否显示"正在思考"占位。
   *
   * 只在「这一轮还没有任何可渲染内容」时显示：一旦有工具卡片/正文，
   * 工具行自己的状态已经说明在跑，再叠一个思考提示会重复。
   * 提问（question）卡片等待用户作答时也不显示 —— 那不是思考。
   */
  const showThinking = createMemo(() => {
    if (!working()) return false
    const turn = turns().at(-1)
    if (!turn) return false
    return !turn.assistants.some((message) =>
      partsOf(message.id).some((part) => {
        if (part.type === "text") return !!part.text?.trim()
        if (part.type === "reasoning") return !!part.text?.trim()
        if (part.type === "tool") return part.state.status !== "pending" || part.tool !== "question"
        return false
      }),
    )
  })

  /** 流式输出时跟着底部走：面板不会自动滚，用户得手动追着看。 */
  let scrollRef: HTMLDivElement | undefined
  const streamSignature = createMemo(() => {
    const last = messages().at(-1)
    if (!last) return ""
    return `${last.id}:${partsOf(last.id)
      .map((part) => (part.type === "text" || part.type === "reasoning" ? (part.text?.length ?? 0) : 0))
      .join(",")}`
  })
  createEffect(
    on(
      streamSignature,
      () => {
        queueMicrotask(() => {
          scrollRef?.scrollTo({ top: scrollRef.scrollHeight })
        })
      },
      { defer: true },
    ),
  )

  const lastAssistantError = createMemo(() => {
    for (const turn of turns()) {
      for (const message of turn.assistants) {
        if (!message.error) continue
        if (message.error.name === "MessageAbortedError") continue
        return message.error
      }
    }
    return undefined
  })

  const errorText = createMemo(() => {
    const error = lastAssistantError()
    if (!error) return ""
    const data = error.data?.message
    if (typeof data === "string") return data
    return data ? String(data) : error.name
  })

  const openFull = () => {
    // 完整会话走路由（与子代理原来的行为一致），把当前会话切过去。
    window.location.hash = ""
    history.pushState(null, "", `/${base64Encode(directory())}/session/${props.tab.sessionID}`)
    window.dispatchEvent(new PopStateEvent("popstate"))
  }

  return (
    <div data-component="side-pane-session" class="flex h-full min-h-0 flex-col">
      <div class="flex h-9 shrink-0 items-center gap-2 border-b border-border px-2">
        <Icon
          name={props.tab.kind === "subagent" ? "task" : "speech-bubble"}
          size="small"
          class="shrink-0 text-foreground-subtle"
        />
        {/* 类别徽标：对齐 ZCode 在子代理摘要行/钻取面板里标出"这是什么"
            （它显示 subagentType）。我们只有 kind 两档，够区分就够了。 */}
        <span
          data-slot="side-pane-session-kind"
          class="shrink-0 rounded border border-border bg-surface px-1.5 py-0.5 text-ui-xs leading-none text-foreground-subtlest"
        >
          {language.t(props.tab.kind === "subagent" ? "sidePane.subagent" : "sidePane.sideChat")}
        </span>
        <span class="min-w-0 flex-1 truncate text-ui-caption text-foreground" title={props.tab.title}>
          {props.tab.title}
        </span>
        {/* 辅助对话不需要「在主线打开」：主线天然能引用它下级的会话记录，
            再放一个跳转按钮只会让人以为不走这条路就看不到。子代理保留该入口。 */}
        <Show when={props.tab.kind === "subagent"}>
          <Button
            variant="ghost"
            size="small"
            class="shrink-0"
            icon="square-arrow-top-right"
            onClick={openFull}
            aria-label={language.t("sidePane.session.openFull")}
          >
            {language.t("sidePane.session.openFull")}
          </Button>
        </Show>
      </div>

      <Show when={hidden() > 0}>
        <div class="shrink-0 px-3 py-1.5 text-ui-xs text-foreground-subtlest">
          {language.t("sidePane.session.recent", { count: rows().length, total: messages().length })}
        </div>
      </Show>

      <div ref={(el) => (scrollRef = el)} class="flex-1 min-h-0 overflow-y-auto px-3 py-2">
        <Show
          when={rows().length > 0}
          fallback={
            // 三种状态分开：加载中 / 取数失败 / 真的没有消息。
            // 之前只区分了"有没有消息"，新会话会一直转圈、失败的会话则显示成空。
            <Show
              when={!loading()}
              fallback={
                <div class="flex h-full items-center justify-center gap-2 text-ui-caption text-foreground-subtle">
                  <Spinner class="size-4" />
                  {language.t("common.loading")}
                </div>
              }
            >
              <Show
                when={!error()}
                fallback={
                  <div class="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                    <Icon name="circle-ban-sign" size="small" class="text-[var(--destructive)]" />
                    <p class="text-ui-caption leading-5 text-foreground-subtle">{error()}</p>
                  </div>
                }
              >
                <div class="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                  <Icon name={emptyIcon()} size="small" class="text-foreground-subtlest" />
                  <p class="text-ui-caption leading-5 text-foreground-subtle">
                    {language.t(
                      props.tab.kind === "subagent" ? "sidePane.session.emptySubagent" : "sidePane.session.empty",
                    )}
                  </p>
                </div>
              </Show>
            </Show>
          }
        >
          <div class="flex flex-col gap-4">
            <Index each={turns()}>
              {(turnAccessor) => {
                const turn = () => turnAccessor()
                return (
                  <div data-component="side-pane-turn" class="flex flex-col gap-2">
                    <Message message={turn().user} parts={partsOf(turn().user.id)} />
                    <AssistantParts
                      messages={turn().assistants}
                      showReasoningSummaries={settings.general.showReasoningSummaries()}
                    />
                  </div>
                )
              }}
            </Index>
            <Show when={showThinking()}>
              <div class="flex items-center gap-2 pl-1 text-ui-caption text-foreground-subtle">
                <Spinner class="size-3" />
                <TextShimmer text={language.t("ui.sessionTurn.status.thinking")} />
              </div>
            </Show>
            <Show when={errorText()}>
              <div class="rounded-md border border-[var(--destructive)]/40 bg-[var(--destructive)]/5 px-2.5 py-2 text-ui-caption leading-5 text-foreground-subtle">
                {errorText()}
              </div>
            </Show>
          </div>
        </Show>
      </div>

      {/* 侧边对话带自己的输入框：它的全部意义就是"不用切回主线就能问一句"。 */}
      <Show when={props.tab.kind === "sideChat"}>
        <SideChatComposer tab={props.tab} />
      </Show>
    </div>
  )
}

/** 关闭会话标签：只移除标签；是否删除服务端会话由调用方决定（见组件说明）。 */
export function closeSessionTab(tab: SidePaneSessionTab) {
  useLayout().sidePane.closeSession(tab.id)
}
