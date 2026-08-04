import { createEffect, createMemo, createSignal, For, Match, on, onCleanup, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { Dynamic } from "solid-js/web"
import { makeEventListener } from "@solid-primitives/event-listener"
import type { FileSearchHandle } from "@opencode-ai/ui/file"
import { useFileComponent } from "@opencode-ai/ui/context/file"
import { cloneSelectedLineRange, previewSelectedLines } from "@opencode-ai/ui/pierre/selection-bridge"
import { createLineCommentController } from "@opencode-ai/ui/line-comment-annotations"
import { sampledChecksum } from "@opencode-ai/core/util/encode"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Button } from "@opencode-ai/ui/button"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tabs } from "@opencode-ai/ui/tabs"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { showToast } from "@opencode-ai/ui/toast"
import { selectionFromLines, useFile, type FileSelection, type SelectedLineRange } from "@/context/file"
import { useComments } from "@/context/comments"
import { useLanguage } from "@/context/language"
import { usePrompt } from "@/context/prompt"
import { getSessionHandoff } from "@/pages/session/handoff"
import { useSessionLayout } from "@/pages/session/session-layout"
import { createSessionTabs } from "@/pages/session/helpers"

function FileCommentMenu(props: {
  moreLabel: string
  editLabel: string
  deleteLabel: string
  onEdit: VoidFunction
  onDelete: VoidFunction
}) {
  return (
    <div onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      <DropdownMenu gutter={4} placement="bottom-end">
        <DropdownMenu.Trigger
          as={IconButton}
          icon="dot-grid"
          variant="ghost"
          size="small"
          class="size-6 rounded-md"
          aria-label={props.moreLabel}
        />
        <DropdownMenu.Portal>
          <DropdownMenu.Content>
            <DropdownMenu.Item onSelect={props.onEdit}>
              <DropdownMenu.ItemLabel>{props.editLabel}</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={props.onDelete}>
              <DropdownMenu.ItemLabel>{props.deleteLabel}</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </div>
  )
}

type ScrollPos = { x: number; y: number }

function createScrollSync(input: { tab: () => string; view: ReturnType<typeof useSessionLayout>["view"] }) {
  let scroll: HTMLDivElement | undefined
  let scrollFrame: number | undefined
  let restoreFrame: number | undefined
  let pending: ScrollPos | undefined
  const [code, setCode] = createSignal<HTMLElement[]>([])

  const getCode = () => {
    const el = scroll
    if (!el) return []

    const host = el.querySelector("diffs-container")
    if (!(host instanceof HTMLElement)) return []

    const root = host.shadowRoot
    if (!root) return []

    return Array.from(root.querySelectorAll("[data-code]")).filter(
      (node): node is HTMLElement => node instanceof HTMLElement && node.clientWidth > 0,
    )
  }

  const save = (next: ScrollPos) => {
    pending = next
    if (scrollFrame !== undefined) return

    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = undefined

      const out = pending
      pending = undefined
      if (!out) return

      input.view().setScroll(input.tab(), out)
    })
  }

  const onCodeScroll = (event: Event) => {
    const el = scroll
    if (!el) return

    const target = event.currentTarget
    if (!(target instanceof HTMLElement)) return

    save({
      x: target.scrollLeft,
      y: el.scrollTop,
    })
  }

  const sync = () => {
    const next = getCode()
    const current = code()
    if (next.length === current.length && next.every((el, i) => el === current[i])) return
    setCode(next)
  }

  const restore = () => {
    const el = scroll
    if (!el) return

    const pos = input.view().scroll(input.tab())
    if (!pos) return

    sync()

    if (code().length > 0) {
      for (const item of code()) {
        if (item.scrollLeft !== pos.x) item.scrollLeft = pos.x
      }
    }

    if (el.scrollTop !== pos.y) el.scrollTop = pos.y
    if (code().length > 0) return
    if (el.scrollLeft !== pos.x) el.scrollLeft = pos.x
  }

  const queueRestore = () => {
    if (restoreFrame !== undefined) return

    restoreFrame = requestAnimationFrame(() => {
      restoreFrame = undefined
      restore()
    })
  }

  const handleScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    if (code().length === 0) sync()

    save({
      x: code()[0]?.scrollLeft ?? event.currentTarget.scrollLeft,
      y: event.currentTarget.scrollTop,
    })
  }

  createEffect(() => {
    for (const item of code()) makeEventListener(item, "scroll", onCodeScroll)
  })

  const setViewport = (el: HTMLDivElement) => {
    scroll = el
    restore()
  }

  onCleanup(() => {
    if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame)
    if (restoreFrame !== undefined) cancelAnimationFrame(restoreFrame)
  })

  return {
    handleScroll,
    queueRestore,
    setViewport,
  }
}

