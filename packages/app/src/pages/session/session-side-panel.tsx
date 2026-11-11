import { For, on, onCleanup, Show, Suspense, createEffect, createMemo, createSignal, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon } from "@novaway/ui/icon"
import { IconButton } from "@novaway/ui/icon-button"
import { showToast } from "@novaway/ui/toast"
import { ResizeHandle } from "@novaway/ui/resize-handle"
import { WindowControls } from "@/components/window-controls"
import { ContextMenu } from "@novaway/ui/context-menu"
import { DropdownMenu } from "@novaway/ui/dropdown-menu"
import { Tabs } from "@novaway/ui/tabs"
import {
  DragDropProvider,
  DragDropSensors,
  DragOverlay,
  SortableProvider,
  closestCenter,
  createSortable,
} from "@thisbeyond/solid-dnd"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import type { SnapshotFileDiff, VcsFileDiff } from "@novaway/sdk/v2"
import { getFilename } from "@novaway/core/util/path"
import { ConstrainDragYAxis, getDraggableId } from "@/utils/solid-dnd"
import { useDialog } from "@novaway/ui/context/dialog"
import { decodeFilePath, stripFileProtocol } from "@/context/file/path"
import { droppedPathsFromDataTransfer } from "@/pages/session/drop-to-open"

import { FileVisual } from "@/components/session"
import { useFile, type SelectedLineRange } from "@/context/file"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useSDK } from "@/context/sdk"
import {
  SIDE_PANE_TREE_MAX_WIDTH,
  SIDE_PANE_TREE_MIN_WIDTH,
  useLayout,
  type SidePaneSessionTab,
  type SidePaneSplitAxis,
  type SidePaneTab,
} from "@/context/layout"
import { createSessionTabs, getTabReorderIndex, type Sizing } from "@/pages/session/helpers"
import { confirmOfficeEditorClose } from "@/pages/session/office-editor-session"
import { FileTabContent } from "@/pages/session/file-tabs"
import { forgetTextHistory } from "@/pages/session/text-history"
import { PreviewPanel } from "@/pages/session/preview-panel"
import { SidePaneSessionPanel } from "@/pages/session/side-pane-session"
import { SidePaneBackgroundOutput } from "@/pages/session/side-pane-background"
import { useSideChat } from "@/pages/session/use-side-chat"
import { TerminalPanel } from "@/pages/session/terminal-panel"
import { setSessionHandoff } from "@/pages/session/handoff"
import { hijackLiveFollow } from "@/pages/session/live-follow"
import { useSessionLayout } from "@/pages/session/session-layout"
import { drainQueuedOpenFiles, queuedOpenFiles } from "@/pages/layout/open-files"
import { WorkspaceFileTree } from "@/pages/layout/workspace-file-tree"
import { isOfficePreviewPath } from "@/pages/session/office-preview-utils"

const sidePaneTabs: Array<{
  id: SidePaneTab
  icon: "folder" | "tree-structure" | "browser" | "terminal" | "review"
  labelKey: string
}> = [
  // 工作区文本文件与 Office 文件分开承载：Office 编辑器不带工作区文件树。
  { id: "preview", icon: "tree-structure", labelKey: "sidebar.tree.workspaceFiles" },
  { id: "office", icon: "tree-structure", labelKey: "sidePane.tab.office" },
  { id: "browser", icon: "browser", labelKey: "sidePane.tab.browser" },
  { id: "terminal", icon: "terminal", labelKey: "sidePane.tab.terminal" },
  { id: "review", icon: "review", labelKey: "sidePane.tab.review" },
]

const sidePaneTabMeta = (tab: string) => sidePaneTabs.find((item) => item.id === tab) ?? sidePaneTabs[0]
const workspaceOnlyTabs = new Set<SidePaneTab>(["preview", "office", "terminal", "review"])

/**
 * 动态标签（会话）的图标与标题。
 *
 * 内置标签读静态表；动态标签的标题来自它自己的元数据（`SidePaneSessionTab.title`），
 * 子代理显示子代理名、侧边对话显示"侧边对话 N"、后台任务显示任务名。图标也按 kind 分：
 * 子代理用 `task`（与工具行同一个图标，视觉上串得起来），侧边对话用 `speech-bubble`，
 * 后台任务输出用 `terminal`（大多是后台命令的输出流）。
 */
const SESSION_TAB_FALLBACK_KEY = {
  subagent: "sidePane.subagent",
  sideChat: "sidePane.sideChat",
  background: "sidePane.background.title",
} as const

function sessionTabPresentation(
  tab: SidePaneSessionTab,
  t: ReturnType<typeof useLanguage>["t"],
): { icon: "task" | "speech-bubble" | "terminal"; label: string } {
  return {
    icon: tab.kind === "subagent" ? "task" : tab.kind === "sideChat" ? "speech-bubble" : "terminal",
    label: tab.title || t(SESSION_TAB_FALLBACK_KEY[tab.kind]),
  }
}

