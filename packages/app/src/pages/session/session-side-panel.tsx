import { For, on, Show, Suspense, createEffect, createMemo, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon } from "@novaway/ui/icon"
import { IconButton } from "@novaway/ui/icon-button"
import { showToast } from "@novaway/ui/toast"
import { ResizeHandle } from "@novaway/ui/resize-handle"
import { WindowControls } from "@/components/window-controls"
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

import { FileVisual } from "@/components/session"
import { useFile, type SelectedLineRange } from "@/context/file"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useSDK } from "@/context/sdk"
import { useLayout, type SidePaneSessionTab, type SidePaneTab } from "@/context/layout"
import { createSessionTabs, getTabReorderIndex, type Sizing } from "@/pages/session/helpers"
import { FileTabContent } from "@/pages/session/file-tabs"
import { PreviewPanel } from "@/pages/session/preview-panel"
import { SidePaneSessionPanel } from "@/pages/session/side-pane-session"
import { SidePaneBackgroundOutput } from "@/pages/session/side-pane-background"
import { useSideChat } from "@/pages/session/use-side-chat"
import { TerminalPanel } from "@/pages/session/terminal-panel"
import { setSessionHandoff } from "@/pages/session/handoff"
import { useSessionLayout } from "@/pages/session/session-layout"

const sidePaneTabs: Array<{
  id: SidePaneTab
  icon: "folder" | "browser" | "terminal" | "review"
  labelKey: string
}> = [
  // 对齐 ZCode：文件预览与网页预览（浏览器）是两个并列标签，
  // "preview" 只当文件标签条的宿主，URL iframe 归 "browser"。
  { id: "preview", icon: "folder", labelKey: "sidePane.tab.files" },
  { id: "browser", icon: "browser", labelKey: "sidePane.tab.browser" },
  { id: "terminal", icon: "terminal", labelKey: "sidePane.tab.terminal" },
  { id: "review", icon: "review", labelKey: "sidePane.tab.review" },
]

