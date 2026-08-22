import { useFilteredList } from "@novaway/ui/hooks"
import { useSpring } from "@novaway/ui/motion-spring"
import { createEffect, on, Component, Show, onCleanup, createMemo, createSignal, createResource } from "solid-js"
import { createStore } from "solid-js/store"
import { useLocal } from "@/context/local"
import { selectionFromLines, type SelectedLineRange, useFile } from "@/context/file"
import {
  ContentPart,
  DEFAULT_PROMPT,
  isPromptEqual,
  Prompt,
  usePrompt,
  ImageAttachmentPart,
  AgentPart,
  FileAttachmentPart,
} from "@/context/prompt"
import { useLayout } from "@/context/layout"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useComments } from "@/context/comments"
import { showToast } from "@novaway/ui/toast"
import { Button } from "@novaway/ui/button"
import { DockShellForm, DockTray } from "@novaway/ui/dock-surface"
import { Icon } from "@novaway/ui/icon"
import { ProviderIcon } from "@novaway/ui/provider-icon"
import { Tooltip, TooltipKeybind } from "@novaway/ui/tooltip"
import { IconButton } from "@novaway/ui/icon-button"
import { Select } from "@novaway/ui/select"
import { Switch } from "@novaway/ui/switch"
import { useDialog } from "@novaway/ui/context/dialog"
import { ModelSelectorPopover } from "@/components/dialog-select-model"
import { useProviders } from "@/hooks/use-providers"
import { useCommand } from "@/context/command"
import { Persist, persisted } from "@/utils/persist"
import { usePermission } from "@/context/permission"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import { usePlatform } from "@/context/platform"
import { useModels } from "@/context/models"
import { useSessionLayout } from "@/pages/session/session-layout"
import { createSessionTabs } from "@/pages/session/helpers"
import { createTextFragment, getCursorPosition, setCursorPosition, setRangeEdge } from "./prompt-input/editor-dom"
import { createPromptAttachments } from "./prompt-input/attachments"
import { ACCEPTED_FILE_TYPES } from "./prompt-input/files"
import {
  canNavigateHistoryAtCursor,
  navigatePromptHistory,
  prependHistoryEntry,
  type PromptHistoryComment,
  type PromptHistoryEntry,
  type PromptHistoryStoredEntry,
  promptLength,
} from "./prompt-input/history"
import { createPromptSubmit, type FollowupDraft } from "./prompt-input/submit"
import { PromptPopover, type AtOption, type SlashCommand } from "./prompt-input/slash-popover"
import { PromptContextItems } from "./prompt-input/context-items"
import { PromptImageAttachments } from "./prompt-input/image-attachments"
import { PromptDragOverlay } from "./prompt-input/drag-overlay"
import { promptPlaceholder } from "./prompt-input/placeholder"
import { ImagePreview } from "@novaway/ui/image-preview"
import { useQueries } from "@tanstack/solid-query"
import { useQueryOptions } from "@/context/global-sync"
import { agentDisplayName } from "@/utils/agent"
import { pathKey } from "@/utils/path-key"
import { useOfficeAgent } from "@/pages/session/office-agent-context"
import { ProjectSwitcherChip } from "@/components/project-switcher"
import { officeAgentScenario } from "@/pages/session/office-agent-scenarios"
import { transformOfficePrompt } from "@/pages/session/office-agent-prompt"

interface PromptInputProps {
  class?: string
  ref?: (el: HTMLDivElement) => void
  autoSubmitKey?: string
  newSessionWorktree?: string
  onNewSessionWorktreeReset?: () => void
  edit?: { id: string; prompt: Prompt; context: FollowupDraft["context"] }
  onEditLoaded?: () => void
  shouldQueue?: () => boolean
  onQueue?: (draft: FollowupDraft) => void
  onAbort?: () => void
  onSubmit?: () => void
}

const EXAMPLES = [
  "prompt.example.1",
  "prompt.example.2",
  "prompt.example.3",
  "prompt.example.4",
  "prompt.example.5",
  "prompt.example.6",
  "prompt.example.7",
  "prompt.example.8",
  "prompt.example.9",
  "prompt.example.10",
  "prompt.example.11",
  "prompt.example.12",
  "prompt.example.13",
  "prompt.example.14",
  "prompt.example.15",
  "prompt.example.16",
  "prompt.example.17",
  "prompt.example.18",
  "prompt.example.19",
  "prompt.example.20",
  "prompt.example.21",
  "prompt.example.22",
  "prompt.example.23",
  "prompt.example.24",
  "prompt.example.25",
] as const

const hiddenSlashCommandIDs = new Set([
  "agent.cycle",
  "file.open",
  "mcp.toggle",
  "model.choose",
  "session.share",
  "session.unshare",
  "terminal.toggle",
])

