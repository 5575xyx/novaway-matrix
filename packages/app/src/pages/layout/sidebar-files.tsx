import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { FileIcon } from "@novaway/ui/file-icon"
import { Icon } from "@novaway/ui/icon"
import { ContextMenu } from "@novaway/ui/context-menu"
import { Switch } from "@novaway/ui/switch"
import { showToast } from "@novaway/ui/toast"
import { writeClipboard } from "@novaway/ui/util/clipboard"
import type { GitSnapshotResponses } from "@novaway/sdk/v2"
import { encodeFilePath } from "@/context/file/path"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"

type Entry = { path: string; name: string; type: "file" | "dir" }
type Kind = "add" | "del" | "mix"
type Snapshot = GitSnapshotResponses[200]

/** 轮询兜底：没有原生 watcher（网页端 / 绑定加载失败）时靠它把新文件带出来。 */
const REFRESH_INTERVAL = 5000
/** watcher 事件通常成串到达（保存一次可能 add+change），合并成一帧再刷。 */
const WATCH_DEBOUNCE_MS = 120

const norm = (value: string) => value.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase()

const mergeKind = (a: Kind | undefined, b: Kind): Kind => (!a || a === b ? b : "mix")

// 纯逻辑（「仅变更」过滤）在 sidebar-files-model.ts：组件本身 import 了 Kobalte 的
// Switch / Toast，模块作用域会触碰客户端 API，单测只能解析到 SSR 构建。
// 这里再导出，保持既有 import 路径可用。
import { isVisibleEntry } from "./sidebar-files-model"
export { isVisibleEntry }