const sidePaneTabMeta = (tab: string) => sidePaneTabs.find((item) => item.id === tab) ?? sidePaneTabs[0]

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
   * （对齐 ZCode 的节奏：辅助对话属于某条主线，切走了就不该继续挂在眼前）。
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
  /** 顶层标签条里的内置/动态标签:「文件」宿主不单独出标签,文件本身就是标签。 */
  const builtinStripTabs = createMemo(() => layout.sidePane.tabs().filter((item) => item !== "preview"))
  /**
   * 打开本地文件进右侧面板预览:桌面端拉起系统资源管理器(多选),
   * 选完逐个开文件标签;网页端(或原生对话框失败时)回落到内置的文件选择弹窗。
   * 桌面端支持项目目录外的文件(本地读写通道,当纯文件阅读器用);
   * 网页端没有本地通道,项目外文件读了也只会得到服务端越界报错,提前过滤并提示。
   */
  const openFilesFromPicker = () => {
    const showInAppDialog = () => {
      void import("@/components/dialog-select-file").then((x) => {
        void dialog.show(() => <x.DialogSelectFile mode="files" />)
      })
    }
    const openPicked = (paths: string[]) => {
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
        const tab = file.tab(path)
        void tabs().open(tab)
        tabs().setActive(tab)
      }
      if (accepted.length > 0) layout.sidePane.add("preview")
    }
    if (!platform.openFilePickerDialog) {
      showInAppDialog()
      return
    }
    void platform
      .openFilePickerDialog({ title: language.t("command.file.open"), multiple: true })
      .then((picked) => {
        openPicked(Array.isArray(picked) ? picked : picked ? [picked] : [])
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
        if (count > 0) return
        if (!previous) return
        if (!layout.sidePane.opened()) return
        if (layout.sidePane.activeTab() !== "preview") return
        if (layout.sidePane.tabs().includes("browser")) {
          layout.sidePane.setActive("browser")
          return
        }
        layout.sidePane.remove("preview")
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
    if (active === "preview") return `preview:${activeFileTab() ?? ""}`
    return `${active}:${layout.sidePane.activeSessionTab()?.id ?? ""}`
  })

  const tab = layout.sidePane.activeTab
  // 关闭时宽度归 0（而不是卸载面板）：ZCode 的 AnimatedSidePanePanel 就是「常驻 + 过渡宽度」，
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

  return (
    <aside
      id="side-pane"
      aria-label={language.t("session.panel.reviewAndFiles")}
      aria-hidden={!open()}
      inert={!open()}
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
            {/* 文件即标签:每个打开的文件直接作为顶层标签与浏览器/终端/审查平铺同一层
                (对齐 ZCode 的单层 tab 条),不再有「文件区里又一层文件标签」。 */}
            <For each={openedTabs()}>
              {(fileTab) => (
                <SidePaneFileTabTrigger
                  tab={fileTab}
                  active={tab() === "preview" && activeFileTab() === fileTab}
                  onSelect={() => {
                    tabs().setActive(fileTab)
                    if (tab() !== "preview") {
                      if (layout.sidePane.tabs().includes("preview")) layout.sidePane.setActive("preview")
                      else layout.sidePane.add("preview")
                    }
                  }}
                  onClose={() => tabs().close(fileTab)}
                />
              )}
            </For>
            <SortableProvider ids={builtinStripTabs()}>
              <For each={builtinStripTabs()}>{(item) => <SidePaneTabTrigger tab={item} />}</For>
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
        {/* 「+」新增面板标签(对齐 ZCode 的 tab 栏 + 号):列出内置面板与辅助对话。 */}
        <SidePaneAddTabMenu onOpenFiles={openFilesFromPicker} />
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
        when={layout.sidePane.tabs().length > 0}
        fallback={<SidePaneEmptyState onOpenFiles={openFilesFromPicker} />}
      >
        <div class="side-pane-body flex-1 min-h-0 overflow-hidden">
          {/* 切换标签/文件时给内容一个淡入 + 轻微位移。
              面板宽度本身有 320ms 过渡，但"面板已经开着、只是换内容"（比如从聊天里
              点开一个办公产物）时宽度不变，内容如果直接替换就是"啪一下"，看不出过渡。
              用 keyed Show 让每个内容键单独挂载一次，动画才会重新播放。 */}
          <Show when={contentKey()} keyed>
            {(_key) => (
              <div class="side-pane-content h-full min-h-0 flex flex-col">
                {/* 文件:文件本身已是顶层标签,这里只渲染当前文件的内容,没有第二层标签条。
                  FileTabContent 内部是 Tabs.Content,必须包一层 Tabs 提供上下文(不带标签条)。 */}
                <Show when={tab() === "preview"}>
                  <Show
                    when={activeFileTab()}
                    keyed
                    fallback={<SidePaneEmptyState onOpenFiles={openFilesFromPicker} />}
                  >
                    {(t) => (
                      <Tabs
                        value={t}
                        onChange={(value) => tabs().setActive(value)}
                        class="h-full min-h-0 flex flex-col"
                      >
                        {/* 文件预览里的资源(office base64/文本读取)挂起时,没有这层边界会被
                          会话页外层的 Suspense 接住,把整个聊天区一起闪成空白。就地兜住,
                          挂起只影响这块内容。 */}
                        <Suspense fallback={null}>
                          <FileTabContent tab={t} />
                        </Suspense>
                      </Tabs>
                    )}
                  </Show>
                </Show>
                {/* 浏览器：URL iframe（网页预览 / 开发服务器），对齐 ZCode 的浏览器独立标签。 */}
                <Show when={tab() === "browser"}>
                  <PreviewPanel
                    files={{ count: () => openedTabs().length, open: () => layout.sidePane.add("preview") }}
                  />
                </Show>
                <Show when={tab() === "terminal"}>
                  <TerminalPanel variant="pane" />
                </Show>
                <Show when={tab() === "review"}>{props.reviewPanel()}</Show>
                {/* 会话标签（子代理钻取 / 侧边对话 / 后台任务输出）：面板里看另一个会话或任务输出。
                  内置的三个标签走上面的分支，这里只处理动态标签。 */}
                <Show when={layout.sidePane.activeSessionTab()}>
                  {(session) => (
                    <Show
                      when={session().kind === "background" ? session() : undefined}
                      keyed
                      fallback={<SidePaneSessionPanel tab={session()} />}
                    >
                      {(tab) => <SidePaneBackgroundOutput tab={tab} />}
                    </Show>
                  )}
                </Show>
              </div>
            )}
          </Show>
        </div>
      </Show>
    </aside>
  )
}

