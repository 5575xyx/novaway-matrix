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
} from "solid-js"
import { Dynamic } from "solid-js/web"
import path from "node:path"
import { mkdir, writeFile } from "node:fs/promises"
import { useRoute, useRouteData } from "../../context/route"
import { useProject } from "../../context/project"
import { useSync } from "../../context/sync"
import { useEvent } from "../../context/event"
import { SplitBorder } from "../../ui/border"
import { useTuiPaths, useTuiTerminalEnvironment } from "../../context/runtime"
import { Spinner } from "../../component/spinner"
import { FilePreview } from "../../component/file-preview"
import { GitDiffView } from "../../component/git-diff-view"
import { TabBar, type TabItem } from "../../component/tab-bar"
import { EmptySessionHero } from "../../component/empty-session-hero"
import { createSyntaxStyleMemo, generateSubtleSyntax, selectedForeground, useTheme } from "../../context/theme"
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
import { webSearchProviderLabel } from "../../util/tool-display"
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
import { DialogSessionRename } from "../../component/dialog-session-rename"
import { Sidebar, SIDEBAR_TABS, cycleSidebarTab, setSidebarTab } from "./sidebar"
import { DiffStatList, uniqueDiffStats } from "../../component/diff-stat-list"
import { SubagentFooter } from "./subagent-footer.tsx"
import { filetype } from "../../util/filetype"
import parsers from "../../parsers-config"
import { errorMessage } from "../../util/error"
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
import { getScrollAcceleration } from "../../util/scroll"
import { collapseHint, collapseToolOutput } from "../../util/collapse-tool-output"
import { messageJump } from "../../util/message-jump"
import { sidebarWidth } from "../../util/sidebar-width"
import { usePluginRuntime } from "../../plugin/runtime"
import { DialogRetryAction } from "../../component/dialog-retry-action"
import { getRevertDiffFiles } from "../../util/revert-diff"
import {
  expandMessageWindow,
  MESSAGE_WINDOW_INITIAL,
  messageWindow,
} from "../../util/message-window"
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

export const alwaysSeparate = new WeakSet<BoxRenderable>()

