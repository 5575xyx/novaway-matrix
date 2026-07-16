import { createSignal, createResource, For, Show, onMount, onCleanup, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { usePlatformAccounts } from "@/context/platform-accounts"
import { useGlobalSDK } from "@/context/global-sdk"
import { useModels } from "@/context/models"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DataProvider } from "@opencode-ai/ui/context"
import { Message } from "@opencode-ai/ui/message-part"
import { TypingIndicator } from "@opencode-ai/ui/typing-indicator"
import { PulseChatInput } from "./PulseChatInput"
import { PublishModal } from "./PublishModal"
import type { Message as MessageType, Part, Session, SessionStatus, SnapshotFileDiff } from "@opencode-ai/sdk/v2"

const SUGGESTIONS = [
  { icon: "📝", text: "生成小红书种草文案", desc: "根据关键词生成种草笔记" },
  { icon: "🎬", text: "撰写抖音短视频脚本", desc: "生成口播/剧情脚本" },
  { icon: "📰", text: "创建公众号文章", desc: "生成长文内容" },
  { icon: "🔄", text: "多平台一键分发", desc: "适配各平台格式" },
]

type PulseDataStore = {
  session: Session[]
  session_status: Record<string, SessionStatus>
  session_diff: Record<string, SnapshotFileDiff[]>
  message: Record<string, MessageType[]>
  part: Record<string, Part[]>
  part_text_accum_delta: Record<string, string>
}

