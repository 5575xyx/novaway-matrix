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
import { FrameWindowControls } from "@/components/frame-window-controls"
import { createMountTransition } from "@/utils/mount-transition"
import { useGlobalSync } from "@/context/global-sync"
import { Persist, persisted } from "@/utils/persist"
import { base64Encode } from "@novaway/core/util/encode"
import { decode64 } from "@/utils/base64"
import { ResizeHandle } from "@novaway/ui/resize-handle"
import { Button } from "@novaway/ui/button"
import { IconButton } from "@novaway/ui/icon-button"
import { Icon } from "@novaway/ui/icon"
import { Keybind } from "@novaway/ui/keybind"
import { Mark } from "@novaway/ui/logo"
import { Tooltip, TooltipKeybind } from "@novaway/ui/tooltip"
import { Dialog } from "@novaway/ui/dialog"
import { TextField } from "@novaway/ui/text-field"
import { getFilename } from "@novaway/core/util/path"
import { Session, type Message, type QuestionRequest } from "@novaway/sdk/v2/client"
import { usePlatform } from "@/context/platform"
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
import { DialogSettings, type SettingsTab } from "@/components/dialog-settings"
import { applyPath, backPath, forwardPath, type TitlebarHistory } from "@/components/titlebar-history"
import { DatabasePage } from "@/pages/database"
import { useServer } from "@/context/server"
import { workspacePanelRadiusPx } from "@/utils/workspace-chrome"
import { useLanguage, type Locale } from "@/context/language"
import { pathKey } from "@/utils/path-key"
import { effectiveWorkspaceOrder, errorMessage, latestRootSession, sessionStatusOf, sortedRootSessions } from "./layout/helpers"
import {
  collectNewSessionDeepLinks,
  collectOpenProjectDeepLinks,
  deepLinkEvent,
  drainPendingDeepLinks,
} from "./layout/deep-links"
import { SidebarFiles } from "./layout/sidebar-files"
import { ProjectMenu, type ProjectSidebarContext } from "./layout/sidebar-project"
import { ModeSwitchButton } from "@/components/mode-switch"
import { SidebarMenuRow } from "@/components/sidebar-menu-row"
import { ThemeSchemeToggle } from "@/components/theme-scheme-toggle"
import { ProjectTaskList, TaskFilterBar, useArchivedSessions, useTaskCounts, type TaskFilter } from "./layout/sidebar-tasks"
import { SidebarContent } from "./layout/sidebar-shell"
import { ExtensionsPage } from "./extensions"
import { AutomationPage } from "./automation"

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
  const layoutReady = createMemo(() => layout.ready())
  const platform = usePlatform()
  const settings = useSettings()
  const server = useServer()
  const notification = useNotification()
  const permission = usePermission()
  const navigate = useNavigate()
  const location = useLocation()

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
  const modeStyle = createMemo(() => {
    const mode = layout.mode.all.find((item) => item.id === layout.mode.current())
    if (!mode) return {}
    return {
      "--novaway-mode-color": mode.color,
      "--novaway-mode-tint": `color-mix(in srgb, ${mode.color} 14%, transparent)`,
      "--novaway-mode-soft": `color-mix(in srgb, ${mode.color} 8%, transparent)`,
      "--novaway-mode-border": `color-mix(in srgb, ${mode.color} 38%, transparent)`,
    }
  })

  const [state, setState] = createStore({
    autoselect: !initialDirectory,
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

    sortNow: Date.now(),
    sizing: false,
  })

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
      () => {
        if (state.settings.open) setState("settings", "open", false)
        if (state.databasePage.open) setState("databasePage", "open", false)
        if (state.extensionsPage.open) setState("extensionsPage", "open", false)
        if (state.automationPage.open) setState("automationPage", "open", false)
      },
      { defer: true },
    ),
  )

  const extensionsTransition = createMountTransition(() => state.extensionsPage.open)

  // 窄窗口下侧栏是浮层（z-50、fixed），盖在上面会让覆盖层的返回按钮点不到。
  // 打开任何整帧页面时先把移动侧栏收起来。
  createEffect(() => {
    if (state.settings.open || state.databasePage.open || state.extensionsPage.open || state.automationPage.open) {
      layout.mobileSidebar.hide()
    }
  })
  const automationTransition = createMountTransition(() => state.automationPage.open)

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
    }    setState(
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
    const stop = () => setState("sizing", false)
    makeEventListener(window, "pointerup", stop)
    makeEventListener(window, "pointercancel", stop)
    makeEventListener(window, "blur", stop)
  })

  createEffect(() => {
    if (layout.sidebar.opened()) layout.sidebar.close()
  })

  createEffect(() => {
    if (!state.autoselect) return
    const dir = params.dir
    if (!dir) return
    const directory = decode64(dir)
    if (!directory) return
    setState("autoselect", false)
  })

  const clearSidebarHoverState = () => {}

  const navigateWithSidebarReset = (href: string) => {
    clearSidebarHoverState()
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

  const useUpdatePolling = () =>
    onMount(() => {
      if (!platform.checkUpdate || !platform.updateAndRestart) return

      let toastId: number | undefined
      let interval: ReturnType<typeof setInterval> | undefined

      // 更新提示可能来自两处:定时轮询(web/手动)与主进程的 download 完成推送(桌面端)。
      // 共用同一个 toastId,保证同一时刻只有一条提示。
      const showUpdate = (version?: string) => {
        if (toastId !== undefined) return
        toastId = showToast({
          persistent: true,
          icon: "download",
          title: language.t("toast.update.title"),
          description: language.t("toast.update.description", { version: version ?? "" }),
          actions: [
            {
              label: language.t("toast.update.action.installRestart"),
              onClick: async () => {
                await platform.updateAndRestart!()
              },
            },
            {
              label: language.t("toast.update.action.notYet"),
              onClick: "dismiss",
            },
          ],
        })
      }

      const pollUpdate = () =>
        platform.checkUpdate!().then(({ updateAvailable, version }) => {
          if (!updateAvailable) return
          showUpdate(version)
        })

      // 桌面端:主进程后台下载完成后主动推送(取代了老式原生 dialog)。这个推送早于
      // 这里的轮询,所以收到后立即提示,不必等下一次 checkUpdate。
      const disposeUpdateReady = platform.onUpdateReady?.((event) => {
        showUpdate(event.version)
      })

      createEffect(() => {
        if (!settings.ready()) return

        if (!settings.updates.startup()) {
          if (interval === undefined) return
          clearInterval(interval)
          interval = undefined
          return
        }

        if (interval !== undefined) return
        void pollUpdate()
        interval = setInterval(pollUpdate, 10 * 60 * 1000)
      })

      onCleanup(() => {
        disposeUpdateReady?.()
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
          if (e.details.type === "question.replied" && props.requestID) {
            void window.api?.resolveFloatingNotification?.({
              sessionID: props.sessionID,
              requestID: props.requestID,
              status: "replied",
            })
          }
          if (e.details.type === "question.rejected" && props.requestID) {
            void window.api?.resolveFloatingNotification?.({
              sessionID: props.sessionID,
              requestID: props.requestID,
              status: "dismissed",
            })
          }
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
        toastBySession.set(sessionKey, toastId)
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
        onSelect: () => openSettings(),
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
        onSelect: () => theme.commitPreview(),
        onHighlight: () => {
          theme.previewTheme(id)
          return () => theme.cancelPreview()
        },
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
        onSelect: () => theme.commitPreview(),
        onHighlight: () => {
          theme.previewColorScheme(scheme)
          return () => theme.cancelPreview()
        },
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
    batch(() => {
      setState("settings", "directory", directory)
      setState("settings", "initialTab", initialTab)
      setState("settings", "open", true)
    })
  }

  /**
   * 侧栏「辅助对话」入口（对齐 ZCode 在侧栏提供辅助对话入口的做法）：
   * 当前任务已有辅助对话就聚焦最近一条，否则新建一条；
   * 两种情况都会把右侧面板展开。
   */
  async function openSideChatFromSidebar() {
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
    setState("extensionsPage", "open", true)
  }

  function openAutomationPage() {
    setState("automationPage", "open", true)
  }

  function closeAutomationPage() {
    setState("automationPage", "open", false)
    window.dispatchEvent(new CustomEvent("novaway:overlay-closed"))
  }

  function closeExtensionsPage() {
    setState("extensionsPage", "open", false)
    window.dispatchEvent(new CustomEvent("novaway:overlay-closed"))
  }

  function openDatabasePage() {
    batch(() => {
      setState("databasePage", "open", true)
    })
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
      await refreshDirs(projectSession.directory)
      const opened = await openSession(projectSession)
      if (opened) return
      clearLastProjectSession(root)
    }

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

  onMount(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ urls: string[] }>).detail
      const urls = detail?.urls ?? []
      if (urls.length === 0) return
      handleDeepLinks(urls)
    }

    handleDeepLinks(drainPendingDeepLinks(window))
    makeEventListener(window, deepLinkEvent, handler as EventListener)
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
    const dismiss = () => toaster.dismiss(progress)

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

  const side = createMemo(() => {
    if (!layout.sidebar.expanded()) return 0
    // 下限对齐 ZCode 侧栏宽度规格（default = min = 264px）。
    return Math.max(layout.sidebar.width(), 264)
  })

  createEffect(() => {
    const dialogLeft = side() + 4
    document.documentElement.style.setProperty("--dialog-left-margin", `${dialogLeft}px`)
  })
  const panel = createMemo(() => side())

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
    const [taskFilter, setTaskFilter] = createSignal<TaskFilter>("all")
    const { archived, load: loadArchived } = useArchivedSessions(() => projectList())
    // 分段上的数量（全部 / 运行中 / 待确认 / 已归档）。归档列表要等它被拉起来才有数字，
    // 所以这里顺带触发一次加载 —— 否则"已归档"永远显示 0，看着像功能没接上。
    const taskCounts = useTaskCounts({ projects: () => projectList(), archived, sortNow })
    let archivedLoaded = false
    createEffect(() => {
      if (archivedLoaded || projectList().length === 0) return
      archivedLoaded = true
      loadArchived()
    })

    const treeKey = createMemo(() => pathKey(currentProject()?.worktree ?? currentDir()))
    // 文件树是侧栏内整层 slide-over 的目标目录：跟随当前项目（对齐 ZCode 的
    // WorkspaceFileTree —— 它挂在当前工作区上，不是每个项目各一份）。
    // 文件树的目标目录。
    // 之前只取「当前项目 → 路由目录」，两者都拿不到时整棵树就空着、且看不出原因
    // （实测桌面端在部分路由下 route().dir 为空，树直接不可用）。
    // 现在再退一层到「项目列表里的第一个」，保证只要打开了项目就有树可看。
    const treeDirectory = createMemo(() => {
      const direct = currentProject()?.worktree ?? currentDir()
      if (direct) return direct
      return projectList()[0]?.worktree ?? ""
    })
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
          width: panelProps.mobile ? undefined : `${panel()}px`,
          // 模式色统一挂在这一层：品牌字标（`Way` 上色）与顶部模式按钮都读它，
          // 不用各自再找一次当前模式。
          "--mode-accent": layout.mode.all.find((m) => m.id === layout.mode.current())?.color ?? "var(--border-hover)",
        }}
      >
        {/* 顶带：窗口拖拽区。桌面端没有全局标题栏之后，这里是窗口左上角的拖动把手；
            品牌标记兼作回首页入口（对齐 ZCode 左上角的品牌标识）。 */}
        <div
          data-component="sidebar-top-band"
          class="flex h-12 shrink-0 items-center gap-1 px-2"
          classList={{ "pl-[78px]": isMacDesktop() && !panelProps.mobile }}
          data-window-drag
        >
          <button
            type="button"
            class="flex h-8 min-w-0 shrink items-center gap-2 rounded-md px-1.5 text-foreground-subtle transition-colors hover:bg-hover"
            onClick={() => navigate("/")}
            aria-label={language.t("command.home.open")}
            title={language.t("command.home.open")}
            aria-current={!layout.mode.hasSelected() ? "page" : undefined}
          >
            <Mark class="size-5 shrink-0 text-foreground" />
            {/* 品牌字标：`Nova` 用前景色、`Way` 用当前模式色。
                比纯文本多一档识别度（用户要求"特殊格式"），同时顺带当作模式指示。 */}
            <span class="brand-wordmark text-ui-base truncate">Nova<span class="text-[var(--mode-accent)]">Way</span></span>
          </button>
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

        {/* 动作区：整宽「新建任务」+ 整宽「命令中心」。对齐 ZCode 侧栏顶部的两个整宽入口，
            取代原来那行把图标挤在一起的 icon-only 工具条。 */}
        <div class="flex shrink-0 flex-col gap-1 px-2 pb-2">
          {/* 模式切换从 footer 提到顶部：它是全局作用域最重的选择（决定整个工作台的能力面），
              沉在底部会被当成和「主题 / 设置」同级的小设置。这里用大字号 + 模式色底板呈现。 */}
          <ModeSwitchButton prominent onSelect={(mode) => layout.mode.select(mode.id)} />
          <Button
            variant="primary"
            size="large"
            class="w-full justify-start gap-2"
            icon="plus-small"
            aria-label={language.t("sidebar.newTask")}
            onClick={() => {
              const first = projectList()[0]
              if (first) navigateWithSidebarReset(`/${base64Encode(first.worktree)}/session`)
              else chooseProject()
            }}
          >
            {language.t("sidebar.newTask")}
          </Button>
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
          {/* 视图切换 + 打开项目：对齐 ZCode 侧栏任务行上方那排胶囊分段与右侧操作。
             分段用滑动指示器（ZCode TabsList 同款），不是两个各自变色的按钮。 */}
          <div class="flex items-center gap-1 pt-1">
            <div class="relative flex h-7 shrink-0 items-center rounded-full bg-surface p-0.5">
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
            {/* 「打开项目」保留；收起入口不在这里重复一份 —— 侧栏顶带已经有了，
                同屏两个「折叠工作区」是重复入口（用户反馈的正是这个）。 */}
            <div class="ml-auto flex shrink-0 items-center gap-0.5">
              <Tooltip value={language.t("command.project.open")} placement="bottom">
                <IconButton
                  icon="folder-add-left"
                  variant="ghost"
                  size="small"
                  aria-label={language.t("command.project.open")}
                  onClick={() => chooseProject()}
                />
              </Tooltip>
            </div>
          </div>
        </div>
        {/* 列表层与文件树层叠放：文件树是整层 slide-over（对齐 ZCode 的 WorkspaceFileTree），
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

            <Show
              when={projectList().length > 0}
              fallback={
                <div class="flex-1 min-h-0 flex items-center justify-center px-6 pb-64 text-center">
                  <div class="mt-8 flex max-w-60 flex-col items-center gap-4 text-center">
                    <div class="text-14-medium text-foreground">{language.t("sidebar.empty.title")}</div>
                    <div class="text-14-regular text-foreground">{language.t("sidebar.empty.description")}</div>
                    <Button size="large" icon="folder-add-left" onClick={chooseProject}>
                      {language.t("command.project.open")}
                    </Button>
                  </div>
                </div>
              }
            >
              <div class="flex-1 min-h-0 overflow-y-auto no-scrollbar px-2 pb-3 [overflow-anchor:none]">
                <For each={projectList()}>
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
                    // 项目名/文件夹图标入口打开该项目的文件树 slide-over（对齐 ZCode：文件树从侧栏滑入）。
                    const openTree = () => {
                      navigateToProject(proj.worktree)
                      layout.sidebarView.set("tree")
                    }
                    return (
                      <div class="mt-1">
                        <div
                          classList={{
                            "group flex items-center gap-1.5 px-2 py-1.5 rounded-md transition-colors hover:bg-hover": true,
                            "bg-selected": pathKey(proj.worktree) === treeKey(),
                          }}
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
                          <button
                            type="button"
                            class="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                            aria-label={language.t("sidebar.view.files")}
                            onClick={openTree}
                          >
                            <Icon name="folder" size="small" class="shrink-0 text-foreground-subtle" />
                            <Show when={layout.pinned.project(proj.worktree)}>
                              <Icon name="pin" size="small" class="shrink-0 text-foreground-subtlest" />
                            </Show>
                            <span class="text-ui-caption text-foreground font-medium truncate min-w-0">
                              {projectName()}
                            </span>
                            {/* 项目有多少任务：对齐 ZCode 分组头右侧那个圆角计数
                                （只用缩进不写数字的话，收起时完全看不出里面有东西）。 */}
                            <Show when={(projectTaskCount(proj) ?? 0) > 0}>
                              <span class="ml-auto shrink-0 rounded-full bg-surface px-1.5 py-0.5 text-ui-xs font-medium leading-none text-foreground-subtle tabular-nums">
                                {projectTaskCount(proj)}
                              </span>
                            </Show>
                            <span class="flex-1 min-w-0" />
                          </button>
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
                          <div class="flex flex-col gap-0.5">
                            <ProjectTaskList
                              project={proj}
                              sidebarExpanded={() => layout.sidebar.expanded()}
                              prefetchSession={prefetchSession}
                              archiveSession={archiveSession}
                              filter={taskFilter}
                              archived={projectArchived}
                              sortNow={sortNow}
                              pinned={layout.pinned.sessions}
                            />
                          </div>
                        </Show>
                      </div>
                    )
                  }}
                </For>
              </div>
            </Show>

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

            {/* 侧栏 footer：原来挤在顶部那圈竖排菜单里的入口，按 ZCode 的组织方式沉到底部。
                模式切换已提到顶部（它是全局能力面，不是小设置），这里只剩主题 / 数据库 / 设置。 */}
            <div class="shrink-0 border-t border-border p-2 flex flex-col gap-0.5">
              <ThemeSchemeToggle />
              <Show when={settings.general.showDatabase()}>
                <SidebarMenuRow
                  icon={<Icon name="database" size="small" />}
                  label={language.t("sidebar.database")}
                  onClick={() => command.trigger("database.open")}
                />
              </Show>
              <Show when={!!params.id}>
                <SidebarMenuRow
                  icon={<Icon name="speech-bubble" size="small" />}
                  label={language.t("sidebar.sideChat")}
                  onClick={openSideChatFromSidebar}
                />
              </Show>
              <SidebarMenuRow
                icon={<Icon name="autopilot" size="small" />}
                label={language.t("sidebar.automation")}
                onClick={openAutomationPage}
              />
              <SidebarMenuRow
                icon={<Icon name="dot-grid" size="small" />}
                label={language.t("sidebar.extensionsMarket")}
                onClick={openExtensionsPage}
              />
              <SidebarMenuRow
                icon={<Icon name="settings-gear" size="small" />}
                label={language.t("sidebar.settings")}
                onClick={() => command.trigger("settings.open")}
              />
            </div>
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
  const isPulseMode = createMemo(() => layout.mode.current() === "pulse")
  const showSidebar = createMemo(() => !isPulseMode())

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
      // 而不是和面板同色糊成一片。对应 ZCode 的 `bg-background-win-alt`。
      class="relative bg-background-win-alt flex-1 min-h-0 min-w-0 flex flex-col select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text"
      style={{
        ...modeStyle(),
        // 四帧同心圆：值由运行平台决定，桌面端由 Windows 5px / macOS 6px 收窄，
        // Web 与 Linux 保持 12px（= 现有 rounded-lg，因此 Web 观感不变）。
        "--workspace-panel-radius": `${workspacePanelRadiusPx(platform.os)}px`,
      }}
      data-app-mode={layout.mode.current() ?? "none"}
      data-workspace-panel-radius={workspacePanelRadiusPx(platform.os)}
      // 设置/数据库盖住主帧时，会话帧 Header 里那组窗控虽然被盖住，
      // 但淡入淡出的 1s 里会和面板自带的那组叠在一起"重影"。
      // 用这个标记把被盖住的那组藏掉（见 index.css）。
      data-frame-overlay={state.settings.open || state.databasePage.open || state.extensionsPage.open || state.automationPage.open ? "true" : undefined}
    >
      {autoselecting() ?? ""}
      {/* 全局标题栏已移除：窗口顶部不再有独立 chrome，身份/导航/操作分别落在
          侧栏顶带（品牌 + 收起）与会话帧内的 WorkspaceHeader（标题 + 操作）。 */}
      <div class="flex-1 min-h-0 min-w-0 flex">
        <div class="flex-1 min-h-0 relative">
          <div class="size-full relative overflow-x-hidden">
            {/* 常驻 + 宽度过渡：收起时宽度归 0（而不是整块卸载），这样折叠/展开才有动画。
                宽度是布局量，不会像 transform 那样在动画期间移动元素边界。 */}
            <Show when={showSidebar()}>
              <nav
                aria-label={language.t("sidebar.nav.projectsAndSessions")}
                data-component="sidebar-nav-desktop"
                aria-hidden={!layout.sidebar.expanded()}
                inert={!layout.sidebar.expanded()}
                classList={{
                  "hidden xl:block": true,
                  "transition-[width] will-change-[width] motion-reduce:transition-none": true,
                  // 侧栏是 flush 的：不设边框与圆角，直接铺在窗口根色上（对齐 ZCode —— 侧栏
                  // 不作为一个「帧」，4px 外留白只给右侧主工作区）。
                  "absolute inset-y-0 left-0": true,
                  "z-10": true,
                  "bg-sidebar overflow-hidden": true,
                }}
                style={{
                  width: `${side()}px`,
                  "transition-duration": "var(--transition-panel-ms, 1000ms)",
                  "transition-timing-function": "var(--transition-panel-ease, cubic-bezier(0.22, 1, 0.36, 1))",
                }}
              >
                <div class="@container w-full h-full contain-strict">{sidebarContent()}</div>
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
                "transition-duration": "var(--transition-panel-ms, 1000ms)",
                "transition-timing-function": "var(--transition-panel-ease, cubic-bezier(0.22, 1, 0.36, 1))",
              }}
            >
              {/* 展开入口已移进会话帧 Header（对齐 ZCode：侧栏收起时展开按钮归 Header，
                  展开时收起入口归侧栏顶带）。原先浮在这里的那个 chevron 只有 24px，
                  还正好压在 Header 标题上，既难点中又遮住标题。 */}
              <main class="size-full overflow-x-hidden flex flex-col items-start min-w-0">
                <Show when={!autoselecting.loading} fallback={<div class="size-full" />}>
                  {props.children}
                </Show>
              </main>

              {/* 设置 / 数据库是**主帧内的面板**，不是盖住整窗的接管层。
                  之前它们挂在窗口根上（`absolute inset-0` 相对整个 `.flex-1` 行），
                  一打开连左侧栏和窗口按钮一起盖掉，用户会觉得「进了设置就找不到主页面」，
                  返回入口也只剩一条小路可走。放进主帧后：
                  左栏与窗口顶带始终可见，四帧同心圆的 4px 留白/平台圆角也一并继承。 */}
              <Show when={settingsTransition.mounted()}>
                <section
                  data-panel-transition
                  data-state={settingsTransition.closing() ? "closed" : "open"}
                  class="absolute left-1 right-2 top-1 bottom-2 z-50 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--workspace-panel-radius)] border border-border bg-background"
                  aria-label={language.t("command.settings.open")}
                  aria-hidden={settingsTransition.closing()}
                  inert={settingsTransition.closing()}
                >
                  {/* 这一层盖住了会话帧 Header（窗口按钮在那），不补一组自绘窗控的话
                      窗口就不可拖、不可最小化/关闭了。 */}
                  <FrameWindowControls />
                  <DialogSettings
                    initialTab={state.settings.initialTab}
                    directory={state.settings.directory}
                    onBack={closeSettings}
                  />
                </section>
              </Show>
              <Show when={automationTransition.mounted()}>
                <section
                  data-panel-transition
                  data-state={automationTransition.closing() ? "closed" : "open"}
                  class="absolute left-1 right-2 top-1 bottom-2 z-50 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--workspace-panel-radius)] border border-border bg-background"
                  aria-label={language.t("sidebar.automation")}
                  aria-hidden={automationTransition.closing()}
                  inert={automationTransition.closing()}
                >
                  <FrameWindowControls />
                  <div class="flex-1 min-h-0">
                    <AutomationPage onBack={closeAutomationPage} />
                  </div>
                </section>
              </Show>
              <Show when={extensionsTransition.mounted()}>
                <section
                  data-panel-transition
                  data-state={extensionsTransition.closing() ? "closed" : "open"}
                  class="absolute left-1 right-2 top-1 bottom-2 z-50 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--workspace-panel-radius)] border border-border bg-background"
                  aria-label={language.t("sidebar.extensions")}
                  aria-hidden={extensionsTransition.closing()}
                  inert={extensionsTransition.closing()}
                >
                  <FrameWindowControls />
                  <div class="flex-1 min-h-0">
                    <ExtensionsPage onBack={closeExtensionsPage} />
                  </div>
                </section>
              </Show>
              <Show when={databaseTransition.mounted()}>
                <section
                  data-panel-transition
                  data-state={databaseTransition.closing() ? "closed" : "open"}
                  class="absolute left-1 right-2 top-1 bottom-2 z-50 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--workspace-panel-radius)] border border-border bg-background"
                  aria-label={language.t("command.database.open")}
                  aria-hidden={databaseTransition.closing()}
                  inert={databaseTransition.closing()}
                >
                  <FrameWindowControls />
                  <DatabasePage onBack={closeDatabasePage} />
                </section>
              </Show>
            </div>
          </div>
        </div>
        {/* DebugBar removed */}
      </div>
      <Toast.Region />
    </div>
  )
}