export function SessionSidePanel(props: {
  workspaceAvailable: boolean
  canReview: () => boolean
  diffs: () => (SnapshotFileDiff | VcsFileDiff)[]
  diffsReady: () => boolean
  empty: () => string
  hasReview: () => boolean
  reviewCount: () => number
  reviewPanel: () => JSX.Element
  activeDiff?: string
  focusReviewDiff: (path: string) => void
  reviewSnap: boolean
  size: Sizing
  reservedWidth?: () => number
}) {
  const layout = useLayout()
  const file = useFile()
  const language = useLanguage()
  const platform = usePlatform()
  const sdk = useSDK()
  const dialog = useDialog()
  const { params, sessionKey, tabs } = useSessionLayout()

  /**
   * 切到另一条任务时，如果右侧正停着上一条任务的辅助对话，把那个标签收起来
   * （辅助对话属于某条主线，切走了就不该继续挂在眼前）。
   * 只收辅助对话标签本身：预览/终端/审查是用户自己开的工具面板，不能连坐 ——
   * 之前直接 close() 整个面板，会把正开着的预览一起带走。
   */
  createEffect(
    on(
      () => params.id,
      (id) => {
        const active = layout.sidePane.activeSessionTab()
        if (!active || active.kind !== "sideChat") return
        if ((id ?? "") === active.parentID) return
        layout.sidePane.closeSession(active.id)
      },
    ),
  )

  // TODO(status-panel): 原移动端任务列表折叠逻辑已随任务面板一并移除，待 Status Panel 接入后重接

  const normalizeTab = (tab: string) => {
    if (!tab.startsWith("file://")) return tab
    return file.tab(tab)
  }

  const tabState = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab,
    review: () => false,
    hasReview: props.canReview,
  })
  const openedTabs = tabState.openedTabs
  const activeFileTab = tabState.activeFileTab
  const filePathOfTab = (tab: string) => file.pathFromTab(tab)
  const isOfficeFileTab = (tab: string) => isOfficePreviewPath(filePathOfTab(tab))
  const workspaceFileTabs = createMemo(() => openedTabs().filter((tab) => !isOfficeFileTab(tab)))
  const officeFileTabs = createMemo(() => openedTabs().filter((tab) => isOfficeFileTab(tab)))
  const activeWorkspaceFileTab = createMemo(() => {
    const active = activeFileTab()
    if (active && !isOfficeFileTab(active)) return active
    return workspaceFileTabs().at(-1)
  })
  const activeOfficeFileTab = createMemo(() => {
    const active = activeFileTab()
    if (active && isOfficeFileTab(active)) return active
    return officeFileTabs().at(-1)
  })
  const hostForFileTab = (tab: string) => (isOfficeFileTab(tab) ? "office" : "preview")
  /** 顶层只显示宿主标签，具体文件标签放在下面一行。 */
  const builtinStripTabs = createMemo(() =>
    layout.sidePane.tabs().filter((item) => props.workspaceAvailable || !workspaceOnlyTabs.has(item)),
  )
  /**
   * 打开本地文件进右侧面板预览:桌面端拉起系统资源管理器(多选),
   * 选完逐个开文件标签;网页端(或原生对话框失败时)回落到内置的文件选择弹窗。
   * 桌面端支持项目目录外的文件(本地读写通道,当纯文件阅读器用);
   * 网页端没有本地通道,项目外文件读了也只会得到服务端越界报错,提前过滤并提示。
   */
  const openFileTab = (tab: string) => {
    void tabs().open(tab)
    tabs().setActive(tab)
    layout.sidePane.add(hostForFileTab(tab))
  }

  /** 新建一个文本类文件并直接打开：右侧面板从「看文件」变成「造文件」。 */
  const openNewFile = () => {
    void import("@/components/dialog-new-file").then((x) => {
      void dialog.show(() => (
        <x.DialogNewFile
          onCreate={(created) => {
            const tab = file.tab(created)
            openFileTab(tab)
          }}
        />
      ))
    })
  }

  /** 文件树拖出的是工作区相对路径；标签与项目边界都按绝对路径判断，这里先补齐。 */
  const toAbsolutePath = (path: string) => {
    if (!path || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("/") || path.startsWith("\\\\")) return path
    const separator = sdk.directory.includes("\\") ? "\\" : "/"
    return `${sdk.directory.replace(/[\\/]+$/, "")}${separator}${path}`
  }

  const openPaths = (input: string[]) => {
    const paths = input.map(toAbsolutePath)
    let accepted = paths
    if (!platform.readLocalFileText) {
      const root = sdk.directory.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()
      accepted = paths.filter((path) => {
        const normalized = path.replace(/\\/g, "/").toLowerCase()
        return normalized === root || normalized.startsWith(`${root}/`)
      })
      if (accepted.length < paths.length) {
        showToast({
          title: "部分文件不在当前项目目录内,无法预览",
          description: `网页端仅支持当前项目内的文件,已跳过 ${paths.length - accepted.length} 个。`,
        })
      }
    }
    for (const path of accepted) {
      openFileTab(file.tab(path))
    }
    if (accepted.length > 0) layout.sidePane.open()
  }

  /**
   * 拖文件到右栏即打开：文件树拖出的是 `file:相对路径`（text/plain）
   * 与 `file://URL`（text/uri-list）；系统拖入的是真实文件对象（dataTransfer.files）。
   * 解析收敛成路径数组的逻辑在 drop-to-open.ts（纯函数，可单测），这里只负责解码
   * （`file://` 路径是 URL 编码的，要 decode 回普通路径）与交给 openPaths 打开。
   * 项目内路径直接开标签，项目外路径桌面端走本地读取通道，网页端由 openPaths 过滤并提示。
   * 用原生 DOM 事件（不是 solid-dnd 的合成 DragEvent，那个没有 dataTransfer）。
   */
  const previewDragOver = (event: globalThis.DragEvent) => {
    if (!event.dataTransfer) return
    // 只对「能开成文件」的拖拽给出可放下反馈，其余保持默认。
    const types = Array.from(event.dataTransfer.types)
    const actionable = types.includes("Files") || types.includes("text/plain") || types.includes("text/uri-list")
    if (!actionable) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"
  }

  const previewDrop = (event: globalThis.DragEvent) => {
    // 落在预览区就只归预览处理：否则 document 上的输入区 drop 监听会再收一次，
    // 同一个文件既开标签又变成输入框附件。
    event.stopPropagation()
    const paths = droppedPathsFromDataTransfer(event.dataTransfer)
      .map((path) => stripFileProtocol(decodeFilePath(path)))
      .filter(Boolean)
    if (paths.length === 0) return
    event.preventDefault()
    openPaths(paths)
  }

  /**
   * 从系统打开的文档（Finder / 资源管理器 / 命令行带文件启动）：布局层已经
   * 把路径排进队列并导航到文件所在项目，这里在任务页挂载后（或新文件进来时）
   * 把它们开成右侧文件标签。队列是响应式的，所以已经停在任务页时也能立刻收到。
   */
  createEffect(() => {
    if (queuedOpenFiles().length === 0) return
    const paths = drainQueuedOpenFiles()
    if (paths.length > 0) openPaths(paths)
  })

  const openFilesFromPicker = () => {
    const showInAppDialog = () => {
      void import("@/components/dialog-select-file").then((x) => {
        void dialog.show(() => <x.DialogSelectFile mode="files" />)
      })
    }
    if (!platform.openFilePickerDialog) {
      showInAppDialog()
      return
    }
    void platform
      .openFilePickerDialog({ title: language.t("command.file.open"), multiple: true })
      .then((picked) => {
        openPaths(Array.isArray(picked) ? picked : picked ? [picked] : [])
      })
      .catch(showInAppDialog)
  }
  /**
   * 关掉最后一个文件标签后,「文件」区就没有内容了。只切到**已经开着**的标签
   * (比如浏览器本来就开着,就聚焦它);绝不凭空新开一个浏览器标签 ——
   * 之前 `add("browser")` 会凭空造出新标签,用户看着就像"关个文件怎么把浏览器打开了"。
   * 没有别的标签就把「文件」区从面板里摘掉:reducer 会激活邻居标签,
   * 面板里没别的标签时整个收起。只在「从有到无」时触发。
   */
  createEffect(
    on(
      () => openedTabs().length,
      (count, previous) => {
        if (count === 0) {
          if (!previous || !layout.sidePane.opened()) return
        }
        const active = layout.sidePane.activeTab()
        if (active !== "preview" && active !== "office") return
        const remaining = active === "office" ? officeFileTabs().length : workspaceFileTabs().length
        if (remaining > 0) return
        // Office 宿主关闭后不能把上一次工作区文件树的打开状态带回来。
        // 只有仍有普通工作区文件时，才保留 preview 宿主和文件树。
        if (active === "office" && workspaceFileTabs().length === 0) {
          layout.sidePane.setTree(false)
        }
        if (active === "preview" && workspaceFileTabs().length === 0) {
          layout.sidePane.setTree(false)
        }
        if (layout.sidePane.tabs().includes("browser")) {
          layout.sidePane.setActive("browser")
          return
        }
        layout.sidePane.remove(active)
      },
    ),
  )

  /**
   * 关掉最后一个标签后把整个右栏收起来。
   *
   * 之前只有「文件标签关完」那一条分支，用户关掉最后一个内置标签（浏览器/终端/审查）
   * 后右栏会留一块空白面板，还得再点一次折叠按钮。这里按「标签总数从有到无」统一处理：
   * 内置标签与动态会话标签都算内容，都清空了就自动收起。
   *
   * 只在**从有到无**时触发：面板本来就是空的（用户手动点开还没选工具），
   * 不能立刻把它关掉。
   */
  let tabContentCount = layout.sidePane.tabs().length + (layout.sidePane.activeSessionTab() ? 1 : 0)
  createEffect(() => {
    const count = layout.sidePane.tabs().length + (layout.sidePane.activeSessionTab() ? 1 : 0)
    const previous = tabContentCount
    tabContentCount = count
    if (count > 0 || previous === 0) return
    if (!layout.sidePane.opened()) return
    layout.sidePane.close()
  })

  const [store, setStore] = createStore({
    activeSidePaneDraggable: undefined as string | undefined,
  })

  createEffect(() => {
    if (!file.ready()) return

    setSessionHandoff(sessionKey(), {
      files: tabs()
        .all()
        .reduce<Record<string, SelectedLineRange | null>>((acc, tab) => {
          const path = file.pathFromTab(tab)
          if (!path) return acc

          const selected = file.selectedLines(path)
          acc[path] =
            selected && typeof selected === "object" && "start" in selected && "end" in selected
              ? (selected as SelectedLineRange)
              : null

          return acc
        }, {}),
    })
  })

  // 右栏当前内容标识：标签 + 具体文件/会话。内容一变就重播一次淡入动画。
  const contentKey = createMemo(() => {
    const active = layout.sidePane.activeTab() ?? ""
    if (active === "preview") return `preview:${activeWorkspaceFileTab() ?? ""}`
    if (active === "office") return `office:${activeOfficeFileTab() ?? ""}`
    return `${active}:${layout.sidePane.activeSessionTab()?.id ?? ""}`
  })

  const tab = layout.sidePane.activeTab
  const secondary = layout.sidePane.secondary
  /** 主窗格真正要渲染的标签：文件宿主展开成当前选中的对应文件。 */
  const primaryTab = () => {
    if (tab() === "preview") return activeWorkspaceFileTab()
    if (tab() === "office") return activeOfficeFileTab()
    return tab()
  }

  // 工作区文件与 Office 各自保留最后一个活动文件，切换顶层宿主时恢复对应标签。
  createEffect(() => {
    const host = tab()
    const candidate =
      host === "office" ? activeOfficeFileTab() : host === "preview" ? activeWorkspaceFileTab() : undefined
    if ((host === "office" || host === "preview") && candidate && activeFileTab() !== candidate) {
      tabs().setActive(candidate)
    }
  })
  const sessionTabOf = (id: string | null) => (id ? layout.sidePane.dynamicTabs()[id] : undefined)

  const renderSessionTab = (session: SidePaneSessionTab) =>
    session.kind === "background" ? <SidePaneBackgroundOutput tab={session} /> : <SidePaneSessionPanel tab={session} />

  /**
   * 「工作区文件」面板左侧的文件树：与内容并排，点树里的文件只换内容、
   * 不切走标签；中间的分割线可拖动调宽（宽度写回持久化）。树本身常驻在 DOM，
   * 只过渡宽度、透明度和位移，展开/折叠才会有抽屉式动画。
   */
  const fileTreePane = () => (
    <div
      data-component="side-pane-file-tree"
      aria-hidden={!layout.sidePane.tree()}
      inert={!layout.sidePane.tree()}
      class="relative flex min-h-0 shrink-0 overflow-hidden border-border transition-[width,opacity,transform,border-width] duration-300 ease-out motion-reduce:transition-none"
      classList={{
        "translate-x-0 opacity-100 border-r": layout.sidePane.tree(),
        "-translate-x-3 opacity-0 border-r-0": !layout.sidePane.tree(),
      }}
      style={{ width: `${layout.sidePane.tree() ? layout.sidePane.treeWidth() : 0}px` }}
    >
      <div class="relative flex h-full min-h-0 w-full min-w-0 flex-col">
        <WorkspaceFileTree
          directory={sdk.directory}
          sessionKey={sessionKey}
          onCollapse={() => layout.sidePane.setTree(false)}
        />
        <Show when={layout.sidePane.tree()}>
          <ResizeHandle
            direction="horizontal"
            edge="end"
            size={layout.sidePane.treeWidth()}
            min={SIDE_PANE_TREE_MIN_WIDTH}
            max={SIDE_PANE_TREE_MAX_WIDTH}
            onResize={(next) => layout.sidePane.resizeTree(next)}
          />
        </Show>
      </div>
    </div>
  )

  const emptyPane = () => (
    <div class="flex h-full min-h-0">
      {fileTreePane()}
      <Show
        when={layout.sidePane.tree() && layout.sidePane.activeTab() === "preview"}
        fallback={
          <SidePaneEmptyState
            workspaceAvailable={props.workspaceAvailable}
            onOpenFiles={openFilesFromPicker}
            onToggleTree={() => {
              layout.sidePane.setTree(true)
              layout.sidePane.add("preview")
              layout.sidePane.open()
            }}
          />
        }
      >
        {emptyPreviewPane()}
      </Show>
    </div>
  )

  const emptyPreviewPane = () => (
    <div class="flex h-full min-h-0 flex-1 items-center justify-center px-6 text-center">
      <div class="flex max-w-sm flex-col gap-2">
        <div class="text-ui-xl font-semibold text-foreground">{language.t("sidePane.preview.emptyTitle")}</div>
        <div class="text-ui-sm leading-5 text-foreground-subtle">{language.t("sidePane.preview.emptyDescription")}</div>
      </div>
    </div>
  )

  /** 一个窗格的内容：文件、内置面板、会话标签共用同一条渲染路径。 */
  const renderPane = (id: string | null | undefined, withTree = true): JSX.Element => {
    if (!id) {
      // 没开文件时保留隐藏的树容器，首次展开也能播放抽屉动画；
      // 工作区树入口与空预览/空态由 emptyPane 统一切换。
      return emptyPane()
    }
    // 文件本身已是顶层标签，这里只渲染内容，没有第二层标签条。
    // FileTabContent 内部是 Tabs.Content，必须包一层 Tabs 提供上下文（不带标签条）。
    if (file.pathFromTab(id)) {
      return (
        <div class="flex h-full min-h-0">
          {withTree && !isOfficeFileTab(id) && fileTreePane()}
          <div class="min-w-0 flex-1">
            <Tabs value={id} onChange={(value) => tabs().setActive(value)} class="h-full min-h-0 flex flex-col">
              {/* 文件预览里的资源（office base64/文本读取）挂起时就地兜住，
                  否则会被会话页外层的 Suspense 接住，把整个聊天区一起闪成空白。 */}
              <Suspense fallback={null}>
                <FileTabContent tab={id} />
              </Suspense>
            </Tabs>
          </div>
        </div>
      )
    }
    if (id === "browser") {
      return <PreviewPanel files={{ count: () => openedTabs().length, open: () => layout.sidePane.add("preview") }} />
    }
    if (id === "terminal") return <TerminalPanel variant="pane" />
    if (id === "review") return props.reviewPanel()
    const session = sessionTabOf(id)
    if (session) return renderSessionTab(session)
    return emptyPane()
  }

  // 关掉文件标签后，如果分屏里正放着它，分屏也一起收掉（不留一扇空窗格）。
  createEffect(() => {
    const pane = secondary()
    if (!pane) return
    if (!file.pathFromTab(pane.tab)) return
    if (tabs().all().includes(pane.tab)) return
    layout.sidePane.closeSecondary()
  })

  // ⌘⌥→ / ⌘⌥↓ / ⌘⌥W 注册成了命令（见 use-session-commands 的 viewCmds），
  // 快捷键由命令系统统一分发，用户也能在设置里改。

  // 关闭时宽度归 0（而不是卸载面板）：「常驻 + 过渡宽度」，
  // 这样展开/收起才有真正的动画，而且宽度是布局量，不会像 transform 那样在动画期间
  // 移动元素边界、破坏「面板之间恒为 4px」的几何契约。
  const open = () => layout.sidePane.opened()
  const width = () =>
    open()
      ? Math.min(layout.sidePane.width(), Math.round((typeof window === "undefined" ? 1000 : window.innerWidth) * 0.6))
      : 0

  const sidePaneDragStart = (event: unknown) => {
    const id = getDraggableId(event)
    if (!id) return
    setStore("activeSidePaneDraggable", id)
  }

  const sidePaneDragOver = (event: DragEvent) => {
    const { draggable, droppable } = event
    if (!draggable || !droppable) return

    const current = layout.sidePane.tabs()
    const from = draggable.id.toString()
    const fromIndex = current.findIndex((item) => item === from)
    const toIndex = getTabReorderIndex(current, from, droppable.id.toString())
    if (fromIndex === -1 || toIndex === undefined) return
    layout.sidePane.move(fromIndex, toIndex)
  }

  const sidePaneDragEnd = () => {
    setStore("activeSidePaneDraggable", undefined)
  }

  const renderFileTab = (fileTab: string) => (
    <SidePaneFileTabTrigger
      tab={fileTab}
      active={tab() === hostForFileTab(fileTab) && activeFileTab() === fileTab}
      onSelect={() => {
        tabs().setActive(fileTab)
        const host = hostForFileTab(fileTab)
        if (layout.sidePane.tabs().includes(host)) layout.sidePane.setActive(host)
        else layout.sidePane.add(host)
      }}
      onClose={() => {
        void (async () => {
          const closed = file.pathFromTab(fileTab)
          if (!(await confirmOfficeEditorClose(closed))) return
          if (closed) forgetTextHistory(closed)
          tabs().close(fileTab)
        })()
      }}
      onOpenRight={() => layout.sidePane.openSecondary(fileTab, "right")}
      onOpenBelow={() => layout.sidePane.openSecondary(fileTab, "below")}
      onCloseOthers={() => {
        void (async () => {
          const others = openedTabs().filter((other) => other !== fileTab)
          for (const other of others) {
            if (!(await confirmOfficeEditorClose(file.pathFromTab(other)))) return
          }
          for (const other of others) {
            const closed = file.pathFromTab(other)
            if (closed) forgetTextHistory(closed)
            tabs().close(other)
          }
        })()
      }}
    />
  )

  return (
    <aside
      id="side-pane"
      aria-label={language.t("session.panel.reviewAndFiles")}
      aria-hidden={!open()}
      inert={!open()}
      // 用户碰面板（点标签/拖宽度/在预览里选字）= 接管：实时跟随立刻让位，
      // 不再自动切换文件，这一轮结束时也不会替用户把面板收起来（见 live-follow.ts）。
      onPointerDown={() => hijackLiveFollow()}
      class="relative shrink-0 h-full flex flex-col rounded-[var(--workspace-panel-radius)] border border-border bg-background overflow-hidden"
      classList={{
        // 边框宽度也要过渡：收起时 border-width 归 0，只过渡 width 的话 1px 边框会瞬移。
        "transition-[width,border-width] will-change-[width] motion-reduce:transition-none": true,
      }}
      style={{
        width: `${width()}px`,
        // 收起时连边框一起删掉：只把颜色设透明的话 1px 边框还在，
        // 面板「宽度 0」实测会剩 2px（左右边框），动画收不到底、还会留一条竖线。
        "border-width": open() ? undefined : "0px",
        "transition-duration": "var(--transition-panel-ms, 1000ms)",
        "transition-timing-function": "var(--transition-panel-ease, cubic-bezier(0.22, 1, 0.36, 1))",
      }}
      data-component="side-pane-frame"
      data-open={open() ? "true" : "false"}
    >
      <ResizeHandle
        direction="horizontal"
        edge="start"
        size={layout.sidePane.width()}
        min={320}
        max={typeof window === "undefined" ? 1000 : window.innerWidth * 0.6}
        onResize={(next) => layout.sidePane.resize(next)}
      />
      <div class="side-pane-body flex items-center gap-0.5 h-9 px-1.5 border-b border-border shrink-0">
        <DragDropProvider
          onDragStart={sidePaneDragStart}
          onDragOver={sidePaneDragOver}
          onDragEnd={sidePaneDragEnd}
          collisionDetector={closestCenter}
        >
          <DragDropSensors />
          <ConstrainDragYAxis />
          <div class="flex items-center gap-0.5 flex-1 min-w-0 overflow-x-auto no-scrollbar">
            <SortableProvider ids={builtinStripTabs()}>
              <For each={builtinStripTabs()}>
                {(item) => <SidePaneTabTrigger tab={item} workspaceAvailable={props.workspaceAvailable} />}
              </For>
            </SortableProvider>
          </div>
          <DragOverlay>
            <Show when={store.activeSidePaneDraggable} keyed>
              {(dragged) => (
                <div class="flex items-center gap-1 px-2 h-7 rounded-md bg-surface text-ui-xs text-foreground">
                  <Icon name={sidePaneTabMeta(dragged).icon} size="small" class="shrink-0" />
                  {language.t(sidePaneTabMeta(dragged).labelKey)}
                </div>
              )}
            </Show>
          </DragOverlay>
        </DragDropProvider>
        {/* 「+」新增面板标签:列出内置面板与辅助对话。 */}
        <SidePaneAddTabMenu onCreateFile={openNewFile} workspaceAvailable={props.workspaceAvailable} />
        <IconButton
          icon="layout-right"
          variant="ghost"
          size="small"
          aria-label={language.t("sidePane.collapse")}
          aria-expanded={layout.sidePane.opened()}
          title={language.t("sidePane.collapse")}
          class="shrink-0"
          onClick={() => layout.sidePane.toggle()}
        />
        {/* Side Pane 展开时它是最右侧面板，窗控归它（且必须是本行最靠右的一组）。
            收起时面板宽度归 0（常驻不卸载），此时窗控必须一起撤掉：
            `aside` 的宽度是 0，子元素却仍然按内容宽度布局并溢出到窗口右侧之外，
            在 DOM 里留下一组「看不见但存在」的按钮。 */}
        <Show when={open()}>
          <WindowControls />
        </Show>
      </div>
      <Show
        when={
          (tab() === "preview" && workspaceFileTabs().length > 0) || (tab() === "office" && officeFileTabs().length > 0)
        }
      >
        <div class="side-pane-body flex h-9 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border px-1.5">
          <For each={tab() === "office" ? officeFileTabs() : workspaceFileTabs()}>{renderFileTab}</For>
        </div>
      </Show>
      <Show
        when={builtinStripTabs().length > 0}
        fallback={
          <div class="flex min-h-0 flex-1">
            <Show when={props.workspaceAvailable}>{fileTreePane()}</Show>
            <SidePaneEmptyState
              workspaceAvailable={props.workspaceAvailable}
              onOpenFiles={openFilesFromPicker}
              onToggleTree={() => {
                layout.sidePane.setTree(true)
                layout.sidePane.add("preview")
                layout.sidePane.open()
              }}
            />
          </div>
        }
      >
        <div
          class="side-pane-body flex flex-1 min-h-0 overflow-hidden"
          classList={{
            "flex-col": secondary()?.axis === "below",
            "flex-row": secondary()?.axis === "right",
          }}
          data-action="side-pane-drop-target"
          onDragOver={previewDragOver}
          onDrop={previewDrop}
        >
          {/* 切换标签/文件时给内容一个淡入 + 轻微位移。
              面板宽度本身有 320ms 过渡，但"面板已经开着、只是换内容"（比如从聊天里
              点开一个办公产物）时宽度不变，内容如果直接替换就是"啪一下"，看不出过渡。
              用 keyed Show 让每个内容键单独挂载一次，动画才会重新播放。 */}
          <Show when={contentKey()} keyed>
            {(_key) => (
              <div
                class="side-pane-content min-h-0 min-w-0 flex flex-col"
                classList={{ "flex-1": !secondary() }}
                style={secondary() ? { flex: `${1 - secondary()!.ratio} 1 0%` } : undefined}
              >
                {renderPane(primaryTab())}
              </div>
            )}
          </Show>
          {/* 分屏：次要窗格。
              主窗格与次要窗格是两个真窗格：各自独立选标签、独立滚动，
              中间的 5px 分割线可拖动改比例，双击收起分屏。 */}
          <Show when={secondary()}>
            {(pane) => (
              <>
                <SidePaneDivider
                  axis={pane().axis}
                  onRatio={(ratio) => layout.sidePane.setSecondaryRatio(ratio)}
                  onClose={() => layout.sidePane.closeSecondary()}
                />
                <div class="side-pane-content min-h-0 min-w-0 flex flex-col" style={{ flex: `${pane().ratio} 1 0%` }}>
                  <Show when={`secondary:${pane().tab}`} keyed>
                    {(id) => renderPane(id.slice("secondary:".length), false)}
                  </Show>
                </div>
              </>
            )}
          </Show>
        </div>
      </Show>
    </aside>
  )
}

