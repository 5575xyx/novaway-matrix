import { base64Encode } from "@novaway/core/util/encode"
import { Icon } from "@novaway/ui/icon"
import { AssistantParts, Message } from "@novaway/ui/message-part"
import { Spinner } from "@novaway/ui/spinner"
import { TextShimmer } from "@novaway/ui/text-shimmer"
import { showToast } from "@novaway/ui/toast"
import type { AssistantMessage, Session, UserMessage } from "@novaway/sdk/v2"
import { useNavigate } from "@solidjs/router"
import { createEffect, createMemo, createSignal, Index, on, onCleanup, onMount, Show } from "solid-js"
import { PromptInput } from "@/components/prompt-input"
import { DraftEmptyState } from "@/components/session/draft-empty-state"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useSettings } from "@/context/settings"
import { useSync } from "@/context/sync"

/** 面板里最多渲染多少条消息（与 side-pane-session 的取舍一致）。 */
const MAX_ROWS = 40

/**
 * 运营对话固定用的主 Agent（见 packages/novaway/src/agent/agent.ts）。
 * 只有角色不同 —— 技能、工具、模型选择、权限档位都和普通会话一样。 */
const PULSE_AGENT = "pulse-orchestrator"

const storageKey = (directory: string) => `novaway.pulse.chat.session.${directory || "default"}`

function readStoredSession(directory: string): string | undefined {
  try {
    return localStorage.getItem(storageKey(directory)) ?? undefined
  } catch {
    return undefined
  }
}

function writeStoredSession(directory: string, sessionID: string | undefined) {
  try {
    if (sessionID) localStorage.setItem(storageKey(directory), sessionID)
    else localStorage.removeItem(storageKey(directory))
  } catch {
    // localStorage 不可用（隐私模式等）时只是不记忆会话，不影响对话本身。
  }
}

/**
 * 运营工作台右侧的对话区。
 *
 * **就是一条普通会话**，区别只在角色固定成 pulse-orchestrator：
 * 输入框用的是会话页那同一个 `PromptInput`（角色 / 模型 / 权限档位 / 附件 /
 * @ 提及 / 技能命令全都在），消息用的是同一套 `Message` + `AssistantParts`。
 * 不另造一套气泡和假 textarea —— 在哪个界面聊天，观感和操作都该一致。
 *
 * 工作台不在会话路由里，所以这里自己管一条会话的生命周期：
 * 打开时复用上次那条（localStorage 按目录记），服务端已经没有了就新建一条。
 */
