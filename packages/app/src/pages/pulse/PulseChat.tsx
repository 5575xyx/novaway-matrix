import { createEffect, createMemo, createSignal, For, Index, on, onCleanup, onMount, Show } from "solid-js"
import { Icon } from "@novaway/ui/icon"
import { Spinner } from "@novaway/ui/spinner"
import { AssistantParts, Message } from "@novaway/ui/message-part"
import { TextShimmer } from "@novaway/ui/text-shimmer"
import { showToast } from "@novaway/ui/toast"
import type { AssistantMessage, UserMessage } from "@novaway/sdk/v2"
import { useLanguage } from "@/context/language"
import { useLocal } from "@/context/local"
import { useSDK } from "@/context/sdk"
import { useSettings } from "@/context/settings"
import { useSync } from "@/context/sync"

/** 面板里最多渲染多少条消息（与 side-pane-session 的取舍一致）。 */
const MAX_ROWS = 40

/** 运营对话固定用的主 Agent（见 packages/novaway/src/agent/agent.ts）。 */
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

type Attachment = { id: string; filename: string; mime: string; dataUrl: string }

/**
 * 运营工作台右侧的对话区。
 *
 * 对话是**一条真实的服务端会话**，固定用 pulse-orchestrator 主 Agent：
 * 用户说「帮我写篇小红书文案并发布」，由运营主 Agent 拆解、派子 Agent 完成。
 *
 * 渲染和输入框都用应用里标准的那套（Message / AssistantParts / 输入框外壳），
 * 不另起一套气泡样式 —— 用户在哪个界面聊天，观感和操作都该一致。
 *
 * 会话 ID 记在 localStorage：关掉工作台再打开还是同一段对话；会话在服务端已经
 * 不存在时（清库/换机器）会静默作废，下次发送自动新建。
 */
