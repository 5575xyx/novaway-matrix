import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { Virtualizer } from "virtua/solid"
import { FileIcon } from "@novaway/ui/file-icon"
import { Icon } from "@novaway/ui/icon"
import { IconButton } from "@novaway/ui/icon-button"
import { ContextMenu } from "@novaway/ui/context-menu"
import { DropdownMenu } from "@novaway/ui/dropdown-menu"
import { showToast } from "@novaway/ui/toast"
import { writeClipboard } from "@novaway/ui/util/clipboard"
import { encodeFilePath } from "@/context/file/path"
import { WORKSPACE_FILE_DRAG_MIME, serializeWorkspaceFileDragPayload } from "@/utils/workspace-file-drag"
import { useGlobalSync } from "@/context/global-sync"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { requestPreviewOpenMode } from "@/pages/session/editor-memory"
import { isOfficePreviewPath } from "@/pages/session/office-preview-utils"
import { usePlatform, type InstalledEditor, type OfficeApp } from "@/context/platform"
import { useServer } from "@/context/server"
import { changedSearchEntries, createWorkspaceFiles, type WorkspaceEntry } from "./workspace-files-store"
import {
  findRevealRowIndex,
  workspaceDirectoryAncestors,
  workspaceTreeName,
  workspaceTreeArrowAction,
} from "./workspace-file-tree-helpers"
import { normalizePreviewUrl } from "@/utils/preview-url"
import { usePreview } from "@/context/preview"
import { isHtmlPath } from "@/utils/preview-sources"
import { useSideChat } from "@/pages/session/use-side-chat"

/** 每层 12px 缩进对应的竖直引导线（hierarchy guides）。 */
const HIERARCHY_GUIDE_BACKGROUND = "repeating-linear-gradient(to right, transparent 0 11px, var(--border) 11px 12px)"

/**
 * 右侧面板里的工作区文件树。
 *
 * 左侧「文件」视图只留最近打开 + 变更清单，整棵树搬到这里；变更筛选在左栏，
 * 树本身永远展示完整目录。数据层与左栏共用 `createWorkspaceFiles`。
 */
