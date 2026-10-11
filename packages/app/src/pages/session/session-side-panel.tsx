import { For, Match, Show, Switch, createEffect, createMemo, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { createMediaQuery } from "@solid-primitives/media"
import { Tabs } from "@novaway/ui/tabs"
import { Icon } from "@novaway/ui/icon"
import { IconButton } from "@novaway/ui/icon-button"
import { TooltipKeybind } from "@novaway/ui/tooltip"
import { ResizeHandle } from "@novaway/ui/resize-handle"
import { DragDropProvider, DragDropSensors, DragOverlay, SortableProvider, closestCenter } from "@thisbeyond/solid-dnd"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import type { SnapshotFileDiff, VcsFileDiff } from "@novaway/sdk/v2"
import { ConstrainDragYAxis, getDraggableId } from "@/utils/solid-dnd"
import { useDialog } from "@novaway/ui/context/dialog"

import FileTree from "@/components/file-tree"
import { SessionContextTab, SortableTab, FileVisual } from "@/components/session"
import { useCommand } from "@/context/command"
import { useFile, type SelectedLineRange } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useLayout, type SidePaneTab } from "@/context/layout"
import { createOpenSessionFileTab, createSessionTabs, getTabReorderIndex, type Sizing } from "@/pages/session/helpers"
import { FileTabContent } from "@/pages/session/file-tabs"
import { PreviewPanel } from "@/pages/session/preview-panel"
import { TerminalPanel } from "@/pages/session/terminal-panel"
import { GitPanel } from "./git-panel"
import { setSessionHandoff } from "@/pages/session/handoff"
import { useSessionLayout } from "@/pages/session/session-layout"

type RenderDiff = (SnapshotFileDiff & { file: string }) | VcsFileDiff

