import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import type { GitSnapshotResponses } from "@novaway/sdk/v2"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"

export type WorkspaceEntry = { path: string; name: string; type: "file" | "dir"; ignored?: boolean }
export type ChangeKind = "add" | "del" | "mix"

export function searchEntries(files: string[], directories: string[], ranked?: string[]): WorkspaceEntry[] {
  const entries = new Map<string, WorkspaceEntry>()
  for (const file of files) {
    const path = file.replaceAll("\\", "/")
    entries.set(path, { path, name: path.split("/").pop() ?? path, type: "file" })
  }
  for (const directory of directories) {
    const path = directory.replaceAll("\\", "/")
    entries.set(path, { path, name: path.split("/").pop() ?? path, type: "dir" })
  }
  if (!ranked) return [...entries.values()]
  const ordered: WorkspaceEntry[] = []
  for (const item of ranked) {
    const path = item.replaceAll("\\", "/")
    const entry = entries.get(path)
    if (!entry) continue
    ordered.push(entry)
    entries.delete(path)
  }
  return [...ordered, ...entries.values()]
}

export function changedSearchEntries(entries: WorkspaceEntry[], changedFiles: string[]): WorkspaceEntry[] {
  const changed = changedFiles.map((path) => path.replaceAll("\\", "/"))
  return entries.filter((entry) => {
    const path = entry.path.replaceAll("\\", "/")
    return changed.some((file) => file === path || (entry.type === "dir" && file.startsWith(`${path}/`)))
  })
}

export type WorkspaceSnapshot = GitSnapshotResponses[200]

type GitStatus = WorkspaceSnapshot["changes"][number]["status"]
export type DirectoryStatusCounts = Partial<Record<GitStatus, number>>

export function aggregateDirectoryStatuses(changes: { file: string; status: GitStatus }[]) {
  const map = new Map<string, DirectoryStatusCounts>()
  for (const change of changes) {
    const file = change.file.replaceAll("\\", "/").replace(/\/+$/, "")
    const segments = file.split("/")
    while (segments.length > 1) {
      segments.pop()
      const dir = segments.join("/")
      const counts = map.get(dir) ?? {}
      counts[change.status] = (counts[change.status] ?? 0) + 1
      map.set(dir, counts)
    }
  }
  return map
}

const STATUS_PRIORITY: Record<GitStatus, number> = {
  modified: 1,
  renamed: 2,
  unmerged: 3,
  deleted: 4,
  added: 5,
  untracked: 6,
}

const resolveGitStatus = (current: GitStatus | undefined, next: GitStatus): GitStatus =>
  current && STATUS_PRIORITY[current] >= STATUS_PRIORITY[next] ? current : next

const STATUS_LABEL: Record<GitStatus, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "U",
  unmerged: "!",
}

const colorForStatus = (status: GitStatus) => ({
  color:
    status === "added" || status === "untracked"
      ? "var(--diff-added)"
      : status === "deleted"
        ? "var(--diff-removed)"
        : "var(--git-modified)",
})

/** 轮询兜底：没有原生 watcher（网页端 / 绑定加载失败）时靠它把新文件带出来。 */
const REFRESH_INTERVAL = 5000
/** watcher 事件通常成串到达（保存一次可能 add+change），合并成一帧再刷。 */
const WATCH_DEBOUNCE_MS = 120

const norm = (value: string) => value.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase()

const mergeKind = (a: ChangeKind | undefined, b: ChangeKind): ChangeKind => (!a || a === b ? b : "mix")

/**
 * 工作区文件的两份视图（左侧「变更」列表 / 右侧文件树）共用的数据层：
 * 目录内容、git 快照、watcher 与轮询都收在这里，避免两块面板各自开一套轮询。
 */