type RetryAction = Extract<SessionStatus, { type: "retry" }>["action"]

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
  showTimestamps: () => boolean
  showDetails: () => boolean
  showGenericToolOutput: () => boolean
  diffWrapMode: () => "word" | "none"
  providers: () => ReadonlyMap<string, Provider>
  sync: ReturnType<typeof useSync>
  tui: ReturnType<typeof useTuiConfig>
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

  const dimensions = useTerminalDimensions()
  const [sidebar, setSidebar] = kv.signal<"auto" | "hide">("sidebar", "auto")
  const [sidebarOpen, setSidebarOpen] = createSignal(false)
  const [selectedFile, setSelectedFile] = createSignal<string | null>(null)
  const [tabs, setTabs] = createSignal<TabItem[]>([
    { id: "chat", title: "聊天", type: "chat", closable: false }
  ])
  const [activeTabId, setActiveTabId] = createSignal<string>("chat")
  const [conceal, setConceal] = createSignal(true)
  const thinking = useThinkingMode()
  const thinkingMode = thinking.mode
  const showThinking = createMemo(() => true)
  const [timestamps, setTimestamps] = kv.signal<"hide" | "show">("timestamps", "hide")
  const [showDetails, setShowDetails] = kv.signal("tool_details_visibility", true)
  const [showAssistantMetadata, _setShowAssistantMetadata] = kv.signal("assistant_metadata_visibility", true)
  const [showScrollbar, setShowScrollbar] = kv.signal("scrollbar_visible", false)
  const [diffWrapMode] = kv.signal<"word" | "none">("diff_wrap_mode", "word")
  const [_animationsEnabled, _setAnimationsEnabled] = kv.signal("animations_enabled", true)
  const [showGenericToolOutput, setShowGenericToolOutput] = kv.signal("generic_tool_output_visibility", false)

  const wide = createMemo(() => dimensions().width > 120)
  const sidebarVisible = createMemo(() => {
    if (session()?.parentID) return false
    if (sidebarOpen()) return true
    if (sidebar() === "auto" && wide()) return true
    return false
  })
  const showTimestamps = createMemo(() => timestamps() === "show")
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

  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))
  const toast = useToast()
  const sdk = useSDK()
  const editor = useEditorContext()

  // Tab management functions
  const activeTab = createMemo(() => tabs().find((t) => t.id === activeTabId()))

  const openPreviewTab = (filePath: string) => {
    const fileName = filePath.split(/[\\/]/).pop() || filePath
    const tabId = `preview-${filePath}`

    // Check if tab already exists
    const existingTab = tabs().find(t => t.id === tabId)
    if (existingTab) {
      setActiveTabId(tabId)
      setSelectedFile(filePath)
      return
    }

    // Add new tab
    setTabs(prev => [...prev, {
      id: tabId,
      title: fileName,
      type: "preview",
      closable: true,
      filePath: filePath
    }])
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
    setTabs((prev) => [
      ...prev,
      { id: tabId, title: `± ${fileName}`, type: "git-diff", closable: true, filePath },
    ])
    setActiveTabId(tabId)
    setSelectedFile(filePath)
  }

  const closeTab = (tabId: string) => {
    if (tabId === "chat") return // Cannot close chat tab
    
    setTabs(prev => prev.filter(t => t.id !== tabId))
    
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
      const tab = tabs().find(t => t.id === tabId)
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
      if (route.sessionID === sessionID && scroll) scroll.scrollBy(100_000)
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
              const child = scroll.getChildren().find((child) => {
                return child.id === messageID
              })
              if (child) scroll.scrollBy(child.y - scroll.y - 1)
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
              const child = scroll.getChildren().find((child) => {
                return child.id === messageID
              })
              if (child) scroll.scrollBy(child.y - scroll.y - 1)
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
      title: showTimestamps() ? "隐藏时间戳" : "显示时间戳",
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
      run: () => {
        scroll.scrollBy(-scroll.height / 2)
        dialog.clear()
      },
    },
    {
      title: "向下翻页",
      value: "session.page.down",
      category: "会话",
      hidden: true,
      run: () => {
        scroll.scrollBy(scroll.height / 2)
        dialog.clear()
      },
    },
    {
      title: "向上滚动一行",
      value: "session.line.up",
      category: "会话",
      hidden: true,
      run: () => {
        scroll.scrollBy(-1)
        dialog.clear()
      },
    },
    {
      title: "向下滚动一行",
      value: "session.line.down",
      category: "会话",
      hidden: true,
      run: () => {
        scroll.scrollBy(1)
        dialog.clear()
      },
    },
    {
      title: "向上翻半页",
      value: "session.half.page.up",
      category: "会话",
      hidden: true,
      run: () => {
        scroll.scrollBy(-scroll.height / 4)
        dialog.clear()
      },
    },
    {
      title: "向下翻半页",
      value: "session.half.page.down",
      category: "会话",
      hidden: true,
      run: () => {
        scroll.scrollBy(scroll.height / 4)
        dialog.clear()
      },
    },
    {
      title: "第一条消息",
      value: "session.first",
      category: "会话",
      hidden: true,
      run: () => {
        scroll.scrollTo(0)
        dialog.clear()
      },
    },
    {
      title: "最后一条消息",
      value: "session.last",
      category: "会话",
      hidden: true,
      run: () => {
        scroll.scrollTo(scroll.scrollHeight)
        dialog.clear()
      },
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
            const child = scroll.getChildren().find((child) => {
              return child.id === message.id
            })
            if (child) scroll.scrollBy(child.y - scroll.y - 1)
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
  createEffect(() => {
    const target = messageJump()
    if (!target) return
    jumpToMessage(target.messageID)
  })

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
          showTimestamps,
          showDetails,
          showGenericToolOutput,
          diffWrapMode,
          providers,
          sync,
          tui: tuiConfig,
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
            <TabBar
              tabs={tabs()}
              activeTabId={activeTabId()}
              onTabClick={switchTab}
              onTabClose={closeTab}
            />
            <box flexGrow={1} minHeight={0} paddingBottom={1} paddingLeft={2} paddingRight={2} gap={1}>
              <Show when={activeTabId() === "chat"}>
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
                        when={revert()?.messageID && revertMessageIndex() !== -1 && index() >= revertMessageIndex()}
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
                          pending={pending()}
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
              </scrollbox>
            </Show>
            <Show when={activeTabId() !== "chat" && selectedFile()}>
              {/* 按标签类型分发:preview = 整文件编辑,git-diff = 该文件相对 HEAD 的改动差异 */}
              <Show
                when={activeTab()?.type === "git-diff"}
                fallback={<FilePreview filePath={selectedFile()} onClose={() => closeTab(activeTabId())} />}
              >
                <GitDiffView
                  filePath={selectedFile()!}
                  rootPath={session()?.directory}
                  onClose={() => closeTab(activeTabId())}
                />
              </Show>
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
                        right={<pluginRuntime.Slot name="session_prompt_right" session_id={route.sessionID} />}
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

function UserMessage(props: {
  message: UserMessage
  parts: Part[]
  onMouseUp: () => void
  index: number
  pending?: number
}) {
  const ctx = use()
  const local = useLocal()
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
  const [hover, setHover] = createSignal(false)
  const queued = createMemo(() => props.pending !== undefined && props.index > props.pending)
  const color = createMemo(() => local.agent.color(props.message.agent))
  const queuedFg = createMemo(() => selectedForeground(theme, color()))
  const metadataVisible = createMemo(() => queued() || ctx.showTimestamps())

  const compaction = createMemo(() => props.parts.find((x) => x.type === "compaction"))

  return (
    <>
      <Show when={text()}>
        {/* crush 式聚焦条:悬停整行时右缘的细条 ┃ 升级成半块 ▌,标记"当前聚焦的消息" */}
        <box
          id={props.message.id}
          ref={(el: BoxRenderable) => alwaysSeparate.add(el)}
          border={["right"]}
          borderColor={color()}
          customBorderChars={{
            ...SplitBorder.customBorderChars,
            vertical: hover() ? "▌" : SplitBorder.customBorderChars.vertical,
          }}
          marginTop={props.index === 0 ? 0 : 1}
          alignItems="flex-end"
          width="100%"
          onMouseOver={() => setHover(true)}
          onMouseOut={() => setHover(false)}
        >
          <box
            onMouseUp={props.onMouseUp}
            paddingTop={1}
            paddingBottom={1}
            paddingLeft={2}
            paddingRight={2}
            backgroundColor={hover() ? theme.backgroundElement : theme.backgroundPanel}
            flexShrink={0}
            maxWidth="70%"
            alignItems="flex-end"
          >
            {/* 气泡靠右:外层 alignItems="flex-end" 把气泡推到内容列右缘(紧贴右侧那条 agent 色条),
                内层同样右对齐让附件/时间戳跟着靠右。这里的 text 不能再写 width="100%" ——
                那会把气泡撑满整列,右对齐就失效;去掉后气泡按文字自然宽度收缩,长文本到 70% 才折行。 */}
            <text fg={theme.text}>{text()}</text>
            <Show when={files().length}>
              <box flexDirection="row" paddingBottom={metadataVisible() ? 1 : 0} paddingTop={1} gap={1} flexWrap="wrap">
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
            <Show
              when={queued()}
              fallback={
                <Show when={ctx.showTimestamps()}>
                  <text fg={theme.textMuted}>
                    <span style={{ fg: theme.textMuted }}>
                      {Locale.todayTimeOrDateTime(props.message.time.created)}
                    </span>
                  </text>
                </Show>
              }
            >
              <text fg={theme.textMuted}>
                <span style={{ bg: color(), fg: queuedFg(), bold: true }}> 排队中 </span>
              </text>
            </Show>
          </box>
        </box>
      </Show>
      <Show when={compaction()}>
        <box
          marginTop={1}
          border={["top"]}
          title=" 压缩 "
          titleAlignment="center"
          borderColor={theme.borderActive}
        />
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

  return (
    <>
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
      <Show when={props.parts.some((x) => x.type === "tool" && x.tool === "task")}>
        <box paddingTop={1} paddingLeft={3}>
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
        <box
          ref={(el: BoxRenderable) => alwaysSeparate.add(el)}
          border={["left"]}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          marginTop={1}
          backgroundColor={theme.backgroundPanel}
          customBorderChars={SplitBorder.customBorderChars}
          borderColor={theme.error}
        >
          <text fg={theme.textMuted}>{errorMessage(props.message.error)}</text>
        </box>
      </Show>
      <Switch>
        <Match when={props.last || final() || props.message.error?.name === "MessageAbortedError"}>
          {/* crush 式节标题:◇ + 一行摘要 + "─" 填满剩余宽度,代替边框给会话流分区 */}
          <box
            ref={(el: BoxRenderable) => alwaysSeparate.add(el)}
            flexDirection="row"
            alignItems="center"
            gap={1}
            paddingLeft={3}
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
              <span style={{ fg: theme.text }}>{Locale.titlecase(props.message.mode)}</span>
              <span style={{ fg: theme.textMuted }}> · {model()}</span>
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
            <box ref={(el: BoxRenderable) => alwaysSeparate.add(el)} paddingLeft={3} marginTop={1} flexShrink={0}>
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
      <box
        ref={(el: BoxRenderable) => alwaysSeparate.add(el)}
        paddingLeft={3}
        marginTop={1}
        flexDirection="column"
        flexShrink={0}
      >
        {/* crush 式思考块:muted 字 + 第 2 级灰底、无边框,和工具输出同一套弱对比语言 */}
        <box backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
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
        </box>
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
          <Spinner color={theme.warning}>
            {/* title 是 provider 给的推理摘要,内容和换行都不受控;这里和图标是横排,必须压成一行。 */}
            {props.title ? `正在思考:${Locale.oneLine(props.title, 120)}` : "正在思考你的问题"}
          </Spinner>
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

function TextPart(props: { last: boolean; part: TextPart; message: AssistantMessage }) {
  const ctx = use()
  const { theme, syntax } = useTheme()
  return (
    <Show when={props.part.text.trim()}>
      <box ref={(el: BoxRenderable) => alwaysSeparate.add(el)} paddingLeft={3} marginTop={1} flexShrink={0}>
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
function GenericTool(props: ToolProps) {
  const { theme } = useTheme()
  const ctx = use()
  const output = createMemo(() => props.output?.trim() ?? "")
  const [expanded, setExpanded] = createSignal(false)
  const maxLines = 3
  const maxChars = createMemo(() => maxLines * Math.max(20, ctx.width - 6))
  const collapsed = createMemo(() => collapseToolOutput(output(), maxLines, maxChars()))
  const limited = createMemo(() => {
    if (expanded() || !collapsed().overflow) return output()
    return collapsed().output
  })
  // 工具名来自 MCP 服务端的声明,长度和内容都不受我们控制
  const name = createMemo(() => Locale.oneLine(props.tool, 80))

  return (
    <Show
      when={props.output && ctx.showGenericToolOutput()}
      fallback={
        <InlineTool pending="正在执行命令..." complete={true} part={props.part} label={{ name: name(), params: toolParams(props.input) }} />
      }
    >
      <BlockTool
        title={`# ${name()} ${input(props.input)}`}
        part={props.part}
        onClick={collapsed().overflow ? () => setExpanded((prev) => !prev) : undefined}
      >
        <box gap={1}>
          <text fg={theme.text}>{limited()}</text>
          <Show when={collapsed().overflow}>
            <text fg={theme.textMuted}>{collapseHint(expanded(), collapsed().hidden)}</text>
          </Show>
        </box>
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
  separate?: boolean
  /** crush 式结构化标签:工具名 + 截断过的参数;给了 label 就不再用 children 当正文 */
  label?: { name: string; params?: string }
  children?: JSX.Element
  part: ToolPart
  onClick?: () => void
}) {
  const { theme } = useTheme()
  const ctx = use()
  const sync = useSync()
  const renderer = useRenderer()
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
  const fg = createMemo(() => {
    if (props.color) return props.color
    if (permission()) return theme.warning
    if (failed()) return theme.error
    if (hover() && props.onClick) return theme.text
    if (props.complete) return theme.textMuted
    return theme.text
  })

  return (
    <InlineToolRow
      color={fg()}
      errorColor={theme.error}
      successColor={theme.success}
      failed={failed()}
      denied={Boolean(denied())}
      error={error()}
      errorExpanded={errorExpanded()}
      complete={props.complete}
      pending={props.pending}
      failure={props.failure}
      spinner={props.spinner}
      separate={props.separate}
      onMouseOver={() => clickable() && setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={() => {
        if (renderer.getSelection()?.getSelectedText()) return
        if (failed()) {
          setErrorExpanded((value) => !value)
          return
        }
        props.onClick?.()
      }}
    >
      {props.label ? <ToolLabel name={props.label.name} params={props.label.params} failed={failed()} errorColor={theme.error} /> : props.children}
    </InlineToolRow>
  )
}

export function InlineToolRow(props: {
  color?: RGBA
  errorColor?: RGBA
  successColor?: RGBA
  failed?: boolean
  denied?: boolean
  error?: string
  errorExpanded?: boolean
  complete: unknown
  pending: string
  failure?: string
  spinner?: boolean
  separate?: boolean
  children?: JSX.Element
  onMouseOver?: () => void
  onMouseOut?: () => void
  onMouseUp?: () => void
}) {
  // crush 式状态图标:图标列只表达状态(✓ 成功 / × 失败),不再按工具各用各的符号;
  // 工具身份由后面的文字(工具名 + 参数)承担。
  // 颜色一律由外面注入(和 errorColor 同一规矩),这一层不碰主题 context ——
  // 渲染测试就是脱开 Provider 直接挂它的。
  return (
    <box
      paddingLeft={3}
      onMouseOver={props.onMouseOver}
      onMouseOut={props.onMouseOut}
      onMouseUp={props.onMouseUp}
      ref={(el: BoxRenderable) => {
        if (props.separate) alwaysSeparate.add(el)
        setPreLayoutSiblingMargin(el, (previous) => {
          return props.separate ||
            (previous instanceof BoxRenderable && (previous.height > 1 || alwaysSeparate.has(previous)))
            ? 1
            : 0
        })
      }}
    >
      <Switch>
        <Match when={props.spinner}>
          <Spinner color={props.color} children={props.children} />
        </Match>
        <Match when={true}>
          <Show
            fallback={
              <text
                paddingLeft={3}
                fg={props.color}
                attributes={props.denied ? TextAttributes.STRIKETHROUGH : undefined}
              >
                ● {props.pending}
              </text>
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
                fg={props.failed ? props.errorColor : props.color}
                attributes={props.denied ? TextAttributes.STRIKETHROUGH : undefined}
              >
                {props.failed && !props.complete ? (props.failure ?? props.children) : props.children}
              </text>
            </box>
          </Show>
        </Match>
      </Switch>
      <Show when={props.failed && props.errorExpanded}>
        <box paddingLeft={INLINE_TOOL_ICON_WIDTH}>
          <text fg={props.errorColor}>{props.error}</text>
        </box>
      </Show>
    </box>
  )
}

// crush 式工具行文案:工具名用 info 色、参数写成截断过的 (k=v),名字是身份、参数是细节。
// 失败时整体退到 errorColor,不和状态色打架。只允许出现在 InlineToolRow 的 text 里。
function ToolLabel(props: { name: string; params?: string; failed?: boolean; errorColor?: RGBA }) {
  const { theme } = useTheme()
  const fg = () => (props.failed ? props.errorColor : theme.info)
  return (
    <>
      <span style={{ fg: fg() }}>{props.name}</span>
      <Show when={props.params}>
        {(params) => <span style={{ fg: fg() }}> {params()}</span>}
      </Show>
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

function BlockTool(props: {
  title?: string
  children: JSX.Element
  onClick?: () => void
  part?: ToolPart
  spinner?: boolean
}) {
  const { theme } = useTheme()
  const renderer = useRenderer()
  const [hover, setHover] = createSignal(false)
  const error = createMemo(() => (props.part?.state.status === "error" ? props.part.state.error : undefined))
  return (
    <box
      ref={(el: BoxRenderable) => alwaysSeparate.add(el)}
      border={["left"]}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      marginTop={1}
      gap={1}
      backgroundColor={hover() ? theme.backgroundMenu : theme.backgroundElement}
      customBorderChars={SplitBorder.customBorderChars}
      borderColor={theme.background}
      onMouseOver={() => props.onClick && setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={() => {
        if (renderer.getSelection()?.getSelectedText()) return
        props.onClick?.()
      }}
    >
      <Show when={props.title}>
        {(title) => (
          <Show
            when={props.spinner}
            fallback={
              <text paddingLeft={3} fg={theme.textMuted}>
                {title()}
              </text>
            }
          >
            <Spinner color={theme.textMuted}>{title().replace(/^# /, "")}</Spinner>
          </Show>
        )}
      </Show>
      {props.children}
      <Show when={error()}>
        <text fg={theme.error}>{error()}</text>
      </Show>
    </box>
  )
}

function Shell(props: ToolProps) {
  const { theme } = useTheme()
  const pathFormatter = usePathFormatter()
  const ctx = use()
  const isRunning = createMemo(() => props.part.state.status === "running")
  const output = createMemo(() => stripAnsi(stringValue(props.metadata.output)?.trim() ?? ""))
  const [expanded, setExpanded] = createSignal(false)
  const maxLines = 10
  const maxChars = createMemo(() => maxLines * Math.max(20, ctx.width - 6))
  const collapsed = createMemo(() => collapseToolOutput(output(), maxLines, maxChars()))
  const limited = createMemo(() => {
    if (expanded() || !collapsed().overflow) return output()
    return collapsed().output
  })

  const workdirDisplay = createMemo(() => {
    const workdir = stringValue(props.input.workdir)
    if (!workdir || workdir === ".") return undefined
    const formatted = pathFormatter.format(workdir)
    if (formatted === ".") return undefined
    return formatted
  })

  const title = createMemo(() => {
    const wd = workdirDisplay()
    if (!wd) return
    return `# Running in ${wd}`
  })

  return (
    <Switch>
      <Match when={stringValue(props.metadata.output) !== undefined}>
        <BlockTool
          title={title()}
          part={props.part}
          onClick={collapsed().overflow ? () => setExpanded((prev) => !prev) : undefined}
        >
          <box gap={1}>
            {/* fallback 是 BlockTool 里的整块展示,命令原样多行是这里想要的;
                但 Spinner 是"转圈图标 + 一行文字"的横排,多行会把图标列错开,所以要压平。 */}
            <Show when={isRunning()} fallback={<text fg={theme.text}>$ {stringValue(props.input.command)}</text>}>
              <Spinner color={theme.text}>{toolLine(props.input.command)}</Spinner>
            </Show>
            <Show when={output()}>
              <text fg={theme.text}>{limited()}</text>
            </Show>
            <Show when={collapsed().overflow}>
              <text fg={theme.textMuted}>{collapseHint(expanded(), collapsed().hidden)}</text>
            </Show>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool pending="正在执行命令..." complete={stringValue(props.input.command)} part={props.part}>
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
          params: [
            pathFormatter.format(stringValue(props.input.filePath)),
            toolParams(props.input, ["filePath"]),
          ]
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
      separate={true}
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
  const outputPreview = createMemo(() => collapseToolOutput(output(), 4, 4 * Math.max(20, ctx.width - 6)).output)
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

function Edit(props: ToolProps) {
  const ctx = use()
  const { theme, syntax } = useTheme()
  const pathFormatter = usePathFormatter()

  const view = createMemo(() => {
    const diffStyle = ctx.tui.diff_style
    if (diffStyle === "stacked") return "unified"
    // Default to "auto" behavior
    return ctx.width > 120 ? "split" : "unified"
  })

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

  const view = createMemo(() => {
    const diffStyle = ctx.tui.diff_style
    if (diffStyle === "stacked") return "unified"
    return ctx.width > 120 ? "split" : "unified"
  })

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
        <InlineTool pending="正在准备补丁..." failure="补丁失败" complete={false} part={props.part} label={{ name: "补丁" }} />
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
        <InlineTool
          pending="正在更新待办事项..."
          failure="待办事项更新失败"
          complete={false}
          part={props.part}
        >
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
        <InlineTool pending="提问中..." complete={count()} part={props.part} label={{ name: "提问", params: `${count()} 个问题` }} />
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
