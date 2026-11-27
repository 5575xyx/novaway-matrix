import type { Diagnostic } from "@codemirror/lint"
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  lazy,
  on,
  onCleanup,
  Show,
  type JSX,
} from "solid-js"
import { createStore } from "solid-js/store"
import { makeEventListener } from "@solid-primitives/event-listener"
import type { FileSearchHandle } from "@novaway/ui/file"
import { fromContents as diffFromContents, normalize as normalizeDiff } from "@novaway/ui/session-diff"
import { applyPatch, formatPatch, reversePatch } from "diff"
import { parsePatchPreservingCarriageReturns } from "@/pages/session/patch-utils"
import { useSessionDiff, type SessionDiffStyle } from "@/context/session-diff"
import { cloneSelectedLineRange, previewSelectedLines } from "@novaway/ui/pierre/selection-bridge"
import { createLineCommentController } from "@novaway/ui/line-comment-annotations"
import { sampledChecksum } from "@novaway/core/util/encode"
import { shouldReloadOfficePreview } from "@/context/file/watcher"
import { officeFormatOf } from "@novaway/core/office/engine/registry"
import type { OfficeOp } from "@novaway/core/office/engine/contract"
import { decryptPdf, isEncryptedPdf } from "@novaway/core/office/pdf/decrypt"
import { DropdownMenu } from "@novaway/ui/dropdown-menu"
import { Button } from "@novaway/ui/button"
import { IconButton } from "@novaway/ui/icon-button"
import { Tabs } from "@novaway/ui/tabs"
import { showToast } from "@novaway/ui/toast"
import { writeClipboard } from "@novaway/ui/util/clipboard"
import { selectionFromLines, useFile, type FileSelection, type SelectedLineRange } from "@/context/file"
import { useComments } from "@/context/comments"
import { useSDK } from "@/context/sdk"
import { usePlatform, type InstalledEditor, type OfficeApp } from "@/context/platform"
import { useServer } from "@/context/server"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { usePreview } from "@/context/preview"
import { useLayout } from "@/context/layout"
import { useLocal } from "@/context/local"
import { useSettings } from "@/context/settings"
import { usePrompt } from "@/context/prompt"
import { useDialog } from "@novaway/ui/context/dialog"
import { PdfPasswordDialog } from "@/pages/session/dialog-pdf-password"
import { ConflictDialog } from "@/pages/session/dialog-conflict"
import { detectSaveConflict } from "@/pages/session/save-conflict"
import { getSessionHandoff } from "@/pages/session/handoff"
import { useSessionLayout } from "@/pages/session/session-layout"
import { createSessionTabs } from "@/pages/session/helpers"
import { useSideChat } from "@/pages/session/use-side-chat"
import { PluginViewHost } from "@/components/plugin-view-host"
import {
  base64ToBytes,
  bytesToBase64,
  documentBytesSha256,
  isImagePreviewPath,
  isOfficePreviewPath,
  isPluginOfficePath,
  pluginOfficeExtensions,
  pluginFilePreviewer,
  modernOfficeExtensionForLegacy,
  sameDocumentBytes,
} from "@/pages/session/office-preview-utils"
import { officeExportTargets } from "@/pages/session/office-export-targets"
import { saveOfficeEditor, snapshotOfficeEditor } from "@/pages/session/office-editor-session"
import { ConfirmDialog } from "@/components/dialog-confirm"
import type { OfficeFilePreviewProps } from "@/pages/session/office-file-preview"
import {
  FilePreviewBinaryContent,
  getFileMediaPreviewFormat,
  preloadSessionFilePreview,
} from "@/pages/session/file-preview-binary-content"
import { FilePreviewDiffContent } from "@/pages/session/file-preview-diff-content"
import { FilePreviewTextFindBar } from "@/pages/session/file-preview-text-find-bar"
import { FilePreviewTextGotoBar } from "@/pages/session/file-preview-text-goto-bar"
import { FilePreviewWorkspaceSearchResults } from "@/pages/session/file-preview-workspace-search-results"
import { documentHtml, printHtml, printableHtml, textToPrintHtml } from "@/pages/session/print-document"
import {
  clearDraft,
  draftOf,
  flushDrafts,
  persistedDraftOf,
  previewOpenModeOf,
  rememberDraft,
  rememberView,
  rememberViewMode,
  setDraftScope,
  viewModeOf,
  viewOf,
  type EditorViewState,
} from "@/pages/session/editor-memory"
import {
  canRedoText,
  canUndoText,
  recordTextChange,
  redoText,
  undoText,
  type TextSnapshot,
} from "@/pages/session/text-history"
import {
  isEditableDocumentPath,
  isOfficeBinaryPreviewPath,
  isExportableDocumentPath,
  isLegacyPreviewPath,
} from "@/pages/session/office-preview-utils"
import {
  formatFrontMatterValue,
  parseFrontMatter,
  parseFrontMatterValue,
  updateFrontMatter,
} from "@novaway/core/office/text/front-matter"
import { type RichOp } from "@/pages/session/rich-file-preview"
import { CsvGrid } from "@/pages/session/csv-grid"
import {
  applyTextEdit,
  caret,
  changeCase,
  commentTokens,
  convertIndent,
  deleteLines,
  duplicateLines,
  formatSource,
  indentLines,
  joinLines,
  moveLines,
  offsetOfLine,
  reverseLines,
  sortLines,
  toggleComment,
  trimTrailing,
  uniqueLines,
  type TextEdit,
} from "@novaway/core/office/text/commands"
import {
  nextMatch,
  previousMatch,
  replaceAll,
  replaceMatch,
  searchMatches,
  type SearchMatch,
} from "@novaway/core/office/text/search"
import {
  dateText,
  insertCallout,
  insertCodeBlock,
  insertFootnote,
  insertInlineMath,
  insertLink,
  insertMarkdownImage,
  insertMathBlock,
  insertProperties,
  insertRule,
  insertTable,
  setHeading,
  toggleList,
  toggleQuote,
  taskLineOffsets,
  toggleTask,
  wordAt,
} from "@novaway/core/office/text/markdown"
import { filterCommands } from "@novaway/core/office/text/palette"
import { markdownOutline } from "@novaway/core/office/text/outline"
import {
  noteLinks as scanNoteLinks,
  noteTags as scanNoteTags,
  noteTitle as scanNoteTitle,
  resolveNotePath,
} from "@novaway/core/office/text/notes"
import { caretPosition, textStats } from "@novaway/core/office/text/stats"
import { syntaxLanguageOf } from "@novaway/core/office/text/language"
import { CodeHighlight } from "@/pages/session/code-highlight"
import type { CodeEditorHandle } from "@/pages/session/code-editor"
import { applyInlineReplacement } from "@/pages/session/code-inline-edit"
import {
  FilePreviewMarkdownLiveContent,
  FilePreviewMarkdownReadContent,
} from "@/pages/session/file-preview-markdown-content"
import { FilePreviewHeader, type PreviewMenuItem, type PreviewMenuGroup } from "@/pages/session/file-preview-header"
import { buildSelectionQuote } from "@/pages/session/side-chat-seed"
import { liveFollowState } from "@/pages/session/live-follow"
import { liveWritePath, liveWriteTick } from "@/pages/session/live-write"
import { createTypingReveal } from "@/utils/typing-reveal"
import { PaneStatusBar } from "@/pages/session/pane-status-bar"
import { ShortcutHelp } from "@/pages/session/shortcut-help"
import {
  isOfficePreviewFailure,
  officePreviewBase64,
  officePreviewFailure,
  readOfficePreview,
  type OfficePreviewLoad,
  type OfficePreviewReader,
} from "@/pages/session/office-preview-load"

// 换行符常量：源码里直接写字面换行会变成跨行字符串，读起来也容易出错。
const NEWLINE = String.fromCharCode(10)
const codeEditorModule = import("@/pages/session/code-editor")
const CodeEditor = lazy(() => codeEditorModule.then((module) => ({ default: module.CodeEditor })))

/** 预热右侧文件面板的编辑器代码；实际文件字节仍按用户打开的文件读取。 */
export function preloadSessionFileModules() {
  void codeEditorModule
  preloadSessionFilePreview()
}

/** 只有真正的 Office 文档才隐藏「改动 / 文件」视图入口。
 * 代码文件使用专用编辑器头部；Markdown、HTML、纯文本等非代码编辑器仍保留原来的预览与 diff 切换。 */
const isOfficeDocumentPreview = (path: string) =>
  ["docx", "xlsx", "pptx", "pdf", "legacy", "csv"].includes(officeFormatOf(path) ?? "")

/** 代码文件的轻量符号大纲：没有 LSP 时也能提供可用的文件级导航。 */
type CodeOutlineItem = { line: number; level: number; text: string; kind: string }
const codeOutlineOf = (text: string): CodeOutlineItem[] => {
  const items: CodeOutlineItem[] = []
  text.split(NEWLINE).forEach((line, index) => {
    const match = line.match(
      /^\s*(?:export\s+)?(?:default\s+)?(function|class|interface|type|enum|const|let|var|def|func)\s+([A-Za-z_$][\w$]*)/,
    )
    if (!match) return
    const kind = match[1]!
    const name = match[2]!
    items.push({
      line: index + 1,
      level: kind === "const" || kind === "let" || kind === "var" ? 2 : 1,
      text: name,
      kind,
    })
  })
  return items.slice(0, 300)
}

const inlineErrorText = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string" && error) return error
  if (typeof error === "object" && error !== null) {
    const value = error as { data?: { message?: unknown }; name?: unknown }
    if (typeof value.data?.message === "string" && value.data.message) return value.data.message
    if (typeof value.name === "string" && value.name) return value.name
  }
  return "AI 没有返回可用的修改结果"
}

/** 纯文本编辑命令的 id：工具栏、快捷键、命令面板共用同一批。 */
type TextCommandId =
  | "comment"
  | "indent"
  | "outdent"
  | "moveUp"
  | "moveDown"
  | "delete"
  | "duplicate"
  | "upper"
  | "lower"
  | "title"
  | "tabs"
  | "spaces"

const TEXT_COMMAND_IDS: ReadonlySet<string> = new Set<TextCommandId>([
  "comment",
  "indent",
  "outdent",
  "moveUp",
  "moveDown",
  "delete",
  "duplicate",
  "upper",
  "lower",
  "title",
  "tabs",
  "spaces",
])

/**
 * 纯文本编辑器的自动换行开关。
 *
 * 这是**视图偏好**，不属于某个文件：在模块级放一份，切标签时不会跳回默认值；
 * 顺手写进 localStorage，重启后还是用户上次选的。写盘失败（隐私模式/配额满）
 * 就只在本会话生效 —— 视图开关不值得弹错误。
 */
const WRAP_STORAGE_KEY = "novaway.textEditor.wrap"
const readWrapPreference = (): boolean => {
  try {
    return globalThis.localStorage?.getItem(WRAP_STORAGE_KEY) === "1"
  } catch {
    return false
  }
}
const [editorWrap, setEditorWrapSignal] = createSignal(readWrapPreference())
const setEditorWrap = (value: boolean) => {
  setEditorWrapSignal(value)
  try {
    globalThis.localStorage?.setItem(WRAP_STORAGE_KEY, value ? "1" : "0")
  } catch {
    // 记不住就算了，本会话内的切换仍然有效。
  }
}

/** 专注模式与打字机滚动（两个写作辅助开关）。 */
const readBooleanPreference = (key: string): boolean => {
  try {
    return globalThis.localStorage?.getItem(key) === "1"
  } catch {
    return false
  }
}
const writeBooleanPreference = (key: string, value: boolean) => {
  try {
    globalThis.localStorage?.setItem(key, value ? "1" : "0")
  } catch {
    // 同上：偏好记不住不影响本次会话。
  }
}
const FOCUS_STORAGE_KEY = "novaway.textEditor.focus"
const TYPEWRITER_STORAGE_KEY = "novaway.textEditor.typewriter"
const [focusMode, setFocusModeSignal] = createSignal(readBooleanPreference(FOCUS_STORAGE_KEY))
const setFocusMode = (value: boolean) => {
  setFocusModeSignal(value)
  writeBooleanPreference(FOCUS_STORAGE_KEY, value)
}
const [typewriter, setTypewriterSignal] = createSignal(readBooleanPreference(TYPEWRITER_STORAGE_KEY))
const setTypewriter = (value: boolean) => {
  setTypewriterSignal(value)
  writeBooleanPreference(TYPEWRITER_STORAGE_KEY, value)
}

/**
 * 「选择打开应用」里最近一次用过的应用（编辑器 / Office 应用 / 系统默认），
 * 菜单里给它打勾。跨标签共享、写 localStorage，重启后还记得。
 */
const OPEN_WITH_STORAGE_KEY = "novaway.openWith.last"
const readLastOpenWith = (): string => {
  try {
    return globalThis.localStorage?.getItem(OPEN_WITH_STORAGE_KEY) ?? ""
  } catch {
    return ""
  }
}
const [lastOpenWith, setLastOpenWithSignal] = createSignal(readLastOpenWith())
const rememberOpenWith = (id: string) => {
  setLastOpenWithSignal(id)
  try {
    globalThis.localStorage?.setItem(OPEN_WITH_STORAGE_KEY, id)
  } catch {
    // 记不住不影响本次打开。
  }
}

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

function PluginFilePreviewerHost(props: {
  previewer?: ReturnType<typeof pluginFilePreviewer>
  active: boolean
  children: JSX.Element
}) {
  const supported = () => props.active && props.previewer?.render !== undefined
  return (
    <Show when={supported()} fallback={props.children}>
      <div
        data-slot="plugin-file-previewer"
        data-plugin-id={props.previewer?.pluginID}
        data-previewer-id={props.previewer?.localName}
        data-view-id={props.previewer?.viewId}
        class="size-full"
      >
        <PluginViewHost
          pluginID={props.previewer!.pluginID}
          viewID={props.previewer?.viewId ?? props.previewer?.localName}
          render={props.previewer!.render}
          data={{ preview: true, pluginID: props.previewer?.pluginID, path: undefined }}
        />
      </div>
    </Show>
  )
}