/**
 * 分屏分割线：横向分屏时是竖线、上下分屏时是横线。
 * 拖动按容器矩形换算比例（右/下窗格占多少），双击收起分屏。
 */
function SidePaneDivider(props: { axis: SidePaneSplitAxis; onRatio: (ratio: number) => void; onClose: () => void }) {
  const language = useLanguage()
  const [dragging, setDragging] = createSignal(false)
  let el: HTMLDivElement | undefined
  let endDrag: (() => void) | undefined
  onCleanup(() => endDrag?.())

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return
    const host = el?.parentElement
    if (!host) return
    event.preventDefault()
    const rect = host.getBoundingClientRect()
    setDragging(true)
    const move = (moveEvent: PointerEvent) => {
      // 次要窗格在右/下，所以分割线往左/上拖 = 次要窗格变大。
      const ratio =
        props.axis === "below"
          ? (rect.bottom - moveEvent.clientY) / rect.height
          : (rect.right - moveEvent.clientX) / rect.width
      props.onRatio(ratio)
    }
    const up = () => {
      endDrag = undefined
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      setDragging(false)
    }
    endDrag = up
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }

  return (
    <div
      ref={el}
      role="separator"
      data-component="side-pane-split-divider"
      aria-orientation={props.axis === "below" ? "horizontal" : "vertical"}
      title={language.t("sidePane.split.resize")}
      class="group relative z-10 shrink-0 touch-none select-none"
      classList={{
        "w-[5px] cursor-col-resize": props.axis === "right",
        "h-[5px] cursor-row-resize": props.axis === "below",
        "bg-icon-blue/20": dragging(),
      }}
      onPointerDown={onPointerDown}
      onDblClick={props.onClose}
    >
      <div
        class="absolute bg-border transition-colors group-hover:bg-icon-blue"
        classList={{
          "left-1/2 top-0 h-full w-px -translate-x-1/2": props.axis === "right",
          "left-0 top-1/2 h-px w-full -translate-y-1/2": props.axis === "below",
        }}
      />
    </div>
  )
}