export function PulseAssistant() {
  const platform = usePlatformAccounts()
  const sdk = useGlobalSDK()
  const modelsCtx = useModels()
  const dialog = useDialog()
  const [selectedModel, setSelectedModel] = createSignal<
    { id: string; name: string; provider: { id: string; name: string } } | undefined
  >(undefined)
  const [sessionID, setSessionID] = createSignal("")
  const [data, setData] = createStore<PulseDataStore>({
    session: [],
    session_status: {},
    session_diff: {},
    message: {},
    part: {},
    part_text_accum_delta: {},
  })
  const [isWorking, setIsWorking] = createSignal(false)
  const [error, setError] = createSignal("")
  const [sessionReady, setSessionReady] = createSignal(false)

  const [agents] = createResource(() => sdk.client.app.agents().then((r) => r.data ?? []))
  const [commands] = createResource(() => sdk.client.command.list().then((r) => r.data ?? []))

  onMount(async () => {
    try {
      const result = await sdk.client.session.create({
        title: "Pulse 运营助手",
      })
      const session = result.data
      if (session) {
        setSessionID(session.id)
        setData("session", [session])
        setData("message", session.id, [])
        setSessionReady(true)
      }
    } catch (err) {
      setError("创建会话失败：" + (err instanceof Error ? err.message : String(err)))
    }
  })

  onMount(() => {
    const stop = sdk.event.listen((e) => {
      const event = e.details
      const sid = sessionID()
      if (!sid) return

      if (event.type === "message.part.delta") {
        const props = event.properties as {
          sessionID: string
          messageID: string
          partID: string
          field: string
          delta: string
        }
        if (props.sessionID !== sid) return
        if (props.field === "text") {
          setData("part_text_accum_delta", props.partID, (prev) => (prev ?? "") + props.delta)
        }
      }

      if (event.type === "message.part.updated") {
        const props = event.properties as { sessionID: string; part: Part; time: number }
        if (props.sessionID !== sid) return
        const part = props.part
        setData("part", part.messageID, (prev) => {
          const existing = prev ?? []
          const idx = existing.findIndex((p) => p.id === part.id)
          if (idx >= 0) {
            const updated = [...existing]
            updated[idx] = part
            return updated
          }
          return [...existing, part]
        })
      }

      if (event.type === "message.updated") {
        const props = event.properties as { sessionID: string; info: MessageType }
        if (props.sessionID !== sid) return
        const info = props.info
        let isNew = false
        setData("message", sid, (prev) => {
          const existing = prev ?? []
          const idx = existing.findIndex((m) => m.id === info.id)
          if (idx >= 0) {
            const updated = [...existing]
            updated[idx] = info
            return updated
          }
          isNew = true
          return [...existing, info]
        })
        if (info.role === "assistant" && !isNew) {
          setIsWorking(false)
        }
      }
    })
    onCleanup(() => stop())
  })

  const dataSnapshot = createMemo(() => ({
    session: data.session,
    session_status: data.session_status,
    session_diff: data.session_diff,
    message: data.message,
    part: data.part,
    part_text_accum_delta: data.part_text_accum_delta,
  }))

  const handleSend = async (text: string) => {
    const sid = sessionID()
    if (!sid) return
    setIsWorking(true)

    try {
      const autoMode = modelsCtx.autoMode()
      let model: { providerID: string; modelID: string } | undefined

      if (autoMode) {
        const opencodeModels = modelsCtx.list().filter((m) => m.provider.id === "opencode")
        if (opencodeModels.length > 0) {
          const textLower = text.toLowerCase()
          const isCodeTask =
            textLower.includes("代码") ||
            textLower.includes("函数") ||
            textLower.includes("实现") ||
            textLower.includes("bug") ||
            textLower.includes("code") ||
            textLower.includes("function")
          const isCreativeTask =
            textLower.includes("写") ||
            textLower.includes("创作") ||
            textLower.includes("文案") ||
            textLower.includes("文章") ||
            textLower.includes("write") ||
            textLower.includes("create")
          const isAnalysisTask =
            textLower.includes("分析") ||
            textLower.includes("总结") ||
            textLower.includes("对比") ||
            textLower.includes("analyze") ||
            textLower.includes("summarize")
          const isComplex = text.length > 500 || isCodeTask || isAnalysisTask

          const scored = opencodeModels.map((m) => {
            let score = 50
            const ctx = m.limit?.context ?? 0
            if (isCodeTask) score += 20
            if (isCreativeTask) score += 15
            if (isAnalysisTask) score += 10
            if (isComplex) {
              if (ctx >= 256000) score += 5
              else if (ctx >= 128000) score += 3
            }
            return { model: m, score }
          })
          scored.sort((a, b) => b.score - a.score)
          const best = scored[0].model
          model = { providerID: best.provider.id, modelID: best.id }
        }
      } else {
        const sm = selectedModel()
        if (sm) {
          model = { providerID: sm.provider.id, modelID: sm.id }
        }
      }

      await sdk.client.session.promptAsync({
        sessionID: sid,
        agent: "pulse-orchestrator",
        model,
        autoMode,
        parts: [{ type: "text", text }],
      })
    } catch (err) {
      setError("发送失败：" + (err instanceof Error ? err.message : String(err)))
      setIsWorking(false)
    }
  }

  const handleStop = async () => {
    const sid = sessionID()
    if (!sid) return
    try {
      await sdk.client.session.abort({ sessionID: sid })
    } catch {}
    setIsWorking(false)
  }

  const handleSuggestion = (text: string) => {
    if (sessionReady() && sessionID()) {
      handleSend(text)
    }
  }

  const accountSummary = () => {
    const total = platform.store.accounts.length
    const online = platform.onlineCount()
    return { total, online }
  }

  const messages = () => data.message[sessionID()] ?? []

  return (
    <div class="flex flex-col h-full">
      <div class="shrink-0 px-4 py-3 border-b border-border-weak-base">
        <div class="flex items-center gap-2.5">
          <div
            class="size-8 rounded-[10px] flex items-center justify-center"
            style={{ "background-color": "color-mix(in srgb, var(--novaway-mode-color, #FF6B6B) 18%, transparent)" }}
          >
            <span class="text-sm" style={{ color: "var(--novaway-mode-color, #FF6B6B)" }}>
              ✦
            </span>
          </div>
          <div class="flex-1">
            <h3 class="text-14-medium text-text-strong leading-tight">AI 运营助手</h3>
            <p class="text-11-regular text-text-weak mt-0.5">内容生成 · 智能回复</p>
          </div>
          <button
            class="px-3 py-1.5 rounded-[8px] text-12-medium text-white transition-all duration-150 hover:-translate-y-0.5 active:translate-y-0"
            style={{
              background: "linear-gradient(135deg, var(--novaway-mode-color, #FF6B6B), #e05555)",
              "box-shadow": "0 2px 8px color-mix(in srgb, var(--novaway-mode-color, #FF6B6B) 30%, transparent)",
            }}
            onClick={() => dialog.show(() => <PublishModal />)}
          >
            发布
          </button>
        </div>
      </div>

      <div class="shrink-0 px-4 py-2.5 border-b border-border-weak-base bg-background-weak/40">
        <div class="flex items-center gap-3 text-11-regular text-text-weak">
          <span>总账号 {accountSummary().total}</span>
          <span class="text-text-weaker">|</span>
          <span class="text-emerald-600 dark:text-emerald-400">在线 {accountSummary().online}</span>
          <Show when={!sessionReady() && !error()}>
            <span class="text-amber-500">连接中...</span>
          </Show>
          <Show when={error()}>
            <span class="text-rose-500 truncate ml-auto max-w-[160px]" title={error()}>
              ⚠
            </span>
          </Show>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto p-3" data-slot="pulse-messages">
        <DataProvider data={dataSnapshot()} directory="/pulse">
          <Show
            when={messages().length > 0}
            fallback={
              <div class="flex flex-col items-center text-center pt-6 pb-4 px-2">
                <div
                  class="size-16 rounded-[14px] flex items-center justify-center mb-5"
                  style={{
                    "background-color": "color-mix(in srgb, var(--novaway-mode-color, #FF6B6B) 10%, transparent)",
                  }}
                >
                  <span class="text-2xl" style={{ color: "var(--novaway-mode-color, #FF6B6B)" }}>
                    ✨
                  </span>
                </div>
                <h4 class="text-14-medium text-text-strong mb-1">我可以帮你：</h4>
                <p class="text-12-regular text-text-weaker mb-4">选择一个快捷指令开始</p>
                <div class="space-y-2 w-full">
                  <For each={SUGGESTIONS}>
                    {(item) => (
                      <button
                        class="w-full text-left rounded-[8px] border border-border-weak-base bg-background-base px-3.5 py-2.5 transition-all duration-150 hover:-translate-y-0.5 hover:border-border-interactive-base hover:shadow-[0_4px_12px_rgba(0,0,0,0.04)]"
                        onClick={() => handleSuggestion(item.text)}
                      >
                        <div class="flex items-center gap-2.5">
                          <span class="text-base">{item.icon}</span>
                          <div>
                            <div class="text-13-medium text-text-strong">{item.text}</div>
                            <div class="text-11-regular text-text-weak mt-0.5">{item.desc}</div>
                          </div>
                        </div>
                      </button>
                    )}
                  </For>
                </div>
              </div>
            }
          >
            <For each={messages()}>{(msg) => <Message message={msg} parts={data.part[msg.id] ?? []} />}</For>
            <Show when={isWorking()}>
              <div class="px-4 py-3">
                <TypingIndicator label="AI 运营助手正在思考..." />
              </div>
            </Show>
          </Show>
        </DataProvider>
      </div>

      <div class="shrink-0 px-3 py-3 border-t border-border-weak-base">
        <PulseChatInput
          agents={agents() ?? []}
          commands={commands() ?? []}
          models={modelsCtx.list()}
          currentModel={modelsCtx.autoMode() ? undefined : selectedModel()}
          autoMode={modelsCtx.autoMode()}
          onAutoModeChange={(v) => modelsCtx.setAutoMode(v)}
          onModelSelect={(m) => setSelectedModel(m)}
          onSend={handleSend}
          onStop={handleStop}
          isWorking={isWorking()}
          disabled={!sessionReady()}
        />
      </div>
    </div>
  )
}