export function FileTabContent(props: { tab: string }) {
  const file = useFile()
  const comments = useComments()
  const language = useLanguage()
  const prompt = usePrompt()
  const fileComponent = useFileComponent()
  const { sessionKey, tabs, view } = useSessionLayout()
  const activeFileTab = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab: (tab) => (tab.startsWith("file://") ? file.tab(tab) : tab),
  }).activeFileTab

  let find: FileSearchHandle | null = null

  const search = {
    register: (handle: FileSearchHandle | null) => {
      find = handle
    },
  }

  const path = createMemo(() => file.pathFromTab(props.tab))
  const state = createMemo(() => {
    const p = path()
    if (!p) return
    return file.get(p)
  })
  const contents = createMemo(() => state()?.content?.content ?? "")
  const cacheKey = createMemo(() => sampledChecksum(contents()))
  const [draft, setDraft] = createSignal("")
  const lineNumbers = createMemo(() => Array.from({ length: draft().split("\n").length }, (_, index) => index + 1))
  const [saving, setSaving] = createSignal(false)
  const [saveError, setSaveError] = createSignal(false)
  const [contextComment, setContextComment] = createSignal("")
  const [contextMenu, setContextMenu] = createSignal<{
    x: number
    y: number
    selection: SelectedLineRange
    mode: "menu" | "input"
  }>()
  let editorRef: HTMLTextAreaElement | undefined
  let gutterRef: HTMLDivElement | undefined
  let contentRef: HTMLDivElement | undefined
  let contextCommentInputRef: HTMLTextAreaElement | undefined
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  const selectedLines = createMemo<SelectedLineRange | null>(() => {
    const p = path()
    if (!p) return null
    if (file.ready()) return (file.selectedLines(p) as SelectedLineRange | undefined) ?? null
    return (getSessionHandoff(sessionKey())?.files[p] as SelectedLineRange | undefined) ?? null
  })
  const scrollSync = createScrollSync({
    tab: () => props.tab,
    view,
  })

  const selectionPreview = (source: string, selection: FileSelection) => {
    return previewSelectedLines(source, {
      start: selection.startLine,
      end: selection.endLine,
    })
  }

  const buildPreview = (filePath: string, selection: FileSelection) => {
    const source = filePath === path() ? contents() : file.get(filePath)?.content?.content
    if (!source) return undefined
    return selectionPreview(source, selection)
  }

  const addCommentToContext = (input: {
    file: string
    selection: SelectedLineRange
    comment: string
    preview?: string
    origin?: "review" | "file"
  }) => {
    const selection = selectionFromLines(input.selection)
    const preview = input.preview ?? buildPreview(input.file, selection)

    const saved = comments.add({
      file: input.file,
      selection: input.selection,
      comment: input.comment,
    })
    prompt.context.add({
      type: "file",
      path: input.file,
      selection,
      comment: input.comment,
      commentID: saved.id,
      commentOrigin: input.origin,
      preview,
    })
  }

  const updateCommentInContext = (input: {
    id: string
    file: string
    selection: SelectedLineRange
    comment: string
  }) => {
    comments.update(input.file, input.id, input.comment)
    const preview = input.file === path() ? buildPreview(input.file, selectionFromLines(input.selection)) : undefined
    prompt.context.updateComment(input.file, input.id, {
      comment: input.comment,
      ...(preview ? { preview } : {}),
    })
  }

  const removeCommentFromContext = (input: { id: string; file: string }) => {
    comments.remove(input.file, input.id)
    prompt.context.removeComment(input.file, input.id)
  }

  const fileComments = createMemo(() => {
    const p = path()
    if (!p) return []
    return comments.list(p)
  })

  const commentedLines = createMemo(() => fileComments().map((comment) => comment.selection))

  const [note, setNote] = createStore({
    openedComment: null as string | null,
    commenting: null as SelectedLineRange | null,
    selected: null as SelectedLineRange | null,
  })

  const syncSelected = (range: SelectedLineRange | null) => {
    const p = path()
    if (!p) return
    file.setSelectedLines(p, range ? cloneSelectedLineRange(range) : null)
  }

  const saveEditing = async () => {
    const p = path()
    if (!p || saving()) return
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = undefined
    }
    setSaving(true)
    setSaveError(false)
    try {
      await file.write(p, draft())
      setSaveError(false)
    } catch (error) {
      setSaveError(true)
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSaving(false)
    }
  }

  const scheduleSave = () => {
    setSaveError(false)
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => void saveEditing(), 800)
  }

  const saveStatus = createMemo(() => {
    if (saving()) return "saving"
    if (saveError()) return "error"
    if (draft() !== contents()) return "dirty"
    return "saved"
  })

  const textareaSelection = (): SelectedLineRange | undefined => {
    const value = editorRef?.value ?? draft()
    const rawStart = editorRef?.selectionStart ?? 0
    const rawEnd = editorRef?.selectionEnd ?? rawStart
    const startOffset = Math.min(rawStart, rawEnd)
    const endOffset = Math.max(rawStart, rawEnd)
    const lineAt = (offset: number) => value.slice(0, offset).split("\n").length
    const endLine = rawStart === rawEnd ? lineAt(endOffset) : lineAt(Math.max(startOffset, endOffset - 1))
    return {
      start: lineAt(startOffset),
      end: endLine,
    }
  }

  const openContextMenu = (selection: SelectedLineRange, x: number, y: number) => {
    const rect = contentRef?.getBoundingClientRect()
    const menuWidth = 220
    const menuHeight = 150
    const left = rect ? Math.max(0, Math.min(x - rect.left, rect.width - menuWidth)) : x
    const top = rect ? Math.max(0, Math.min(y - rect.top, rect.height - menuHeight)) : y
    setContextComment("")
    setContextMenu({ x: left, y: top, selection, mode: "menu" })
  }

  const openContextCommentInput = () => {
    const current = contextMenu()
    if (!current) return
    setContextComment("")
    setContextMenu({ ...current, mode: "input" })
    requestAnimationFrame(() => contextCommentInputRef?.focus())
  }

  const handleEditorContextMenu = (event: MouseEvent) => {
    event.preventDefault()
    const value = editorRef?.value ?? draft()
    const rect = editorRef?.getBoundingClientRect()
    const clickedLine = rect
      ? Math.max(
          1,
          Math.min(
            value.split("\n").length,
            Math.floor((event.clientY - rect.top + (editorRef?.scrollTop ?? 0)) / 24) + 1,
          ),
        )
      : 1
    const selected = textareaSelection()
    const selection =
      selected &&
      clickedLine >= Math.min(selected.start, selected.end) &&
      clickedLine <= Math.max(selected.start, selected.end)
        ? selected
        : { start: clickedLine, end: clickedLine }
    openContextMenu(selection, event.clientX, event.clientY)
  }

  createEffect(() => {
    if (!contextMenu()) return
    const cleanup = makeEventListener(document, "pointerdown", (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && !target.closest("[data-file-context-menu]")) setContextMenu(undefined)
    })
    onCleanup(cleanup)
  })

  const submitContextComment = () => {
    const current = contextMenu()
    const p = path()
    const text = contextComment().trim()
    if (!current || !p || !text) return
    addCommentToContext({ file: p, selection: current.selection, comment: text, origin: "file" })
    setContextMenu(undefined)
    setContextComment("")
  }

  const activeSelection = () => note.selected ?? selectedLines()

  const commentsUi = createLineCommentController({
    comments: fileComments,
    label: language.t("ui.lineComment.submit"),
    draftKey: () => path() ?? props.tab,
    mention: {
      items: file.searchFilesAndDirectories,
    },
    state: {
      opened: () => note.openedComment,
      setOpened: (id) => setNote("openedComment", id),
      selected: () => note.selected,
      setSelected: (range) => setNote("selected", range),
      commenting: () => note.commenting,
      setCommenting: (range) => setNote("commenting", range),
      syncSelected,
      hoverSelected: syncSelected,
    },
    getHoverSelectedRange: activeSelection,
    cancelDraftOnCommentToggle: true,
    clearSelectionOnSelectionEndNull: true,
    onSubmit: ({ comment, selection }) => {
      const p = path()
      if (!p) return
      addCommentToContext({ file: p, selection, comment, origin: "file" })
    },
    onUpdate: ({ id, comment, selection }) => {
      const p = path()
      if (!p) return
      updateCommentInContext({ id, file: p, selection, comment })
    },
    onDelete: (comment) => {
      const p = path()
      if (!p) return
      removeCommentFromContext({ id: comment.id, file: p })
    },
    editSubmitLabel: language.t("common.save"),
    renderCommentActions: (_, controls) => (
      <FileCommentMenu
        moreLabel={language.t("common.moreOptions")}
        editLabel={language.t("common.edit")}
        deleteLabel={language.t("common.delete")}
        onEdit={controls.edit}
        onDelete={controls.remove}
      />
    ),
  })

  createEffect(() => {
    if (typeof window === "undefined") return

    const onKeyDown = (event: KeyboardEvent) => {
      if (activeFileTab() !== props.tab) return
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      if (event.key.toLowerCase() !== "f") return

      event.preventDefault()
      event.stopPropagation()
      find?.focus()
    }

    makeEventListener(window, "keydown", onKeyDown, { capture: true })
  })

  createEffect(
    on(
      path,
      () => {
        setDraft(contents())
        setSaveError(false)
        commentsUi.note.reset()
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      contents,
      () => {
        setDraft(contents())
      },
      { defer: true },
    ),
  )

  onCleanup(() => {
    if (saveTimer) clearTimeout(saveTimer)
  })

  createEffect(() => {
    const focus = comments.focus()
    const p = path()
    if (!focus || !p) return
    if (focus.file !== p) return
    if (activeFileTab() !== props.tab) return

    const target = fileComments().find((comment) => comment.id === focus.id)
    if (!target) return

    commentsUi.note.openComment(target.id, target.selection, { cancelDraft: true })
    requestAnimationFrame(() => comments.clearFocus())
  })

  let prev = {
    loaded: false,
    ready: false,
    active: false,
  }

  createEffect(() => {
    const loaded = !!state()?.loaded
    const ready = file.ready()
    const active = activeFileTab() === props.tab
    const restore = (loaded && !prev.loaded) || (ready && !prev.ready) || (active && loaded && !prev.active)
    prev = { loaded, ready, active }
    if (!restore) return
    scrollSync.queueRestore()
  })

  const renderFile = (source: string) => (
    <div class="relative overflow-hidden pb-40">
      <Dynamic
        component={fileComponent}
        mode="text"
        file={{
          name: path() ?? "",
          contents: source,
          cacheKey: cacheKey(),
        }}
        enableLineSelection
        enableHoverUtility
        selectedLines={activeSelection()}
        commentedLines={commentedLines()}
        onRendered={() => {
          scrollSync.queueRestore()
        }}
        annotations={commentsUi.annotations()}
        renderAnnotation={commentsUi.renderAnnotation}
        renderHoverUtility={commentsUi.renderHoverUtility}
        onLineSelected={(range: SelectedLineRange | null) => {
          commentsUi.onLineSelected(range)
        }}
        onLineNumberSelectionEnd={commentsUi.onLineNumberSelectionEnd}
        onLineSelectionEnd={(range: SelectedLineRange | null) => {
          commentsUi.onLineSelectionEnd(range)
        }}
        search={search}
        class="select-text"
        media={{
          mode: "auto",
          path: path(),
          current: state()?.content,
          onLoad: scrollSync.queueRestore,
          onError: (args: { kind: "image" | "audio" | "svg" }) => {
            if (args.kind !== "svg") return
            showToast({
              variant: "error",
              title: language.t("toast.file.loadFailed.title"),
            })
          },
        }}
      />
    </div>
  )

  return (
    <Tabs.Content value={props.tab} class="mt-3 relative h-full">
      <div ref={(el) => { contentRef = el }} class="relative h-full">
        <div class="flex h-full flex-col">
          <div class="flex items-center justify-between gap-3 px-4 pt-3 pb-2">
            <span class="min-w-0 truncate text-12-regular text-text-weak">{path()}</span>
            <span
              class="shrink-0 text-12-regular"
              classList={{
                "text-text-weak": saveStatus() === "saved" || saveStatus() === "dirty",
                "text-text-interactive-base": saveStatus() === "saving",
                "text-text-on-critical-base": saveStatus() === "error",
              }}
            >
              {saveStatus() === "saving"
                ? language.t("common.saving")
                : saveStatus() === "error"
                  ? language.t("common.saveFailed")
                  : saveStatus() === "dirty"
                    ? language.t("common.unsaved")
                    : language.t("common.saved")}
            </span>
          </div>
          <div class="flex min-h-0 flex-1">
            <div class="min-w-0 flex-1">
              <Switch>
                <Match when={state()?.loaded && state()?.content?.type !== "binary"}>
                  <div class="flex h-full min-h-0">
                    <div
                      ref={(el) => {
                        gutterRef = el
                      }}
                      class="w-12 shrink-0 overflow-hidden bg-background-base py-4 pr-2 text-right font-mono text-13 leading-6 text-text-weak select-none"
                      style={{ "line-height": "24px" }}
                    >
                      <For each={lineNumbers()}>
                        {(line) => (
                          <div
                            class="h-6"
                            style={{ height: "24px", "line-height": "24px" }}
                            onContextMenu={(event: MouseEvent) => {
                              event.preventDefault()
                              openContextMenu({ start: line, end: line }, event.clientX, event.clientY)
                            }}
                          >
                            {line}
                          </div>
                        )}
                      </For>
                    </div>
                    <textarea
                      ref={(el) => {
                        editorRef = el
                      }}
                      class="h-full min-w-0 flex-1 resize-none overflow-x-auto bg-background-base py-4 pr-4 font-mono text-13 leading-6 outline-none"
                      style={{ "line-height": "24px" }}
                      value={draft()}
                      wrap="off"
                      spellcheck={false}
                      onScroll={(event) => {
                        if (gutterRef) gutterRef.scrollTop = event.currentTarget.scrollTop
                      }}
                      onInput={(event) => {
                        setDraft(event.currentTarget.value)
                        scheduleSave()
                      }}
                      onBlur={() => {
                        if (draft() !== contents()) void saveEditing()
                      }}
                      onContextMenu={handleEditorContextMenu}
                      onKeyDown={(event) => {
                        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
                          event.preventDefault()
                          void saveEditing()
                        }
                      }}
                    />
                  </div>
                </Match>
                <Match when={state()?.loaded}>
                  <div class="flex h-full items-center justify-center px-6 text-12-regular text-text-weak">
                    二进制文件无法直接编辑
                  </div>
                </Match>
                <Match when={state()?.loading}>
                  <div class="px-6 py-4 text-text-weak">{language.t("common.loading")}...</div>
                </Match>
                <Match when={state()?.error}>{(err) => <div class="px-6 py-4 text-text-weak">{err()}</div>}</Match>
              </Switch>
            </div>
          </div>
        </div>
        <Show when={contextMenu()}>
          {(menu) => (
            <div
              data-file-context-menu
              class="absolute z-50 min-w-[220px] rounded-lg border border-border-weak-base bg-surface-float-base p-1 shadow-[var(--shadow-lg-border-base)]"
              style={{ left: `${menu().x}px`, top: `${menu().y}px` }}
            >
              <Show
                when={menu().mode === "input"}
                fallback={
                  <Button
                    variant="ghost"
                    size="small"
                    class="w-full justify-start"
                    onClick={openContextCommentInput}
                  >
                    评论 L{menu().selection.start}
                    {menu().selection.end !== menu().selection.start ? `-L${menu().selection.end}` : ""}
                  </Button>
                }
              >
                <div class="flex flex-col gap-2 p-1">
                  <span class="text-11-regular text-text-weak">
                    评论 L{menu().selection.start}
                    {menu().selection.end !== menu().selection.start ? `-L${menu().selection.end}` : ""}
                  </span>
                  <textarea
                    ref={(el) => {
                      contextCommentInputRef = el
                    }}
                    class="h-24 w-full resize-none rounded-md border border-border-weak-base bg-background-base p-2 text-13-regular leading-5 outline-none focus:border-border-strong-base"
                    value={contextComment()}
                    placeholder="输入评论..."
                    onInput={(event) => setContextComment(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                        event.preventDefault()
                        submitContextComment()
                      }
                    }}
                  />
                  <Button variant="primary" size="small" disabled={!contextComment().trim()} onClick={submitContextComment}>
                    {language.t("common.submit")}
                  </Button>
                </div>
              </Show>
            </div>
          )}
        </Show>
      </div>
    </Tabs.Content>
  )
}