export function WorkspaceFileTree(props: {
  directory: string
  sessionKey: () => string
  /** 内嵌在「工作区文件」面板时提供：收起这棵树的入口。 */
  onCollapse?: () => void
}) {
  const language = useLanguage()
  const layout = useLayout()
  const globalSync = useGlobalSync()
  const platform = usePlatform()
  const server = useServer()
  const preview = usePreview()
  const sideChat = useSideChat()
  const file = useFile()
  const files = createWorkspaceFiles(() => props.directory)
  const sessionTabs = layout.tabs(props.sessionKey)
  const [query, setQuery] = createSignal("")
  const [searchResults, setSearchResults] = createSignal<WorkspaceEntry[]>([])
  const [searching, setSearching] = createSignal(false)
  const [searchFailed, setSearchFailed] = createSignal(false)
  const [changedOnly, setChangedOnly] = createSignal(false)
  const [selectedPath, setSelectedPath] = createSignal<string>()
  const [rowElements, setRowElements] = createSignal<Record<number, HTMLElement>>({})
  const [scrollOffset, setScrollOffset] = createSignal(0)
  const [refreshing, setRefreshing] = createSignal(false)
  const [installedEditors, setInstalledEditors] = createSignal<InstalledEditor[]>([])
  const [officeApps, setOfficeApps] = createSignal<OfficeApp[]>([])
  const [editorsAvailable, setEditorsAvailable] = createSignal(false)
  const editorConnection = () => server.current
  const canOpenInLocalEditor = () => platform.platform === "desktop" && server.isLocal()
  const [searchNonce, setSearchNonce] = createSignal(0)
  const [hasOverflow, setHasOverflow] = createSignal(false)
  const [atBottom, setAtBottom] = createSignal(true)
  const sdk = () => globalSync.sdkForDirectory(props.directory)
  let activeDirectory = props.directory
  let searchVersion = 0
  let scrollElement: HTMLDivElement | undefined
  let pendingFocusIndex: number | undefined
  let pendingRevealPath: string | undefined
  let lastRootError: string | undefined
  let refreshTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => {
    if (refreshTimer) clearTimeout(refreshTimer)
  })
  let virtualizer: import("virtua/solid").VirtualizerHandle | undefined

  const workspaceName = () => workspaceTreeName(props.directory, language.t("sidebar.tree.title"))

  createEffect(() => {
    if (!platform.getInstalledEditors || platform.platform !== "desktop") return
    let active = true
    void platform
      .getInstalledEditors()
      .then((editors) => {
        if (!active) return
        setInstalledEditors(editors)
        setEditorsAvailable(true)
      })
      .catch(() => {
        if (!active) return
        setInstalledEditors([])
        setEditorsAvailable(true)
      })
    onCleanup(() => {
      active = false
    })
  })

  createEffect(() => {
    if (!platform.getOfficeApps || platform.platform !== "desktop") return
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

  /** 让目标路径在树里可见：展开父链、选中、等行出现后滚动定位。 */
  const revealPath = (path: string, includeSelf = false) => {
    const target = path.replaceAll("\\", "/")
    const dirs = workspaceDirectoryAncestors(target)
    if (includeSelf) dirs.push(target)
    for (const dir of dirs) files.loadDir(dir)
    setSelectedPath(target)
    pendingRevealPath = target
  }

  createEffect(() => {
    if (activeDirectory === props.directory) return
    activeDirectory = props.directory
    searchVersion++
    setQuery("")
    setSearchResults([])
    setSearching(false)
    setSearchFailed(false)
    setChangedOnly(false)
    setSelectedPath(undefined)
    pendingRevealPath = undefined
  })

  createEffect(() => {
    if (!files.gitStatusAvailable()) setChangedOnly(false)
  })

  // 打开/切换文件时把树同步到该文件：展开父链并滚动到对应行。
  createEffect(() => {
    const active = sessionTabs.active()
    const path = active ? file.pathFromTab(active) : undefined
    if (!path || query().trim() || changedOnly()) return
    revealPath(path)
  })

  // 行集合重建后再滚动，避免目标行还没进入虚拟列表时 scrollToIndex 落空。
  createEffect(() => {
    const target = pendingRevealPath
    if (!target) return
    const index = findRevealRowIndex(visibleRows(), target)
    if (index < 0) return
    pendingRevealPath = undefined
    queueMicrotask(() => virtualizer?.scrollToIndex(index, { align: "center" }))
  })

  // 根目录已有缓存时刷新失败只提示，不把整棵树换成错误页。
  createEffect(() => {
    const error = files.rootError()
    if (!error || !files.rootLoaded() || lastRootError === error) return
    lastRootError = error
    showToast({
      variant: "error",
      title: language.t("sidebar.tree.loadFailed"),
      description: error,
    })
  })

  createEffect(() => {
    const value = query().trim()
    const version = ++searchVersion
    searchNonce()
    if (!value) {
      setSearchResults([])
      setSearching(false)
      setSearchFailed(false)
      return
    }
    setSearching(true)
    setSearchFailed(false)
    const timer = setTimeout(() => {
      void files.searchFiles(value).then((results) => {
        if (version !== searchVersion) return
        setSearchResults(results ?? [])
        setSearching(false)
        setSearchFailed(results === undefined)
      })
    }, 180)
    onCleanup(() => clearTimeout(timer))
  })

  type TreeRow = WorkspaceEntry & { children?: TreeRow[] }
  type VisibleRow = { entry: WorkspaceEntry; depth: number; compactedPaths?: string[] }
  const filteredSearchResults = createMemo(() =>
    changedOnly() ? changedSearchEntries(searchResults(), files.changedFiles()) : searchResults(),
  )
  const changedTree = createMemo<TreeRow[]>(() => {
    const rows = new Map<string, TreeRow>()
    for (const entry of files.changedEntries()) {
      const parts = entry.path.replaceAll("\\", "/").split("/").filter(Boolean)
      let parent = ""
      for (const [index, name] of parts.entries()) {
        const path = parent ? `${parent}/${name}` : name
        const isFile = index === parts.length - 1
        const existing = rows.get(path)
        rows.set(path, {
          path,
          name,
          type: isFile ? "file" : "dir",
          ...(existing?.children ? { children: existing.children } : {}),
        })
        parent = path
      }
    }
    const roots: TreeRow[] = []
    for (const row of rows.values()) {
      const parentPath = row.path.includes("/") ? row.path.slice(0, row.path.lastIndexOf("/")) : ""
      if (!parentPath) {
        roots.push(row)
        continue
      }
      const parent = rows.get(parentPath)
      if (parent) (parent.children ??= []).push(row)
    }
    const sort = (entries: TreeRow[]) => {
      entries.sort((a, b) => (a.type === b.type ? 0 : a.type === "dir" ? -1 : 1) || a.name.localeCompare(b.name))
      for (const entry of entries) if (entry.children) sort(entry.children)
    }
    sort(roots)
    return roots
  })

  const visibleRows = createMemo<VisibleRow[]>(() => {
    const rows: VisibleRow[] = []
    const appendChanged = (entries: TreeRow[], depth: number) => {
      for (const entry of entries) {
        rows.push({ entry, depth })
        if (entry.type === "dir" && entry.children && files.openDirs()[entry.path]) {
          appendChanged(entry.children, depth + 1)
        }
      }
    }
    if (query().trim()) {
      for (const entry of filteredSearchResults()) rows.push({ entry: { ...entry, name: entry.path }, depth: 0 })
      return rows
    }
    if (changedOnly()) {
      appendChanged(changedTree(), 0)
      return rows
    }
    const appendDirectory = (entries: WorkspaceEntry[], depth: number) => {
      for (const entry of entries) {
        if (entry.type !== "dir") {
          rows.push({ entry, depth })
          continue
        }
        const compacted = [entry]
        let current = entry
        while (files.openDirs()[current.path]) {
          const children = files.entriesForDir(current.path)
          if (children.length !== 1 || children[0].type !== "dir" || children[0].ignored) break
          current = children[0]
          compacted.push(current)
        }
        const compactedPaths = compacted.length > 1 ? compacted.map((item) => item.path) : undefined
        const shown =
          compacted.length > 1
            ? { ...current, path: entry.path, name: compacted.map((item) => item.name).join("/") }
            : entry
        rows.push({ entry: shown, depth, ...(compactedPaths ? { compactedPaths } : {}) })
        if (files.openDirs()[current.path]) appendDirectory(files.entriesForDir(current.path), depth + 1)
      }
    }
    appendDirectory(files.rootEntries(), 0)
    return rows
  })

  const stickyRows = createMemo(() => {
    if (query().trim() || scrollOffset() <= 0.5 || visibleRows().length === 0) return [] as number[]
    const rows = visibleRows()
    let sticky: number[] = []
    for (let iteration = 0; iteration <= rows.length; iteration++) {
      const probe = Math.min(rows.length - 1, Math.floor((scrollOffset() + sticky.length * 28) / 28))
      const row = rows[probe]
      if (!row) return []
      const isExpanded = (candidate: VisibleRow) =>
        candidate.entry.type === "dir" &&
        (candidate.compactedPaths ?? [candidate.entry.path]).some((path) => !!files.openDirs()[path])
      const rowExpanded = isExpanded(row)
      let depth = rowExpanded ? row.depth : row.depth - 1
      const ancestors: number[] = []
      for (let index = rowExpanded ? probe : probe - 1; index >= 0 && depth >= 0; index--) {
        const candidate = rows[index]
        if (candidate && isExpanded(candidate) && candidate.depth === depth) {
          ancestors.unshift(index)
          depth--
        }
      }
      const next = ancestors.filter((index, stickyIndex) => index * 28 <= scrollOffset() + stickyIndex * 28 + 0.5)
      if (next.length === sticky.length) return next
      sticky = next
    }
    return sticky
  })

  const openFile = (entry: WorkspaceEntry) => {
    setSelectedPath(entry.path)
    requestPreviewOpenMode(props.directory, entry.path, "file")
    void layout.tabs(props.sessionKey()).open(`file://${encodeFilePath(entry.path)}`)
    layout.sidePane.add(isOfficePreviewPath(entry.path) ? "office" : "preview")
  }

  /**
   * 目录行在两种视图里的语义不同：
   * 搜索结果是平铺的，点目录要退回树态并展开到它；树里才是普通折叠/展开。
   */
  const openDirectory = (entry: WorkspaceEntry) => {
    if (query().trim()) {
      setQuery("")
      revealPath(entry.path, true)
      return
    }
    files.toggleDir(entry.path)
  }

  const openInBrowser = (entry: WorkspaceEntry) => {
    if (entry.type !== "file" || !isHtmlPath(entry.path)) return
    const url = normalizePreviewUrl(absolutePath(entry))
    if (!url || !preview.setUrl(url)) return
    layout.sidePane.add("browser")
  }

  const addToSideChat = (entry: WorkspaceEntry) => {
    void sideChat.open({
      draft: `@${entry.path} `,
      quote: { text: entry.path, label: entry.name, path: entry.path },
    })
  }

  /**
   * 右键菜单：每一层（文件 / 目录）都能在系统资源管理器里定位、复制路径。
   *
   * 绝对路径要自己拼：文件树里的 `entry.path` 是工作区相对路径，
   * 而「在资源管理器中显示」必须给原生壳一个绝对路径（相对路径会被解析到进程 cwd）。
   */
  const absolutePath = (entry: WorkspaceEntry) => {
    const separator = props.directory.includes("\\") ? "\\" : "/"
    return `${props.directory.replace(/\/+$/, "")}${separator}${entry.path}`
  }

  const revealInExplorer = (entry: WorkspaceEntry) => {
    const absolute = absolutePath(entry)
    if (platform.showItemInFolder) {
      void platform.showItemInFolder(absolute).catch(() => {})
      return
    }
    if (platform.openPath) {
      void platform.openPath(absolute).catch(() => {})
      return
    }
    // 网页端兜底：服务端 pty 拉起 explorer（Windows）/ open（macOS 由 openPath 覆盖）
    void sdk()
      .pty.create({ command: "explorer", args: [absolute], title: "reveal" })
      .catch(() => {})
  }

  const openInTerminal = (entry: WorkspaceEntry) => {
    void sdk()
      .pty.create({ cwd: absolutePath(entry) })
      .catch(() => {})
  }

  /** 用选中的本机编辑器 / Office 应用打开（主进程负责解析安装路径）。 */
  const openWithApp = (entry: WorkspaceEntry, appId: string) => {
    const connection = editorConnection()
    if (!platform.openInEditor || !server.isLocal() || !connection) return
    void platform
      .openInEditor(appId, absolutePath(entry), entry.type === "dir" ? "directory" : "file", connection)
      .then((opened) => {
        if (!opened) showToast({ variant: "error", title: language.t("session.filePreview.openFailed") })
      })
  }

  const openDefaultApp = (entry: WorkspaceEntry) => {
    if (!platform.openPath) return
    void platform.openPath(absolutePath(entry)).catch(() => {
      showToast({ variant: "error", title: language.t("session.filePreview.openFailed") })
    })
  }

  /** 在文件所在目录打开系统终端（Windows Terminal / macOS Terminal），失败回落集成终端。 */
  const openParentInTerminal = (entry: WorkspaceEntry) => {
    const directory =
      entry.type === "dir"
        ? absolutePath(entry)
        : absolutePath(entry).replace(/[\\/][^\\/]*$/, "") || absolutePath(entry)
    const integrated = () =>
      sdk()
        .pty.create({ cwd: directory })
        .catch(() => {})
    const native =
      !canOpenInLocalEditor() || !platform.os
        ? undefined
        : platform.os === "windows"
          ? { command: "wt", args: ["-d", directory] }
          : platform.os === "macos"
            ? { command: "open", args: ["-a", "Terminal", directory] }
            : undefined
    if (!native) {
      void integrated()
      return
    }
    void sdk()
      .pty.create({ command: native.command, args: native.args, title: "terminal" })
      .catch(() => integrated())
  }

  /** 右键「选择打开应用」的候选：Office 文档给 Office 应用，其余给代码编辑器。 */
  const openWithAppsFor = (entry: WorkspaceEntry): (InstalledEditor | OfficeApp)[] => {
    if (entry.type !== "file" || !isOfficePreviewPath(entry.path)) return installedEditors()
    const extension = entry.path.split(".").pop()?.toLowerCase() ?? ""
    return officeApps().filter((app) => app.extensions.includes(extension))
  }

  /** 工作区级定位：对根目录做和行「在资源管理器中显示」同样的降级链。 */
  const revealWorkspace = () => {
    const target = props.directory
    if (platform.showItemInFolder) {
      void platform.showItemInFolder(target).catch(() => {})
      return
    }
    if (platform.openPath) {
      void platform.openPath(target).catch(() => {})
      return
    }
    void sdk()
      .pty.create({ command: "explorer", args: [target], title: "reveal" })
      .catch(() => {})
  }

  const refreshAll = () => {
    setRefreshing(true)
    files.refresh()
    files.reloadDirs()
    if (query().trim()) setSearchNonce((value) => value + 1)
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => setRefreshing(false), 600)
  }

  const copyText = (value: string) => {
    // 桌面端走主进程剪贴板（见 @novaway/ui/util/clipboard 的注释）：
    // WebView 里 navigator.clipboard 常常静默失败，右键「复制路径」就像没反应。
    void writeClipboard(value).then((copied) => {
      showToast(
        copied
          ? { variant: "success", icon: "circle-check", title: language.t("common.copied") }
          : { variant: "error", title: language.t("toast.copyFailed.title"), description: value },
      )
    })
  }

  const EntryRow = (p: {
    entry: WorkspaceEntry
    depth: number
    index: number
    compactedPaths?: string[]
    sticky?: boolean
  }) => {
    const path = () => p.entry.path.replaceAll("\\", "/")
    const status = () => files.statusByPath().get(path())
    const directoryStatuses = () => files.directoryStatuses().get(path())
    const directoryDisplayStatus = () =>
      directoryStatuses()
        ? (["modified", "renamed", "unmerged", "deleted", "added", "untracked"] as const).find(
            (candidate) => (directoryStatuses()?.[candidate] ?? 0) > 0,
          )
        : undefined
    const displayStatus = () => status() ?? directoryDisplayStatus()
    const statusDescription = () =>
      p.entry.type === "dir" && directoryStatuses()
        ? files.directoryStatusLabel(directoryStatuses()!)
        : displayStatus()
          ? files.statusLabel(displayStatus()!)
          : ""
    const directoryStatusColor = () => {
      const display = directoryDisplayStatus()
      return display ? files.statusColor(display) : undefined
    }
    const isOpen = () => (p.compactedPaths ?? [p.entry.path]).some((path) => !!files.openDirs()[path])
    const isDeleted = () => p.entry.type === "file" && status() === "deleted"
    const expandedPath = () => p.compactedPaths?.at(-1) ?? p.entry.path
    const rowState = () => (p.entry.type === "dir" ? files.dirState(expandedPath()) : undefined)
    const displayName = () =>
      p.compactedPaths ? p.compactedPaths.map((path) => path.split("/").pop()).join("/") : p.entry.name
    return (
      <ContextMenu>
        <ContextMenu.Trigger>
          <button
            type="button"
            draggable={!isDeleted()}
            onDragStart={(event) => {
              if (isDeleted()) {
                event.preventDefault()
                return
              }
              if (!event.dataTransfer) return
              event.dataTransfer.effectAllowed = "copy"
              event.dataTransfer.setData(
                WORKSPACE_FILE_DRAG_MIME,
                serializeWorkspaceFileDragPayload({
                  type: p.entry.type === "dir" ? "directory" : "file",
                  path: p.entry.path,
                  name: p.entry.name,
                }),
              )
              // 目录没有可打开成标签的原生载体：只带自定义 MIME，由输入区消费成 @ 引用。
              if (p.entry.type === "dir") return
              event.dataTransfer.setData("text/plain", `file:${p.entry.path}`)
              event.dataTransfer.setData("text/uri-list", `file://${encodeFilePath(absolutePath(p.entry))}`)
            }}
            onFocus={() => {
              if (!p.sticky) setSelectedPath(p.entry.path)
            }}
            onContextMenu={() => {
              if (!p.sticky) setSelectedPath(p.entry.path)
            }}
            disabled={isDeleted()}
            class="relative flex h-7 w-full items-center gap-1.5 rounded-md border border-transparent py-1 pr-2 text-left text-ui-caption text-foreground outline-none transition-colors hover:bg-hover focus-visible:border-border-hover"
            classList={{
              // 选中是描边而不是整行填充，扫一眼目录时不会一片色块。
              "border-border-hover": selectedPath() === p.entry.path,
              "cursor-not-allowed opacity-50": isDeleted(),
            }}
            ref={(element) => {
              if (!p.sticky) {
                setRowElements((current) => ({ ...current, [p.index]: element }))
                if (pendingFocusIndex === p.index) {
                  pendingFocusIndex = undefined
                  queueMicrotask(() => element.focus())
                }
              }
            }}
            style={{ "padding-left": `${8 + p.depth * 12}px` }}
            role="treeitem"
            aria-selected={selectedPath() === p.entry.path}
            tabIndex={p.sticky ? -1 : selectedPath() === p.entry.path || (!selectedPath() && p.index === 0) ? 0 : -1}
            aria-expanded={p.entry.type === "dir" ? isOpen() : undefined}
            aria-level={p.depth + 1}
            aria-label={`${p.entry.name}${displayStatus() ? `, ${files.statusLabel(displayStatus()!)}` : ""}`}
            title={p.compactedPaths?.join("/") ?? p.entry.path}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
                event.preventDefault()
                const rows = visibleRows()
                const nextIndex =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? rows.length - 1
                      : Math.max(0, Math.min(rows.length - 1, p.index + (event.key === "ArrowDown" ? 1 : -1)))
                const nextRow = rows[nextIndex]
                if (nextRow) {
                  setSelectedPath(nextRow.entry.path)
                  pendingFocusIndex = nextIndex
                  virtualizer?.scrollToIndex(nextIndex, { align: "nearest" })
                  rowElements()[nextIndex]?.focus()
                }
                return
              }
              if (query().trim() && event.key === "Enter") {
                event.preventDefault()
                if (p.entry.type === "dir") openDirectory(p.entry)
                else openFile(p.entry)
                return
              }
              if (event.key === "Enter") {
                event.preventDefault()
                if (p.entry.type === "dir") {
                  const collapsed = p.compactedPaths?.[0] ?? p.entry.path
                  const expanded = p.compactedPaths?.at(-1) ?? p.entry.path
                  files.toggleDir(files.openDirs()[collapsed] ? collapsed : expanded)
                } else openFile(p.entry)
                return
              }
              if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                const action = workspaceTreeArrowAction({
                  key: event.key,
                  isDirectory: p.entry.type === "dir",
                  expanded: isOpen(),
                })
                if (action === "none") return
                event.preventDefault()
                if (query().trim()) {
                  if (event.key === "ArrowRight" && p.entry.type === "dir") openDirectory(p.entry)
                  return
                }
                if (action === "expand") {
                  files.toggleDir(p.compactedPaths?.at(-1) ?? p.entry.path)
                  return
                }
                if (action === "collapse") {
                  files.toggleDir(p.compactedPaths?.[0] ?? p.entry.path)
                  return
                }
                const rows = visibleRows()
                let targetIndex = -1
                if (action === "focus-child") {
                  const child = rows[p.index + 1]
                  if (child && child.depth > p.depth) targetIndex = p.index + 1
                } else {
                  for (let index = p.index - 1; index >= 0; index--) {
                    const candidate = rows[index]
                    if (!candidate || candidate.depth >= p.depth) continue
                    if (candidate.depth === p.depth - 1 && candidate.entry.type === "dir") {
                      targetIndex = index
                      break
                    }
                  }
                }
                if (targetIndex >= 0 && targetIndex < visibleRows().length) {
                  const target = visibleRows()[targetIndex]
                  if (target) {
                    setSelectedPath(target.entry.path)
                    pendingFocusIndex = targetIndex
                    virtualizer?.scrollToIndex(targetIndex, { align: "nearest" })
                    rowElements()[targetIndex]?.focus()
                  }
                }
              }
            }}
            onClick={(event) => {
              setSelectedPath(p.entry.path)
              // 双击的第二次点击不再折叠/展开，否则双击目录会原地抖动一次。
              if (event.detail > 1) return
              if (p.entry.type === "dir") {
                if (query().trim()) {
                  openDirectory(p.entry)
                  return
                }
                const collapsed = p.compactedPaths?.[0] ?? p.entry.path
                const expanded = p.compactedPaths?.at(-1) ?? p.entry.path
                files.toggleDir(files.openDirs()[collapsed] ? collapsed : expanded)
              } else openFile(p.entry)
            }}
          >
            <Show when={p.depth > 0 && !isDeleted()}>
              <span
                aria-hidden="true"
                data-workspace-file-tree-hierarchy-guides={p.depth}
                class="pointer-events-none absolute inset-y-0 left-2"
                style={{ width: `${p.depth * 12}px`, "background-image": HIERARCHY_GUIDE_BACKGROUND }}
              />
            </Show>
            <Show when={p.entry.type === "dir"}>
              <Icon
                name={isOpen() ? "chevron-down" : "chevron-right"}
                size="small"
                class="shrink-0 text-foreground-subtlest"
              />
            </Show>
            <Show when={p.entry.type === "file"}>
              <span class="size-4 shrink-0" />
            </Show>
            <FileIcon
              node={{ path: p.entry.path, type: p.entry.type === "dir" ? "directory" : "file" }}
              expanded={isOpen()}
              class="size-4 shrink-0 text-foreground-subtlest"
            />
            <span
              classList={{
                "flex-1 truncate text-left": true,
                "text-foreground-subtlest": p.entry.ignored,
              }}
            >
              <Show when={displayName().includes("/")} fallback={displayName()}>
                <For each={displayName().split("/")}>
                  {(segment, index) => (
                    <>
                      <Show when={index() > 0}>
                        <span class="mx-0.5 text-foreground-subtlest">/</span>
                      </Show>
                      <span>{segment}</span>
                    </>
                  )}
                </For>
              </Show>
            </span>
            <Show when={displayStatus() && !p.entry.ignored && rowState() !== "loading"}>
              {/* 目录给聚合状态点，文件才显示具体字母；两者共用同一个 tooltip。 */}
              <Show
                when={p.entry.type === "dir"}
                fallback={
                  <span
                    class="shrink-0 text-ui-xs font-semibold"
                    style={files.statusColor(displayStatus()!)}
                    title={statusDescription()}
                    aria-label={statusDescription()}
                  >
                    {files.statusLabel(displayStatus()!)}
                  </span>
                }
              >
                <span
                  class="size-1.5 shrink-0 rounded-full"
                  style={{ "background-color": directoryStatusColor()?.color }}
                  title={statusDescription()}
                  aria-label={statusDescription()}
                />
              </Show>
            </Show>
            <Show when={rowState() === "loading"}>
              <Icon
                name="lu-loader"
                size="small"
                class="shrink-0 animate-spin text-foreground-subtlest"
                aria-label={language.t("sidebar.tree.loading")}
              />
            </Show>
            <Show when={rowState() === "error"}>
              <Icon
                name="circle-x"
                size="small"
                class="shrink-0 text-icon-warning-base"
                aria-label={language.t("sidebar.tree.loadFailed")}
              />
            </Show>
          </button>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content class="min-w-[190px] p-1 bg-surface border border-border rounded-lg shadow-lg z-50">
            <ContextMenu.Item
              class="flex items-center gap-2 px-2 py-1.5 text-12-medium text-foreground rounded-md hover:bg-hover cursor-pointer outline-none"
              disabled={isDeleted()}
              onSelect={() => {
                if (p.entry.type === "dir") openDirectory(p.entry)
                else openFile(p.entry)
              }}
            >
              <Icon name="open-file" size="small" />
              {language.t("common.open")}
            </ContextMenu.Item>
            <Show when={!isDeleted() && canOpenInLocalEditor() && editorsAvailable()}>
              <ContextMenu.Sub>
                <ContextMenu.SubTrigger class="flex items-center gap-2 px-2 py-1.5 text-12-medium text-foreground rounded-md hover:bg-hover cursor-pointer outline-none">
                  <Icon name="open-file" size="small" />
                  {language.t("session.filePreview.openWith")}
                </ContextMenu.SubTrigger>
                <ContextMenu.Portal>
                  <ContextMenu.SubContent class="min-w-[210px] p-1 bg-surface border border-border rounded-lg shadow-lg z-50">
                    <For each={openWithAppsFor(p.entry)}>
                      {(app) => (
                        <ContextMenu.Item
                          class="flex items-center gap-2 px-2 py-1.5 text-12-medium text-foreground rounded-md hover:bg-hover cursor-pointer outline-none"
                          onSelect={() => openWithApp(p.entry, app.id)}
                        >
                          <Show when={app.icon} fallback={<Icon name="open-file" size="small" />}>
                            <img src={app.icon} alt="" class="size-4 shrink-0 object-contain" draggable={false} />
                          </Show>
                          {app.name}
                        </ContextMenu.Item>
                      )}
                    </For>
                    <Show when={p.entry.type === "file" && !!platform.openPath}>
                      <ContextMenu.Item
                        class="flex items-center gap-2 px-2 py-1.5 text-12-medium text-foreground rounded-md hover:bg-hover cursor-pointer outline-none"
                        onSelect={() => openDefaultApp(p.entry)}
                      >
                        <Icon name="lu-arrow-up-right" size="small" />
                        {language.t("session.filePreview.openDefaultApp")}
                      </ContextMenu.Item>
                    </Show>
                    <Show when={p.entry.type === "file"}>
                      <ContextMenu.Separator class="h-px bg-border my-1" />
                      <ContextMenu.Item
                        class="flex items-center gap-2 px-2 py-1.5 text-12-medium text-foreground rounded-md hover:bg-hover cursor-pointer outline-none"
                        onSelect={() => openParentInTerminal(p.entry)}
                      >
                        <Icon name="terminal" size="small" />
                        {language.t(
                          platform.os === "windows"
                            ? "session.filePreview.openDirInTerminal.windows"
                            : "session.filePreview.openDirInTerminal.other",
                        )}
                      </ContextMenu.Item>
                    </Show>
                  </ContextMenu.SubContent>
                </ContextMenu.Portal>
              </ContextMenu.Sub>
            </Show>
            <Show when={p.entry.type === "file" && isHtmlPath(p.entry.path) && !isDeleted()}>
              <ContextMenu.Item
                class="flex items-center gap-2 px-2 py-1.5 text-12-medium text-foreground rounded-md hover:bg-hover cursor-pointer outline-none"
                onSelect={() => openInBrowser(p.entry)}
              >
                <Icon name="open-file" size="small" />
                {language.t("session.filePreview.previewInBrowser")}
              </ContextMenu.Item>
            </Show>
            <ContextMenu.Separator class="h-px bg-border my-1" />
            <ContextMenu.Item
              class="flex items-center gap-2 px-2 py-1.5 text-12-medium text-foreground rounded-md hover:bg-hover cursor-pointer outline-none"
              onSelect={() => revealInExplorer(p.entry)}
            >
              <Icon name="folder" size="small" />
              {language.t("session.filePreview.revealInExplorer")}
            </ContextMenu.Item>
            <Show when={p.entry.type === "dir"}>
              <ContextMenu.Item
                class="flex items-center gap-2 px-2 py-1.5 text-12-medium text-foreground rounded-md hover:bg-hover cursor-pointer outline-none"
                onSelect={() => openInTerminal(p.entry)}
              >
                <Icon name="terminal" size="small" />
                {language.t("sidebar.tree.openTerminal")}
              </ContextMenu.Item>
            </Show>
            <ContextMenu.Item
              class="flex items-center gap-2 px-2 py-1.5 text-12-medium text-foreground rounded-md hover:bg-hover cursor-pointer outline-none"
              onSelect={() => copyText(absolutePath(p.entry))}
            >
              <Icon name="copy" size="small" />
              {language.t("session.filePreview.copyAbsolutePath")}
            </ContextMenu.Item>
            <ContextMenu.Item
              class="flex items-center gap-2 px-2 py-1.5 text-12-medium text-foreground rounded-md hover:bg-hover cursor-pointer outline-none"
              onSelect={() => copyText(p.entry.path)}
            >
              <Icon name="copy" size="small" />
              {language.t("session.filePreview.copyRelativePath")}
            </ContextMenu.Item>
            <Show when={!isDeleted()}>
              <ContextMenu.Separator class="h-px bg-border my-1" />
              <ContextMenu.Item
                class="flex items-center gap-2 px-2 py-1.5 text-12-medium text-foreground rounded-md hover:bg-hover cursor-pointer outline-none"
                onSelect={() => addToSideChat(p.entry)}
              >
                <Icon name="speech-bubble" size="small" />
                {language.t("session.selection.addToTask")}
              </ContextMenu.Item>
            </Show>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu>
    )
  }

  /** 空态/加载/失败统一成同一块居中提示。 */
  const notice = () => {
    if (searching()) {
      return {
        icon: "lu-loader" as const,
        spin: true,
        title: language.t("sidebar.tree.loading"),
        description: undefined,
      }
    }
    if (query().trim()) {
      if (searchFailed()) {
        return {
          icon: "circle-x" as const,
          spin: false,
          title: language.t("sidebar.tree.searchFailed"),
          description: undefined,
        }
      }
      return {
        icon: "magnifying-glass" as const,
        spin: false,
        title: language.t("sidebar.tree.noSearchResults"),
        description: undefined,
      }
    }
    if (!props.directory) {
      return {
        icon: "tree-structure" as const,
        spin: false,
        title: language.t("sidebar.tree.empty"),
        description: undefined,
      }
    }
    if (!files.rootLoaded()) {
      return {
        icon: "lu-loader" as const,
        spin: true,
        title: language.t("sidebar.tree.loading"),
        description: undefined,
      }
    }
    if (files.rootError()) {
      return {
        icon: "circle-x" as const,
        spin: false,
        title: language.t("sidebar.tree.loadFailed"),
        description: files.rootError(),
      }
    }
    if (changedOnly()) {
      return {
        icon: "branch" as const,
        spin: false,
        title: language.t("sidebar.tree.noChanges"),
        description: undefined,
      }
    }
    return {
      icon: "tree-structure" as const,
      spin: false,
      title: language.t("sidebar.tree.emptyDir"),
      description: undefined,
    }
  }

  return (
    <div class="flex size-full min-h-0 flex-col">
      <div class="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2">
        <span class="min-w-0 flex-1 truncate text-ui-caption font-medium text-foreground" title={props.directory}>
          {workspaceName()}
        </span>
        <DropdownMenu gutter={4} placement="bottom-end">
          <DropdownMenu.Trigger
            as={IconButton}
            icon="dot-grid"
            variant="ghost"
            size="small"
            aria-label={language.t("common.moreOptions")}
            title={language.t("common.moreOptions")}
          />
          <DropdownMenu.Portal>
            <DropdownMenu.Content class="min-w-[200px]">
              <DropdownMenu.Item onSelect={revealWorkspace}>
                <DropdownMenu.ItemLabel>{language.t("session.filePreview.revealInExplorer")}</DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => copyText(props.directory)}>
                <DropdownMenu.ItemLabel>{language.t("session.filePreview.copyAbsolutePath")}</DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu>
        <button
          type="button"
          class={[
            "flex size-6 shrink-0 items-center justify-center rounded-md transition-colors",
            changedOnly()
              ? "bg-hover text-foreground"
              : "text-foreground-subtlest hover:bg-hover hover:text-foreground",
          ].join(" ")}
          aria-pressed={changedOnly()}
          aria-label={language.t(changedOnly() ? "sidebar.tree.showAll" : "sidebar.tree.changedOnly")}
          title={language.t(changedOnly() ? "sidebar.tree.showAll" : "sidebar.tree.changedOnly")}
          disabled={!files.gitStatusAvailable() || files.kinds().size === 0}
          classList={{ "opacity-40 cursor-not-allowed": !files.gitStatusAvailable() || files.kinds().size === 0 }}
          onClick={() => setChangedOnly(!changedOnly())}
        >
          <Icon name="branch" size="small" />
        </button>
        <button
          type="button"
          class="flex size-6 shrink-0 items-center justify-center rounded-md text-foreground-subtlest transition-colors hover:bg-hover hover:text-foreground"
          aria-label={language.t("sidebar.tree.search")}
          title={language.t("sidebar.tree.search")}
          onClick={() => document.querySelector<HTMLInputElement>("[data-action='workspace-file-search']")?.focus()}
        >
          <Icon name="magnifying-glass" size="small" />
        </button>
        {/* 手动刷新：watcher 不可用（网页端绑定缺失）时也能立刻看到磁盘上的变化。 */}
        <button
          type="button"
          disabled={refreshing()}
          class="flex size-6 shrink-0 items-center justify-center rounded-md text-foreground-subtlest transition-colors hover:bg-hover hover:text-foreground disabled:opacity-50"
          aria-label={language.t("git.refresh")}
          title={language.t("git.refresh")}
          onClick={refreshAll}
        >
          <Icon name="refresh" size="small" class={refreshing() ? "animate-spin" : undefined} />
        </button>
        <Show when={props.onCollapse}>
          <IconButton
            icon="chevron-left"
            size="small"
            variant="ghost"
            data-action="side-pane-file-tree-close"
            title={language.t("sidePane.tree.hide")}
            aria-label={language.t("sidePane.tree.hide")}
            onClick={() => props.onCollapse?.()}
          />
        </Show>
      </div>
      <div class="shrink-0 border-b border-border px-2 py-1.5">
        <div class="flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2">
          <Icon name="magnifying-glass" size="small" class="shrink-0 text-foreground-subtlest" />
          <input
            data-action="workspace-file-search"
            type="search"
            value={query()}
            placeholder={language.t("sidebar.tree.searchPlaceholder")}
            aria-label={language.t("sidebar.tree.search")}
            class="min-w-0 flex-1 bg-transparent text-ui-xs text-foreground outline-none placeholder:text-foreground-subtlest"
            onInput={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setQuery("")
                event.currentTarget.blur()
              }
              if (event.key === "Enter" && filteredSearchResults()[0]) {
                const first = filteredSearchResults()[0]
                if (first.type === "dir") openDirectory(first)
                else openFile(first)
              }
            }}
          />
          <Show when={query()}>
            <button type="button" aria-label={language.t("sidebar.tree.clearSearch")} onClick={() => setQuery("")}>
              <Icon name="close-small" size="small" class="text-foreground-subtlest" />
            </button>
          </Show>
        </div>
      </div>
      <div
        class="min-h-0 flex-1 overflow-y-auto no-scrollbar py-1"
        role="tree"
        aria-label={workspaceName()}
        ref={scrollElement}
        style={
          hasOverflow() && !atBottom()
            ? { "mask-image": "linear-gradient(to bottom, black calc(100% - 24px), transparent)" }
            : undefined
        }
        onScroll={(event) => {
          const element = event.currentTarget
          setScrollOffset(element.scrollTop)
          setHasOverflow(element.scrollHeight > element.clientHeight + 1)
          setAtBottom(element.scrollTop + element.clientHeight >= element.scrollHeight - 1)
        }}
      >
        <Show
          when={visibleRows().length > 0}
          fallback={
            <div class="flex min-h-32 flex-col items-center justify-center gap-2 px-4 text-center text-ui-xs text-foreground-subtle">
              <Icon
                name={notice().icon}
                size="small"
                class="text-foreground-subtlest"
                classList={{ "animate-spin": notice().spin }}
              />
              <div class="font-medium">{notice().title}</div>
              <Show when={notice().description}>
                <div class="max-w-full break-words text-foreground-subtlest">{notice().description}</div>
              </Show>
            </div>
          }
        >
          <Virtualizer
            data={visibleRows()}
            bufferSize={420}
            scrollRef={scrollElement!}
            ref={(handle) => (virtualizer = handle)}
            onScroll={(offset) => setScrollOffset(offset)}
          >
            {(row, index) => (
              <EntryRow entry={row.entry} depth={row.depth} index={index()} compactedPaths={row.compactedPaths} />
            )}
          </Virtualizer>
        </Show>
        <Show when={stickyRows().length > 0}>
          <div class="pointer-events-none sticky top-0 z-10 h-0 overflow-visible px-1">
            <div class="pointer-events-auto overflow-hidden rounded-lg border border-border bg-background shadow-sm">
              <For each={stickyRows()}>
                {(index) => {
                  const row = visibleRows()[index]
                  return row ? (
                    <EntryRow entry={row.entry} depth={row.depth} index={index} compactedPaths={row.compactedPaths} />
                  ) : null
                }}
              </For>
            </div>
          </div>
        </Show>
      </div>
    </div>
  )
}