export function PulseChat(props: { directory: string }) {
  const language = useLanguage()
  const sdk = useSDK()
  const sync = useSync()
  const settings = useSettings()
  const local = useLocal()

  const store = createMemo(() => sync.data)

  const [sessionID, setSessionID] = createSignal(readStoredSession(props.directory))
  const [loading, setLoading] = createSignal(false)

  const messages = createMemo(() => {
    const id = sessionID()
    if (!id) return []
    return store().message[id] ?? []
  })

  const clearSession = () => {
    writeStoredSession(props.directory, undefined)
    setSessionID(undefined)
  }

  // 换项目（路由目录变了）时，对话要跟着换：上次的会话属于旧目录。
  createEffect(
    on(
      () => props.directory,
      (dir) => setSessionID(readStoredSession(dir)),
      { defer: true },
    ),
  )

  // 打开工作台时把上次的对话拉回来；会话已被删除（sync 报错）就丢掉记录。
  createEffect(
    on(
      () => sessionID(),
      (id) => {
        if (!id) return
        setLoading(true)
        void sync.session
          .sync(id)
          .catch(() => clearSession())
          .finally(() => setLoading(false))
      },
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

  const partsOf = (messageID: string) => store().part[messageID] ?? []

  const working = createMemo(() => {
    const id = sessionID()
    if (!id) return false
    if ((store().session_status[id]?.type ?? "idle") !== "idle") return true
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

  // —— 发送 —— //
  const [draft, setDraft] = createSignal("")
  const [attachments, setAttachments] = createSignal<Attachment[]>([])
  const [sending, setSending] = createSignal(false)
  let fileInputRef: HTMLInputElement | undefined

  const addFiles = (files: FileList | null) => {
    if (!files) return
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = typeof reader.result === "string" ? reader.result : ""
        if (!dataUrl) return
        setAttachments((current) => [
          ...current,
          { id: `${Date.now()}-${current.length}`, filename: file.name, mime: file.type, dataUrl },
        ])
      }
      reader.readAsDataURL(file)
    }
  }

  /** 首次发送时才建会话：只打开工作台看一眼，不会在任务列表里留下一串空会话。 */
  const ensureSession = async (title: string): Promise<string | undefined> => {
    const existing = sessionID()
    if (existing) return existing
    try {
      const created = await sdk.client.session.create({ title }).then((result) => result.data)
      if (!created?.id) throw new Error("session.create returned no id")
      writeStoredSession(props.directory, created.id)
      setSessionID(created.id)
      return created.id
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("pulse.chat.createFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
      return undefined
    }
  }

  const send = async () => {
    const text = draft().trim()
    const files = attachments()
    if ((!text && files.length === 0) || sending()) return
    const model = local.model.current()
    if (!model) {
      showToast({
        variant: "error",
        title: language.t("prompt.toast.modelAgentRequired.title"),
        description: language.t("prompt.toast.modelAgentRequired.description"),
      })
      return
    }
    setSending(true)
    try {
      const id = await ensureSession(text.slice(0, 60) || language.t("pulse.chat.title"))
      if (!id) return
      await sdk.client.session.promptAsync({
        sessionID: id,
        agent: PULSE_AGENT,
        model: { providerID: model.provider.id, modelID: model.id },
        variant: local.model.variant.current(),
        parts: [
          ...files.map((file) => ({
            type: "file" as const,
            mime: file.mime,
            url: file.dataUrl,
            filename: file.filename,
          })),
          ...(text ? [{ type: "text" as const, text }] : []),
        ],
      })
      setDraft("")
      setAttachments([])
    } catch {
      showToast({
        variant: "error",
        title: language.t("prompt.toast.promptSendFailed.title"),
        description: language.t("prompt.toast.promptSendFailed.description"),
      })
    } finally {
      setSending(false)
    }
  }

  const suggestions = [
    { icon: "📝", text: "写一条小红书种草笔记", desc: "指定产品卖点，直出正文与话题标签" },
    { icon: "🎬", text: "写一条抖音口播脚本", desc: "15 秒钩子 + 正文 + 结尾引导" },
    { icon: "🚀", text: "把这条内容发到所有平台", desc: "自动适配各平台格式后一键发布" },
  ]

  return (
    <div data-component="pulse-chat" class="flex h-full min-h-0 flex-col">
      {/* 列标题：让这块和平台网页区分开，并提供"新对话"入口。 */}
      <div class="flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-3">
        <Icon name="speech-bubble" size="small" class="text-foreground-subtle" />
        <span class="text-12-medium text-foreground">{language.t("pulse.chat.title")}</span>
        <div class="flex-1" />
        <Show when={!!sessionID()}>
          <button
            type="button"
            class="flex size-6 items-center justify-center rounded-[6px] text-foreground-subtle hover:bg-hover hover:text-foreground"
            aria-label={language.t("pulse.chat.new")}
            title={language.t("pulse.chat.new")}
            onClick={clearSession}
          >
            <Icon name="plus" size="small" />
          </button>
        </Show>
      </div>
      <div ref={(el) => (scrollRef = el)} class="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        <Show
          when={rows().length > 0}
          fallback={
            <Show
              when={!loading()}
              fallback={
                <div class="flex h-full items-center justify-center gap-2 text-ui-caption text-foreground-subtle">
                  <Spinner class="size-4" />
                  {language.t("common.loading")}
                </div>
              }
            >
              <div class="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
                <div
                  class="flex size-14 items-center justify-center rounded-[14px]"
                  style={{
                    "background-color": "color-mix(in srgb, var(--novaway-mode-color, #FF6B6B) 10%, transparent)",
                  }}
                >
                  <Icon name="autopilot" class="size-6" />
                </div>
                <p class="text-ui-caption leading-5 text-foreground-subtle">{language.t("pulse.chat.empty")}</p>
                <div class="flex w-full flex-col gap-1.5">
                  <For each={suggestions}>
                    {(item) => (
                      <button
                        type="button"
                        class="flex w-full items-start gap-2 rounded-[8px] border border-border bg-background px-3 py-2 text-left transition-colors hover:border-primary hover:bg-hover"
                        onClick={() => setDraft(item.text)}
                      >
                        <span class="text-sm leading-5">{item.icon}</span>
                        <span class="flex min-w-0 flex-col">
                          <span class="truncate text-12-medium text-foreground">{item.text}</span>
                          <span class="truncate text-11-regular text-foreground-subtle">{item.desc}</span>
                        </span>
                      </button>
                    )}
                  </For>
                </div>
              </div>
            </Show>
          }
        >
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
        </Show>
        <Show when={hidden() > 0}>
          <div class="px-1 py-1.5 text-ui-xs text-foreground-subtlest">
            {language.t("pulse.chat.recent", { count: rows().length, total: messages().length })}
          </div>
        </Show>
      </div>

      <div class="shrink-0 px-2 pb-2">
        <div class="rounded-2xl border border-input-border bg-input p-3 transition-colors hover:border-input-border-hover focus-within:border-input-border-focused focus-within:bg-input-focused">
          <Show when={attachments().length > 0}>
            <div class="mb-2 flex flex-wrap gap-2">
              <For each={attachments()}>
                {(file) => (
                  <div class="group relative size-14 overflow-hidden rounded-md border border-border">
                    <img src={file.dataUrl} alt={file.filename} class="size-full object-cover" />
                    <button
                      type="button"
                      class="absolute right-0.5 top-0.5 flex size-5 items-center justify-center rounded bg-background/80 text-foreground-subtle"
                      aria-label={language.t("prompt.attachment.remove")}
                      onClick={() => setAttachments((current) => current.filter((item) => item.id !== file.id))}
                    >
                      <Icon name="close-small" size="small" />
                    </button>
                  </div>
                )}
              </For>
            </div>
          </Show>
          <textarea
            value={draft()}
            rows={2}
            placeholder={language.t("pulse.chat.placeholder")}
            class="max-h-40 min-h-14 w-full resize-none bg-transparent px-2.5 py-2 text-13-regular leading-6 text-foreground outline-none placeholder:text-foreground-subtlest"
            onInput={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              // 输入法组字期间的回车不算发送。
              if (event.isComposing) return
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            }}
          />
          <div class="flex items-center gap-1 px-1 pt-1">
            <input
              ref={(el) => (fileInputRef = el)}
              type="file"
              accept="image/*"
              multiple
              class="hidden"
              onChange={(event) => {
                addFiles(event.currentTarget.files)
                event.currentTarget.value = ""
              }}
            />
            <button
              type="button"
              class="flex size-8 items-center justify-center rounded-[8px] text-icon-blue hover:bg-hover"
              aria-label={language.t("prompt.action.attachFile")}
              onClick={() => fileInputRef?.click()}
            >
              <Icon name="link" class="size-4.5" />
            </button>
            <div class="flex-1" />
            <Show
              when={sending()}
              fallback={
                <button
                  type="button"
                  class="flex size-8 shrink-0 items-center justify-center rounded-full p-0 text-white disabled:opacity-50"
                  style={{ background: "linear-gradient(135deg, var(--novaway-mode-color, #FF6B6B), #e05555)" }}
                  disabled={!draft().trim() && attachments().length === 0}
                  aria-label={language.t("prompt.action.send")}
                  onClick={() => void send()}
                >
                  <Icon name="paper-plane" size="small" />
                </button>
              }
            >
              <Spinner class="m-1.5 size-4 shrink-0 text-foreground-subtlest" />
            </Show>
          </div>
        </div>
      </div>
    </div>
  )
}