/** 顶层标签条里的文件标签:图标 + 文件名 + 关闭按钮,点击激活该文件的预览。
 *  右键菜单:在右侧打开 / 在下方打开 / 关闭 / 关闭其他文件标签。 */
function SidePaneFileTabTrigger(props: {
  tab: string
  active: boolean
  onSelect: () => void
  onClose: () => void
  onOpenRight: () => void
  onOpenBelow: () => void
  onCloseOthers: () => void
}) {
  const language = useLanguage()
  const file = useFile()
  const path = () => file.pathFromTab(props.tab)
  const itemClass =
    "flex items-center gap-2 px-2 py-1.5 text-12-medium text-foreground rounded-md hover:bg-hover cursor-pointer outline-none"

  return (
    <ContextMenu>
      <div
        data-component="side-pane-file-tab"
        data-path={path()}
        class="flex max-w-[9.5rem] shrink-0 items-center gap-0.5 rounded-md"
        classList={{ "bg-surface": props.active }}
      >
        <ContextMenu.Trigger class="flex min-w-0 flex-1">
          <button
            type="button"
            class="flex h-7 w-full min-w-0 items-center gap-1 whitespace-nowrap rounded-md px-2 text-ui-xs text-foreground transition-colors"
            onClick={props.onSelect}
          >
            <Show when={path()} fallback={<Icon name="tree-structure" size="small" class="shrink-0" />}>
              {(p) => <FileVisual active={props.active} path={p()} />}
            </Show>
            <span class="min-w-0 flex-1 truncate">{path() ? getFilename(path()) : props.tab}</span>
          </button>
        </ContextMenu.Trigger>
        <IconButton
          icon="close-small"
          variant="ghost"
          size="small"
          class="h-5 w-5"
          aria-label={language.t("common.closeTab")}
          onClick={(event) => {
            event.stopPropagation()
            props.onClose()
          }}
        />
      </div>
      <ContextMenu.Portal>
        <ContextMenu.Content class="min-w-[190px] p-1 bg-surface border border-border rounded-lg shadow-lg z-50">
          <ContextMenu.Item class={itemClass} onSelect={props.onOpenRight}>
            <Icon name="layout-right-partial" size="small" />
            {language.t("sidePane.tab.openRight")}
          </ContextMenu.Item>
          <ContextMenu.Item class={itemClass} onSelect={props.onOpenBelow}>
            <Icon name="layout-bottom-partial" size="small" />
            {language.t("sidePane.tab.openBelow")}
          </ContextMenu.Item>
          <ContextMenu.Separator class="h-px bg-border my-1" />
          <ContextMenu.Item class={itemClass} onSelect={props.onClose}>
            <Icon name="close-small" size="small" />
            {language.t("common.closeTab")}
          </ContextMenu.Item>
          <ContextMenu.Item class={itemClass} onSelect={props.onCloseOthers}>
            <Icon name="close-small" size="small" />
            {language.t("sidePane.tab.closeOthers")}
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu>
  )
}

