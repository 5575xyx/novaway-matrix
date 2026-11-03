import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  Show,
  Switch,
} from "solid-js"
import { createStore } from "solid-js/store"
import { Dynamic } from "solid-js/web"
import { makeEventListener } from "@solid-primitives/event-listener"
import type { FileSearchHandle } from "@novaway/ui/file"
import { useFileComponent } from "@novaway/ui/context/file"
import { fromContents as diffFromContents, normalize as normalizeDiff } from "@novaway/ui/session-diff"
import { applyPatch, formatPatch, parsePatch, reversePatch } from "diff"
import { useSessionDiff, type SessionDiffStyle } from "@/context/session-diff"
import { cloneSelectedLineRange, previewSelectedLines } from "@novaway/ui/pierre/selection-bridge"
import { createLineCommentController } from "@novaway/ui/line-comment-annotations"
import { sampledChecksum } from "@novaway/core/util/encode"
import { DropdownMenu } from "@novaway/ui/dropdown-menu"
import { Button } from "@novaway/ui/button"
import { Icon } from "@novaway/ui/icon"
import { IconButton } from "@novaway/ui/icon-button"
import { Tabs } from "@novaway/ui/tabs"
import { ScrollView } from "@novaway/ui/scroll-view"
import { showToast } from "@novaway/ui/toast"
import { Markdown } from "@novaway/ui/markdown"
import { writeClipboard } from "@novaway/ui/util/clipboard"
import { selectionFromLines, useFile, type FileSelection, type SelectedLineRange } from "@/context/file"
import { useComments } from "@/context/comments"
import { useSDK } from "@/context/sdk"
import { usePlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"
import { usePreview } from "@/context/preview"
import { useLayout } from "@/context/layout"
import { usePrompt } from "@/context/prompt"
import { getSessionHandoff } from "@/pages/session/handoff"
import { useSessionLayout } from "@/pages/session/session-layout"
import { createSessionTabs } from "@/pages/session/helpers"
import { useSideChat } from "@/pages/session/use-side-chat"
import { isImagePreviewPath, isOfficePreviewPath, OfficeFilePreview } from "@/pages/session/office-file-preview"
import { isRichTextPath } from "@/pages/session/office-preview-utils"
import { RichFilePreview, type RichOp } from "@/pages/session/rich-file-preview"
import {
  applyTextEdit,
  caret,
  formatJson,
  reverseLines,
  sortLines,
  trimTrailing,
  uniqueLines,
} from "@novaway/core/office/text/commands"
import { buildSelectionQuote } from "@/pages/session/side-chat-seed"
import { liveFollowState } from "@/pages/session/live-follow"
import { liveWritePath, liveWriteTick } from "@/pages/session/live-write"
import { createTypingReveal } from "@/utils/typing-reveal"

// 换行符常量：源码里直接写字面换行会变成跨行字符串，读起来也容易出错。
const NEWLINE = String.fromCharCode(10)

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
  const sideChat = useSideChat()
  const language = useLanguage()
  const prompt = usePrompt()
  const sdk = useSDK()
  const platform = usePlatform()
  const preview = usePreview()
  const layout = useLayout()
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
  /**
   * 跟写时的打字机：**只打新增的行**，而且只打"这一笔新写的"。
   *
   * 之前的问题：把整篇新内容当成一条前缀增长，未改动的行也跟着一个字一个字冒出来，
   * 打到一半时后面的内容全没出现 —— 对照视图里就是"最底下一直在跳"。现在按
   * 写盘前后的内容差定位新增行，未改动的行原样显示，只有改动的那几行逐字长出来。
   *
   * 观察窗口由会话页的 watcher 事件打点（live-write.ts）：只有「会话运行中 + 这个
   * 文件刚被写过」才播动画 —— 用户自己打开文件、或会话已结束时，都是直出最新全文。
   */
  /**
   * 这个标签是不是「跟随窗口自动打开的那个」。
   *
   * 一旦认领就**锁存**，不再变回 false：标签可能是上一轮就跟开着的（不会再挂载），
   * 只听挂载那一刻的判断会漏掉它，于是跟写时仍然用左右排布。锁存后跟写结束也保持
   * 用户在这一轮里看到的样子，不会来回切（来回切就是之前那片闪烁的来源）。
   */
  const followTabMatched = () => {
    const state = liveFollowState()
    if (!state.active || state.hijacked) return false
    return state.tabs.some((tab) => tab === props.tab || file.pathFromTab(tab) === path())
  }
  const [followTab, setFollowTab] = createSignal(followTabMatched())
  createEffect(() => {
    if (followTab()) return
    if (followTabMatched()) setFollowTab(true)
  })
  const liveWrite = createMemo(() => (liveWritePath() === path() ? true : undefined))
  /**
   * 对照视图里「旧文件」的那一半内容。
   *
   * 改动数据只给补丁，没有原文；把补丁反向应用到当前内容就能还原改动前的全文。
   * 有了它，右栏就可以只让"新"的那半边按打字机节奏长出来，左边红色的旧内容保持不动。
   * 还原失败（补丁对不上、二进制、补丁被裁掉）时返回 undefined，退回原来的整块对照。
   */
  // 同一份补丁只还原一次：写盘后 contents() 会比 vcs/snapshot 的补丁先到，
  // 这时反向应用对不上；等补丁刷新后重新算一次即可，不必每次内容变动都重试。
  let baselineCache: { patch: string; before: string } | undefined
  const liveBaseline = createMemo(() => {
    // 已经算出来的旧文件不再依赖跟写标记：标记 6 秒后过期，但打字机可能还在打，
    // 这时把旧内容丢掉会让对照视图整块换成"最终版"，等于把动画掐断。
    if (!liveWrite() && !baselineCache) return undefined
    const view = diff()
    const current = contents()
    if (!view || !current || !view.patch) return undefined
    if (baselineCache?.patch === view.patch) return baselineCache.before
    try {
      const parsed = parsePatch(view.patch)
      if (parsed.length === 0) return undefined
      const before = applyPatch(current, formatPatch(reversePatch(parsed)))
      if (typeof before !== "string") return undefined
      baselineCache = { patch: view.patch, before }
      return before
    } catch {
      return undefined
    }
  })
  /**
   * 打字机版内容：未改动的行原样，新增行按预算逐字揭示。
   *
   * "新增行"是**这一笔写盘前后**的内容差（见 utils/typing-additions），不是相对
   * HEAD 的累计补丁 —— 用累计补丁会让每次写盘都把整篇改动重打一遍，看起来一直在闪。
   * 打开面板时已有内容直接完整显示，之后每写一笔只打新写的几行。
   * 状态机在 utils/typing-reveal 里（可以单独用 e2e 驱动验证）。
   */
  const typedContents = createTypingReveal({
    source: contents,
    live: () => !!liveWrite(),
    scope: path,
  })
  /**
   * 跟写期间的对照：旧内容固定，新内容按打字机节奏增长。
   *
   * 没有旧内容（还原失败）时退回原始补丁 —— 仍然是对照视图，只是不播动画。
   */
  const liveDiff = createMemo(() => {
    const view = diff()
    const before = liveBaseline()
    if (!view || before === undefined) return view
    const after = typedContents()
    // 打完了就回到原始对照：重建出来的视图只用于"还在长"的那一段。
    if (after === contents()) return view
    try {
      return diffFromContents({
        file: view.file,
        before,
        after,
        additions: view.additions,
        deletions: view.deletions,
        status: view.status,
      })
    } catch {
      return view
    }
  })
  // 有改动时默认看"改了什么"；仍可切回文件内容（改动的文件也要能编辑）。
  const [viewMode, setViewMode] = createSignal<"diff" | "file">("diff")
  // 办公文件是二进制，diff 渲染器没有可展示的行；直接走只读预览。
  const isMarkdown = createMemo(() => /\.(md|markdown|mdx)$/i.test(path() ?? ""))
  // .html 走富文本编辑器（设计 + 源码），和 Weave 的 Rich 编辑器一致。
  const isRichText = createMemo(() => isRichTextPath(path()))
  // HTML/XHTML 也是"网页"：在右栏的浏览器标签里按真实渲染效果预览，
  // 而不是只给一个代码视图（对齐浏览器预览的入口）。
  const isHtml = createMemo(() => /\.(html?|xhtml)$/i.test(path() ?? ""))
  // Markdown 默认渲染成阅读视图（对齐 ZCode 右栏的 Markdown 阅读器）；
  // 需要改字时从 ⋯ 菜单或分段控件切到「源码」。
  const [markdownMode, setMarkdownMode] = createSignal<"preview" | "source">("preview")

  // 切换文件时把 Markdown 恢复成阅读视图（对齐 ZCode：打开 .md 默认就是渲染后的样子）。
  createEffect(
    on(path, (next) => {
      if (!/\.(md|markdown|mdx)$/i.test(next ?? "")) return
      // 跟写窗口里别把 Markdown 掰回阅读视图：用户要看的是"改了什么"。
      if (followTab()) return
      setViewMode("file")
      setMarkdownMode("preview")
    }),
  )

  // 认领为跟随标签时把视图切到「改动」（只切一次，之后用户自己切换不再抢）。
  let forcedDiffForFollow = false
  createEffect(() => {
    if (!followTab() || forcedDiffForFollow) return
    forcedDiffForFollow = true
    setViewMode("diff")
  })

  /**
   * 排布方式：跟随窗口里自动打开的这个标签**默认用「上下」**，其余标签跟着全局设置。
   *
   * 跟着 AI 写盘时，用户最想看的是"正在改什么"：上下排布里红色是旧内容、
   * 绿色随着打字机一行行长出来，纵向一条线读下去最直观；左右排布在窄面板里
   * 每侧只剩几十列，新内容一长就被折行成一片，反而看不出"在打字"。
   *
   * 用标签级状态而不是改全局：全局设置是用户自己选的（其它标签、其它文件都按它来），
   * 跟写结束后也不该被我们改掉。更关键的是**不能来回切** —— 之前是"跟写时切成
   * 上下、标记过期再切回左右"，一次会话里切十几次，界面就一直在闪。
   */
  const [followDiffStyle, setFollowDiffStyle] = createSignal<SessionDiffStyle>("unified")
  const diffStyle = () => (followTab() ? followDiffStyle() : sessionDiff.style())
  const setDiffStyle = (style: SessionDiffStyle) => {
    if (followTab()) {
      setFollowDiffStyle(style)
      return
    }
    sessionDiff.setStyle(style)
  }

  // 不要因为「旧文件还没还原出来」就把预览切回文本视图：每次写盘补丁都会刷新，
  // 判断会短暂为假，视图在两支之间来回跳 —— 这就是用户看到的那片闪烁。
  // 还原不出来时 liveDiff 会退回原始对照，最多是不播动画，但画面是稳定的。
  const showDiff = () =>
    !!diff() && viewMode() === "diff" && !isOfficePreviewPath(path()) && !isImagePreviewPath(path())
  // 跟写期间行号跟随打字机揭示的行数增长（draft 在跟写时同步 typedContents，见下方 effect）。
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
  /**
   * 选中一段代码后浮出的动作菜单（对齐 ZCode 文件预览的选区菜单）。
   *
   * 与右键菜单分开：右键是"评论某几行"，而选区菜单是"把这段拿去问辅助对话"。
   * 右键点完菜单会消失，选区则还在；两者触发方式不同，混在一个状态里会出现
   * 光标移动后菜单仍指着旧选区的问题。
   */
  // pierre 的 diff 视图把行放在 shadow DOM 里，拿不到 DOM Range；
  // 用它回调的行号记录最近一次点击/选择，右键时据此弹动作菜单。
  const [lastDiffRange, setLastDiffRange] = createSignal<SelectedLineRange | undefined>()
  const [selectionMenu, setSelectionMenu] = createSignal<{
    x: number
    y: number
    selection: SelectedLineRange
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
    // 跟写期间编辑器里是「打字机还没打完」的内容：禁止自动保存把它写回磁盘。
    // 现在打字机只揭示新增行，草稿不再是磁盘内容的前缀，所以只要两者不一致就不保存。
    if (liveWrite() && draft() !== contents()) return
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
    // 跟写期间 draft 落后于磁盘是**预期**的（打字机还在打），不能提示「未保存」。
    if (liveWrite() && draft() !== contents()) return "saved"
    if (draft() !== contents()) return "dirty"
    return "saved"
  })

  const textareaSelection = (element?: HTMLTextAreaElement): SelectedLineRange | undefined => {
    const target = element ?? editorRef
    const value = target?.value ?? draft()
    const rawStart = target?.selectionStart ?? 0
    const rawEnd = target?.selectionEnd ?? rawStart
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

  /** 把选中的行取成纯文本（给"在辅助对话中提问"用）。 */
  const selectedCode = (selection: SelectedLineRange): string => {
    const value = editorRef?.value ?? draft()
    const lines = value.split(NEWLINE)
    const start = Math.max(1, Math.min(selection.start, selection.end))
    const end = Math.max(selection.start, selection.end)
    return lines.slice(start - 1, end).join(NEWLINE)
  }

  /** Markdown 里点文件链接：在当前侧栏再开一个文件标签。 */
  const openLinkedFile = (target: string) => {
    const normalized = file.normalize(target)
    if (!normalized) return
    void file.load(normalized).then(() => {
      if (file.get(normalized)?.error) return
      const tab = file.tab(normalized)
      void tabs().open(tab)
      tabs().setActive(tab)
    })
  }

  const copyPath = async (kind: "absolute" | "relative") => {
    const p = path()
    if (!p) return
    const separator = sdk.directory.includes("\\") ? "\\" : "/"
    const value = kind === "absolute" ? `${sdk.directory.replace(/[\/]+$/, "")}${separator}${p}` : p
    // 剪贴板写入会静默失败（WebView 无焦点 / 非安全上下文），以前无论成败都弹「已复制」，
    // 用户看到提示却粘不出东西。现在按真实结果给反馈。
    const copied = await writeClipboard(value)
    showToast(
      copied
        ? { variant: "success", icon: "circle-check", title: language.t("common.copied") }
        : { variant: "error", title: language.t("toast.copyFailed.title"), description: value },
    )
  }

  const absolutePath = () => {
    const p = path()
    if (!p) return
    const separator = sdk.directory.includes("\\") ? "\\" : "/"
    return `${sdk.directory.replace(/[\/]+$/, "")}${separator}${p}`
  }

  /**
   * 在右栏浏览器里预览当前 HTML 文件。
   *
   * 走 `file://` 地址（桌面端主进程会换成受信任的自定义协议），
   * 这样 iframe 里是真实的渲染结果，而不是源码文本；相对路径引用的
   * 本地 css/js 也能正常加载。
   */
  const openInBrowser = () => {
    const absolute = absolutePath()
    if (!absolute) return
    if (!preview.setUrl(absolute)) return
    layout.sidePane.add("browser")
  }

  const revealInExplorer = () => {
    const p = path()
    if (!p) return
    const separator = sdk.directory.includes("\\") ? "\\" : "/"
    const absolute = `${sdk.directory.replace(/[\/]+$/, "")}${separator}${p}`
    // 桌面端走原生「在资源管理器中显示并选中」;pty spawn explorer 在 Windows 服务端会 500,仅作网页端兜底。
    if (platform.showItemInFolder) {
      void platform.showItemInFolder(absolute).catch(() => {})
      return
    }
    sdk.client.pty
      .create({ command: "explorer", args: [absolute], title: "reveal" })
      .then(() => {})
      .catch(() => {})
  }

  /** 把选中的代码作为「引用」加到主输入框上方（与聊天区选中文字一致）。 */
  const addSelectionToTask = (selection: SelectedLineRange) => {
    const p = path()
    if (!p) return
    const start = Math.min(selection.start, selection.end)
    const end = Math.max(selection.start, selection.end)
    prompt.context.add({
      type: "quote",
      text: selectedCode(selection),
      label: `${p} ${start === end ? `第 ${start} 行` : `第 ${start}-${end} 行`}`,
      path: p,
    })
  }

  /** 把一段选中代码带进辅助对话：显示成引用卡片，而不是塞进输入框。 */
  const askSelectionInSideChat = (selection: SelectedLineRange) => {
    const p = path()
    if (!p) return
    const start = Math.min(selection.start, selection.end)
    const end = Math.max(selection.start, selection.end)
    void sideChat.open({
      quote: buildSelectionQuote({ path: p, start, end, code: selectedCode(selection) }),
    })
  }

  const askInSideChat = () => {
    const current = contextMenu()
    if (!current) return
    setContextMenu(undefined)
    askSelectionInSideChat(current.selection)
  }

  /**
   * 文本域选区结束时浮出「在辅助对话中提问」。
   *
   * textarea 的选区拿不到 DOM Range，所以不复用聊天区那套
   * `window.getSelection()` 定位；这里用鼠标落点作为锚点，
   * 与代码编辑器（VS Code / ZCode）的浮动菜单观感一致。
   */
  const handleEditorMouseUp = (event: MouseEvent & { currentTarget: HTMLTextAreaElement }) => {
    // 用 currentTarget 而不是闭包里的 editorRef：标签切换/差异视图来回切时，
    // ref 可能指向已经被替换掉的旧 textarea，读到的选区会永远是折叠状态。
    //
    // 有没有选区要按**字符**判断，不能按行：同一行内选中一段文字时
    // start/end 都是那一行，按行比较会当成"没有选区"，菜单永远不出现。
    const element = event.currentTarget
    const selected = textareaSelection(element)
    if (!selected || element.selectionStart === element.selectionEnd) {
      setSelectionMenu(undefined)
      return
    }
    const rect = contentRef?.getBoundingClientRect()
    const menuWidth = 168
    const left = rect ? Math.max(8, Math.min(event.clientX - rect.left, rect.width - menuWidth - 8)) : event.clientX
    const top = rect ? Math.max(8, Math.min(event.clientY - rect.top + 10, rect.height - 44)) : event.clientY
    setSelectionMenu({ x: left, y: top, selection: selected! })
  }

  const handleEditorMouseDown = () => {
    // 重新开始选之前先收起，避免菜单停在旧选区上。
    setSelectionMenu(undefined)
  }

  const handleEditorContextMenu = (event: MouseEvent & { currentTarget: HTMLTextAreaElement }) => {
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
    // 有选区就用选区，不受右键落点影响（编辑器里也是这个口径）：
    // 用户选好 6-10 行之后右键很容易点在选区外一点，那时按落点取行
    // 会把"选中的那几行"变成"鼠标下的那一行"。
    const element = event.currentTarget
    const selected = textareaSelection(element)
    const hasRange = !!selected && element.selectionStart !== element.selectionEnd
    const selection = hasRange ? selected! : { start: clickedLine, end: clickedLine }
    openContextMenu(selection, event.clientX, event.clientY)
  }

  // diff 视图的选区菜单：pierre 的选区在 shadow DOM 里，拿不到鼠标坐标，
  // 所以在选区跨多行时把菜单固定在预览区左上角（可点、可 Esc 关闭）。
  createEffect(
    on(lastDiffRange, (range) => {
      if (!range || range.start === range.end) return
      setSelectionMenu({ x: 16, y: 56, selection: range })
    }),
  )

  createEffect(() => {
    if (!contextMenu()) return
    const cleanup = makeEventListener(document, "pointerdown", (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && !target.closest("[data-file-context-menu]")) setContextMenu(undefined)
    })
    onCleanup(cleanup)
  })

  createEffect(() => {
    if (!selectionMenu()) return
    const cleanup = makeEventListener(document, "pointerdown", (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && !target.closest("[data-file-selection-menu]")) setSelectionMenu(undefined)
    })
    const keydown = makeEventListener(document, "keydown", (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectionMenu(undefined)
    })
    onCleanup(() => {
      cleanup()
      keydown()
    })
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

  /**
   * 办公文件(DOCX/PPTX/XLSX/PDF)是二进制,文本通道读不出内容,单独按 base64 取一次。
   * 图片走服务端的图片分支:文本通道直接返回 base64,用 contents() 即可,不必再取一次。
   * 项目外的文件服务端读不到(工作区边界),桌面端改走本地 base64 通道。
   */
  const officePath = createMemo(() => (isOfficePreviewPath(path()) ? path() : undefined))
  /**
   * DOCX 画布改字：走和 Agent 相同的 office.document.edit。
   * 只发「哪一段、新文字」，服务端只重写 word/document.xml，其余包内条目不动。
   */
  /**
   * 富文本保存：设计视图只发被改过的那一段（setBlockHtml），
   * 结构操作（换标题、对齐）和源码视图发对应的 op。三者和 Agent 走同一套契约。
   */
  const saveRichOps = async (ops: RichOp[]) => {
    const target = path()
    if (!target) throw new Error("没有可写回的文件路径")
    await sdk.client.office.document.edit({ path: target, ops: ops as never })
    void file.load(target, { force: true })
  }

  const applyTextCommand = (kind: "sort" | "unique" | "reverse" | "trim" | "json") => {
    const source = draft()
    try {
      const edit =
        kind === "sort"
          ? sortLines(source, caret(0))
          : kind === "unique"
            ? uniqueLines(source, caret(0))
            : kind === "reverse"
              ? reverseLines(source, caret(0))
              : kind === "trim"
                ? trimTrailing(source, caret(0))
                : formatJson(source, caret(0), "  ")
      if (!edit) return
      setDraft(applyTextEdit(source, edit))
      scheduleSave()
    } catch (error) {
      showToast({
        variant: "error",
        title: "命令未执行",
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const saveDocxParagraphStyle = async (paragraph: number, style: Record<string, unknown>) => {
    const target = path()
    if (!target) throw new Error("没有可写回的文件路径")
    await sdk.client.office.document.edit({
      path: target,
      ops: [{ op: "setParagraphStyle", paragraph, style } as never],
    })
    setOfficeReload(officeReload() + 1)
  }

  const saveDocxParagraph = async (paragraph: number, text: string) => {
    const target = path()
    if (!target) throw new Error("没有可写回的文件路径")
    await sdk.client.office.document.edit({
      path: target,
      ops: [{ op: "setParagraphText", paragraph, text }],
    })
  }
  // 画布内改字会原地重写这份文件，预览得重读一遍才看得到新内容。
  const [officeReload, setOfficeReload] = createSignal(0)
  // 跟写期间（AI 正在产出 office 文件）watcher 每次写盘都重取 base64，
  // 预览像浏览器一样跟着刷新；平时仍只在打开/画布改字时读一次。
  // 依赖里带 tick 而不是只带路径：同一份文件被连写多次时路径不变，
  // 只看路径的依赖收不到第二次通知。
  createEffect(
    on(
      () => [officePath(), liveWritePath(), liveWriteTick()] as const,
      ([target]) => {
        if (!target || liveWritePath() !== target) return
        setOfficeReload((value) => value + 1)
      },
    ),
  )
  const [officeBase64] = createResource(
    () => {
      const target = officePath()
      return target ? { target, reload: officeReload() } : undefined
    },
    async (source) => {
      try {
        if (file.isExternal(source.target) && platform.readLocalFileBase64) {
          return (await platform.readLocalFileBase64(source.target)) ?? ""
        }
        const result = await sdk.client.file.read({ path: source.target, encoding: "base64" })
        return result.data?.content ?? ""
      } catch {
        // 读取失败渲染空内容即可;资源 reject 会沿渲染树抛穿,把整个面板带崩。
        return ""
      }
    },
  )
  // 项目外的图片:文本通道没有内容,同样走本地 base64 通道。
  const [externalImageBase64] = createResource(
    createMemo(() => {
      const p = path()
      return p && isImagePreviewPath(p) && file.isExternal(p) ? p : undefined
    }),
    async (target) => (await platform.readLocalFileBase64?.(target)) ?? "",
  )
  const imageBase64 = createMemo(() =>
    isImagePreviewPath(path()) ? contents() || externalImageBase64() || undefined : undefined,
  )

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

  // 编辑器内容跟随「打字机版」内容（不跟写时它等价于 contents，重写会直接跳最新）。
  // 只保留这一个同步点：同时再挂一个 `on(contents)` 会在整块写入的瞬间先把全文塞进
  // 编辑器、把随后逐字揭示的内容又盖回去，观感是先跳到底再往回缩。
  createEffect(
    on(typedContents, () => {
      setDraft(typedContents())
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
  //
  // **这里刻意不传 annotations / selectedLines / commentedLines。**
  // `commentsUi` 是为**文本**预览建的（`LineCommentAnnotation` 没有 `side` 字段），
  // 而 pierre 的 diff 渲染器要求每条注解都有 `side: "additions" | "deletions"` ——
  // 传进去会在 `setLineAnnotations` 里对 `undefined` 取下标而崩溃
  // （`Cannot read properties of undefined (reading 'N')`，N 就是行号）。
  // 文件里的行评论在「审查」面板里看（那边的注解是按 diff 侧构建的），
  // 这里只做"看变了什么"。
  /**
   * 注意入参是**取值函数**，不是值。
   *
   * 这段 JSX 挂在 keyed `<Show>` 的子函数里，而 Solid 会 `untrack` 地调用它 ——
   * 子函数只在 key 变化时重建一次。直接把 `liveDiff()` 求值传进来，pierre 拿到的
   * 就是**挂载那一刻**的快照，之后打字机再怎么长它都不会重绘：表现就是面板一打开
   * 就已经是"半截内容"，完全看不到逐字揭示。传 getter 后由 pierre 自己的
   * effect 读 `props.fileDiff`，内容一变就重绘。
   */
  const renderDiff = (view: () => ReturnType<typeof normalizeDiff>) => (
    <div
      class="relative overflow-hidden pb-40"
      onContextMenu={(event: MouseEvent) => {
        const range = lastDiffRange()
        if (!range) return
        event.preventDefault()
        openContextMenu(range, event.clientX, event.clientY)
      }}
    >
      <Dynamic
        component={fileComponent}
        mode="diff"
        fileDiff={view().fileDiff}
        diffStyle={diffStyle()}
        enableLineSelection
        selectedLines={() => selectedLines()}
        onLineSelected={(range: SelectedLineRange | undefined) => {
          if (range) setLastDiffRange(range)
        }}
        onLineSelectionEnd={(range: SelectedLineRange | null) => {
          if (range) setLastDiffRange(range)
          syncSelected(range)
          if (!range || range.start === range.end) setSelectionMenu(undefined)
        }}
        onRendered={() => {
          scrollSync.queueRestore()
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
            <div class="flex shrink-0 items-center gap-1">
              <Show when={diff()}>
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
                  <div
                    class="flex items-center rounded-md bg-surface p-0.5"
                    role="group"
                    aria-label={language.t("session.review.diffStyle.toggle")}
                  >
                    <For each={["split", "unified"] as const}>
                      {(style) => (
                        <button
                          type="button"
                          class="rounded px-1.5 py-0.5 text-ui-xs transition-colors"
                          classList={{
                            "bg-background text-foreground": diffStyle() === style,
                            "text-foreground-subtle hover:text-foreground": diffStyle() !== style,
                          }}
                          aria-pressed={diffStyle() === style}
                          onClick={() => setDiffStyle(style)}
                        >
                          {language.t(
                            style === "split" ? "session.review.diffStyle.split" : "session.review.diffStyle.unified",
                          )}
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              </Show>
              {/* Markdown 阅读器：预览 / 源码（对齐 ZCode 右栏）。 */}
              <Show when={isMarkdown() && viewMode() === "file"}>
                <div class="flex items-center rounded-md bg-surface p-0.5">
                  <For each={["preview", "source"] as const}>
                    {(mode) => (
                      <button
                        type="button"
                        class="rounded px-1.5 py-0.5 text-ui-xs transition-colors"
                        classList={{
                          "bg-background text-foreground": markdownMode() === mode,
                          "text-foreground-subtle hover:text-foreground": markdownMode() !== mode,
                        }}
                        aria-pressed={markdownMode() === mode}
                        onClick={() => setMarkdownMode(mode)}
                      >
                        {language.t(
                          mode === "preview"
                            ? "session.filePreview.markdownPreview"
                            : "session.filePreview.markdownSource",
                        )}
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </div>
            <DropdownMenu gutter={4} placement="bottom-end">
              <DropdownMenu.Trigger
                as={IconButton}
                icon="dot-grid"
                variant="ghost"
                size="small"
                class="shrink-0 text-foreground-subtle"
                aria-label={language.t("common.moreOptions")}
              />
              <DropdownMenu.Portal>
                <DropdownMenu.Content style={{ "min-width": "180px" }}>
                  <Show when={isMarkdown()}>
                    <DropdownMenu.Item onSelect={() => setMarkdownMode("preview")}>
                      <DropdownMenu.ItemLabel>
                        {language.t("session.filePreview.markdownPreview")}
                      </DropdownMenu.ItemLabel>
                    </DropdownMenu.Item>
                    <DropdownMenu.Item onSelect={() => setMarkdownMode("source")}>
                      <DropdownMenu.ItemLabel>
                        {language.t("session.filePreview.markdownSource")}
                      </DropdownMenu.ItemLabel>
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator />
                  </Show>
                  <Show when={isHtml()}>
                    <DropdownMenu.Item onSelect={() => openInBrowser()}>
                      <DropdownMenu.ItemLabel>
                        {language.t("session.filePreview.previewInBrowser")}
                      </DropdownMenu.ItemLabel>
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator />
                  </Show>
                  <DropdownMenu.Item onSelect={() => revealInExplorer()}>
                    <DropdownMenu.ItemLabel>
                      {language.t("session.filePreview.revealInExplorer")}
                    </DropdownMenu.ItemLabel>
                  </DropdownMenu.Item>
                  <DropdownMenu.Item onSelect={() => void copyPath("absolute")}>
                    <DropdownMenu.ItemLabel>
                      {language.t("session.filePreview.copyAbsolutePath")}
                    </DropdownMenu.ItemLabel>
                  </DropdownMenu.Item>
                  <DropdownMenu.Item onSelect={() => void copyPath("relative")}>
                    <DropdownMenu.ItemLabel>
                      {language.t("session.filePreview.copyRelativePath")}
                    </DropdownMenu.ItemLabel>
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu>
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

                key 里带上「左右/上下」的排布：pierre 的渲染器实例在创建时就按
                `diffStyle` 定好了行结构，只更新 prop 有一部分版本不会重排，
                表现就是点了「上下」界面纹丝不动。进 key 保证切换一定重建。
              */}
              <Show when={showDiff() && diff() ? `diff:${diffStyle()}` : "file"} keyed>
                {(mode) =>
                  mode !== "file" && diff() ? (
                    renderDiff(() => liveDiff() ?? diff()!)
                  ) : (
                    <Switch>
                      <Match
                        when={
                          state()?.loaded &&
                          state()?.content?.type !== "binary" &&
                          isMarkdown() &&
                          markdownMode() === "preview"
                        }
                      >
                        <ScrollView class="h-full">
                          <div class="mx-auto w-full max-w-3xl px-6 py-5">
                            {/* 跟写期间用打字机版内容：Markdown 渲染器本身按块缓存，
                                递增文本只会重渲染正在生长的尾块。 */}
                            <Markdown text={typedContents()} cacheKey={cacheKey()} onFileOpen={openLinkedFile} />
                          </div>
                        </ScrollView>
                      </Match>
                      {/* 图片:文本通道返回的是 base64,直接交给真实图片预览。
                          必须排在文本编辑分支之前,否则 base64 会按乱码文本打开。 */}
                      <Match when={state()?.loaded && imageBase64()}>
                        <OfficeFilePreview path={path()!} base64={imageBase64()!} />
                      </Match>
                      <Match when={state()?.loaded && state()?.content?.type !== "binary" && isRichText()}>
                        <RichFilePreview
                          content={contents()}
                          onSaveBlock={(block, html) => saveRichOps([{ op: "setBlockHtml", block, html }])}
                          onSaveOps={saveRichOps}
                          onSaveSource={(html) => saveRichOps([{ op: "setText", text: html }])}
                        />
                      </Match>
                      <Match when={state()?.loaded && state()?.content?.type !== "binary"}>
                        <div class="flex h-full min-h-0 flex-col">
                          {/* 行命令和 Agent 的 office_document_edit 是同一份实现：
                              排序/去重/反转/去行尾空格/格式化 JSON 都只改文字。 */}
                          <div class="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-3 py-1.5">
                            <span class="mr-1 text-11-regular text-foreground-subtlest">行命令</span>
                            <For
                              each={
                                [
                                  { id: "sort", label: "排序" },
                                  { id: "unique", label: "去重" },
                                  { id: "reverse", label: "反转" },
                                  { id: "trim", label: "去尾空格" },
                                  { id: "json", label: "格式化 JSON" },
                                ] as const
                              }
                            >
                              {(item) => (
                                <button
                                  type="button"
                                  data-action={`text-command-${item.id}`}
                                  class="rounded px-1.5 py-0.5 text-11-regular text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
                                  onClick={() => applyTextCommand(item.id)}
                                >
                                  {item.label}
                                </button>
                              )}
                            </For>
                          </div>
                          <div class="flex min-h-0 flex-1">
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
                            onMouseDown={handleEditorMouseDown}
                            onMouseUp={handleEditorMouseUp}
                            onKeyDown={(event) => {
                              if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
                                event.preventDefault()
                                void saveEditing()
                              }
                            }}
                          />
                          </div>
                        </div>
                      </Match>
                      <Match when={state()?.loaded && (isOfficePreviewPath(path()) || isImagePreviewPath(path()))}>
                        <Show
                          when={officeBase64()}
                          fallback={
                            <div class="flex h-full items-center justify-center px-6 text-12-regular text-foreground-subtle">
                              {language.t("common.loading")}...
                            </div>
                          }
                        >
                          {(value) => (
                            <OfficeFilePreview
                              path={path()!}
                              base64={value()}
                              onEdited={() => setOfficeReload(officeReload() + 1)}
                              onSaveParagraph={saveDocxParagraph}
                              onSaveParagraphStyle={saveDocxParagraphStyle}
                            />
                          )}
                        </Show>
                      </Match>
                      <Match when={state()?.loaded}>
                        <div class="flex h-full items-center justify-center px-6 text-12-regular text-foreground-subtle">
                          二进制文件无法直接编辑
                        </div>
                      </Match>
                      <Match when={state()?.loading}>
                        <div class="px-6 py-4 text-foreground-subtle">{language.t("common.loading")}...</div>
                      </Match>
                      <Match when={state()?.error}>
                        {(err) => <div class="px-6 py-4 text-foreground-subtle">{err()}</div>}
                      </Match>
                    </Switch>
                  )
                }
              </Show>
            </div>
          </div>
        </div>
        {/* 选区动作菜单：与聊天区的 SelectionActionMenu 同一套观感。 */}
        <Show when={selectionMenu()}>
          {(menu) => (
            <div
              data-file-selection-menu
              class="absolute z-50 flex overflow-hidden rounded-lg border border-border bg-popover p-0.5 text-ui-sm text-foreground shadow-[var(--shadow-md)]"
              style={{ left: `${menu().x}px`, top: `${menu().y}px` }}
              onMouseDown={(event) => event.preventDefault()}
            >
              <button
                type="button"
                data-action="file-add-to-task"
                class="flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 transition-colors hover:bg-hover"
                onClick={() => {
                  const current = menu()
                  setSelectionMenu(undefined)
                  addSelectionToTask(current.selection)
                }}
              >
                {language.t("session.selection.addToTask")}
              </button>
              <div class="w-px shrink-0 bg-border" />
              <button
                type="button"
                data-action="file-ask-side-chat"
                class="flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 transition-colors hover:bg-hover"
                onClick={() => {
                  const current = menu()
                  setSelectionMenu(undefined)
                  askSelectionInSideChat(current.selection)
                }}
              >
                {language.t("sidePane.sideChat.askSelectionShort")}
              </button>
            </div>
          )}
        </Show>
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
                  <div class="flex flex-col gap-0.5">
                    <Button variant="ghost" size="small" class="w-full justify-start" onClick={openContextCommentInput}>
                      评论 L{menu().selection.start}
                      {menu().selection.end !== menu().selection.start ? `-L${menu().selection.end}` : ""}
                    </Button>
                    {/* 对齐 ZCode 的选区动作菜单（SelectionActionMenu）里那条
                        "在辅助对话中提问"：选中的代码带进一条独立小会话，
                        不打断主线、不污染主对话历史。 */}
                    <Button
                      variant="ghost"
                      size="small"
                      class="w-full justify-start"
                      onClick={() => {
                        const current = contextMenu()
                        if (!current) return
                        setContextMenu(undefined)
                        addSelectionToTask(current.selection)
                      }}
                    >
                      {language.t("session.selection.addToTask")}
                    </Button>
                    <Button variant="ghost" size="small" class="w-full justify-start" onClick={askInSideChat}>
                      {language.t("sidePane.sideChat.askSelection", {
                        range:
                          menu().selection.start === menu().selection.end
                            ? `L${menu().selection.start}`
                            : `L${menu().selection.start}-L${menu().selection.end}`,
                      })}
                    </Button>
                  </div>
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