export function PulseSessionPane(props: { directory: string }) {
  const language = useLanguage()
  const sdk = useSDK()
  const sync = useSync()
  const settings = useSettings()
  const navigate = useNavigate()

  const [session, setSession] = createSignal<Session | undefined>()
  const [loading, setLoading] = createSignal(true)

  const sessionID = createMemo(() => session()?.id)
  const messages = createMemo(() => {
    const id = sessionID()
    if (!id) return []
    return sync.data.message[id] ?? []
  })

  const createSession = async (): Promise<Session | undefined> => {
    const created = await sdk.client.session
      .create({ title: language.t("pulse.chat.title") })
      .then((result) => result.data ?? undefined)
      .catch((error: unknown) => {
        showToast({
          variant: "error",
          title: language.t("pulse.chat.createFailed"),
          description: error instanceof Error ? error.message : String(error),
        })
        return undefined
      })
    if (!created?.id) return undefined
    writeStoredSession(props.directory, created.id)
    return created
  }

  /** 打开面板：先把上次那条会话认回来，认不回来（被删/换机器）就新建。 */
  const bootstrap = async (storedID: string | undefined) => {
    setLoading(true)
    try {
      if (storedID) {
        const restored = await sync.session
          .sync(storedID)
          .then(() => sync.session.get(storedID))
          .catch(() => undefined)
        if (restored) {
          setSession(restored)
          return
        }
        writeStoredSession(props.directory, undefined)
      }
      const created = await createSession()
      if (!created) return
      setSession(created)
      await sync.session.sync(created.id).catch(() => undefined)
    } finally {
      setLoading(false)
    }
  }

  const newChat = async () => {
    writeStoredSession(props.directory, undefined)
    setSession(undefined)
    setLoading(true)
    try {
      const created = await createSession()
      if (!created) return
      setSession(created)
      await sync.session.sync(created.id).catch(() => undefined)
    } finally {
      setLoading(false)
    }
  }

  createEffect(
    on(
      () => props.directory,
      (directory) => void bootstrap(readStoredSession(directory)),
      { defer: false },
    ),
  )

  // 兜底轮询：工作台不是路由级会话页，偶尔收不到实时事件（同 side-pane-session）。
  onMount(() => {
    const timer = setInterval(() => {
      const id = sessionID()
      if (!id) return
      void sync.session.sync(id, { force: true }).catch(() => undefined)
    }, 2000)
    onCleanup(() => clearInterval(timer))
  })

  const rows = createMemo(() => {
    const all = messages()
    if (all.length <= MAX_ROWS) return all
    let start = all.length - MAX_ROWS
    while (start > 0 && all[start]?.role !== "user") start--
    return all.slice(start)
  })
  const hidden = createMemo(() => Math.max(0, messages().length - rows().length))

  type Turn = { user?: UserMessage; assistants: AssistantMessage[]; key: string }
  const turns = createMemo<Turn[]>(() => {
    const result: Turn[] = []
    for (const message of rows()) {
      if (message.role === "user") {
        result.push({ user: message, assistants: [], key: message.id })
        continue
      }
      const current = result.at(-1)
      if (!current) {
        // 窗口从某一轮中间开始（早期消息被裁掉）时，孤立的 assistant 也要能渲染。
        result.push({ assistants: [message], key: `assistant:${message.id}` })
        continue
      }
      current.assistants.push(message)
    }
    return result
  })

  const partsOf = (messageID: string) => sync.data.part[messageID] ?? []

  const working = createMemo(() => {
    const id = sessionID()
    if (!id) return false
    if ((sync.data.session_status[id]?.type ?? "idle") !== "idle") return true
    const last = messages().at(-1)
    return !!last && last.role === "assistant" && typeof last.time?.completed !== "number"
  })

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

  // 流式输出时跟着底部走。
  let scrollRef: HTMLDivElement | undefined
  const scrollToBottom = () => scrollRef?.scrollTo({ top: scrollRef.scrollHeight })
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
        queueMicrotask(scrollToBottom)
      },
      { defer: true },
    ),
  )

  /** 打开完整会话：跳到会话路由（整帧页面会随路由变化自动收起）。 */
  const openFull = () => {
    const id = sessionID()
    if (!id) return
    navigate(`/${base64Encode(props.directory)}/session/${id}`)
  }

  const empty = createMemo(() => messages().length === 0)

  const composer = () => (
    <PromptInput session={session()} agent={PULSE_AGENT} onSubmit={() => queueMicrotask(scrollToBottom)} />
  )

  return (
    <div data-component="pulse-chat" class="flex h-full min-h-0 flex-col">
      {/* 列标题：和平台网页区分开，并提供"新对话 / 打开完整会话"。 */}
      <div class="flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-3">
        <Icon name="speech-bubble" size="small" class="text-foreground-subtle" />
        <span class="text-12-medium text-foreground">{language.t("pulse.chat.title")}</span>
        <div class="flex-1" />
        <Show when={!!sessionID()}>
          <button
            type="button"
            class="flex size-6 items-center justify-center rounded-[6px] text-foreground-subtle hover:bg-hover hover:text-foreground"
            aria-label={language.t("pulse.chat.openFull")}
            title={language.t("pulse.chat.openFull")}
            onClick={openFull}
          >
            <Icon name="expand" size="small" />
          </button>
          <button
            type="button"
            class="flex size-6 items-center justify-center rounded-[6px] text-foreground-subtle hover:bg-hover hover:text-foreground"
            aria-label={language.t("pulse.chat.new")}
            title={language.t("pulse.chat.new")}
            onClick={() => void newChat()}
          >
            <Icon name="plus" size="small" />
          </button>
        </Show>
      </div>

      <Show
        when={!loading() && session()}
        fallback={
          <div class="flex min-h-0 flex-1 items-center justify-center gap-2 text-ui-caption text-foreground-subtle">
            <Spinner class="size-4" />
            {language.t("common.loading")}
          </div>
        }
      >
        <Show
          when={!empty()}
          fallback={
            // 草稿态：和会话页的新会话一模一样 —— 同一句问候、同一个输入框。
            <div class="flex min-h-0 flex-1 flex-col justify-center gap-6 overflow-y-auto px-4 py-4">
              <DraftEmptyState />
              <div class="w-full">{composer()}</div>
            </div>
          }
        >
          <div ref={(el) => (scrollRef = el)} class="min-h-0 flex-1 overflow-y-auto px-3 py-2">
            <div class="flex flex-col gap-4">
              <Index each={turns()}>
                {(turnAccessor) => {
                  const turn = () => turnAccessor()
                  return (
                    <div data-component="pulse-chat-turn" class="flex flex-col gap-2">
                      <Show when={turn().user}>{(user) => <Message message={user()} parts={partsOf(user().id)} />}</Show>
                      <div data-slot="pulse-chat-assistant" class="flex flex-col items-start gap-2">
                        <AssistantParts
                          messages={turn().assistants}
                          showReasoningSummaries={settings.general.showReasoningSummaries()}
                        />
                      </div>
                    </div>
                  )
                }}
              </Index>
              <Show when={showThinking()}>
                <div class="flex items-center gap-2 pl-1 text-ui-caption text-foreground-subtle">
                  <Spinner class="size-3" />
                  <TextShimmer text={language.t("session.turn.fold.working")} />
                </div>
              </Show>
            </div>
            <Show when={hidden() > 0}>
              <div class="px-1 py-1.5 text-ui-xs text-foreground-subtlest">
                {language.t("pulse.chat.recent", { count: rows().length, total: messages().length })}
              </div>
            </Show>
          </div>
          <div class="shrink-0 px-2 pb-2">{composer()}</div>
        </Show>
      </Show>
    </div>
  )
}
