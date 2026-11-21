import {
  batch,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  ParentProps,
  Show,
  untrack,
} from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import { useLocation, useNavigate, useParams } from "@solidjs/router"
import { useLayout, LocalProject, sidePaneSideChatTabId } from "@/context/layout"
import { useSessionLayout } from "@/pages/session/session-layout"
import { ElicitationDialog } from "@/components/elicitation-dialog"
import { createMountTransition } from "@/utils/mount-transition"
import { useGlobalSync } from "@/context/global-sync"
import { Persist, persisted } from "@/utils/persist"
import { base64Encode } from "@novaway/core/util/encode"
import { decode64 } from "@/utils/base64"
import { ResizeHandle } from "@novaway/ui/resize-handle"
import { Button } from "@novaway/ui/button"
import { IconButton } from "@novaway/ui/icon-button"
import { Icon, isIconName } from "@novaway/ui/icon"
import { Keybind } from "@novaway/ui/keybind"
import { Mark } from "@novaway/ui/logo"
import { Tooltip, TooltipKeybind } from "@novaway/ui/tooltip"
import { Dialog } from "@novaway/ui/dialog"
import { TextField } from "@novaway/ui/text-field"
import { getDirectory, getFilename } from "@novaway/core/util/path"
import { Session, type Message, type QuestionRequest } from "@novaway/sdk/v2/client"
import { usePlatform } from "@/context/platform"
import {
  canCheckUpdate,
  checkForUpdate,
  configureUpdate,
  downloadUpdate,
  installUpdate,
  updateState,
} from "@/context/update"
import { DialogUpdateNotes } from "@/components/dialog-update-notes"
import { branchChannel as branchChannelOf } from "@/utils/session-library"
import { useSettings } from "@/context/settings"
import { createStore, produce, reconcile } from "solid-js/store"
import { Binary } from "@novaway/core/util/binary"
import { useProviders } from "@/hooks/use-providers"
import { showToast, Toast, toaster } from "@novaway/ui/toast"
import { useGlobalSDK } from "@/context/global-sdk"
import { clearWorkspaceTerminals, getTerminalServerScope } from "@/context/terminal"
import { dropSessionCaches, pickSessionCacheEvictions } from "@/context/global-sync/session-cache"
import {
  clearSessionPrefetchInflight,
  clearSessionPrefetch,
  getSessionPrefetch,
  isSessionPrefetchCurrent,
  runSessionPrefetch,
  setSessionPrefetch,
  shouldSkipSessionPrefetch,
} from "@/context/global-sync/session-prefetch"
import { useNotification } from "@/context/notification"
import { usePermission } from "@/context/permission"
import { retry } from "@novaway/core/util/retry"
import { playSoundById } from "@/utils/sound"

import { setNavigate } from "@/utils/notification-click"
import { Worktree as WorktreeState } from "@/utils/worktree"
import { setSessionHandoff } from "@/pages/session/handoff"

import { useDialog } from "@novaway/ui/context/dialog"
import { useTheme, type ColorScheme } from "@novaway/ui/theme/context"
import { useCommand, type CommandOption } from "@/context/command"
import { DialogSettings, isSettingsTab, type SettingsTab } from "@/components/dialog-settings"
import { DialogCreateProject } from "@/components/dialog-create-project"
import { DialogAddWorkspace } from "@/components/dialog-add-workspace"
import { DropdownMenu } from "@novaway/ui/dropdown-menu"
import { applyPath, backPath, forwardPath, type TitlebarHistory } from "@/components/titlebar-history"
import { DatabasePage } from "@/pages/database"
import { useServer } from "@/context/server"
import { workspacePanelRadiusPx } from "@/utils/workspace-chrome"
import { useLanguage, type Locale } from "@/context/language"
import { pathKey } from "@/utils/path-key"
import {
  CLOSE_FRAME_PAGES_EVENT,
  dateBucketOf,
  effectiveWorkspaceOrder,
  errorMessage,
  latestRootSession,
  sessionStatusOf,
  sortedRootSessions,
  TASK_DATE_BUCKETS,
  withinRecency,
} from "./layout/helpers"
import {
  collectNewSessionDeepLinks,
  collectOpenProjectDeepLinks,
  deepLinkEvent,
  drainPendingDeepLinks,
} from "./layout/deep-links"
import { drainPendingOpenFiles, openFilesEvent, queueOpenFiles } from "./layout/open-files"
import { resolveWorkspaceTreeDirectory } from "./layout/workspace-file-tree-helpers"
import { SidebarFiles } from "./layout/sidebar-files"
import { DialogTaskGroups } from "./layout/dialog-task-groups"
import { ProjectMenu, type ProjectSidebarContext } from "./layout/sidebar-project"
import { ProjectGitInit } from "./layout/sidebar-project-git"
import { ModeSwitchButton } from "@/components/mode-switch"
import { ThemeSchemeToggle } from "@/components/theme-scheme-toggle"
import { SettingsRailMenu } from "@/components/settings-rail-menu"
import { ResourceMonitorButton } from "@/components/resource-monitor-button"
import {
  ProjectTaskList,
  TaskFilterBar,
  useArchivedSessions,
  useTaskCounts,
  type TaskFilter,
} from "./layout/sidebar-tasks"
import { SidebarContent } from "./layout/sidebar-shell"
import { SidebarRail, SidebarRailButton, type SidebarRailItem } from "./layout/sidebar-rail"
import { ExtensionsPage } from "./extensions"
import { TeamPage } from "./team"
import { ArenaPage } from "./arena"
import PulseWorkspace from "@/pages/pulse/PulseWorkspace"
import { GlobalChatTasks } from "./layout/global-chat-tasks"

import { AutomationPage } from "./automation"
import { KnowledgePage } from "./knowledge"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

type PluginSurfaceAction =
  | { type: "view"; viewId: string }
  | { type: "command"; command: string }
  | { type: "url"; url: string }

type PluginContributionLike = {
  kind?: string
  pluginID?: string
  localName?: string
  name?: string
  status?: string
}

function dispatchPluginCommand(
  contribution: { pluginID: string },
  command: string,
  contributions: readonly PluginContributionLike[],
) {
  const declared = contributions.find(
    (item) =>
      item.kind === "command" &&
      item.pluginID === contribution.pluginID &&
      (item.status === "active" || item.status === "installed") &&
      (item.localName === command || item.name === command),
  )
  if (!declared) return false
  window.dispatchEvent(
    new CustomEvent("novaway:plugin-command", {
      detail: { pluginID: contribution.pluginID, command: declared.localName },
    }),
  )
  return true
}

function parsePluginSurfaceAction(value: unknown): PluginSurfaceAction | undefined {
  if (!isRecord(value) || typeof value.type !== "string") return undefined
  if (value.type === "view" && typeof value.viewId === "string" && value.viewId.length > 0) {
    return { type: "view", viewId: value.viewId }
  }
  if (value.type === "command" && typeof value.command === "string" && value.command.length > 0) {
    return { type: "command", command: value.command }
  }
  if (value.type === "url" && typeof value.url === "string" && value.url.length > 0) {
    return { type: "url", url: value.url }
  }
  return undefined
}

function pluginSurfaceViewPath(directorySlug: string, pluginID: string, viewId: string) {
  return `/${directorySlug}/plugin-view/${encodeURIComponent(pluginID)}/${encodeURIComponent(viewId)}`
}

function openPluginSurfaceUrl(value: string) {
  try {
    const url = new URL(value, window.location.href)
    if (url.protocol !== "http:" && url.protocol !== "https:") return
    window.open(url.href, "_blank", "noopener,noreferrer")
  } catch {
    // Invalid declarative URLs are ignored rather than interpreted as script URLs.
  }
}

function feishuQuestionText(questions: QuestionRequest["questions"]) {
  if (!Array.isArray(questions)) return ""
  return questions
    .map((question, index) => {
      const options = (Array.isArray(question.options) ? question.options : [])
        .map((option, optionIndex) => {
          const code = String.fromCharCode(65 + optionIndex)
          return `${code}. ${option.label ?? ""}${option.description ? ` - ${option.description}` : ""}`
        })
        .join("\n")
      const title =
        question.header && question.header !== question.question
          ? `${question.header}：${question.question}`
          : question.question
      const hint = question.multiple ? "（可多选，多个选项用逗号分隔）" : ""
      return `问题 ${index + 1}：${title}${hint}\n${options}`
    })
    .join("\n\n")
}