/** 「+」菜单:新增右侧面板标签(浏览器/终端/审查)或打开文件、开辅助对话。 */
function SidePaneAddTabMenu(props: { onCreateFile: () => void; workspaceAvailable: boolean }) {
  const layout = useLayout()
  const language = useLanguage()
  const sideChat = useSideChat()
  return (
    <DropdownMenu placement="bottom-end" gutter={4}>
      <DropdownMenu.Trigger
        as={IconButton}
        icon="plus-small"
        variant="ghost"
        size="small"
        class="shrink-0"
        aria-label={language.t("sidePane.addTab")}
      />
      <DropdownMenu.Portal>
        <DropdownMenu.Content style={{ "min-width": "140px" }}>
          <Show when={props.workspaceAvailable}>
            <DropdownMenu.Item class="flex items-center gap-2" onSelect={props.onCreateFile}>
              <Icon name="plus-small" size="small" />
              <DropdownMenu.ItemLabel>新建文件</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
          </Show>
          <For
            each={sidePaneTabs.filter(
              (item) => item.id !== "office" && (props.workspaceAvailable || !workspaceOnlyTabs.has(item.id)),
            )}
          >
            {(item) => (
              <DropdownMenu.Item
                class="flex items-center gap-2"
                onSelect={() => {
                  // 「工作区文件」是面板宿主：从 + 号进入时直接显示工作区树，
                  // 外部文件仍从空态里的「外部文件」入口打开。
                  if (item.id === "preview") {
                    layout.sidePane.setTree(true)
                    layout.sidePane.add("preview")
                    layout.sidePane.open()
                    return
                  }
                  layout.sidePane.add(item.id)
                  layout.sidePane.setActive(item.id)
                }}
              >
                <Icon name={item.icon} size="small" class="shrink-0 text-foreground-subtlest" />
                <DropdownMenu.ItemLabel>{language.t(item.labelKey)}</DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
            )}
          </For>
          <DropdownMenu.Separator />
          <DropdownMenu.Item class="flex items-center gap-2" onSelect={() => void sideChat.open()}>
            <Icon name="speech-bubble" size="small" class="shrink-0 text-foreground-subtlest" />
            <DropdownMenu.ItemLabel>{language.t("sidePane.sideChat.open")}</DropdownMenu.ItemLabel>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  )
}

