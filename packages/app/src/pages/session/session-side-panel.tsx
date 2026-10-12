import { For, Show, createEffect, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { createMediaQuery } from "@solid-primitives/media"
import { Icon } from "@novaway/ui/icon"
import { IconButton } from "@novaway/ui/icon-button"
import { TooltipKeybind } from "@novaway/ui/tooltip"
import { ResizeHandle } from "@novaway/ui/resize-handle"
import { DragDropProvider, DragDropSensors, DragOverlay, SortableProvider, closestCenter } from "@thisbeyond/solid-dnd"
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
  const { sessionKey, tabs, view } = useSessionLayout()

  const isDesktop = createMediaQuery("(min-width: 768px)")
  createEffect(() => {
    if (!isDesktop()) {
      view().todoCollapsed.set(true)
    }
  })

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

  const fileTreeTab = () => layout.fileTree.tab()

  const showAllFiles = () => {
    if (fileTreeTab() !== "changes") return
    layout.fileTree.setTab("all")
  }

  const [store, setStore] = createStore({
    activeDraggable: undefined as string | undefined,
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

  const tab = layout.sidePane.tab
  const width = () =>
    Math.min(layout.sidePane.width(), Math.round((typeof window === "undefined" ? 1000 : window.innerWidth) * 0.6))

  const tabsList: Array<{
    id: SidePaneTab
    icon: "layout-right" | "terminal" | "review"
    labelKey: string
  }> = [
    { id: "preview", icon: "layout-right", labelKey: "sidePane.tab.preview" },
    { id: "terminal", icon: "terminal", labelKey: "sidePane.tab.terminal" },
    { id: "review", icon: "review", labelKey: "sidePane.tab.review" },
  ]

  return (
    <aside
      id="side-pane"
      aria-label={language.t("session.panel.reviewAndFiles")}
      class="relative shrink-0 h-full flex flex-col rounded-lg border border-border-weak-base bg-background-base overflow-hidden"
      data-component="side-pane-frame"
      style={{ width: `${width()}px` }}
    >
      <ResizeHandle
        direction="horizontal"
        edge="start"
        size={layout.sidePane.width()}
        min={320}
        max={typeof window === "undefined" ? 1000 : window.innerWidth * 0.6}
        onResize={(next) => layout.sidePane.resize(next)}
      />
      <div class="flex items-center gap-0.5 h-9 px-1.5 border-b border-border-weak-base shrink-0">
        <div class="flex items-center gap-0.5 flex-1 min-w-0 overflow-x-auto no-scrollbar">
          <For each={tabsList}>
            {(item) => (
              <button
                classList={{
                  "flex items-center gap-1 px-2 h-7 rounded-md text-ui-xs transition-colors shrink-0 whitespace-nowrap": true,
                  "bg-surface-raised-base text-text-strong": tab() === item.id,
                  "text-text-weak hover:text-text-base": tab() !== item.id,
                }}
                onClick={() => layout.sidePane.setTab(item.id)}
              >
                <Icon name={item.icon} size="small" class="shrink-0" />
                {language.t(item.labelKey)}
              </button>
            )}
          </For>
        </div>
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
      </div>
      <div class="flex-1 min-h-0 overflow-hidden">
        <Show when={tab() === "preview"}>
          <Show when={activeFileTab()} keyed fallback={<PreviewPanel />}>
            {(t) => (
              <div class="flex flex-col size-full min-h-0">
                <DragDropProvider
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onDragOver={handleDragOver}
                  collisionDetector={closestCenter}
                >
                  <DragDropSensors />
                  <ConstrainDragYAxis />
                  <div class="flex items-center gap-0.5 px-1.5 h-8 border-b border-border-weak-base shrink-0 overflow-x-auto no-scrollbar">
                    <SortableProvider ids={openedTabs()}>
                      <For each={openedTabs()}>
                        {(fileTab) => <SortableTab tab={fileTab} onTabClose={tabs().close} />}
                      </For>
                    </SortableProvider>
                    <div class="bg-background-strong h-full shrink-0 sticky right-0 z-10 flex items-center justify-center pr-3">
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
                              dialog.show(() => <x.DialogSelectFile mode="files" onOpenFile={showAllFiles} />)
                            })
                          }}
                          aria-label={language.t("command.file.open")}
                        />
                      </TooltipKeybind>
                    </div>
                  </div>
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
              </div>
            )}
          </Show>
        </Show>
        <Show when={tab() === "terminal"}>
          <TerminalPanel variant="pane" />
        </Show>
        <Show when={tab() === "review"}>{props.reviewPanel()}</Show>
      </div>
    </aside>
  )
}
