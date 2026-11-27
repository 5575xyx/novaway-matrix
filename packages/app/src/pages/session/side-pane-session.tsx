import { createEffect, createMemo, createSignal, For, Index, on, onCleanup, Show } from "solid-js"
import { Button } from "@novaway/ui/button"
import { Icon } from "@novaway/ui/icon"
import { Spinner } from "@novaway/ui/spinner"
import {
  Message,
  mergeReasoningParts,
  Part as MessagePart,
  partDefaultOpen,
  renderable,
} from "@novaway/ui/message-part"
import { TextShimmer } from "@novaway/ui/text-shimmer"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { SideChatComposer } from "@/pages/session/side-chat-composer"
import { useSideChat } from "@/pages/session/use-side-chat"
import { useSync } from "@/context/sync"
import { createAdaptivePoll } from "@/utils/adaptive-poll"
import { useLayout, type SidePaneSessionTab } from "@/context/layout"
import { useSettings } from "@/context/settings"
import { usePermission } from "@/context/permission"
import { base64Encode } from "@novaway/core/util/encode"
import type { AssistantMessage, Part, UserMessage } from "@novaway/sdk/v2"
import { TurnFoldView } from "./turn-fold-view"
import { workingActivity } from "./working-status"
import { useWorkingPhrase } from "./use-working-phrase"
import { sessionPermissionRequest, sessionQuestionRequest } from "./composer/session-request-tree"

/** 面板里最多渲染多少条消息（更早的请点"打开完整会话"）。 */
const MAX_ROWS = 40

type SidePaneTurnData = { user?: UserMessage; assistants: AssistantMessage[]; key: string }
type SidePaneEntry = { message: AssistantMessage; part: Part }
type SidePaneBlock = { kind: "process" | "outside"; entries: SidePaneEntry[] }

const isInteractivePart = (part: Part) =>
  part.type === "tool" && (part.tool === "question" || part.tool === "plan_exit" || part.tool === "review_document")

const partTime = (part: Part, message: AssistantMessage) => {
  if (part.type === "tool") {
    if (part.state.status === "pending") return { start: undefined, end: undefined }
    return { start: part.state.time.start, end: part.state.status === "running" ? undefined : part.state.time.end }
  }
  if (part.type === "text" || part.type === "reasoning") {
    return { start: part.time?.start ?? message.time.created, end: part.time?.end ?? message.time.completed }
  }
  return { start: message.time.created, end: message.time.completed }
}

function formatSidePaneDuration(ms: number | undefined, language: ReturnType<typeof useLanguage>) {
  if (ms === undefined || ms < 0) return ""
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return language.t("session.turn.fold.durationSec", { seconds })
  return language.t("session.turn.fold.durationMinSec", {
    minutes: Math.floor(seconds / 60),
    seconds: seconds % 60,
  })
}

