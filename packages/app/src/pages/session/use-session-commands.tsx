import { useNavigate } from "@solidjs/router"
import { useCommand, type CommandOption } from "@/context/command"
import { useDialog } from "@novaway/ui/context/dialog"
import { previewSelectedLines } from "@novaway/ui/pierre/selection-bridge"
import { useFile, selectionFromLines, type FileSelection, type SelectedLineRange } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useLocal } from "@/context/local"
import { usePermission } from "@/context/permission"
import { usePlatform } from "@/context/platform"
import { usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useTerminal } from "@/context/terminal"
import { showToast } from "@novaway/ui/toast"
import { findLast } from "@novaway/core/util/array"
import { createSessionTabs } from "@/pages/session/helpers"
import { confirmOfficeEditorClose } from "@/pages/session/office-editor-session"
import { forgetTextHistory } from "@/pages/session/text-history"
import { extractPromptFromParts } from "@/utils/prompt"
import { UserMessage } from "@novaway/sdk/v2"
import { useSessionLayout } from "@/pages/session/session-layout"

export type SessionCommandContext = {
  navigateMessageByOffset: (offset: number) => void
  setActiveMessage: (message: UserMessage | undefined) => void
  focusInput: () => void
  review?: () => boolean
  /** 会话页的回滚：预览受影响文件 → 用户确认 → 执行。命令面板只负责选点。 */
  revertToMessage: (messageID: string) => void
}

const withCategory = (category: string) => {
  return (option: Omit<CommandOption, "category">): CommandOption => ({
    ...option,
    category,
  })
}

