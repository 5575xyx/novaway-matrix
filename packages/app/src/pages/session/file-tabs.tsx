import { createEffect, createMemo, createSignal, For, Match, on, onCleanup, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { Dynamic } from "solid-js/web"
import { makeEventListener } from "@solid-primitives/event-listener"
import type { FileSearchHandle } from "@novaway/ui/file"
import { useFileComponent } from "@novaway/ui/context/file"
import { normalize as normalizeDiff } from "@novaway/ui/session-diff"
import { useSessionDiff } from "@/context/session-diff"
import { cloneSelectedLineRange, previewSelectedLines } from "@novaway/ui/pierre/selection-bridge"
import { createLineCommentController } from "@novaway/ui/line-comment-annotations"
import { sampledChecksum } from "@novaway/core/util/encode"
import { DropdownMenu } from "@novaway/ui/dropdown-menu"
import { Button } from "@novaway/ui/button"
import { IconButton } from "@novaway/ui/icon-button"
import { Tabs } from "@novaway/ui/tabs"
import { ScrollView } from "@novaway/ui/scroll-view"
import { showToast } from "@novaway/ui/toast"
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
  // 该文件在当前会话里有没有改动。有的话预览直接走「变更前后对照」，
  // 而不是把改动后的内容当普通文本铺开 —— 用户点的是"变更里的文件"。
  const sessionDiff = useSessionDiff()
  const diff = createMemo(() => {
    const p = path()
    if (!p) return
    const raw = sessionDiff.diffFor(p)
    if (!raw) return
    try {
      // normalize 的入参要求 file 一定是字符串（SnapshotFileDiff 的 file 可选），
      // 这里已经按 path 匹配到它了，补上即可。
      return normalizeDiff({ ...raw, file: raw.file ?? p })
    } catch {
      // 解析补丁失败就退回普通文本预览，不要因为一个坏 patch 把整页打空
      return undefined
    }
  })
  const state = createMemo(() => {
    const p = path()
    if (!p) return
    return file.get(p)
  })

  // 切回一个内容已被逐出的标签页时把它重新读进来。
  // 没有这一步的话，被逐出的标签只会显示空白 —— 只有「打开」那一刻会触发加载，
  // 「切回来」不会，所以那种空白是永久的。
  createEffect(
    on(path, (p) => {
      if (!p) return
      const current = file.get(p)
      if (current?.loaded || current?.loading) return
      void file.load(p)
    }),
  )
  const contents = createMemo(() => state()?.content?.content ?? "")
  const cacheKey = createMemo(() => sampledChecksum(contents()))
  // 有改动时默认看"改了什么"；仍可切回文件内容（改动的文件也要能编辑）。
  const [viewMode, setViewMode] = createSignal<"diff" | "file">("diff")
  const showDiff = () => !!diff() && viewMode() === "diff"
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

  /**
   * 把编辑器内容同步到 `contents()`。
   *
   * **不能 `defer: true`**。标签是「只渲染当前激活的那个」并且在切换时整块重建
   * （见 session-side-panel 里 `<Show keyed>` 的用法），所以切回来时组件是全新挂载的：
   * 如果首次不执行，而内容又已经在缓存里（`contents()` 不会再"变化"），
   * 编辑器就永远停在空字符串 —— 表现就是"第一次打开有内容，切回来一片空白"。
   */
  createEffect(
    on(path, () => {
      setDraft(contents())
      setSaveError(false)
      commentsUi.note.reset()
    }),
  )

  createEffect(
    on(contents, () => {
      setDraft(contents())
    }),
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

  // 变更对照：`before`/`after` 由 normalize 从补丁还原出来，红色 − / 绿色 + 由
  // Pierre 的 diff 渲染器给出；`diffStyle` 决定上下对照（unified）还是左右对照（split）。
  const renderDiff = (view: ReturnType<typeof normalizeDiff>) => (
    <div class="relative overflow-hidden pb-40">
      <Dynamic
        component={fileComponent}
        mode="diff"
        fileDiff={view.fileDiff}
        diffStyle={sessionDiff.style()}
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
        media={{ mode: "auto", path: path() }}
      />
    </div>
  )

  return (
    <Tabs.Content value={props.tab} class="mt-3 relative h-full">
      <div
        ref={(el) => {
          contentRef = el
        }}
        class="relative h-full"
      >
        <div class="flex h-full flex-col">
          <div class="flex items-center justify-between gap-3 px-4 pt-3 pb-2">
            <span class="min-w-0 truncate text-12-regular text-foreground-subtle">{path()}</span>
            <Show when={diff()}>
              <div class="flex shrink-0 items-center gap-1">
                {/* 改动 / 文件：默认看对照，需要改代码时切回文件内容。 */}
                <div class="flex items-center rounded-md bg-surface p-0.5">
                  <button
                    type="button"
                    class="rounded px-1.5 py-0.5 text-ui-xs transition-colors"
                    classList={{
                      "bg-background text-foreground": viewMode() === "diff",
                      "text-foreground-subtle hover:text-foreground": viewMode() !== "diff",
                    }}
                    aria-pressed={viewMode() === "diff"}
                    onClick={() => setViewMode("diff")}
                  >
                    {language.t("session.filePreview.diff")}
                  </button>
                  <button
                    type="button"
                    class="rounded px-1.5 py-0.5 text-ui-xs transition-colors"
                    classList={{
                      "bg-background text-foreground": viewMode() === "file",
                      "text-foreground-subtle hover:text-foreground": viewMode() !== "file",
                    }}
                    aria-pressed={viewMode() === "file"}
                    onClick={() => setViewMode("file")}
                  >
                    {language.t("session.filePreview.file")}
                  </button>
                </div>
                {/*
                  左右 / 上下对照。做成两段的分段控件（而不是一个"显示当前模式"的按钮）：
                  单按钮的文案是当前模式，点一下变文案、看不出是"选中态变了"，
                  用户会以为没反应。分段控件让两种排布同时可见、选中态有底色。
                */}
                <Show when={viewMode() === "diff"}>
                  <div class="flex items-center rounded-md bg-surface p-0.5" role="group" aria-label={language.t("session.review.diffStyle.toggle")}>
                    <For each={["split", "unified"] as const}>
                      {(style) => (
                        <button
                          type="button"
                          class="rounded px-1.5 py-0.5 text-ui-xs transition-colors"
                          classList={{
                            "bg-background text-foreground": sessionDiff.style() === style,
                            "text-foreground-subtle hover:text-foreground": sessionDiff.style() !== style,
                          }}
                          aria-pressed={sessionDiff.style() === style}
                          onClick={() => sessionDiff.setStyle(style)}
                        >
                          {language.t(
                            style === "split" ? "session.review.diffStyle.split" : "session.review.diffStyle.unified",
                          )}
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </Show>
            <span
              class="shrink-0 text-12-regular"
              classList={{
                "text-foreground-subtle": saveStatus() === "saved" || saveStatus() === "dirty",
                "text-icon-blue": saveStatus() === "saving",
                "text-destructive-foreground": saveStatus() === "error",
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
              {/*
                两种预览模式必须**各自重新挂载**。
                用 `<Switch>` + 同一个 `Dynamic component` 会踩一个 Solid 的复用陷阱：
                两个分支渲染的是同一个组件引用、又处在同一个位置，Solid 只会更新 props，
                于是实例从 `mode="text"` 直接变成 `mode="diff"` —— 用文本模式建出来的
                渲染器被塞进 diff 的数据，pierre 内部拿到 undefined 就崩
                （`setLineAnnotations` 读 undefined 的索引）。
                用 keyed 的 `<Show>`：模式变了就销毁重建，内容变化则原样保留（不丢滚动位置）。
              */}
              <Show when={showDiff() && diff() ? "diff" : "file"} keyed>
                {(mode) =>
                  mode === "diff" && diff() ? (
                    renderDiff(diff()!)
                  ) : (
                    <Switch>
                <Match when={state()?.loaded && state()?.content?.type !== "binary"}>
                  <div class="flex h-full min-h-0">
                    <div
                      ref={(el) => {
                        gutterRef = el
                      }}
                      class="w-12 shrink-0 overflow-hidden bg-background py-4 pr-2 text-right font-mono text-13 leading-6 text-foreground-subtle select-none"
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
                      class="h-full min-w-0 flex-1 resize-none overflow-x-auto bg-background py-4 pr-4 font-mono text-13 leading-6 outline-none"
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
                  <div class="flex h-full items-center justify-center px-6 text-12-regular text-foreground-subtle">
                    二进制文件无法直接编辑
                  </div>
                </Match>
                <Match when={state()?.loading}>
                  <div class="px-6 py-4 text-foreground-subtle">{language.t("common.loading")}...</div>
                </Match>
                <Match when={state()?.error}>{(err) => <div class="px-6 py-4 text-foreground-subtle">{err()}</div>}</Match>
                    </Switch>
                  )
                }
              </Show>
            </div>
          </div>
        </div>
        <Show when={contextMenu()}>
          {(menu) => (
            <div
              data-file-context-menu
              class="absolute z-50 min-w-[220px] rounded-lg border border-border bg-popover p-1 shadow-[var(--shadow-md)]"
              style={{ left: `${menu().x}px`, top: `${menu().y}px` }}
            >
              <Show
                when={menu().mode === "input"}
                fallback={
                  <Button variant="ghost" size="small" class="w-full justify-start" onClick={openContextCommentInput}>
                    评论 L{menu().selection.start}
                    {menu().selection.end !== menu().selection.start ? `-L${menu().selection.end}` : ""}
                  </Button>
                }
              >
                <div class="flex flex-col gap-2 p-1">
                  <span class="text-11-regular text-foreground-subtle">
                    评论 L{menu().selection.start}
                    {menu().selection.end !== menu().selection.start ? `-L${menu().selection.end}` : ""}
                  </span>
                  <textarea
                    ref={(el) => {
                      contextCommentInputRef = el
                    }}
                    class="h-24 w-full resize-none rounded-md border border-border bg-background p-2 text-13-regular leading-5 outline-none focus:border-border-hover"
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
                  <Button
                    variant="primary"
                    size="small"
                    disabled={!contextComment().trim()}
                    onClick={submitContextComment}
                  >
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
