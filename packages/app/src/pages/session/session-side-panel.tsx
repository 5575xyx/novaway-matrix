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
import { useLayout, type SidePaneTab } from "@/context/layout"
import { createSessionTabs, getTabReorderIndex, type Sizing } from "@/pages/session/helpers"
import { FileTabContent } from "@/pages/session/file-tabs"
import { PreviewPanel } from "@/pages/session/preview-panel"
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
        {/* Side Pane 展开时它是最右侧面板，窗控归它（且必须是本行最靠右的一组）。 */}
        <WindowControls />
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
        </div>
      </Show>
    </aside>
  )
}

function SidePaneTabTrigger(props: { tab: SidePaneTab }) {
  const layout = useLayout()
  const language = useLanguage()
  const sortable = createSortable(props.tab)
  const meta = () => sidePaneTabMeta(props.tab)
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
        {language.t(meta().labelKey)}
      </button>
      <IconButton
        icon="close-small"
        variant="ghost"
        size="small"
        class="h-5 w-5"
        aria-label={language.t("common.closeTab")}
        onClick={() => layout.sidePane.remove(props.tab)}
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
        </div>
      </div>
    </div>
  )
}
