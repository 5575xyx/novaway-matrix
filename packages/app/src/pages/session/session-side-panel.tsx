import { For, Show, createEffect, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon } from "@novaway/ui/icon"
import { IconButton } from "@novaway/ui/icon-button"
import { TooltipKeybind } from "@novaway/ui/tooltip"
import { ResizeHandle } from "@novaway/ui/resize-handle"
import { WindowControls } from "@/components/window-controls"
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
import { ConstrainDragYAxis, getDraggableId } from "@/utils/solid-dnd"
import { useDialog } from "@novaway/ui/context/dialog"

import { SortableTab, FileVisual } from "@/components/session"
import { useCommand } from "@/context/command"
import { useFile, type SelectedLineRange } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useLayout, type SidePaneSessionTab, type SidePaneTab } from "@/context/layout"
import { createSessionTabs, getTabReorderIndex, type Sizing } from "@/pages/session/helpers"
import { FileTabContent } from "@/pages/session/file-tabs"
import { PreviewPanel } from "@/pages/session/preview-panel"
import { SidePaneSessionPanel } from "@/pages/session/side-pane-session"
import { useSideChat } from "@/pages/session/use-side-chat"
import { TerminalPanel } from "@/pages/session/terminal-panel"
import { setSessionHandoff } from "@/pages/session/handoff"
import { useSessionLayout } from "@/pages/session/session-layout"

const sidePaneTabs: Array<{
  id: SidePaneTab
  icon: "layout-right" | "terminal" | "review"
  labelKey: string
}> = [
  { id: "preview", icon: "layout-right", labelKey: "sidePane.tab.preview" },
  { id: "terminal", icon: "terminal", labelKey: "sidePane.tab.terminal" },
  { id: "review", icon: "review", labelKey: "sidePane.tab.review" },
]

const sidePaneTabMeta = (tab: string) => sidePaneTabs.find((item) => item.id === tab) ?? sidePaneTabs[0]

/**
 * 动态标签（会话）的图标与标题。
 *
 * 内置标签读静态表；动态标签的标题来自它自己的元数据（`SidePaneSessionTab.title`），
 * 子代理显示子代理名、侧边对话显示"侧边对话 N"。图标也按 kind 分：
 * 子代理用 `task`（与工具行同一个图标，视觉上串得起来），侧边对话用 `speech-bubble`。
 */
function sessionTabPresentation(
  tab: SidePaneSessionTab,
  t: ReturnType<typeof useLanguage>["t"],
): { icon: "task" | "speech-bubble"; label: string } {
  return {
    icon: tab.kind === "subagent" ? "task" : "speech-bubble",
    label: tab.title || t(tab.kind === "subagent" ? "sidePane.subagent" : "sidePane.sideChat"),
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
  const command = useCommand()
  const dialog = useDialog()
  const { sessionKey, tabs } = useSessionLayout()

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

  const [store, setStore] = createStore({
    activeDraggable: undefined as string | undefined,
    activeSidePaneDraggable: undefined as string | undefined,
  })

  const handleDragStart = (event: unknown) => {
    const id = getDraggableId(event)
    if (!id) return
    setStore("activeDraggable", id)
  }

  const handleDragOver = (event: DragEvent) => {
    const { draggable, droppable } = event
    if (!draggable || !droppable) return

    const currentTabs = tabs().all()
    const toIndex = getTabReorderIndex(currentTabs, draggable.id.toString(), droppable.id.toString())
    if (toIndex === undefined) return
    tabs().move(draggable.id.toString(), toIndex)
  }

  const handleDragEnd = () => {
    setStore("activeDraggable", undefined)
  }

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
        "transition-[width] will-change-[width] motion-reduce:transition-none": true,
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
      <div class="flex items-center gap-0.5 h-9 px-1.5 border-b border-border shrink-0">
        <DragDropProvider
          onDragStart={sidePaneDragStart}
          onDragOver={sidePaneDragOver}
          onDragEnd={sidePaneDragEnd}
          collisionDetector={closestCenter}
        >
          <DragDropSensors />
          <ConstrainDragYAxis />
          <div class="flex items-center gap-0.5 flex-1 min-w-0 overflow-x-auto no-scrollbar">
            <SortableProvider ids={layout.sidePane.tabs()}>
              <For each={layout.sidePane.tabs()}>{(item) => <SidePaneTabTrigger tab={item} />}</For>
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
      <Show when={layout.sidePane.tabs().length > 0} fallback={<SidePaneEmptyState />}>
        <div class="flex-1 min-h-0 overflow-hidden">
          <Show when={tab() === "preview"}>
            <Show when={activeFileTab()} keyed fallback={<PreviewPanel />}>
              {(t) => (
                <Tabs variant="alt" value={t} onChange={(value) => tabs().setActive(value)} class="min-h-0">
                  <DragDropProvider
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    onDragOver={handleDragOver}
                    collisionDetector={closestCenter}
                  >
                    <DragDropSensors />
                    <ConstrainDragYAxis />
                    <Tabs.List class="h-10 border-b border-border">
                      <SortableProvider ids={openedTabs()}>
                        <For each={openedTabs()}>
                          {(fileTab) => <SortableTab tab={fileTab} onTabClose={tabs().close} />}
                        </For>
                      </SortableProvider>
                      <div class="bg-panel h-full shrink-0 sticky right-0 z-10 flex items-center justify-center pr-3">
                        <TooltipKeybind
                          title={language.t("command.file.open")}
                          keybind={command.keybind("file.open")}
                          class="flex items-center"
                        >
                          <IconButton
                            icon="plus-small"
                            variant="ghost"
                            iconSize="large"
                            class="!rounded-md"
                            onClick={() => {
                              void import("@/components/dialog-select-file").then((x) => {
                                dialog.show(() => <x.DialogSelectFile mode="files" />)
                              })
                            }}
                            aria-label={language.t("command.file.open")}
                          />
                        </TooltipKeybind>
                      </div>
                    </Tabs.List>
                    <div class="flex-1 min-h-0 overflow-hidden">
                      <FileTabContent tab={t} />
                    </div>
                    <DragOverlay>
                      <Show when={store.activeDraggable} keyed>
                        {(tabId) => {
                          const path = file.pathFromTab(tabId)
                          return (
                            <div data-component="tabs-drag-preview">
                              <Show when={path}>{(p) => <FileVisual active path={p()} />}</Show>
                            </div>
                          )
                        }}
                      </Show>
                    </DragOverlay>
                  </DragDropProvider>
                </Tabs>
              )}
            </Show>
          </Show>
          <Show when={tab() === "terminal"}>
            <TerminalPanel variant="pane" />
          </Show>
          <Show when={tab() === "review"}>{props.reviewPanel()}</Show>
          {/* 会话标签（子代理钻取 / 侧边对话）：面板里看另一个会话。
              内置的三个标签走上面的分支，这里只处理动态标签。 */}
          <Show when={layout.sidePane.activeSessionTab()}>
            {(session) => <SidePaneSessionPanel tab={session()} />}
          </Show>
        </div>
      </Show>
    </aside>
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
function SidePaneEmptyState() {
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
                onClick={() => layout.sidePane.add(item.id)}
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