export const useSessionCommands = (actions: SessionCommandContext) => {
  const command = useCommand()
  const dialog = useDialog()
  const file = useFile()
  const language = useLanguage()
  const local = useLocal()
  const permission = usePermission()
  const platform = usePlatform()
  const prompt = usePrompt()
  const sdk = useSDK()
  const sync = useSync()
  const terminal = useTerminal()
  const layout = useLayout()
  const navigate = useNavigate()
  const { params, tabs, view } = useSessionLayout()

  const info = () => {
    const id = params.id
    if (!id) return
    return sync.session.get(id)
  }
  const globalChatOnly = () => sdk.directory === "global-chat" && (!params.id || info()?.scope !== "project")
  const hasReview = () => !!params.id
  const normalizeTab = (tab: string) => {
    if (!tab.startsWith("file://")) return tab
    return file.tab(tab)
  }
  const tabState = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab,
    review: actions.review,
    hasReview,
  })
  const activeFileTab = tabState.activeFileTab
  const closableTab = tabState.closableTab
  /** 分屏的目标 = 主窗格正在展示的内容（`preview` 宿主展开成具体文件标签）。 */
  const splitTarget = () => {
    const active = layout.sidePane.activeTab()
    if (active !== "preview") return active
    return activeFileTab()
  }

  const messages = () => {
    const id = params.id
    if (!id) return []
    return sync.data.message[id] ?? []
  }
  const userMessages = () => messages().filter((m) => m.role === "user") as UserMessage[]
  const visibleUserMessages = () => {
    const revert = info()?.revert?.messageID
    if (!revert) return userMessages()
    return userMessages().filter((m) => m.id < revert)
  }

  const selectionPreview = (path: string, selection: FileSelection) => {
    const content = file.get(path)?.content?.content
    if (!content) return undefined
    return previewSelectedLines(content, { start: selection.startLine, end: selection.endLine })
  }

  const addSelectionToContext = (path: string, selection: FileSelection) => {
    const preview = selectionPreview(path, selection)
    prompt.context.add({ type: "file", path, selection, preview })
  }

  const canAddSelectionContext = () => {
    const tab = activeFileTab()
    if (!tab) return false
    const path = file.pathFromTab(tab)
    if (!path) return false
    return file.selectedLines(path) != null
  }

  const navigateMessageByOffset = actions.navigateMessageByOffset
  const setActiveMessage = actions.setActiveMessage
  const focusInput = actions.focusInput

  const sessionCommand = withCategory(language.t("command.category.session"))
  const fileCommand = withCategory(language.t("command.category.file"))
  const contextCommand = withCategory(language.t("command.category.context"))
  const viewCommand = withCategory(language.t("command.category.view"))
  const terminalCommand = withCategory(language.t("command.category.terminal"))
  const modelCommand = withCategory(language.t("command.category.model"))
  const mcpCommand = withCategory(language.t("command.category.mcp"))
  const agentCommand = withCategory(language.t("command.category.agent"))
  const permissionsCommand = withCategory(language.t("command.category.permissions"))

  const isAutoAcceptActive = () => {
    const sessionID = params.id
    if (sessionID) return permission.isAutoAccepting(sessionID, sdk.directory)
    return permission.isAutoAcceptingDirectory(sdk.directory)
  }
  const write = async (value: string) => {
    const body = typeof document === "undefined" ? undefined : document.body
    if (body) {
      const textarea = document.createElement("textarea")
      textarea.value = value
      textarea.setAttribute("readonly", "")
      textarea.style.position = "fixed"
      textarea.style.opacity = "0"
      textarea.style.pointerEvents = "none"
      body.appendChild(textarea)
      textarea.select()
      const copied = document.execCommand("copy")
      body.removeChild(textarea)
      if (copied) return true
    }

    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard
    if (!clipboard?.writeText) return false
    return clipboard.writeText(value).then(
      () => true,
      () => false,
    )
  }

  const copyShare = async (url: string, existing: boolean) => {
    if (!(await write(url))) {
      showToast({
        title: language.t("toast.session.share.copyFailed.title"),
        variant: "error",
      })
      return
    }

    showToast({
      title: existing ? language.t("session.share.copy.copied") : language.t("toast.session.share.success.title"),
      description: language.t("toast.session.share.success.description"),
      variant: "success",
    })
  }

  const share = async () => {
    const sessionID = params.id
    if (!sessionID) return

    const existing = info()?.share?.url
    if (existing) {
      await copyShare(existing, true)
      return
    }

    const url = await sdk.client.session
      .share({ sessionID })
      .then((res) => res.data?.share?.url)
      .catch(() => undefined)
    if (!url) {
      showToast({
        title: language.t("toast.session.share.failed.title"),
        description: language.t("toast.session.share.failed.description"),
        variant: "error",
      })
      return
    }

    await copyShare(url, false)
  }

  const unshare = async () => {
    const sessionID = params.id
    if (!sessionID) return

    await sdk.client.session
      .unshare({ sessionID })
      .then(() =>
        showToast({
          title: language.t("toast.session.unshare.success.title"),
          description: language.t("toast.session.unshare.success.description"),
          variant: "success",
        }),
      )
      .catch(() =>
        showToast({
          title: language.t("toast.session.unshare.failed.title"),
          description: language.t("toast.session.unshare.failed.description"),
          variant: "error",
        }),
      )
  }

  const openFile = () => {
    void import("@/components/dialog-select-file").then((x) => {
      dialog.show(() => <x.DialogSelectFile />)
    })
  }

  const closeTab = () => {
    const tab = closableTab()
    if (!tab) return
    void (async () => {
      const closed = file.pathFromTab(tab)
      if (!(await confirmOfficeEditorClose(closed))) return
      if (closed) forgetTextHistory(closed)
      tabs().close(tab)
    })()
  }

  const addSelection = () => {
    const tab = activeFileTab()
    if (!tab) return

    const path = file.pathFromTab(tab)
    if (!path) return

    const range = file.selectedLines(path) as SelectedLineRange | null | undefined
    if (!range) {
      showToast({
        title: language.t("toast.context.noLineSelection.title"),
        description: language.t("toast.context.noLineSelection.description"),
      })
      return
    }

    addSelectionToContext(path, selectionFromLines(range))
  }

  const openTerminal = () => {
    if (terminal.all().length > 0) terminal.new()
    view().terminal.open()
  }

  const toggleReview = () => {
    layout.sidePane.add("review")
  }

  const chooseModel = () => {
    void import("@/components/dialog-select-model").then((x) => {
      dialog.show(() => <x.DialogSelectModel model={local.model} />)
    })
  }

  const chooseMcp = () => {
    void import("@/components/dialog-select-mcp").then((x) => {
      dialog.show(() => <x.DialogSelectMcp />)
    })
  }

  const toggleAutoAccept = () => {
    const sessionID = params.id
    if (sessionID) permission.toggleAutoAccept(sessionID, sdk.directory)
    else permission.toggleAutoAcceptDirectory(sdk.directory)

    const active = sessionID
      ? permission.isAutoAccepting(sessionID, sdk.directory)
      : permission.isAutoAcceptingDirectory(sdk.directory)
    showToast({
      title: active
        ? language.t("toast.permissions.autoaccept.on.title")
        : language.t("toast.permissions.autoaccept.off.title"),
      description: active
        ? language.t("toast.permissions.autoaccept.on.description")
        : language.t("toast.permissions.autoaccept.off.description"),
    })
  }

  const undo = async () => {
    const sessionID = params.id
    if (!sessionID) return

    if (sync.data.session_working(params.id ?? "")) {
      await sdk.client.session.abort({ sessionID }).catch(() => {})
    }

    const revert = info()?.revert?.messageID
    const message = findLast(userMessages(), (x) => !revert || x.id < revert)
    if (!message) return

    await sdk.client.session.revert({ sessionID, messageID: message.id })
    const parts = sync.data.part[message.id]
    if (parts) {
      const restored = extractPromptFromParts(parts, { directory: sdk.directory })
      prompt.set(restored)
    }

    const prev = findLast(userMessages(), (x) => x.id < message.id)
    setActiveMessage(prev)
  }

  const redo = async () => {
    const sessionID = params.id
    if (!sessionID) return

    const revertMessageID = info()?.revert?.messageID
    if (!revertMessageID) return

    const next = userMessages().find((x) => x.id > revertMessageID)
    if (!next) {
      await sdk.client.session.unrevert({ sessionID })
      prompt.reset()
      const last = findLast(userMessages(), (x) => x.id >= revertMessageID)
      setActiveMessage(last)
      return
    }

    await sdk.client.session.revert({ sessionID, messageID: next.id })
    const prev = findLast(userMessages(), (x) => x.id < next.id)
    setActiveMessage(prev)
  }

  const compact = async (instructions?: string) => {
    const sessionID = params.id
    if (!sessionID) return

    const model = local.model.current()
    if (!model) {
      showToast({
        title: language.t("toast.model.none.title"),
        description: language.t("toast.model.none.description"),
      })
      return
    }

    await sdk.client.session.summarize({
      sessionID,
      modelID: model.id,
      providerID: model.provider.id,
      // `/compact <text>`: focus the summary on what the user asked for.
      ...(instructions?.trim() ? { instructions: instructions.trim() } : {}),
    })
  }

  const fork = () => {
    void import("@/components/dialog-fork").then((x) => {
      dialog.show(() => <x.DialogFork />)
    })
  }

  const revertTo = () => {
    void import("@/components/dialog-revert").then((x) => {
      dialog.show(() => <x.DialogRevert onSelect={(messageID) => actions.revertToMessage(messageID)} />)
    })
  }

  const shareCmds = () => {
    if (sync.data.config.share === "disabled") return []
    return [
      sessionCommand({
        id: "session.share",
        title: info()?.share?.url ? language.t("session.share.copy.copyLink") : language.t("command.session.share"),
        description: info()?.share?.url
          ? language.t("toast.session.share.success.description")
          : language.t("command.session.share.description"),
        slash: "share",
        disabled: !params.id,
        onSelect: share,
      }),
      sessionCommand({
        id: "session.unshare",
        title: language.t("command.session.unshare"),
        description: language.t("command.session.unshare.description"),
        slash: "unshare",
        disabled: !params.id || !info()?.share?.url,
        onSelect: unshare,
      }),
    ]
  }

  const sessionCmds = () => [
    sessionCommand({
      id: "session.new",
      title: language.t("command.session.new"),
      keybind: "mod+shift+s",
      slash: "new",
      onSelect: () => navigate(sdk.directory === "global-chat" ? "/global-chat/session" : `/${params.dir}/session`),
    }),
    sessionCommand({
      id: "session.undo",
      title: language.t("command.session.undo"),
      description: language.t("command.session.undo.description"),
      slash: "undo",
      disabled: !params.id || visibleUserMessages().length === 0,
      onSelect: undo,
    }),
    sessionCommand({
      id: "session.redo",
      title: language.t("command.session.redo"),
      description: language.t("command.session.redo.description"),
      slash: "redo",
      disabled: !params.id || !info()?.revert?.messageID,
      onSelect: redo,
    }),
    sessionCommand({
      id: "session.revertTo",
      title: language.t("command.session.revertTo"),
      description: language.t("command.session.revertTo.description"),
      slash: "revert",
      disabled: !params.id || visibleUserMessages().length === 0,
      onSelect: revertTo,
    }),
    sessionCommand({
      id: "session.compact",
      title: language.t("command.session.compact"),
      description: language.t("command.session.compact.description"),
      slash: "compact",
      disabled: !params.id || visibleUserMessages().length === 0,
      onSelect: (_source, args) => compact(args),
    }),
    sessionCommand({
      id: "session.fork",
      title: language.t("command.session.fork"),
      description: language.t("command.session.fork.description"),
      slash: "fork",
      disabled: !params.id || visibleUserMessages().length === 0,
      onSelect: fork,
    }),
  ]

  const fileCmds = () => [
    fileCommand({
      id: "file.open",
      title: language.t("command.file.open"),
      description: language.t("palette.search.placeholder"),
      // ⌥⌘O 也绑快速打开；保留 mod+k / mod+p 这两个既有习惯。
      keybind: "mod+k,mod+p,alt+mod+o",
      slash: "open",
      onSelect: openFile,
    }),
    fileCommand({
      id: "tab.close",
      title: language.t("command.tab.close"),
      keybind: "mod+w",
      disabled: !closableTab(),
      onSelect: closeTab,
    }),
  ]

  const contextCmds = () => [
    contextCommand({
      id: "context.addSelection",
      title: language.t("command.context.addSelection"),
      description: language.t("command.context.addSelection.description"),
      keybind: "mod+shift+l",
      disabled: !canAddSelectionContext(),
      onSelect: addSelection,
    }),
  ]

  const viewCmds = () => [
    viewCommand({
      id: "terminal.toggle",
      title: language.t("command.terminal.toggle"),
      keybind: "ctrl+`",
      slash: "terminal",
      onSelect: () => view().terminal.toggle(),
    }),
    viewCommand({
      id: "preview.toggle",
      title: language.t("command.preview.toggle"),
      keybind: "mod+shift+b",
      slash: "preview",
      onSelect: () => layout.sidePane.add("browser"),
    }),
    viewCommand({
      id: "review.toggle",
      title: language.t("command.review.toggle"),
      keybind: "mod+shift+r",
      onSelect: toggleReview,
    }),
    viewCommand({
      id: "taskList.toggle",
      title: language.t("command.taskList.toggle"),
      keybind: "mod+shift+t",
      onSelect: () => {
        layout.statusPanel.setCollapsed(sdk.directory, false)
        layout.statusPanel.setOpen(sdk.directory, "todo", true)
      },
    }),
    viewCommand({
      id: "input.focus",
      title: language.t("command.input.focus"),
      keybind: "ctrl+l",
      onSelect: focusInput,
    }),
    // 分屏（⌘⌥→ / ⌘⌥↓ 把当前标签拆到右/下窗格，⌘⌥W 收回单栏）。
    viewCommand({
      id: "sidePane.split.right",
      title: language.t("sidePane.tab.openRight"),
      keybind: "mod+alt+arrowright",
      disabled: !splitTarget(),
      onSelect: () => {
        const id = splitTarget()
        if (id) layout.sidePane.openSecondary(id, "right")
      },
    }),
    viewCommand({
      id: "sidePane.split.below",
      title: language.t("sidePane.tab.openBelow"),
      // mod+alt+↓ 已经是「下一个项目」，这里加一层 shift，避免抢走既有快捷键。
      keybind: "mod+shift+alt+arrowdown",
      disabled: !splitTarget(),
      onSelect: () => {
        const id = splitTarget()
        if (id) layout.sidePane.openSecondary(id, "below")
      },
    }),
    viewCommand({
      id: "sidePane.split.close",
      title: language.t("sidePane.split.close"),
      keybind: "mod+alt+w",
      disabled: !layout.sidePane.secondary(),
      onSelect: () => layout.sidePane.closeSecondary(),
    }),
  ]

  const terminalCmds = () => [
    terminalCommand({
      id: "terminal.new",
      title: language.t("command.terminal.new"),
      description: language.t("command.terminal.new.description"),
      keybind: "ctrl+alt+t",
      onSelect: openTerminal,
    }),
  ]

  const messageCmds = () => [
    sessionCommand({
      id: "message.previous",
      title: language.t("command.message.previous"),
      description: language.t("command.message.previous.description"),
      keybind: "mod+alt+[",
      disabled: !params.id,
      onSelect: () => navigateMessageByOffset(-1),
    }),
    sessionCommand({
      id: "message.next",
      title: language.t("command.message.next"),
      description: language.t("command.message.next.description"),
      keybind: "mod+alt+]",
      disabled: !params.id,
      onSelect: () => navigateMessageByOffset(1),
    }),
  ]

  const modelCmds = () => [
    modelCommand({
      id: "model.choose",
      title: language.t("command.model.choose"),
      description: language.t("command.model.choose.description"),
      keybind: "mod+'",
      slash: "model",
      onSelect: chooseModel,
    }),
    modelCommand({
      id: "model.variant.cycle",
      title: language.t("command.model.variant.cycle"),
      description: language.t("command.model.variant.cycle.description"),
      keybind: "shift+mod+d",
      onSelect: () => local.model.variant.cycle(),
    }),
  ]

  const mcpCmds = () => [
    mcpCommand({
      id: "mcp.toggle",
      title: language.t("command.mcp.toggle"),
      description: language.t("command.mcp.toggle.description"),
      keybind: "mod+;",
      slash: "mcp",
      onSelect: chooseMcp,
    }),
  ]

  const agentCmds = () => [
    agentCommand({
      id: "agent.cycle",
      title: language.t("command.agent.cycle"),
      description: language.t("command.agent.cycle.description"),
      keybind: "mod+.",
      slash: "agent",
      onSelect: () => local.agent.move(1),
    }),
    agentCommand({
      id: "agent.cycle.reverse",
      title: language.t("command.agent.cycle.reverse"),
      description: language.t("command.agent.cycle.reverse.description"),
      keybind: "shift+mod+.",
      onSelect: () => local.agent.move(-1),
    }),
  ]

  const permissionsCmds = () => [
    permissionsCommand({
      id: "permissions.autoaccept",
      title: isAutoAcceptActive()
        ? language.t("command.permissions.autoaccept.disable")
        : language.t("command.permissions.autoaccept.enable"),
      keybind: "mod+shift+a",
      disabled: false,
      onSelect: toggleAutoAccept,
    }),
  ]

  command.register("session", () => [
    ...(globalChatOnly()
      ? sessionCmds().filter((item) => ["session.new", "message.previous", "message.next"].includes(item.id))
      : sessionCmds()),
    ...(globalChatOnly() ? [] : shareCmds()),
    ...(globalChatOnly() ? [] : fileCmds()),
    ...(globalChatOnly() ? [] : contextCmds()),
    ...(globalChatOnly() ? viewCmds().filter((item) => item.id === "input.focus") : viewCmds()),
    ...(globalChatOnly() ? [] : terminalCmds()),
    ...messageCmds(),
    ...modelCmds(),
    ...(globalChatOnly() ? [] : mcpCmds()),
    ...(globalChatOnly() ? [] : agentCmds()),
    ...(globalChatOnly() ? [] : permissionsCmds()),
  ])
}