function SidePaneAssistantPart(props: {
  entry: SidePaneEntry
  shellToolDefaultOpen: boolean
  editToolDefaultOpen: boolean
}) {
  return (
    <div data-timeline-row="AssistantPart" class="min-w-0 w-full">
      <div data-slot="session-turn-message-container" class="w-full">
        <div class="flex min-w-0 items-start gap-3">
          <div data-slot="assistant-avatar-spacer" class="mt-0.5 size-8 shrink-0" aria-hidden="true" />
          <div class="min-w-0 flex-1">
            <div data-slot="session-turn-assistant-content" class="min-w-0">
              <MessagePart
                part={props.entry.part}
                message={props.entry.message}
                defaultOpen={partDefaultOpen(props.entry.part, props.shellToolDefaultOpen, props.editToolDefaultOpen)}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function SidePaneAssistantTurn(props: {
  turn: SidePaneTurnData
  partsOf: (messageID: string) => Part[]
  working: boolean
  workingLabel: string
  showReasoningSummaries: boolean
  shellToolDefaultOpen: boolean
  editToolDefaultOpen: boolean
}) {
  const language = useLanguage()
  const [touched, setTouched] = createSignal<Record<string, boolean>>({})

  const entries = createMemo<SidePaneEntry[]>(() => {
    const result: SidePaneEntry[] = []
    for (const message of props.turn.assistants) {
      for (const part of props.partsOf(message.id)) {
        if (!renderable(part, props.showReasoningSummaries)) continue
        const previous = result.at(-1)
        if (part.type === "reasoning" && previous?.part.type === "reasoning") {
          previous.part = mergeReasoningParts([previous.part, part]) ?? previous.part
          continue
        }
        result.push({ message, part })
      }
    }
    return result
  })

  const blocks = createMemo<SidePaneBlock[]>(() => {
    const result: SidePaneBlock[] = []
    for (const entry of entries()) {
      const process = entry.part.type === "reasoning" || (entry.part.type === "tool" && !isInteractivePart(entry.part))
      const previous = result.at(-1)
      if (previous?.kind === (process ? "process" : "outside")) previous.entries.push(entry)
      else result.push({ kind: process ? "process" : "outside", entries: [entry] })
    }
    return result
  })

  const processIndexes = createMemo(() =>
    blocks()
      .map((block, index) => (block.kind === "process" ? index : -1))
      .filter((index) => index >= 0),
  )

  const processLabel = (block: SidePaneBlock, index: number) => {
    const toolCount = block.entries.filter((entry) => entry.part.type === "tool").length
    const count = toolCount || block.entries.length
    const active = props.working && index === processIndexes().at(-1)
    if (active && props.workingLabel) return props.workingLabel
    const times = block.entries.map((entry) => partTime(entry.part, entry.message))
    const start = times.reduce<number | undefined>(
      (value, time) =>
        time.start === undefined ? value : value === undefined ? time.start : Math.min(value, time.start),
      undefined,
    )
    const end = times.reduce<number | undefined>(
      (value, time) => (time.end === undefined ? value : value === undefined ? time.end : Math.max(value, time.end)),
      undefined,
    )
    const duration = formatSidePaneDuration(
      start !== undefined && end !== undefined ? end - start : undefined,
      language,
    )
    const steps = language.t("session.turn.fold.steps", { count })
    return duration ? `${steps} · ${duration}` : steps
  }

  const renderEntries = (entries: SidePaneEntry[]) => (
    <div data-component="turn-fold-rows" data-tool-density="compact">
      <For each={entries}>
        {(entry) => (
          <SidePaneAssistantPart
            entry={entry}
            shellToolDefaultOpen={props.shellToolDefaultOpen}
            editToolDefaultOpen={props.editToolDefaultOpen}
          />
        )}
      </For>
    </div>
  )

  return (
    <div data-component="side-pane-turn" class="min-w-0 w-full">
      <For each={blocks()}>
        {(block, index) => {
          const isProcess = () => block.kind === "process"
          const key = () => block.entries[0]?.part.id ?? `${props.turn.key}:${index()}`
          const active = () => props.working && index() === processIndexes().at(-1)
          const open = () => touched()[key()] ?? active()
          return (
            <Show
              when={isProcess()}
              fallback={block.entries.map((entry) => (
                <SidePaneAssistantPart
                  entry={entry}
                  shellToolDefaultOpen={props.shellToolDefaultOpen}
                  editToolDefaultOpen={props.editToolDefaultOpen}
                />
              ))}
            >
              <TurnFoldView
                label={processLabel(block, index())}
                open={open()}
                working={active()}
                onToggle={() => setTouched((current) => ({ ...current, [key()]: !open() }))}
              >
                {renderEntries(block.entries)}
              </TurnFoldView>
            </Show>
          )
        }}
      </For>
    </div>
  )
}

/**
 * Side Pane 里的**会话面板**：子代理钻取与侧边对话共用。
 *
 * 两者都是"在右侧面板里看另一个会话"，而不是整页跳走 —— 整页跳会把主线从眼前挪走。
 *
 * 这里复用主时间线的过程分组、思考和工具卡片渲染，只保留右侧面板需要的历史窗口与只读行为。
 */
export function SidePaneSessionPanel(props: { tab: SidePaneSessionTab }) {
  const language = useLanguage()
  const sdk = useSDK()
  const sync = useSync()
  const layout = useLayout()
  const sideChat = useSideChat()
  const permission = usePermission()

  const directory = createMemo(() => sdk.directory)
  // `sync.data` 就是当前 directory 的会话 store（message / part 都挂在上面）。
  const store = createMemo(() => sync.data)

  /**
   * 面板一打开就把这条会话的消息拉进来。
   *
   * 子会话/辅助对话通常从没被打开过，`sync.data.message[id]` 是空的 ——
   * 不主动 sync 的话面板永远显示"还没有消息"（挂载即 acquire 租约、
   * 由数据层负责取数）。
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
            // 而不是留一个永远报错的空面板：监听 sessionNotFound 后清 tab，
            // 下一次框选按父会话重建。
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

  /** 取最近 N 条：面板只有 360px 宽，渲染整条会话既慢也没意义。
   *
   * 起点必须回退到最近的 user 消息，否则会切在某一轮中间：子代理一轮能跑出几十条
   * assistant 消息（每次工具调用/生成都是一条），切掉开头那条 user 后 `turns` 里
   * 一条轮次都组不出来 —— 面板就整片空白（而且是"看一会才空"，越跑越多才越过 40 条）。
   */
  const rows = createMemo(() => {
    const all = messages()
    if (all.length <= MAX_ROWS) return all
    let start = all.length - MAX_ROWS
    while (start > 0 && all[start]?.role !== "user") start--
    return all.slice(start)
  })
  const hidden = createMemo(() => Math.max(0, messages().length - rows().length))
  const emptyIcon = () => (props.tab.kind === "subagent" ? "task" : "speech-bubble")

  /**
   * 按「用户轮次」分组，渲染方式与主聊天区一致：
   * 用户消息 → 该轮的 assistant 消息（工具调用/思考/正文由 AssistantParts 统一分组）。
   * 之前这里是「一条 Message 一行」，工具调用和思考都不显示，面板看起来像空白的。
   */
  const turns = createMemo<SidePaneTurnData[]>(() => {
    const result: SidePaneTurnData[] = []
    for (const message of rows()) {
      if (message.role === "user") {
        result.push({ user: message, assistants: [], key: message.id })
        continue
      }
      const current = result.at(-1)
      if (!current) {
        // 没有 user 打头的 assistant（例如窗口从某轮中间开始）也要能渲染，
        // 否则整段内容会被丢掉、面板变空白。
        result.push({ assistants: [message], key: `assistant:${message.id}` })
        continue
      }
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

  // 与主聊天区/输入框状态条共用 workingActivity 一份推导：文案随本轮真正在动的东西变。
  const turnParts = createMemo(
    () =>
      turns()
        .at(-1)
        ?.assistants.flatMap((message) => partsOf(message.id)) ?? [],
  )
  const workWaiting = createMemo((): "permission" | "question" | undefined => {
    const id = props.tab.sessionID
    if (
      sessionPermissionRequest(
        store().session,
        store().permission,
        id,
        (item) => !permission.autoResponds(item, sdk.directory),
      )
    )
      return "permission"
    if (sessionQuestionRequest(store().session, store().question, id)) return "question"
    return undefined
  })
  const workActivity = createMemo(() =>
    workingActivity({
      status: store().session_status[props.tab.sessionID],
      waiting: workWaiting(),
      parts: turnParts(),
    }),
  )
  const workPhrase = useWorkingPhrase(workActivity)

  /**
   * 兜底轮询：侧栏里的子会话偶尔收不到实时事件（消息已落库但 store 不更新），
   * 表现为「发了消息但面板还是空的」。这是**全量** sync（拉整段消息 + parts），
   * 所以只在面板真的展开时才跑：侧栏是"常驻 + 宽度归 0"的收起方式，DOM 一直挂着，
   * 不门控的话关掉侧栏之后还在每 2 秒重拉一遍整段会话。
   */
  const isVisible = () => layout.sidePane.opened() && layout.sidePane.activeSessionTab()?.id === props.tab.id
  const poll = createAdaptivePoll(
    () => void sync.session.sync(props.tab.sessionID, { force: true }).catch(() => undefined),
    {
      fast: 2000,
      idle: 12_000,
      active: () => working(),
      visible: isVisible,
    },
  )
  onCleanup(() => poll.stop())

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

  // 与主聊天区一致:工作中一直显示实时耗时(工作中 · X 秒)。
  const [now, setNow] = createSignal(Date.now())
  createEffect(() => {
    if (!working() || !isVisible()) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => clearInterval(timer))
  })
  const thinkingStartedAt = createMemo(() => {
    const turn = turns().at(-1)
    const values = [turn?.user?.time?.created, ...(turn?.assistants ?? []).map((message) => message.time?.created)]
    return values
      .filter((value): value is number => typeof value === "number")
      .reduce<number | undefined>((min, value) => (min === undefined ? value : Math.min(min, value)), undefined)
  })
  const thinkingLabel = createMemo(() => {
    const phrase = workPhrase()
    const start = thinkingStartedAt()
    if (typeof start !== "number") return phrase
    const seconds = Math.max(0, Math.floor((now() - start) / 1000))
    const elapsed =
      seconds < 60
        ? language.t("session.turn.fold.durationSec", { seconds })
        : language.t("session.turn.fold.durationMinSec", {
            minutes: Math.floor(seconds / 60),
            seconds: seconds % 60,
          })
    return `${phrase} · ${elapsed}`
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
        {/* 类别徽标：在子代理摘要行/钻取面板里标出"这是什么"。
            我们只有 kind 两档，够区分就够了。 */}
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
                    <Icon name="circle-ban-sign" size="small" class="text-icon-critical-base" />
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
                  <div class="flex flex-col gap-2">
                    <Show when={turn().user}>{(user) => <Message message={user()} parts={partsOf(user().id)} />}</Show>
                    <div
                      data-slot="side-pane-assistant"
                      class="flex flex-col items-start gap-2"
                      data-tool-density="compact"
                    >
                      <SidePaneAssistantTurn
                        turn={turn()}
                        partsOf={partsOf}
                        working={working() && turn().key === turns().at(-1)?.key}
                        workingLabel={thinkingLabel()}
                        showReasoningSummaries={settings.general.showReasoningSummaries()}
                        shellToolDefaultOpen={settings.general.shellToolPartsExpanded()}
                        editToolDefaultOpen={settings.general.editToolPartsExpanded()}
                      />
                    </div>
                  </div>
                )
              }}
            </Index>
            <Show when={showThinking()}>
              <div class="flex items-center gap-2 pl-1 text-ui-caption text-foreground-subtle">
                <Spinner class="size-3" />
                <TextShimmer text={thinkingLabel()} />
              </div>
            </Show>
            <Show when={errorText()}>
              <div class="rounded-md border border-critical-base/40 bg-surface-critical-weak px-2.5 py-2 text-ui-caption leading-5 text-foreground-subtle">
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