export default function Layout(props: ParentProps) {
  const [store, setStore, , ready] = persisted(
    Persist.global("layout.page", ["layout.page.v2"]),
    createStore({
      lastProjectSession: {} as { [directory: string]: { directory: string; id: string; at: number } },
      activeWorkspace: undefined as string | undefined,
      workspaceOrder: {} as Record<string, string[]>,
      workspaceName: {} as Record<string, string>,
      workspaceBranchName: {} as Record<string, Record<string, string>>,
      workspaceExpanded: {} as Record<string, boolean>,
      // 侧栏项目分组的展开态。**不要复用 `workspaceExpanded`**：那个键同时被
      // "worktree 分组自动收起"的 effect 使用（见 visibleSessionDirs 上方），
      // 项目根目录的 key 正好在它的处理范围内，展开后会被立刻改回 false ——
      // 表现就是"项目展不开了"。
      projectExpanded: {} as Record<string, boolean>,
      gettingStartedDismissed: false,
    }),
  )

  const pageReady = createMemo(() => ready())

  let scrollContainerRef: HTMLDivElement | undefined
  let dialogRun = 0
  let dialogDead = false

  const params = useParams()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const layout = useLayout()
  const sessionLayout = useSessionLayout()
  const layoutReady = createMemo(() => layout.ready())
  const platform = usePlatform()
  const [appAppearance, setAppAppearance] = createStore<{ iconData?: string }>({})
  const settings = useSettings()
  const server = useServer()
  const notification = useNotification()
  const permission = usePermission()
  const navigate = useNavigate()
  const location = useLocation()

  // 整帧页面和会话聊天共用同一块主工作区。右侧面板展开时，覆盖页也要
  // 让出相同的宽度，不能继续用 absolute right: 8px 把面板盖住。
  const framePageRight = () => {
    if (!layout.sidePane.opened()) return "8px"
    const viewport = typeof window === "undefined" ? 1000 : window.innerWidth
    const sidePane = Math.min(layout.sidePane.width(), Math.round(viewport * 0.6))
    return `${sidePane + 8}px`
  }

  const framePageBottom = () => {
    const view = sessionLayout.view()
    const paneTerminal = layout.sidePane.opened() && layout.sidePane.activeTab() === "terminal"
    if (!view.terminal.opened() || paneTerminal) return "8px"
    const viewport = typeof window === "undefined" ? 1000 : (window.visualViewport?.height ?? window.innerHeight)
    const terminal = Math.min(layout.terminal.height(), Math.round(viewport * 0.6))
    return `${terminal + 8}px`
  }

  const sendFeishuNotification = (
    title: string,
    description: string,
    href: string,
    enabledType: boolean,
    directory?: string,
    sessionID?: string,
    question?: {
      requestID: string
      questions: QuestionRequest["questions"]
    },
  ) => {
    if (!settings.notifications.feishu.enabled()) {
      if (question) showToast({ title: "飞书问题通知未发送", description: "飞书消息通知总开关未开启。" })
      return
    }
    if (!enabledType) {
      if (question) showToast({ title: "飞书问题通知未发送", description: "收到问题通知开关未开启。" })
      return
    }
    if (settings.notifications.feishu.onlyWhenUnfocused() && document.hasFocus()) {
      if (question)
        showToast({ title: "飞书问题通知已跳过", description: "当前窗口在前台，已按“仅在窗口不在前台时转发”跳过。" })
      return
    }
    const projectName = directory ? directory.split(/[\\/]/).filter(Boolean).pop() : undefined
    const questionBody = question ? feishuQuestionText(question.questions) : undefined
    const text = question
      ? `NovaWay：${title}${projectName ? `\n项目：${projectName}` : ""}\n${questionBody}\n回复示例：1=A 2=B,C`
      : `NovaWay：${title}${projectName ? `\n项目：${projectName}` : ""}${description ? `\n${description}` : ""}${href ? `\n${href}` : ""}\n直接回复这条消息即可继续该会话。`
    void globalSDK.client.office.platform.connector
      .action({
        id: "feishu",
        action: "send_message",
        arguments: {
          text,
          ...(directory ? { directory } : {}),
          ...(sessionID ? { sessionID } : {}),
          ...(question?.requestID ? { questionRequestID: question.requestID } : {}),
          ...(question ? { questions: question.questions } : {}),
        },
      })
      .then(() => {
        if (question) showToast({ title: "飞书问题通知已发送", description: "请到飞书查看问题选项并回复。" })
      })
      .catch((error) => {
        console.error("[feishu] send notification failed", error)
        if (question) {
          showToast({
            title: "飞书问题通知发送失败",
            description: String(error instanceof Error ? error.message : error),
          })
        }
      })
  }

  setNavigate(navigate)
  const providers = useProviders()
  const dialog = useDialog()
  const command = useCommand()
  const theme = useTheme()
  const language = useLanguage()
  const initialDirectory = decode64(params.dir)
  const route = createMemo(() => {
    const slug = params.dir
    if (!slug) return { slug, dir: "" }
    const dir = decode64(slug)
    if (!dir) return { slug, dir: "" }
    const store = globalSync.peek(dir, { bootstrap: false })
    return {
      slug,
      store,
      dir: store[0].path.directory || dir,
    }
  })
  const availableThemeEntries = createMemo(() => theme.ids().map((id) => [id, theme.themes()[id]] as const))
  const colorSchemeOrder: ColorScheme[] = ["system", "light", "dark"]
  const colorSchemeKey: Record<ColorScheme, "theme.scheme.system" | "theme.scheme.light" | "theme.scheme.dark"> = {
    system: "theme.scheme.system",
    light: "theme.scheme.light",
    dark: "theme.scheme.dark",
  }
  const colorSchemeLabel = (scheme: ColorScheme) => language.t(colorSchemeKey[scheme])
  const currentDir = createMemo(() => route().dir)
  const [extensionUpdateCount, setExtensionUpdateCount] = createSignal(0)
  const refreshExtensionUpdates = () => {
    const directory = currentDir()
    if (!directory) {
      setExtensionUpdateCount(0)
      return
    }
    void globalSDK.client.extension
      .marketplaceCatalog({ directory })
      .then((result) => {
        const updates = (result.data as unknown as { updates?: Array<{ state?: string }> } | undefined)?.updates ?? []
        setExtensionUpdateCount(updates.filter((item) => item.state === "outdated").length)
      })
      .catch(() => undefined)
  }
  createEffect(on(currentDir, refreshExtensionUpdates, { defer: true }))
  onMount(() => {
    const timer = setInterval(refreshExtensionUpdates, 10 * 60 * 1000)
    onCleanup(() => clearInterval(timer))
  })
  const modeStyle = createMemo(() => {
    const mode = layout.mode.all().find((item) => item.id === layout.mode.current())
    if (!mode) return {}
    return {
      "--novaway-mode-color": mode.color,
      "--novaway-mode-foreground": mode.foreground,
      "--novaway-mode-tint": `color-mix(in srgb, ${mode.color} 14%, transparent)`,
      "--novaway-mode-soft": `color-mix(in srgb, ${mode.color} 8%, transparent)`,
      "--novaway-mode-border": `color-mix(in srgb, ${mode.color} 38%, transparent)`,
    }
  })

  // 无项目聊天是独立路由（没有 :dir），不能触发「自动打开最近项目」——
  // 否则进去的瞬间会被重定向回项目会话。
  const isGlobalChatRoute = () => location.pathname.startsWith("/global-chat")

  const [state, setState] = createStore({
    autoselect: !initialDirectory && !isGlobalChatRoute(),
    busyWorkspaces: {} as Record<string, boolean>,
    hoverProject: undefined as string | undefined,
    scrollSessionKey: undefined as string | undefined,
    settings: {
      open: false,
      directory: undefined as string | undefined,
      initialTab: undefined as SettingsTab | undefined,
    },
    databasePage: {
      open: false,
    },
    extensionsPage: {
      open: false,
    },
    automationPage: {
      open: false,
    },
    knowledgePage: {
      open: false,
    },
    teamPage: {
      open: false,
    },
    arenaPage: {
      open: false,
    },
    pulsePage: {
      open: false,
    },

    sortNow: Date.now(),
    sizing: false,
  })

  // 这些是「整帧覆盖」页面：同一时间只能有一个。
  // 之前各入口只负责把自己打开，没有关掉上一个，于是数据库打开后点自动化/设置，
  // 新页面其实被压在数据库下面，看起来像"点了没反应"。
  const FRAME_PAGES = [
    "settings",
    "databasePage",
    "extensionsPage",
    "automationPage",
    "knowledgePage",
    "teamPage",
    "arenaPage",
    "pulsePage",
  ] as const
  type FramePage = (typeof FRAME_PAGES)[number]

  function closeFramePages(except?: FramePage) {
    let changed = false
    for (const page of FRAME_PAGES) {
      if (page === except || !state[page].open) continue
      setState(page, "open", false)
      changed = true
    }
    // 覆盖层关闭后让聊天区重新校验一次可视区域：面板动画期间
    // 虚拟列表可能测到 0 高度，回来时会一片空白，直到用户滚一下才恢复。
    if (changed) window.dispatchEvent(new CustomEvent("novaway:overlay-closed"))
  }

  // 设置 / 数据库是「整帧覆盖」的面板，用 mount-transition 拿到开**和关**两个方向的过渡
  // （<Show> 只有存在/不存在两态，关掉时是瞬间消失）。时长与侧栏/面板统一。
  const settingsTransition = createMountTransition(() => state.settings.open)
  const databaseTransition = createMountTransition(() => state.databasePage.open)
  // 侧栏里点会话时，如果正停在设置/数据库/自动化/扩展这些整帧页面上，
  // 应该回到那条会话（用户预期是"点了就跳过去"），而不是留在页面后面。
  // 路由变化是唯一可靠的信号：这些页面本身不改路由。
  createEffect(
    on(
      () => location.pathname,
      () => closeFramePages(),
      { defer: true },
    ),
  )

  const extensionsTransition = createMountTransition(() => state.extensionsPage.open)
  const teamTransition = createMountTransition(() => state.teamPage.open)
  const arenaTransition = createMountTransition(() => state.arenaPage.open)

  // 窄窗口下侧栏是浮层（z-50、fixed），盖在上面会让覆盖层的返回按钮点不到。
  // 打开任何整帧页面时先把移动侧栏收起来。
  createEffect(() => {
    if (
      state.settings.open ||
      state.databasePage.open ||
      state.extensionsPage.open ||
      state.automationPage.open ||
      state.knowledgePage.open ||
      state.teamPage.open ||
      state.arenaPage.open
    ) {
      layout.mobileSidebar.hide()
    }
  })
  const automationTransition = createMountTransition(() => state.automationPage.open)
  const pulseTransition = createMountTransition(() => state.pulsePage.open)
  const knowledgeTransition = createMountTransition(() => state.knowledgePage.open)

  // 这里**刻意不做**路由级的入场重放。
  //
  // 曾经在 pathname 变化时重放 `page-transition`，结果是每次导航（尤其是"新建任务 →
  // 发出第一条消息"）整个主区从 opacity 0 淡回来。实测：提交后 0ms 主区 opacity
  // 掉到 0.00，再过 ~1s 才回到 1.00 —— 视觉上就是"闪一下，然后才是过渡"，
  // 而且它会连 Header 一起闪。
  //
  // 内容区的入场交给会话页自己的 `session-stage-enter`（只作用在内容上，不含 Header
  // 与输入框，时长也短得多），导航切换不再有整片空白。

  const setBusy = (directory: string, value: boolean) => {
    const key = pathKey(directory)
    if (value) {
      setState("busyWorkspaces", key, true)
      return
    }
    setState(
      "busyWorkspaces",
      produce((draft) => {
        delete draft[key]
      }),
    )
  }
  const isBusy = (directory: string) => state.busyWorkspaces[pathKey(directory)]
  const sortNow = () => state.sortNow
  let sizet: number | undefined
  let sortNowInterval: ReturnType<typeof setInterval> | undefined
  const sortNowTimeout = setTimeout(
    () => {
      setState("sortNow", Date.now())
      sortNowInterval = setInterval(() => setState("sortNow", Date.now()), 60_000)
    },
    60_000 - (Date.now() % 60_000),
  )

  onCleanup(() => {
    dialogDead = true
    dialogRun += 1
    clearTimeout(sortNowTimeout)
    if (sortNowInterval) clearInterval(sortNowInterval)
    if (sizet !== undefined) clearTimeout(sizet)
  })

  onMount(() => {
    void platform.getAppAppearance?.().then((appearance) => setAppAppearance("iconData", appearance.iconData))
    const dispose = platform.onAppAppearanceChange?.((appearance) => setAppAppearance("iconData", appearance.iconData))
    if (dispose) onCleanup(dispose)
    const stop = () => setState("sizing", false)
    makeEventListener(window, "pointerup", stop)
    makeEventListener(window, "pointercancel", stop)
    makeEventListener(window, "blur", stop)
    // 点当前会话时路由不变，靠这个事件主动收起整帧页面。
    makeEventListener(window, CLOSE_FRAME_PAGES_EVENT, () => closeFramePages())
  })

  createEffect(() => {
    if (layout.sidebar.opened()) layout.sidebar.close()
  })

  // 项目/工作区切换时会复用同一个布局持久化状态，但右侧文件面板属于当前目录。
  // 路由变化后统一关闭并清理，避免新项目恢复旧项目的文件标签、文件树或分屏。
  createEffect(
    on(
      () => params.dir,
      (directory, previous) => {
        if (previous !== undefined && directory !== previous) layout.sidePane.close()
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    if (!state.autoselect) return
    const dir = params.dir
    if (!dir) return
    const directory = decode64(dir)
    if (!directory) return
    setState("autoselect", false)
  })

  createEffect(
    on(
      () => location.pathname,
      (pathname) => {
        if (!pathname.startsWith("/global-chat")) return
        setState("autoselect", false)
      },
      { defer: true },
    ),
  )

  const clearSidebarHoverState = () => {}

  const navigateWithSidebarReset = (href: string) => {
    clearSidebarHoverState()
    // 显式关闭，而不是只依赖 pathname 变化：从 /session 再点「新建任务」时
    // 路径不变，路由 effect 不会触发，覆盖层就会一直压在会话上面。
    closeFramePages()
    navigate(href)
    layout.mobileSidebar.hide()
  }

  function cycleTheme(direction = 1) {
    const ids = availableThemeEntries().map(([id]) => id)
    if (ids.length === 0) return
    const currentIndex = ids.indexOf(theme.themeId())
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + direction + ids.length) % ids.length
    const nextThemeId = ids[nextIndex]
    theme.setTheme(nextThemeId)
    showToast({
      title: language.t("toast.theme.title"),
      description: theme.name(nextThemeId),
    })
  }

  function cycleColorScheme(direction = 1) {
    const current = theme.colorScheme()
    const currentIndex = colorSchemeOrder.indexOf(current)
    const nextIndex =
      currentIndex === -1 ? 0 : (currentIndex + direction + colorSchemeOrder.length) % colorSchemeOrder.length
    const next = colorSchemeOrder[nextIndex]
    theme.setColorScheme(next)
    showToast({
      title: language.t("toast.scheme.title"),
      description: colorSchemeLabel(next),
    })
  }

  function setLocale(next: Locale) {
    if (next === language.locale()) return
    language.setLocale(next)
    showToast({
      title: language.t("toast.language.title"),
      description: language.t("toast.language.description", { language: language.label(next) }),
    })
  }

  function cycleLanguage(direction = 1) {
    const locales = language.locales
    const currentIndex = locales.indexOf(language.locale())
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + direction + locales.length) % locales.length
    const next = locales[nextIndex]
    if (!next) return
    setLocale(next)
  }

  // 更新状态是应用级的（见 context/update.ts）：检查中 / 有新版本 / 下载 percent /
  // 已下载都由桌面端主进程驱动，切页面不会重置成"空闲"。
  configureUpdate({ platform, t: language.t })

  const updateButtonLabel = () => {
    const state = updateState
    switch (state.stage) {
      case "checking":
        return language.t("update.checking")
      case "downloading":
        return `${state.percent}%`
      case "available":
      case "downloaded":
        return state.version ? `${language.t("update.ready.label")} ${state.version}` : language.t("update.ready.label")
      default:
        return language.t("update.ready.label")
    }
  }

  const updateButtonTooltip = () => {
    const state = updateState
    switch (state.stage) {
      case "checking":
        return language.t("update.checking.tooltip")
      case "downloading":
        return language.t("update.downloading.tooltip", { percent: state.percent })
      case "available":
        return language.t("update.available.tooltip")
      case "downloaded":
        return language.t("update.ready.tooltip")
      default:
        return language.t("update.ready.label")
    }
  }

  const updateButtonVisible = () => {
    const state = updateState
    // 下载完成 → 一律显示（自动检查也一样，和改造前一致）。
    if (state.stage === "downloaded") return true
    // 检查中 / 有新版本 / 下载中只在「用户自己点的检查」时显示；
    // 启动或定时触发的自动检查保持静默，查到就自己下，下完按钮才出现。
    if (!state.manual) return false
    return state.stage === "checking" || state.stage === "available" || state.stage === "downloading"
  }

  const updateButtonBusy = () => updateState.stage === "checking" || updateState.stage === "downloading"

  // 图标文字色随背景等级匹配：下载中使用 strong surface，其余成功状态使用 base surface。
  const updateIconColor = () => {
    if (updateState.stage === "checking") return "var(--foreground-subtle)"
    if (updateState.stage === "downloading") return "var(--text-on-success-strong)"
    return "var(--text-on-success-base)"
  }

  // 点按钮先看「这次更新改了什么」：manual 路径在「有新版本」时点开是下载，
  // 自动路径在「已下载」时点开是安装。两者都先弹更新说明。
  const onUpdateButtonClick = () => {
    const stage = updateState.stage
    if (stage !== "available" && stage !== "downloaded") return
    const action = stage === "available" ? "download" : "install"
    dialog.show(() => (
      <DialogUpdateNotes
        version={updateState.version}
        notes={updateState.notes}
        action={action}
        busy={updateButtonBusy()}
        onAction={() => {
          dialog.close()
          void (action === "download" ? downloadUpdate() : installUpdate())
        }}
      />
    ))
  }

  const useUpdatePolling = () =>
    onMount(() => {
      if (!canCheckUpdate()) return

      let interval: ReturnType<typeof setInterval> | undefined
      // 本次会话是否已经有过一次「开机检查」。开机那次由主进程负责（见
      // desktop/main/index.ts 的 autoUpdateEnabled 分支），渲染层再查一遍就是
      // 同一个 latest.yml 打两次 —— 还会把正在后台下载的状态短暂覆盖成「有新版本」。
      // 只有用户中途把开关重新打开时，才需要立刻补一次。
      let checkedOnLaunch = false

      createEffect(() => {
        if (!settings.ready()) return

        // 开关状态同步给主进程：启动检查在主进程里跑，只关渲染进程的轮询等于没关。
        void platform.setAutoUpdate?.(settings.updates.startup())

        if (!settings.updates.startup()) {
          if (interval === undefined) return
          clearInterval(interval)
          interval = undefined
          return
        }

        if (interval !== undefined) return
        if (checkedOnLaunch) void checkForUpdate()
        checkedOnLaunch = true
        interval = setInterval(() => void checkForUpdate(), 10 * 60 * 1000)
      })

      onCleanup(() => {
        if (interval === undefined) return
        clearInterval(interval)
      })
    })

  const useSDKNotificationToasts = () =>
    onMount(() => {
      const toastBySession = new Map<string, number>()
      const alertedAtBySession = new Map<string, number>()
      const cooldownMs = 5000

      const dismissSessionAlert = (sessionKey: string) => {
        const toastId = toastBySession.get(sessionKey)
        if (toastId === undefined) return
        toaster.dismiss(toastId)
        toastBySession.delete(sessionKey)
        alertedAtBySession.delete(sessionKey)
      }

      const unsub = globalSDK.event.listen((e) => {
        if (e.details?.type === "worktree.ready") {
          setBusy(e.name, false)
          WorktreeState.ready(e.name)
          return
        }

        if (e.details?.type === "worktree.failed") {
          setBusy(e.name, false)
          WorktreeState.failed(e.name, e.details.properties?.message ?? language.t("common.requestFailed"))
          return
        }

        const details = e.details as
          | { type?: string; properties?: { requestID?: string; answers?: string[][] } }
          | undefined
        if (details?.type === "question.feishu.replied") {
          const props = details.properties as { requestID: string; answers: string[][] }
          void globalSDK.client.question
            .reply({
              requestID: props.requestID,
              answers: props.answers,
              directory: e.name,
            })
            .catch((error) => {
              console.error("[feishu] question reply via app failed", error)
            })
          return
        }

        if (
          e.details?.type === "question.replied" ||
          e.details?.type === "question.rejected" ||
          e.details?.type === "permission.replied"
        ) {
          const props = e.details.properties as { sessionID: string; requestID?: string }
          const sessionKey = `${e.name}:${props.sessionID}`
          dismissSessionAlert(sessionKey)
          return
        }

        if (e.details?.type !== "permission.asked" && e.details?.type !== "question.asked") return
        const title =
          e.details.type === "permission.asked"
            ? language.t("notification.permission.title")
            : language.t("notification.question.title")
        const icon = e.details.type === "permission.asked" ? ("checklist" as const) : ("bubble-5" as const)
        const directory = e.name
        const props = e.details.properties
        if (e.details.type === "permission.asked" && permission.autoResponds(e.details.properties, directory)) return

        const [store] = globalSync.child(directory, { bootstrap: false })
        const session = store.session.find((s) => s.id === props.sessionID)
        const sessionKey = `${directory}:${props.sessionID}`

        const sessionTitle = session?.title ?? language.t("command.session.new")
        const projectName = getFilename(directory)
        const questionDetails =
          e.details.type === "question.asked"
            ? e.details.properties.questions
                .map((question) =>
                  question.header === question.question
                    ? question.question
                    : `${question.header}：${question.question}`,
                )
                .join("\n")
            : undefined
        const description =
          e.details.type === "permission.asked"
            ? language.t("notification.permission.description", { sessionTitle, projectName })
            : questionDetails
              ? language.t("notification.question.details", {
                  context: language.t("notification.question.description", { sessionTitle, projectName }),
                  question: questionDetails,
                })
              : language.t("notification.question.description", { sessionTitle, projectName })
        const href = `/${base64Encode(directory)}/session/${props.sessionID}`

        const now = Date.now()
        const lastAlerted = alertedAtBySession.get(sessionKey) ?? 0
        if (now - lastAlerted < cooldownMs) {
          if (e.details.type === "question.asked") {
            showToast({ title: "飞书问题通知被冷却跳过", description: "5 秒内已经处理过同一会话的问题通知。" })
          }
          return
        }
        alertedAtBySession.set(sessionKey, now)

        if (e.details.type === "permission.asked") {
          if (settings.sounds.permissionsEnabled()) {
            void playSoundById(settings.sounds.permissions())
          }
          if (settings.notifications.permissions()) {
            void platform.notify(title, description, href)
          }
        }

        if (e.details.type === "question.asked") {
          if (settings.notifications.agent()) {
            void platform.notify(title, description, href, {
              sessionID: e.details.properties.sessionID,
              requestID: e.details.properties.id,
            })
          }
        }

        sendFeishuNotification(
          title,
          description,
          href,
          e.details.type === "permission.asked"
            ? settings.notifications.feishu.permissions()
            : settings.notifications.feishu.questions(),
          directory,
          props.sessionID,
          e.details.type === "question.asked"
            ? {
                requestID: e.details.properties.id,
                questions: e.details.properties.questions,
              }
            : undefined,
        )

        const currentSession = params.id
        if (pathKey(directory) === pathKey(currentDir()) && props.sessionID === currentSession) return
        if (pathKey(directory) === pathKey(currentDir()) && session?.parentID === currentSession) return

        dismissSessionAlert(sessionKey)

        const toastId = showToast({
          persistent: true,
          icon,
          title,
          description,
          actions: [
            {
              label: language.t("notification.action.goToSession"),
              onClick: () => navigate(href),
            },
            {
              label: language.t("common.dismiss"),
              onClick: "dismiss",
            },
          ],
        })
        if (toastId !== undefined) toastBySession.set(sessionKey, toastId)
      })
      onCleanup(unsub)

      createEffect(() => {
        const currentSession = params.id
        if (!currentDir() || !currentSession) return
        const sessionKey = `${currentDir()}:${currentSession}`
        dismissSessionAlert(sessionKey)
        const [store] = globalSync.child(currentDir(), { bootstrap: false })
        const childSessions = store.session.filter((s) => s.parentID === currentSession)
        for (const child of childSessions) {
          dismissSessionAlert(`${currentDir()}:${child.id}`)
        }
      })
    })

  useUpdatePolling()
  useSDKNotificationToasts()

  function scrollToSession(sessionId: string, sessionKey: string) {
    if (!scrollContainerRef) return
    if (state.scrollSessionKey === sessionKey) return
    const element = scrollContainerRef.querySelector(`[data-session-id="${sessionId}"]`)
    if (!element) return
    const containerRect = scrollContainerRef.getBoundingClientRect()
    const elementRect = element.getBoundingClientRect()
    if (elementRect.top >= containerRect.top && elementRect.bottom <= containerRect.bottom) {
      setState("scrollSessionKey", sessionKey)
      return
    }
    setState("scrollSessionKey", sessionKey)
    element.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }

  const currentProject = createMemo(() => {
    const directory = currentDir()
    if (!directory) return
    const key = pathKey(directory)

    const projects = layout.projects.list()

    const sandbox = projects.find((p) => p.sandboxes?.some((item) => pathKey(item) === key))
    if (sandbox) return sandbox

    const direct = projects.find((p) => pathKey(p.worktree) === key)
    if (direct) return direct

    const [child] = globalSync.child(directory, { bootstrap: false })
    const id = child.project
    if (!id) return

    const meta = globalSync.data.project.find((p) => p.id === id)
    const root = meta?.worktree
    if (!root) return

    return projects.find((p) => p.worktree === root)
  })

  const [autoselecting] = createResource(async () => {
    await ready.promise
    await layout.ready.promise
    if (isGlobalChatRoute()) return
    if (!untrack(() => state.autoselect)) return

    const list = layout.projects.list()
    const last = server.projects.last()

    if (list.length === 0) {
      if (!last) return
      await openProject(last, true)
    } else {
      const next = list.find((project) => project.worktree === last) ?? list[0]
      if (!next) return
      await openProject(next.worktree, true)
    }
  })

  const workspaceName = (directory: string, projectId?: string, branch?: string) => {
    const key = pathKey(directory)
    const direct = store.workspaceName[key] ?? store.workspaceName[directory]
    if (direct) return direct
    if (!projectId) return
    if (!branch) return
    return store.workspaceBranchName[projectId]?.[branch]
  }

  const setWorkspaceName = (directory: string, next: string, projectId?: string, branch?: string) => {
    const key = pathKey(directory)
    setStore("workspaceName", key, next)
    if (!projectId) return
    if (!branch) return
    if (!store.workspaceBranchName[projectId]) {
      setStore("workspaceBranchName", projectId, {})
    }
    setStore("workspaceBranchName", projectId, branch, next)
  }

  const workspaceLabel = (directory: string, branch?: string, projectId?: string) =>
    workspaceName(directory, projectId, branch) ?? branch ?? getFilename(directory)

  const workspaceSetting = createMemo(() => {
    const project = currentProject()
    if (!project) return false
    if (project.vcs !== "git") return false
    return layout.sidebar.workspaces(project.worktree)()
  })

  const visibleSessionDirs = createMemo(() => {
    const project = currentProject()
    if (!project) return [] as string[]
    if (!workspaceSetting()) return [project.worktree]

    const activeDir = currentDir()
    return workspaceIds(project).filter((directory) => {
      const expanded = store.workspaceExpanded[directory] ?? directory === project.worktree
      const active = pathKey(directory) === pathKey(activeDir)
      return expanded || active
    })
  })

  createEffect(() => {
    if (!pageReady()) return
    if (!layoutReady()) return
    const projects = layout.projects.list()
    for (const [directory, expanded] of Object.entries(store.workspaceExpanded)) {
      if (!expanded) continue
      const key = pathKey(directory)
      const project = projects.find(
        (item) => pathKey(item.worktree) === key || item.sandboxes?.some((sandbox) => pathKey(sandbox) === key),
      )
      if (!project) continue
      if (project.vcs === "git" && layout.sidebar.workspaces(project.worktree)()) continue
      setStore("workspaceExpanded", directory, false)
    }
  })

  const currentSessions = createMemo(() => {
    const now = Date.now()
    const dirs = visibleSessionDirs()
    if (dirs.length === 0) return [] as Session[]

    const result: Session[] = []
    for (const dir of dirs) {
      const [dirStore] = globalSync.child(dir, { bootstrap: true })
      const dirSessions = sortedRootSessions(dirStore, now)
      result.push(...dirSessions)
    }
    return result
  })

  type PrefetchQueue = {
    inflight: Set<string>
    pending: string[]
    pendingSet: Set<string>
    running: number
  }

  const prefetchChunk = 200
  const prefetchConcurrency = 2
  const prefetchPendingLimit = 10
  const span = 4
  const prefetchToken = { value: 0 }
  const prefetchQueues = new Map<string, PrefetchQueue>()

  const PREFETCH_MAX_SESSIONS_PER_DIR = 10
  const prefetchedByDir = new Map<string, Set<string>>()

  const lruFor = (directory: string) => {
    const existing = prefetchedByDir.get(directory)
    if (existing) return existing
    const created = new Set<string>()
    prefetchedByDir.set(directory, created)
    return created
  }

  const markPrefetched = (directory: string, sessionID: string) => {
    const lru = lruFor(directory)
    return pickSessionCacheEvictions({
      seen: lru,
      keep: sessionID,
      limit: PREFETCH_MAX_SESSIONS_PER_DIR,
      preserve: params.id && pathKey(directory) === pathKey(currentDir()) ? [params.id] : undefined,
    })
  }

  createEffect(() => {
    const active = new Set(visibleSessionDirs())
    for (const directory of prefetchedByDir.keys()) {
      if (active.has(directory)) continue
      prefetchedByDir.delete(directory)
    }
  })

  createEffect(() => {
    route()
    globalSDK.url

    prefetchToken.value += 1
    clearSessionPrefetchInflight()
    prefetchQueues.clear()
  })

  createEffect(() => {
    const visible = new Set(visibleSessionDirs())
    for (const [directory, q] of prefetchQueues) {
      if (visible.has(directory)) continue
      q.pending.length = 0
      q.pendingSet.clear()
      if (q.running === 0) prefetchQueues.delete(directory)
    }
  })

  const queueFor = (directory: string) => {
    const existing = prefetchQueues.get(directory)
    if (existing) return existing

    const created: PrefetchQueue = {
      inflight: new Set(),
      pending: [],
      pendingSet: new Set(),
      running: 0,
    }
    prefetchQueues.set(directory, created)
    return created
  }

  const mergeByID = <T extends { id: string }>(current: T[], incoming: T[]) => {
    if (current.length === 0) {
      return incoming.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    }

    const map = new Map<string, T>()
    for (const item of current) {
      map.set(item.id, item)
    }
    for (const item of incoming) {
      map.set(item.id, item)
    }
    return [...map.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }

  async function prefetchMessages(directory: string, sessionID: string, token: number) {
    const [store, setStore] = globalSync.child(directory, { bootstrap: false })

    return runSessionPrefetch({
      directory,
      sessionID,
      task: (rev) =>
        retry(() => globalSDK.client.session.messages({ directory, sessionID, limit: prefetchChunk }))
          .then((messages) => {
            if (prefetchToken.value !== token) return
            if (!isSessionPrefetchCurrent(directory, sessionID, rev)) return

            const items = (messages.data ?? []).filter((x) => !!x?.info?.id)
            const next = items.map((x) => x.info).filter((m): m is Message => !!m?.id)
            const sorted = mergeByID([], next)
            const stale = markPrefetched(directory, sessionID)
            const cursor = messages.response.headers.get("x-next-cursor") ?? undefined
            const meta = {
              limit: sorted.length,
              cursor,
              complete: !cursor,
              at: Date.now(),
            }

            if (stale.length > 0) {
              clearSessionPrefetch(directory, stale)
              for (const id of stale) {
                globalSync.todo.set(id, undefined)
              }
            }

            const current = store.message[sessionID] ?? []
            const merged = mergeByID(
              current.filter((item): item is Message => !!item?.id),
              sorted,
            )

            if (!isSessionPrefetchCurrent(directory, sessionID, rev)) return

            batch(() => {
              if (stale.length > 0) {
                setStore(
                  produce((draft) => {
                    dropSessionCaches(draft, stale)
                  }),
                )
              }

              setStore("message", sessionID, reconcile(merged, { key: "id" }))
              setSessionPrefetch({ directory, sessionID, ...meta })

              for (const message of items) {
                const currentParts = store.part[message.info.id] ?? []
                const mergedParts = mergeByID(
                  currentParts.filter((item): item is (typeof currentParts)[number] & { id: string } => !!item?.id),
                  message.parts.filter((item): item is (typeof message.parts)[number] & { id: string } => !!item?.id),
                )

                setStore("part", message.info.id, reconcile(mergedParts, { key: "id" }))
              }
            })

            return meta
          })
          .catch(() => undefined),
    })
  }

  const pumpPrefetch = (directory: string) => {
    const q = queueFor(directory)
    if (q.running >= prefetchConcurrency) return

    const sessionID = q.pending.shift()
    if (!sessionID) return

    q.pendingSet.delete(sessionID)
    q.inflight.add(sessionID)
    q.running += 1

    const token = prefetchToken.value

    void prefetchMessages(directory, sessionID, token).finally(() => {
      q.running -= 1
      q.inflight.delete(sessionID)
      pumpPrefetch(directory)
    })
  }

  const prefetchSession = (session: Session, priority: "high" | "low" = "low") => {
    const directory = session.directory
    if (!directory) return

    const [store] = globalSync.child(directory, { bootstrap: false })
    const cached = untrack(() => {
      const info = getSessionPrefetch(directory, session.id)
      return shouldSkipSessionPrefetch({
        message: store.message[session.id] !== undefined,
        info,
        chunk: prefetchChunk,
      })
    })
    if (cached) return

    const q = queueFor(directory)
    if (q.inflight.has(session.id)) return
    if (q.pendingSet.has(session.id)) {
      if (priority !== "high") return
      const index = q.pending.indexOf(session.id)
      if (index > 0) {
        q.pending.splice(index, 1)
        q.pending.unshift(session.id)
      }
      return
    }

    const lru = lruFor(directory)
    const known = lru.has(session.id)
    if (!known && lru.size >= PREFETCH_MAX_SESSIONS_PER_DIR && priority !== "high") return

    if (priority === "high") q.pending.unshift(session.id)
    if (priority !== "high") q.pending.push(session.id)
    q.pendingSet.add(session.id)

    while (q.pending.length > prefetchPendingLimit) {
      const dropped = q.pending.pop()
      if (!dropped) continue
      q.pendingSet.delete(dropped)
    }

    pumpPrefetch(directory)
  }

  const warm = (sessions: Session[], index: number) => {
    for (let offset = 1; offset <= span; offset++) {
      const next = sessions[index + offset]
      if (next) prefetchSession(next, offset === 1 ? "high" : "low")

      const prev = sessions[index - offset]
      if (prev) prefetchSession(prev, offset === 1 ? "high" : "low")
    }
  }

  createEffect(() => {
    const sessions = currentSessions()
    if (sessions.length === 0) return

    const index = params.id ? sessions.findIndex((s) => s.id === params.id) : 0
    if (index === -1) return

    if (!params.id) {
      const first = sessions[index]
      if (first) prefetchSession(first, "high")
    }

    warm(sessions, index)
  })

  function navigateSessionByOffset(offset: number) {
    const sessions = currentSessions()
    if (sessions.length === 0) return

    const sessionIndex = params.id ? sessions.findIndex((s) => s.id === params.id) : -1

    let targetIndex: number
    if (sessionIndex === -1) {
      targetIndex = offset > 0 ? 0 : sessions.length - 1
    } else {
      targetIndex = (sessionIndex + offset + sessions.length) % sessions.length
    }

    const session = sessions[targetIndex]
    if (!session) return

    prefetchSession(session, "high")
    warm(sessions, targetIndex)

    navigateToSession(session)
  }

  function navigateProjectByOffset(offset: number) {
    const projects = layout.projects.list()
    if (projects.length === 0) return

    const current = currentProject()?.worktree
    const fallback = currentDir() ? projectRoot(currentDir()) : undefined
    const active = current ?? fallback
    const index = active ? projects.findIndex((project) => project.worktree === active) : -1

    const target =
      index === -1
        ? offset > 0
          ? projects[0]
          : projects[projects.length - 1]
        : projects[(index + offset + projects.length) % projects.length]
    if (!target) return

    // warm up child store to prevent flicker
    globalSync.child(target.worktree)
    void openProject(target.worktree)
  }

  function navigateToProjectIndex(index: number) {
    const projects = layout.projects.list()
    const target = projects[index]
    if (!target) return

    globalSync.child(target.worktree)
    void openProject(target.worktree)
  }

  function navigateSessionByUnseen(offset: number) {
    const sessions = currentSessions()
    if (sessions.length === 0) return

    const hasUnseen = sessions.some((session) => notification.session.unseenCount(session.id) > 0)
    if (!hasUnseen) return

    const activeIndex = params.id ? sessions.findIndex((s) => s.id === params.id) : -1
    const start = activeIndex === -1 ? (offset > 0 ? -1 : 0) : activeIndex

    for (let i = 1; i <= sessions.length; i++) {
      const index = offset > 0 ? (start + i) % sessions.length : (start - i + sessions.length) % sessions.length
      const session = sessions[index]
      if (!session) continue
      if (notification.session.unseenCount(session.id) === 0) continue

      prefetchSession(session, "high")
      warm(sessions, index)

      navigateToSession(session)
      return
    }
  }

  async function archiveSession(session: Session) {
    const [store, setStore] = globalSync.child(session.directory)
    const sessions = store.session ?? []
    const index = sessions.findIndex((s) => s.id === session.id)
    const nextSession = sessions[index + 1] ?? sessions[index - 1]

    await globalSDK.client.session.update({
      directory: session.directory,
      sessionID: session.id,
      time: { archived: Date.now() },
    })
    setStore(
      produce((draft) => {
        const match = Binary.search(draft.session, session.id, (s) => s.id)
        if (match.found) draft.session.splice(match.index, 1)
      }),
    )
    if (session.id === params.id) {
      if (nextSession) {
        navigate(`/${params.dir}/session/${nextSession.id}`)
      } else {
        navigate(`/${params.dir}/session`)
      }
    }
  }

  command.register("layout", () => {
    const commands: CommandOption[] = [
      // 前进/后退原先注册在全局标题栏里，标题栏移除后挪到外壳这一层（它常驻，任何路由都能用）。
      // 侧栏与会话帧 Header 都不再画这两个按钮，入口只剩命令面板与 mod+[ / mod+]。
      {
        id: "common.goBack",
        title: language.t("common.goBack"),
        category: language.t("command.category.view"),
        keybind: "mod+[",
        onSelect: () => goBack(),
      },
      {
        id: "common.goForward",
        title: language.t("common.goForward"),
        category: language.t("command.category.view"),
        keybind: "mod+]",
        onSelect: () => goForward(),
      },
      {
        id: "project.open",
        title: language.t("command.project.open"),
        category: language.t("command.category.project"),
        keybind: "mod+o",
        onSelect: () => chooseProject(),
      },
      {
        id: "project.create",
        title: language.t("command.project.create"),
        category: language.t("command.category.project"),
        onSelect: () => showCreateProjectDialog(),
      },
      {
        id: "project.switch",
        title: language.t("command.project.switch"),
        category: language.t("command.category.project"),
        keybind: "mod+shift+alt+o",
        onSelect: () => layout.projectPicker.toggle(),
      },
      {
        id: "project.previous",
        title: language.t("command.project.previous"),
        category: language.t("command.category.project"),
        keybind: "mod+alt+arrowup",
        onSelect: () => navigateProjectByOffset(-1),
      },
      {
        id: "project.next",
        title: language.t("command.project.next"),
        category: language.t("command.category.project"),
        keybind: "mod+alt+arrowdown",
        onSelect: () => navigateProjectByOffset(1),
      },
      ...Array.from({ length: 9 }, (_, i) => {
        const index = i
        const number = index + 1
        return {
          id: `project.${number}`,
          category: language.t("command.category.project"),
          title: `Open Project {number}`,
          keybind: `mod+${number}`,
          disabled: layout.projects.list().length <= index,
          hidden: true,
          onSelect: () => navigateToProjectIndex(index),
        }
      }),
      {
        id: "provider.connect",
        title: language.t("command.provider.connect"),
        category: language.t("command.category.provider"),
        onSelect: () => connectProvider(),
      },
      {
        id: "server.switch",
        title: language.t("command.server.switch"),
        category: language.t("command.category.server"),
        onSelect: () => openServer(),
      },
      {
        id: "settings.open",
        title: language.t("command.settings.open"),
        category: language.t("command.category.settings"),
        keybind: "mod+comma",
        // args 是标签页名(输入框「+」里的"技能/插件"直接落到对应页)。
        onSelect: (_source, args) => openSettings(args && isSettingsTab(args) ? args : undefined),
      },
      {
        id: "settings.memory.open",
        title: language.t("command.settings.open"),
        category: language.t("command.category.settings"),
        hidden: true,
        onSelect: () => openSettings("memory"),
      },
      {
        id: "settings.evolution.open",
        title: language.t("command.settings.open"),
        category: language.t("command.category.settings"),
        hidden: true,
        onSelect: () => openSettings("memory"),
      },
      {
        id: "database.open",
        title: language.t("command.database.open"),
        category: language.t("command.category.database"),
        keybind: "mod+shift+d",
        onSelect: () => openDatabasePage(),
      },
      {
        id: "database.close",
        title: language.t("command.database.close"),
        category: language.t("command.category.database"),
        hidden: true,
        onSelect: () => closeDatabasePage(),
      },
      {
        id: "session.previous",
        title: language.t("command.session.previous"),
        category: language.t("command.category.session"),
        keybind: "alt+arrowup",
        onSelect: () => navigateSessionByOffset(-1),
      },
      {
        id: "session.next",
        title: language.t("command.session.next"),
        category: language.t("command.category.session"),
        keybind: "alt+arrowdown",
        onSelect: () => navigateSessionByOffset(1),
      },
      {
        id: "session.previous.unseen",
        title: language.t("command.session.previous.unseen"),
        category: language.t("command.category.session"),
        keybind: "shift+alt+arrowup",
        onSelect: () => navigateSessionByUnseen(-1),
      },
      {
        id: "session.next.unseen",
        title: language.t("command.session.next.unseen"),
        category: language.t("command.category.session"),
        keybind: "shift+alt+arrowdown",
        onSelect: () => navigateSessionByUnseen(1),
      },
      {
        id: "session.archive",
        title: language.t("command.session.archive"),
        category: language.t("command.category.session"),
        keybind: "mod+shift+backspace",
        disabled: !params.dir || !params.id,
        onSelect: () => {
          const session = currentSessions().find((s) => s.id === params.id)
          if (session) void archiveSession(session)
        },
      },
      {
        id: "workspace.new",
        title: language.t("workspace.new"),
        category: language.t("command.category.workspace"),
        keybind: "mod+shift+w",
        disabled: !workspaceSetting(),
        onSelect: () => {
          const project = currentProject()
          if (!project) return
          return createWorkspace(project)
        },
      },
      {
        id: "workspace.toggle",
        title: language.t("command.workspace.toggle"),
        description: language.t("command.workspace.toggle.description"),
        category: language.t("command.category.workspace"),
        slash: "workspace",
        disabled: !currentProject() || currentProject()?.vcs !== "git",
        onSelect: () => {
          const project = currentProject()
          if (!project) return
          if (project.vcs !== "git") return
          const wasEnabled = layout.sidebar.workspaces(project.worktree)()
          layout.sidebar.toggleWorkspaces(project.worktree)
          showToast({
            title: wasEnabled
              ? language.t("toast.workspace.disabled.title")
              : language.t("toast.workspace.enabled.title"),
            description: wasEnabled
              ? language.t("toast.workspace.disabled.description")
              : language.t("toast.workspace.enabled.description"),
          })
        },
      },
      {
        id: "fileTree.toggle",
        title: language.t("command.fileTree.toggle"),
        category: language.t("command.category.view"),
        keybind: "mod+alt+e",
        disabled: !currentDir(),
        onSelect: () => {
          // 树是「工作区文件」面板里的右栏：再按一次收起；展开时把预览标签拉到前面。
          if (layout.sidePane.tree() && layout.sidePane.opened()) {
            layout.sidePane.setTree(false)
            return
          }
          layout.sidePane.setTree(true)
          layout.sidePane.add("preview")
        },
      },
      {
        id: "theme.cycle",
        title: language.t("command.theme.cycle"),
        category: language.t("command.category.theme"),
        keybind: "mod+shift+t",
        onSelect: () => cycleTheme(1),
      },
    ]

    for (const [id] of availableThemeEntries()) {
      commands.push({
        id: `theme.set.${id}`,
        title: language.t("command.theme.set", { theme: theme.name(id) }),
        category: language.t("command.category.theme"),
        onSelect: () => theme.setTheme(id),
      })
    }

    commands.push({
      id: "theme.scheme.cycle",
      title: language.t("command.theme.scheme.cycle"),
      category: language.t("command.category.theme"),
      keybind: "mod+shift+s",
      onSelect: () => cycleColorScheme(1),
    })

    for (const scheme of colorSchemeOrder) {
      commands.push({
        id: `theme.scheme.${scheme}`,
        title: language.t("command.theme.scheme.set", { scheme: colorSchemeLabel(scheme) }),
        category: language.t("command.category.theme"),
        onSelect: () => theme.setColorScheme(scheme),
      })
    }

    commands.push({
      id: "language.cycle",
      title: language.t("command.language.cycle"),
      category: language.t("command.category.language"),
      onSelect: () => cycleLanguage(1),
    })

    for (const locale of language.locales) {
      commands.push({
        id: `language.set.${locale}`,
        title: language.t("command.language.set", { language: language.label(locale) }),
        category: language.t("command.category.language"),
        onSelect: () => setLocale(locale),
      })
    }

    if (location.pathname.startsWith("/global-chat/")) {
      return commands.filter(
        (item) => !item.id.startsWith("project.") && !item.id.startsWith("workspace.") && item.id !== "fileTree.toggle",
      )
    }
    return commands
  })

  function connectProvider() {
    const run = ++dialogRun
    void import("@/components/dialog-select-provider").then((x) => {
      if (dialogDead || dialogRun !== run) return
      void dialog.show(() => <x.DialogSelectProvider />)
    })
  }

  function openServer() {
    const run = ++dialogRun
    void import("@/components/dialog-select-server").then((x) => {
      if (dialogDead || dialogRun !== run) return
      void dialog.show(() => <x.DialogSelectServer />)
    })
  }

  function openSettings(initialTab?: SettingsTab) {
    const directory = currentProject()?.worktree ?? currentDir()
    closeFramePages("settings")
    batch(() => {
      setState("settings", "directory", directory)
      setState("settings", "initialTab", initialTab)
      setState("settings", "open", true)
    })
  }

  /**
   * 侧栏「辅助对话」入口：
   * 当前任务已有辅助对话就聚焦最近一条，否则新建一条；
   * 两种情况都会把右侧面板展开。
   */
  async function openSideChatFromSidebar() {
    closeFramePages()
    const parentID = params.id ?? ""
    const existing = Object.values(layout.sidePane.dynamicTabs()).filter(
      (tab) => tab.kind === "sideChat" && tab.parentID === parentID,
    )
    const latest = existing.at(-1)
    if (latest) {
      layout.sidePane.openSession(latest)
      layout.sidePane.open()
      return
    }
    // 侧栏在 SDK Provider 之外，这里用全局客户端按当前目录建会话；
    // 发送时用的 agent/model 仍由面板里的输入框（主线上下文）决定。
    try {
      const directory = decode64(params.dir) ?? undefined
      const client = globalSDK.createClient({ directory, throwOnError: true })
      const created = await client.session.create(parentID ? { parentID } : undefined).then((result) => result.data)
      if (!created?.id) return
      const title = language.t("sidePane.sideChat.title", { index: existing.length + 1 })
      const tab = {
        id: sidePaneSideChatTabId(created.id),
        kind: "sideChat" as const,
        sessionID: created.id,
        parentID,
        title,
      }
      void client.session.update({ sessionID: created.id, title }).catch(() => undefined)
      layout.sidePane.openSession(tab)
      layout.sidePane.open()
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("sidePane.sideChat.failed"),
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  function closeSettings() {
    setState("settings", "open", false)
    // 覆盖层关闭后让聊天区重新校验一次可视区域：面板动画期间
    // 虚拟列表可能测到 0 高度，回来时会一片空白，直到用户滚一下才恢复。
    window.dispatchEvent(new CustomEvent("novaway:overlay-closed"))
  }

  function openExtensionsPage() {
    closeFramePages("extensionsPage")
    setState("extensionsPage", "open", true)
  }

  function openTeamPage() {
    closeFramePages("teamPage")
    setState("teamPage", "open", true)
  }

  function closeTeamPage() {
    setState("teamPage", "open", false)
    window.dispatchEvent(new CustomEvent("novaway:overlay-closed"))
  }

  function openArenaPage() {
    closeFramePages("arenaPage")
    setState("arenaPage", "open", true)
  }

  function closeArenaPage() {
    setState("arenaPage", "open", false)
    window.dispatchEvent(new CustomEvent("novaway:overlay-closed"))
  }

  function openAutomationPage() {
    closeFramePages("automationPage")
    setState("automationPage", "open", true)
  }

  function closeAutomationPage() {
    setState("automationPage", "open", false)
    window.dispatchEvent(new CustomEvent("novaway:overlay-closed"))
  }

  /** 运营工作台（原 `/pulse` 整窗页面）：现在只是主帧里的一个普通页面。 */
  function openPulsePage() {
    closeFramePages("pulsePage")
    setState("pulsePage", "open", true)
  }

  function closePulsePage() {
    setState("pulsePage", "open", false)
    window.dispatchEvent(new CustomEvent("novaway:overlay-closed"))
  }

  function openKnowledgePage() {
    closeFramePages("knowledgePage")
    setState("knowledgePage", "open", true)
  }

  function closeKnowledgePage() {
    setState("knowledgePage", "open", false)
    window.dispatchEvent(new CustomEvent("novaway:overlay-closed"))
  }

  function closeExtensionsPage() {
    setState("extensionsPage", "open", false)
    window.dispatchEvent(new CustomEvent("novaway:overlay-closed"))
  }

  /**
   * 从扩展页跳到某个设置标签。
   *
   * 扩展页是独立整帧覆盖层，直接 openSettings 会让两层同时存在；这里把扩展层
   * 标记为关闭（保留退场动画），设置层从下方淡入，视觉上是交叉淡出。
   */
  function openSettingsFromExtensions(initialTab?: SettingsTab) {
    // 内核页也会跳到这里；先统一关掉其它整帧页，避免两层叠在一起。
    closeFramePages("settings")
    batch(() => {
      setState("settings", "directory", currentProject()?.worktree ?? currentDir())
      setState("settings", "initialTab", initialTab)
      setState("settings", "open", true)
    })
  }

  function openDatabasePage() {
    closeFramePages("databasePage")
    setState("databasePage", "open", true)
  }

  function closeDatabasePage() {
    setState("databasePage", "open", false)
    window.dispatchEvent(new CustomEvent("novaway:overlay-closed"))
  }

  function projectRoot(directory: string) {
    const key = pathKey(directory)
    const project = layout.projects
      .list()
      .find((item) => pathKey(item.worktree) === key || item.sandboxes?.some((sandbox) => pathKey(sandbox) === key))
    if (project) return project.worktree

    const known = Object.entries(store.workspaceOrder).find(
      ([root, dirs]) => pathKey(root) === key || dirs.some((item) => pathKey(item) === key),
    )
    if (known) return known[0]

    const [child] = globalSync.child(directory, { bootstrap: false })
    const id = child.project
    if (!id) return directory

    const meta = globalSync.data.project.find((item) => item.id === id)
    return meta?.worktree ?? directory
  }

  function activeProjectRoot(directory: string) {
    return currentProject()?.worktree ?? projectRoot(directory)
  }

  function rememberSessionRoute(directory: string, id: string, root = activeProjectRoot(directory)) {
    setStore("lastProjectSession", root, { directory, id, at: Date.now() })
    return root
  }

  function clearLastProjectSession(root: string) {
    if (!store.lastProjectSession[root]) return
    setStore(
      "lastProjectSession",
      produce((draft) => {
        delete draft[root]
      }),
    )
  }

  function syncSessionRoute(directory: string, id: string, root = activeProjectRoot(directory)) {
    rememberSessionRoute(directory, id, root)
    notification.session.markViewed(id)
    const expanded = untrack(() => store.workspaceExpanded[directory])
    if (expanded === false) {
      setStore("workspaceExpanded", directory, true)
    }
    requestAnimationFrame(() => scrollToSession(id, `${directory}:${id}`))
    return root
  }

  async function navigateToProject(directory: string | undefined) {
    if (!directory) return
    const root = projectRoot(directory)
    server.projects.touch(root)
    const project = layout.projects.list().find((item) => item.worktree === root)
    let dirs = project
      ? effectiveWorkspaceOrder(root, [root, ...(project.sandboxes ?? [])], store.workspaceOrder[root])
      : [root]
    const canOpen = (value: string | undefined) => {
      if (!value) return false
      return dirs.some((item) => pathKey(item) === pathKey(value))
    }
    const refreshDirs = async (target?: string) => {
      if (!target || target === root || canOpen(target)) return canOpen(target)
      const listed = await globalSDK.client.worktree
        .list({ directory: root })
        .then((x) => x.data ?? [])
        .catch(() => [] as string[])
      dirs = effectiveWorkspaceOrder(root, [root, ...listed], store.workspaceOrder[root])
      return canOpen(target)
    }
    const openSession = async (target: { directory: string; id: string }) => {
      if (!canOpen(target.directory)) return false
      const [data] = globalSync.child(target.directory, { bootstrap: false })
      if (data.session.some((item) => item.id === target.id)) {
        setStore("lastProjectSession", root, { directory: target.directory, id: target.id, at: Date.now() })
        navigateWithSidebarReset(`/${base64Encode(target.directory)}/session/${target.id}`)
        return true
      }
      const resolved = await globalSDK.client.session
        .get({ sessionID: target.id })
        .then((x) => x.data)
        .catch(() => undefined)
      if (!resolved?.directory) return false
      if (!canOpen(resolved.directory)) return false
      setStore("lastProjectSession", root, { directory: resolved.directory, id: resolved.id, at: Date.now() })
      navigateWithSidebarReset(`/${base64Encode(resolved.directory)}/session/${resolved.id}`)
      return true
    }

    const projectSession = store.lastProjectSession[root]
    if (projectSession?.id) {
      // 目标目录已经在工作区列表里就**不要**再跑 worktree.list：那是切项目时最大的一笔
      // 网络往返，直接决定点击后面板「卡」多久。只有目录未知（新 worktree）才刷新。
      if (canOpen(projectSession.directory) || (await refreshDirs(projectSession.directory))) {
        const opened = await openSession(projectSession)
        if (opened) return
      }
      clearLastProjectSession(root)
    }

    // 本地已有会话就直接跳（同步命中缓存，不再是「等一次 session.list 才动」）。
    const latest = latestRootSession(
      dirs.map((item) => globalSync.child(item, { bootstrap: false })[0]),
      Date.now(),
    )
    if (latest && (await openSession(latest))) {
      return
    }

    const fetched = latestRootSession(
      await Promise.all(
        dirs.map(async (item) => ({
          path: { directory: item },
          session: await globalSDK.client.session
            .list({ directory: item })
            .then((x) => x.data ?? [])
            .catch(() => []),
        })),
      ),
      Date.now(),
    )
    if (fetched && (await openSession(fetched))) {
      return
    }

    navigateWithSidebarReset(`/${base64Encode(root)}/session`)
  }

  function navigateToSession(session: Session | undefined) {
    if (!session) return
    navigateWithSidebarReset(`/${base64Encode(session.directory)}/session/${session.id}`)
  }

  function openWorkspace(directory: string) {
    const [child] = globalSync.child(directory, { bootstrap: false })
    const latest = latestRootSession([child], Date.now())
    if (latest) return navigateToSession(latest)
    navigateWithSidebarReset(`/${base64Encode(directory)}/session`)
  }

  function openProject(directory: string, navigate = true) {
    layout.projects.assign(directory)
    layout.projects.open(directory)
    server.projects.touch(directory)
    if (navigate) return navigateToProject(directory)
  }

  /**
   * 新建任务：有项目就直接进它的新建会话页，没有项目就弹「打开/新建项目」。
   * 面板展开时是顶部那颗整宽按钮，面板收起后在图标条里（同一个动作两个位置）。
   */
  function startNewTask() {
    // When the workspace-free inbox is active, the primary action starts another
    // workspace-free conversation instead of unexpectedly jumping into a project.
    if (isGlobalChatRoute()) {
      navigateWithSidebarReset("/global-chat/session")
      return
    }
    const first = layout.projects.list()[0]
    if (first) navigateWithSidebarReset(`/${base64Encode(first.worktree)}/session`)
    else void chooseProject()
  }

  const handleDeepLinks = (urls: string[]) => {
    if (!server.isLocal()) return

    for (const directory of collectOpenProjectDeepLinks(urls)) {
      void openProject(directory)
    }

    for (const link of collectNewSessionDeepLinks(urls)) {
      void openProject(link.directory, false)
      const slug = base64Encode(link.directory)
      if (link.prompt) {
        setSessionHandoff(slug, { prompt: link.prompt })
      }
      const href = link.prompt ? `/${slug}/session?prompt=${encodeURIComponent(link.prompt)}` : `/${slug}/session`
      navigateWithSidebarReset(href)
    }
  }

  /**
   * 从系统打开的文档：先把文件所在目录当成项目打开，再让任务页把文件标签开出来。
   * 文件本身先排进队列 —— 导航到项目需要一帧，右侧面板此时还没挂载。
   */
  const handleOpenFiles = (paths: string[]) => {
    if (paths.length === 0) return
    const directories = [...new Set(paths.map((path) => getDirectory(path)).filter((dir): dir is string => !!dir))]
    directories.forEach((directory, index) => openProject(directory, index === 0))
    queueOpenFiles(paths)
  }

  onMount(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ urls: string[] }>).detail
      const urls = detail?.urls ?? []
      if (urls.length === 0) return
      handleDeepLinks(urls)
    }

    handleDeepLinks(drainPendingDeepLinks(window))
    makeEventListener(window, deepLinkEvent, handler as EventListener)

    const files = (event: Event) => {
      const detail = (event as CustomEvent<{ paths: string[] }>).detail
      handleOpenFiles(detail?.paths ?? [])
    }

    handleOpenFiles(drainPendingOpenFiles(window))
    makeEventListener(window, openFilesEvent, files as EventListener)
  })

  const renameWorkspace = (directory: string, next: string, projectId?: string, branch?: string) => {
    const current = workspaceName(directory, projectId, branch) ?? branch ?? getFilename(directory)
    if (current === next) return
    setWorkspaceName(directory, next, projectId, branch)
  }

  function closeProject(directory: string) {
    const list = layout.projects.list()
    const key = pathKey(directory)
    const index = list.findIndex((x) => pathKey(x.worktree) === key)
    const active = pathKey(currentProject()?.worktree ?? "") === key
    if (index === -1) return

    if (!active) {
      layout.projects.close(directory)
      return
    }

    if (list.length === 1) {
      layout.projects.close(directory)
      navigate("/")
      return
    }

    const next = list[index + 1] ?? list[index - 1]

    navigateWithSidebarReset(`/${base64Encode(next.worktree)}/session`)
    layout.projects.close(directory)
    queueMicrotask(() => {
      void navigateToProject(next.worktree)
    })
  }

  function toggleProjectWorkspaces(project: LocalProject) {
    const enabled = layout.sidebar.workspaces(project.worktree)()
    if (enabled) {
      layout.sidebar.toggleWorkspaces(project.worktree)
      return
    }
    if (project.vcs !== "git") return
    layout.sidebar.toggleWorkspaces(project.worktree)
  }

  const moveProjectToMode = (directory: string, mode: Parameters<typeof layout.projects.assign>[1]) => {
    layout.projects.assign(directory, mode)
    if (mode === layout.mode.current()) return
    if (pathKey(currentProject()?.worktree ?? "") === pathKey(directory)) navigate("/")
  }

  const showEditProjectDialog = (project: LocalProject) => {
    const run = ++dialogRun
    void import("@/components/dialog-edit-project").then((x) => {
      if (dialogDead || dialogRun !== run) return
      void dialog.show(() => <x.DialogEditProject project={project} />)
    })
  }

  /**
   * 侧栏「工作区」旁的 + 号：一个弹窗里给两条路 ——
   * 选已有文件夹直接打开，或选保存位置后新建项目目录。
   * 原生目录选择器不可用时（Web 端），「打开文件夹」会落到内置目录浏览弹窗。
   */
  function showAddWorkspaceDialog() {
    void dialog.show(() => (
      <DialogAddWorkspace onOpenFolder={() => void chooseProject()} onCreateProject={() => showCreateProjectDialog()} />
    ))
  }

  /**
   * 新建项目：在选定的父目录里建一个文件夹，随后按普通项目打开。
   * 与「打开项目」成对出现（侧栏 + 号弹窗、任务中心），不再只有"打开已有目录"这一条路。
   */
  function showCreateProjectDialog() {
    void dialog.show(() => (
      <DialogCreateProject
        onCreate={(path) => {
          void openProject(path)
        }}
      />
    ))
  }

  async function chooseProject() {
    function resolve(result: string | string[] | null) {
      if (Array.isArray(result)) {
        for (const directory of result) {
          void openProject(directory, false)
        }
        void navigateToProject(result[0])
      } else if (result) {
        void openProject(result)
      }
    }

    if (platform.openDirectoryPickerDialog && server.isLocal()) {
      const result = await platform.openDirectoryPickerDialog?.({
        title: language.t("command.project.open"),
        multiple: true,
      })
      resolve(result)
    } else {
      const run = ++dialogRun
      void import("@/components/dialog-select-directory").then((x) => {
        if (dialogDead || dialogRun !== run) return
        void dialog.show(
          () => <x.DialogSelectDirectory multiple={true} onSelect={resolve} />,
          () => resolve(null),
        )
      })
    }
  }

  const deleteWorkspace = async (root: string, directory: string, leaveDeletedWorkspace = false) => {
    if (directory === root) return

    const current = currentDir()
    const currentKey = pathKey(current)
    const deletedKey = pathKey(directory)
    const shouldLeave = leaveDeletedWorkspace || (!!params.dir && currentKey === deletedKey)
    if (!leaveDeletedWorkspace && shouldLeave) {
      navigateWithSidebarReset(`/${base64Encode(root)}/session`)
    }

    setBusy(directory, true)

    const result = await globalSDK.client.worktree
      .remove({ directory: root, worktreeRemoveInput: { directory } })
      .then((x) => x.data)
      .catch((err) => {
        showToast({
          title: language.t("workspace.delete.failed.title"),
          description: errorMessage(err, language.t("common.requestFailed")),
        })
        return false
      })

    setBusy(directory, false)

    if (!result) return

    if (pathKey(store.lastProjectSession[root]?.directory ?? "") === pathKey(directory)) {
      clearLastProjectSession(root)
    }

    globalSync.set(
      "project",
      produce((draft) => {
        const project = draft.find((item) => item.worktree === root)
        if (!project) return
        project.sandboxes = (project.sandboxes ?? []).filter((sandbox) => sandbox !== directory)
      }),
    )
    setStore("workspaceOrder", root, (order) => (order ?? []).filter((workspace) => workspace !== directory))

    layout.projects.close(directory)
    layout.projects.open(root)

    if (shouldLeave) return

    const nextCurrent = currentDir()
    const nextKey = pathKey(nextCurrent)
    const project = layout.projects.list().find((item) => item.worktree === root)
    const dirs = project
      ? effectiveWorkspaceOrder(root, [root, ...(project.sandboxes ?? [])], store.workspaceOrder[root])
      : [root]
    const valid = dirs.some((item) => pathKey(item) === nextKey)

    if (params.dir && projectRoot(nextCurrent) === root && !valid) {
      navigateWithSidebarReset(`/${base64Encode(root)}/session`)
    }
  }

  const resetWorkspace = async (root: string, directory: string) => {
    if (directory === root) return
    setBusy(directory, true)

    const progress = showToast({
      persistent: true,
      title: language.t("workspace.resetting.title"),
      description: language.t("workspace.resetting.description"),
    })
    const dismiss = () => {
      if (progress !== undefined) toaster.dismiss(progress)
    }

    const sessions: Session[] = await globalSDK.client.session
      .list({ directory })
      .then((x) => x.data ?? [])
      .catch(() => [])

    clearWorkspaceTerminals(
      directory,
      sessions.map((s) => s.id),
      platform,
      getTerminalServerScope(server.current, server.key),
    )
    await globalSDK.client.instance.dispose({ directory }).catch(() => undefined)

    const result = await globalSDK.client.worktree
      .reset({ directory: root, worktreeResetInput: { directory } })
      .then((x) => x.data)
      .catch((err) => {
        showToast({
          title: language.t("workspace.reset.failed.title"),
          description: errorMessage(err, language.t("common.requestFailed")),
        })
        return false
      })

    if (!result) {
      setBusy(directory, false)
      dismiss()
      return
    }

    const archivedAt = Date.now()
    await Promise.all(
      sessions
        .filter((session) => session.time.archived === undefined)
        .map((session) =>
          globalSDK.client.session
            .update({
              sessionID: session.id,
              directory: session.directory,
              time: { archived: archivedAt },
            })
            .catch(() => undefined),
        ),
    )

    setBusy(directory, false)
    dismiss()

    showToast({
      title: language.t("workspace.reset.success.title"),
      description: language.t("workspace.reset.success.description"),
      actions: [
        {
          label: language.t("command.session.new"),
          onClick: () => {
            const href = `/${base64Encode(directory)}/session`
            navigate(href)
            layout.mobileSidebar.hide()
          },
        },
        {
          label: language.t("common.dismiss"),
          onClick: "dismiss",
        },
      ],
    })
  }

  function DialogDeleteWorkspace(props: { root: string; directory: string }) {
    const name = createMemo(() => getFilename(props.directory))
    const [data, setData] = createStore({
      status: "loading" as "loading" | "ready" | "error",
      dirty: false,
    })

    onMount(() => {
      globalSDK.client.file
        .status({ directory: props.directory })
        .then((x) => {
          const files = x.data ?? []
          const dirty = files.length > 0
          setData({ status: "ready", dirty })
        })
        .catch(() => {
          setData({ status: "error", dirty: false })
        })
    })

    const handleDelete = () => {
      const leaveDeletedWorkspace = !!params.dir && pathKey(currentDir()) === pathKey(props.directory)
      if (leaveDeletedWorkspace) {
        navigateWithSidebarReset(`/${base64Encode(props.root)}/session`)
      }
      dialog.close()
      void deleteWorkspace(props.root, props.directory, leaveDeletedWorkspace)
    }

    const description = () => {
      if (data.status === "loading") return language.t("workspace.status.checking")
      if (data.status === "error") return language.t("workspace.status.error")
      if (!data.dirty) return language.t("workspace.status.clean")
      return language.t("workspace.status.dirty")
    }

    return (
      <Dialog title={language.t("workspace.delete.title")} fit>
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
          <div class="flex flex-col gap-1">
            <span class="text-14-regular text-foreground">
              {language.t("workspace.delete.confirm", { name: name() })}
            </span>
            <span class="text-12-regular text-foreground-subtle">{description()}</span>
          </div>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button variant="primary" size="large" disabled={data.status === "loading"} onClick={handleDelete}>
              {language.t("workspace.delete.button")}
            </Button>
          </div>
        </div>
      </Dialog>
    )
  }

  function DialogResetWorkspace(props: { root: string; directory: string }) {
    const name = createMemo(() => getFilename(props.directory))
    const [state, setState] = createStore({
      status: "loading" as "loading" | "ready" | "error",
      dirty: false,
      sessions: [] as Session[],
    })

    const refresh = async () => {
      const sessions = await globalSDK.client.session
        .list({ directory: props.directory })
        .then((x) => x.data ?? [])
        .catch(() => [])
      const active = sessions.filter((session) => session.time.archived === undefined)
      setState({ sessions: active })
    }

    onMount(() => {
      globalSDK.client.file
        .status({ directory: props.directory })
        .then((x) => {
          const files = x.data ?? []
          const dirty = files.length > 0
          setState({ status: "ready", dirty })
          void refresh()
        })
        .catch(() => {
          setState({ status: "error", dirty: false })
        })
    })

    const handleReset = () => {
      dialog.close()
      void resetWorkspace(props.root, props.directory)
    }

    const archivedCount = () => state.sessions.length

    const description = () => {
      if (state.status === "loading") return language.t("workspace.status.checking")
      if (state.status === "error") return language.t("workspace.status.error")
      if (!state.dirty) return language.t("workspace.status.clean")
      return language.t("workspace.status.dirty")
    }

    const archivedLabel = () => {
      const count = archivedCount()
      if (count === 0) return language.t("workspace.reset.archived.none")
      if (count === 1) return language.t("workspace.reset.archived.one")
      return language.t("workspace.reset.archived.many", { count })
    }

    return (
      <Dialog title={language.t("workspace.reset.title")} fit>
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
          <div class="flex flex-col gap-1">
            <span class="text-14-regular text-foreground">
              {language.t("workspace.reset.confirm", { name: name() })}
            </span>
            <span class="text-12-regular text-foreground-subtle">
              {description()} {archivedLabel()} {language.t("workspace.reset.note")}
            </span>
          </div>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button variant="primary" size="large" disabled={state.status === "loading"} onClick={handleReset}>
              {language.t("workspace.reset.button")}
            </Button>
          </div>
        </div>
      </Dialog>
    )
  }

  function DialogRenameWorkspace(props: { directory: string; projectId?: string }) {
    const [child] = globalSync.child(props.directory, { bootstrap: false })
    const branch = () => child.vcs?.branch
    const [value, setValue] = createSignal(workspaceLabel(props.directory, branch(), props.projectId))

    const submit = (event: SubmitEvent) => {
      event.preventDefault()
      const next = value().trim()
      if (!next) return
      renameWorkspace(props.directory, next, props.projectId, branch())
      dialog.close()
    }

    return (
      <Dialog title={language.t("common.rename")} fit>
        <form onSubmit={submit} class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
          <TextField autofocus label={language.t("common.rename")} value={value()} onChange={setValue} />
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary" size="large">
              {language.t("common.save")}
            </Button>
          </div>
        </form>
      </Dialog>
    )
  }

  const activeRoute = {
    session: "",
    sessionProject: "",
    directory: "",
  }

  createEffect(
    on(
      () => {
        return [pageReady(), route().slug, params.id, currentProject()?.worktree, currentDir()] as const
      },
      ([ready, slug, id, root, dir]) => {
        if (!ready || !slug || !dir) {
          activeRoute.session = ""
          activeRoute.sessionProject = ""
          activeRoute.directory = ""
          return
        }

        if (!id) {
          activeRoute.session = ""
          activeRoute.sessionProject = ""
          activeRoute.directory = ""
          return
        }

        const session = `${slug}/${id}`

        if (!root) {
          activeRoute.session = session
          activeRoute.directory = dir
          activeRoute.sessionProject = ""
          return
        }

        if (server.projects.last() !== root) server.projects.touch(root)

        const changed = session !== activeRoute.session || dir !== activeRoute.directory
        if (changed) {
          activeRoute.session = session
          activeRoute.directory = dir
          activeRoute.sessionProject = syncSessionRoute(dir, id, root)
          return
        }

        if (root === activeRoute.sessionProject) return
        activeRoute.directory = dir
        activeRoute.sessionProject = rememberSessionRoute(dir, id, root)
      },
    ),
  )

  // 最左侧窄图标条（数据库/知识库/自动化/扩展/设置 + logo）的宽度。
  // 它**不参与折叠**：折叠只收起右边的会话面板，rail 常驻（对齐 Codex）。
  const RAIL_WIDTH = 48
  const isMacDesktop = createMemo(() => platform.platform === "desktop" && platform.os === "macos")
  // 当前模式色：图标条和会话面板都要用（rail 在面板外侧，得自己继承一份）。
  const modeAccent = createMemo(
    () => layout.mode.all().find((mode) => mode.id === layout.mode.current())?.color ?? "var(--border-hover)",
  )
  // 会话面板内容宽度（下限 264px）。
  const panel = createMemo(() => Math.max(264, layout.sidebar.width()))
  // 侧栏总占位 = 图标条 + 展开时的面板宽度；收起后只剩图标条。
  const side = createMemo(() => RAIL_WIDTH + (layout.sidebar.expanded() ? panel() : 0))

  createEffect(() => {
    const dialogLeft = side() + 4
    document.documentElement.style.setProperty("--dialog-left-margin", `${dialogLeft}px`)
  })

  const loadedSessionDirs = new Set<string>()

  createEffect(
    on(
      visibleSessionDirs,
      (dirs) => {
        if (dirs.length === 0) {
          loadedSessionDirs.clear()
          return
        }

        const next = new Set(dirs)
        for (const directory of next) {
          if (loadedSessionDirs.has(directory)) continue
          void globalSync.project.loadSessions(directory)
        }

        loadedSessionDirs.clear()
        for (const directory of next) {
          loadedSessionDirs.add(directory)
        }
      },
      { defer: true },
    ),
  )

  function workspaceIds(project: LocalProject | undefined) {
    if (!project) return []
    const local = project.worktree
    const dirs = [local, ...(project.sandboxes ?? [])]
    const active = currentProject()
    const directory = pathKey(active?.worktree ?? "") === pathKey(project.worktree) ? currentDir() : undefined
    const extra =
      directory && pathKey(directory) !== pathKey(local) && !dirs.some((item) => pathKey(item) === pathKey(directory))
        ? directory
        : undefined
    const pending = extra ? WorktreeState.get(extra)?.status === "pending" : false

    const ordered = effectiveWorkspaceOrder(local, dirs, store.workspaceOrder[project.worktree])
    if (pending && extra) return [local, extra, ...ordered.filter((item) => item !== local)]
    if (!extra) return ordered
    if (pending) return ordered
    return [...ordered, extra]
  }

  const createWorkspace = async (project: LocalProject) => {
    clearSidebarHoverState()
    const created = await globalSDK.client.worktree
      .create({ directory: project.worktree })
      .then((x) => x.data)
      .catch((err) => {
        showToast({
          title: language.t("workspace.create.failed.title"),
          description: errorMessage(err, language.t("common.requestFailed")),
        })
        return undefined
      })

    if (!created?.directory) return

    setWorkspaceName(created.directory, created.branch ?? getFilename(created.directory), project.id, created.branch)

    const local = project.worktree
    const key = pathKey(created.directory)
    const root = pathKey(local)

    setBusy(created.directory, true)
    WorktreeState.pending(created.directory)
    setStore("workspaceExpanded", key, true)
    if (key !== created.directory) {
      setStore("workspaceExpanded", created.directory, true)
    }
    setStore("workspaceOrder", project.worktree, (prev) => {
      const existing = prev ?? []
      const next = existing.filter((item) => {
        const id = pathKey(item)
        return id !== root && id !== key
      })
      return [created.directory, ...next]
    })

    globalSync.child(created.directory)
    navigateWithSidebarReset(`/${base64Encode(created.directory)}/session`)
  }

  const projectSidebarCtx: ProjectSidebarContext = {
    currentDir,
    currentProject,
    sidebarOpened: () => layout.sidebar.opened(),
    navigateToProject,
    navigateToNewSession: (directory) => navigateWithSidebarReset(`/${base64Encode(directory)}/session`),
    closeProject,
    moveProjectToMode,
    showEditProjectDialog,
    toggleProjectWorkspaces,
    workspacesEnabled: (project) => project.vcs === "git" && layout.sidebar.workspaces(project.worktree)(),
    workspaceIds,
    workspaceLabel,
    workspaceExpanded: (directory, local) => store.workspaceExpanded[directory] ?? local,
    setWorkspaceExpanded: (directory, value) => setStore("workspaceExpanded", directory, value),
    isBusy,
    createWorkspace,
    openWorkspace,
    showRenameWorkspaceDialog: (directory, projectId) =>
      dialog.show(() => <DialogRenameWorkspace directory={directory} projectId={projectId} />),
    showResetWorkspaceDialog: (root, directory) =>
      dialog.show(() => <DialogResetWorkspace root={root} directory={directory} />),
    showDeleteWorkspaceDialog: (root, directory) =>
      dialog.show(() => <DialogDeleteWorkspace root={root} directory={directory} />),
  }

  const SidebarPanel = (panelProps: { mobile?: boolean; merged?: boolean }) => {
    const merged = createMemo(() => panelProps.mobile || (panelProps.merged ?? layout.sidebar.opened()))
    const projectList = () => layout.projects.list()
    // 已经预热过的项目（悬停一次即可），避免反复触发 loadSessions。
    const warmedProjects = new Set<string>()
    const [taskFilter, setTaskFilter] = createSignal<TaskFilter>("all")
    const { archived, load: loadArchived } = useArchivedSessions(() => projectList())
    // 侧栏「视图」菜单的两档口径：
    // - 工作区筛（选中单个工作区时只显示它，"all" 显示全部）
    // - 分组方式（"workspace" = 每个项目一个可折叠分组；"none" = 摊平成一张列表）
    const visibleProjects = createMemo(() => {
      const selected = layout.taskList.workspace()
      if (selected === "all") return projectList()
      return projectList().filter((project) => pathKey(project.worktree) === selected)
    })
    const isGrouped = createMemo(() => layout.taskList.groupBy() === "workspace")
    // 不分组时不再逐项目渲染分组头（那一支走 mergedProject 的摊平列表）。
    const groupedProjects = createMemo(() => (isGrouped() ? visibleProjects() : []))
    // 「不分组」把可见项目合成一个伪项目传给 ProjectTaskList —— 它只需要目录列表，
    // 而 sortedRootSessionsFrom 自己按会话 id 去重，跨项目合并不会出现重复行。
    const mergedProject = createMemo<LocalProject>(() => {
      const head = visibleProjects()[0]
      const dirs = visibleProjects().flatMap((project) => [project.worktree, ...(project.sandboxes ?? [])])
      return {
        expanded: true,
        worktree: head?.worktree ?? "",
        sandboxes: dirs.filter((dir) => pathKey(dir) !== pathKey(head?.worktree ?? "")),
      }
    })
    const mergedArchived = createMemo(() =>
      [mergedProject().worktree, ...(mergedProject().sandboxes ?? [])].flatMap((dir) => archived()[dir] ?? []),
    )
    /**
     * 「按日期 / 自定义」的分段。两者共用一条渲染路径：都先把可见工作区摊平成
     * 一个伪项目（mergedProject），再按各自的分桶函数切段 —— 分桶只做筛选，
     * 行渲染、状态点、菜单这些仍由 ProjectTaskList 负责，不复制第二套列表。
     */
    const [bucketCollapsed, setBucketCollapsed] = createStore<Record<string, boolean | undefined>>({})
    const bucketExpanded = (key: string) => bucketCollapsed[key] !== true
    const toggleBucket = (key: string) => setBucketCollapsed(key, (value) => !(value ?? false))
    const dateBuckets = createMemo(() =>
      TASK_DATE_BUCKETS.map((bucket) => ({
        key: bucket,
        label: language.t(`sidebar.bucket.${bucket}`),
        where: (session: Session) => dateBucketOf(session, sortNow()) === bucket,
      })),
    )
    const customBuckets = createMemo(() => [
      ...layout.taskList.groups().map((group) => ({
        key: group.id,
        label: group.name,
        where: (session: Session) => layout.taskList.groupOf(session.id) === group.id,
      })),
      {
        key: "unassigned",
        label: language.t("sidebar.task.group.unassigned"),
        where: (session: Session) => !layout.taskList.groupOf(session.id),
      },
    ])
    const bucketList = createMemo(() => {
      const mode = layout.taskList.groupBy()
      if (mode === "date") return dateBuckets()
      if (mode === "custom") return customBuckets()
      return []
    })
    // 「视图 → 工作区」当前选中项在菜单触发器上的回显。筛掉的项目已被关掉时
    // 不显示空名字，而是说明它已经不在了。
    const workspaceViewLabel = createMemo(() => {
      const selected = layout.taskList.workspace()
      if (selected === "all") return language.t("sidebar.view.workspace.all")
      const project = projectList().find((item) => pathKey(item.worktree) === selected)
      if (!project) return language.t("sidebar.view.workspace.missing")
      return project.name || getFilename(project.worktree)
    })
    // 分段上的数量（全部 / 运行中 / 待确认 / 已归档）。归档列表要等它被拉起来才有数字，
    // 所以这里顺带触发一次加载 —— 否则"已归档"永远显示 0，看着像功能没接上。
    const taskCounts = useTaskCounts({
      projects: visibleProjects,
      archived,
      sortNow,
      recency: layout.taskList.recency,
    })
    let archivedLoaded = false
    createEffect(() => {
      if (archivedLoaded || projectList().length === 0) return
      archivedLoaded = true
      loadArchived()
    })

    // 分支隔离提示：只在"当前分支库一条会话都没有"时提醒，正常用起来后不再占位置。
    const branchChannel = createMemo(() => branchChannelOf(server.version()))
    const showLibraryHint = createMemo(
      () => !!branchChannel() && projectList().length > 0 && taskCounts().all === 0 && taskCounts().archived === 0,
    )

    const treeDirectory = createMemo(() => resolveWorkspaceTreeDirectory(currentDir(), currentProject()?.worktree))
    const treeKey = createMemo(() => pathKey(treeDirectory()))
    const treeOpen = createMemo(() => layout.sidebarView.current() === "tree")
    // 桌面端 macOS 的红绿灯压在这一带左上角，需要让出安全区。
    const isMacDesktop = createMemo(() => platform.platform === "desktop" && platform.os === "macos")

    return (
      <div
        classList={{
          "flex flex-col min-h-0 min-w-0 box-border overflow-hidden": true,
          "flex-1 min-w-0 max-w-full": panelProps.mobile,
        }}
        style={{
          width: panelProps.mobile ? undefined : "100%",
          // 模式色统一挂在这一层：品牌字标（`Way` 上色）与顶部模式按钮都读它，
          // 不用各自再找一次当前模式。
          "--mode-accent": modeAccent(),
        }}
      >
        {/* 顶带：窗口拖拽区。桌面端品牌标识已经上移到最左侧图标条顶部（logo 归 rail），
            这里只在移动端抽屉里保留品牌；桌面端这条带子只剩右侧的收起按钮。
            macOS 红绿灯占窗口左上角约 78px，图标条吃掉 48px 后这里让出剩下的 ~30px。 */}
        <div
          data-component="sidebar-top-band"
          class="flex h-12 shrink-0 items-center gap-1 px-2"
          classList={{ "pl-[30px]": isMacDesktop() && !panelProps.mobile }}
          data-window-drag
        >
          <Show when={panelProps.mobile}>
            <button
              type="button"
              class="flex h-8 min-w-0 shrink items-center gap-2 rounded-md px-1.5 text-foreground-subtle transition-colors hover:bg-hover"
              onClick={() => navigate("/")}
              aria-label={language.t("command.home.open")}
              title={language.t("command.home.open")}
              aria-current={!layout.mode.hasSelected() ? "page" : undefined}
            >
              <Show
                when={platform.platform === "desktop" && appAppearance.iconData}
                fallback={<Mark class="size-5 shrink-0 text-foreground" />}
              >
                {(src) => <img src={src()} alt="" class="size-5 shrink-0 object-contain" draggable={false} />}
              </Show>
              {/* 品牌字标：`Nova` 用前景色、`Way` 用当前模式色。
                  比纯文本多一档识别度（用户要求"特殊格式"），同时顺带当作模式指示。 */}
              <span class="brand-wordmark text-ui-base truncate">
                Nova<span class="text-[var(--mode-accent)]">Way</span>
              </span>
            </button>
          </Show>
          {/* 模式切换放在顶带左侧的留白里：它是全局作用域最重的选择（决定整个工作台的能力面），
              顶带这一行原本只有右上角一个收起按钮，logo 右边这片空白正好放它（用户指定的位置）。
              用胶囊形态，不额外撑出一条工具栏。 */}
          <ModeSwitchButton compact onSelect={(mode) => layout.mode.select(mode.id)} />
          {/* 更新入口：紧挨着 logo 所在的那条图标栏。
              检查中 → 灰色"检查中"；查到新版本 → 绿色"更新 vX"（点一下开始下载）；
              下载中 → 绿色进度条 + 百分比（进度由主进程推，切页面继续走）；
              下完 → 绿色"更新 vX"（点一下安装并重启）。
              状态放在应用级 store 里（context/update.ts），所以从设置页发起检查、
              然后切回会话页，看到的还是"检查中"，不会重置。
              顶带是窗口拖拽区，但 index.css 已把其中的 button 统一设成 no-drag。 */}
          <Show when={updateButtonVisible()}>
            <Tooltip value={updateButtonTooltip()} placement="bottom">
              <button
                type="button"
                data-component="update-ready-button"
                data-stage={updateState.stage}
                class="relative flex h-7 shrink-0 items-center gap-1.5 overflow-hidden rounded-full px-2 text-12-medium shadow-[0_1px_2px_color-mix(in_srgb,var(--text-strong)_18%,transparent)] transition-[filter,color,background-color] hover:brightness-110 disabled:opacity-70"
                classList={{
                  // 下载中/可下载/已下载用绿色实心；检查中用中性色，避免"有新版本"的误读。
                  "bg-[var(--surface-success-base)] text-[var(--text-on-success-base)]":
                    updateState.stage === "available" || updateState.stage === "downloaded",
                  "border border-border bg-surface text-foreground-subtle": updateState.stage === "checking",
                  "bg-[var(--surface-success-strong)] text-[var(--text-on-success-strong)]":
                    updateState.stage === "downloading",
                }}
                aria-label={updateButtonTooltip()}
                disabled={updateButtonBusy()}
                onClick={onUpdateButtonClick}
              >
                {/* 下载进度：一条从左侧填充的浅色层，百分比文本叠在上面。 */}
                <Show when={updateState.stage === "downloading"}>
                  <span
                    class="pointer-events-none absolute inset-y-0 left-0 bg-[color-mix(in_srgb,currentColor_22%,transparent)] transition-[width] duration-300"
                    style={{ width: `${updateState.percent}%` }}
                  />
                </Show>
                {/* 检查中给一个转圈，避免"点了没反应"的观感。 */}
                <Show
                  when={updateState.stage === "checking"}
                  fallback={<Icon name="download" size="small" style={updateIconColor()} />}
                >
                  <span
                    class="size-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
                    style={{ color: "var(--foreground-subtle)" }}
                  />
                </Show>
                <span class="relative whitespace-nowrap">{updateButtonLabel()}</span>
              </button>
            </Tooltip>
          </Show>
          {/* 导航控件（设置 → 通用 → 高级 → 导航控件）：前进/后退就放在工作模式选择右边，
              和模式胶囊同一行。以前这两个按钮只在全局标题栏存在，标题栏移除后开关就"没反应"了；
              现在由这里承接，关掉开关整组消失。 */}
          <Show when={settings.general.showNavigation()}>
            <div class="flex shrink-0 items-center gap-0.5">
              <Tooltip value={language.t("common.goBack")} placement="bottom">
                <IconButton
                  icon="arrow-left"
                  variant="ghost"
                  size="normal"
                  aria-label={language.t("common.goBack")}
                  disabled={navHistory.index <= 0}
                  onClick={() => goBack()}
                />
              </Tooltip>
              <Tooltip value={language.t("common.goForward")} placement="bottom">
                <IconButton
                  icon="arrow-right"
                  variant="ghost"
                  size="normal"
                  aria-label={language.t("common.goForward")}
                  disabled={navHistory.index >= navHistory.stack.length - 1}
                  onClick={() => goForward()}
                />
              </Tooltip>
            </div>
          </Show>
          <div class="flex-1" />
          <Show
            when={panelProps.mobile}
            fallback={
              <Tooltip value={language.t("sidebar.workspaceSidebar.collapse")} placement="bottom">
                <IconButton
                  icon="chevron-left"
                  variant="ghost"
                  size="normal"
                  aria-label={language.t("sidebar.workspaceSidebar.collapse")}
                  onClick={() => layout.sidebar.setExpanded(false)}
                />
              </Tooltip>
            }
          >
            <IconButton
              icon="close"
              variant="ghost"
              aria-label={language.t("sidebar.menu.toggle")}
              onClick={() => layout.mobileSidebar.hide()}
            />
          </Show>
        </div>

        {/* 动作区：整宽「新建任务」+ 自动化 + 整宽「搜索」。两个整宽入口
            取代原来那行把图标挤在一起的 icon-only 工具条。 */}
        <div class="flex shrink-0 flex-col gap-1 px-2 pb-2">
          <Button
            data-component="sidebar-new-task"
            variant="primary"
            size="large"
            class="w-full justify-start gap-2"
            icon="plus-small"
            aria-label={language.t("sidebar.newTask")}
            onClick={startNewTask}
          >
            {language.t("sidebar.newTask")}
          </Button>
          <Button
            variant="ghost"
            size="large"
            class="w-full justify-start gap-2 text-foreground"
            aria-label={language.t("sidebar.extensionsMarket")}
            onClick={openExtensionsPage}
          >
            <Icon name="dot-grid" size="small" class="shrink-0 text-icon-interactive-base" />
            <span class="min-w-0 flex-1 truncate text-left">{language.t("sidebar.extensionsMarket")}</span>
            <Show when={extensionUpdateCount() > 0}>
              <span
                data-component="sidebar-extensions-badge"
                class="min-w-5 rounded-full bg-surface-critical-base px-1.5 text-center text-[10px] font-semibold leading-5 text-text-on-critical-base"
                aria-label={`${extensionUpdateCount()} 个扩展可更新`}
              >
                {extensionUpdateCount() > 99 ? "99+" : extensionUpdateCount()}
              </span>
            </Show>
          </Button>
          {/* 自动化从图标条挪到这里：它是日常最常点的一个，和「新建任务」挨着比收进 rail 更好找。 */}
          <Button
            variant="ghost"
            size="large"
            class="w-full justify-start gap-2 text-foreground"
            aria-label={language.t("sidebar.automation")}
            onClick={openAutomationPage}
          >
            <Icon name="autopilot" size="small" class="shrink-0 text-icon-interactive-base" />
            <span class="min-w-0 flex-1 truncate text-left">{language.t("sidebar.automation")}</span>
          </Button>
          {/* 命令面板开关（设置 → 通用 → 高级 → 命令面板）：关掉后这条入口整条消失。 */}
          <Show when={settings.general.showSearch()}>
            <Button
              variant="ghost"
              size="large"
              class="w-full justify-start gap-2 text-foreground"
              aria-label={language.t("sidebar.search")}
              onClick={() => command.trigger("file.open")}
            >
              <Icon name="magnifying-glass" size="small" class="shrink-0 text-foreground-subtlest" />
              <span class="min-w-0 flex-1 truncate text-left">{language.t("sidebar.search")}</span>
              <Keybind class="shrink-0 text-ui-xs text-foreground-subtlest">{command.keybind("file.open")}</Keybind>
            </Button>
          </Show>
          {/* 「工作区」标签单独占一行，右侧跟视图/新建入口；
              任务/文件的分段切换放在它下面一行，不再和标签挤在同一行。 */}
          <div class="flex flex-col gap-1.5 pt-1">
            <div class="flex items-center gap-1">
              <span class="min-w-0 truncate px-1 text-ui-caption font-medium text-foreground-subtle">
                {language.t("sidebar.workspaces.title")}
              </span>
              {/* 「打开项目」保留；收起入口不在这里重复一份 —— 侧栏顶带已经有了，
                  同屏两个「折叠工作区」是重复入口（用户反馈的正是这个）。
                  入口改成菜单：「打开已有项目」之外再给「新建项目」，
                  两条路都在同一个 + 号里，不用先去文件管理器建好目录。 */}
              <div class="ml-auto flex shrink-0 items-center gap-0.5">
                {/* 视图菜单：分组方式 / 排序方式 /
                  工作区筛选 / 最近活动时间窗 / 恢复默认。
                  偏好存在 layout 的持久化 store 里，刷新与切项目都不会丢。 */}
                <DropdownMenu gutter={4} placement="bottom-end">
                  <DropdownMenu.Trigger
                    as={IconButton}
                    icon="sliders"
                    variant="ghost"
                    size="small"
                    aria-label={language.t("sidebar.view.menu")}
                    title={language.t("sidebar.view.menu")}
                  />
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content style={{ "min-width": "190px" }}>
                      <DropdownMenu.Sub>
                        <DropdownMenu.SubTrigger>
                          <span>{language.t("sidebar.view.groupBy")}</span>
                          <span class="ml-auto text-ui-xs text-foreground-subtlest">
                            {language.t(`sidebar.view.groupBy.${layout.taskList.groupBy()}`)}
                          </span>
                          <Icon name="chevron-right" size="small" class="text-foreground-subtlest" />
                        </DropdownMenu.SubTrigger>
                        <DropdownMenu.Portal>
                          <DropdownMenu.SubContent style={{ "min-width": "150px" }}>
                            <DropdownMenu.RadioGroup
                              value={layout.taskList.groupBy()}
                              onChange={(value) =>
                                layout.taskList.setGroupBy(
                                  value === "date" || value === "custom" || value === "none" ? value : "workspace",
                                )
                              }
                            >
                              <For each={["workspace", "date", "custom", "none"] as const}>
                                {(mode) => (
                                  <DropdownMenu.RadioItem
                                    value={mode}
                                    onSelect={() => layout.taskList.setGroupBy(mode)}
                                  >
                                    <DropdownMenu.ItemLabel>
                                      {language.t(`sidebar.view.groupBy.${mode}`)}
                                    </DropdownMenu.ItemLabel>
                                    <DropdownMenu.ItemIndicator>
                                      <Icon name="check-small" size="small" class="text-foreground-subtlest" />
                                    </DropdownMenu.ItemIndicator>
                                  </DropdownMenu.RadioItem>
                                )}
                              </For>
                            </DropdownMenu.RadioGroup>
                            <DropdownMenu.Separator />
                            <DropdownMenu.Item onSelect={() => dialog.show(() => <DialogTaskGroups />)}>
                              <DropdownMenu.ItemLabel>{language.t("sidebar.task.group.manage")}</DropdownMenu.ItemLabel>
                            </DropdownMenu.Item>
                          </DropdownMenu.SubContent>
                        </DropdownMenu.Portal>
                      </DropdownMenu.Sub>
                      <DropdownMenu.Sub>
                        <DropdownMenu.SubTrigger>
                          <span>{language.t("sidebar.view.sortBy")}</span>
                          <span class="ml-auto text-ui-xs text-foreground-subtlest">
                            {language.t(`sidebar.view.sortBy.${layout.taskList.sortBy()}`)}
                          </span>
                          <Icon name="chevron-right" size="small" class="text-foreground-subtlest" />
                        </DropdownMenu.SubTrigger>
                        <DropdownMenu.Portal>
                          <DropdownMenu.SubContent style={{ "min-width": "150px" }}>
                            <DropdownMenu.RadioGroup
                              value={layout.taskList.sortBy()}
                              onChange={(value) =>
                                layout.taskList.setSortBy(value === "created" || value === "name" ? value : "recent")
                              }
                            >
                              <For each={["recent", "created", "name"] as const}>
                                {(order) => (
                                  <DropdownMenu.RadioItem
                                    value={order}
                                    onSelect={() => layout.taskList.setSortBy(order)}
                                  >
                                    <DropdownMenu.ItemLabel>
                                      {language.t(`sidebar.view.sortBy.${order}`)}
                                    </DropdownMenu.ItemLabel>
                                    <DropdownMenu.ItemIndicator>
                                      <Icon name="check-small" size="small" class="text-foreground-subtlest" />
                                    </DropdownMenu.ItemIndicator>
                                  </DropdownMenu.RadioItem>
                                )}
                              </For>
                            </DropdownMenu.RadioGroup>
                          </DropdownMenu.SubContent>
                        </DropdownMenu.Portal>
                      </DropdownMenu.Sub>
                      <DropdownMenu.Sub>
                        <DropdownMenu.SubTrigger>
                          <span>{language.t("sidebar.view.workspace")}</span>
                          <span class="ml-auto max-w-32 truncate text-ui-xs text-foreground-subtlest">
                            {workspaceViewLabel()}
                          </span>
                          <Icon name="chevron-right" size="small" class="text-foreground-subtlest" />
                        </DropdownMenu.SubTrigger>
                        <DropdownMenu.Portal>
                          <DropdownMenu.SubContent class="max-h-96 overflow-y-auto" style={{ "min-width": "180px" }}>
                            <DropdownMenu.RadioGroup
                              value={layout.taskList.workspace()}
                              onChange={(value) => layout.taskList.setWorkspace(String(value))}
                            >
                              <DropdownMenu.RadioItem value="all" onSelect={() => layout.taskList.setWorkspace("all")}>
                                <DropdownMenu.ItemLabel>
                                  {language.t("sidebar.view.workspace.all")}
                                </DropdownMenu.ItemLabel>
                                <DropdownMenu.ItemIndicator>
                                  <Icon name="check-small" size="small" class="text-foreground-subtlest" />
                                </DropdownMenu.ItemIndicator>
                              </DropdownMenu.RadioItem>
                              <For each={projectList()}>
                                {(project) => {
                                  const key = pathKey(project.worktree)
                                  return (
                                    <DropdownMenu.RadioItem
                                      value={key}
                                      onSelect={() => layout.taskList.setWorkspace(key)}
                                    >
                                      <DropdownMenu.ItemLabel>
                                        {project.name || getFilename(project.worktree)}
                                      </DropdownMenu.ItemLabel>
                                      <DropdownMenu.ItemIndicator>
                                        <Icon name="check-small" size="small" class="text-foreground-subtlest" />
                                      </DropdownMenu.ItemIndicator>
                                    </DropdownMenu.RadioItem>
                                  )
                                }}
                              </For>
                            </DropdownMenu.RadioGroup>
                          </DropdownMenu.SubContent>
                        </DropdownMenu.Portal>
                      </DropdownMenu.Sub>
                      <DropdownMenu.Sub>
                        <DropdownMenu.SubTrigger>
                          <span>{language.t("sidebar.view.recency")}</span>
                          <span class="ml-auto text-ui-xs text-foreground-subtlest">
                            {language.t(`sidebar.view.recency.${layout.taskList.recency()}`)}
                          </span>
                          <Icon name="chevron-right" size="small" class="text-foreground-subtlest" />
                        </DropdownMenu.SubTrigger>
                        <DropdownMenu.Portal>
                          <DropdownMenu.SubContent style={{ "min-width": "150px" }}>
                            <DropdownMenu.RadioGroup
                              value={layout.taskList.recency()}
                              onChange={(value) =>
                                layout.taskList.setRecency(
                                  value === "today" || value === "week" || value === "month" ? value : "all",
                                )
                              }
                            >
                              <For each={["all", "today", "week", "month"] as const}>
                                {(window) => (
                                  <DropdownMenu.RadioItem
                                    value={window}
                                    onSelect={() => layout.taskList.setRecency(window)}
                                  >
                                    <DropdownMenu.ItemLabel>
                                      {language.t(`sidebar.view.recency.${window}`)}
                                    </DropdownMenu.ItemLabel>
                                    <DropdownMenu.ItemIndicator>
                                      <Icon name="check-small" size="small" class="text-foreground-subtlest" />
                                    </DropdownMenu.ItemIndicator>
                                  </DropdownMenu.RadioItem>
                                )}
                              </For>
                            </DropdownMenu.RadioGroup>
                          </DropdownMenu.SubContent>
                        </DropdownMenu.Portal>
                      </DropdownMenu.Sub>
                      <DropdownMenu.Separator />
                      <DropdownMenu.Item onSelect={() => layout.taskList.reset()}>
                        <DropdownMenu.ItemLabel>{language.t("sidebar.view.reset")}</DropdownMenu.ItemLabel>
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu>
                {/* 点 + 弹出「新建工作区」：可以选已有文件夹直接打开，也可以选保存位置新建项目。
                  以前这里是一层下拉菜单，两个动作各占一条。 */}
                <IconButton
                  icon="folder-add-left"
                  variant="ghost"
                  size="small"
                  aria-label={language.t("workspace.add.title")}
                  title={language.t("workspace.add.title")}
                  onClick={showAddWorkspaceDialog}
                />
              </div>
            </div>
            {/* 任务 / 文件分段切换：紧跟「工作区」行下方，用滑动指示器而不是两个各自变色的按钮。 */}
            <div class="relative flex h-7 shrink-0 items-center self-start rounded-full bg-surface p-0.5">
              <span
                aria-hidden="true"
                class="pointer-events-none absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-full bg-background transition-transform duration-200 ease-out"
                style={{ transform: treeOpen() ? "translateX(100%)" : "translateX(0)" }}
              />
              <button
                type="button"
                class="relative z-10 h-6 flex-none rounded-full px-2.5 text-ui-sm font-medium transition-colors"
                classList={{
                  "text-foreground": !treeOpen(),
                  "text-foreground-subtle": treeOpen(),
                }}
                aria-pressed={!treeOpen()}
                onClick={() => layout.sidebarView.set("tasks")}
              >
                {language.t("sidebar.view.tasks")}
              </button>
              <button
                type="button"
                class="relative z-10 h-6 flex-none rounded-full px-2.5 text-ui-sm font-medium transition-colors"
                classList={{
                  "text-foreground": treeOpen(),
                  "text-foreground-subtle": !treeOpen(),
                }}
                aria-pressed={treeOpen()}
                onClick={() => layout.sidebarView.set("tree")}
              >
                {language.t("sidebar.view.files")}
              </button>
            </div>
          </div>
        </div>
        {/* 列表层与文件树层叠放：文件树是整层 slide-over，
            不再用「任务/文件」分段控件把同一列替换掉。 */}
        <div class="relative flex-1 min-h-0">
          <div
            class="sidebar-view-layer absolute inset-0 flex min-h-0 flex-col transition-transform ease-out"
            classList={{ "-translate-x-full pointer-events-none": treeOpen() }}
            aria-hidden={treeOpen()}
          >
            <TaskFilterBar
              filter={taskFilter()}
              variant="text"
              counts={taskCounts}
              onChange={(id) => {
                if (id !== "projects") {
                  setTaskFilter(id)
                  if (id === "archived") loadArchived()
                }
              }}
            />

            {/* 工作区任务与「最近任务」共用同一个滚动容器：最近任务跟在已打开工作区
                的任务下面随列表滚动，而不是钉在底部另起一块。 */}
            <div class="flex-1 min-h-0 overflow-y-auto no-scrollbar px-2 pb-3 [overflow-anchor:none]">
              <Show
                when={visibleProjects().length > 0}
                fallback={
                  <div class="flex min-h-[45vh] items-center justify-center px-6 text-center">
                    <Show
                      when={projectList().length > 0}
                      fallback={
                        <div class="mt-8 flex max-w-60 flex-col items-center gap-4 text-center">
                          <div class="text-14-medium text-foreground">{language.t("sidebar.empty.title")}</div>
                          <div class="text-14-regular text-foreground">{language.t("sidebar.empty.description")}</div>
                          <Button size="large" icon="folder-add-left" onClick={chooseProject}>
                            {language.t("command.project.open")}
                          </Button>
                        </div>
                      }
                    >
                      {/* 项目其实开着，只是被「视图 → 工作区」筛走了。
                          不给一句说明的话这里看起来像侧栏坏了。 */}
                      <div class="mt-8 flex max-w-60 flex-col items-center gap-3 text-center">
                        <div class="text-14-regular text-foreground">{language.t("sidebar.view.workspaceEmpty")}</div>
                        <Button
                          size="large"
                          variant="ghost"
                          icon="folder"
                          onClick={() => layout.taskList.setWorkspace("all")}
                        >
                          {language.t("sidebar.view.workspaceEmpty.action")}
                        </Button>
                      </div>
                    </Show>
                  </div>
                }
              >
                {/* 「视图 → 分组方式 = 不分组」：所有可见工作区的任务摊平成一张列表。
                    mergedProject 只是给 ProjectTaskList 喂目录集合，分组头不渲染。 */}
                <Show when={layout.taskList.groupBy() === "none"}>
                  <ProjectTaskList
                    project={mergedProject()}
                    sidebarExpanded={() => layout.sidebar.expanded()}
                    prefetchSession={prefetchSession}
                    archiveSession={archiveSession}
                    filter={taskFilter}
                    archived={mergedArchived}
                    sortNow={sortNow}
                    pinned={layout.pinned.sessions}
                    sort={layout.taskList.sortBy}
                    recency={layout.taskList.recency}
                  />
                </Show>
                {/* 「按日期 / 自定义」：每段一个 ProjectTaskList，段头与计数由它自己出，
                    空段直接不渲染（四段日期里"没有半年前的任务"时不该挂一个空标题）。 */}
                <For each={bucketList()}>
                  {(bucket) => (
                    <ProjectTaskList
                      project={mergedProject()}
                      sidebarExpanded={() => layout.sidebar.expanded()}
                      prefetchSession={prefetchSession}
                      archiveSession={archiveSession}
                      filter={taskFilter}
                      archived={mergedArchived}
                      sortNow={sortNow}
                      pinned={layout.pinned.sessions}
                      sort={layout.taskList.sortBy}
                      recency={layout.taskList.recency}
                      where={bucket.where}
                      bucket={{
                        label: bucket.label,
                        expanded: () => bucketExpanded(bucket.key),
                        onToggle: () => toggleBucket(bucket.key),
                      }}
                    />
                  )}
                </For>
                <For each={groupedProjects()}>
                  {(proj) => {
                    // 展开态直接读持久化的 store，不要用本地 signal 快照：
                    // 桌面端 `persisted` 走异步 IPC，面板先渲染、store 后水合，
                    // 快照会把"还没水合"的 undefined 固化成 true 且再也不更新 ——
                    // 表现就是"每次重启都忘了分组是收起的"。
                    const isExpanded = () => store.projectExpanded[proj.worktree] ?? true
                    const projectArchived = () =>
                      [proj.worktree, ...(proj.sandboxes ?? [])].flatMap((directory) => archived()[directory] ?? [])
                    const projectName = () => proj.name || getFilename(proj.worktree)
                    // 项目行右侧的数量。口径与列表一致：按当前分段筛，只数根会话
                    // （子会话是父行下面的树节点，单独计数会让"项目有几件事"变得含糊）。
                    const projectTaskCount = (project: LocalProject) => {
                      const filter = taskFilter()
                      const dirs = [project.worktree, ...(project.sandboxes ?? [])]
                      if (filter === "archived") {
                        return dirs.flatMap((directory) => archived()[directory] ?? []).length
                      }
                      let total = 0
                      for (const directory of dirs) {
                        const sessions = globalSync.child(directory, { bootstrap: false })[0].session ?? []
                        for (const session of sessions) {
                          if (session.parentID || session.time?.archived) continue
                          // 与下方列表同口径：「视图 → 最近活动」筛掉的会话不计入徽章，
                          // 否则数字说"5"、列表只有 2 行。
                          if (!withinRecency(session, layout.taskList.recency(), sortNow())) continue
                          if (filter === "all") {
                            total += 1
                            continue
                          }
                          const status = sessionStatusOf(globalSync, permission, notification, session)
                          if (filter === "running" ? status === "running" || status === "failed" : status === filter) {
                            total += 1
                          }
                        }
                      }
                      return total
                    }
                    const toggleExpand = () => {
                      setStore("projectExpanded", proj.worktree, !isExpanded())
                    }
                    // 悬停即预热：把目标项目的会话列表和子 store 提前拉起来。
                    // 点下去时 lastProjectSession / latest 都已在本地缓存里，
                    // 切项目不再先等一次 network。
                    const warmProject = () => {
                      if (warmedProjects.has(proj.worktree)) return
                      warmedProjects.add(proj.worktree)
                      globalSync.child(proj.worktree, { bootstrap: false })
                      void globalSync.project.loadSessions(proj.worktree)
                    }
                    return (
                      <div class="mt-1">
                        <div
                          classList={{
                            "group flex items-center gap-1.5 px-2 py-1.5 rounded-md transition-colors hover:bg-hover": true,
                            "bg-selected": pathKey(proj.worktree) === treeKey(),
                          }}
                          onPointerEnter={warmProject}
                        >
                          <button
                            aria-label={
                              isExpanded()
                                ? language.t("sidebar.project.collapse")
                                : language.t("sidebar.project.expand")
                            }
                            onClick={toggleExpand}
                          >
                            <Icon name={isExpanded() ? "chevron-down" : "chevron-right"} size="small" />
                          </button>
                          {/* 点名字 = 切到该项目（跳到它最近的任务）并顺带展开分组；
                              展开态仍由左侧箭头单独控制，两个热区语义分开 ——
                              此前整行只做展开/收起，导致必须先点进项目下任意会话才能切过去。 */}
                          <button
                            type="button"
                            class="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                            aria-label={projectName()}
                            onClick={() => {
                              if (!isExpanded()) toggleExpand()
                              void openProject(proj.worktree)
                            }}
                          >
                            <Icon name="folder" size="small" class="shrink-0 text-foreground-subtle" />
                            <Show when={layout.pinned.project(proj.worktree)}>
                              <Icon name="pin" size="small" class="shrink-0 text-foreground-subtlest" />
                            </Show>
                            <span class="text-ui-caption text-foreground font-medium truncate min-w-0">
                              {projectName()}
                            </span>
                            {/* 项目有多少任务：分组头右侧的圆角计数
                                （只用缩进不写数字的话，收起时完全看不出里面有东西）。 */}
                            <Show when={(projectTaskCount(proj) ?? 0) > 0}>
                              <span class="ml-auto shrink-0 rounded-full bg-surface px-1.5 py-0.5 text-ui-xs font-medium leading-none text-foreground-subtle tabular-nums">
                                {projectTaskCount(proj)}
                              </span>
                            </Show>
                            <span class="flex-1 min-w-0" />
                          </button>
                          {/* 还不是 Git 仓库的项目：名字旁边给一个 branch 图标（悬停出现），
                              点开是「初始化 Git 仓库」的小浮层。以前这个入口是会话右上角
                              一张常驻的空卡，既占位置又跟会话无关。 */}
                          <ProjectGitInit project={proj} />
                          <IconButton
                            icon="plus-small"
                            variant="ghost"
                            size="small"
                            aria-label={language.t("sidebar.newTask")}
                            class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                            onClick={() => navigateWithSidebarReset(`/${base64Encode(proj.worktree)}/session`)}
                          />
                          <ProjectMenu project={proj} ctx={projectSidebarCtx} />
                        </div>
                        <Show when={isExpanded()}>
                          <div class="flex flex-col gap-0.5 sidebar-group-enter">
                            <ProjectTaskList
                              project={proj}
                              sidebarExpanded={() => layout.sidebar.expanded()}
                              prefetchSession={prefetchSession}
                              archiveSession={archiveSession}
                              filter={taskFilter}
                              archived={projectArchived}
                              sortNow={sortNow}
                              pinned={layout.pinned.sessions}
                              sort={layout.taskList.sortBy}
                              recency={layout.taskList.recency}
                            />
                          </div>
                        </Show>
                      </div>
                    )
                  }}
                </For>

                {/* 分支隔离的会话库提示。
                    开发构建把数据库按分支拆成 `novaway-<分支>.db`，`git checkout` 之后
                    界面里看到的是一份全新库 —— 用户的第一反应是"历史会话全丢了"。
                    这里只在"一条会话都没有"时挂一句说明，把原因和恢复办法讲清楚。 */}
                <Show when={showLibraryHint()}>
                  <div
                    data-component="sidebar-library-hint"
                    class="mt-2 mx-1 rounded-lg border border-border bg-surface/60 px-2.5 py-2"
                  >
                    <div class="flex items-start gap-1.5">
                      <Icon name="folder" size="small" class="mt-0.5 shrink-0 text-foreground-subtle" />
                      <div class="min-w-0 flex flex-col gap-0.5">
                        <span class="text-ui-caption font-medium text-foreground">
                          {language.t("sidebar.library.branch.title", { channel: branchChannel() ?? "" })}
                        </span>
                        <span class="text-ui-xs text-foreground-subtle">
                          {language.t("sidebar.library.branch.description")}
                        </span>
                      </div>
                    </div>
                  </div>
                </Show>
              </Show>
              {/* 无工作区会话跟在已打开工作区的任务下面，随列表一起滚动 ——
                  固定在底部会让人以为它是独立面板，和工作区分组脱节。 */}
              <div class="mt-1 pb-2">
                <GlobalChatTasks />
              </div>
            </div>
            <div
              class="shrink-0 px-3 py-3"
              classList={{
                hidden: store.gettingStartedDismissed || !(providers.all().length > 0 && providers.paid().length === 0),
              }}
            >
              <div class="rounded-xl bg-background shadow-xs-border-base" data-component="getting-started">
                <div class="p-3 flex flex-col gap-6">
                  <div class="flex flex-col gap-2">
                    <div class="text-14-medium text-foreground">{language.t("sidebar.gettingStarted.title")}</div>
                    <div class="text-14-regular text-foreground" style={{ "line-height": "var(--line-height-normal)" }}>
                      {language.t("sidebar.gettingStarted.line1")}
                    </div>
                    <div class="text-14-regular text-foreground" style={{ "line-height": "var(--line-height-normal)" }}>
                      {language.t("sidebar.gettingStarted.line2")}
                    </div>
                  </div>
                  <div data-component="getting-started-actions">
                    <Button size="large" icon="plus-small" onClick={connectProvider}>
                      {language.t("command.provider.connect")}
                    </Button>
                    <Button size="large" variant="ghost" onClick={() => setStore("gettingStartedDismissed", true)}>
                      {language.t("toast.update.action.notYet")}
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* 侧栏 footer：桌面端的全局入口都在最左侧图标条里（见 sidebar-rail.tsx，
                主题切换在 brand 下方、设置在最底部），这里只剩移动端抽屉的一排图标兜底 ——
                抽屉没有竖向窄条，入口不能丢。 */}
            <Show when={panelProps.mobile}>
              <div class="shrink-0 border-t border-border p-2">
                <div class="flex flex-wrap items-center gap-1">
                  <For each={railItems()}>{(item) => <SidebarRailButton item={item} />}</For>
                  <span class="mx-0.5 h-5 w-px bg-border" />
                  <For each={railFooter()}>{(item) => <SidebarRailButton item={item} />}</For>
                  <SidebarRailButton item={settingsRailItem()} />
                  <ThemeSchemeToggle variant="icon" />
                </div>
              </div>
            </Show>
          </div>

          {/* 文件树层：整层 slide-over，顶部一条返回条。 */}
          <div
            class="sidebar-view-layer absolute inset-0 flex min-h-0 flex-col transition-transform ease-out"
            classList={{ "translate-x-full pointer-events-none": !treeOpen() }}
            aria-hidden={!treeOpen()}
          >
            <div class="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2">
              <button
                type="button"
                class="flex items-center gap-1 text-ui-caption text-foreground-subtle transition-colors hover:text-foreground"
                onClick={() => layout.sidebarView.set("tasks")}
              >
                <Icon name="arrow-left" size="small" />
                {language.t("sidebar.backToTasks")}
              </button>
            </div>
            <div class="min-h-0 flex-1">
              <SidebarFiles
                directory={treeDirectory()}
                sessionKey={() => `${params.dir}${params.id ? "/" + params.id : ""}`}
              />
            </div>
          </div>
        </div>
      </div>
    )
  }

  const projects = () => layout.projects.list()
  // 所有工作模式共用同一套外壳（侧栏 + 图标条 + 会话区）：模式只决定 agent / 技能 /
  // MCP 这些能力面。以前运营模式整块不显示侧栏、还会把路由顶到 `/pulse`，
  // 切过去时图标条一起消失，和"模式只是换能力"的预期不符。
  const showSidebar = createMemo(() => true)

  // 应用内前进/后退历史。原来由全局标题栏承载的两个导航按钮随标题栏移除，逻辑挪到外壳层，
  // 只保留命令入口（command.register 里的 common.goBack / common.goForward）。
  const [navHistory, setNavHistory] = createStore<TitlebarHistory>({ stack: [], index: -1, action: undefined })
  createEffect(() => {
    const current = `${location.pathname}${location.search}${location.hash}`
    untrack(() => {
      const next = applyPath(navHistory, current)
      if (next === navHistory) return
      setNavHistory(next)
    })
  })
  const goBack = () => {
    const next = backPath(navHistory)
    if (!next) return
    setNavHistory(next.state)
    navigate(next.to)
  }
  const goForward = () => {
    const next = forwardPath(navHistory)
    if (!next) return
    setNavHistory(next.state)
    navigate(next.to)
  }

  /**
   * 侧栏最左侧窄图标条的内容。
   *
   * 顺序按使用频率排：数据库（编码时查表）→ 知识库 → 团队 → 扩展；
   * 主题切换挪到底部（设置之上），设置沉在最底部，辅助对话只在会话里出现。
   * 「定时任务」在面板展开时有整宽入口；**面板收起后**它和「新建任务」一起收进
   * 图标条 —— 否则折叠后这两个最常用的动作就完全没入口了。
   */
  const railItems = (): SidebarRailItem[] => {
    const items: SidebarRailItem[] = []
    if (!layout.sidebar.expanded()) {
      items.push({
        id: "newTask",
        icon: "plus-small",
        label: language.t("sidebar.newTask"),
        onClick: startNewTask,
      })
      items.push({
        id: "automation",
        icon: "autopilot",
        label: language.t("sidebar.automation"),
        tone: "var(--icon-interactive-base)",
        active: state.automationPage.open,
        onClick: openAutomationPage,
      })
    }
    if (settings.general.showDatabase()) {
      items.push({
        id: "database",
        icon: "database",
        label: language.t("sidebar.database"),
        tone: "var(--icon-interactive-base)",
        active: state.databasePage.open,
        onClick: () => command.trigger("database.open"),
      })
    }
    items.push(
      {
        id: "knowledge",
        icon: "book",
        label: language.t("sidebar.knowledge"),
        tone: "var(--icon-interactive-base)",
        active: state.knowledgePage.open,
        onClick: openKnowledgePage,
      },
      {
        id: "teams",
        icon: "lu-users",
        label: language.t("sidebar.team"),
        tone: "var(--icon-interactive-base)",
        active: state.teamPage.open,
        onClick: openTeamPage,
      },
      {
        id: "arena",
        icon: "lu-flip-horizontal-2",
        label: language.t("sidebar.arena"),
        tone: "var(--icon-interactive-base)",
        active: state.arenaPage.open,
        onClick: openArenaPage,
      },
      // 运营工作台由 operations-suite 插件提供 Agent/Skill/Workbench；插件未启用时不展示旧入口。
      ...(layout.mode.all().some((mode) => mode.id === "operations")
        ? [
            {
              id: "pulse",
              icon: "globe" as const,
              label: language.t("sidebar.pulseWorkspace"),
              tone: "var(--icon-interactive-base)",
              active: state.pulsePage.open,
              onClick: openPulsePage,
            },
          ]
        : []),
    )

    if (!params.dir) return items
    const directorySlug = params.dir
    const directory = currentDir()
    const pluginContributions = directory
      ? globalSync.child(directory, { bootstrap: false })[0].plugin_contributions
      : []
    for (const contribution of pluginContributions) {
      if (contribution.kind !== "surface" || contribution.slot !== "sidebar.item" || contribution.status !== "active")
        continue
      if (!contribution.title) continue
      const action = parsePluginSurfaceAction(contribution.action)
      if (!action) continue
      const viewPath =
        action.type === "view" ? pluginSurfaceViewPath(directorySlug, contribution.pluginID, action.viewId) : undefined
      items.push({
        id: `plugin-surface:${contribution.pluginID}:${contribution.localName}`,
        icon: contribution.icon && isIconName(contribution.icon) ? contribution.icon : "dot-grid",
        label: contribution.title,
        tone: "var(--icon-interactive-base)",
        active: viewPath !== undefined && location.pathname === viewPath,
        onClick: () => {
          if (action.type === "command") {
            dispatchPluginCommand(contribution, action.command, pluginContributions)
            return
          }
          if (action.type === "url") {
            openPluginSurfaceUrl(action.url)
            return
          }
          navigate(pluginSurfaceViewPath(directorySlug, contribution.pluginID, action.viewId))
        },
      })
    }
    return items
  }

  // 设置入口在桌面端是 rail 最底部带下拉框的按钮（SettingsRailMenu）；
  // 移动端抽屉没有窄条，仍用这个 item 兜底。
  const settingsRailItem = (): SidebarRailItem => ({
    id: "settings",
    icon: "settings-gear",
    label: language.t("sidebar.settings"),
    active: state.settings.open,
    onClick: () => command.trigger("settings.open"),
  })

  const railFooter = (): SidebarRailItem[] => {
    const items: SidebarRailItem[] = []
    if (params.id) {
      items.push({
        id: "sideChat",
        icon: "speech-bubble",
        label: language.t("sidebar.sideChat"),
        tone: "var(--icon-interactive-base)",
        onClick: openSideChatFromSidebar,
      })
    }
    const directory = currentDir()
    const directorySlug = params.dir
    const pluginContributions = directory
      ? globalSync.child(directory, { bootstrap: false })[0].plugin_contributions
      : []
    if (directory && directorySlug) {
      for (const contribution of pluginContributions) {
        if (
          contribution.kind !== "surface" ||
          contribution.slot !== "sidebar.footer" ||
          contribution.status !== "active"
        )
          continue
        if (!contribution.title) continue
        const action = parsePluginSurfaceAction(contribution.action)
        if (!action) continue
        items.push({
          id: `plugin-footer:${contribution.pluginID}:${contribution.localName}`,
          icon: contribution.icon && isIconName(contribution.icon) ? contribution.icon : "dot-grid",
          label: contribution.title,
          onClick: () => {
            if (action.type === "command") dispatchPluginCommand(contribution, action.command, pluginContributions)
            else if (action.type === "url") openPluginSurfaceUrl(action.url)
            else navigate(pluginSurfaceViewPath(directorySlug, contribution.pluginID, action.viewId))
          },
        })
      }
    }
    return items
  }

  const sidebarContent = (mobile?: boolean) => (
    <SidebarContent
      mobile={mobile}
      opened={() => true}
      renderPanel={() => (mobile ? <SidebarPanel mobile /> : <SidebarPanel merged />)}
    />
  )

  return (
    <div
      // 窗口根底色比面板暗（深色主题下比面板亮）一档，让四帧之间那 4px 外留白/间隙成为可视线，
      // 而不是和面板同色糊成一片。
      class="relative bg-background-win-alt flex-1 min-h-0 min-w-0 flex flex-col select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text"
      style={{
        ...modeStyle(),
        // 四帧同心圆：值由运行平台决定，桌面端由 Windows 5px / macOS 6px 收窄，
        // Web 与 Linux 保持 12px（= 现有 rounded-lg，因此 Web 观感不变）。
        "--workspace-panel-radius": `${workspacePanelRadiusPx(platform.os)}px`,
      }}
      data-app-mode={layout.mode.current() ?? "none"}
      data-workspace-panel-radius={workspacePanelRadiusPx(platform.os)}
      // 所有整帧页面只覆盖主工作区的内容区域；主页面 Header（包括唯一一组窗控）始终保留。
      // 页面自身从 Header 下方开始渲染，避免打开设置/扩展/数据库时再盖住主帧顶栏。
    >
      {autoselecting() ?? ""}
      {/* 主页面 Header 自己承载唯一的窗口控制按钮。打开设置、扩展市场、数据库等页面时，
          只覆盖 Header 下方的内容区域，不再额外绘制或遮挡另一组窗控。 */}
      <div class="flex-1 min-h-0 min-w-0 flex">
        <div class="flex-1 min-h-0 relative">
          <div class="size-full relative overflow-x-hidden">
            {/* 常驻 + 宽度过渡：收起时只把**右侧会话面板**宽度归 0（而不是整块卸载），
                折叠/展开才有动画；最左侧的图标条（logo + 数据库/知识库/…）始终在。
                宽度是布局量，不会像 transform 那样在动画期间移动元素边界。 */}
            <Show when={showSidebar()}>
              <nav
                aria-label={language.t("sidebar.nav.projectsAndSessions")}
                data-component="sidebar-nav-desktop"
                classList={{
                  "hidden xl:block": true,
                  "transition-[width] will-change-[width] motion-reduce:transition-none": true,
                  // 侧栏是 flush 的：不设边框与圆角，直接铺在窗口根色上（侧栏
                  // 不作为一个「帧」，4px 外留白只给右侧主工作区）。
                  "absolute inset-y-0 left-0": true,
                  "z-10": true,
                  "bg-sidebar overflow-hidden": true,
                }}
                style={{
                  width: `${side()}px`,
                  "--mode-accent": modeAccent(),
                  "transition-duration": "var(--transition-panel-ms, 1000ms)",
                  "transition-timing-function": "var(--transition-panel-ease, cubic-bezier(0.22, 1, 0.36, 1))",
                }}
              >
                <div class="flex h-full w-full min-w-0 overflow-hidden">
                  {/* 图标条不随折叠消失（对齐 Codex）：顶部是品牌 logo，下面是全局入口。
                      macOS 桌面端要给红绿灯让出竖向空间，否则 logo 会被压在按钮下面。 */}
                  <SidebarRail
                    class={isMacDesktop() ? "pt-9" : undefined}
                    header={
                      <Tooltip value={language.t("command.home.open")} placement="right" gutter={10}>
                        <button
                          type="button"
                          class="flex size-10 items-center justify-center rounded-[10px] text-foreground transition-colors hover:bg-hover"
                          onClick={() => navigate("/")}
                          aria-label={language.t("command.home.open")}
                          aria-current={!layout.mode.hasSelected() ? "page" : undefined}
                        >
                          <Show
                            when={appAppearance.iconData}
                            fallback={<Mark class="size-6 shrink-0 text-foreground" />}
                          >
                            {(src) => (
                              <img src={src()} alt="" class="size-6 shrink-0 object-contain" draggable={false} />
                            )}
                          </Show>
                        </button>
                      </Tooltip>
                    }
                    // 明暗切换不再单独占一个图标：它被收进最底部设置按钮弹出的「外观」
                    // 子面板（圆形扩散过渡一并移过去），窄条底部只留辅助对话与设置。
                    items={railItems()}
                    footer={railFooter()}
                    footerEnd={
                      <div class="flex flex-col items-center gap-1">
                        <ResourceMonitorButton />
                        <SettingsRailMenu
                          settingsOpen={state.settings.open}
                          onOpenSettings={() => command.trigger("settings.open")}
                        />
                      </div>
                    }
                  />
                  {/* 面板容器负责折叠动画：宽度 0 ↔ panel()。收起时同时 inert，
                      键盘和读屏不会钻进不可见的面板里。 */}
                  <div
                    data-component="sidebar-panel-slot"
                    class="@container relative h-full min-w-0 overflow-hidden transition-[width] will-change-[width] motion-reduce:transition-none"
                    style={{
                      width: layout.sidebar.expanded() ? `${panel()}px` : "0px",
                      "transition-duration": "var(--transition-panel-ms, 1000ms)",
                      "transition-timing-function": "var(--transition-panel-ease, cubic-bezier(0.22, 1, 0.36, 1))",
                    }}
                    aria-hidden={!layout.sidebar.expanded()}
                    inert={!layout.sidebar.expanded()}
                  >
                    <div class="h-full w-full contain-strict">{sidebarContent()}</div>
                  </div>
                </div>
              </nav>
            </Show>

            <Show when={showSidebar() && layout.sidebar.expanded()}>
              <div
                class="hidden xl:block absolute inset-y-1 z-30 w-0 overflow-visible"
                style={{ left: `${side() + 4}px` }}
                onPointerDown={() => setState("sizing", true)}
              >
                <ResizeHandle
                  direction="horizontal"
                  size={layout.sidebar.width()}
                  min={264}
                  max={typeof window === "undefined" ? 1000 : window.innerWidth * 0.5}
                  onResize={(w) => {
                    setState("sizing", true)
                    if (sizet !== undefined) clearTimeout(sizet)
                    sizet = window.setTimeout(() => setState("sizing", false), 120)
                    layout.sidebar.resize(w)
                  }}
                />
              </div>
            </Show>

            <Show when={showSidebar()}>
              <div class="xl:hidden">
                <div
                  classList={{
                    "fixed inset-x-0 top-0 bottom-0 z-40 transition-opacity duration-200": true,
                    "opacity-100 pointer-events-auto": layout.mobileSidebar.opened(),
                    "opacity-0 pointer-events-none": !layout.mobileSidebar.opened(),
                  }}
                  onClick={(e) => {
                    if (e.target === e.currentTarget) layout.mobileSidebar.hide()
                  }}
                />
                <nav
                  aria-label={language.t("sidebar.nav.projectsAndSessions")}
                  data-component="sidebar-nav-mobile"
                  classList={{
                    "@container fixed top-0 bottom-0 left-0 z-50 w-full max-w-[400px] overflow-hidden border-r border-border bg-background transition-transform duration-200 ease-out": true,
                    "translate-x-0": layout.mobileSidebar.opened(),
                    "-translate-x-full": !layout.mobileSidebar.opened(),
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {sidebarContent(true)}
                </nav>
              </div>
            </Show>

            <div
              classList={{
                "absolute inset-0": true,
                "xl:inset-y-1 xl:right-1 xl:left-[var(--main-left)]": true,
                "z-20": true,
                // 与侧栏宽度用同一个时长/缓动，两边才会同步（否则侧栏收完了主区还在滑）。
                "transition-[left] will-change-[left] motion-reduce:transition-none": !state.sizing,
              }}
              style={{
                // 侧栏现在是 flush 的（左/上/下贴边，见上面 nav 的注释），4px 间隙由会话侧自己的
                // `p-1` 提供，所以这里不能再加一次 4，否则间隙变成 8px。
                "--main-left": showSidebar() ? `${side()}px` : "0px",
                "--frame-page-right": framePageRight(),
                "--frame-page-bottom": framePageBottom(),
                "transition-duration": "var(--transition-panel-ms, 1000ms)",
                "transition-timing-function": "var(--transition-panel-ease, cubic-bezier(0.22, 1, 0.36, 1))",
              }}
            >
              {/* 展开入口已移进会话帧 Header（侧栏收起时展开按钮归 Header，
                  展开时收起入口归侧栏顶带）。原先浮在这里的那个 chevron 只有 24px，
                  还正好压在 Header 标题上，既难点中又遮住标题。 */}
              <main class="size-full overflow-x-hidden flex flex-col items-start min-w-0">
                <Show when={!autoselecting.loading} fallback={<div class="size-full" />}>
                  {props.children}
                </Show>
              </main>

              {/* 内容页面只覆盖主工作区的内容区域；会话 Header 和唯一的窗口控制按钮始终保留。 */}
              <Show when={settingsTransition.mounted()}>
                <section
                  data-panel-transition
                  data-state={settingsTransition.closing() ? "closed" : "open"}
                  class="absolute left-1 top-12 frame-page-panel z-50 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--workspace-panel-radius)] border border-border bg-background"
                  aria-label={language.t("command.settings.open")}
                  aria-hidden={settingsTransition.closing()}
                  inert={settingsTransition.closing()}
                >
                  {/* 内容面板从会话 Header 下方开始，主 Header 和唯一的窗控始终可见。 */}
                  <DialogSettings
                    initialTab={state.settings.initialTab}
                    directory={state.settings.directory}
                    onBack={closeSettings}
                  />
                </section>
              </Show>
              <Show when={knowledgeTransition.mounted()}>
                <section
                  data-panel-transition
                  data-state={knowledgeTransition.closing() ? "closed" : "open"}
                  class="absolute left-1 top-12 frame-page-panel z-50 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--workspace-panel-radius)] border border-border bg-background"
                  aria-label={language.t("sidebar.knowledge")}
                  aria-hidden={knowledgeTransition.closing()}
                  inert={knowledgeTransition.closing()}
                >
                  <div class="flex-1 min-h-0">
                    <KnowledgePage onBack={closeKnowledgePage} />
                  </div>
                </section>
              </Show>
              <Show when={automationTransition.mounted()}>
                <section
                  data-panel-transition
                  data-state={automationTransition.closing() ? "closed" : "open"}
                  class="absolute left-1 top-12 frame-page-panel z-50 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--workspace-panel-radius)] border border-border bg-background"
                  aria-label={language.t("sidebar.automation")}
                  aria-hidden={automationTransition.closing()}
                  inert={automationTransition.closing()}
                >
                  <div class="flex-1 min-h-0">
                    <AutomationPage onBack={closeAutomationPage} />
                  </div>
                </section>
              </Show>
              <Show when={extensionsTransition.mounted()}>
                <section
                  data-panel-transition
                  data-state={extensionsTransition.closing() ? "closed" : "open"}
                  class="absolute left-1 top-12 frame-page-panel z-50 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--workspace-panel-radius)] border border-border bg-background"
                  aria-label={language.t("sidebar.extensions")}
                  aria-hidden={extensionsTransition.closing()}
                  inert={extensionsTransition.closing()}
                >
                  <div class="flex-1 min-h-0">
                    <ExtensionsPage directory={currentDir()} onBack={closeExtensionsPage} />
                  </div>
                </section>
              </Show>
              <Show when={teamTransition.mounted()}>
                <section
                  data-panel-transition
                  data-state={teamTransition.closing() ? "closed" : "open"}
                  class="absolute left-1 top-12 frame-page-panel z-50 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--workspace-panel-radius)] border border-border bg-background"
                  aria-label={language.t("sidebar.team")}
                  aria-hidden={teamTransition.closing()}
                  inert={teamTransition.closing()}
                >
                  <div class="flex-1 min-h-0">
                    <TeamPage
                      directory={currentDir()}
                      onBack={closeTeamPage}
                      onManageAgents={() => openSettingsFromExtensions("agents")}
                      onOpenSession={(sessionID) => {
                        closeTeamPage()
                        if (params.dir) navigate(`/${params.dir}/session/${sessionID}`)
                      }}
                    />
                  </div>
                </section>
              </Show>
              <Show when={arenaTransition.mounted()}>
                <section
                  data-panel-transition
                  data-state={arenaTransition.closing() ? "closed" : "open"}
                  class="absolute left-1 top-12 frame-page-panel z-50 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--workspace-panel-radius)] border border-border bg-background"
                  aria-label={language.t("arena.title")}
                  aria-hidden={arenaTransition.closing()}
                  inert={arenaTransition.closing()}
                >
                  <div class="flex-1 min-h-0">
                    <ArenaPage
                      directory={currentDir()}
                      onBack={closeArenaPage}
                      onOpenSession={(sessionID) => {
                        closeArenaPage()
                        if (params.dir) navigate(`/${params.dir}/session/${sessionID}`)
                      }}
                    />
                  </div>
                </section>
              </Show>
              <Show when={pulseTransition.mounted()}>
                <section
                  data-panel-transition
                  data-state={pulseTransition.closing() ? "closed" : "open"}
                  class="absolute left-1 top-12 frame-page-panel z-50 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--workspace-panel-radius)] border border-border bg-background"
                  aria-label={language.t("pulse.workspace.title")}
                  aria-hidden={pulseTransition.closing()}
                  inert={pulseTransition.closing()}
                >
                  <div class="flex-1 min-h-0">
                    <PulseWorkspace onBack={closePulsePage} />
                  </div>
                </section>
              </Show>
              <Show when={databaseTransition.mounted()}>
                <section
                  data-panel-transition
                  data-state={databaseTransition.closing() ? "closed" : "open"}
                  class="absolute left-1 top-12 frame-page-panel z-50 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--workspace-panel-radius)] border border-border bg-background"
                  aria-label={language.t("command.database.open")}
                  aria-hidden={databaseTransition.closing()}
                  inert={databaseTransition.closing()}
                >
                  <DatabasePage onBack={closeDatabasePage} />
                </section>
              </Show>
            </div>
          </div>
        </div>
        {/* DebugBar removed */}
      </div>
      <Toast.Region />
      <ElicitationDialog directory={currentDir()} />
    </div>
  )
}