export function FileTabContent(props: { tab: string }) {
  const file = useFile()
  const comments = useComments()
  const sideChat = useSideChat()
  const language = useLanguage()
  const prompt = usePrompt()
  const settings = useSettings()
  const sdk = useSDK()
  const local = useLocal()
  const globalSync = useGlobalSync()
  const [directoryStore] = globalSync.child(sdk.directory, { bootstrap: false })
  const activePluginOfficeExtensions = createMemo(() => pluginOfficeExtensions(directoryStore.plugin_contributions))
  const isActivePluginOfficePath = (target: string | undefined) =>
    isPluginOfficePath(target, [{ kind: "office-engine", extensions: activePluginOfficeExtensions() }])
  const dialog = useDialog()
  // 加密 PDF 的密码只存在当前标签页内存里：按文件路径记，切标签回来不用再输一次。
  const [officePasswords, setOfficePasswords] = createSignal<Record<string, string>>({})
  const [officeDirty, setOfficeDirty] = createSignal(false)
  const [mediaTicket, setMediaTicket] = createSignal<{ path: string; ticket: string; refreshed?: boolean }>()
  const [mediaFailure, setMediaFailure] = createSignal<{ path: string; message: string }>()
  // 用户取消过密码框的 PDF：预览回退给 Chromium 自己问，不反复弹。
  const [pdfPasswordSkipped, setPdfPasswordSkipped] = createSignal<Record<string, true>>({})
  // 草稿按工作区隔离：两个工作区里的同名相对路径不能互相串。
  setDraftScope(sdk.directory)
  const platform = usePlatform()
  const server = useServer()
  const [installedEditors, setInstalledEditors] = createSignal<InstalledEditor[]>([])
  const [officeApps, setOfficeApps] = createSignal<OfficeApp[]>([])
  /** 当前文件的系统关联图标（「系统默认应用」条目用，例如 .docx 显示 Word 图标）。 */
  const [defaultAppIcon, setDefaultAppIcon] = createSignal<string | undefined>()
  const [systemAppIcons, setSystemAppIcons] = createSignal<Record<string, string>>({})
  const [terminalApp, setTerminalApp] = createSignal("powershell.exe")
  const preview = usePreview()
  const layout = useLayout()
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
  const activeFilePreviewer = createMemo(() => pluginFilePreviewer(path(), directoryStore.plugin_contributions))
  // 关闭守卫由 Office 编辑器保活缓存常驻注册（见 office-editor-keepalive）：
  // 标签 inactive 时编辑器仍保活，守卫读缓存实例的脏状态，关闭照样能拦截。
  createEffect(() => {
    if (platform.platform !== "desktop" || !platform.getInstalledEditors) {
      setInstalledEditors([])
      return
    }
    let active = true
    void platform
      .getInstalledEditors()
      .then((editors) => {
        if (active) setInstalledEditors(editors)
      })
      .catch(() => {
        if (active) setInstalledEditors([])
      })
    onCleanup(() => {
      active = false
    })
  })
  createEffect(() => {
    if (platform.platform !== "desktop" || !platform.resolveAppPath || !platform.getFileIcon) return
    let active = true
    const names = platform.os === "windows" ? ["explorer.exe", "wt.exe", "powershell.exe", "cmd.exe"] : []
    void (async () => {
      const icons: Record<string, string> = {}
      for (const name of names) {
        const resolved = await platform.resolveAppPath?.(name).catch(() => null)
        if (!resolved) continue
        const icon = await platform.getFileIcon?.(resolved).catch(() => null)
        if (icon) icons[name] = icon
      }
      if (!active) return
      setSystemAppIcons(icons)
      if (icons["wt.exe"]) setTerminalApp("wt.exe")
      else if (icons["powershell.exe"]) setTerminalApp("powershell.exe")
      else if (icons["cmd.exe"]) setTerminalApp("cmd.exe")
    })()
    onCleanup(() => {
      active = false
    })
  })

  createEffect(() => {
    if (platform.platform !== "desktop" || !platform.getOfficeApps) {
      setOfficeApps([])
      return
    }
    let active = true
    void platform
      .getOfficeApps()
      .then((apps) => {
        if (active) setOfficeApps(apps)
      })
      .catch(() => {
        if (active) setOfficeApps([])
      })
    onCleanup(() => {
      active = false
    })
  })
  // 该文件在当前会话里有没有改动。有的话预览直接走「变更前后对照」，
  // 而不是把改动后的内容当普通文本铺开 —— 用户点的是"变更里的文件"。
  const sessionDiff = useSessionDiff()
  /** 保存冲突时「看差异」的临时对照：磁盘版本 vs 当前草稿。有值就优先展示。 */
  const [conflictDiff, setConflictDiff] = createSignal<{ before: string; after: string }>()
  /** 「与文件对比」的临时对照：当前文件 vs 另一个打开的文件。 */
  const [compareDiff, setCompareDiff] = createSignal<{ before: string; after: string; label: string }>()
  const diff = createMemo(() => {
    const compare = compareDiff()
    if (compare) {
      return diffFromContents({
        file: compare.label,
        before: compare.before,
        after: compare.after,
        status: "modified",
      })
    }
    const conflict = conflictDiff()
    if (conflict) {
      return diffFromContents({
        file: path() ?? "",
        before: conflict.before,
        after: conflict.after,
        status: "modified",
      })
    }
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
  createEffect(on(path, () => setOfficeDirty(false)))
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
      const parsed = parsePatchPreservingCarriageReturns(view.patch)
      if (parsed.length === 0) return undefined
      const before = applyPatch(current, reversePatch(parsed[0]!))
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
  // 从文件树/普通入口打开时默认看「文件」；变更列表会显式请求「改动」，跟随标签也单独强制看改动。
  const [viewMode, setViewMode] = createSignal<"diff" | "file">("file")
  // 离开「看差异」视图时清掉冲突对照和文件对比，diff 回到会话变更数据。
  createEffect(
    on(viewMode, (mode) => {
      if (mode !== "diff") {
        setConflictDiff(undefined)
        setCompareDiff(undefined)
      }
    }),
  )
  // 办公文件是二进制，diff 渲染器没有可展示的行；直接走只读预览。
  const isMarkdown = createMemo(() => /\.(md|markdown|mdx)$/i.test(path() ?? ""))
  // .csv 默认给表格视图（像 Excel 一样点格子改），需要看原文时切回「文本」。
  // 两种视图改的都是同一份 draft，不存在第二条写盘通道。
  const isCsv = createMemo(() => /\.csv$/i.test(path() ?? ""))
  const [csvMode, setCsvMode] = createSignal<"grid" | "text">("grid")
  // HTML/XHTML 也是"网页"：在右栏的浏览器标签里按真实渲染效果预览，
  // 但文件本身默认使用代码编辑器；浏览器预览只是一个显式动作。
  const isHtml = createMemo(() => /\.(html?|xhtml)$/i.test(path() ?? ""))
  // Markdown 默认渲染成阅读视图；
  // 点「编辑」才进入源码（或实况）视图。阅读优先，编辑按需。
  const [markdownMode, setMarkdownMode] = createSignal<"live" | "preview" | "source">("live")
  // 打开即可编辑，不需要额外的「编辑」开关或双击。
  const [editing, setEditing] = createSignal(true)
  const canEdit = createMemo(() => {
    const current = path()
    if (!current || !state()?.loaded) return false
    if (isImagePreviewPath(current) || isLegacyPreviewPath(current)) return false
    if (isOfficePreviewPath(current)) return false
    const previewer = activeFilePreviewer()
    if (previewer?.viewId === "novaway.office.file") return !previewer.readOnly
    return state()?.content?.type !== "binary"
  })
  const editLabel = createMemo(() => language.t("common.edit"))
  const toggleEditing = () => {
    const next = !editing()
    setEditing(next)
    if (!isMarkdown()) return
    if (next) {
      if (markdownMode() === "preview") setMarkdownMode("live")
      return
    }
    setMarkdownMode("preview")
  }
  const selectMarkdownMode = (mode: "live" | "preview" | "source") => {
    setMarkdownMode(mode)
    setEditing(mode !== "preview")
  }
  createEffect(on(path, () => setEditing(true)))

  // 切换文件时恢复这个文件上次用的视图（实况/阅读/源码），没有就回到阅读。
  // 切走再切回来，看的方式也还在。
  createEffect(
    on(path, (next) => {
      if (!/\.(md|markdown|mdx)$/i.test(next ?? "")) return
      // 跟写窗口里别把 Markdown 掰回排版视图：用户要看的是"改了什么"。
      if (followTab()) return
      setViewMode("file")
      const remembered = next ? viewModeOf(next) : undefined
      setMarkdownMode(remembered === "live" || remembered === "source" ? remembered : "live")
    }),
  )

  createEffect(() => {
    const current = path()
    if (!current || !isMarkdown()) return
    rememberViewMode(current, markdownMode())
  })

  // CSV 同理：记住上次是格子视图还是文本视图（默认格子）。
  createEffect(
    on(path, (next) => {
      if (!/\.csv$/i.test(next ?? "")) return
      setCsvMode(viewModeOf(next ?? "") === "text" ? "text" : "grid")
    }),
  )

  createEffect(() => {
    const current = path()
    if (!current || !isCsv()) return
    rememberViewMode(current, csvMode())
  })

  // 认领为跟随标签时把视图切到「改动」（只切一次，之后用户自己切换不再抢）。
  let forcedDiffForFollow = false
  createEffect(() => {
    if (!followTab() || forcedDiffForFollow) return
    forcedDiffForFollow = true
    setViewMode("diff")
  })

  createEffect(() => {
    const current = path()
    if (!current || followTab()) return
    const requested = previewOpenModeOf(sdk.directory, current)
    setViewMode(requested === "diff" ? "diff" : "file")
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
  // 语法着色层是否与 draft 一致：只有一致时 textarea 的字才透明
  // （否则刚打的字会隐身）。着色在停顿后完成，见 code-highlight.tsx。
  const [highlightSynced, setHighlightSynced] = createSignal(false)
  // textarea 的滚动位置：着色层没有自己的滚动条，靠这个 translate 跟随。
  const [editorScroll, setEditorScroll] = createSignal({ top: 0, left: 0 })
  // 状态栏：光标行列 + 全文行数/字符数，有选区时再显示选中长度。
  const [caretAt, setCaretAt] = createSignal(0)
  const [selectionLength, setSelectionLength] = createSignal(0)
  // 代码/文本缩放百分比：100 = 原始；对整块编辑器（行号 + 着色层 + textarea）整体放大，
  // 三者同步缩放，不会出现行号对不上文字的情况。
  const [fontZoom, setFontZoom] = createSignal(100)
  // 快捷键帮助浮层：从头部「⋯」菜单打开，Esc 关闭。
  const [shortcutHelpOpen, setShortcutHelpOpen] = createSignal(false)
  const caretInfo = createMemo(() => caretPosition(draft(), caretAt()))
  const editorStats = createMemo(() => textStats(draft()))
  const syncCaret = (element: HTMLTextAreaElement) => {
    syncCaretPosition(element.selectionStart, element.selectionEnd)
  }
  const syncCaretPosition = (anchor: number, head: number) => {
    setCaretAt(head)
    setSelectionLength(Math.abs(head - anchor))
  }
  const highlightLanguage = createMemo(() => syntaxLanguageOf(path()))
  // 有选区时也让文本框自己画字：透明文字的选区只会显示一块底色、看不到字，
  // 选中后回到普通文本（取消选区、颜色再回来）比「选中的字消失」好。
  const highlightOn = createMemo(
    () => !editorWrap() && highlightLanguage() !== undefined && highlightSynced() && selectionLength() === 0,
  )
  // 换文件时先当作「没同步」：新文件的着色要重新算，期间必须让文字可见。
  createEffect(on(path, () => setHighlightSynced(false)))
  createEffect(
    on(path, () => {
      setCaretAt(0)
      setSelectionLength(0)
    }),
  )
  // 自动换行开关会挂载/卸载着色层，同样先回到普通文本。
  createEffect(on(editorWrap, () => setHighlightSynced(false)))
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
   * 选中一段代码后浮出的动作菜单。
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
  const [selectionMenuComment, setSelectionMenuComment] = createSignal("")
  const [inlineEditBusy, setInlineEditBusy] = createSignal(false)
  let inlineEditAbort: (() => void) | undefined
  onCleanup(() => inlineEditAbort?.())
  let editorRef: HTMLTextAreaElement | CodeEditorHandle | undefined
  let gutterRef: HTMLDivElement | undefined
  let viewRestoreFrame: number | undefined
  let contentRef: HTMLDivElement | undefined
  let contextCommentInputRef: HTMLTextAreaElement | undefined
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  // Signals update reactively, but saveEditing awaits a disk read before setting
  // `saving`. Keep a synchronous guard as well so blur, Ctrl+S, and the debounce
  // timer cannot start duplicate writes during that gap.
  let saveInFlight = false
  let findInputRef: HTMLInputElement | undefined
  // 跳转到行：一个很小的输入条，回车定位，Esc 关闭。
  const [gotoOpen, setGotoOpen] = createSignal(false)
  const [gotoValue, setGotoValue] = createSignal("")
  let gotoInputRef: HTMLInputElement | undefined
  /**
   * 查找 / 替换的状态。
   *
   * 匹配计算是纯函数（`@novaway/core/office/text/search`），
   * 这里只负责把结果定位到 textarea 的选区上，不额外维护第二份文档状态。
   */
  const [findOpen, setFindOpen] = createSignal(false)
  const [findReplaceOpen, setFindReplaceOpen] = createSignal(false)
  const [findQuery, setFindQuery] = createSignal("")
  const [findReplacement, setFindReplacement] = createSignal("")
  const [findCaseSensitive, setFindCaseSensitive] = createSignal(false)
  const [findRegex, setFindRegex] = createSignal(false)
  const [findWholeWord, setFindWholeWord] = createSignal(false)
  const [findActive, setFindActive] = createSignal(0)
  const selectedLines = createMemo<SelectedLineRange | null>(() => {
    const p = path()
    if (!p) return null
    if (file.ready()) return (file.selectedLines(p) as SelectedLineRange | undefined) ?? null
    return (getSessionHandoff(sessionKey())?.files[p] as SelectedLineRange | undefined) ?? null
  })
  /**
   * 记下当前编辑器的光标 / 选区 / 滚动位置。
   *
   * 标签切走时整块 DOM 会被销毁（见 session-side-panel 的 keyed Show），
   * 所以只能在这里抓一份纯数据，切回来再还原 ——「切走再切回，
   * 光标和滚动位置都在」在宿主这一层实现。
   */
  const captureView = (): EditorViewState | undefined => {
    const el = editorRef
    if (!el) return undefined
    return {
      selectionStart: el.selectionStart,
      selectionEnd: el.selectionEnd,
      scrollTop: el.scrollTop,
      scrollLeft: el.scrollLeft,
    }
  }

  /** 等这一帧的 DOM 落地后再还原：刚 setDraft 时 textarea 里还是旧值，偏移会被夹错。 */
  const queueRestoreView = () => {
    if (viewRestoreFrame !== undefined) cancelAnimationFrame(viewRestoreFrame)
    viewRestoreFrame = requestAnimationFrame(() => {
      viewRestoreFrame = undefined
      const el = editorRef
      const p = path()
      if (!el || !p) return
      const view = viewOf(p)
      if (!view) return
      el.scrollTop = view.scrollTop
      el.scrollLeft = view.scrollLeft
      if (gutterRef) gutterRef.scrollTop = view.scrollTop
      // 文件被别处改短了：偏移量要夹回当前长度，否则 setSelectionRange 会抛错。
      const length = el.value.length
      el.setSelectionRange(Math.min(view.selectionStart, length), Math.min(view.selectionEnd, length))
    })
  }

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

  /** 读磁盘当前内容（不更新缓存）：项目外文件走本地，项目内走 SDK。失败返回 null。 */
  const readDiskContent = async (target: string): Promise<string | null> => {
    try {
      if (file.isExternal(target) && platform.readLocalFileText) {
        return await platform.readLocalFileText(target)
      }
      const x = await sdk.client.file.read({ path: target })
      if (x.error) return null
      return x.data?.content ?? null
    } catch {
      return null
    }
  }

  /** 「与文件对比」：选另一个打开的文件，用 diff 渲染器并排展示两个文件的差异。 */
  const compareWithFile = () => {
    const p = path()
    if (!p) return
    const others = tabs()
      .all()
      .map((tab) => file.pathFromTab(tab))
      .filter((other): other is string => !!other && other !== p)
    if (others.length === 0) {
      showToast({ variant: "default", title: language.t("session.filePreview.compareEmpty") })
      return
    }
    void dialog.show(
      () => (
        <div class="flex w-[380px] flex-col gap-1 p-4">
          <span class="text-14-medium text-foreground">{language.t("session.filePreview.compareTitle")}</span>
          <div class="mt-2 flex max-h-[320px] flex-col gap-0.5 overflow-y-auto">
            <For each={others}>
              {(other) => (
                <button
                  type="button"
                  class="flex items-center gap-2 rounded-md px-3 py-2 text-left text-13-regular text-foreground transition-colors hover:bg-hover"
                  onClick={() => {
                    dialog.close()
                    void startCompare(other)
                  }}
                >
                  <span class="truncate">{other.split("/").pop()}</span>
                  <span class="ml-auto max-w-[180px] shrink-0 truncate text-11-regular text-foreground-subtle">
                    {other}
                  </span>
                </button>
              )}
            </For>
          </div>
        </div>
      ),
      () => {},
    )
  }

  const startCompare = async (other: string) => {
    const p = path()
    if (!p) return
    const before = draft() || contents()
    const after = await readDiskContent(other)
    if (after === null) {
      showToast({ variant: "error", title: language.t("common.requestFailed") })
      return
    }
    const label = `${p.split("/").pop()} ↔ ${other.split("/").pop()}`
    setCompareDiff({ before, after, label })
    setDiffStyle("split")
    setViewMode("diff")
  }

  /** 弹出「磁盘已被外部修改」冲突框，返回用户选择（取消 → "cancel"）。 */
  const promptConflict = (target: string, disk: string, draftText: string) =>
    new Promise<"keepMine" | "useDisk" | "diff" | "cancel">((resolve) => {
      let settled = false
      const finish = (value: "keepMine" | "useDisk" | "diff" | "cancel") => {
        if (settled) return
        settled = true
        resolve(value)
      }
      dialog.show(
        () => (
          <ConflictDialog
            file={target}
            disk={disk}
            draft={draftText}
            onKeepMine={() => finish("keepMine")}
            onUseDisk={() => finish("useDisk")}
            onSeeDiff={() => finish("diff")}
          />
        ),
        () => finish("cancel"),
      )
    })

  const saveEditing = async () => {
    const p = path()
    if (!p || saving() || saveInFlight) return
    saveInFlight = true
    // 跟写期间编辑器里是「打字机还没打完」的内容：禁止自动保存把它写回磁盘。
    // 现在打字机只揭示新增行，草稿不再是磁盘内容的前缀，所以只要两者不一致就不保存。
    if (liveWrite() && draft() !== contents()) {
      saveInFlight = false
      return
    }
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = undefined
    }
    const snapshot = draft()
    // 磁盘被外部改过、且不是草稿已经等价的版本：不再静默覆盖，弹框让用户决定。
    const diskNow = await readDiskContent(p)
    if (diskNow !== null && detectSaveConflict(contents(), diskNow, snapshot)) {
      const decision = await promptConflict(p, diskNow, snapshot)
      if (decision === "cancel") {
        saveInFlight = false
        return
      }
      if (decision === "useDisk") {
        // 用磁盘的：重新载入最新内容并丢掉这份草稿（等效「丢弃恢复的草稿」）。
        setConflictDiff(undefined)
        await file.load(p, { force: true })
        setDraft(contents())
        clearDraft(p)
        setSaveError(false)
        saveInFlight = false
        return
      }
      if (decision === "diff") {
        // 看差异：切到磁盘版本 vs 草稿的对照，暂不写盘；决定权交回常规保存/丢弃。
        setConflictDiff({ before: diskNow, after: snapshot })
        setViewMode("diff")
        saveInFlight = false
        return
      }
      // keepMine：用草稿覆盖磁盘，继续走下面的写盘。
    }
    setSaving(true)
    setSaveError(false)
    try {
      if (isActivePluginOfficePath(p)) {
        if (diskNow === null) throw new Error("无法读取插件 Office 文件的当前版本")
        const expectedBaselineSha256 = await documentBytesSha256(new TextEncoder().encode(diskNow))
        await sdk.client.office.document.save({
          directory: sdk.directory,
          path: p,
          contentBase64: bytesToBase64(new TextEncoder().encode(snapshot)),
          expectedBaselineSha256,
        })
      } else {
        await file.write(p, snapshot)
      }
      setSaveError(false)
      // 写盘成功才清草稿；保存期间又敲进去的新字不会被这条清理带走。
      clearDraft(p, snapshot)
    } catch (error) {
      setSaveError(true)
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSaving(false)
      saveInFlight = false
    }
  }

  const scheduleSave = () => {
    setSaveError(false)
    // 设置里关掉自动保存：草稿留在标签里（状态条显示「未保存」），只有 ⌘/Ctrl+S 才写盘。
    if (!settings.general.autoSave()) {
      if (saveTimer) {
        clearTimeout(saveTimer)
        saveTimer = undefined
      }
      return
    }
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => void saveEditing(), 800)
  }

  /**
   * 图片编辑（旋转/翻转/裁剪/标注）写回：图片在文本通道里就是 base64 字符串，
   * 直接走 file.write 落盘，store 会更新 contents()，预览组件随之拿到新 base64。
   */
  const saveImage = async (base64: string) => {
    const p = path()
    if (!p) return
    try {
      await file.write(p, base64)
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  /**
   * 撤销栈本体是普通 Map（见 text-history.ts），改动不会触发信号。
   * 记一次历史就 +1，头部的撤销/重做按钮才有机会重新算「现在有没有得退」。
   */
  const [historyTick, setHistoryTick] = createSignal(0)
  const bumpHistory = () => setHistoryTick((tick) => tick + 1)

  /**
   * 记一步历史（命令类改动：编辑器命令、查找替换、实况预览提交）。
   * 光标位置沿用改动前的位置，撤销后大概回到原来那一段。
   */
  const rememberCommandChange = (before: string, after: string) => {
    if (after === before) return
    const target = path()
    if (!target) return
    const anchor = Math.max(0, Math.min(caretAt(), before.length))
    const head = Math.max(anchor, Math.min(anchor + selectionLength(), before.length))
    recordTextChange(target, { text: before, anchor, head }, { text: after, anchor, head }, "command")
    bumpHistory()
  }

  /**
   * 恢复一步历史：换草稿、走同一条防抖保存，并把光标 / 选区放回去。
   * 结构化视图里没有 textarea，选区恢复留给下一次挂载。
   */
  const restoreTextSnapshot = (snapshot: TextSnapshot) => {
    if (snapshot.text !== draft()) {
      setDraft(snapshot.text)
      const target = path()
      if (target) rememberDraft(target, snapshot.text)
      scheduleSave()
    }
    requestAnimationFrame(() => {
      const element = editorRef
      if (!element) return
      const clamp = (value: number) => Math.max(0, Math.min(snapshot.text.length, value))
      const anchor = clamp(snapshot.anchor)
      const head = clamp(snapshot.head)
      element.focus()
      element.setSelectionRange(anchor, head)
      setCaretAt(head)
      setSelectionLength(Math.abs(head - anchor))
    })
  }

  /**
   * 退/进一步（本地 textarea 栈）。返回是否真的动了：
   * 自己没记过这一步时放行给浏览器，保留原生打字手感。
   */
  const stepTextHistory = (direction: "undo" | "redo") => {
    const target = path()
    if (!target) return false
    const element = editorRef
    // CSV 表格视图里没有 textarea：光标用最近记下的位置，历史照样能退。
    const anchor = element ? element.selectionStart : Math.min(caretAt(), draft().length)
    const head = element ? element.selectionEnd : Math.min(anchor + selectionLength(), draft().length)
    const current = { text: draft(), anchor, head }
    const snapshot = direction === "undo" ? undoText(target, current) : redoText(target, current)
    if (!snapshot) return false
    restoreTextSnapshot(snapshot)
    bumpHistory()
    return true
  }

  /**
   * 结构化视图（CSV 表格、Markdown 实况预览）改完内容：
   * 只换草稿，然后走同一条防抖保存（不新增写盘通道）。
   */
  const applyDraftText = (next: string) => {
    if (next === draft()) return
    rememberCommandChange(draft(), next)
    setDraft(next)
    const p = path()
    if (p) rememberDraft(p, next)
    scheduleSave()
  }

  const saveStatus = createMemo(() => {
    if (saving()) return "saving"
    if (saveError()) return "error"
    if (officeDirty()) return "dirty"
    // 跟写期间 draft 落后于磁盘是**预期**的（打字机还在打），不能提示「未保存」。
    if (liveWrite() && draft() !== contents()) return "saved"
    if (draft() !== contents()) return "dirty"
    return "saved"
  })

  const textareaSelection = (element?: HTMLTextAreaElement | CodeEditorHandle): SelectedLineRange | undefined => {
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

  /**
   * 在临时会话中请求一份替换代码，并把结果直接写回当前编辑器。
   * 这是编辑器内的修改，不会把一次性的 inline edit 污染到主会话时间线。
   */
  const applyAIInlineEdit = async (selection: SelectedLineRange, comment: string) => {
    const target = path()
    const source = editorRef?.value ?? draft()
    const agent = local.agent.current()?.name
    const model = local.model.current()
    if (!target || !source || !agent || !model) {
      showToast({
        variant: "error",
        title: "无法执行 AI 修改",
        description: "请先打开代码文件，并确认已经选择了可用的模型和 Agent。",
      })
      return
    }

    const start = Math.max(1, Math.min(selection.start, selection.end))
    const end = Math.max(start, Math.max(selection.start, selection.end))
    const startOffset = offsetOfLine(source, start)
    const selectedLineStart = offsetOfLine(source, end)
    const newlineAt = source.indexOf("\n", selectedLineStart)
    // 只替换选中的整行，不吞掉选区后面的换行符；这样模型返回的代码
    // 不需要额外猜测末尾是否要补换行，也能保持原文件的行结构。
    const endOffset = newlineAt === -1 ? source.length : newlineAt - (source[newlineAt - 1] === "\r" ? 1 : 0)
    const selected = source.slice(startOffset, endOffset)
    const instruction = comment.trim() || "按要求改进这段代码。"
    const promptText = [
      "你是 NovaWay 代码编辑器的 inline edit 引擎。",
      "只返回可以直接替换 <selected_code> 内容的完整代码，不要解释，不要 Markdown 说明，不要返回代码围栏。",
      "不要调用工具，不要读取或修改任何文件；保留原编程语言、必要的缩进和代码风格。",
      `文件：${target}`,
      `用户修改要求：${instruction}`,
      "<selected_code>",
      selected,
      "</selected_code>",
    ].join("\n")

    if (inlineEditBusy()) return
    setInlineEditBusy(true)
    const controller = new AbortController()
    let temporarySessionID: string | undefined
    const cancel = () => {
      controller.abort()
      if (temporarySessionID) void sdk.client.session.abort({ sessionID: temporarySessionID }).catch(() => undefined)
    }
    inlineEditAbort = cancel
    try {
      const created = await sdk.client.session.create({
        directory: sdk.directory,
        title: `Inline edit · ${target}`,
        agent,
        model: {
          id: model.id,
          providerID: model.provider.id,
          variant: local.model.variant.current(),
        },
      })
      temporarySessionID = created.data?.id
      if (!temporarySessionID) throw new Error("临时 AI 会话创建失败")

      await sdk.client.session.promptAsync(
        {
          sessionID: temporarySessionID,
          agent,
          model: { providerID: model.provider.id, modelID: model.id },
          variant: local.model.variant.current(),
          format: { type: "text" },
          tools: {
            read: false,
            glob: false,
            grep: false,
            bash: false,
            shell: false,
            write: false,
            edit: false,
            apply_patch: false,
            patch: false,
            task: false,
          },
          system: "你只负责生成 inline edit 的替换文本。严禁调用工具、写入文件或输出解释；最终回答必须是完整替换代码。",
          parts: [{ type: "text", text: promptText }],
        },
        { signal: controller.signal },
      )

      const deadline = Date.now() + 120_000
      let answer = ""
      while (Date.now() < deadline) {
        const messages = await sdk.client.session.messages(
          { sessionID: temporarySessionID, limit: 100 },
          { signal: controller.signal },
        )
        const entries = messages.data ?? []
        const assistant = entries
          .filter((entry) => entry.info.role === "assistant")
          .sort((left, right) => left.info.time.created - right.info.time.created)
          .at(-1)
        if (assistant?.info.role === "assistant") {
          if (assistant.info.error) throw new Error(inlineErrorText(assistant.info.error))
          if (typeof assistant.info.time.completed === "number") {
            answer = assistant.parts
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join(NEWLINE)
            if (!answer.trim()) throw new Error("AI 没有返回可用的修改结果")
            break
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 450))
      }
      if (!answer) throw new Error("AI 修改超时，请稍后重试")

      // 模型运行期间用户可能已经手动编辑或切换了文件；这种情况下不能覆盖新内容。
      const current = path()
      const currentSource = editorRef?.value ?? draft()
      if (current !== target || currentSource !== source) {
        throw new Error("文件在 AI 修改期间发生了变化，未覆盖你的最新内容")
      }

      const inline = applyInlineReplacement(source, { start, end }, answer)
      if (!inline) throw new Error("AI 返回了空的替换代码或修改没有产生变化")
      const { replacement, start: replacementStart, end: replacementEnd } = inline
      const next = inline.text
      const nextEnd = replacementStart + replacement.length
      recordTextChange(
        target,
        { text: source, anchor: replacementStart, head: replacementEnd },
        { text: next, anchor: replacementStart, head: nextEnd },
        "command",
      )
      bumpHistory()
      setDraft(next)
      rememberDraft(target, next)
      scheduleSave()
      requestAnimationFrame(() => {
        if (path() !== target) return
        const element = editorRef
        if (!element) return
        element.focus()
        element.setSelectionRange(startOffset, nextEnd)
        syncCaretPosition(startOffset, nextEnd)
      })
      showToast({ variant: "success", title: "AI 修改已应用" })
    } catch (error) {
      if (!controller.signal.aborted) {
        showToast({ variant: "error", title: "AI 修改失败", description: inlineErrorText(error) })
      }
    } finally {
      if (temporarySessionID) {
        await sdk.client.session
          .delete({ sessionID: temporarySessionID, directory: sdk.directory })
          .catch(() => undefined)
      }
      if (inlineEditAbort === cancel) inlineEditAbort = undefined
      setInlineEditBusy(false)
    }
  }

  /**
   * 阅读视图里点任务框：按渲染顺序找到第 index 个任务行，把 `[ ]` / `[x]` 翻过来。
   * 扫描和改写都用 core 的纯函数，跟实况预览的逐行切换是同一套语义。
   */
  const togglePreviewTask = (index: number) => {
    const source = draft()
    const at = taskLineOffsets(source)[index]
    if (at === undefined) return
    const edit = toggleTask(source, { anchor: at, head: at })
    if (edit) applyDraftText(applyTextEdit(source, edit))
  }

  /** `[[目标]]`：按当前笔记所在目录解析成工作区路径（和笔记侧栏的链接同一套规则）。 */
  const openWikiLink = (target: string) => {
    const current = path()
    if (!current) return
    openLinkedFile(resolveNotePath(current, target))
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
    if (/^(?:[a-zA-Z]:[\\/]|[\\/]{2}|\/)/.test(p)) return p
    const separator = sdk.directory.includes("\\") ? "\\" : "/"
    return `${sdk.directory.replace(/[\\/]+$/, "")}${separator}${p}`
  }

  /** 当前文件的系统关联图标：.docx 拿到 Word 图标，「系统默认应用」条目用它。 */
  createEffect(
    on(path, (current) => {
      setDefaultAppIcon(undefined)
      if (!current || platform.platform !== "desktop" || !platform.getFileIcon) return
      const absolute = absolutePath()
      if (!absolute) return
      let active = true
      void platform
        .getFileIcon(absolute)
        .then((icon) => {
          if (active && icon) setDefaultAppIcon(icon)
        })
        .catch(() => {})
      onCleanup(() => {
        active = false
      })
    }),
  )

  /** 用系统默认关联应用打开当前文件（工作区内外的本地文件都可以）。 */
  const openDefaultApp = async () => {
    const absolute = absolutePath()
    if (!absolute || !platform.openPath) return
    rememberOpenWith("default")
    try {
      await platform.openPath(absolute)
    } catch (error) {
      showToast({
        variant: "error",
        title: "无法启动默认应用",
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /** 用选中的本机编辑器 / Office 应用打开当前文件；外部文件也走本地通道。 */
  const openWithApp = async (appId: string) => {
    const absolute = absolutePath()
    const connection = server.current
    if (!absolute || !platform.openInEditor || !server.isLocal() || !connection) return
    rememberOpenWith(appId)
    const opened = await platform.openInEditor(appId, absolute, "file", connection)
    if (!opened) showToast({ variant: "error", title: language.t("session.filePreview.openFailed") })
  }

  const windowsTerminalCommand = (directory: string) => {
    const app = terminalApp()
    if (app === "wt.exe") return { command: "wt.exe", args: ["-d", directory] }
    if (app === "cmd.exe") return { command: "cmd.exe", args: ["/K", "cd", "/d", directory] }
    const escaped = directory.replaceAll("'", "''")
    return { command: "powershell.exe", args: ["-NoExit", "-Command", `Set-Location -LiteralPath '${escaped}'`] }
  }

  /** 在文件所在目录打开系统终端（Windows Terminal / macOS Terminal），失败回落集成终端。 */
  const openDirectoryInTerminal = () => {
    const absolute = absolutePath()
    if (!absolute) return
    const directory = absolute.replace(/[\\/][^\\/]*$/, "") || absolute
    const integrated = () => sdk.client.pty.create({ cwd: directory }).catch(() => {})
    if (platform.platform !== "desktop" || !server.isLocal()) {
      void integrated()
      return
    }
    const native =
      platform.os === "windows"
        ? windowsTerminalCommand(directory)
        : platform.os === "macos"
          ? { command: "open", args: ["-a", "Terminal", directory] }
          : undefined
    if (!native) {
      void integrated()
      return
    }
    void sdk.client.pty
      .create({ command: native.command, args: native.args, title: "terminal" })
      .catch(() => integrated())
  }

  /**
   * 「选择打开应用」下拉（头部右侧的分体按钮）：
   * Office 文档列出能打开它的本机 Office 应用（Word/Excel/PPT/WPS），
   * 普通工作区文件列出本机代码编辑器；两者都带真实应用图标，
   * 后面跟「系统默认应用 / 在资源管理器中显示 / 在终端中打开目录」。
   */
  const officeNativeMenu = (): PreviewMenuItem[] => {
    const p = path()
    if (!p) return []
    const absolute = absolutePath()
    const localDesktop = platform.platform === "desktop" && server.isLocal()
    const items: PreviewMenuItem[] = []
    if (localDesktop && absolute) {
      const extension = p.split(".").pop()?.toLowerCase() ?? ""
      const apps = isOfficePreviewPath(p)
        ? officeApps().filter((app) => app.extensions.includes(extension))
        : installedEditors()
      for (const app of apps) {
        items.push({
          id: `app-${app.id}`,
          label: app.name,
          iconSrc: app.icon,
          icon: "open-file",
          checked: lastOpenWith() === app.id,
          onSelect: () => void openWithApp(app.id),
        })
      }
      if (platform.openPath) {
        items.push({
          id: "default",
          label: language.t("session.filePreview.openDefaultApp"),
          iconSrc: defaultAppIcon(),
          icon: "lu-arrow-up-right",
          checked: lastOpenWith() === "default",
          onSelect: () => void openDefaultApp(),
        })
      }
      if (platform.showItemInFolder) {
        items.push({
          id: "show-folder",
          label: language.t("session.filePreview.revealInExplorer"),
          iconSrc: systemAppIcons()["explorer.exe"],
          icon: "folder",
          divider: items.length > 0 ? "before" : undefined,
          onSelect: () => void platform.showItemInFolder?.(absolute),
        })
      }
      items.push({
        id: "open-terminal",
        label: language.t(
          platform.os === "windows"
            ? "session.filePreview.openDirInTerminal.windows"
            : "session.filePreview.openDirInTerminal.other",
        ),
        iconSrc: systemAppIcons()[terminalApp()],
        icon: "terminal",
        onSelect: openDirectoryInTerminal,
      })
    }
    if (file.isExternal(p)) {
      items.push(
        {
          id: "copy-absolute",
          label: language.t("session.filePreview.copyAbsolutePath"),
          icon: "copy",
          divider: items.length > 0 ? "before" : undefined,
          onSelect: () => void writeClipboard(p),
        },
        {
          id: "copy-relative",
          label: language.t("session.filePreview.copyRelativePath"),
          icon: "copy",
          onSelect: () => void copyPath("relative"),
        },
      )
    }
    return items
  }

  /**
   * 在右栏浏览器里预览当前 HTML 文件.
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

  /** Office 编辑器的结构化选区（正文/单元格/幻灯片元素）加入当前会话。 */
  const addOfficeSelectionToTask = (text: string, source?: string, comment?: string) => {
    const p = path()
    const value = text.trim()
    if (!p || !value) return
    prompt.context.add({
      type: "quote",
      text: value,
      label: source ? `${p} · ${source}` : `${p} · ${language.t("session.selection.quoteLabel")}`,
      path: p,
      comment,
    })
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('[data-component="prompt-input"]')?.focus()
    })
  }

  /** 把选中的代码作为「引用」加到主输入框上方（与聊天区选中文字一致）。 */
  const addSelectionToTask = (selection: SelectedLineRange, comment?: string) => {
    const p = path()
    if (!p) return
    const start = Math.min(selection.start, selection.end)
    const end = Math.max(selection.start, selection.end)
    prompt.context.add({
      type: "quote",
      text: selectedCode(selection),
      label: `${p} ${start === end ? `第 ${start} 行` : `第 ${start}-${end} 行`}`,
      path: p,
      comment: comment?.trim() || undefined,
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

  const AI_ACTIONS = ["rewrite", "translate", "summarize", "explain"] as const
  type AiAction = (typeof AI_ACTIONS)[number]

  const aiActionInSideChat = (action: AiAction, selection: SelectedLineRange) => {
    const code = selectedCode(selection)
    if (!code.trim()) return
    const text = language.t(`session.selection.ai.${action}.prompt`, { code })
    void sideChat.open({ text })
  }

  /**
   * 文本域选区结束时浮出「在辅助对话中提问」。
   *
   * textarea 的选区拿不到 DOM Range，所以不复用聊天区那套
   * `window.getSelection()` 定位；这里用鼠标落点作为锚点，
   * 与代码编辑器（VS Code）的浮动菜单观感一致。
   */
  const handleEditorMouseUp = (event: MouseEvent) => {
    // 代码编辑器和旧 textarea 都通过同一个轻量句柄暴露选区，
    // 因此选区评论、引用和右键菜单不依赖具体编辑器内核。
    const element = editorRef
    const selected = textareaSelection(element)
    if (!element || !selected || element.selectionStart === element.selectionEnd) {
      setSelectionMenu(undefined)
      return
    }
    const rect = contentRef?.getBoundingClientRect()
    const menuWidth = 168
    const left = rect ? Math.max(8, Math.min(event.clientX - rect.left, rect.width - menuWidth - 8)) : event.clientX
    const top = rect ? Math.max(8, Math.min(event.clientY - rect.top + 10, rect.height - 44)) : event.clientY
    setSelectionMenuComment("")
    setSelectionMenu({ x: left, y: top, selection: selected })
  }

  const handleEditorMouseDown = () => {
    // 重新开始选之前先收起，避免菜单停在旧选区上。
    setSelectionMenu(undefined)
  }

  const handleEditorContextMenu = (event: MouseEvent) => {
    event.preventDefault()
    const element = editorRef
    const value = element?.value ?? draft()
    const rect = element?.getBoundingClientRect()
    const clickedLine = rect
      ? Math.max(
          1,
          Math.min(
            value.split("\n").length,
            Math.floor((event.clientY - rect.top + (element?.scrollTop ?? 0)) / 24) + 1,
          ),
        )
      : 1
    // 有选区就用选区，不受右键落点影响（编辑器里也是这个口径）。
    const selected = textareaSelection(element)
    const hasRange = !!element && !!selected && element.selectionStart !== element.selectionEnd
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
  /** 读取磁盘当前字节，用于保存前冲突检测（外部文件走本地通道）。 */
  const readOfficeDiskBytes = async (target: string): Promise<Uint8Array | undefined> => {
    try {
      if (file.isExternal(target)) {
        const base64 = await platform.readLocalFileBase64?.(target)
        return base64 ? base64ToBytes(base64) : undefined
      }
      const result = await sdk.client.file.read({ directory: sdk.directory, path: target, encoding: "base64" })
      if (result.error || !result.data?.content) return undefined
      return base64ToBytes(result.data.content)
    } catch {
      return undefined
    }
  }
  const writeOfficeEditorBytes = async (target: string, bytes: Uint8Array, expectedBaselineSha256?: string) => {
    const contentBase64 = bytesToBase64(bytes)
    if (file.isExternal(target)) {
      const ok = await platform.writeLocalFileBase64?.(target, contentBase64, expectedBaselineSha256)
      if (!ok)
        throw new Error(
          "本地 Office 文件保存失败：文件可能已被外部修改、不可写或桌面写入通道不可用。请重新读取后重试。",
        )
      return
    }
    await sdk.client.office.document.save({
      directory: sdk.directory,
      path: target,
      contentBase64,
      ...(expectedBaselineSha256 ? { expectedBaselineSha256 } : {}),
    })
  }
  const prepareLegacyOfficeEditor = async (sourcePath: string, _sourceBytes: Uint8Array) => {
    const extension = modernOfficeExtensionForLegacy(sourcePath)
    if (!extension) throw new Error("该旧格式没有对应的现代 Office 编辑器")
    if (file.isExternal(sourcePath)) {
      throw new Error("外部旧格式文件请先复制到工作区，再使用现代 Office 编辑器编辑")
    }

    // Export first, then seed a fresh modern sibling. The source legacy file is never written.
    const exported = await sdk.client.office.document.export({
      directory: sdk.directory,
      path: sourcePath,
      target: extension,
    })
    const data = exported.data as { content?: string; encoding?: "utf8" | "base64" } | undefined
    if (!data?.content || data.encoding !== "base64") throw new Error("旧格式转换结果不是有效的 Office 二进制内容")
    const converted = base64ToBytes(data.content)
    const stem = sourcePath.replace(/\.[^./\\]+$/, "")
    const targetPath = `${stem}-edited-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`
    await sdk.client.office.document.create({
      directory: sdk.directory,
      path: targetPath,
      title:
        targetPath
          .split(/[\\/]/)
          .pop()
          ?.replace(/\.[^.]+$/, "") ?? "Office document",
    })
    await sdk.client.office.document.save({
      directory: sdk.directory,
      path: targetPath,
      contentBase64: bytesToBase64(converted),
    })
    return { path: targetPath, bytes: converted }
  }

  /**
   * 保存前确认磁盘仍是编辑器打开时的版本。
   *
   * 编辑器拿的是打开那一刻的字节；AI 或外部程序在此期间改过文件时，
   * 直接整字节写回会把对方的改动抹掉，所以先比对，不一致就让用户选。
   */
  const confirmOfficeSave = async (target: string, baseline: Uint8Array): Promise<string | false> => {
    console.info("OFFICE_CONFIRM_SAVE_START", target)
    const disk = await readOfficeDiskBytes(target)
    console.info("OFFICE_CONFIRM_SAVE_READ", disk?.length ?? -1)
    if (!disk) {
      showToast({
        variant: "error",
        title: "无法检查文件是否已被外部修改",
        description: "为避免覆盖无法核对的文件，本次保存已取消。请确认文件仍可读取后重试。",
      })
      return false
    }
    if (sameDocumentBytes(disk, baseline)) {
      console.info("OFFICE_CONFIRM_SAVE_MATCH")
      return documentBytesSha256(disk)
    }
    showToast({
      variant: "default",
      title: "保存前发现磁盘已被外部修改",
      description: "确认覆盖后才会写回当前编辑器内容。",
    })
    const approved = await new Promise<boolean>((resolve) => {
      let settled = false
      const finish = (value: boolean) => {
        if (settled) return
        settled = true
        resolve(value)
      }
      void dialog.show(() => (
        <ConfirmDialog
          open
          variant="danger"
          title="文件已被外部修改"
          description="磁盘上的内容在编辑器打开后发生了变化。继续保存会覆盖外部改动；取消则保留编辑器里的内容，稍后可再保存。"
          confirmText="仍然覆盖"
          onConfirm={() => finish(true)}
          onClose={() => {
            dialog.close()
            finish(false)
          }}
        />
      ))
    })
    // 返回用户确认时观察到的版本摘要；服务端写入前还会再次做 CAS 检查。
    return approved ? documentBytesSha256(disk) : false
  }
  const saveMountedOfficeEditor = async () => {
    const target = officePath()
    if (!target || !officeDirty() || saving()) return
    setSaving(true)
    setSaveError(false)
    try {
      console.info("OFFICE_SAVE_START", target)
      const saved = await saveOfficeEditor(target)
      console.info("OFFICE_SAVE_DONE", saved)
      if (!saved) throw new Error("Office 编辑器尚未就绪，无法保存")
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
  const mediaRevision = createMemo(() => {
    const current = path()
    if (!current || !getFileMediaPreviewFormat(current)) return 0
    return file.revision(current)
  })
  const mediaPreviewUrl = createMemo(() => {
    const current = path()
    if (!current || !getFileMediaPreviewFormat(current)) return undefined
    if (file.isExternal(current)) {
      const localUrl = `file:///${current.replace(/\\/g, "/").replace(/^\/+/, "")}`
      return platform.toPreviewUrl?.(localUrl) ?? localUrl
    }
    const ticket = mediaTicket()
    if (ticket?.path !== current || !ticket) return undefined
    const url = new URL(`${sdk.url.replace(/\/+$/, "")}/file/media`)
    url.searchParams.set("path", current)
    url.searchParams.set("directory", sdk.directory)
    url.searchParams.set("ticket", ticket.ticket)
    url.searchParams.set("revision", String(mediaRevision()))
    return url.toString()
  })
  const issueMediaTicket = (current: string, refreshed = false) => {
    void sdk.client.pty.mediaToken({ path: current }).then((result) => {
      const payload = result.data as { ticket?: unknown } | undefined
      if (path() !== current) return
      if (typeof payload?.ticket !== "string") {
        setMediaFailure({ path: current, message: "无法获取媒体预览地址。" })
        return
      }
      setMediaFailure(undefined)
      setMediaTicket({ path: current, ticket: payload.ticket, refreshed })
    })
  }
  let mediaRefreshInFlight = false
  const mediaFailureForCurrent = () => {
    const failure = mediaFailure()
    if (failure && failure.path === path()) return failure.message
    return undefined
  }
  const refreshMediaTicket = () => {
    const current = path()
    if (
      !current ||
      !getFileMediaPreviewFormat(current) ||
      file.isExternal(current) ||
      mediaTicket()?.refreshed ||
      mediaRefreshInFlight
    )
      return
    mediaRefreshInFlight = true
    setMediaTicket(undefined)
    void sdk.client.pty
      .mediaToken({ path: current })
      .then((result) => {
        const payload = result.data as { ticket?: unknown } | undefined
        if (path() !== current) return
        if (typeof payload?.ticket !== "string") {
          setMediaFailure({ path: current, message: "无法获取媒体预览地址。" })
          return
        }
        setMediaFailure(undefined)
        setMediaTicket({ path: current, ticket: payload.ticket, refreshed: true })
      })
      .finally(() => {
        mediaRefreshInFlight = false
      })
  }
  createEffect(
    on(path, (current) => {
      setMediaTicket(undefined)
      setMediaFailure(undefined)
      if (!current || !getFileMediaPreviewFormat(current) || file.isExternal(current)) return
      issueMediaTicket(current)
    }),
  )
  /**
   * DOCX 画布改字：走和 Agent 相同的 office.document.edit。
   * 只发「哪一段、新文字」，服务端只重写 word/document.xml，其余包内条目不动。
   */
  /**
   * 富文本保存：设计视图只发被改过的那一段（setBlockHtml），
   * 结构操作（换标题、对齐）和源码视图发对应的 op。三者和 Agent 走同一套契约。
   */
  /**
   * 导出当前文件：只读，不写原文件。
   * 目标格式按文件类型给一组（xlsx → csv/tsv/html，csv → csv/tsv/md/html，
   * docx/pptx → md/txt，html → txt/html）。
   */
  // 预览区（不含顶栏）的 DOM：打印 / 导出 PDF 直接拿它，所见即所得。
  let bodyRef: HTMLDivElement | undefined
  const [exportingPdf, setExportingPdf] = createSignal(false)

  /** 代码 / 纯文本编辑器是 textarea，直接打印 DOM 是空白 —— 这类视图走等宽文本。 */
  const printTextOnly = () => {
    const current = path()
    if (!current) return true
    if (isImagePreviewPath(current)) return false
    if (isOfficePreviewPath(current)) return false
    if (current.toLowerCase().endsWith(".csv")) return false
    if (isMarkdown()) return markdownMode() === "source"
    return true
  }

  const printableBody = () => {
    if (printTextOnly()) return textToPrintHtml(draft())
    return bodyRef ? printableHtml(bodyRef) : textToPrintHtml(draft())
  }

  const printPreview = () => {
    const current = path()
    const name = (current?.split(/[\\/]/).pop() ?? "文档").replace(/\.[^.]+$/, "")
    if (!printHtml(printableBody(), name)) window.print()
  }

  /**
   * 导出 PDF：桌面端交给主进程的离屏 Chromium，和打印用的是同一份 HTML。
   * Web 上没有这条通道，退回打印对话框（用户在里面「另存为 PDF」）。
   */
  const exportPdf = async () => {
    const current = path()
    if (!current || exportingPdf()) return
    if (!platform.printToPdf || !platform.saveFilePickerDialog) {
      showToast({
        variant: "default",
        title: "请在打印对话框里选择「另存为 PDF」",
      })
      printPreview()
      return
    }
    setExportingPdf(true)
    try {
      const stem = current.replace(/\.[^.]+$/, "")
      const target = await platform.saveFilePickerDialog({ title: "导出 PDF", defaultPath: stem + ".pdf" })
      if (!target) return
      const name = (current.split(/[\\/]/).pop() ?? "文档").replace(/\.[^.]+$/, "")
      const ok = await platform.printToPdf({ html: documentHtml(name, printableBody()), filePath: target })
      if (!ok) throw new Error("PDF 生成失败")
      showToast({ variant: "success", title: "已导出 PDF", description: target })
    } catch (error) {
      showToast({
        variant: "error",
        title: "导出 PDF 失败",
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setExportingPdf(false)
    }
  }

  const exportTargets = createMemo(() => officeExportTargets(path()))

  const [exporting, setExporting] = createSignal(false)

  const confirmLegacyConversion = () =>
    new Promise<boolean>((resolve) => {
      let settled = false
      const finish = (value: boolean) => {
        if (settled) return
        settled = true
        resolve(value)
      }
      void dialog.show(() => (
        <ConfirmDialog
          open
          title="转换并另存为？"
          description="旧格式转换可能无法保留复杂版式、公式、动画或嵌入对象。将导出为一个新文件，不会覆盖原文件。"
          confirmText="继续导出副本"
          onConfirm={() => finish(true)}
          onClose={() => {
            dialog.close()
            finish(false)
          }}
        />
      ))
    })

  const saveOfficeCopy = async () => {
    const current = path()
    if (!current || exporting()) return
    setExporting(true)
    try {
      // Use the live editor snapshot, including unsaved changes. Never save the source first.
      const bytes = await snapshotOfficeEditor(current)
      if (!bytes) throw new Error("编辑器尚未就绪；请返回编辑器后重试另存副本。")
      const originalName = current.split(/[\\/]/).pop() ?? "document"
      const name = originalName.replace(/(\.[^.]+)$/, "-copy$1")
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/octet-stream" }))
      try {
        const anchor = document.createElement("a")
        anchor.href = url
        anchor.download = name
        anchor.style.position = "fixed"
        anchor.style.left = "-9999px"
        document.body.append(anchor)
        anchor.click()
        setTimeout(() => {
          anchor.remove()
          URL.revokeObjectURL(url)
        }, 1000)
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
    } catch (error) {
      showToast({
        variant: "error",
        title: "另存副本失败",
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setExporting(false)
    }
  }

  const runExport = async (target: string) => {
    const current = path()
    if (!current || exporting()) return
    setExporting(true)
    try {
      if (
        officeFormatOf(current) === "legacy" &&
        (target === "docx" || target === "xlsx" || target === "pptx") &&
        !(await confirmLegacyConversion())
      ) {
        return
      }
      // PNG 一次一页：默认出预览里正在看的那一页（PDF），其它格式是第 1 页。
      const page = target === "png" && officeFormatOf(current) === "pdf" ? pdfViewPage() : undefined
      const request = (password?: string) =>
        sdk.client.office.document.export({
          directory: sdk.directory,
          path: current,
          target,
          ...(password === undefined ? {} : { password }),
          ...(page === undefined ? {} : { page }),
        })
      const known = officePasswords()[current]
      let result: Awaited<ReturnType<typeof request>>
      try {
        result = await request(known)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        // 加密 PDF：先拿到密码再导出，和预览 / 编辑共用同一个密码缓存。
        if (!/密码/.test(message)) throw error
        const entered = await promptPdfPassword(
          current,
          known === undefined ? undefined : message,
          async (password) => {
            try {
              await request(password)
              setOfficePasswords((prev) => ({ ...prev, [current]: password }))
              return undefined
            } catch (failure) {
              return failure instanceof Error ? failure.message : String(failure)
            }
          },
        )
        if (entered === undefined) throw error
        result = await request(entered)
      }
      const data = result?.data as { content?: string; mime?: string; encoding?: "utf8" | "base64" } | undefined
      const content = data?.content
      if (typeof content !== "string") throw new Error("导出结果为空")
      // docx/xlsx/pptx 走 base64：先还原成字节，否则字符串会按 UTF-8 重新编码，文件就坏了。
      const payload: BlobPart = data?.encoding === "base64" ? base64ToBytes(content) : content
      // 用 Blob 下载：Web 与桌面端一致，也不会在磁盘上留下临时文件。
      const mime = data?.mime ?? "text/plain"
      const base = current.split("/").pop() ?? "document"
      const stem = base.replace(/\.[^.]+$/, "")
      const url = URL.createObjectURL(new Blob([payload], { type: mime }))
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = `${stem}.${target}`
      anchor.style.display = "none"
      document.body.append(anchor)
      anchor.click()
      setTimeout(() => {
        anchor.remove()
        URL.revokeObjectURL(url)
      }, 1000)
      showToast({
        variant: "success",
        title: page === undefined ? `已导出 ${stem}.${target}` : `已导出 ${stem}.${target}（第 ${page} 页）`,
      })
    } catch (error) {
      showToast({
        variant: "error",
        title: "导出失败",
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setExporting(false)
    }
  }

  /** 真正发出编辑请求；成功时刷新宿主撤销栈。 */
  const submitOfficeEdit = async (target: string, ops: RichOp[], password?: string) => {
    const response = await sdk.client.office.document.edit({
      directory: sdk.directory,
      path: target,
      ops: ops as never,
      ...(password === undefined ? {} : { password }),
    })
    readHistory(response)
    return target
  }

  /**
   * 弹出加密 PDF 的密码框，返回可用的密码（取消则 undefined）。
   * submit 返回 undefined 表示密码可用；预览和编辑各自提供自己的验证方式。
   */
  const promptPdfPassword = (
    target: string,
    hint: string | undefined,
    submit: (password: string) => Promise<string | undefined>,
  ) =>
    new Promise<string | undefined>((resolve) => {
      let settled = false
      const finish = (value: string | undefined) => {
        if (settled) return
        settled = true
        resolve(value)
      }
      dialog.show(
        () => (
          <PdfPasswordDialog
            file={target}
            hint={hint}
            onSubmit={async (password) => {
              // 在弹窗里直接验证：密码不对时错误留在同一个框里，用户不用再点一次。
              const failure = await submit(password)
              if (!failure) finish(password)
              return failure
            }}
            onCancel={() => finish(undefined)}
          />
        ),
        () => finish(undefined),
      )
    })

  /** 所有文档编辑的唯一入口：调用引擎、刷新撤销栈状态。 */
  const editOfficeOps = async (ops: RichOp[]) => {
    const target = path()
    if (!target) throw new Error("没有可写回的文件路径")
    const known = officePasswords()[target]
    try {
      return await submitOfficeEdit(target, ops, known)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // 只有「要密码 / 密码不对」才弹框；其它错误原样抛给调用方。
      if (!/密码/.test(message)) throw error
      let retried = false
      const entered = await promptPdfPassword(target, known === undefined ? undefined : message, async (password) => {
        retried = true
        try {
          await submitOfficeEdit(target, ops, password)
          setOfficePasswords((prev) => ({ ...prev, [target]: password }))
          return undefined
        } catch (failure) {
          return failure instanceof Error ? failure.message : String(failure)
        }
      })
      if (entered === undefined) throw error
      // 弹框可能已经被别的流程（预览）用掉，这时编辑还没真正重试。
      if (!retried) await submitOfficeEdit(target, ops, entered)
      return target
    }
  }

  /** 兼容 PDF 页面工具通过同一宿主引擎写入，并刷新当前预览 / Lexora 基线。 */
  const applyPdfPageOperation = async (target: string, op: OfficeOp) => {
    if (path() !== target) return
    if (officeDirty()) {
      showToast({
        variant: "default",
        title: "请先保存 PDF 编辑器中的更改",
        description: "为避免页面操作覆盖尚未保存的内容，请先保存或取消当前编辑。",
      })
      return
    }
    try {
      await editOfficeOps([op as never])
      await file.load(target, { force: true })
    } catch (error) {
      showToast({
        variant: "error",
        title: "PDF 页面操作失败",
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * 宿主撤销栈（撤销属于宿主，人和 AI 共用一条）。
   * 状态由服务端会话给出；每次写回后刷新，别人（Agent / 另一个窗口）改过也能反映出来。
   */
  const [officeHistory, setOfficeHistory] = createSignal<{
    canUndo: boolean
    canRedo: boolean
    undoLabel?: string
    redoLabel?: string
  }>({ canUndo: false, canRedo: false })
  const [historyBusy, setHistoryBusy] = createSignal(false)
  const historyVisible = createMemo(() => isEditableDocumentPath(path()) || isActivePluginOfficePath(path()))
  // 导出比撤销栈宽一档：旧格式（doc/xls/ppt/odt）不能原地改，但同样能导出成 md / txt。
  const exportVisible = createMemo(() => isExportableDocumentPath(path()))

  /**
   * 读取宿主返回的历史状态。
   * hey-api 的客户端把响应包在 `{ data }` 里，这里统一从 data 取，
   * 免得「按钮永远灰着」这种静默失败。
   */
  const readHistory = (response: { data?: Record<string, unknown> } | undefined | null) => {
    const payload = response?.data
    if (!payload) return
    setOfficeHistory({
      canUndo: payload.canUndo === true,
      canRedo: payload.canRedo === true,
      ...(typeof payload.undoLabel === "string" ? { undoLabel: payload.undoLabel } : {}),
      ...(typeof payload.redoLabel === "string" ? { redoLabel: payload.redoLabel } : {}),
    })
  }

  const refreshHistory = async () => {
    const target = path()
    if (!target || !historyVisible()) {
      setOfficeHistory({ canUndo: false, canRedo: false })
      return
    }
    try {
      readHistory(await sdk.client.office.document.state({ directory: sdk.directory, path: target }))
    } catch {
      setOfficeHistory({ canUndo: false, canRedo: false })
    }
  }

  const stepHistory = async (direction: "undo" | "redo") => {
    const target = path()
    if (!target || historyBusy()) return
    setHistoryBusy(true)
    try {
      const response =
        direction === "undo"
          ? await sdk.client.office.document.undo({ directory: sdk.directory, path: target })
          : await sdk.client.office.document.redo({ directory: sdk.directory, path: target })
      readHistory(response)
      void file.load(target, { force: true })
      // Office 预览走 base64 通道，不跟着文本通道刷新：撤销写回后要单独重取一次。
      setOfficeReload((value) => value + 1)
    } catch (error) {
      showToast({
        variant: "error",
        title: direction === "undo" ? "撤销失败" : "重做失败",
        description: error instanceof Error ? error.message : String(error),
      })
      void refreshHistory()
    } finally {
      setHistoryBusy(false)
    }
  }

  // 切文件 / 切标签时重新问一次历史状态；编辑保存后由各保存函数顺带刷新。
  createEffect(on(path, () => void refreshHistory()))

  /**
   * 纯文本类文件（代码 / Markdown / 配置）：有 textarea，
   * 撤销走本地栈，写盘走 saveEditing。Office 与图片都不算。
   * HTML 源文件现在也走同一条代码编辑器链路。
   */
  const textDocument = createMemo(() => {
    const target = path()
    if (!target) return false
    if (state()?.loaded !== true) return false
    if (state()?.content?.type === "binary") return false
    return !isOfficePreviewPath(target) && !isImagePreviewPath(target)
  })

  /**
   * 代码 / 纯文本文件进入专用编辑器壳层。
   * Markdown、CSV 仍然保留自己的阅读 / 表格视图，避免把它们的工作流
   * 强行变成普通代码文件；其余可编辑文本（包括 txt、配置和无扩展名文本）
   * 都使用编辑器式头部。
   */
  const codeEditor = createMemo(() => textDocument() && !isMarkdown() && !isCsv())
  const codeLanguageLabel = createMemo(() => {
    const language = syntaxLanguageOf(path())
    if (!language) return "Plain Text"
    return language
      .split(/[-_]/g)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  })
  const codeLspStatus = createMemo(() => {
    const services = directoryStore.lsp ?? []
    const connected = services.filter((service) => service.status === "connected")
    const failed = services.filter((service) => service.status === "error")
    if (connected.length > 0) return { label: `LSP ${connected.length}`, state: "connected" as const }
    if (failed.length > 0) return { label: "LSP 错误", state: "error" as const }
    return { label: "LSP 未连接", state: "none" as const }
  })

  /**
   * 头部的撤销 / 重做只有一个入口，但背后是两条栈：
   * 纯文本看本地 textarea 历史（historyTick 让它可响应），结构化文档看服务端历史。
   * 没得退时按钮置灰而不是藏起来 —— 用户永远知道这个能力在哪。
   */
  const canUndoStep = createMemo(() => {
    historyTick()
    const target = path()
    if (!target || !editing()) return false
    if (textDocument()) return canUndoText(target)
    if (historyVisible()) return officeHistory().canUndo && !historyBusy()
    return false
  })
  const canRedoStep = createMemo(() => {
    historyTick()
    const target = path()
    if (!target || !editing()) return false
    if (textDocument()) return canRedoText(target)
    if (historyVisible()) return officeHistory().canRedo && !historyBusy()
    return false
  })
  const undoStep = () => {
    if (textDocument()) {
      stepTextHistory("undo")
      return
    }
    if (historyVisible()) void stepHistory("undo")
  }
  const redoStep = () => {
    if (textDocument()) {
      stepTextHistory("redo")
      return
    }
    if (historyVisible()) void stepHistory("redo")
  }

  /**
   * Ctrl/⌘+Z 在面板里任何位置都能退一步：焦点在输入框 /
   * contenteditable 上时让位给原生撤销，其余情况走头部那一条栈。
   * 画布上点一下焦点会落到 body，所以「body 或面板内」都算这个面板的按键；
   * 面板收起时不接管，免得在聊天区按 Ctrl+Z 却改了文件。
   */
  createEffect(() => {
    if (!editing() || !layout.sidePane.opened()) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      const key = event.key.toLowerCase()
      const redo = event.shiftKey ? key === "z" : key === "y"
      if (!redo && key !== "z") return
      const target = event.target
      if (target instanceof Element && target.closest("textarea, input, [contenteditable='true']")) return
      const inside = target instanceof Node && (contentRef?.contains(target) || target === document.body)
      if (!inside) return
      if (redo ? !canRedoStep() : !canUndoStep()) return
      event.preventDefault()
      if (redo) redoStep()
      else undoStep()
    }
    window.addEventListener("keydown", onKeyDown)
    onCleanup(() => window.removeEventListener("keydown", onKeyDown))
  })

  /**
   * 把一次 TextEdit 落回 textarea：命令是纯函数（core），这里只负责
   * 写回 draft、触发防抖保存，并把选区恢复到命令算出来的位置。
   */
  const applyEditorEdit = (
    build: (source: string, selection: { anchor: number; head: number }) => TextEdit | undefined,
  ) => {
    const element = editorRef
    if (!element) return
    const selection = { anchor: element.selectionStart, head: element.selectionEnd }
    const source = draft()
    const edit = build(source, selection)
    if (!edit) return
    const next = applyTextEdit(source, edit)
    rememberCommandChange(source, next)
    setDraft(next)
    scheduleSave()
    requestAnimationFrame(() => {
      const target = editorRef
      if (!target) return
      target.focus()
      target.setSelectionRange(edit.selection.anchor, edit.selection.head)
    })
  }

  /** 代码编辑器的行命令快捷键：注释、缩进、移动、删除、复制、大小写、缩进转换。 */
  const runEditorCommand = (kind: TextCommandId) => {
    const extension = (path() ?? "").split(".").pop() ?? ""
    if (kind === "comment") {
      const tokens = commentTokens(extension)
      if (!tokens) {
        showToast({ variant: "error", title: "这个文件类型没有注释符号" })
        return
      }
      applyEditorEdit((source, selection) => toggleComment(source, selection, tokens))
      return
    }
    if (kind === "indent") {
      applyEditorEdit((source, selection) => indentLines(source, selection, "  "))
      return
    }
    if (kind === "outdent") {
      applyEditorEdit((source, selection) => indentLines(source, selection, "  ", true))
      return
    }
    if (kind === "moveUp") {
      applyEditorEdit((source, selection) => moveLines(source, selection, -1))
      return
    }
    if (kind === "moveDown") {
      applyEditorEdit((source, selection) => moveLines(source, selection, 1))
      return
    }
    if (kind === "delete") {
      applyEditorEdit((source, selection) => deleteLines(source, selection))
      return
    }
    if (kind === "duplicate") {
      applyEditorEdit((source, selection) => duplicateLines(source, selection))
      return
    }
    // 大小写和缩进转换都需要选区；没有选区时给出提示，而不是静默什么都不做。
    if (kind === "upper" || kind === "lower" || kind === "title") {
      applyEditorEdit((source, selection) => {
        // 没有选区就改光标所在的单词：和 VS Code 一致，不用先选词。
        if (selection.anchor === selection.head) {
          const word = wordAt(source, selection.anchor)
          if (word.anchor === word.head) {
            showToast({ title: "把光标放在要转换的单词上，或先选中文字" })
            return undefined
          }
          return changeCase(source, word, kind)
        }
        return changeCase(source, selection, kind)
      })
      return
    }
    applyEditorEdit((source, selection) => convertIndent(source, selection, kind === "tabs", 2))
  }

  /**
   * 行命令：排序 / 去重 / 反转 / 去尾空格 / 合并行作用于整篇，
   * 「合并行」按编辑器直觉只看选区（没有选区就是当前行 + 下一行）。
   * `format`（格式化代码）按文件扩展名分发到内置格式化器（JSON/HTML/XML/CSS）。
   */
  const applyTextCommand = (kind: "sort" | "sortDesc" | "unique" | "reverse" | "trim" | "format" | "join") => {
    const source = draft()
    const element = editorRef
    const selection = element ? { anchor: element.selectionStart, head: element.selectionEnd } : caret(0)
    try {
      const edit =
        kind === "sort" || kind === "sortDesc"
          ? sortLines(source, caret(0), kind === "sortDesc")
          : kind === "unique"
            ? uniqueLines(source, caret(0))
            : kind === "reverse"
              ? reverseLines(source, caret(0))
              : kind === "trim"
                ? trimTrailing(source, caret(0))
                : kind === "join"
                  ? joinLines(source, selection, false)
                  : formatSource(source, caret(0), (path() ?? "").split(".").pop() ?? "")
      if (!edit) return
      const next = applyTextEdit(source, edit)
      rememberCommandChange(source, next)
      setDraft(next)
      scheduleSave()
    } catch (error) {
      showToast({
        variant: "error",
        title: "命令未执行",
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /** Markdown 结构插入：都是纯文本命令，和 Agent 侧的 op 一一对应。 */
  const applyMarkdownInsert = (
    kind:
      | "footnote"
      | "callout"
      | "math"
      | "inlineMath"
      | "image"
      | "table"
      | "codeBlock"
      | "rule"
      | "link"
      | "properties",
  ) => {
    applyEditorEdit((source, selection) => {
      if (kind === "footnote") return insertFootnote(source, selection)
      if (kind === "callout") return insertCallout(source, selection, "note", "标题")
      if (kind === "math") return insertMathBlock(source, selection)
      if (kind === "inlineMath") return insertInlineMath(source, selection)
      if (kind === "image") return insertMarkdownImage(source, selection)
      if (kind === "table") return insertTable(source, selection)
      if (kind === "codeBlock") return insertCodeBlock(source, selection)
      if (kind === "rule") return insertRule(source, selection)
      if (kind === "link") return insertLink(source, selection)
      const today = dateText(new Date(), "date")
      return insertProperties(source, selection, { date: today })
    })
  }

  /**
   * 块级命令：标题 / 列表 / 引用改写整行。
   * 和行命令一样只把结果塞回 draft，仍走同一条防抖保存。
   */
  const applyBlockCommand = (
    kind: "heading1" | "heading2" | "heading3" | "bulletList" | "orderedList" | "taskList" | "taskToggle" | "quote",
  ) => {
    applyEditorEdit((source, selection) => {
      if (kind === "quote") return toggleQuote(source, selection)
      if (kind === "bulletList") return toggleList(source, selection, "bullet")
      if (kind === "orderedList") return toggleList(source, selection, "ordered")
      if (kind === "taskList") return toggleList(source, selection, "task")
      if (kind === "taskToggle") {
        const edit = toggleTask(source, selection)
        // 不是任务行时给一句提示：悄悄什么都不做会让人以为命令失效了。
        if (!edit) showToast({ title: "光标所在的行不是任务项", description: "任务项的写法是 - [ ] 或 - [x]" })
        return edit
      }
      const level = Number(kind.slice(-1))
      return setHeading(source, selection, level as 1 | 2 | 3)
    })
  }

  // ---------------------------------------------------------------------------
  // 大纲（Markdown）：outline 侧栏，
  // 点一条标题就把光标和滚动带到那一行，不用在长文里翻。
  const [outlineOpen, setOutlineOpen] = createSignal(false)
  const outlineItems = createMemo(() => (isMarkdown() ? markdownOutline(draft()) : []))
  const codeOutlineItems = createMemo(() => (codeEditor() ? codeOutlineOf(draft()) : []))
  const [lspOutlineItems, setLspOutlineItems] = createSignal<CodeOutlineItem[]>([])
  const [lspOutlineBusy, setLspOutlineBusy] = createSignal(false)
  let lspOutlineSequence = 0
  const loadLspOutline = async () => {
    const target = path()
    if (!target || !codeEditor()) return
    const sequence = ++lspOutlineSequence
    setLspOutlineBusy(true)
    try {
      const url = new URL(`/lsp/document-symbols?directory=${encodeURIComponent(sdk.directory)}`, sdk.url)
      const response = await sdk.request(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: target, text: draft() }),
      })
      if (!response.ok || sequence !== lspOutlineSequence) return
      const raw = (await response.json()) as Array<Record<string, any>>
      const flatten = (items: Array<Record<string, any>>, level = 1): CodeOutlineItem[] =>
        items.flatMap((item) => {
          const line = Number(item.range?.start?.line ?? item.selectionRange?.start?.line ?? 0) + 1
          const current = { line, level, text: String(item.name ?? "未命名符号"), kind: String(item.kind ?? "symbol") }
          const children = Array.isArray(item.children) ? flatten(item.children, Math.min(4, level + 1)) : []
          return [current, ...children]
        })
      setLspOutlineItems(flatten(raw).slice(0, 300))
    } catch {
      if (sequence === lspOutlineSequence) setLspOutlineItems([])
    } finally {
      if (sequence === lspOutlineSequence) setLspOutlineBusy(false)
    }
  }
  createEffect(() => {
    if (outlineOpen() && codeEditor()) void loadLspOutline()
  })
  createEffect(on(path, () => setLspOutlineItems([])))
  const visibleOutlineItems = createMemo(() =>
    codeEditor() ? (lspOutlineItems().length > 0 ? lspOutlineItems() : codeOutlineItems()) : outlineItems(),
  )

  // 换文件时收起：上一个文件的大纲不该留在屏幕上。
  createEffect(on(path, () => setOutlineOpen(false)))

  const jumpToOutline = (line: number) => {
    setOutlineOpen(false)
    // 阅读视图里没有 textarea：先切回源码，等它挂载后再定位。
    setMarkdownMode("source")
    requestAnimationFrame(() => {
      const textarea = editorRef
      if (!textarea) return
      const lines = draft().split(NEWLINE)
      const offset = lines.slice(0, line - 1).reduce((sum, item) => sum + item.length + 1, 0)
      textarea.focus()
      textarea.setSelectionRange(offset, offset)
      // 行高固定 24px；顶部留一行，标题不会贴着上边。
      textarea.scrollTop = Math.max(0, (line - 1) * 24 - 24)
    })
  }

  // ---------------------------------------------------------------------------
  // 笔记信息（Markdown）：标签、[[wikilink]] 和反链。
  // 扫描是 core 里的纯函数；反链借服务的 ripgrep 找全项目里的 [[...]]，
  // 再按「链接解析后是不是这篇」逐条过滤 —— 不额外读文件，也不用索引。
  // ---------------------------------------------------------------------------
  const [notesOpen, setNotesOpen] = createSignal(false)
  const noteTagItems = createMemo(() =>
    isMarkdown() ? [...new Set(scanNoteTags(draft()).map((item) => item.tag))] : [],
  )
  const noteLinkItems = createMemo(() => (isMarkdown() ? scanNoteLinks(draft()) : []))
  const noteHeading = createMemo(() => (isMarkdown() ? scanNoteTitle(draft()) : undefined))
  const [backlinks, setBacklinks] = createSignal<Array<{ path: string; line: number; text: string }>>([])
  const [backlinksBusy, setBacklinksBusy] = createSignal(false)
  let backlinkSequence = 0

  const loadBacklinks = async () => {
    const current = path()
    if (!current) return
    const sequence = ++backlinkSequence
    setBacklinksBusy(true)
    try {
      const response = await sdk.client.find.text({ pattern: "\\[\\[[^\\]]+\\]\\]" })
      if (sequence !== backlinkSequence) return
      const rows = new Map<string, { path: string; line: number; text: string }>()
      for (const match of response.data ?? []) {
        const source = file.normalize(match.path.text)
        if (!source || source === current) continue
        const linked = scanNoteLinks(match.lines.text).some((link) => resolveNotePath(source, link.target) === current)
        if (!linked) continue
        const key = source + ":" + String(match.line_number)
        if (!rows.has(key)) {
          rows.set(key, { path: source, line: match.line_number, text: match.lines.text.trim() })
        }
        if (rows.size >= 50) break
      }
      setBacklinks([...rows.values()])
    } catch {
      // 服务不可用或搜索失败：显示「没有反链」，不打断正在写的字。
      if (sequence === backlinkSequence) setBacklinks([])
    } finally {
      if (sequence === backlinkSequence) setBacklinksBusy(false)
    }
  }

  const openNotes = () => {
    const next = !notesOpen()
    setOutlineOpen(false)
    setNotesOpen(next)
    if (next) {
      // 浮层挂在源码编辑器那一支上：从阅读视图（或命令面板）进来时先切过去。
      setMarkdownMode("source")
      void loadBacklinks()
    }
  }

  // 换文件时收起，并让还在路上的反链结果作废（不能落到下一篇笔记上）。
  createEffect(
    on(path, () => {
      setNotesOpen(false)
      setPropertiesOpen(false)
      setNewPropertyKey("")
      setNewPropertyValue("")
      backlinkSequence += 1
      setBacklinks([])
      setBacklinksBusy(false)
    }),
  )

  const openNoteLink = (target: string) => {
    const current = path()
    if (!current) return
    setNotesOpen(false)
    openLinkedFile(resolveNotePath(current, target))
  }

  /** 点标签 = 在项目里按字面文本搜 `#标签`：和「全局」搜索是同一条通道。 */
  const searchNoteTag = (tag: string) => {
    setNotesOpen(false)
    setWorkspaceQuery(tag)
    setWorkspaceOpen(true)
    requestAnimationFrame(() => {
      workspaceInput?.focus()
      workspaceInput?.select()
      runWorkspaceSearch(tag)
    })
  }

  // ---------------------------------------------------------------------------
  // Markdown 属性（front-matter）：结构化编辑。
  // 解析 / 改写都是 core 里的纯函数，和 AI 的 setProperty / deleteProperty
  // 走同一份实现 —— 面板上能改的，模型也能改。
  // ---------------------------------------------------------------------------
  const [propertiesOpen, setPropertiesOpen] = createSignal(false)
  const [newPropertyKey, setNewPropertyKey] = createSignal("")
  const [newPropertyValue, setNewPropertyValue] = createSignal("")
  const frontMatter = createMemo(() => (isMarkdown() ? parseFrontMatter(draft()) : undefined))
  const propertyRows = createMemo(() => frontMatter()?.entries ?? [])

  const setPropertyText = (key: string, text: string) => {
    applyDraftText(updateFrontMatter(draft(), { [key]: parseFrontMatterValue(text) }))
  }
  const removeProperty = (key: string) => {
    applyDraftText(updateFrontMatter(draft(), { [key]: undefined }))
  }
  const addProperty = () => {
    const key = newPropertyKey().trim()
    if (!key) return
    applyDraftText(updateFrontMatter(draft(), { [key]: parseFrontMatterValue(newPropertyValue()) }))
    setNewPropertyKey("")
    setNewPropertyValue("")
  }

  // ---------------------------------------------------------------------------
  // 查找 / 替换
  // ---------------------------------------------------------------------------
  const findOptions = () => ({
    caseSensitive: findCaseSensitive(),
    regex: findRegex(),
    wholeWord: findWholeWord(),
  })

  /** 匹配结果永远由纯函数现算：文档改了（含 AI 跟写）就自动跟着变。 */
  const findMatches = createMemo<SearchMatch[]>(() => {
    const query = findQuery()
    if (!query) return []
    try {
      return searchMatches(draft(), query, findOptions())
    } catch {
      return []
    }
  })

  const findInvalid = createMemo(() => {
    if (!findRegex()) return false
    const query = findQuery()
    if (!query) return false
    try {
      new RegExp(query)
      return false
    } catch {
      return true
    }
  })

  const findIndex = createMemo(() => {
    const total = findMatches().length
    if (total === 0) return 0
    return Math.min(findActive(), total - 1)
  })

  /** 把匹配落到 textarea 选区，并把所在行滚进视野（行高固定 24px）。 */
  const revealMatch = (match: SearchMatch | undefined) => {
    if (!match) return
    const index = findMatches().findIndex((item) => item.start === match.start && item.end === match.end)
    if (index >= 0) setFindActive(index)
    const element = editorRef
    if (!element) return
    element.focus()
    element.setSelectionRange(match.start, match.end)
    const line = draft().slice(0, match.start).split("\n").length
    element.scrollTop = Math.max(0, (line - 3) * 24)
  }

  const findStep = (direction: 1 | -1) => {
    const query = findQuery()
    if (!query) return
    const element = editorRef
    // 从上一次选区边界继续找：Enter 连按就是逐个往下走，不会停在原地。
    const from = direction === 1 ? (element?.selectionEnd ?? 0) : (element?.selectionStart ?? 0)
    try {
      revealMatch(
        direction === 1
          ? nextMatch(draft(), query, from, findOptions())
          : previousMatch(draft(), query, from, findOptions()),
      )
    } catch (error) {
      showToast({
        variant: "error",
        title: "查找失败",
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const replaceCurrentFind = () => {
    const query = findQuery()
    if (!query) return
    const element = editorRef
    const start = element?.selectionStart ?? -1
    const end = element?.selectionEnd ?? -1
    try {
      // 选中的正好是一个匹配就换它，否则先跳到下一个再换。
      const match =
        findMatches().find((item) => item.start === start && item.end === end) ??
        nextMatch(draft(), query, Math.max(0, start), findOptions())
      if (!match) return
      const replacement = findReplacement()
      const next = replaceMatch(draft(), match, replacement)
      rememberCommandChange(draft(), next)
      setDraft(next)
      scheduleSave()
      setFindActive(0)
      requestAnimationFrame(() => {
        const target = editorRef
        if (!target) return
        const at = match.start + replacement.length
        target.focus()
        target.setSelectionRange(at, at)
        findStep(1)
      })
    } catch (error) {
      showToast({
        variant: "error",
        title: "替换失败",
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const replaceAllFind = () => {
    const query = findQuery()
    if (!query) return
    try {
      const result = replaceAll(draft(), query, findReplacement(), findOptions())
      if (result.count === 0) return
      rememberCommandChange(draft(), result.text)
      setDraft(result.text)
      scheduleSave()
      setFindActive(0)
      showToast({ variant: "success", title: `已替换 ${result.count} 处` })
    } catch (error) {
      showToast({
        variant: "error",
        title: "替换失败",
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const openFind = (withReplace = false) => {
    setFindOpen(true)
    if (withReplace) setFindReplaceOpen(true)
    // 有选区就带入作查询词（和 VS Code 一致），跨行选区只取第一行。
    const element = editorRef
    if (element && element.selectionStart !== element.selectionEnd) {
      const selected = element.value.slice(element.selectionStart, element.selectionEnd).split("\n")[0] ?? ""
      if (selected.length > 0 && selected.length <= 100) setFindQuery(selected)
    }
    requestAnimationFrame(() => {
      findInputRef?.focus()
      findInputRef?.select()
    })
  }

  /** 头部「查找」的唯一落点：代码文本走本地查找条，结构化文档交给对应编辑器。 */
  const openPanelFind = () => {
    openFind(false)
  }

  const closeFind = () => {
    setFindOpen(false)
    setFindReplaceOpen(false)
    editorRef?.focus()
  }

  const openGoto = () => {
    const line = caretPosition(draft(), caretAt()).line
    setGotoValue(String(line))
    setGotoOpen(true)
    requestAnimationFrame(() => {
      gotoInputRef?.focus()
      gotoInputRef?.select()
    })
  }

  const closeGoto = () => {
    setGotoOpen(false)
    editorRef?.focus()
  }

  /**
   * 打字机滚动：输入时把光标所在行保持在视口中间。
   * 只在输入后调用 —— 鼠标点击时还去挪滚动条会跟用户抢。
   */
  const centerCaret = (element: HTMLTextAreaElement) => {
    if (!typewriter()) return
    const line = caretPosition(element.value, element.selectionStart).line
    const top = (line - 1) * 24 - element.clientHeight / 2 + 12
    if (top > 0) element.scrollTop = top
  }

  const handleCodeEditorKeyDown = (event: KeyboardEvent) => {
    // CodeMirror 的补全键位优先级高于宿主编辑命令：补全弹窗打开时，Tab 接受候选，
    // 不要被下面的缩进逻辑再次拦截。
    if (event.defaultPrevented) return
    if (!editing()) return
    const accel = event.metaKey || event.ctrlKey
    if (event.key === "F12") {
      event.preventDefault()
      void goToDefinition()
      return
    }
    if (accel && event.key.toLowerCase() === "s") {
      event.preventDefault()
      void saveEditing()
      return
    }
    if (accel && event.key.toLowerCase() === "z") {
      const target = path()
      const redo = event.shiftKey
      if (target && (redo ? canRedoText(target) : canUndoText(target))) {
        event.preventDefault()
        stepTextHistory(redo ? "redo" : "undo")
        return
      }
    }
    if (accel && !event.shiftKey && event.key.toLowerCase() === "y") {
      const target = path()
      if (target && canRedoText(target)) {
        event.preventDefault()
        stepTextHistory("redo")
        return
      }
    }
    if (accel && event.shiftKey && event.key.toLowerCase() === "p") {
      event.preventDefault()
      openPalette()
      return
    }
    if (accel && event.key.toLowerCase() === "f") {
      event.preventDefault()
      openFind(false)
      return
    }
    if (accel && event.key.toLowerCase() === "h") {
      event.preventDefault()
      openFind(true)
      return
    }
    if (accel && event.key.toLowerCase() === "g") {
      event.preventDefault()
      openGoto()
      return
    }
    if (event.key === "Escape" && findOpen()) {
      event.preventDefault()
      closeFind()
      return
    }
    if (event.key === "Tab" && !accel && !event.altKey) {
      event.preventDefault()
      runEditorCommand(event.shiftKey ? "outdent" : "indent")
      return
    }
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault()
      runEditorCommand(event.key === "ArrowUp" ? "moveUp" : "moveDown")
      return
    }
    if (accel && event.key === "/") {
      event.preventDefault()
      runEditorCommand("comment")
      return
    }
    if (accel && event.shiftKey && event.key.toLowerCase() === "k") {
      event.preventDefault()
      runEditorCommand("delete")
      return
    }
    if (accel && event.shiftKey && event.key.toLowerCase() === "d") {
      event.preventDefault()
      runEditorCommand("duplicate")
    }
  }

  const requestLspDiagnostics = async (text: string): Promise<Diagnostic[]> => {
    const target = path()
    if (!target) return []
    try {
      const url = new URL(`/lsp/diagnostics?directory=${encodeURIComponent(sdk.directory)}`, sdk.url)
      const response = await sdk.request(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: target, text }),
      })
      if (!response.ok) return []
      const payload = (await response.json()) as Record<string, Array<Record<string, any>>>
      const current = file.normalize(target).toLowerCase()
      const entry = Object.entries(payload).find(([key]) => file.normalize(key).toLowerCase() === current)
      if (!entry) return []
      const offsetAt = (line: number, character: number) => {
        const rows = text.split(NEWLINE)
        return Math.min(
          text.length,
          rows.slice(0, Math.max(0, line)).reduce((sum, row) => sum + row.length + 1, 0) + character,
        )
      }
      return entry[1].map((diagnostic) => {
        const start = diagnostic.range?.start ?? { line: 0, character: 0 }
        const end = diagnostic.range?.end ?? start
        const severity: "error" | "warning" | "info" =
          diagnostic.severity === 1 ? "error" : diagnostic.severity === 2 ? "warning" : "info"
        return {
          from: offsetAt(start.line, start.character),
          to: Math.max(offsetAt(start.line, start.character) + 1, offsetAt(end.line, end.character)),
          severity,
          message: String(diagnostic.message ?? "语言服务诊断"),
        }
      })
    } catch {
      return []
    }
  }

  /** CodeMirror 的变更适配到现有 draft / 历史 / 防抖保存链路。 */
  const handleCodeEditorChange = (next: string, selection: { anchor: number; head: number }) => {
    const target = path()
    const previous = draft()
    if (!target || next === previous) return
    const anchor = Math.max(0, Math.min(caretAt(), previous.length))
    const head = Math.max(anchor, Math.min(anchor + selectionLength(), previous.length))
    recordTextChange(
      target,
      { text: previous, anchor, head },
      { text: next, anchor: selection.anchor, head: selection.head },
      "typing",
    )
    bumpHistory()
    setDraft(next)
    syncCaretPosition(selection.anchor, selection.head)
    if (target) rememberDraft(target, next)
    scheduleSave()
  }

  /** 跳转到第 line 行（1 起）：越界夹到范围内，光标落在行首。 */
  const jumpToLine = (line: number) => {
    const element = editorRef
    if (!element) return
    const total = draft().split(NEWLINE).length
    const target = Math.max(1, Math.min(total, Math.floor(line)))
    const offset = offsetOfLine(draft(), target)
    element.focus()
    element.setSelectionRange(offset, offset)
    setCaretAt(offset)
    setSelectionLength(0)
    // 行高固定 24px，滚动到行上方留两行余量。
    element.scrollTop = Math.max(0, (target - 3) * 24)
    setGotoOpen(false)
  }

  // ---------------------------------------------------------------------------
  // 在项目里搜索：复用服务的 ripgrep 通道，
  // 结果点一下就打开对应文件并跳到那一行。
  // ---------------------------------------------------------------------------
  const [workspaceOpen, setWorkspaceOpen] = createSignal(false)
  const [workspaceQuery, setWorkspaceQuery] = createSignal("")
  const [workspaceBusy, setWorkspaceBusy] = createSignal(false)
  const [workspaceResults, setWorkspaceResults] = createSignal<Array<{ path: string; line: number; text: string }>>([])
  /** 按文件分组：每个文件一组，组内保持行号顺序。 */
  const workspaceGroups = createMemo(() => {
    const groups: Array<{ path: string; rows: Array<{ path: string; line: number; text: string }> }> = []
    const index = new Map<string, number>()
    for (const row of workspaceResults()) {
      const at = index.get(row.path)
      if (at === undefined) {
        index.set(row.path, groups.length)
        groups.push({ path: row.path, rows: [row] })
        continue
      }
      groups[at]!.rows.push(row)
    }
    return groups
  })
  let workspaceInput: HTMLInputElement | undefined
  let workspaceTimer: ReturnType<typeof setTimeout> | undefined
  let workspaceSequence = 0

  const openWorkspaceSearch = () => {
    setWorkspaceOpen(true)
    const element = editorRef
    if (element && element.selectionStart !== element.selectionEnd) {
      const selected = element.value.slice(element.selectionStart, element.selectionEnd).split(NEWLINE)[0] ?? ""
      if (selected.trim().length > 0 && selected.length <= 100) setWorkspaceQuery(selected)
    }
    requestAnimationFrame(() => {
      workspaceInput?.focus()
      workspaceInput?.select()
    })
  }

  const closeWorkspaceSearch = () => {
    setWorkspaceOpen(false)
    if (workspaceTimer) clearTimeout(workspaceTimer)
    workspaceSequence += 1
    setWorkspaceBusy(false)
    editorRef?.focus()
  }

  const runWorkspaceSearch = (query: string) => {
    if (workspaceTimer) clearTimeout(workspaceTimer)
    const trimmed = query.trim()
    if (trimmed.length === 0) {
      setWorkspaceResults([])
      setWorkspaceBusy(false)
      return
    }
    setWorkspaceBusy(true)
    const current = ++workspaceSequence
    // 按字面文本搜索：ripgrep 把 pattern 当正则，用户输入的 `(` `*` 会直接报错。
    const pattern = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    workspaceTimer = setTimeout(() => {
      void (async () => {
        try {
          // 一次多要一些（上限 500），下面按文件分组显示；ripgrep 本身有上限，
          // 传大值只是把「每个文件几条」的取舍交给分组，而不是只能看到 10 条。
          const response = await sdk.client.find.text({ pattern, limit: "200" })
          if (current !== workspaceSequence) return
          const rows = (response.data ?? []).map((match) => ({
            path: match.path.text,
            line: match.line_number,
            text: match.lines.text,
          }))
          setWorkspaceResults(rows)
        } catch {
          // 正则写错 / 服务不可用：当作没有结果，不弹大错误框打断输入。
          if (current === workspaceSequence) setWorkspaceResults([])
        } finally {
          if (current === workspaceSequence) setWorkspaceBusy(false)
        }
      })()
    }, 300)
  }

  /** 打开目标文件后要跳到的位置：文件是异步加载的，先记下来，等编辑器挂载。 */
  const [pendingJump, setPendingJump] = createSignal<{ path: string; line: number } | null>(null)

  /** 搜索命中 → 打开文件并跳到那一行；Markdown 先切回源码，否则没有可跳的编辑器。 */
  const openSearchResult = (result: { path: string; line: number }) => {
    const target = file.normalize(result.path)
    if (!target) return
    if (/\.(md|markdown|mdx)$/i.test(target)) setMarkdownMode("source")
    setPendingJump({ path: target, line: result.line })
    setWorkspaceOpen(false)
    openLinkedFile(target)
  }

  const goToDefinition = async () => {
    const target = path()
    const element = editorRef
    if (!target || !element) return
    const position = caretPosition(draft(), element.selectionStart)
    try {
      const url = new URL(`/lsp/definition?directory=${encodeURIComponent(sdk.directory)}`, sdk.url)
      const response = await sdk.request(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path: target,
          line: position.line - 1,
          character: Math.max(0, position.column - 1),
          text: draft(),
        }),
      })
      if (!response.ok) return
      const locations = (await response.json()) as Array<Record<string, any>>
      const first = locations[0]
      if (!first) {
        showToast({ title: "没有找到定义" })
        return
      }
      const uri = String(first.uri ?? first.targetUri ?? "")
      const rawPath = uri.startsWith("file:")
        ? decodeURIComponent(new URL(uri).pathname).replace(/^\/([A-Za-z]:)/, "$1")
        : uri
      const definitionPath = file.normalize(rawPath)
      const line = Number(first.range?.start?.line ?? first.targetSelectionRange?.start?.line ?? 0) + 1
      if (!definitionPath) return
      setPendingJump({ path: definitionPath, line })
      openLinkedFile(definitionPath)
    } catch {
      showToast({ title: "语言服务暂不可用" })
    }
  }

  // Markdown 打开时默认是阅读视图（没挂 textarea），这里顺带切回源码；
  // 切换视图会重跑本 effect，等编辑器真的挂上再跳。
  createEffect(() => {
    const jump = pendingJump()
    if (!jump) return
    if (path() !== jump.path || !state()?.loaded) return
    if (isMarkdown() && markdownMode() !== "source") {
      setMarkdownMode("source")
      return
    }
    let attempts = 0
    const run = () => {
      const element = editorRef
      if (!element) {
        // 视图刚切换时编辑器可能晚一帧挂载，最多等几帧。
        if (attempts++ < 5) requestAnimationFrame(run)
        return
      }
      jumpToLine(jump.line)
      setPendingJump(null)
    }
    requestAnimationFrame(run)
  })

  // 条件一变就回到第一个匹配，免得索引停在已不存在的项上。
  createEffect(on([findQuery, findCaseSensitive, findRegex, findWholeWord], () => setFindActive(0)))

  // ---------------------------------------------------------------------------
  // 命令面板（⇧⌘P）：敲几个字母就能找到命令。
  // 命令表在 core 里，按当前文档类型过滤；执行仍走面板自己的处理函数，
  // 所以搜到的每一个命令都等于工具条上那一个按钮。
  // ---------------------------------------------------------------------------
  const paletteKind = createMemo<"markdown" | "text" | "json">(() => {
    const target = path() ?? ""
    if (/\.jsonc?$/i.test(target)) return "json"
    return isMarkdown() ? "markdown" : "text"
  })
  const [paletteOpen, setPaletteOpen] = createSignal(false)
  const [paletteQuery, setPaletteQuery] = createSignal("")
  const [paletteIndex, setPaletteIndex] = createSignal(0)
  let paletteInput: HTMLInputElement | undefined

  const paletteItems = createMemo(() => filterCommands({ kind: paletteKind() }, paletteQuery()))

  const openPalette = () => {
    // 两个浮层不叠着开：命令面板优先级更高。
    setOutlineOpen(false)
    setPaletteQuery("")
    setPaletteIndex(0)
    setPaletteOpen(true)
    requestAnimationFrame(() => paletteInput?.focus())
  }

  const closePalette = () => {
    setPaletteOpen(false)
    editorRef?.focus()
  }

  const runPaletteCommand = (id: string) => {
    setPaletteOpen(false)
    switch (id) {
      case "save":
        void saveEditing()
        return
      case "find":
        openPanelFind()
        return
      case "replace":
        openFind(true)
        return
      case "undo":
      case "redo":
        void stepHistory(id)
        return
      case "sort":
      case "sortDesc":
      case "unique":
      case "reverse":
      case "trim":
      case "join":
      case "format":
        applyTextCommand(id)
        return
      case "json":
        applyTextCommand("format")
        return
      case "date":
      case "time":
      case "datetime": {
        const now = new Date()
        const next = draft() + dateText(now, id)
        rememberCommandChange(draft(), next)
        setDraft(next)
        scheduleSave()
        return
      }
      case "inlineMath":
      case "table":
      case "codeBlock":
      case "rule":
      case "footnote":
      case "callout":
      case "math":
      case "image":
      case "properties":
      case "link":
        applyMarkdownInsert(id)
        return
      case "markdownPreview":
        // 三种视图按 实况 → 阅读 → 源码 → 实况 循环，一个命令就能走完。
        setMarkdownMode(markdownMode() === "live" ? "preview" : markdownMode() === "preview" ? "source" : "live")
        return
      case "outline":
        if (!codeEditor()) setMarkdownMode("source")
        setOutlineOpen(!outlineOpen())
        return
      case "notes":
        openNotes()
        return
      case "goToLine":
        openGoto()
        return
      case "workspaceSearch":
        openWorkspaceSearch()
        return
      case "heading1":
      case "heading2":
      case "heading3":
      case "bulletList":
      case "orderedList":
      case "taskList":
      case "taskToggle":
      case "quote":
        applyBlockCommand(id)
        return
      case "wrap":
        setEditorWrap(!editorWrap())
        return
      case "focusMode":
        setFocusMode(!focusMode())
        return
      case "typewriter":
        setTypewriter(!typewriter())
        return
      default:
        // 只把文本命令交给 runEditorCommand。命令表里的「视图开关」之类
        // 如果哪条没接上，宁可不动作，也不能落进最后的「缩进转空格」兜底分支。
        if (TEXT_COMMAND_IDS.has(id)) runEditorCommand(id as TextCommandId)
    }
  }

  /** 面板列表最多渲染这么多条：够用又不至于把 DOM 铺满。 */
  const PALETTE_LIMIT = 12

  /** XLSX 单元格：和 Agent 的 setCellValue / setCellStyle 是同一条引擎路径。 */
  const saveCell = async (sheet: string, cell: string, value: string | number | { formula: string }) => {
    await editOfficeOps([{ op: "setCellValue", sheet, cell, value } as never])
  }

  const saveDocxParagraph = async (paragraph: number, text: string) => {
    await editOfficeOps([{ op: "setParagraphText", paragraph, text }])
  }

  // 预览里翻到第几页：导出 PNG 时就出这一页。
  const [pdfViewPage, setPdfViewPage] = createSignal(1)
  // 画布内改字会原地重写这份文件，预览得重读一遍才看得到新内容。
  const [officeReload, setOfficeReload] = createSignal(0)
  // 跟写期间（AI 正在产出 office 文件）watcher 每次写盘都重取 base64，
  // 预览像浏览器一样跟着刷新；平时仍只在打开/画布改字时读一次。
  // 依赖里带 tick 而不是只带路径：同一份文件被连写多次时路径不变，
  // 只看路径的依赖收不到第二次通知。
  createEffect(
    on(
      () => {
        const target = officePath()
        return [target, liveWritePath(), liveWriteTick(), target ? file.previewRevision(target) : 0] as const
      },
      ([target, livePath, , watcherRevision], previous) => {
        if (
          shouldReloadOfficePreview({
            target,
            livePath,
            watcherRevision,
            previousWatcherRevision: previous?.[3],
          })
        ) {
          setOfficeReload((value) => value + 1)
        }
      },
    ),
  )
  /**
   * 加密 PDF 在面板里也要能看：用内存里的密码本地解密，再交给 Chromium 阅读器。
   * 没密码就弹一次框；用户取消后回退原始字节（Chromium 自己会问），不反复打扰。
   */
  const previewPdfBase64 = async (target: string, content: string, known: string | undefined, skipped: boolean) => {
    const raw = base64ToBytes(content)
    if (!isEncryptedPdf(raw)) return content
    const attempt = async (password: string) => {
      const unlocked = await decryptPdf(raw, password)
      return unlocked.ok
        ? ({ ok: true, content: bytesToBase64(unlocked.bytes) } as const)
        : ({ ok: false, message: unlocked.message } as const)
    }
    if (known !== undefined) {
      const plain = await attempt(known)
      if (plain.ok) return plain.content
      // 缓存里的密码失效了（文件被换过）：清掉，再问一次。
      setOfficePasswords((prev) => {
        const next = { ...prev }
        delete next[target]
        return next
      })
    }
    if (skipped) return content
    const entered = await promptPdfPassword(target, undefined, async (password) => {
      const plain = await attempt(password)
      if (!plain.ok) return plain.message
      setOfficePasswords((prev) => ({ ...prev, [target]: password }))
      setPdfPasswordSkipped((prev) => {
        const next = { ...prev }
        delete next[target]
        return next
      })
      return undefined
    })
    if (entered === undefined) {
      setPdfPasswordSkipped((prev) => ({ ...prev, [target]: true }))
      return content
    }
    const plain = await attempt(entered)
    return plain.ok ? plain.content : content
  }
  /**
   * 预览字节通道，三态：加载中 / 失败 / 有内容。
   *
   * 取字节本身是 `readOfficePreview`（总函数，见 office-preview-load.ts）：读不到就带 code
   * 失败，绝不折成 `""` —— 空内容和「还在读」在 `<Show>` 眼里长得一样，面板就会永远转圈。
   * 这里只补加密 PDF 那一步：用内存里的密码本地解密，再交给 Chromium 阅读器。
   */
  const previewReader: OfficePreviewReader = {
    isExternal: (target) => file.isExternal(target),
    readLocal: platform.readLocalFileBase64,
    readServer: async (target) => await sdk.client.file.read({ path: target, encoding: "base64" }),
  }
  const readPreviewBytes = async (source: {
    target: string
    password: string | undefined
    skipped: boolean
  }): Promise<OfficePreviewLoad> => {
    const loaded = await readOfficePreview(previewReader, source.target)
    if (isOfficePreviewFailure(loaded)) return loaded
    if (officeFormatOf(source.target) !== "pdf") return loaded
    try {
      return { base64: await previewPdfBase64(source.target, loaded.base64, source.password, source.skipped) }
    } catch (error) {
      // 解密这条路自己抛了（对话框被关掉、字节坏了）：也收成状态，不把 reject 漏给渲染树。
      return {
        code: "read_failed",
        path: source.target,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }
  // 只有最后一次请求的结果能落进状态：切走标签后迟到的失败不能盖掉当前文件，
  // 否则又会造出一个属于别的文件的加载态。
  let officeLoadSeq = 0
  const [officeLoad, setOfficeLoad] = createSignal<{ key: string; value: OfficePreviewLoad }>()
  createEffect(
    on(
      () => {
        const target = officePath()
        if (!target) return undefined
        return {
          target,
          reload: officeReload(),
          password: officePasswords()[target],
          skipped: pdfPasswordSkipped()[target] === true,
        } as const
      },
      (source) => {
        if (!source) {
          setOfficeLoad(undefined)
          return
        }
        const seq = ++officeLoadSeq
        void readPreviewBytes(source).then((value) => {
          if (seq !== officeLoadSeq) return
          setOfficeLoad({ key: source.target, value })
        })
      },
    ),
  )
  const officeResult = createMemo(() => {
    const load = officeLoad()
    return load && load.key === officePath() ? load.value : undefined
  })
  const officeFailure = createMemo(() => officePreviewFailure(officeResult()))
  const officeBase64 = createMemo(() => officePreviewBase64(officeResult()))
  // 文件在磁盘上变了（AI 改完、外部程序另存）时顺带问一次撤销栈状态：
  // 历史是宿主的，面板只负责显示。
  createEffect(
    on(
      () => officeBase64(),
      () => void refreshHistory(),
      { defer: true },
    ),
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
  // 预览分支互斥收敛成一个值。原先用 <Switch>/<Match> 做首匹配，
  // 但首匹配的 Solid 实现会在某些恢复/切换路径下抛 switchFunc 错误，整页进错误边界；
  // 这里用同一个值驱动一串 <Show>，语义与首匹配一致，也不再依赖 Switch 的内部 memo。
  const previewBranch = createMemo<"markdown-live" | "markdown-preview" | "image" | "text" | undefined>(() => {
    const current = state()
    if (!current?.loaded) return undefined
    // RTF is ASCII on disk but still belongs to the read-only Office preview, not the code editor.
    const binary = current.content?.type === "binary" || isOfficeBinaryPreviewPath(path())
    if (!binary && isMarkdown() && markdownMode() === "live") return "markdown-live"
    if (!binary && isMarkdown() && markdownMode() === "preview") return "markdown-preview"
    if (imageBase64()) return "image"
    if (!binary) return "text"
    return undefined
  })

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
  // 挂载时是否要从「编辑器记忆」里恢复草稿。跟写期间磁盘内容还在长，
  // 这时必须听打字机的，不能拿旧草稿盖回去。
  let restoredDraft: string | undefined
  // 这份草稿是不是「上次运行留下的」—— 是的话在顶部挂一条恢复提示，
  // 让用户知道眼前的内容不是磁盘上的那份（可以丢弃、回到磁盘版本）。
  const [restoredFromDisk, setRestoredFromDisk] = createSignal<string | undefined>()

  /**
   * 落盘草稿和磁盘内容一模一样时它就是多余的（上次保存成功但没来得及清）：
   * 直接丢掉，别让用户对着一条假的「未保存」提示发愣。
   */
  const checkRestoredDraft = () => {
    const p = restoredFromDisk()
    if (!p || p !== path()) return
    if (!contents()) return
    if (draft() !== contents()) return
    clearDraft(p)
    restoredDraft = undefined
    setRestoredFromDisk(undefined)
  }

  /** 丢弃恢复的草稿，回到磁盘上的版本。 */
  const discardRestoredDraft = () => {
    const p = restoredFromDisk()
    if (!p) return
    clearDraft(p)
    restoredDraft = undefined
    setRestoredFromDisk(undefined)
    setDraft(contents())
    setSaveError(false)
  }

  createEffect(
    on(path, () => {
      // 切回一个还有未保存改动的文件时，先恢复那份草稿 —— 否则用户会看到
      // 「刚才写的东西不见了」。没有草稿就回到磁盘内容。
      const p = path() ?? ""
      const cached = liveWrite() ? undefined : draftOf(p)
      // 内存里没有（上次运行留下的、或者被 LRU 挤掉的）就问落盘那份。
      const fromDisk = cached === undefined && !liveWrite() ? persistedDraftOf(p) : undefined
      const value = cached ?? fromDisk
      restoredDraft = value
      setRestoredFromDisk(fromDisk !== undefined && p ? p : undefined)
      setDraft(value ?? contents())
      // 磁盘内容都还没读到（contents 为空）时不能判断草稿是不是「多余的」，
      // 等内容到了再决定（见下面的 effect）。
      if (fromDisk !== undefined && contents()) checkRestoredDraft()
      setSaveError(false)
      commentsUi.note.reset()
      // 光标 / 选区 / 滚动位置同理：等这一帧的 DOM 落地再还原。
      queueRestoreView()
    }),
  )

  // 文件加载完成后再核对一次（打开时 contents 可能还是空的）。
  createEffect(() => {
    if (!restoredFromDisk()) return
    if (!state()?.loaded) return
    checkRestoredDraft()
  })

  // 编辑器内容跟随「打字机版」内容（不跟写时它等价于 contents，重写会直接跳最新）。
  // 只保留这一个同步点：同时再挂一个 `on(contents)` 会在整块写入的瞬间先把全文塞进
  // 编辑器、把随后逐字揭示的内容又盖回去，观感是先跳到底再往回缩。
  createEffect(
    on(typedContents, () => {
      // 刚挂载且恢复了草稿时跳过第一拍：这一拍的值就是磁盘内容，
      // 照写会把刚恢复的未保存改动盖掉。
      if (restoredDraft !== undefined) {
        // 首次打开时磁盘内容还没到：这一拍是空串，不能拿它盖掉草稿。
        if (typedContents() === "" && contents() === "") return
        // 内容到齐了。和草稿一致 = 草稿本来就是磁盘那份；不一致就保留草稿，
        // 从这里开始重新跟随打字机（用户保存之后两者自然重合）。
        restoredDraft = undefined
        if (typedContents() !== draft()) return
      }
      setDraft(typedContents())
    }),
  )

  onCleanup(() => {
    // 切走前先把「还没写盘的内容 + 光标位置」存起来：
    // 只清定时器会让 800ms 内敲的字直接消失。
    const p = path()
    if (p) {
      const view = captureView()
      if (view) rememberView(p, view)
      const value = draft()
      if (value !== contents()) {
        rememberDraft(p, value)
        // 切标签后组件就没了，别把落盘留给 400ms 的防抖。
        flushDrafts()
      }
    }
    if (saveTimer) clearTimeout(saveTimer)
    // 还没写盘就切走：直接把这一份写出去，别留给 800ms 的防抖。
    // 这里不能用 saveEditing —— 它要读已释放的信号，直接用捕获到的值。
    if (p && draft() !== contents() && !liveWrite()) {
      const value = draft()
      void file
        .write(p, value)
        .then(() => clearDraft(p, value))
        .catch(() => {})
    }
    if (viewRestoreFrame !== undefined) cancelAnimationFrame(viewRestoreFrame)
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
    <FilePreviewDiffContent
      fileDiff={view}
      diffStyle={diffStyle()}
      selectedLines={selectedLines() ?? null}
      onLineSelected={(range) => {
        if (range) setLastDiffRange(range)
      }}
      onLineSelectionEnd={(range) => {
        if (range) setLastDiffRange(range)
        syncSelected(range)
        if (!range || range.start === range.end) setSelectionMenu(undefined)
      }}
      onRendered={() => scrollSync.queueRestore()}
      search={search}
      path={path()}
      onContextMenu={(event) => {
        const range = lastDiffRange()
        if (!range) return
        event.preventDefault()
        openContextMenu(range, event.clientX, event.clientY)
      }}
    />
  )

  /**
   * 「视图▾」：预览 / 源码 / 表格 / 改动这种互斥切换。提到头部一层，
   * 切视图不用再展开「⋯」。
   */
  const headerViews = createMemo<PreviewMenuItem[]>(() => {
    const views: PreviewMenuItem[] = []
    if (diff()) {
      views.push({
        id: "view-diff",
        label: language.t("session.filePreview.diff"),
        checked: viewMode() === "diff",
        onSelect: () => setViewMode("diff"),
      })
      views.push({
        id: "view-file",
        label: language.t("session.filePreview.file"),
        checked: viewMode() === "file",
        onSelect: () => setViewMode("file"),
      })
      if (viewMode() === "diff") {
        views.push({
          id: "diff-style-split",
          label: language.t("session.review.diffStyle.split"),
          checked: diffStyle() === "split",
          onSelect: () => setDiffStyle("split"),
        })
        views.push({
          id: "diff-style-unified",
          label: language.t("session.review.diffStyle.unified"),
          checked: diffStyle() === "unified",
          onSelect: () => setDiffStyle("unified"),
        })
      }
    }
    if (isMarkdown()) {
      views.push({
        id: "markdown-preview",
        label: language.t("session.filePreview.markdownPreview"),
        checked: markdownMode() === "preview",
        onSelect: () => selectMarkdownMode("preview"),
      })
      views.push({
        id: "markdown-live",
        label: language.t("session.filePreview.markdownLive"),
        checked: markdownMode() === "live",
        onSelect: () => selectMarkdownMode("live"),
      })
      views.push({
        id: "markdown-source",
        label: language.t("session.filePreview.markdownSource"),
        checked: markdownMode() === "source",
        onSelect: () => selectMarkdownMode("source"),
      })
    }
    if (isCsv()) {
      views.push({
        id: "csv-grid",
        label: language.t("session.filePreview.csvGrid"),
        checked: csvMode() === "grid",
        onSelect: () => setCsvMode("grid"),
      })
      views.push({
        id: "csv-text",
        label: language.t("session.filePreview.csvText"),
        checked: csvMode() === "text",
        onSelect: () => setCsvMode("text"),
      })
    }
    return views
  })

  /**
   * 「⋯」菜单：低频操作按用途分组。视图切换、撤销/重做已经提到头部，
   * 这里不再重复一遍。
   */
  const codeEditorMenu = createMemo<PreviewMenuGroup[]>(() => {
    const editor: PreviewMenuItem[] = [
      {
        id: "code-palette",
        label: "命令面板",
        hint: "Ctrl+Shift+P",
        icon: "dot-grid",
        onSelect: openPalette,
      },
      {
        id: "code-wrap",
        label: "自动换行",
        checked: editorWrap(),
        onSelect: () => setEditorWrap(!editorWrap()),
      },
      {
        id: "code-focus",
        label: "专注模式",
        checked: focusMode(),
        onSelect: () => setFocusMode(!focusMode()),
      },
      {
        id: "code-definition",
        label: "跳转到定义",
        hint: "F12",
        onSelect: () => void goToDefinition(),
      },
      {
        id: "code-diff",
        label: "查看文件改动",
        checked: viewMode() === "diff",
        disabled: !diff(),
        onSelect: () => setViewMode(viewMode() === "diff" ? "file" : "diff"),
      },
      {
        id: "code-outline",
        label: "符号大纲",
        checked: outlineOpen(),
        onSelect: () => setOutlineOpen(!outlineOpen()),
      },
      {
        id: "code-search-workspace",
        label: "在工作区搜索",
        onSelect: () => (workspaceOpen() ? closeWorkspaceSearch() : openWorkspaceSearch()),
      },
    ]
    const code: PreviewMenuItem[] = [
      {
        id: "code-format",
        label: "格式化文档",
        hint: "Shift+Alt+F",
        onSelect: () => applyTextCommand("format"),
      },
      {
        id: "code-comment",
        label: "切换行注释",
        hint: "Ctrl+/",
        onSelect: () => runEditorCommand("comment"),
      },
      {
        id: "code-indent",
        label: "增加缩进",
        hint: "Tab",
        onSelect: () => runEditorCommand("indent"),
      },
      {
        id: "code-outdent",
        label: "减少缩进",
        hint: "Shift+Tab",
        onSelect: () => runEditorCommand("outdent"),
      },
    ]
    const file: PreviewMenuItem[] = [
      {
        id: "code-reveal",
        label: "在文件管理器中显示",
        iconSrc: systemAppIcons()["explorer.exe"],
        icon: "folder",
        onSelect: revealInExplorer,
      },
      { id: "code-copy-absolute", label: "复制绝对路径", onSelect: () => void copyPath("absolute") },
      { id: "code-copy-relative", label: "复制相对路径", onSelect: () => void copyPath("relative") },
      { id: "code-compare", label: "与文件比较", onSelect: compareWithFile },
      {
        id: "code-terminal",
        label: "在当前目录打开终端",
        iconSrc: systemAppIcons()[terminalApp()],
        icon: "terminal",
        onSelect: openDirectoryInTerminal,
      },
    ]
    const groups: PreviewMenuGroup[] = [
      { label: "编辑器", items: editor },
      { label: "代码", items: code },
      { label: "路径与分栏", items: file },
    ]
    if (!isOfficeDocumentPreview(path() ?? "")) {
      groups[2].items.push(
        {
          id: "code-split-right",
          label: "在右侧打开",
          onSelect: () => layout.sidePane.openSecondary(props.tab, "right"),
        },
        {
          id: "code-split-below",
          label: "在下方打开",
          onSelect: () => layout.sidePane.openSecondary(props.tab, "below"),
        },
        {
          id: "code-split-close",
          label: "关闭分栏",
          disabled: !layout.sidePane.secondary(),
          onSelect: () => layout.sidePane.closeSecondary(),
        },
      )
    }
    return groups
  })

  const headerMenu = createMemo<PreviewMenuGroup[]>(() => {
    if (codeEditor()) return codeEditorMenu()
    const groups: PreviewMenuGroup[] = []

    const reading: PreviewMenuGroup["items"] = []
    if (textDocument()) {
      reading.push(
        {
          id: "wrap",
          label: language.t("session.filePreview.wordWrap"),
          checked: editorWrap(),
          onSelect: () => setEditorWrap(!editorWrap()),
        },
        {
          id: "focus",
          label: language.t("session.filePreview.focusMode"),
          checked: focusMode(),
          onSelect: () => setFocusMode(!focusMode()),
        },
        {
          id: "typewriter",
          label: language.t("session.filePreview.typewriter"),
          checked: typewriter(),
          onSelect: () => setTypewriter(!typewriter()),
        },
      )
    }
    if (isMarkdown()) {
      reading.push(
        {
          id: "outline",
          label: language.t("session.filePreview.outline"),
          checked: outlineOpen(),
          onSelect: () => setOutlineOpen(!outlineOpen()),
        },
        {
          id: "notes",
          label: language.t("session.filePreview.notes"),
          checked: notesOpen(),
          onSelect: () => openNotes(),
        },
      )
    }
    if (reading.length > 0) groups.push({ label: language.t("session.filePreview.group.reading"), items: reading })

    if (editing()) {
      const commands: PreviewMenuGroup["items"] = []
      if (textDocument()) {
        commands.push({
          id: "palette",
          label: language.t("session.filePreview.paletteItem"),
          hint: "Ctrl+Shift+P",
          onSelect: openPalette,
        })
        if (isMarkdown()) {
          commands.push({
            id: "properties",
            label: language.t("session.filePreview.properties"),
            checked: propertiesOpen(),
            onSelect: () => {
              setPropertiesOpen(!propertiesOpen())
              if (!propertiesOpen()) setMarkdownMode("live")
            },
          })
        }
        commands.push({
          id: "workspace-search",
          label: language.t("session.filePreview.workspaceSearch"),
          onSelect: () => (workspaceOpen() ? closeWorkspaceSearch() : openWorkspaceSearch()),
        })
      }
      // 撤销 / 重做在头部那一行，不在这里重复一遍。
      if (commands.length > 0) groups.push({ label: language.t("session.filePreview.group.edit"), items: commands })

      // 常用命令只放最常用的几条，完整清单在命令面板里搜。
      const common: PreviewMenuGroup["items"] = []
      if (textDocument()) {
        common.push(
          { id: "sort", label: language.t("session.filePreview.sortLines"), onSelect: () => applyTextCommand("sort") },
          {
            id: "unique",
            label: language.t("session.filePreview.uniqueLines"),
            onSelect: () => applyTextCommand("unique"),
          },
          {
            id: "reverse",
            label: language.t("session.filePreview.reverseLines"),
            onSelect: () => applyTextCommand("reverse"),
          },
          { id: "trim", label: language.t("session.filePreview.trimLines"), onSelect: () => applyTextCommand("trim") },
          {
            id: "upper",
            label: language.t("session.filePreview.upperCase"),
            onSelect: () => runEditorCommand("upper"),
          },
          {
            id: "lower",
            label: language.t("session.filePreview.lowerCase"),
            onSelect: () => runEditorCommand("lower"),
          },
          {
            id: "comment",
            label: language.t("session.filePreview.toggleComment"),
            hint: "Ctrl+/",
            onSelect: () => runEditorCommand("comment"),
          },
        )
        if (isMarkdown()) {
          common.push(
            {
              id: "h1",
              label: language.t("session.filePreview.heading1"),
              onSelect: () => applyBlockCommand("heading1"),
            },
            {
              id: "bullet",
              label: language.t("session.filePreview.bulletList"),
              onSelect: () => applyBlockCommand("bulletList"),
            },
            {
              id: "table",
              label: language.t("session.filePreview.insertTable"),
              onSelect: () => applyMarkdownInsert("table"),
            },
            {
              id: "code",
              label: language.t("session.filePreview.insertCodeBlock"),
              onSelect: () => applyMarkdownInsert("codeBlock"),
            },
          )
        }
        common.push({
          id: "format",
          label: language.t("session.filePreview.format"),
          hint: "Shift+Alt+F",
          onSelect: () => applyTextCommand("format"),
        })
        common.push({
          id: "more-commands",
          label: language.t("session.filePreview.moreCommands"),
          hint: "Ctrl+Shift+P",
          onSelect: openPalette,
        })
      }
      if (common.length > 0) groups.push({ label: language.t("session.filePreview.group.common"), items: common })
    }

    const output: PreviewMenuGroup["items"] = []
    if (["docx", "xlsx", "pptx", "pdf"].includes(officeFormatOf(path() ?? "") ?? "")) {
      output.push({
        id: "office-save-copy",
        label: "另存为副本（保留原件）",
        disabled: exporting(),
        onSelect: () => void saveOfficeCopy(),
      })
    }
    if (exportVisible()) {
      for (const target of exportTargets()) {
        output.push({
          id: `export-${target}`,
          label: language.t("session.filePreview.exportAs", { format: target }),
          disabled: exporting(),
          onSelect: () => void runExport(target),
        })
      }
    }
    if (path() && officeFormatOf(path() ?? "") !== "pdf") {
      output.push({ id: "print", label: language.t("session.filePreview.print"), onSelect: printPreview })
      if (platform.printToPdf) {
        output.push({
          id: "export-pdf",
          label: language.t("session.filePreview.exportPdf"),
          disabled: exportingPdf(),
          onSelect: () => void exportPdf(),
        })
      }
    }
    if (isHtml()) {
      output.push({
        id: "browser",
        label: language.t("session.filePreview.previewInBrowser"),
        onSelect: openInBrowser,
      })
    }
    if (output.length > 0) groups.push({ label: language.t("session.filePreview.group.export"), items: output })

    const fileItems: PreviewMenuGroup["items"] = [
      { id: "reveal", label: language.t("session.filePreview.revealInExplorer"), onSelect: revealInExplorer },
      {
        id: "copy-absolute",
        label: language.t("session.filePreview.copyAbsolutePath"),
        onSelect: () => void copyPath("absolute"),
      },
      {
        id: "copy-relative",
        label: language.t("session.filePreview.copyRelativePath"),
        onSelect: () => void copyPath("relative"),
      },
      {
        id: "compare-with",
        label: language.t("session.filePreview.compareWith"),
        onSelect: compareWithFile,
      },
    ]
    // Office 编辑器不提供文本 diff 的左右/上下分屏操作；这些入口会让 Office
    // 预览头部出现与文档编辑无关的「改动/文件」工作流，因此只保留普通文件的能力。
    if (!isOfficeDocumentPreview(path() ?? "")) {
      fileItems.push(
        {
          id: "split-right",
          label: language.t("sidePane.tab.openRight"),
          onSelect: () => layout.sidePane.openSecondary(props.tab, "right"),
        },
        {
          id: "split-below",
          label: language.t("sidePane.tab.openBelow"),
          onSelect: () => layout.sidePane.openSecondary(props.tab, "below"),
        },
        {
          id: "split-close",
          label: language.t("sidePane.split.close"),
          disabled: !layout.sidePane.secondary(),
          onSelect: () => layout.sidePane.closeSecondary(),
        },
      )
    }
    groups.push({
      label: language.t("session.filePreview.group.file"),
      items: fileItems,
    })

    // 帮助类：只放真正有用的入口，完整清单在设置页 / 命令面板里。
    const help: PreviewMenuGroup["items"] = [
      {
        id: "shortcut-help",
        label: language.t("session.filePreview.shortcutHelp"),
        hint: "Ctrl+K Ctrl+S",
        onSelect: () => setShortcutHelpOpen(true),
      },
    ]
    if (help.length > 0) groups.push({ label: language.t("session.filePreview.group.help"), items: help })

    return groups
  })

  return (
    <>
      <Tabs.Content value={props.tab} class="relative h-full">
        <div
          ref={(el) => {
            contentRef = el
          }}
          class="relative h-full"
        >
          <div class="flex h-full flex-col">
            <Show when={path()}>
              {(current) => (
                <FilePreviewHeader
                  path={current()}
                  saveStatus={saveStatus()}
                  editing={editing()}
                  canEdit={canEdit()}
                  editLabel={editLabel()}
                  onToggleEditing={toggleEditing}
                  onFind={editing() && textDocument() ? openPanelFind : undefined}
                  onUndo={editing() ? undoStep : undefined}
                  onRedo={editing() ? redoStep : undefined}
                  canUndo={canUndoStep()}
                  canRedo={canRedoStep()}
                  undoLabel={officeHistory().undoLabel}
                  redoLabel={officeHistory().redoLabel}
                  onSave={
                    editing() && textDocument()
                      ? () => void saveEditing()
                      : officePath() && officeDirty()
                        ? () => void saveMountedOfficeEditor()
                        : undefined
                  }
                  onOpenNative={
                    platform.platform === "desktop" && server.isLocal() && !!platform.openPath
                      ? () => void openDefaultApp()
                      : undefined
                  }
                  openNativeLabel={language.t("session.filePreview.open")}
                  openNativeMenu={officeNativeMenu()}
                  viewMenu={isOfficeDocumentPreview(current()) || codeEditor() ? [] : headerViews()}
                  menu={headerMenu()}
                  mode={codeEditor() ? "code" : "default"}
                  languageLabel={codeEditor() ? codeLanguageLabel() : undefined}
                  onPreviewInBrowser={isHtml() ? openInBrowser : undefined}
                  treeOpen={!isOfficeDocumentPreview(current()) && layout.sidePane.tree()}
                  onToggleTree={isOfficeDocumentPreview(current()) ? undefined : () => layout.sidePane.toggleTree()}
                  badge={
                    !isOfficeDocumentPreview(current()) && diff() && viewMode() === "diff"
                      ? language.t("session.filePreview.diff")
                      : undefined
                  }
                />
              )}
            </Show>
            {/*
            崩溃恢复提示：上次没保存就退出（或强杀）时，草稿是从本地存储里捞回来的。
            不声不响地把旧内容铺开，用户会以为磁盘上本来就是这样 —— 所以给一条可撤销的提示。
          */}
            <Show when={restoredFromDisk() === path() && saveStatus() === "dirty"}>
              <div
                class="mx-4 mb-2 flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-3 py-1.5 text-12-regular text-foreground-subtle"
                data-action="restored-draft-banner"
              >
                <span class="min-w-0 truncate">已恢复上次未保存的改动（磁盘上还没有这份内容）</span>
                <div class="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    data-action="restored-draft-keep"
                    class="rounded px-1.5 py-0.5 text-ui-xs text-foreground-subtle transition-colors hover:text-foreground"
                    onClick={() => setRestoredFromDisk(undefined)}
                  >
                    保留
                  </button>
                  <button
                    type="button"
                    data-action="restored-draft-discard"
                    class="rounded px-1.5 py-0.5 text-ui-xs text-foreground-subtle transition-colors hover:text-foreground"
                    onClick={discardRestoredDraft}
                  >
                    丢弃
                  </button>
                </div>
              </div>
            </Show>
            <div
              ref={(el) => {
                bodyRef = el
              }}
              class="flex min-h-0 flex-1"
            >
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
                      <>
                        {/* 实况预览：排版好的样子，双击某一段就在原地改它的源码。
                          渲染 draft 而不是 typedContents —— 用户刚改的那一块要立刻可见，
                          打字机揭示只负责把 draft 往前推，不需要在这里再读一遍。 */}
                        <Show when={previewBranch() === "markdown-live"}>
                          <FilePreviewMarkdownLiveContent
                            text={draft}
                            onFileOpen={openLinkedFile}
                            onWikiLink={openWikiLink}
                            onChange={applyDraftText}
                            properties={{
                              open: propertiesOpen,
                              rows: () => propertyRows() ?? [],
                              newKey: () => newPropertyKey() ?? "",
                              newValue: () => newPropertyValue() ?? "",
                              setOpen: setPropertiesOpen,
                              setNewKey: setNewPropertyKey,
                              setNewValue: setNewPropertyValue,
                              setText: setPropertyText,
                              remove: removeProperty,
                              add: addProperty,
                              formatValue: formatFrontMatterValue,
                            }}
                          />
                        </Show>
                        <Show when={previewBranch() === "markdown-preview"}>
                          <FilePreviewMarkdownReadContent
                            text={typedContents()}
                            cacheKey={cacheKey() ?? ""}
                            onFileOpen={openLinkedFile}
                            onWikiLink={openWikiLink}
                            onTaskToggle={togglePreviewTask}
                          />
                        </Show>
                        {/* 图片:文本通道返回的是 base64,直接交给真实图片预览。
                          必须排在文本编辑分支之前,否则 base64 会按乱码文本打开。 */}
                        <Show when={previewBranch() === "image"}>
                          <FilePreviewBinaryContent
                            path={path}
                            loaded={() => true}
                            loading={() => false}
                            error={() => undefined}
                            officeFailure={() => undefined}
                            officeBase64={() => undefined}
                            imageBase64={imageBase64}
                            mediaUrl={mediaPreviewUrl}
                            mediaFailure={mediaFailureForCurrent}
                            onMediaError={refreshMediaTicket}
                            editing={editing}
                            loadingLabel={language.t("common.loading")}
                            onSaveImage={saveImage}
                            officePreviewProps={{}}
                          />
                        </Show>
                        <PluginFilePreviewerHost previewer={activeFilePreviewer()} active={previewBranch() === "text"}>
                          <Show when={previewBranch() === "text"}>
                            <div class="relative flex h-full min-h-0 flex-col">
                              {/* 查找/替换条：匹配由 core 的纯函数现算，替换只把结果塞回 draft，
                              仍然走同一条防抖保存，不新增写盘通道。 */}
                              <Show when={findOpen() && !(isCsv() && csvMode() === "grid")}>
                                <FilePreviewTextFindBar
                                  inputRef={(element) => {
                                    findInputRef = element
                                  }}
                                  query={findQuery()}
                                  onQueryInput={setFindQuery}
                                  onQueryKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                      event.preventDefault()
                                      findStep(event.shiftKey ? -1 : 1)
                                    }
                                    if (event.key === "Escape") {
                                      event.preventDefault()
                                      closeFind()
                                    }
                                  }}
                                  invalid={findInvalid()}
                                  matchCount={findMatches().length}
                                  matchIndex={findIndex()}
                                  onStep={findStep}
                                  options={[
                                    {
                                      id: "case",
                                      label: "Aa",
                                      title: "区分大小写",
                                      active: findCaseSensitive,
                                      toggle: setFindCaseSensitive,
                                    },
                                    {
                                      id: "regex",
                                      label: ".*",
                                      title: "正则表达式",
                                      active: findRegex,
                                      toggle: setFindRegex,
                                    },
                                    {
                                      id: "word",
                                      label: "整词",
                                      title: "全字匹配",
                                      active: findWholeWord,
                                      toggle: setFindWholeWord,
                                    },
                                  ]}
                                  replaceOpen={findReplaceOpen()}
                                  replacement={findReplacement()}
                                  onReplacementInput={setFindReplacement}
                                  onReplacementKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                      event.preventDefault()
                                      replaceCurrentFind()
                                    }
                                    if (event.key === "Escape") {
                                      event.preventDefault()
                                      closeFind()
                                    }
                                  }}
                                  onReplaceCurrent={replaceCurrentFind}
                                  onReplaceAll={replaceAllFind}
                                  onToggleReplace={() => setFindReplaceOpen(!findReplaceOpen())}
                                  onClose={closeFind}
                                />
                              </Show>
                              <FilePreviewWorkspaceSearchResults
                                open={workspaceOpen()}
                                inputRef={(element) => {
                                  workspaceInput = element
                                }}
                                query={workspaceQuery()}
                                busy={workspaceBusy()}
                                groups={workspaceGroups()}
                                resultCount={workspaceResults().length}
                                onQueryInput={(query) => {
                                  setWorkspaceQuery(query)
                                  runWorkspaceSearch(query)
                                }}
                                onQueryKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault()
                                    runWorkspaceSearch(workspaceQuery())
                                  }
                                  if (event.key === "Escape") closeWorkspaceSearch()
                                }}
                                onClose={closeWorkspaceSearch}
                                onResult={openSearchResult}
                              />
                              {/* 跳转到行：条很窄，和查找条一样贴着编辑区顶部。 */}
                              <Show when={gotoOpen()}>
                                <FilePreviewTextGotoBar
                                  inputRef={(element) => {
                                    gotoInputRef = element
                                  }}
                                  value={gotoValue()}
                                  lineCount={draft().split(NEWLINE).length}
                                  onInput={setGotoValue}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                      event.preventDefault()
                                      const line = Number(gotoValue().trim())
                                      if (Number.isFinite(line) && line >= 1) jumpToLine(line)
                                      return
                                    }
                                    if (event.key === "Escape") {
                                      event.preventDefault()
                                      closeGoto()
                                    }
                                  }}
                                  onClose={closeGoto}
                                />
                              </Show>
                              {/* 大纲浮层：透明底板负责「点外面收起」，内容面板在左上角。 */}
                              <Show when={outlineOpen()}>
                                <div
                                  class="absolute inset-0 z-20"
                                  onMouseDown={(event) => {
                                    if (event.target === event.currentTarget) setOutlineOpen(false)
                                  }}
                                  onKeyDown={(event) => {
                                    if (event.key === "Escape") setOutlineOpen(false)
                                  }}
                                >
                                  <div class="absolute left-3 top-10 max-h-72 w-64 overflow-y-auto rounded-lg border border-border bg-background py-1 shadow-lg">
                                    <div class="px-3 py-1 text-11-regular text-foreground-subtlest">大纲</div>
                                    <Show
                                      when={visibleOutlineItems().length > 0}
                                      fallback={
                                        <div class="px-3 py-2 text-11-regular text-foreground-subtlest">
                                          {codeEditor()
                                            ? lspOutlineBusy()
                                              ? "正在读取语言服务符号…"
                                              : "还没有可导航的符号"
                                            : "还没有标题"}
                                        </div>
                                      }
                                    >
                                      <For each={visibleOutlineItems()}>
                                        {(entry) => (
                                          <button
                                            type="button"
                                            data-action="markdown-outline-jump"
                                            class="flex w-full items-center gap-1 py-1 pr-3 text-left text-12-regular text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
                                            style={{ "padding-left": `${12 + (entry.level - 1) * 12}px` }}
                                            onClick={() => jumpToOutline(entry.line)}
                                          >
                                            <span class="min-w-0 flex-1 truncate">{entry.text}</span>
                                            <span class="shrink-0 text-11-regular text-foreground-subtlest">
                                              {entry.line}
                                            </span>
                                          </button>
                                        )}
                                      </For>
                                    </Show>
                                  </div>
                                </div>
                              </Show>
                              {/* 笔记浮层：标签 / 出链 / 反链。
                              点标签转到「全局」搜索，点链接打开文件，点反链跳到那一行。 */}
                              <Show when={notesOpen()}>
                                <div
                                  class="absolute inset-0 z-20"
                                  onMouseDown={(event) => {
                                    if (event.target === event.currentTarget) setNotesOpen(false)
                                  }}
                                  onKeyDown={(event) => {
                                    if (event.key === "Escape") setNotesOpen(false)
                                  }}
                                >
                                  <div class="absolute left-3 top-10 max-h-80 w-72 overflow-y-auto rounded-lg border border-border bg-background py-1 shadow-lg">
                                    <div class="px-3 py-1 text-11-regular text-foreground-subtlest">笔记</div>
                                    <Show when={noteHeading()}>
                                      {(title) => (
                                        <div
                                          class="truncate px-3 py-0.5 text-12-medium text-foreground"
                                          data-action="markdown-notes-title"
                                        >
                                          {title()}
                                        </div>
                                      )}
                                    </Show>
                                    <div class="px-3 pt-1.5 text-11-regular text-foreground-subtlest">标签</div>
                                    <Show
                                      when={noteTagItems().length > 0}
                                      fallback={
                                        <div class="px-3 py-1 text-11-regular text-foreground-subtlest">
                                          还没有标签（写法：#标签）
                                        </div>
                                      }
                                    >
                                      <div class="flex flex-wrap gap-1 px-3 py-1">
                                        <For each={noteTagItems()}>
                                          {(tag) => (
                                            <button
                                              type="button"
                                              data-action="markdown-notes-tag"
                                              class="rounded bg-hover px-1.5 py-0.5 text-11-regular text-foreground-subtle transition-colors hover:text-foreground"
                                              onClick={() => searchNoteTag("#" + tag)}
                                            >
                                              {"#" + tag}
                                            </button>
                                          )}
                                        </For>
                                      </div>
                                    </Show>
                                    <div class="px-3 pt-1.5 text-11-regular text-foreground-subtlest">出链</div>
                                    <Show
                                      when={noteLinkItems().length > 0}
                                      fallback={
                                        <div class="px-3 py-1 text-11-regular text-foreground-subtlest">
                                          还没有链接（写法：[[目标]]）
                                        </div>
                                      }
                                    >
                                      <For each={noteLinkItems().slice(0, 30)}>
                                        {(link) => (
                                          <button
                                            type="button"
                                            data-action="markdown-notes-link"
                                            class="flex w-full items-center gap-1 py-1 pr-3 text-left text-12-regular text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
                                            style={{ "padding-left": "12px" }}
                                            title={link.target}
                                            onClick={() => openNoteLink(link.target)}
                                          >
                                            <span class="min-w-0 flex-1 truncate">
                                              {link.alias ?? link.target}
                                              {link.anchor ? " › " + link.anchor : ""}
                                            </span>
                                            <span class="shrink-0 text-11-regular text-foreground-subtlest">
                                              {link.line}
                                            </span>
                                          </button>
                                        )}
                                      </For>
                                    </Show>
                                    <div class="px-3 pt-1.5 text-11-regular text-foreground-subtlest">
                                      反链{backlinksBusy() ? "（搜索中…）" : "（" + String(backlinks().length) + "）"}
                                    </div>
                                    <Show
                                      when={backlinks().length > 0}
                                      fallback={
                                        <div class="px-3 py-1 text-11-regular text-foreground-subtlest">
                                          {backlinksBusy() ? "正在项目里查找…" : "没有别的笔记链接到这里"}
                                        </div>
                                      }
                                    >
                                      <For each={backlinks()}>
                                        {(item) => (
                                          <button
                                            type="button"
                                            data-action="markdown-notes-backlink"
                                            class="flex w-full items-center gap-1 py-1 pr-3 text-left text-12-regular text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
                                            style={{ "padding-left": "12px" }}
                                            title={item.text}
                                            onClick={() => {
                                              setNotesOpen(false)
                                              openSearchResult(item)
                                            }}
                                          >
                                            <span class="min-w-0 flex-1 truncate">
                                              {item.path}
                                              <span class="text-foreground-subtlest">:{item.line}</span>
                                            </span>
                                          </button>
                                        )}
                                      </For>
                                    </Show>
                                  </div>
                                </div>
                              </Show>
                              {/* 命令面板：输入即过滤，↑↓ 选择，回车执行，Esc 关闭。
                              只覆盖编辑区，不挡住上面的工具栏。 */}
                              <Show when={paletteOpen()}>
                                <div
                                  class="absolute inset-x-0 top-0 z-30 mx-auto max-w-xl rounded-lg border border-border bg-background shadow-lg"
                                  data-component="text-palette"
                                >
                                  <input
                                    ref={(el) => {
                                      paletteInput = el
                                    }}
                                    type="text"
                                    data-action="text-palette-query"
                                    placeholder="输入命令…（Esc 关闭）"
                                    class="w-full rounded-t-lg border-b border-border bg-background px-3 py-2 text-12-regular text-foreground outline-none"
                                    value={paletteQuery()}
                                    onInput={(event) => {
                                      setPaletteQuery(event.currentTarget.value)
                                      setPaletteIndex(0)
                                    }}
                                    onKeyDown={(event) => {
                                      const items = paletteItems()
                                      if (event.key === "ArrowDown") {
                                        event.preventDefault()
                                        setPaletteIndex((current) =>
                                          items.length === 0 ? 0 : (current + 1) % items.length,
                                        )
                                        return
                                      }
                                      if (event.key === "ArrowUp") {
                                        event.preventDefault()
                                        setPaletteIndex((current) =>
                                          items.length === 0 ? 0 : (current + items.length - 1) % items.length,
                                        )
                                        return
                                      }
                                      if (event.key === "Enter") {
                                        event.preventDefault()
                                        const picked = items[paletteIndex()]
                                        if (picked) runPaletteCommand(picked.id)
                                        return
                                      }
                                      if (event.key === "Escape") {
                                        event.preventDefault()
                                        closePalette()
                                      }
                                    }}
                                  />
                                  <div class="max-h-72 overflow-y-auto py-1">
                                    <For each={paletteItems().slice(0, PALETTE_LIMIT)}>
                                      {(item, index) => (
                                        <button
                                          type="button"
                                          data-action={`text-palette-${item.id}`}
                                          class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-12-regular transition-colors"
                                          classList={{
                                            "bg-hover text-foreground": index() === paletteIndex(),
                                            "text-foreground-subtle hover:bg-hover hover:text-foreground":
                                              index() !== paletteIndex(),
                                          }}
                                          onMouseEnter={() => setPaletteIndex(index())}
                                          onClick={() => runPaletteCommand(item.id)}
                                        >
                                          <span class="min-w-0 flex-1 truncate">{item.label}</span>
                                          <Show when={item.shortcut}>
                                            <span class="shrink-0 text-11-regular text-foreground-subtlest">
                                              {item.shortcut}
                                            </span>
                                          </Show>
                                        </button>
                                      )}
                                    </For>
                                    <Show when={paletteItems().length === 0}>
                                      <div class="px-3 py-2 text-11-regular text-foreground-subtlest">
                                        没有匹配的命令
                                      </div>
                                    </Show>
                                  </div>
                                </div>
                              </Show>
                              <Show
                                when={!(isCsv() && csvMode() === "grid")}
                                fallback={
                                  <CsvGrid
                                    path={path()}
                                    text={draft()}
                                    onChange={applyDraftText}
                                    readOnly={!editing()}
                                  />
                                }
                              >
                                <div
                                  class="flex min-h-0 flex-1"
                                  classList={{ "mx-auto w-full max-w-3xl": focusMode() }}
                                  style={{ zoom: String(fontZoom() / 100) }}
                                >
                                  <Show when={codeEditor()}>
                                    <CodeEditor
                                      value={draft()}
                                      path={path()}
                                      readOnly={!editing()}
                                      onReady={(handle) => {
                                        editorRef = handle
                                        gutterRef = undefined
                                      }}
                                      onChange={handleCodeEditorChange}
                                      onSelectionChange={({ anchor, head }) => syncCaretPosition(anchor, head)}
                                      onScroll={(position) => {
                                        if (gutterRef) gutterRef.scrollTop = position.top
                                        setEditorScroll(position)
                                      }}
                                      onMouseDown={handleEditorMouseDown}
                                      onMouseUp={handleEditorMouseUp}
                                      onContextMenu={handleEditorContextMenu}
                                      onKeyDown={handleCodeEditorKeyDown}
                                      onBlur={() => {
                                        if (draft() !== contents()) void saveEditing()
                                      }}
                                      onRequestDiagnostics={requestLspDiagnostics}
                                    />
                                  </Show>
                                  <Show when={!codeEditor()}>
                                    {/* 自动换行后一行会占多个视觉行，行号列的 24px 网格对不上；
                              隐藏行号是诚实的做法（比错位的行号好）。 */}
                                    <Show when={!editorWrap()}>
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
                                              classList={{ "bg-surface": line === caretInfo().line }}
                                              style={{ height: "24px", "line-height": "24px" }}
                                              onContextMenu={(event: MouseEvent) => {
                                                event.preventDefault()
                                                openContextMenu(
                                                  { start: line, end: line },
                                                  event.clientX,
                                                  event.clientY,
                                                )
                                              }}
                                            >
                                              {line}
                                            </div>
                                          )}
                                        </For>
                                      </div>
                                    </Show>
                                    {/* 着色层和 textarea 叠在同一个盒子里：透明字的 textarea 在上层
                              负责输入，彩色文字在下层负责观感，滚动位置由 translate 跟上。 */}
                                    <div class="relative min-w-0 flex-1 bg-background">
                                      <Show when={!editorWrap()}>
                                        <div
                                          class="pointer-events-none absolute inset-x-0 z-0 h-6"
                                          style={{
                                            top: `${16 + (caretInfo().line - 1) * 24 - editorScroll().top}px`,
                                            background:
                                              "color-mix(in srgb, var(--surface-interactive-weak) 32%, transparent)",
                                          }}
                                          aria-hidden="true"
                                        />
                                      </Show>
                                      <Show when={!editorWrap() && highlightLanguage() !== undefined}>
                                        <CodeHighlight
                                          text={draft()}
                                          path={path()}
                                          scrollTop={editorScroll().top}
                                          scrollLeft={editorScroll().left}
                                          onSync={setHighlightSynced}
                                        />
                                      </Show>
                                      <textarea
                                        ref={(el) => {
                                          editorRef = el
                                        }}
                                        class="relative h-full w-full resize-none py-4 pr-4 font-mono text-13 leading-6 outline-none"
                                        classList={{
                                          "overflow-x-auto": !editorWrap(),
                                          "bg-transparent text-transparent": highlightOn(),
                                          "bg-transparent": !highlightOn(),
                                        }}
                                        style={{ "line-height": "24px", "caret-color": "var(--foreground)" }}
                                        value={draft()}
                                        readOnly={!editing()}
                                        wrap={editorWrap() ? "soft" : "off"}
                                        spellcheck={false}
                                        onScroll={(event) => {
                                          const position = {
                                            top: event.currentTarget.scrollTop,
                                            left: event.currentTarget.scrollLeft,
                                          }
                                          if (gutterRef) gutterRef.scrollTop = position.top
                                          setEditorScroll(position)
                                        }}
                                        onInput={(event) => {
                                          const element = event.currentTarget
                                          const previous = draft()
                                          const anchor = Math.max(0, Math.min(caretAt(), previous.length))
                                          const head = Math.max(
                                            anchor,
                                            Math.min(anchor + selectionLength(), previous.length),
                                          )
                                          const target = path()
                                          if (target) {
                                            recordTextChange(
                                              target,
                                              { text: previous, anchor, head },
                                              {
                                                text: element.value,
                                                anchor: element.selectionStart,
                                                head: element.selectionEnd,
                                              },
                                              "typing",
                                            )
                                            bumpHistory()
                                          }
                                          setDraft(element.value)
                                          syncCaret(element)
                                          centerCaret(element)
                                          if (target) rememberDraft(target, element.value)
                                          scheduleSave()
                                        }}
                                        onSelect={(event) => syncCaret(event.currentTarget)}
                                        onBlur={() => {
                                          if (draft() !== contents()) void saveEditing()
                                        }}
                                        onContextMenu={handleEditorContextMenu}
                                        onMouseDown={handleEditorMouseDown}
                                        onMouseUp={handleEditorMouseUp}
                                        onKeyDown={(event) => {
                                          if (!editing()) return
                                          const accel = event.metaKey || event.ctrlKey
                                          // 撤销 / 重做：跨标签切回来也要能退（原生 textarea 的栈会随卸载丢掉）。
                                          // 自己没记过这一步时放行给浏览器，保留原生手感。
                                          if (accel && event.key.toLowerCase() === "z") {
                                            const target = path()
                                            const redo = event.shiftKey
                                            if (target && (redo ? canRedoText(target) : canUndoText(target))) {
                                              event.preventDefault()
                                              stepTextHistory(redo ? "redo" : "undo")
                                              return
                                            }
                                          }
                                          if (accel && !event.shiftKey && event.key.toLowerCase() === "y") {
                                            const target = path()
                                            if (target && canRedoText(target)) {
                                              event.preventDefault()
                                              stepTextHistory("redo")
                                              return
                                            }
                                          }
                                          if (accel && event.key.toLowerCase() === "s") {
                                            event.preventDefault()
                                            void saveEditing()
                                            return
                                          }
                                          if (accel && event.shiftKey && event.key.toLowerCase() === "p") {
                                            event.preventDefault()
                                            openPalette()
                                            return
                                          }
                                          if (accel && event.key.toLowerCase() === "f") {
                                            event.preventDefault()
                                            openFind(false)
                                            return
                                          }
                                          if (accel && event.key.toLowerCase() === "h") {
                                            event.preventDefault()
                                            openFind(true)
                                            return
                                          }
                                          if (accel && event.key.toLowerCase() === "g") {
                                            event.preventDefault()
                                            openGoto()
                                            return
                                          }
                                          if (event.key === "Escape" && findOpen()) {
                                            event.preventDefault()
                                            closeFind()
                                            return
                                          }
                                          if (event.key === "Tab" && !accel && !event.altKey) {
                                            event.preventDefault()
                                            runEditorCommand(event.shiftKey ? "outdent" : "indent")
                                            return
                                          }
                                          if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
                                            event.preventDefault()
                                            runEditorCommand(event.key === "ArrowUp" ? "moveUp" : "moveDown")
                                            return
                                          }
                                          if (accel && event.key === "/") {
                                            event.preventDefault()
                                            runEditorCommand("comment")
                                            return
                                          }
                                          if (accel && event.shiftKey && event.key.toLowerCase() === "k") {
                                            event.preventDefault()
                                            runEditorCommand("delete")
                                            return
                                          }
                                          if (accel && event.shiftKey && event.key.toLowerCase() === "d") {
                                            event.preventDefault()
                                            runEditorCommand("duplicate")
                                          }
                                        }}
                                      />
                                    </div>
                                  </Show>
                                </div>
                              </Show>
                              {/* 底部状态栏：光标行列 + 选区 + 全文统计 + 缩放。
                              阅读模式下光标本就没有意义，视图开关统一收在头部的「⋯」菜单里。 */}
                              <Show when={editing() && !(isCsv() && csvMode() === "grid")}>
                                <PaneStatusBar
                                  info={
                                    <span class="flex min-w-0 items-center gap-3">
                                      <span>
                                        行 {caretInfo().line}，列 {caretInfo().column}
                                      </span>
                                      <Show when={selectionLength() > 0}>
                                        <span>已选 {selectionLength()} 字符</span>
                                      </Show>
                                    </span>
                                  }
                                  extra={
                                    <span class="flex items-center gap-3">
                                      <Show when={codeEditor()}>
                                        <span
                                          classList={{
                                            "text-interactive-base": codeLspStatus().state === "connected",
                                            "text-critical-base": codeLspStatus().state === "error",
                                            "text-foreground-subtlest": codeLspStatus().state === "none",
                                          }}
                                          title="语言服务状态"
                                        >
                                          {codeLspStatus().label}
                                        </span>
                                      </Show>
                                      <span>{editorStats().lines} 行</span>
                                      <span>{editorStats().characters} 字符</span>
                                      <span>{editorStats().words} 词</span>
                                    </span>
                                  }
                                  zoom={{
                                    value: () => fontZoom(),
                                    onStep: (zoomIn) =>
                                      setFontZoom((x) => Math.max(50, Math.min(200, x + (zoomIn ? 10 : -10)))),
                                    onReset: () => setFontZoom(100),
                                  }}
                                />
                              </Show>
                            </div>
                          </Show>
                        </PluginFilePreviewerHost>
                        <PluginFilePreviewerHost previewer={activeFilePreviewer()} active={!previewBranch()}>
                          <Show when={!previewBranch()}>
                            <FilePreviewBinaryContent
                              path={path}
                              loaded={() => state()?.loaded === true}
                              loading={() => state()?.loading === true}
                              error={() => state()?.error}
                              officeFailure={officeFailure}
                              officeBase64={officeBase64}
                              imageBase64={imageBase64}
                              mediaUrl={mediaPreviewUrl}
                              mediaFailure={mediaFailureForCurrent}
                              onMediaError={refreshMediaTicket}
                              editing={editing}
                              loadingLabel={language.t("common.loading")}
                              onSaveImage={saveImage}
                              officePreviewProps={
                                {
                                  onEdited: () => file.load(path()!, { force: true }),
                                  onSaveParagraph: saveDocxParagraph,
                                  onSaveCell: saveCell,
                                  onDirty: setOfficeDirty,
                                  onQuoteSelection: addOfficeSelectionToTask,
                                  beforeOfficeSave: (baseline, target = path()!) => confirmOfficeSave(target, baseline),
                                  writeOfficeBytes: (bytes, expectedBaselineSha256, target = path()!) =>
                                    writeOfficeEditorBytes(target, bytes, expectedBaselineSha256),
                                  prepareLegacyEditor: prepareLegacyOfficeEditor,
                                  onPdfPageOp: (op) => applyPdfPageOperation(path()!, op),
                                  onTogglePdfTools: (open) => {
                                    if (open && officeDirty()) {
                                      showToast({
                                        variant: "default",
                                        title: "请先保存 PDF 编辑器中的更改",
                                        description: "保存后再切换到其他页面工具，避免丢失编辑内容。",
                                      })
                                      return false
                                    }
                                    return true
                                  },
                                  onPdfPage: setPdfViewPage,
                                  closeGuardPath: path(),
                                } satisfies Omit<OfficeFilePreviewProps, "path" | "base64">
                              }
                            />
                          </Show>
                        </PluginFilePreviewerHost>
                      </>
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
                class="absolute z-50 w-[min(520px,calc(100%-16px))] rounded-lg border border-border bg-popover p-2 text-ui-sm text-foreground shadow-[var(--shadow-md)]"
                style={{ left: `${menu().x}px`, top: `${menu().y}px` }}
                onMouseDown={(event) => {
                  const target = event.target
                  if (!(target instanceof Element) || !target.closest("textarea, button")) event.preventDefault()
                }}
              >
                <textarea
                  value={selectionMenuComment()}
                  rows={2}
                  class="mb-1.5 block w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-12-regular text-foreground outline-none placeholder:text-foreground-subtlest focus:border-interactive-base"
                  placeholder="评论这部分需要怎么修改（可选）"
                  aria-label="评论这部分需要怎么修改"
                  onInput={(event) => setSelectionMenuComment(event.currentTarget.value)}
                />
                <div class="flex items-center gap-0.5">
                  <button
                    type="button"
                    data-action="file-ai-inline-edit"
                    disabled={inlineEditBusy()}
                    class="flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-interactive-base transition-colors hover:bg-hover disabled:cursor-wait disabled:opacity-60"
                    onClick={() => {
                      const current = menu()
                      const instruction = selectionMenuComment().trim() || "按要求改进这段代码。"
                      setSelectionMenu(undefined)
                      setSelectionMenuComment("")
                      void applyAIInlineEdit(current.selection, instruction)
                    }}
                  >
                    {inlineEditBusy() ? "AI 修改中…" : "AI 修改"}
                  </button>
                  <div class="w-px shrink-0 bg-border" />
                  <button
                    type="button"
                    data-action="file-add-to-task"
                    class="flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 transition-colors hover:bg-hover"
                    onClick={() => {
                      const current = menu()
                      setSelectionMenu(undefined)
                      addSelectionToTask(current.selection, selectionMenuComment())
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
                  <div class="w-px shrink-0 bg-border" />
                  <For each={AI_ACTIONS}>
                    {(action) => (
                      <button
                        type="button"
                        data-action={`file-ai-${action}`}
                        class="flex items-center whitespace-nowrap rounded-md px-2 py-1.5 text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
                        onClick={() => {
                          const current = menu()
                          setSelectionMenu(undefined)
                          aiActionInSideChat(action, current.selection)
                        }}
                      >
                        {language.t(`session.selection.ai.${action}`)}
                      </button>
                    )}
                  </For>
                </div>
              </div>
            )}
          </Show>
          <Show when={inlineEditBusy()}>
            <div
              data-file-inline-edit-progress
              class="absolute right-3 top-3 z-50 flex items-center gap-2 rounded-lg border border-border bg-popover px-3 py-2 text-12-regular text-foreground shadow-[var(--shadow-md)]"
            >
              <span class="size-2 animate-pulse rounded-full bg-interactive-base" aria-hidden="true" />
              <span>AI 修改中…</span>
              <button
                type="button"
                class="rounded-md px-2 py-1 text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
                onClick={() => inlineEditAbort?.()}
              >
                取消
              </button>
            </div>
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
                      <Button
                        variant="ghost"
                        size="small"
                        class="w-full justify-start"
                        onClick={openContextCommentInput}
                      >
                        评论 L{menu().selection.start}
                        {menu().selection.end !== menu().selection.start ? `-L${menu().selection.end}` : ""}
                      </Button>
                      {/* 选区动作菜单（SelectionActionMenu）里那条
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
                      <div class="my-0.5 h-px bg-border" />
                      <For each={AI_ACTIONS}>
                        {(action) => (
                          <Button
                            variant="ghost"
                            size="small"
                            class="w-full justify-start"
                            onClick={() => {
                              const current = contextMenu()
                              if (!current) return
                              setContextMenu(undefined)
                              aiActionInSideChat(action, current.selection)
                            }}
                          >
                            {language.t(`session.selection.ai.${action}`)}
                          </Button>
                        )}
                      </For>
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
      <Show when={shortcutHelpOpen()}>
        <ShortcutHelp onClose={() => setShortcutHelpOpen(false)} />
      </Show>
    </>
  )
}
