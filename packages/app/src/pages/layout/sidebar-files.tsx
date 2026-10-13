import { For, Show, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { FileIcon } from "@novaway/ui/file-icon"
import { Icon } from "@novaway/ui/icon"
import { Switch } from "@novaway/ui/switch"
import type { GitSnapshotResponses } from "@novaway/sdk/v2"
import { encodeFilePath } from "@/context/file/path"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"

type Entry = { path: string; name: string; type: "file" | "dir" }
type Kind = "add" | "del" | "mix"
type Snapshot = GitSnapshotResponses[200]

const REFRESH_INTERVAL = 5000

const mergeKind = (a: Kind | undefined, b: Kind): Kind => (!a || a === b ? b : "mix")

// 「仅变更」必须对每一层都成立。只看根层的话，展开子目录后未变更的文件会整片露出来，
// 过滤开关看起来就像没生效。条目自身在变更清单里、或有变更文件挂在它下面（前缀命中）才算可见。
export function isVisibleEntry(path: string, changed: ReadonlySet<string>): boolean {
  const normalized = path.replaceAll("\\", "/")
  if (changed.has(normalized)) return true
  const prefix = `${normalized}/`
  for (const file of changed) if (file.startsWith(prefix)) return true
  return false
}

export function SidebarFiles(props: { directory: string; sessionKey: () => string }) {
  const language = useLanguage()
  const layout = useLayout()
  const globalSync = useGlobalSync()
  const [openDirs, setOpenDirs] = createSignal<Record<string, Entry[]>>({})
  const [onlyChanged, setOnlyChanged] = createSignal(true)
  const [snapshot, setSnapshot] = createSignal<Snapshot>()
  const sdk = () => globalSync.sdkForDirectory(props.directory)

  let requestGen = 0

  const refresh = () => {
    if (!props.directory) return
    const gen = requestGen
    void sdk()
      .git.snapshot()
      .then((r) => {
        if (gen !== requestGen) return
        setSnapshot(r.data)
      })
      .catch(() => {})
  }

  const loadDir = (dir: string) => {
    if (!props.directory) return
    const gen = requestGen
    void sdk()
      .file.list({ path: dir })
      .then((r) => {
        if (gen !== requestGen) return
        const entries = (r.data ?? []).map((x) => ({
          path: x.path.replaceAll("\\", "/"),
          name: x.name,
          type: x.type === "directory" ? ("dir" as const) : ("file" as const),
        }))
        setOpenDirs((prev) => ({ ...prev, [dir]: entries }))
      })
      .catch(() => {})
  }

  refresh()
  loadDir("")
  const timer = setInterval(refresh, REFRESH_INTERVAL)
  onCleanup(() => clearInterval(timer))

  createEffect(
    on(
      () => props.directory,
      () => {
        requestGen++
        setOpenDirs({})
        setSnapshot(undefined)
        refresh()
        loadDir("")
      },
      { defer: true },
    ),
  )

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
    color:
      kind === "add"
        ? "var(--icon-diff-add-base)"
        : kind === "del"
          ? "var(--icon-diff-delete-base)"
          : "var(--icon-diff-modified-base)",
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

  const rootEntries = () => openDirs()[""] ?? []

  const changedPaths = createMemo(() => new Set(changedFiles().map((file) => file.replaceAll("\\", "/"))))

  const visible = (entries: Entry[]) => {
    if (!onlyChanged()) return entries
    const changed = changedPaths()
    return entries.filter((entry) => isVisibleEntry(entry.path, changed))
  }

  const visibleRoot = () => visible(rootEntries())

  const EntryRow = (p: { entry: Entry; depth: number }) => {
    const kind = () => kinds().get(p.entry.path)
    const isOpen = () => !!openDirs()[p.entry.path]
    return (
      <div>
        <button
          type="button"
          class="flex w-full items-center gap-1.5 rounded-md py-0.5 pr-2 text-ui-caption text-text-base hover:bg-surface-base-hover"
          style={{ "padding-left": `${8 + p.depth * 14}px` }}
          onClick={() => (p.entry.type === "dir" ? toggleDir(p.entry.path) : openFile(p.entry))}
        >
          <Show when={p.entry.type === "dir"}>
            <Icon name={isOpen() ? "chevron-down" : "chevron-right"} size="small" class="shrink-0 text-icon-weak" />
          </Show>
          <Show when={p.entry.type === "file"}>
            <span class="size-4 shrink-0" />
          </Show>
          <FileIcon
            node={{ path: p.entry.path, type: p.entry.type === "dir" ? "directory" : "file" }}
            expanded={isOpen()}
            mono
            class="size-4 shrink-0 text-icon-weak"
          />
          <span class="flex-1 truncate text-left">{p.entry.name}</span>
          <Show when={kind()}>
            <span class="shrink-0 text-ui-xs font-semibold" style={kindColor(kind()!)}>
              {kind() === "add" ? "A" : kind() === "del" ? "D" : "M"}
            </span>
          </Show>
        </button>
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
      <div class="flex h-9 shrink-0 items-center gap-2 border-b border-border-weak-base px-2">
        <span class="flex-1 text-ui-caption text-text-strong">{language.t("sidebar.tree.title")}</span>
        {/* 不要再用手写 <label> 包 Switch：label 没写 for 时会绑定到 Kobalte 藏起来的
            <input type="checkbox">，点开关的 Control（一个 div，见 Kobalte 的 switch-control.tsx）
            会先 toggle 一次，冒泡到 label 后再补发一次合成点击把它翻回来，两次抵消 = 开关永远点不动。
            文案改由 Switch 自己的 Label 承载（hideLabel 只给读屏用），可见文字单独放 span。 */}
        <div class="flex items-center gap-1.5 text-ui-xs text-text-weak">
          <span class="cursor-pointer select-none" onClick={() => setOnlyChanged(!onlyChanged())}>
            {language.t("sidebar.tree.onlyChanged")}
          </span>
          <Switch checked={onlyChanged()} onChange={setOnlyChanged} hideLabel>
            {language.t("sidebar.tree.onlyChanged")}
          </Switch>
        </div>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto no-scrollbar py-1">
        <Show
          when={visibleRoot().length > 0}
          fallback={
            <div class="px-3 py-4 text-ui-xs text-text-weak">
              {rootEntries().length > 0 ? language.t("sidebar.tree.noChanges") : language.t("sidebar.tree.empty")}
            </div>
          }
        >
          <For each={visibleRoot()}>{(entry) => <EntryRow entry={entry} depth={0} />}</For>
        </Show>
      </div>
      <div class="shrink-0 border-t border-border-weak-base px-3 py-1.5 text-ui-xs text-text-weak">
        {language.t("sidebar.tree.changes", { count: changedFiles().length })}
      </div>
    </div>
  )
}