export function SidebarFiles(props: { directory: string; sessionKey: () => string }) {
  const language = useLanguage()
  const layout = useLayout()
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const platform = usePlatform()
  const [openDirs, setOpenDirs] = createSignal<Record<string, Entry[]>>({})
  // 默认显示全部文件：以前默认开「仅变更」，仓库还没初始化 / 快照还没回来时
  // 整棵树是空的，用户会以为文件没写进去。
  const [onlyChanged, setOnlyChanged] = createSignal(false)
  const [snapshot, setSnapshot] = createSignal<Snapshot>()
  const [rootLoaded, setRootLoaded] = createSignal(false)
  const [gitReady, setGitReady] = createSignal(true)
  const sdk = () => globalSync.sdkForDirectory(props.directory)

  // 切目录时把在途请求作废：旧目录的返回不能盖到新目录的树上。
  let requestGen = 0

  const refresh = () => {
    if (!props.directory) return
    const gen = requestGen
    void sdk()
      .git.snapshot()
      .then((r) => {
        if (gen !== requestGen) return
        setGitReady(true)
        setSnapshot(r.data)
      })
      .catch(() => {
        // 不是 git 仓库时快照必然失败：此时"仅变更"没有意义，退回显示全部。
        if (gen !== requestGen) return
        setGitReady(false)
      })
  }

  const entriesOf = (data: { path: string; name: string; type: string }[] | undefined) =>
    (data ?? []).map((x) => ({
      path: x.path.replaceAll("\\", "/"),
      name: x.name,
      type: x.type === "directory" ? ("dir" as const) : ("file" as const),
    }))

  const syncDir = (dir: string) => {
    if (!props.directory) return
    const gen = requestGen
    void sdk()
      .file.list({ path: dir })
      .then((r) => {
        if (gen !== requestGen) return
        setOpenDirs((prev) => ({ ...prev, [dir]: entriesOf(r.data) }))
        if (dir === "") setRootLoaded(true)
      })
      .catch(() => {
        if (gen !== requestGen) return
        if (dir === "") setRootLoaded(true)
      })
  }

  /**
   * 重新拉取根目录 + 所有已展开的目录。
   *
   * 之前只有「点开/收起」时才 `loadDir`，写入的新文件不会进树 —— 用户得切到别的
   * 目录再切回来才看得到（那一下正好触发了重新读取）。现在由 watcher 事件驱动，
   * 5 秒轮询兜底（网页端没有原生 watcher）。
   */
  const reloadDirs = () => {
    if (!props.directory) return
    for (const dir of ["", ...Object.keys(openDirs())]) syncDir(dir)
  }

  const loadDir = (dir: string) => {
    // 已经展开过的先原样返回，避免收起/展开时闪一下空白。
    syncDir(dir)
  }

  createEffect(() => {
    // 依赖 props.directory：切项目时重建订阅，事件只处理当前项目的。
    const directory = props.directory
    if (!directory) return
    const root = norm(directory)
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
      if (norm(event.name) !== root) return
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
    const directory = props.directory
    if (!directory || directory === loadedFor) return
    loadedFor = directory
    requestGen++
    setOpenDirs({})
    setSnapshot(undefined)
    refresh()
    loadDir("")
  })

  const changedFiles = createMemo(() => [...new Set(snapshot()?.changes.map((change) => change.file) ?? [])])

  const kinds = createMemo(() => {
    const map = new Map<string, Kind>()
    for (const change of snapshot()?.changes ?? []) {
      const kind: Kind =
        change.status === "added" || change.status === "untracked" ? "add" : change.status === "deleted" ? "del" : "mix"
      const file = change.file.replaceAll("\\", "/")
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

  const kindColor = (kind: Kind) => ({
    color: kind === "add" ? "var(--diff-added)" : kind === "del" ? "var(--diff-removed)" : "var(--git-modified)",
  })

  const toggleDir = (dir: string) => {
    if (openDirs()[dir]) {
      setOpenDirs((prev) => {
        const next = { ...prev }
        delete next[dir]
        return next
      })
      return
    }
    loadDir(dir)
  }

  const openFile = (entry: Entry) => {
    void layout.tabs(props.sessionKey()).open(`file://${encodeFilePath(entry.path)}`)
    layout.sidePane.add("preview")
  }

  /**
   * 右键菜单：每一层（文件 / 目录）都能在系统资源管理器里定位、复制路径。
   *
   * 绝对路径要自己拼：文件树里的 `entry.path` 是工作区相对路径，
   * 而「在资源管理器中显示」必须给原生壳一个绝对路径（相对路径会被解析到进程 cwd）。
   */
  const absolutePath = (entry: Entry) => {
    const separator = props.directory.includes("\\") ? "\\" : "/"
    return `${props.directory.replace(/[\/]+$/, "")}${separator}${entry.path}`
  }

  const revealInExplorer = (entry: Entry) => {
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

  const openInTerminal = (entry: Entry) => {
    void sdk()
      .pty.create({ cwd: absolutePath(entry) })
      .catch(() => {})
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

  const rootEntries = () => openDirs()[""] ?? []

  const changedPaths = createMemo(() => new Set(changedFiles().map((file) => file.replaceAll("\\", "/"))))

  const visible = (entries: Entry[]) => {
    if (!onlyChanged() || !gitReady()) return entries
    const changed = changedPaths()
    return entries.filter((entry) => isVisibleEntry(entry.path, changed))
  }

  const visibleRoot = () => visible(rootEntries())

  const EntryRow = (p: { entry: Entry; depth: number }) => {
    const kind = () => kinds().get(p.entry.path)
    const isOpen = () => !!openDirs()[p.entry.path]
    return (
      <div>
        <ContextMenu>
          <ContextMenu.Trigger>
            <button
              type="button"
              class="flex w-full items-center gap-1.5 rounded-md py-0.5 pr-2 text-ui-caption text-foreground hover:bg-hover"
              style={{ "padding-left": `${8 + p.depth * 14}px` }}
              onClick={() => (p.entry.type === "dir" ? toggleDir(p.entry.path) : openFile(p.entry))}
            >
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
                mono
                class="size-4 shrink-0 text-foreground-subtlest"
              />
              <span class="flex-1 truncate text-left">{p.entry.name}</span>
              <Show when={kind()}>
                <span class="shrink-0 text-ui-xs font-semibold" style={kindColor(kind()!)}>
                  {kind() === "add" ? "A" : kind() === "del" ? "D" : "M"}
                </span>
              </Show>
            </button>
          </ContextMenu.Trigger>
          <ContextMenu.Portal>
            <ContextMenu.Content class="min-w-[190px] p-1 bg-surface border border-border rounded-lg shadow-lg z-50">
              <ContextMenu.Item
                class="flex items-center gap-2 px-2 py-1.5 text-12-medium text-foreground rounded-md hover:bg-hover cursor-pointer outline-none"
                onSelect={() => revealInExplorer(p.entry)}
              >
                <Icon name="open-file" size="small" />
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
              <ContextMenu.Separator class="h-px bg-border my-1" />
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
            </ContextMenu.Content>
          </ContextMenu.Portal>
        </ContextMenu>
        <Show when={isOpen()}>
          <For each={visible(openDirs()[p.entry.path] ?? [])}>
            {(child) => <EntryRow entry={child} depth={p.depth + 1} />}
          </For>
        </Show>
      </div>
    )
  }

  return (
    <div class="flex size-full min-h-0 flex-col">
      <div class="flex h-9 shrink-0 items-center gap-2 border-b border-border px-2">
        <span class="flex-1 text-ui-caption text-foreground">{language.t("sidebar.tree.title")}</span>
        {/* 不要再用手写 <label> 包 Switch：label 没写 for 时会绑定到 Kobalte 藏起来的
            <input type="checkbox">，点开关的 Control（一个 div，见 Kobalte 的 switch-control.tsx）
            会先 toggle 一次，冒泡到 label 后再补发一次合成点击把它翻回来，两次抵消 = 开关永远点不动。
            文案改由 Switch 自己的 Label 承载（hideLabel 只给读屏用），可见文字单独放 span。 */}
        <div class="flex items-center gap-1.5 text-ui-xs text-foreground-subtle">
          <span class="cursor-pointer select-none" onClick={() => setOnlyChanged(!onlyChanged())}>
            {language.t("sidebar.tree.onlyChanged")}
          </span>
          <Switch checked={onlyChanged()} onChange={setOnlyChanged} hideLabel>
            {language.t("sidebar.tree.onlyChanged")}
          </Switch>
          {/* 手动刷新：watcher 不可用（网页端绑定缺失）时也能立刻看到磁盘上的变化。 */}
          <button
            type="button"
            class="ml-0.5 flex size-6 items-center justify-center rounded-md text-foreground-subtlest transition-colors hover:bg-hover hover:text-foreground"
            aria-label={language.t("git.refresh")}
            title={language.t("git.refresh")}
            onClick={() => {
              refresh()
              reloadDirs()
            }}
          >
            <Icon name="refresh" size="small" />
          </button>
        </div>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto no-scrollbar py-1">
        <Show
          when={visibleRoot().length > 0}
          fallback={
            <div class="px-3 py-4 text-ui-xs text-foreground-subtle">
              {!props.directory
                ? language.t("sidebar.tree.empty")
                : !rootLoaded()
                  ? language.t("sidebar.tree.loading")
                  : rootEntries().length > 0
                    ? language.t("sidebar.tree.noChanges")
                    : language.t("sidebar.tree.emptyDir")}
            </div>
          }
        >
          <For each={visibleRoot()}>{(entry) => <EntryRow entry={entry} depth={0} />}</For>
        </Show>
      </div>
      <div class="shrink-0 border-t border-border px-3 py-1.5 text-ui-xs text-foreground-subtle">
        {language.t("sidebar.tree.changes", { count: changedFiles().length })}
      </div>
    </div>
  )
}