function renderDiff(value: SnapshotFileDiff | VcsFileDiff): value is RenderDiff {
  return typeof value.file === "string"
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
  const { sessionKey, tabs, view } = useSessionLayout()

  const isDesktop = createMediaQuery("(min-width: 768px)")
  createEffect(() => {
    if (!isDesktop()) {
      view().todoCollapsed.set(true)
    }
  })

  const diffs = createMemo(() => props.diffs().filter(renderDiff))
  const diffFiles = createMemo(() => diffs().map((d) => d.file))
  const kinds = createMemo(() => {
    const merge = (a: "add" | "del" | "mix" | undefined, b: "add" | "del" | "mix") => {
      if (!a) return b
      if (a === b) return a
      return "mix" as const
    }

    const normalize = (p: string) => p.replaceAll("\\\\", "/").replace(/\/+$/, "")

    const out = new Map<string, "add" | "del" | "mix">()
    for (const diff of diffs()) {
      const file = normalize(diff.file)
      const kind = diff.status === "added" ? "add" : diff.status === "deleted" ? "del" : "mix"

      out.set(file, kind)

      const parts = file.split("/")
      for (const [idx] of parts.slice(0, -1).entries()) {
        const dir = parts.slice(0, idx + 1).join("/")
        if (!dir) continue
        out.set(dir, merge(out.get(dir), kind))
      }
    }
    return out
  })

  const empty = (msg: string) => (
    <div class="h-full flex flex-col">
      <div class="h-6 shrink-0" aria-hidden />
      <div class="flex-1 pb-64 flex items-center justify-center text-center">
        <div class="text-12-regular text-text-weak">{msg}</div>
      </div>
    </div>
  )

  const nofiles = createMemo(() => {
    const state = file.tree.state("")
    if (!state?.loaded) return false
    return file.tree.children("").length === 0
  })

  const normalizeTab = (tab: string) => {
    if (!tab.startsWith("file://")) return tab
    return file.tab(tab)
  }

  const revealFileTab = () => {
    layout.sidePane.setTab("preview")
    if (!view().reviewPanel.opened()) view().reviewPanel.open()
  }

  const openTab = createOpenSessionFileTab({
    normalizeTab,
    openTab: tabs().open,
    pathFromTab: file.pathFromTab,
    loadFile: file.load,
    openReviewPanel: revealFileTab,
    setActive: tabs().setActive,
  })

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

  const setFileTreeTabValue = (value: string) => {
    if (value !== "changes" && value !== "all" && value !== "review") return
    layout.fileTree.setTab(value as "changes" | "all" | "review")
  }

  const showAllFiles = () => {
    if (fileTreeTab() !== "changes" && fileTreeTab() !== "review") return
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
    icon: "layout-right" | "terminal" | "file-tree" | "branch" | "review" | "database"
    labelKey: string
  }> = [
    { id: "preview", icon: "layout-right", labelKey: "sidePane.tab.preview" },
    { id: "terminal", icon: "terminal", labelKey: "sidePane.tab.terminal" },
    { id: "files", icon: "file-tree", labelKey: "sidePane.tab.files" },
    { id: "git", icon: "branch", labelKey: "sidePane.tab.git" },
    { id: "review", icon: "review", labelKey: "sidePane.tab.review" },
    { id: "context", icon: "database", labelKey: "sidePane.tab.context" },
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
        <Show when={tab() === "files"}>
          <div class="h-full flex flex-col overflow-hidden group/filetree">
            <Tabs
              variant="pill"
              value={fileTreeTab()}
              onChange={setFileTreeTabValue}
              class="h-full"
              data-scope="filetree"
            >
              <Tabs.List>
                <Tabs.Trigger value="all" class="flex-1" classes={{ button: "w-full" }}>
                  {language.t("session.files.all")}
                </Tabs.Trigger>
                <Tabs.Trigger value="review" class="flex-1" classes={{ button: "w-full" }}>
                  {language.t("session.tab.review")}
                </Tabs.Trigger>
                <Tabs.Trigger value="changes" class="flex-1" classes={{ button: "w-full" }}>
                  {props.reviewCount()}{" "}
                  {language.t(props.reviewCount() === 1 ? "session.review.change.one" : "session.review.change.other")}
                </Tabs.Trigger>
              </Tabs.List>
              <Tabs.Content value="changes" class="bg-background-stronger px-3 py-0">
                <Switch>
                  <Match when={props.hasReview() || !props.diffsReady()}>
                    <Show
                      when={props.diffsReady()}
                      fallback={
                        <div class="px-2 py-2 text-12-regular text-text-weak">
                          {language.t("common.loading")}
                          {language.t("common.loading.ellipsis")}
                        </div>
                      }
                    >
                      <FileTree
                        path=""
                        class="pt-3"
                        allowed={diffFiles()}
                        kinds={kinds()}
                        draggable={false}
                        active={props.activeDiff}
                        onFileClick={(node) => props.focusReviewDiff(node.path)}
                      />
                    </Show>
                  </Match>
                </Switch>
              </Tabs.Content>
              <Tabs.Content value="all" class="bg-background-stronger px-3 py-0">
                <Switch>
                  <Match when={nofiles()}>{empty(language.t("session.files.empty"))}</Match>
                  <Match when={true}>
                    <FileTree
                      path=""
                      class="pt-3"
                      modified={diffFiles()}
                      kinds={kinds()}
                      onFileClick={(node) => openTab(file.tab(node.path))}
                    />
                  </Match>
                </Switch>
              </Tabs.Content>
              <Tabs.Content value="review" class="bg-background-stronger p-0">
                <Show when={props.canReview()} fallback={empty(language.t("session.review.noChanges"))}>
                  {props.reviewPanel()}
                </Show>
              </Tabs.Content>
            </Tabs>
          </div>
        </Show>
        <Show when={tab() === "git"}>
          <GitPanel />
        </Show>
        <Show when={tab() === "review"}>{props.reviewPanel()}</Show>
        <Show when={tab() === "context"}>
          <SessionContextTab />
        </Show>
      </div>
    </aside>
  )
}