/** 顶层标签条里的文件标签:图标 + 文件名 + 关闭按钮,点击激活该文件的预览。 */
function SidePaneFileTabTrigger(props: { tab: string; active: boolean; onSelect: () => void; onClose: () => void }) {
  const language = useLanguage()
  const file = useFile()
  const path = () => file.pathFromTab(props.tab)

  return (
    <div
      class="flex max-w-[9.5rem] shrink-0 items-center gap-0.5 rounded-md"
      classList={{ "bg-surface": props.active }}
    >
      <button
        type="button"
        class="flex h-7 min-w-0 flex-1 items-center gap-1 whitespace-nowrap rounded-md px-2 text-ui-xs text-foreground transition-colors"
        onClick={props.onSelect}
      >
        <Show when={path()} fallback={<Icon name="file-tree" size="small" class="shrink-0" />}>
          {(p) => <FileVisual active={props.active} path={p()} />}
        </Show>
        <span class="min-w-0 flex-1 truncate">{path() ? getFilename(path()) : props.tab}</span>
      </button>
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
  )
}

/** 「+」菜单:新增右侧面板标签(浏览器/终端/审查)或打开文件、开辅助对话。 */
function SidePaneAddTabMenu(props: { onOpenFiles: () => void }) {
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
          <For each={sidePaneTabs}>
            {(item) => (
              <DropdownMenu.Item
                class="flex items-center gap-2"
                onSelect={() => {
                  // 「文件」没有自己的宿主标签:直接进入选文件流程,
                  // 选中的文件才作为标签出现(其余面板照旧开标签)。
                  if (item.id === "preview") {
                    props.onOpenFiles()
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

function SidePaneTabTrigger(props: { tab: SidePaneTab }) {
  const layout = useLayout()
  const language = useLanguage()
  const sideChat = useSideChat()
  const sortable = createSortable(props.tab)
  const session = () => layout.sidePane.dynamicTabs()[props.tab]
  const meta = () =>
    session() ? { icon: sessionTabPresentation(session()!, language.t).icon } : sidePaneTabMeta(props.tab)
  const label = () =>
    session() ? sessionTabPresentation(session()!, language.t).label : language.t(sidePaneTabMeta(props.tab).labelKey)
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
        class="flex items-center gap-1 px-2 h-7 rounded-md text-ui-xs transition-colors whitespace-nowrap text-foreground"
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
          // 侧边对话是"关掉即删除"（ZCode 的 closeSelectionSideChatRuntime 同款）；
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

// 空态入口。规格对齐 ZCode `AnimatedSidePanePanel.tsx` 的 openTabLauncher 与其
// `styles.css` 里的 `.side-pane-open-tab-*`：空间够时排成卡片网格（图标在上、标签居中、5.5rem 高），
// 空间不够时回落成 h-12 的横排行。
//
// 阈值放在 index.css 里（容器查询），取 340px 而不是 ZCode 的 480px：
// 那边右侧面板默认占窗口 45%（通常 > 480），而我们的 side pane 默认固定 360px ——
// 沿用 480 会让默认宽度永远看不到卡片网格，也就是这次要修的问题本身。
function SidePaneEmptyState(props: { onOpenFiles: () => void }) {
  const layout = useLayout()
  const language = useLanguage()
  const sideChat = useSideChat()
  return (
    <div
      data-component="side-pane-empty"
      class="side-pane-launcher flex-1 min-h-0 overflow-y-auto px-5 py-10 flex items-center justify-center"
    >
      <div class="side-pane-launcher-content flex w-full max-w-[20rem] flex-col gap-5">
        <div class="flex flex-col gap-2 text-center">
          <h2 class="text-ui-xl font-semibold text-foreground">{language.t("sidePane.empty.title")}</h2>
          <p class="text-ui-base leading-5 text-foreground-subtle">{language.t("sidePane.empty.description")}</p>
        </div>
        <div class="side-pane-launcher-list flex w-full flex-col gap-2">
          <For each={sidePaneTabs}>
            {(item) => (
              <button
                type="button"
                class="side-pane-launcher-button flex h-12 min-w-0 items-center gap-3 rounded-xl bg-surface px-3 text-ui-base font-medium text-foreground transition-colors hover:bg-hover"
                onClick={() => {
                  // 「文件」卡直接进入选文件(桌面端资源管理器/网页端选择弹窗),
                  // 选中的文件才作为标签出现;文件区没有自己的空宿主页。
                  if (item.id === "preview") {
                    props.onOpenFiles()
                    return
                  }
                  layout.sidePane.add(item.id)
                }}
              >
                <Icon name={item.icon} size="small" class="shrink-0 text-foreground-subtlest" />
                <span class="side-pane-launcher-label min-w-0 flex-1 truncate text-left">
                  {language.t(item.labelKey)}
                </span>
              </button>
            )}
          </For>
          {/* 侧边对话：不打断主线的并行小对话（对齐 ZCode 的 selection-side-chat）。
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