function SidePaneTabTrigger(props: { tab: SidePaneTab; workspaceAvailable: boolean }) {
  const layout = useLayout()
  const language = useLanguage()
  const sideChat = useSideChat()
  const sortable = createSortable(props.tab)
  const session = () => layout.sidePane.dynamicTabs()[props.tab]
  const meta = () =>
    session() ? { icon: sessionTabPresentation(session()!, language.t).icon } : sidePaneTabMeta(props.tab)
  const label = () =>
    session() ? sessionTabPresentation(session()!, language.t).label : language.t(sidePaneTabMeta(props.tab).labelKey)
  const disabled = () => !props.workspaceAvailable && sidePaneTabs.some((item) => item.id === props.tab)
  return (
    <div
      use:sortable
      class="shrink-0"
      classList={{
        "opacity-0": sortable.isActiveDraggable,
        "flex items-center gap-0.5 rounded-md": true,
        "bg-surface": layout.sidePane.activeTab() === props.tab,
      }}
    >
      <button
        disabled={disabled()}
        title={disabled() ? language.t("sidebar.globalChat.title") : undefined}
        class="flex items-center gap-1 px-2 h-7 rounded-md text-ui-xs transition-colors whitespace-nowrap text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        onClick={() => layout.sidePane.setActive(props.tab)}
      >
        <Icon name={meta().icon} size="small" class="shrink-0" />
        <span class="max-w-[9rem] truncate">{label()}</span>
      </button>
      <IconButton
        icon="close-small"
        variant="ghost"
        size="small"
        class="h-5 w-5"
        aria-label={language.t("common.closeTab")}
        onClick={() => {
          const tab = session()
          // 侧边对话是"关掉即删除"；
          // 子代理的会话属于父任务，关面板只收标签、不删会话。
          if (tab?.kind === "sideChat") {
            void sideChat.close(tab)
            return
          }
          layout.sidePane.remove(props.tab)
        }}
      />
    </div>
  )
}

