import { createSignal, createMemo, createEffect, For, Show, on } from "solid-js"
import { useTheme } from "../context/theme"
import { Locale } from "../util/locale"
import { fileIcon, treeArrow } from "../util/panel-icons"
import { readdir } from "node:fs/promises"
import path from "node:path"

export type FileSystemNode = {
  readonly name: string
  readonly path: string
  readonly isDirectory: boolean
}

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  "dist",
  "build",
  ".build",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  ".venv",
  "venv",
  "target",
  "vendor",
  "coverage",
  ".sst",
  "__pycache__",
  ".DS_Store",
])

const IGNORED_FILES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"])

const DOUBLE_CLICK_DELAY = 300 // ms

// 单个目录最多列多少项。超大目录(生成物、数据集)一次性铺开就能把这一屏顶掉,
// 所以硬性截断,剩下的用一行提示带过。
const MAX_ENTRIES = 500

// 目录内容缓存,放在模块作用域。
//
// 这里原来是一个**同步**的 readdirSync 递归:在 onMount 里一次把 10 层子目录全扫完,
// 不管展开与否。它跑在渲染线程上,所以在稍大的仓库里(尤其 Windows)就是秒级到分钟级
// 的硬卡死;而侧栏切走再切回来会重建组件,于是每切一次标签页就重扫一遍整个仓库。
// 现在改成:按需一层一层读、异步读、读过的缓存住。
const cache = new Map<string, FileSystemNode[]>()

/** 只读 dirPath 这**一层**,不递归。读过的结果缓存,重复调用直接命中缓存。 */
export async function readFileTreeDirectory(dirPath: string): Promise<FileSystemNode[]> {
  const cached = cache.get(dirPath)
  if (cached) return cached

  let nodes: FileSystemNode[] = []
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name) || IGNORED_FILES.has(entry.name)) continue
      if (entry.name.startsWith(".") && entry.name !== ".novaway") continue
      nodes.push({
        name: entry.name,
        path: path.join(dirPath, entry.name),
        isDirectory: entry.isDirectory(),
      })
    }
    nodes.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  } catch {
    nodes = []
  }

  cache.set(dirPath, nodes)
  return nodes
}

/** 丢掉整棵缓存,下一次展开会重新读盘。 */
export function clearFileTreeCache() {
  cache.clear()
}

export interface FileTreeProps {
  rootPath: string
  onFileSelect?: (filePath: string) => void
  onFileDoubleClick?: (filePath: string) => void
}

export function FileTree(props: FileTreeProps) {
  const { theme } = useTheme()
  const [expandedDirs, setExpandedDirs] = createSignal<Set<string>>(new Set())
  const [selectedFile, setSelectedFile] = createSignal<string | null>(null)
  const [children, setChildren] = createSignal<Record<string, FileSystemNode[]>>({})
  const [loading, setLoading] = createSignal<Set<string>>(new Set())
  const [lastClickTime, setLastClickTime] = createSignal<number>(0)
  const [lastClickFile, setLastClickFile] = createSignal<string | null>(null)

  const load = async (dirPath: string) => {
    if (children()[dirPath]) return
    setLoading((prev) => new Set(prev).add(dirPath))
    const nodes = await readFileTreeDirectory(dirPath)
    setChildren((prev) => ({ ...prev, [dirPath]: nodes }))
    setLoading((prev) => {
      const next = new Set(prev)
      next.delete(dirPath)
      return next
    })
  }

  createEffect(
    on(
      () => props.rootPath,
      (rootPath) => {
        setChildren({})
        setExpandedDirs(new Set([rootPath]))
        void load(rootPath)
      },
    ),
  )

  const toggleDir = (dirPath: string) => {
    const expand = !expandedDirs().has(dirPath)
    setExpandedDirs((prev) => {
      const next = new Set(prev)
      if (expand) next.add(dirPath)
      else next.delete(dirPath)
      return next
    })
    // 只有真正展开的目录才去读盘,收起来的分支一行都不扫。
    if (expand) void load(dirPath)
  }

  const handleFileClick = (filePath: string) => {
    const now = Date.now()
    const lastTime = lastClickTime()
    const lastFile = lastClickFile()

    if (lastFile === filePath && now - lastTime < DOUBLE_CLICK_DELAY) {
      props.onFileDoubleClick?.(filePath)
      setLastClickTime(0)
      setLastClickFile(null)
      return
    }
    setSelectedFile(filePath)
    props.onFileSelect?.(filePath)
    setLastClickTime(now)
    setLastClickFile(filePath)
  }

  const NodeChildren = (childProps: { dirPath: string; depth: number }) => {
    const all = createMemo(() => children()[childProps.dirPath] ?? [])
    const visible = createMemo(() => all().slice(0, MAX_ENTRIES))
    const overflow = createMemo(() => Math.max(0, all().length - MAX_ENTRIES))
    return (
      <>
        <Show when={loading().has(childProps.dirPath)}>
          <box paddingLeft={childProps.depth * 2 + 3}>
            <text fg={theme.textMuted} wrapMode="none">
              读取中…
            </text>
          </box>
        </Show>
        <For each={visible()}>{(child) => renderNode(child, childProps.depth)}</For>
        <Show when={overflow() > 0}>
          <box paddingLeft={childProps.depth * 2 + 3}>
            <text fg={theme.textMuted} wrapMode="none">
              还有 {overflow()} 项未显示
            </text>
          </box>
        </Show>
      </>
    )
  }

  const renderNode = (node: FileSystemNode, depth: number = 0) => {
    const isExpanded = createMemo(() => expandedDirs().has(node.path))
    const isSelected = createMemo(() => selectedFile() === node.path)
    const truncatedName = Locale.truncate(node.name, 20)

    return (
      <box flexDirection="column">
        <box
          flexDirection="row"
          paddingLeft={depth * 2}
          paddingRight={1}
          onMouseUp={() => {
            if (node.isDirectory) toggleDir(node.path)
            else handleFileClick(node.path)
          }}
          backgroundColor={isSelected() ? theme.backgroundElement : undefined}
        >
          <text fg={theme.textMuted} wrapMode="none" flexShrink={0}>
            {node.isDirectory ? treeArrow(isExpanded()) + " " : "  "}
          </text>
          <text fg={theme.primary} wrapMode="none" flexShrink={0}>
            {fileIcon(node.name, node.isDirectory, isExpanded())}
          </text>
          <text fg={isSelected() ? theme.primary : theme.text} wrapMode="none" flexShrink={0}>
            {" " + truncatedName}
          </text>
        </box>
        <Show when={node.isDirectory && isExpanded()}>
          <NodeChildren dirPath={node.path} depth={depth + 1} />
        </Show>
      </box>
    )
  }

  return (
    <box flexDirection="column" flexGrow={1}>
      {/* 标题由侧边栏的“文件”标签页提供,这里不再重复一个抬头 */}
      <box flexDirection="column" flexGrow={1} overflow="hidden">
        <NodeChildren dirPath={props.rootPath} depth={0} />
      </box>
      <box paddingTop={1} paddingLeft={1}>
        <text fg={theme.textMuted}>单击:预览 · 双击:引用</text>
      </box>
    </box>
  )
}