export function createWorkspaceFiles(directory: () => string) {
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const [openDirs, setOpenDirs] = createSignal<Record<string, WorkspaceEntry[]>>({})
  const [snapshot, setSnapshot] = createSignal<WorkspaceSnapshot>()
  const [gitStatusAvailable, setGitStatusAvailable] = createSignal(false)
  const [rootLoaded, setRootLoaded] = createSignal(false)
  const [dirStates, setDirStates] = createSignal<Record<string, "loading" | "error">>({})
  /** 根目录失败：有缓存时只做非阻塞提示，不盖掉整棵树。 */
  const [rootError, setRootError] = createSignal<string>()
  const sdk = () => globalSync.sdkForDirectory(directory())

  // 切目录或同目录重复读取时，旧请求不得覆盖更新的树状态。
  let requestGen = 0
  const dirRequestGen = new Map<string, number>()

  const refresh = () => {
    if (!directory()) return
    const gen = requestGen
    void sdk()
      .git.snapshot()
      .then((r) => {
        if (gen !== requestGen) return
        setSnapshot(r.data)
        setGitStatusAvailable(true)
      })
      .catch(() => {
        // 不是 git 仓库时快照必然失败：变更清单保持为空即可。
        if (gen !== requestGen) return
        setSnapshot(undefined)
        setGitStatusAvailable(false)
      })
  }

  // 轮询每 5s 重拉一次，如果每次都生成新条目对象，`<For>` 会按引用把整列按钮
  // 拆掉重建（下拉刷新时整列闪一下）。这里按路径复用同一份条目，轮询只更新数据、
  // 不换节点。
  const entryCache = new Map<string, WorkspaceEntry>()
  const stableEntry = (type: WorkspaceEntry["type"], path: string, name: string, ignored?: boolean) => {
    const normalized = path.replaceAll("\\", "/")
    const key = `${type}:${ignored ? 1 : 0}:${normalized}`
    const cached = entryCache.get(key)
    if (cached) return cached
    const entry: WorkspaceEntry = { path: normalized, name, type, ignored: ignored === true }
    entryCache.set(key, entry)
    return entry
  }

  const entriesOf = (data: { path: string; name: string; type: string; ignored?: boolean }[] | undefined) =>
    (data ?? []).map((x) => stableEntry(x.type === "directory" ? "dir" : "file", x.path, x.name, x.ignored === true))

  /** 目录行的加载/失败态：只在首次展开且还没内容时显示，轮询刷新不闪烁。 */
  const setDirState = (dir: string, state: "loading" | "error" | undefined) =>
    setDirStates((prev) => {
      if (state === undefined) {
        if (!(dir in prev)) return prev
        const next = { ...prev }
        delete next[dir]
        return next
      }
      if (prev[dir] === state) return prev
      return { ...prev, [dir]: state }
    })

  const syncDir = (dir: string) => {
    if (!directory()) return
    const gen = requestGen
    const dirGen = (dirRequestGen.get(dir) ?? 0) + 1
    dirRequestGen.set(dir, dirGen)
    if (dir && !openDirs()[dir] && dirStates()[dir] !== "error") setDirState(dir, "loading")
    void sdk()
      .file.list({ path: dir })
      .then((r) => {
        if (gen !== requestGen || dirGen !== dirRequestGen.get(dir)) return
        setOpenDirs((prev) => ({ ...prev, [dir]: entriesOf(r.data) }))
        if (dir) setDirState(dir, undefined)
        if (dir === "") {
          setRootError(undefined)
          setRootLoaded(true)
        }
      })
      .catch((error: unknown) => {
        if (gen !== requestGen || dirGen !== dirRequestGen.get(dir)) return
        if (dir) setDirState(dir, "error")
        if (dir === "") {
          setRootError(error instanceof Error ? error.message : String(error))
          setRootLoaded(true)
        }
      })
  }

  const reloadDirs = () => {
    if (!directory()) return
    for (const dir of ["", ...Object.keys(openDirs())]) syncDir(dir)
  }

  const loadDir = (dir: string) => {
    // 已经展开过的先原样返回，避免收起/展开时闪一下空白。
    syncDir(dir)
  }

  const toggleDir = (dir: string) => {
    if (openDirs()[dir]) {
      const collapsed = [dir, ...Object.keys(openDirs()).filter((path) => path.startsWith(`${dir}/`))]
      for (const path of collapsed) {
        dirRequestGen.set(path, (dirRequestGen.get(path) ?? 0) + 1)
        setDirState(path, undefined)
      }
      setOpenDirs((prev) => {
        const next = { ...prev }
        for (const path of collapsed) delete next[path]
        return next
      })
      return
    }
    loadDir(dir)
  }

  createEffect(() => {
    // 依赖 directory()：切项目时重建订阅，事件只处理当前项目的。
    const root = directory()
    if (!root) return
    const normalized = norm(root)
    let timer: ReturnType<typeof setTimeout> | undefined

    const schedule = () => {
      if (timer) return
      timer = setTimeout(() => {
        timer = undefined
        reloadDirs()
      }, WATCH_DEBOUNCE_MS)
    }

    // 与主文件树共用同一条 watcher 事件（服务端 file.watcher.updated），
    // 任何写入/新增/删除都会立刻反映到侧栏。
    const unsub = globalSDK.event.listen((event) => {
      if (norm(event.name) !== normalized) return
      if (event.details.type !== "file.watcher.updated") return
      const data =
        typeof event.details.properties === "object" && event.details.properties
          ? (event.details.properties as Record<string, unknown>)
          : undefined
      const file = typeof data?.file === "string" ? data.file.replaceAll("\\", "/") : ""
      if (file.startsWith(".git/")) {
        // .git 内部变化只影响变更标记（索引/引用），目录内容没变。
        refresh()
        return
      }
      schedule()
    })

    onCleanup(() => {
      unsub()
      if (timer) clearTimeout(timer)
    })
  })

  const timer = setInterval(() => {
    refresh()
    reloadDirs()
  }, REFRESH_INTERVAL)
  onCleanup(() => clearInterval(timer))

  let loadedFor: string | undefined
  createEffect(() => {
    // 目录切换：作废旧请求、清空树，然后重新拉。同一个目录重复触发时直接跳过，
    // 避免挂载时拉两遍。
    const value = directory()
    if (!value || value === loadedFor) return
    loadedFor = value
    requestGen++
    dirRequestGen.clear()
    setOpenDirs({})
    setDirStates({})
    setRootError(undefined)
    setSnapshot(undefined)
    setGitStatusAvailable(false)
    refresh()
    loadDir("")
  })

  const changedFiles = createMemo(() => [
    ...new Set(snapshot()?.changes.map((change) => change.file.replaceAll("\\", "/")) ?? []),
  ])

  const statusByPath = createMemo(() => {
    const map = new Map<string, GitStatus>()
    for (const change of snapshot()?.changes ?? []) {
      const file = change.file.replaceAll("\\", "/").replace(/\/+$/, "")
      map.set(file, resolveGitStatus(map.get(file), change.status))
    }
    return map
  })

  const kinds = createMemo(() => {
    const map = new Map<string, ChangeKind>()
    for (const [file, status] of statusByPath()) {
      const kind: ChangeKind =
        status === "added" || status === "untracked" ? "add" : status === "deleted" ? "del" : "mix"
      map.set(file, mergeKind(map.get(file), kind))
      const segments = file.split("/")
      while (segments.length > 1) {
        segments.pop()
        const dir = segments.join("/")
        map.set(dir, mergeKind(map.get(dir), kind))
      }
    }
    return map
  })

  const directoryStatuses = createMemo(() => aggregateDirectoryStatuses(snapshot()?.changes ?? []))
  const directoryStatusLabel = (counts: DirectoryStatusCounts) =>
    Object.entries(counts)
      .filter((entry): entry is [GitStatus, number] => typeof entry[1] === "number" && entry[1] > 0)
      .sort(([a], [b]) => STATUS_PRIORITY[a] - STATUS_PRIORITY[b])
      .map(([status, count]) => `${STATUS_LABEL[status]} ${count}`)
      .join(", ")

  const statusColor = colorForStatus
  const statusLabel = (status: GitStatus) => STATUS_LABEL[status]
  const kindColor = (kind: ChangeKind) => ({
    color: kind === "add" ? "var(--diff-added)" : kind === "del" ? "var(--diff-removed)" : "var(--git-modified)",
  })

  const searchFiles = async (query: string) => {
    const value = query.trim()
    if (!value) return []
    try {
      const [rankedResults, fileResults, directoryResults] = await Promise.all([
        sdk().find.files({ query: value, limit: 200 }),
        sdk().find.files({ query: value, type: "file", limit: 200 }),
        sdk().find.files({ query: value, type: "directory", limit: 200 }),
      ])
      return searchEntries(fileResults.data ?? [], directoryResults.data ?? [], rankedResults.data)
    } catch {
      return undefined
    }
  }

  const changedEntries = createMemo(() =>
    changedFiles()
      .map((file) => stableEntry("file", file, file.split(/[\\/]/).pop() ?? file))
      .sort((a, b) => a.path.localeCompare(b.path)),
  )

  const mergeDeletedEntries = (dir: string, entries: WorkspaceEntry[]) => {
    const current = new Set(entries.map((entry) => entry.path.replaceAll("\\", "/").toLowerCase()))
    const deleted = [...statusByPath()]
      .filter(([path, status]) => {
        if (status !== "deleted") return false
        const normalizedPath = path.replaceAll("\\", "/")
        const separator = normalizedPath.lastIndexOf("/")
        const parent = separator < 0 ? "" : normalizedPath.slice(0, separator)
        return parent === dir && !current.has(normalizedPath.toLowerCase())
      })
      .map(([path]) => stableEntry("file", path, path.replaceAll("\\", "/").split("/").pop() ?? path))
    return [...entries, ...deleted].sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1,
    )
  }

  return {
    openDirs,
    dirStates,
    dirState: (dir: string) => dirStates()[dir],
    rootError,
    rootLoaded,
    gitStatusAvailable,
    changedFiles,
    changedEntries,
    kinds,
    kindColor,
    statusByPath,
    directoryStatuses,
    directoryStatusLabel,
    statusColor,
    statusLabel,
    mergeDeletedEntries,
    loadDir,
    toggleDir,
    reloadDirs,
    refresh,
    rootEntries: () => mergeDeletedEntries("", openDirs()[""] ?? []),
    entriesForDir: (dir: string) => mergeDeletedEntries(dir, openDirs()[dir] ?? []),
    searchFiles,
  }
}