// 空态入口。规格：空间够时排成卡片网格（图标在上、标签居中、5.5rem 高），
// 空间不够时回落成 h-12 的横排行。
//
// 阈值放在 index.css 里（容器查询），取 340px 而不是 480px：
// side pane 默认固定 360px ——
// 沿用 480 会让默认宽度永远看不到卡片网格，也就是这次要修的问题本身。
function SidePaneEmptyState(props: { workspaceAvailable: boolean; onOpenFiles: () => void; onToggleTree: () => void }) {
  const layout = useLayout()
  const language = useLanguage()
  const sideChat = useSideChat()
  // 文件树并排时留给空态的宽度往往不到 200px，大标题会竖排；收起文案，只留可点的入口。
  const compact = () => layout.sidePane.tree()
  return (
    <div
      data-component="side-pane-empty"
      class="side-pane-launcher flex-1 min-h-0 overflow-y-auto flex items-center justify-center bg-[radial-gradient(circle_at_50%_38%,color-mix(in_srgb,var(--icon-blue)_8%,transparent),transparent_58%)]"
      classList={{ "px-5 py-10": !compact(), "px-2 py-3": compact() }}
    >
      <div
        class="side-pane-launcher-content flex w-full max-w-[20rem] flex-col gap-5"
        classList={{ "gap-2": compact() }}
      >
        <Show when={!compact()}>
          <div class="flex flex-col gap-2 text-center">
            <h2 class="text-ui-xl font-semibold text-foreground">{language.t("sidePane.empty.title")}</h2>
            <p class="text-ui-base leading-5 text-foreground-subtle">{language.t("sidePane.empty.description")}</p>
          </div>
        </Show>
        <div class="side-pane-launcher-list flex w-full flex-col gap-2">
          <Show when={props.workspaceAvailable}>
            <button
              type="button"
              data-component="side-pane-launcher-workspace-tree"
              class="side-pane-launcher-button group flex h-12 min-w-0 items-center gap-3 rounded-xl border border-border/70 bg-surface/70 px-3 text-ui-base font-medium text-foreground shadow-sm transition-[background-color,border-color,box-shadow,transform] hover:-translate-y-px hover:border-icon-blue/45 hover:bg-icon-blue/5 hover:shadow-md"
              onClick={props.onToggleTree}
            >
              <Icon name="tree-structure" size="small" class="shrink-0 text-icon-blue" />
              <span class="side-pane-launcher-label min-w-0 flex-1 truncate text-left">
                {language.t("sidebar.tree.workspaceFiles")}
              </span>
            </button>
          </Show>
          <button
            type="button"
            data-component="side-pane-launcher-external-files"
            class="side-pane-launcher-button group flex h-12 min-w-0 items-center gap-3 rounded-xl border border-border/70 bg-surface/70 px-3 text-ui-base font-medium text-foreground shadow-sm transition-[background-color,border-color,box-shadow,transform] hover:-translate-y-px hover:border-icon-blue/45 hover:bg-icon-blue/5 hover:shadow-md"
            onClick={props.onOpenFiles}
          >
            <Icon name="folder" size="small" class="shrink-0 text-foreground-subtlest" />
            <span class="side-pane-launcher-label min-w-0 flex-1 truncate text-left">
              {language.t("sidebar.tree.externalFiles")}
            </span>
          </button>
          <For
            each={sidePaneTabs.filter(
              (item) =>
                item.id !== "preview" &&
                item.id !== "office" &&
                (props.workspaceAvailable || !workspaceOnlyTabs.has(item.id)),
            )}
          >
            {(item) => (
              <button
                type="button"
                class="side-pane-launcher-button group flex h-12 min-w-0 items-center gap-3 rounded-xl border border-border/70 bg-surface/70 px-3 text-ui-base font-medium text-foreground shadow-sm transition-[background-color,border-color,box-shadow,transform] hover:-translate-y-px hover:border-icon-blue/45 hover:bg-icon-blue/5 hover:shadow-md"
                onClick={() => layout.sidePane.add(item.id)}
              >
                <Icon name={item.icon} size="small" class="shrink-0 text-foreground-subtlest" />
                <span class="side-pane-launcher-label min-w-0 flex-1 truncate text-left">
                  {language.t(item.labelKey)}
                </span>
              </button>
            )}
          </For>
          {/* 侧边对话：不打断主线的并行小对话。
              放在内置入口之后 —— 它是"额外开一条线"，不是面板的常规用法。 */}
          <button
            type="button"
            data-component="side-pane-launcher-side-chat"
            class="side-pane-launcher-button flex h-12 min-w-0 items-center gap-3 rounded-xl border border-dashed border-border px-3 text-ui-base font-medium text-foreground transition-colors hover:border-border-hover hover:bg-hover"
            onClick={() => void sideChat.open()}
          >
            <Icon name="speech-bubble" size="small" class="shrink-0 text-foreground-subtlest" />
            <span class="side-pane-launcher-label min-w-0 flex-1 truncate text-left">
              {language.t("sidePane.sideChat.open")}
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}