export const PromptInput: Component<PromptInputProps> = (props) => {
  const sdk = useSDK()
  const queryOptions = useQueryOptions()

  const sync = useSync()
  const local = useLocal()
  const files = useFile()
  const prompt = usePrompt()
  const layout = useLayout()
  const comments = useComments()
  const dialog = useDialog()
  const providers = useProviders()
  const command = useCommand()
  const permission = usePermission()
  const language = useLanguage()
  const settings = useSettings()
  const platform = usePlatform()
  const modelsCtx = useModels()
  const office = useOfficeAgent()
  const zenOfficeMode = createMemo(() => layout.mode.current() === "zen")
  const forgeAutoAgentMode = createMemo(() => layout.mode.current() === "forge")
  const { params, tabs, view } = useSessionLayout()
  let editorRef!: HTMLDivElement
  let fileInputRef: HTMLInputElement | undefined
  let scrollRef!: HTMLDivElement
  let slashPopoverRef!: HTMLDivElement

  createEffect(() => {
    if (!zenOfficeMode()) return
    const next = officeAgentScenario(office.activeID())
    if (local.agent.list().some((agent) => agent.name === next.agentName)) local.agent.set(next.agentName)
  })

  const mirror = { input: false }
  const inset = 84
  const space = `${inset}px`

  const scrollCursorIntoView = () => {
    const container = scrollRef
    const selection = window.getSelection()
    if (!container || !selection || selection.rangeCount === 0) return

    const range = selection.getRangeAt(0)
    if (!editorRef.contains(range.startContainer)) return

    const cursor = getCursorPosition(editorRef)
    const length = promptLength(prompt.current().filter((part) => part.type !== "image"))
    if (cursor >= length) {
      container.scrollTop = container.scrollHeight
      return
    }

    const rect = range.getClientRects().item(0) ?? range.getBoundingClientRect()
    if (!rect.height) return

    const containerRect = container.getBoundingClientRect()
    const top = rect.top - containerRect.top + container.scrollTop
    const bottom = rect.bottom - containerRect.top + container.scrollTop
    const padding = 12

    if (top < container.scrollTop + padding) {
      container.scrollTop = Math.max(0, top - padding)
      return
    }

    if (bottom > container.scrollTop + container.clientHeight - inset) {
      container.scrollTop = bottom - container.clientHeight + inset
    }
  }

  const queueScroll = (count = 2) => {
    requestAnimationFrame(() => {
      scrollCursorIntoView()
      if (count > 1) queueScroll(count - 1)
    })
  }

  const activeFileTab = createSessionTabs({
    tabs,
    pathFromTab: files.pathFromTab,
    normalizeTab: (tab) => (tab.startsWith("file://") ? files.tab(tab) : tab),
  }).activeFileTab

  const commentInReview = (path: string) => {
    const sessionID = params.id
    if (!sessionID) return false

    const diffs = sync.data.session_diff[sessionID]
    if (!diffs) return false
    return diffs.some((diff) => diff.file === path)
  }

  const openComment = (item: { path: string; commentID?: string; commentOrigin?: "review" | "file" }) => {
    if (!item.commentID) return

    const focus = { file: item.path, id: item.commentID }
    comments.setActive(focus)

    const queueCommentFocus = (attempts = 6) => {
      const schedule = (left: number) => {
        requestAnimationFrame(() => {
          comments.setFocus({ ...focus })
          if (left <= 0) return
          requestAnimationFrame(() => {
            const current = comments.focus()
            if (!current) return
            if (current.file !== focus.file || current.id !== focus.id) return
            schedule(left - 1)
          })
        })
      }

      schedule(attempts)
    }

    const wantsReview = item.commentOrigin === "review" || (item.commentOrigin !== "file" && commentInReview(item.path))
    if (wantsReview) {
      layout.fileTree.open()
      layout.fileTree.setTab("review")
      tabs().setActive("review")
      queueCommentFocus()
      return
    }

    if (!view().reviewPanel.opened()) view().reviewPanel.open()
    layout.fileTree.setTab("all")
    const tab = files.tab(item.path)
    void tabs().open(tab)
    tabs().setActive(tab)
    void Promise.resolve(files.load(item.path)).finally(() => queueCommentFocus())
  }

  const recent = createMemo(() => {
    const all = tabs().all()
    const active = activeFileTab()
    const order = active ? [active, ...all.filter((x) => x !== active)] : all
    const seen = new Set<string>()
    const paths: string[] = []

    for (const tab of order) {
      const path = files.pathFromTab(tab)
      if (!path) continue
      if (seen.has(path)) continue
      seen.add(path)
      paths.push(path)
    }

    return paths
  })
  const info = createMemo(() => (params.id ? sync.session.get(params.id) : undefined))
  const working = createMemo(() => sync.data.session_working(params.id ?? ""))
  const imageAttachments = createMemo(() =>
    prompt.current().filter((part): part is ImageAttachmentPart => part.type === "image"),
  )

  const [store, setStore] = createStore<{
    popover: "at" | "slash" | null
    historyIndex: number
    savedPrompt: PromptHistoryEntry | null
    placeholder: number
    draggingType: "image" | "@mention" | null
    mode: "normal" | "shell"
    applyingHistory: boolean
    optimizing: boolean
    /** 优化前原文，用于撤销 */
    optimizeSnapshot: string | null
  }>({
    popover: null,
    historyIndex: -1,
    savedPrompt: null as PromptHistoryEntry | null,
    placeholder: Math.floor(Math.random() * EXAMPLES.length),
    draggingType: null,
    mode: "normal",
    applyingHistory: false,
    optimizing: false,
    optimizeSnapshot: null,
  })

  const buttonsSpring = useSpring(() => (store.mode === "normal" ? 1 : 0), { visualDuration: 0.2, bounce: 0 })
  const motion = (value: number) => ({
    opacity: value,
    transform: `scale(${0.98 + value * 0.02})`,
    filter: `blur(${(1 - value) * 2}px)`,
    "pointer-events": value > 0.5 ? ("auto" as const) : ("none" as const),
  })
  const buttons = createMemo(() => motion(buttonsSpring()))
  const shell = createMemo(() => motion(1 - buttonsSpring()))
  const control = createMemo(() => ({ height: "28px", ...buttons() }))
  const [atScope, setAtScope] = createSignal<"rule" | "agent" | undefined>()

  const commentCount = createMemo(() => {
    if (store.mode === "shell") return 0
    return prompt.context.items().filter((item) => !!item.comment?.trim()).length
  })
  const blank = createMemo(() => {
    const text = prompt
      .current()
      .map((part) => ("content" in part ? part.content : ""))
      .join("")
    return text.trim().length === 0 && imageAttachments().length === 0 && commentCount() === 0
  })
  const stopping = createMemo(() => working() && blank())
  const tip = () => {
    if (stopping()) {
      return (
        <div class="flex items-center gap-2">
          <span>{language.t("prompt.action.stop")}</span>
          <span class="text-icon-base text-12-medium text-[10px]!">{language.t("common.key.esc")}</span>
        </div>
      )
    }

    if (store.optimizing) {
      return (
        <div class="flex items-center gap-2">
          <span>优化中...</span>
        </div>
      )
    }

    return (
      <div class="flex items-center gap-2">
        <span>{language.t("prompt.action.send")}</span>
        <Icon name="enter" size="small" class="text-icon-base" />
      </div>
    )
  }

  const contextItems = createMemo(() => {
    const items = prompt.context.items()
    if (store.mode !== "shell") return items
    return items.filter((item) => !item.comment?.trim())
  })

  const hasUserPrompt = createMemo(() => {
    const sessionID = params.id
    if (!sessionID) return false
    const messages = sync.data.message[sessionID]
    if (!messages) return false
    return messages.some((m) => m.role === "user")
  })

  const [history, setHistory] = persisted(
    Persist.global("prompt-history", ["prompt-history.v1"]),
    createStore<{
      entries: PromptHistoryStoredEntry[]
    }>({
      entries: [],
    }),
  )
  const [shellHistory, setShellHistory] = persisted(
    Persist.global("prompt-history-shell", ["prompt-history-shell.v1"]),
    createStore<{
      entries: PromptHistoryStoredEntry[]
    }>({
      entries: [],
    }),
  )

  const suggest = createMemo(() => !hasUserPrompt())

  const placeholder = createMemo(() => {
    if (zenOfficeMode() && store.mode === "normal" && commentCount() === 0) return office.activeAction().placeholder
    return promptPlaceholder({
      mode: store.mode,
      commentCount: commentCount(),
      example: suggest() ? (store.mode === "shell" ? "git status" : language.t(EXAMPLES[store.placeholder])) : "",
      suggest: suggest(),
      t: (key, params) => language.t(key as Parameters<typeof language.t>[0], params as never),
    })
  })

  const historyComments = () => {
    const byID = new Map(comments.all().map((item) => [`${item.file}\n${item.id}`, item] as const))
    return prompt.context.items().flatMap((item) => {
      if (item.type !== "file") return []
      const comment = item.comment?.trim()
      if (!comment) return []

      const selection = item.commentID ? byID.get(`${item.path}\n${item.commentID}`)?.selection : undefined
      const nextSelection =
        selection ??
        (item.selection
          ? ({
              start: item.selection.startLine,
              end: item.selection.endLine,
            } satisfies SelectedLineRange)
          : undefined)
      if (!nextSelection) return []

      return [
        {
          id: item.commentID ?? item.key,
          path: item.path,
          selection: { ...nextSelection },
          comment,
          time: item.commentID ? (byID.get(`${item.path}\n${item.commentID}`)?.time ?? Date.now()) : Date.now(),
          origin: item.commentOrigin,
          preview: item.preview,
        } satisfies PromptHistoryComment,
      ]
    })
  }

  const applyHistoryComments = (items: PromptHistoryComment[]) => {
    comments.replace(
      items.map((item) => ({
        id: item.id,
        file: item.path,
        selection: { ...item.selection },
        comment: item.comment,
        time: item.time,
      })),
    )
    prompt.context.replaceComments(
      items.map((item) => ({
        type: "file" as const,
        path: item.path,
        selection: selectionFromLines(item.selection),
        comment: item.comment,
        commentID: item.id,
        commentOrigin: item.origin,
        preview: item.preview,
      })),
    )
  }

  const applyHistoryPrompt = (entry: PromptHistoryEntry, position: "start" | "end") => {
    const p = entry.prompt
    const length = position === "start" ? 0 : promptLength(p)
    setStore("applyingHistory", true)
    applyHistoryComments(entry.comments)
    prompt.set(p, length)
    requestAnimationFrame(() => {
      editorRef.focus()
      setCursorPosition(editorRef, length)
      setStore("applyingHistory", false)
      queueScroll()
    })
  }

  const getCaretState = () => {
    const selection = window.getSelection()
    const textLength = promptLength(prompt.current())
    if (!selection || selection.rangeCount === 0) {
      return { collapsed: false, cursorPosition: 0, textLength }
    }
    const anchorNode = selection.anchorNode
    if (!anchorNode || !editorRef.contains(anchorNode)) {
      return { collapsed: false, cursorPosition: 0, textLength }
    }
    return {
      collapsed: selection.isCollapsed,
      cursorPosition: getCursorPosition(editorRef),
      textLength,
    }
  }

  const escBlur = () => platform.platform === "desktop" && platform.os === "macos"

  const pick = () => fileInputRef?.click()

  const setMode = (mode: "normal" | "shell") => {
    setStore("mode", mode)
    setStore("popover", null)
    requestAnimationFrame(() => editorRef?.focus())
  }

  const shellModeKey = "mod+shift+x"
  const normalModeKey = "mod+shift+e"

  command.register("prompt-input", () => [
    {
      id: "file.attach",
      title: language.t("prompt.action.attachFile"),
      category: language.t("command.category.file"),
      keybind: "mod+u",
      disabled: store.mode !== "normal",
      onSelect: pick,
    },
    {
      id: "prompt.mode.shell",
      title: language.t("command.prompt.mode.shell"),
      category: language.t("command.category.session"),
      keybind: shellModeKey,
      disabled: store.mode === "shell",
      onSelect: () => setMode("shell"),
    },
    {
      id: "prompt.mode.normal",
      title: language.t("command.prompt.mode.normal"),
      category: language.t("command.category.session"),
      keybind: normalModeKey,
      disabled: store.mode === "normal",
      onSelect: () => setMode("normal"),
    },
  ])

  const closePopover = () => {
    setStore("popover", null)
    setAtScope(undefined)
  }

  const resetHistoryNavigation = (force = false) => {
    if (!force && (store.historyIndex < 0 || store.applyingHistory)) return
    setStore("historyIndex", -1)
    setStore("savedPrompt", null)
  }

  const clearEditor = () => {
    editorRef.innerHTML = ""
  }

  const setEditorText = (text: string) => {
    clearEditor()
    editorRef.textContent = text
  }

  const focusEditorEnd = () => {
    requestAnimationFrame(() => {
      editorRef.focus()
      const range = document.createRange()
      const selection = window.getSelection()
      range.selectNodeContents(editorRef)
      range.collapse(false)
      selection?.removeAllRanges()
      selection?.addRange(range)
    })
  }

  const currentCursor = () => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || !editorRef.contains(selection.anchorNode)) return null
    return getCursorPosition(editorRef)
  }

  const restoreFocus = () => {
    requestAnimationFrame(() => {
      const cursor = prompt.cursor() ?? promptLength(prompt.current())
      editorRef.focus()
      setCursorPosition(editorRef, cursor)
      queueScroll()
    })
  }

  const renderEditorWithCursor = (parts: Prompt) => {
    const cursor = currentCursor()
    renderEditor(parts)
    if (cursor !== null) setCursorPosition(editorRef, cursor)
  }

  createEffect(() => {
    params.id
    if (params.id) return
    if (!suggest()) return
    const interval = setInterval(() => {
      setStore("placeholder", (prev) => (prev + 1) % EXAMPLES.length)
    }, 6500)
    onCleanup(() => clearInterval(interval))
  })

  const [composing, setComposing] = createSignal(false)
  const isImeComposing = (event: KeyboardEvent) => event.isComposing || composing() || event.keyCode === 229

  const handleBlur = () => {
    closePopover()
    setComposing(false)
  }

  const handleCompositionStart = () => {
    setComposing(true)
  }

  const handleCompositionEnd = () => {
    setComposing(false)
    requestAnimationFrame(() => {
      if (composing()) return
      reconcile(prompt.current().filter((part) => part.type !== "image"))
    })
  }

  const [globalRulesQuery, projectRulesQuery] = useQueries(() => ({
    queries: [
      {
        queryKey: ["settings", "global-rules"],
        queryFn: () => sdk.client.settings.rule.list({ scope: "global" }).then((x) => x.data ?? []),
        staleTime: Infinity,
        refetchOnWindowFocus: false,
      },
      {
        queryKey: ["settings", "project-rules", pathKey(sdk.directory)],
        queryFn: () => sdk.client.settings.rule.list({ scope: "project" }).then((x) => x.data ?? []),
        staleTime: Infinity,
        refetchOnWindowFocus: false,
      },
    ],
  }))

  const ruleList = createMemo(() =>
    Array.from(
      new Map(
        [...(globalRulesQuery.data ?? []), ...(projectRulesQuery.data ?? [])].map((rule) => [
          rule.name,
          {
            type: "rule" as const,
            name: rule.name,
            display: rule.name,
            description: typeof rule.data.description === "string" ? rule.data.description : undefined,
          },
        ]),
      ).values(),
    ).sort((a, b) => a.name.localeCompare(b.name)),
  )

  const agentList = createMemo(() =>
    sync.data.agent
      .filter((agent) => !agent.hidden && agent.mode !== "primary")
      .map(
        (agent): AtOption => ({
          type: "agent",
          name: agent.name,
          display: agentDisplayName(agent.name, agent.options),
        }),
      ),
  )
  const agentNames = createMemo(() => local.agent.list().map((agent) => agent.name))

  const insertRuleMention = (name: string) => {
    const selection = window.getSelection()
    if (!selection) return false

    if (selection.rangeCount === 0 || !editorRef.contains(selection.anchorNode)) {
      editorRef.focus()
      const cursor = prompt.cursor() ?? promptLength(prompt.current())
      setCursorPosition(editorRef, cursor)
    }

    if (selection.rangeCount === 0) return false
    const range = selection.getRangeAt(0)
    if (!editorRef.contains(range.startContainer)) return false

    const cursorPosition = getCursorPosition(editorRef)
    const rawText = prompt
      .current()
      .map((p) => ("content" in p ? p.content : ""))
      .join("")
    const textBeforeCursor = rawText.substring(0, cursorPosition)
    const atMatch = textBeforeCursor.match(/@(\S*)$/)
    const content = `@${name} `

    if (atMatch) {
      const start = atMatch.index ?? cursorPosition - atMatch[0].length
      setRangeEdge(editorRef, range, "start", start)
      setRangeEdge(editorRef, range, "end", cursorPosition)
    }

    range.deleteContents()
    const fragment = createTextFragment(content)
    const last = fragment.lastChild
    range.insertNode(fragment)
    if (last) {
      range.setStart(last, last.textContent?.length ?? 0)
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
    }

    handleInput()
    closePopover()
    return true
  }

  const handleAtSelect = (option: AtOption | undefined) => {
    if (!option) return
    if (option.type === "category") {
      setAtScope(option.category)
      queueMicrotask(() => atOnInput(""))
      return
    }
    if (option.type === "rule") {
      insertRuleMention(option.name)
      return
    }
    if (option.type === "agent") {
      addPart({ type: "agent", name: option.name, content: "@" + option.name, start: 0, end: 0 })
    } else {
      addPart({ type: "file", path: option.path, content: "@" + option.path, start: 0, end: 0 })
    }
  }

  const atKey = (x: AtOption | undefined) => {
    if (!x) return ""
    if (x.type === "category") return `category:${x.category}`
    if (x.type === "rule") return `rule:${x.name}`
    return x.type === "agent" ? `agent:${x.name}` : `file:${x.path}`
  }

  const {
    flat: atFlat,
    active: atActive,
    setActive: setAtActive,
    onInput: atOnInput,
    onKeyDown: atOnKeyDown,
  } = useFilteredList<AtOption>({
    items: async (query) => {
      if (atScope() === "rule") return ruleList()
      if (atScope() === "agent") return agentList()
      return [
        {
          type: "category" as const,
          category: "rule" as const,
          display: language.t("prompt.at.category.rules"),
          description: language.t("prompt.at.category.rules.description"),
        },
        {
          type: "category" as const,
          category: "agent" as const,
          display: language.t("prompt.at.category.agents"),
          description: language.t("prompt.at.category.agents.description"),
        },
      ].filter((item) => {
        const value = query.trim().toLocaleLowerCase()
        if (!value) return true
        return [item.display, item.description, item.category].some((part) => part.toLocaleLowerCase().includes(value))
      })
    },
    key: atKey,
    filterKeys: ["display", "description"],
    groupBy: (item) => {
      if (item.type === "category") return "category"
      if (item.type === "rule") return "rule"
      if (item.type === "agent") return "agent"
      if (item.recent) return "recent"
      return "file"
    },
    sortGroupsBy: (a, b) => {
      const rank = (category: string) => {
        if (category === "category") return 0
        if (category === "rule") return 1
        if (category === "agent") return 2
        if (category === "recent") return 3
        return 4
      }
      return rank(a.category) - rank(b.category)
    },
    onSelect: handleAtSelect,
  })

  const slashCommands = createMemo<SlashCommand[]>(() => {
    const builtin = command.options
      .filter(
        (opt) => !opt.disabled && !opt.id.startsWith("suggested.") && opt.slash && !hiddenSlashCommandIDs.has(opt.id),
      )
      .map((opt) => ({
        id: opt.id,
        trigger: opt.slash!,
        title: opt.title,
        description: opt.description,
        keybind: opt.keybind,
        type: "builtin" as const,
      }))

    const custom = sync.data.command.map((cmd) => ({
      id: `custom.${cmd.name}`,
      trigger: cmd.name,
      title: cmd.name,
      description: cmd.description,
      type: "custom" as const,
      source: cmd.source,
    }))

    return [...custom, ...builtin]
  })

  const handleSlashSelect = (cmd: SlashCommand | undefined) => {
    if (!cmd) return
    closePopover()
    const images = imageAttachments()

    if (cmd.type === "custom") {
      const text = `/${cmd.trigger} `
      setEditorText(text)
      prompt.set([{ type: "text", content: text, start: 0, end: text.length }, ...images], text.length)
      focusEditorEnd()
      return
    }

    clearEditor()
    prompt.set([...DEFAULT_PROMPT, ...images], 0)
    command.trigger(cmd.id, "slash")
  }

  const {
    flat: slashFlat,
    active: slashActive,
    setActive: setSlashActive,
    onInput: slashOnInput,
    onKeyDown: slashOnKeyDown,
  } = useFilteredList<SlashCommand>({
    items: slashCommands,
    key: (x) => x?.id,
    filterKeys: ["trigger", "title"],
    onSelect: handleSlashSelect,
  })

  const createPill = (part: FileAttachmentPart | AgentPart) => {
    const pill = document.createElement("span")
    pill.textContent = part.content
    pill.setAttribute("data-type", part.type)
    if (part.type === "file") pill.setAttribute("data-path", part.path)
    if (part.type === "agent") pill.setAttribute("data-name", part.name)
    pill.setAttribute("contenteditable", "false")
    pill.style.userSelect = "text"
    pill.style.cursor = "default"
    return pill
  }

  const isNormalizedEditor = () =>
    Array.from(editorRef.childNodes).every((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent ?? ""
        if (!text.includes("\u200B")) return true
        if (text !== "\u200B") return false

        const prev = node.previousSibling
        const next = node.nextSibling
        const prevIsBr = prev?.nodeType === Node.ELEMENT_NODE && (prev as HTMLElement).tagName === "BR"
        return !!prevIsBr && !next
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return false
      const el = node as HTMLElement
      if (el.dataset.type === "file") return true
      if (el.dataset.type === "agent") return true
      return el.tagName === "BR"
    })

  const renderEditor = (parts: Prompt) => {
    clearEditor()
    for (const part of parts) {
      if (part.type === "text") {
        editorRef.appendChild(createTextFragment(part.content))
        continue
      }
      if (part.type === "file" || part.type === "agent") {
        editorRef.appendChild(createPill(part))
      }
    }

    const last = editorRef.lastChild
    if (last?.nodeType === Node.ELEMENT_NODE && (last as HTMLElement).tagName === "BR") {
      editorRef.appendChild(document.createTextNode("\u200B"))
    }
  }

  // Auto-scroll active command into view when navigating with keyboard
  createEffect(() => {
    const activeId = slashActive()
    if (!activeId || !slashPopoverRef) return

    requestAnimationFrame(() => {
      const element = slashPopoverRef.querySelector(`[data-slash-id="${activeId}"]`)
      element?.scrollIntoView({ block: "nearest", behavior: "smooth" })
    })
  })

  createEffect(() => {
    const activeId = atActive()
    if (!activeId || !slashPopoverRef) return

    requestAnimationFrame(() => {
      const element = slashPopoverRef.querySelector('[data-at-active="true"]')
      element?.scrollIntoView({ block: "nearest", behavior: "smooth" })
    })
  })
  const selectPopoverActive = () => {
    if (store.popover === "at") {
      const items = atFlat()
      if (items.length === 0) return
      const active = atActive()
      const item = items.find((entry) => atKey(entry) === active) ?? items[0]
      handleAtSelect(item)
      return
    }

    if (store.popover === "slash") {
      const items = slashFlat()
      if (items.length === 0) return
      const active = slashActive()
      const item = items.find((entry) => entry.id === active) ?? items[0]
      handleSlashSelect(item)
    }
  }

  const reconcile = (input: Prompt) => {
    if (mirror.input) {
      mirror.input = false
      if (isNormalizedEditor()) return

      renderEditorWithCursor(input)
      return
    }

    const dom = parseFromDOM()
    if (isNormalizedEditor() && isPromptEqual(input, dom)) return

    renderEditorWithCursor(input)
  }

  createEffect(
    on(
      () => prompt.current(),
      (parts) => {
        if (composing()) return
        reconcile(parts.filter((part) => part.type !== "image"))
      },
    ),
  )

  const parseFromDOM = (): Prompt => {
    const parts: Prompt = []
    let position = 0
    let buffer = ""

    const flushText = () => {
      let content = buffer
      if (content.includes("\r")) content = content.replace(/\r\n?/g, "\n")
      if (content.includes("\u200B")) content = content.replace(/\u200B/g, "")
      buffer = ""
      if (!content) return
      parts.push({ type: "text", content, start: position, end: position + content.length })
      position += content.length
    }

    const pushFile = (file: HTMLElement) => {
      const content = file.textContent ?? ""
      parts.push({
        type: "file",
        path: file.dataset.path!,
        content,
        start: position,
        end: position + content.length,
      })
      position += content.length
    }

    const pushAgent = (agent: HTMLElement) => {
      const content = agent.textContent ?? ""
      parts.push({
        type: "agent",
        name: agent.dataset.name!,
        content,
        start: position,
        end: position + content.length,
      })
      position += content.length
    }

    const visit = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        buffer += node.textContent ?? ""
        return
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return

      const el = node as HTMLElement
      if (el.dataset.type === "file") {
        flushText()
        pushFile(el)
        return
      }
      if (el.dataset.type === "agent") {
        flushText()
        pushAgent(el)
        return
      }
      if (el.tagName === "BR") {
        buffer += "\n"
        return
      }

      for (const child of Array.from(el.childNodes)) {
        visit(child)
      }
    }

    const children = Array.from(editorRef.childNodes)
    children.forEach((child, index) => {
      const isBlock = child.nodeType === Node.ELEMENT_NODE && ["DIV", "P"].includes((child as HTMLElement).tagName)
      visit(child)
      if (isBlock && index < children.length - 1) {
        buffer += "\n"
      }
    })

    flushText()

    if (parts.length === 0) parts.push(...DEFAULT_PROMPT)
    return parts
  }

  const handleInput = () => {
    const rawParts = parseFromDOM()
    const images = imageAttachments()
    const cursorPosition = getCursorPosition(editorRef)
    const rawText =
      rawParts.length === 1 && rawParts[0]?.type === "text"
        ? rawParts[0].content
        : rawParts.map((p) => ("content" in p ? p.content : "")).join("")
    const hasNonText = rawParts.some((part) => part.type !== "text")
    const textContent = (editorRef.textContent ?? "").replace(/\u200B/g, "")
    const shouldReset =
      textContent.length === 0 && rawText.replace(/\n/g, "").length === 0 && !hasNonText && images.length === 0

    if (shouldReset) {
      closePopover()
      resetHistoryNavigation()
      if (prompt.dirty()) {
        mirror.input = true
        prompt.set(DEFAULT_PROMPT, 0)
      }
      if (store.optimizeSnapshot !== null) setStore("optimizeSnapshot", null)
      queueScroll()
      return
    }

    const shellMode = store.mode === "shell"

    if (!shellMode) {
      const atMatch = rawText.substring(0, cursorPosition).match(/@(\S*)$/)
      const slashMatch = rawText.match(/^\/(\S*)$/)

      if (atMatch) {
        if (store.popover !== "at") setAtScope(undefined)
        atOnInput(atMatch[1])
        setStore("popover", "at")
      } else if (slashMatch) {
        slashOnInput(slashMatch[1])
        setStore("popover", "slash")
      } else {
        closePopover()
      }
    } else {
      closePopover()
    }

    resetHistoryNavigation()

    mirror.input = true
    prompt.set([...rawParts, ...images], cursorPosition)
    queueScroll()
  }

  const addPart = (part: ContentPart) => {
    if (part.type === "image") return false

    const selection = window.getSelection()
    if (!selection) return false

    if (selection.rangeCount === 0 || !editorRef.contains(selection.anchorNode)) {
      editorRef.focus()
      const cursor = prompt.cursor() ?? promptLength(prompt.current())
      setCursorPosition(editorRef, cursor)
    }

    if (selection.rangeCount === 0) return false
    const range = selection.getRangeAt(0)
    if (!editorRef.contains(range.startContainer)) return false

    if (part.type === "file" || part.type === "agent") {
      const cursorPosition = getCursorPosition(editorRef)
      const rawText = prompt
        .current()
        .map((p) => ("content" in p ? p.content : ""))
        .join("")
      const textBeforeCursor = rawText.substring(0, cursorPosition)
      const atMatch = textBeforeCursor.match(/@(\S*)$/)
      const pill = createPill(part)
      const gap = document.createTextNode(" ")

      if (atMatch) {
        const start = atMatch.index ?? cursorPosition - atMatch[0].length
        setRangeEdge(editorRef, range, "start", start)
        setRangeEdge(editorRef, range, "end", cursorPosition)
      }

      range.deleteContents()
      range.insertNode(gap)
      range.insertNode(pill)
      range.setStartAfter(gap)
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
    }

    if (part.type === "text") {
      const fragment = createTextFragment(part.content)
      const last = fragment.lastChild
      range.deleteContents()
      range.insertNode(fragment)
      if (last) {
        if (last.nodeType === Node.TEXT_NODE) {
          const text = last.textContent ?? ""
          if (text === "\u200B") {
            range.setStart(last, 0)
          }
          if (text !== "\u200B") {
            range.setStart(last, text.length)
          }
        }
        if (last.nodeType !== Node.TEXT_NODE) {
          const isBreak = last.nodeType === Node.ELEMENT_NODE && (last as HTMLElement).tagName === "BR"
          const next = last.nextSibling
          const emptyText = next?.nodeType === Node.TEXT_NODE && (next.textContent ?? "") === ""
          if (isBreak && (!next || emptyText)) {
            const placeholder = next && emptyText ? next : document.createTextNode("\u200B")
            if (!next) last.parentNode?.insertBefore(placeholder, null)
            placeholder.textContent = "\u200B"
            range.setStart(placeholder, 0)
          } else {
            range.setStartAfter(last)
          }
        }
      }
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
    }

    handleInput()
    closePopover()
    return true
  }

  const addToHistory = (prompt: Prompt, mode: "normal" | "shell") => {
    const currentHistory = mode === "shell" ? shellHistory : history
    const setCurrentHistory = mode === "shell" ? setShellHistory : setHistory
    const next = prependHistoryEntry(currentHistory.entries, prompt, mode === "shell" ? [] : historyComments())
    if (next === currentHistory.entries) return
    setCurrentHistory("entries", next)
  }

  createEffect(
    on(
      () => props.edit?.id,
      (id) => {
        const edit = props.edit
        if (!id || !edit) return

        for (const item of prompt.context.items()) {
          prompt.context.remove(item.key)
        }

        for (const item of edit.context) {
          prompt.context.add({
            type: item.type,
            path: item.path,
            selection: item.selection,
            comment: item.comment,
            commentID: item.commentID,
            commentOrigin: item.commentOrigin,
            preview: item.preview,
          })
        }

        setStore("mode", "normal")
        setStore("popover", null)
        setStore("historyIndex", -1)
        setStore("savedPrompt", null)
        prompt.set(edit.prompt, promptLength(edit.prompt))
        requestAnimationFrame(() => {
          editorRef.focus()
          setCursorPosition(editorRef, promptLength(edit.prompt))
          queueScroll()
        })
        props.onEditLoaded?.()
      },
      { defer: true },
    ),
  )

  const navigateHistory = (direction: "up" | "down") => {
    const result = navigatePromptHistory({
      direction,
      entries: store.mode === "shell" ? shellHistory.entries : history.entries,
      historyIndex: store.historyIndex,
      currentPrompt: prompt.current(),
      currentComments: historyComments(),
      savedPrompt: store.savedPrompt,
    })
    if (!result.handled) return false
    setStore("historyIndex", result.historyIndex)
    setStore("savedPrompt", result.savedPrompt)
    applyHistoryPrompt(result.entry, result.cursor)
    return true
  }

  const { addAttachments, removeAttachment, handlePaste } = createPromptAttachments({
    editor: () => editorRef,
    isDialogActive: () => !!dialog.active,
    setDraggingType: (type) => setStore("draggingType", type),
    focusEditor: () => {
      editorRef.focus()
      setCursorPosition(editorRef, promptLength(prompt.current()))
    },
    addPart,
    readClipboardImage: platform.readClipboardImage,
  })

  const variants = createMemo(() => ["default", ...local.model.variant.list()])
  const transformPrompt = (value: Prompt) => {
    if (!zenOfficeMode() || store.mode !== "normal") return value
    const launchConfig = office.launchConfig()
    const result = transformOfficePrompt({
      prompt: value,
      actionID: office.activeID(),
      quickMode: office.quickMode(),
      pptTemplate: office.pptTemplate(),
      launchConfig,
    })
    return result
  }
  const accepting = createMemo(() => {
    const id = params.id
    if (!id) return permission.isAutoAcceptingDirectory(sdk.directory)
    return permission.isAutoAccepting(id, sdk.directory)
  })
  const globalAutoApprove = createMemo(() => settings.permissions.autoApprove())
  const projectAutoAccept = createMemo(() => permission.isAutoAcceptingDirectory(sdk.directory))
  const autoAcceptEffective = createMemo(() => globalAutoApprove() || projectAutoAccept())
  const autoAcceptTooltip = createMemo(() => {
    if (globalAutoApprove()) return language.t("permissions.prompt.tooltip.global")
    return projectAutoAccept()
      ? language.t("permissions.prompt.tooltip.on")
      : language.t("permissions.prompt.tooltip.off")
  })

  const { abort, handleSubmit } = createPromptSubmit({
    info,
    imageAttachments,
    commentCount,
    autoAccept: () => accepting(),
    mode: () => store.mode,
    working,
    editor: () => editorRef,
    queueScroll,
    promptLength,
    addToHistory,
    resetHistoryNavigation: () => {
      resetHistoryNavigation(true)
    },
    setMode: (mode) => setStore("mode", mode),
    setPopover: (popover) => setStore("popover", popover),
    newSessionWorktree: () => props.newSessionWorktree,
    onNewSessionWorktreeReset: props.onNewSessionWorktreeReset,
    shouldQueue: props.shouldQueue,
    onQueue: props.onQueue,
    onAbort: props.onAbort,
    onSubmit: props.onSubmit,
    transformPrompt,
  })
  let submittedAutoKey: string | undefined

  createEffect(() => {
    const key = props.autoSubmitKey
    if (!key) return
    if (submittedAutoKey === key) return
    if (zenOfficeMode() && !office.ready()) return
    if (blank() || working() || store.optimizing) return

    submittedAutoKey = key
    queueMicrotask(() => void handleSubmit(new Event("submit", { cancelable: true })))
  })

  const handleKeyDown = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "u") {
      event.preventDefault()
      if (store.mode !== "normal") return
      pick()
      return
    }

    if (event.key === "Backspace") {
      const selection = window.getSelection()
      if (selection && selection.isCollapsed) {
        const node = selection.anchorNode
        const offset = selection.anchorOffset
        if (node && node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent ?? ""
          if (/^\u200B+$/.test(text) && offset > 0) {
            const range = document.createRange()
            range.setStart(node, 0)
            range.collapse(true)
            selection.removeAllRanges()
            selection.addRange(range)
          }
        }
      }
    }

    if (event.key === "!" && store.mode === "normal") {
      const cursorPosition = getCursorPosition(editorRef)
      if (cursorPosition === 0) {
        setStore("mode", "shell")
        setStore("popover", null)
        event.preventDefault()
        return
      }
    }

    if (event.key === "Escape") {
      if (store.popover) {
        closePopover()
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (store.mode === "shell") {
        setStore("mode", "normal")
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (working()) {
        void abort()
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (escBlur()) {
        editorRef.blur()
        event.preventDefault()
        event.stopPropagation()
        return
      }
    }

    if (store.mode === "shell") {
      const { collapsed, cursorPosition, textLength } = getCaretState()
      if (event.key === "Backspace" && collapsed && cursorPosition === 0 && textLength === 0) {
        setStore("mode", "normal")
        event.preventDefault()
        return
      }
    }

    // Handle Shift+Enter BEFORE IME check - Shift+Enter is never used for IME input
    // and should always insert a newline regardless of composition state
    if (event.key === "Enter" && event.shiftKey) {
      addPart({ type: "text", content: "\n", start: 0, end: 0 })
      event.preventDefault()
      return
    }

    if (event.key === "Enter" && isImeComposing(event)) {
      return
    }

    const ctrl = event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey

    if (store.popover) {
      if (event.key === "Tab") {
        selectPopoverActive()
        event.preventDefault()
        return
      }
      const nav = event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Enter"
      const ctrlNav = ctrl && (event.key === "n" || event.key === "p")
      if (nav || ctrlNav) {
        if (store.popover === "at") {
          atOnKeyDown(event)
          event.preventDefault()
          return
        }
        if (store.popover === "slash") {
          slashOnKeyDown(event)
        }
        event.preventDefault()
        return
      }
    }

    if (ctrl && event.code === "KeyG") {
      if (store.popover) {
        closePopover()
        event.preventDefault()
        return
      }
      if (working()) {
        void abort()
        event.preventDefault()
      }
      return
    }

    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      const { collapsed } = getCaretState()
      if (!collapsed) return

      const cursorPosition = getCursorPosition(editorRef)
      const textContent = prompt
        .current()
        .map((part) => ("content" in part ? part.content : ""))
        .join("")
      const direction = event.key === "ArrowUp" ? "up" : "down"
      if (!canNavigateHistoryAtCursor(direction, textContent, cursorPosition, store.historyIndex >= 0)) return
      if (navigateHistory(direction)) {
        event.preventDefault()
      }
      return
    }

    // Note: Shift+Enter is handled earlier, before IME check
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      if (event.repeat) return
      if (agentsLoading() || providersLoading() || !local.agent.current() || !local.model.current()) return
      if (
        working() &&
        prompt
          .current()
          .map((part) => ("content" in part ? part.content : ""))
          .join("")
          .trim().length === 0 &&
        imageAttachments().length === 0 &&
        commentCount() === 0
      ) {
        return
      }
      void handleSubmit(event)
    }
  }

  const [agentsQuery, globalProvidersQuery, providersQuery] = useQueries(() => ({
    queries: [
      queryOptions.agents(pathKey(sdk.directory)),
      queryOptions.providers(null),
      queryOptions.providers(pathKey(sdk.directory)),
    ],
  }))

  const agentsLoading = () => agentsQuery.isLoading
  const agentsShouldFadeIn = createMemo((prev) => prev ?? agentsLoading())
  const providersLoading = () => agentsLoading() || providersQuery.isLoading || globalProvidersQuery.isLoading
  const providersShouldFadeIn = createMemo((prev) => prev ?? providersLoading())

  const [promptReady] = createResource(
    () => prompt.ready().promise,
    (p) => p,
  )

  createEffect(() => {
    if (blank() && store.optimizeSnapshot !== null && !store.optimizing) {
      setStore("optimizeSnapshot", null)
    }
  })
  const undoOptimize = () => {
    const prev = store.optimizeSnapshot
    if (!prev || store.optimizing) return
    setEditorText(prev)
    prompt.set([{ type: "text", content: prev, start: 0, end: prev.length }], prev.length)
    setStore("optimizeSnapshot", null)
    focusEditorEnd()
  }
  const optimizePrompt = async () => {
    if (store.mode !== "normal" || store.optimizing) return

    // 优先读编辑器 DOM，避免 store 未同步时按钮/逻辑误判为空
    const editorText = (editorRef?.textContent ?? "").replace(/\u200B/g, "").trim()
    const storeText = prompt
      .current()
      .map((part) => ("content" in part ? part.content : ""))
      .join("")
      .trim()
    const text = editorText || storeText
    if (!text) {
      showToast({ title: "没有可优化的内容", description: "请先输入提示词再点击优化", variant: "error" })
      return
    }

    // 仅首次优化记录原文；失败则不保留撤销点
    const isFirstOptimize = store.optimizeSnapshot === null
    if (isFirstOptimize) setStore("optimizeSnapshot", text)

    setStore("optimizing", true)

    try {
      // 与发送消息一致：优先当前模型；Auto 时优先 NovaWay 可用模型
      let currentModel = local.model.current()
      if (modelsCtx.autoMode()) {
        const NovaWayModels = modelsCtx.list().filter((m) => m.provider?.id === "NovaWay")
        const pool = NovaWayModels.length > 0 ? NovaWayModels : modelsCtx.list()
        if (pool.length > 0) {
          // 选上下文较大的模型，优化提示词通常不需要极小模型
          currentModel = [...pool].sort((a, b) => (b.limit?.context ?? 0) - (a.limit?.context ?? 0))[0] ?? currentModel
        }
      }
      if (!currentModel?.provider?.id || !currentModel.id) {
        currentModel = modelsCtx.list().find((m) => m.provider?.id && m.id)
      }
      if (!currentModel?.provider?.id || !currentModel.id) {
        showToast({ title: "未选择模型", description: "请先选择一个模型再优化提示词", variant: "error" })
        return
      }

      const systemPrompt = `你是提示词优化专家。你的任务是在完整保留用户原始意图和核心信息的前提下，对用户的提示词进行全面优化。

## 优化原则
1. **意图优先** — 始终保留用户的原始目标和核心需求，不做任何偏离
2. **结构化清晰** — 使用合理的分段、列表或层次结构组织内容
3. **精准表达** — 消除歧义和模糊表述，用精确、具体的语言替代
4. **上下文完整** — 补充必要的背景信息，确保 AI 能充分理解任务
5. **简洁有力** — 去除冗余词汇，让每句话都有明确的信息价值

## 输出规则
- 直接输出优化后的提示词，不要添加任何解释、前缀、后缀或元信息
- 不改变原文的语气风格（技术/创意/正式/随意等）
- 如果原文已经足够优秀，可以仅做微调
- 保持原始语言（输入是中文就输出中文）
`

      const response = await sdk.client.chat.send({
        directory: sdk.directory,
        chatPayload: {
          message: text,
          system: systemPrompt,
          model: {
            providerID: currentModel.provider.id,
            modelID: currentModel.id,
          },
        },
      })

      // 兼容不同 SDK 包装：{ data: { text } } 或直接 { text }
      const payload = (response as { data?: { text?: string }; text?: string })?.data ?? response
      const optimizedText = (payload as { text?: string })?.text?.trim() ?? ""

      if (optimizedText) {
        setEditorText(optimizedText)
        prompt.set(
          [{ type: "text", content: optimizedText, start: 0, end: optimizedText.length }],
          optimizedText.length,
        )
        focusEditorEnd()
      } else {
        if (isFirstOptimize) setStore("optimizeSnapshot", null)
        showToast({ title: "优化失败", description: "AI 返回了空结果，请重试", variant: "error" })
      }
    } catch (err) {
      if (isFirstOptimize) setStore("optimizeSnapshot", null)
      console.error("提示词优化失败", err)
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === "object" &&
              err &&
              "message" in err &&
              typeof (err as { message: unknown }).message === "string"
            ? (err as { message: string }).message
            : "请求出错，请检查模型配置或网络连接"
      // 500 时给更可操作的提示
      const hint = /500|Internal Server Error/i.test(msg)
        ? "服务端优化接口异常，请确认当前模型可用，或切换到具体模型后再试"
        : msg
      showToast({
        title: "优化失败",
        description: hint,
        variant: "error",
      })
    } finally {
      setStore("optimizing", false)
    }
  }

  return (
    <div class="relative size-full _max-h-[600px] flex flex-col gap-0">
      {(promptReady(), null)}
      <style>{`
        @keyframes optimize-spin {
          to { transform: rotate(360deg); }
        }
        .animate-optimize-spin {
          animation: optimize-spin 0.8s linear infinite;
          transform-origin: center;
        }
      `}</style>
      <PromptPopover
        popover={store.popover}
        setSlashPopoverRef={(el) => (slashPopoverRef = el)}
        atFlat={atFlat()}
        atActive={atActive() ?? undefined}
        atKey={atKey}
        setAtActive={setAtActive}
        onAtSelect={handleAtSelect}
        slashFlat={slashFlat()}
        slashActive={slashActive() ?? undefined}
        setSlashActive={setSlashActive}
        onSlashSelect={handleSlashSelect}
        commandKeybind={command.keybind}
        t={(key) => language.t(key as Parameters<typeof language.t>[0])}
      />
      <DockShellForm
        onSubmit={handleSubmit}
        data-working={working() ? "true" : "false"}
        data-optimizing={store.optimizing ? "true" : "false"}
        classList={{
          "group/prompt-input": true,
          "focus-within:shadow-xs-border": !working() && !store.optimizing,
          "border-icon-info-active border-dashed": store.draggingType !== null,
          [props.class ?? ""]: !!props.class,
        }}
        style={{
          "border-radius": "16px",
          background: "var(--surface-raised-stronger-non-alpha)",
          "box-shadow":
            working() || store.optimizing
              ? undefined
              : "0 0 0 1px var(--border-weak-base), 0 4px 24px rgba(0, 0, 0, 0.08)",
          transition: working() || store.optimizing ? undefined : "box-shadow 0.2s ease",
        }}
      >
        <PromptDragOverlay
          type={store.draggingType}
          label={language.t(store.draggingType === "@mention" ? "prompt.dropzone.file.label" : "prompt.dropzone.label")}
        />
        <PromptContextItems
          items={contextItems()}
          active={(item) => {
            const active = comments.active()
            return !!item.commentID && item.commentID === active?.id && item.path === active?.file
          }}
          openComment={openComment}
          remove={(item) => {
            if (item.commentID) comments.remove(item.path, item.commentID)
            prompt.context.remove(item.key)
          }}
          t={(key) => language.t(key as Parameters<typeof language.t>[0])}
        />
        <PromptImageAttachments
          attachments={imageAttachments()}
          onOpen={(attachment) =>
            dialog.show(() => <ImagePreview src={attachment.dataUrl} alt={attachment.filename} />)
          }
          onRemove={removeAttachment}
          removeLabel={language.t("prompt.attachment.remove")}
        />
        <Show when={store.mode === "normal" || store.mode === "shell"}>
          <div class="px-2 pb-1 pt-2 flex items-center gap-2 min-w-0 border-b border-border-weak-base">
            <ProjectSwitcherChip />
            <Show when={store.mode === "shell"}>
              <div class="flex items-center gap-1.5 min-w-0">
                <Icon name="console" />
                <span class="truncate text-13-medium text-text-base">{language.t("prompt.mode.shell")}</span>
                <div class="flex-1" />
                <Button
                  variant="ghost"
                  class="text-text-base"
                  onClick={() => {
                    setStore("mode", "normal")
                  }}
                >
                  {language.t("common.cancel")}
                </Button>
              </div>
            </Show>
            <Show
              when={zenOfficeMode() || forgeAutoAgentMode()}
              fallback={
                <Show when={!agentsLoading()}>
                  <div
                    data-component="prompt-agent-control"
                    style={agentsShouldFadeIn() ? { animation: "fade-in 0.3s" } : undefined}
                  >
                    <TooltipKeybind
                      placement="top"
                      gutter={4}
                      title={language.t("command.agent.cycle")}
                      keybind={command.keybind("agent.cycle")}
                    >
                      <Select
                        size="normal"
                        options={agentNames()}
                        current={local.agent.current()?.name ?? ""}
                        label={(value) =>
                          agentDisplayName(value, sync.data.agent.find((agent) => agent.name === value)?.options)
                        }
                        onSelect={(value) => {
                          local.agent.set(value)
                          restoreFocus()
                        }}
                        class="capitalize max-w-[160px] text-text-strong"
                        valueClass="truncate text-13-medium text-text-strong"
                        triggerStyle={{ ...control(), "border-radius": "8px" }}
                        triggerProps={{ "data-action": "prompt-agent" }}
                        variant="ghost"
                      />
                    </TooltipKeybind>
                  </div>
                </Show>
              }
            >
              <Show when={zenOfficeMode()}>
                <div
                  data-component="prompt-office-agent-control"
                  class="flex h-7 min-w-0 max-w-[190px] items-center gap-1.5 rounded-[8px] px-2 text-13-regular text-text-base"
                  style={control()}
                >
                  <Icon name={office.activeAction().icon} size="small" class="shrink-0 text-emerald-200" />
                  <span class="truncate">{office.activeAction().title}</span>
                </div>
              </Show>
            </Show>
            <Show when={!providersLoading()}>
              <Show when={store.mode !== "shell"}>
                <div
                  data-component="prompt-model-control"
                  style={providersShouldFadeIn() ? { animation: "fade-in 0.3s" } : undefined}
                >
                  <Show
                    when={providers.paid().length > 0}
                    fallback={
                      <TooltipKeybind
                        placement="top"
                        gutter={4}
                        title={language.t("command.model.choose")}
                        keybind={command.keybind("model.choose")}
                      >
                        <Button
                          data-action="prompt-model"
                          as="div"
                          variant="ghost"
                          size="normal"
                          class="min-w-0 max-w-[320px] text-13-medium text-text-strong group"
                          style={{ ...control(), "border-radius": "8px" }}
                          onClick={() => {
                            void import("@/components/dialog-select-model-unpaid").then((x) => {
                              dialog.show(() => <x.DialogSelectModelUnpaid model={local.model} />)
                            })
                          }}
                        >
                          <Show when={modelsCtx.autoMode()}>
                            <Icon
                              name="autopilot"
                              class="size-4 shrink-0 opacity-40 group-hover:opacity-100 transition-opacity duration-150"
                              style={{ "will-change": "opacity", transform: "translateZ(0)" }}
                            />
                          </Show>
                          <Show when={!modelsCtx.autoMode() && local.model.current()?.provider?.id}>
                            <ProviderIcon
                              id={local.model.current()?.provider?.id ?? ""}
                              class="size-4 shrink-0 opacity-40 group-hover:opacity-100 transition-opacity duration-150"
                              style={{ "will-change": "opacity", transform: "translateZ(0)" }}
                            />
                          </Show>
                          <span class="truncate">
                            {modelsCtx.autoMode()
                              ? "Auto"
                              : (local.model.current()?.name ?? language.t("dialog.model.select.title"))}
                          </span>
                          <Icon name="chevron-down" size="small" class="shrink-0" />
                        </Button>
                      </TooltipKeybind>
                    }
                  >
                    <TooltipKeybind
                      placement="top"
                      gutter={4}
                      title={language.t("command.model.choose")}
                      keybind={command.keybind("model.choose")}
                    >
                      <ModelSelectorPopover
                        model={local.model}
                        triggerAs={Button}
                        triggerProps={{
                          variant: "ghost",
                          size: "normal",
                          style: { ...control(), "border-radius": "8px" },
                          class: "min-w-0 max-w-[320px] text-13-medium text-text-strong group",
                          "data-action": "prompt-model",
                        }}
                        onClose={restoreFocus}
                      >
                        <Show when={modelsCtx.autoMode()}>
                          <Icon
                            name="autopilot"
                            class="size-4 shrink-0 text-text-interactive-base transition-opacity duration-150"
                          />
                        </Show>
                        <Show when={!modelsCtx.autoMode() && local.model.current()?.provider?.id}>
                          <ProviderIcon
                            id={local.model.current()?.provider?.id ?? ""}
                            class="size-4 shrink-0 text-text-interactive-base transition-opacity duration-150"
                          />
                        </Show>
                        <span
                          class="truncate"
                          style={{
                            background: "linear-gradient(135deg, var(--text-interactive-base), #8b5cf6)",
                            "-webkit-background-clip": "text",
                            "-webkit-text-fill-color": "transparent",
                            "background-clip": "text",
                          }}
                        >
                          {modelsCtx.autoMode()
                            ? "Auto"
                            : (local.model.current()?.name ?? language.t("dialog.model.select.title"))}
                        </span>
                        <Icon name="chevron-down" size="small" class="shrink-0" />
                      </ModelSelectorPopover>
                    </TooltipKeybind>
                  </Show>
                </div>
                <Show when={!modelsCtx.autoMode() && variants().length > 2}>
                  <div
                    data-component="prompt-variant-control"
                    style={providersShouldFadeIn() ? { animation: "fade-in 0.3s" } : undefined}
                  >
                    <TooltipKeybind
                      placement="top"
                      gutter={4}
                      title={language.t("command.model.variant.cycle")}
                      keybind={command.keybind("model.variant.cycle")}
                    >
                      <Select
                        size="normal"
                        options={variants()}
                        current={local.model.variant.current() ?? "default"}
                        label={(x) => {
                          if (x === "default") return "默认"
                          if (x === "low") return "低"
                          if (x === "medium") return "中"
                          if (x === "high") return "高"
                          if (x === "max") return "高+"
                          return x
                        }}
                        onSelect={(value) => {
                          local.model.variant.set(value === "default" ? undefined : value)
                          restoreFocus()
                        }}
                        class="capitalize max-w-[160px] text-text-strong"
                        valueClass="truncate text-13-medium"
                        valueStyle={{
                          background: "linear-gradient(135deg, #8b5cf6, var(--text-interactive-base))",
                          "-webkit-background-clip": "text",
                          "-webkit-text-fill-color": "transparent",
                          "background-clip": "text",
                        }}
                        triggerStyle={{ ...control(), "border-radius": "8px" }}
                        triggerProps={{ "data-action": "prompt-model-variant" }}
                        variant="ghost"
                      />
                    </TooltipKeybind>
                  </div>
                </Show>
              </Show>
            </Show>
            <div class="flex-1" />
            <div class="flex items-center gap-3 whitespace-nowrap">
              <div
                class="px-1.5 py-0.5 text-12-medium rounded-md text-text-interactive-base cursor-default select-none"
                style={{ "font-weight": "var(--font-weight-semibold)" }}
              >
                自动联网
              </div>
              <div data-component="prompt-auto-accept">
                <Tooltip placement="top" gutter={4} value={autoAcceptTooltip()}>
                  <div
                    data-action="prompt-auto-accept"
                    class="flex items-center gap-1.5 text-12-medium text-text-interactive-base cursor-pointer select-none"
                  >
                    <span style={{ "font-weight": "var(--font-weight-semibold)" }}>
                      {language.t("permissions.prompt.currentProject")}
                    </span>
                    <Switch
                      checked={autoAcceptEffective()}
                      onChange={() => {
                        if (globalAutoApprove()) {
                          if (projectAutoAccept()) permission.toggleAutoAcceptDirectory(sdk.directory)
                          settings.permissions.setAutoApprove(false)
                          return
                        }
                        permission.toggleAutoAcceptDirectory(sdk.directory)
                      }}
                    />
                    <Show when={globalAutoApprove()}>
                      <span class="px-1.5 py-0.5 rounded-md bg-surface-hover text-11-medium text-text-weak">
                        {language.t("permissions.prompt.globalEnabled")}
                      </span>
                    </Show>
                  </div>
                </Tooltip>
              </div>
            </div>
          </div>
        </Show>
        <div
          class="relative"
          onMouseDown={(e) => {
            const target = e.target
            if (!(target instanceof HTMLElement)) return
            if (
              target.closest(
                '[data-action="prompt-attach"], [data-action="prompt-submit"], [data-action="prompt-optimize"], [data-action="prompt-optimize-undo"]',
              )
            ) {
              return
            }
            editorRef?.focus()
          }}
        >
          <div
            class="relative max-h-[240px] overflow-y-auto"
            ref={(el) => (scrollRef = el)}
            data-optimizing-content={store.optimizing ? "true" : "false"}
            style={{ "scroll-padding-bottom": space }}
          >
            <Show when={store.optimizing}>
              <div class="prompt-optimize-wave" aria-hidden="true" />
            </Show>
            <div
              data-component="prompt-input"
              data-optimizing={store.optimizing ? "true" : "false"}
              ref={(el) => {
                editorRef = el
                props.ref?.(el)
              }}
              role="textbox"
              aria-multiline="true"
              aria-label={placeholder()}
              contentEditable={!store.optimizing}
              autocapitalize={store.mode === "normal" ? "sentences" : "off"}
              autocorrect={store.mode === "normal" ? "on" : "off"}
              spellcheck={store.mode === "normal"}
              inputMode="text"
              // @ts-expect-error
              autocomplete="off"
              onInput={handleInput}
              onPaste={handlePaste}
              onCompositionStart={handleCompositionStart}
              onCompositionEnd={handleCompositionEnd}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              classList={{
                "select-text": true,
                "w-full pl-3 pr-2 pt-2 text-14-regular text-text-strong focus:outline-none whitespace-pre-wrap text-left!": true,
                "[&_[data-type=file]]:text-syntax-property": true,
                "[&_[data-type=agent]]:text-syntax-type": true,
                "font-mono!": store.mode === "shell",
              }}
              style={{ "padding-bottom": space }}
            />
            <div
              class="absolute top-0 inset-x-0 pl-3 pr-2 pt-2 text-14-regular text-text-weak pointer-events-none whitespace-nowrap truncate"
              classList={{ "font-mono!": store.mode === "shell" }}
              style={{ "padding-bottom": space, display: prompt.dirty() ? "none" : undefined }}
            >
              {placeholder()}
            </div>
          </div>

          <div
            aria-hidden="true"
            class="pointer-events-none absolute inset-x-0 bottom-0"
            style={{
              height: space,
            }}
          />

          <div class="pointer-events-none absolute bottom-2 right-2 flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPTED_FILE_TYPES.join(",")}
              class="hidden"
              onChange={(e) => {
                const list = e.currentTarget.files
                if (list) void addAttachments(Array.from(list))
                e.currentTarget.value = ""
              }}
            />

            <div class="relative z-20 flex items-center gap-1 pointer-events-auto">
              <Show when={store.optimizeSnapshot !== null && !store.optimizing}>
                <Tooltip placement="top" value="撤销优化，恢复原文">
                  <Button
                    data-action="prompt-optimize-undo"
                    type="button"
                    variant="ghost"
                    class="size-8 p-0"
                    onMouseDown={(event: MouseEvent) => {
                      event.preventDefault()
                      event.stopPropagation()
                    }}
                    onClick={(event: MouseEvent) => {
                      event.preventDefault()
                      event.stopPropagation()
                      undoOptimize()
                    }}
                    disabled={store.mode !== "normal"}
                    tabIndex={store.mode === "normal" ? undefined : -1}
                    aria-label="撤销优化"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      class="size-4 text-text-interactive-base"
                    >
                      <path d="M3 7v6h6" />
                      <path d="M3 13a9 9 0 1 0 3-7.7L3 7" />
                    </svg>
                  </Button>
                </Tooltip>
              </Show>
              <Tooltip
                placement="top"
                value={
                  store.optimizing
                    ? "优化中..."
                    : blank()
                      ? "先输入内容再优化提示词"
                      : store.optimizeSnapshot !== null
                        ? "再次优化提示词"
                        : "优化提示词"
                }
              >
                <Button
                  data-action="prompt-optimize"
                  type="button"
                  variant="ghost"
                  class="size-8 p-0"
                  onMouseDown={(event: MouseEvent) => {
                    event.preventDefault()
                    event.stopPropagation()
                  }}
                  onClick={(event: MouseEvent) => {
                    event.preventDefault()
                    event.stopPropagation()
                    void optimizePrompt()
                  }}
                  disabled={store.mode !== "normal" || store.optimizing}
                  tabIndex={store.mode === "normal" ? undefined : -1}
                  aria-label={store.optimizeSnapshot !== null ? "再次优化提示词" : "优化提示词"}
                >
                  <Show
                    when={store.optimizing}
                    fallback={
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        class="size-4 text-text-interactive-base"
                      >
                        <path d="M15 4V2M15 16V14M8 9H10M3 9H5M6 12L4 14M11 6L13.5 3.5M13.5 14.5L11 17" />
                        <path d="M9.5 5.5L15 11L13 13L7.5 7.5L9.5 5.5Z" fill="currentColor" opacity="0.3" />
                        <path d="M13 13L18 18" stroke-width="2" />
                      </svg>
                    }
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      class="size-4 text-text-interactive-base animate-optimize-spin"
                    >
                      <path d="M15 4V2M15 16V14M8 9H10M3 9H5M6 12L4 14M11 6L13.5 3.5M13.5 14.5L11 17" opacity="0.4" />
                      <path d="M9.5 5.5L15 11L13 13L7.5 7.5L9.5 5.5Z" fill="currentColor" opacity="0.4" />
                      <path d="M13 13L18 18" stroke-width="2" />
                    </svg>
                  </Show>
                </Button>
              </Tooltip>
              <Tooltip
                placement="top"
                inactive={(!working() && blank()) || store.optimizing || agentsLoading() || providersLoading()}
                value={agentsLoading() || providersLoading() ? "正在加载智能体和模型..." : tip()}
              >
                <IconButton
                  data-action="prompt-submit"
                  type="submit"
                  disabled={
                    (!working() && blank()) ||
                    store.optimizing ||
                    agentsLoading() ||
                    providersLoading() ||
                    !local.agent.current() ||
                    !local.model.current()
                  }
                  tabIndex={store.mode === "normal" ? undefined : -1}
                  icon={stopping() ? "stop" : store.mode === "shell" ? "arrow-undo-down" : "paper-plane"}
                  variant="primary"
                  class="size-8"
                  aria-label={stopping() ? language.t("prompt.action.stop") : language.t("prompt.action.send")}
                />
              </Tooltip>
            </div>
          </div>

          <div class="pointer-events-none absolute bottom-2 left-2">
            <div
              aria-hidden={store.mode !== "normal"}
              class="flex items-center gap-1 pointer-events-auto"
              style={{
                "pointer-events": buttonsSpring() > 0.5 ? "auto" : "none",
              }}
            >
              <TooltipKeybind
                placement="top"
                title={language.t("prompt.action.attachFile")}
                keybind={command.keybind("file.attach")}
              >
                <Button
                  data-action="prompt-attach"
                  type="button"
                  variant="ghost"
                  class="size-8 p-0"
                  style={buttons()}
                  onClick={pick}
                  disabled={store.mode !== "normal"}
                  tabIndex={store.mode === "normal" ? undefined : -1}
                  aria-label={language.t("prompt.action.attachFile")}
                >
                  <Icon name="link" class="size-4.5 text-text-interactive-base" />
                </Button>
              </TooltipKeybind>
              <Tooltip placement="top" value="提及 @" inactive={store.mode !== "normal"}>
                <Button
                  data-action="prompt-at"
                  type="button"
                  variant="ghost"
                  class="size-8 p-0"
                  style={buttons()}
                  onClick={() => {
                    editorRef.focus()
                    addPart({ type: "text", content: "@", start: 0, end: 0 })
                    setAtScope(undefined)
                    atOnInput("")
                    setStore("popover", "at")
                  }}
                  disabled={store.mode !== "normal"}
                  tabIndex={store.mode === "normal" ? undefined : -1}
                  aria-label="提及 @"
                >
                  <span class="text-sm font-semibold text-text-interactive-base">@</span>
                </Button>
              </Tooltip>
              <Tooltip placement="top" value="斜杠命令 /" inactive={store.mode !== "normal"}>
                <Button
                  data-action="prompt-slash"
                  type="button"
                  variant="ghost"
                  class="size-8 p-0"
                  style={buttons()}
                  onClick={() => {
                    editorRef.focus()
                    addPart({ type: "text", content: "/", start: 0, end: 0 })
                    slashOnInput("")
                    setStore("popover", "slash")
                  }}
                  disabled={store.mode !== "normal"}
                  tabIndex={store.mode === "normal" ? undefined : -1}
                  aria-label="斜杠命令 /"
                >
                  <span class="text-sm font-semibold text-text-interactive-base">/</span>
                </Button>
              </Tooltip>
            </div>
          </div>
        </div>
      </DockShellForm>
    </div>
  )
}
