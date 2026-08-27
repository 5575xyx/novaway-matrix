import { createSignal, createMemo, For, Show, onMount } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { Locale } from "../util/locale"
import { fileIcon } from "../util/panel-icons"
import { readdirSync, statSync } from "node:fs"
import path from "node:path"

export type FileSystemNode = {
  readonly name: string
  readonly path: string
  readonly isDirectory: boolean
  children?: FileSystemNode[]
}

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  "dist",
  ".build",
  ".sst",
  "__pycache__",
  ".DS_Store",
])

const IGNORED_FILES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"])

const DOUBLE_CLICK_DELAY = 300 // ms

function scanDirectory(dirPath: string, depth: number = 0, maxDepth: number = 10): FileSystemNode[] {
  if (depth > maxDepth) return []

  try {
    const entries = readdirSync(dirPath, { withFileTypes: true })
    const nodes: FileSystemNode[] = []

    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name) || IGNORED_FILES.has(entry.name)) continue
      if (entry.name.startsWith(".") && entry.name !== ".novaway") continue

      const fullPath = path.join(dirPath, entry.name)
      const isDirectory = entry.isDirectory()

      const node: FileSystemNode = {
        name: entry.name,
        path: fullPath,
        isDirectory,
      }

      if (isDirectory) {
        node.children = scanDirectory(fullPath, depth + 1, maxDepth)
      }

      nodes.push(node)
    }

    nodes.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })

    return nodes
  } catch {
    return []
  }
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
  const [tree, setTree] = createSignal<FileSystemNode[]>([])
  const [lastClickTime, setLastClickTime] = createSignal<number>(0)
  const [lastClickFile, setLastClickFile] = createSignal<string | null>(null)

  onMount(() => {
    const nodes = scanDirectory(props.rootPath)
    setTree(nodes)
    setExpandedDirs(new Set([props.rootPath]))
  })

  const toggleDir = (dirPath: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(dirPath)) {
        next.delete(dirPath)
      } else {
        next.add(dirPath)
      }
      return next
    })
  }

  const handleFileClick = (filePath: string) => {
    const now = Date.now()
    const lastTime = lastClickTime()
    const lastFile = lastClickFile()

    if (lastFile === filePath && now - lastTime < DOUBLE_CLICK_DELAY) {
      // Double click detected
      props.onFileDoubleClick?.(filePath)
      setLastClickTime(0)
      setLastClickFile(null)
    } else {
      // Single click
      setSelectedFile(filePath)
      props.onFileSelect?.(filePath)
      setLastClickTime(now)
      setLastClickFile(filePath)
    }
  }

  const renderNode = (node: FileSystemNode, depth: number = 0) => {
    const isExpanded = createMemo(() => expandedDirs().has(node.path))
    const isSelected = createMemo(() => selectedFile() === node.path)
    const maxNameLength = 20
    const truncatedName = Locale.truncate(node.name, maxNameLength)

    return (
      <box flexDirection="column">
        <box
          flexDirection="row"
          paddingLeft={depth * 2}
          paddingRight={1}
          paddingTop={0}
          paddingBottom={0}
          onMouseUp={() => {
            if (node.isDirectory) {
              toggleDir(node.path)
            } else {
              handleFileClick(node.path)
            }
          }}
          backgroundColor={isSelected() ? theme.backgroundElement : undefined}
        >
          <text fg={theme.textMuted} wrapMode="none" flexShrink={0}>
            {node.isDirectory ? (isExpanded() ? "▼ " : "▶ ") : "  "}
          </text>
          <text fg={theme.primary} wrapMode="none" flexShrink={0}>
            {fileIcon(node.name, node.isDirectory)}
          </text>
          <text fg={isSelected() ? theme.primary : theme.text} wrapMode="none" flexShrink={0}>
            {" " + truncatedName}
          </text>
        </box>
        <Show when={node.isDirectory && isExpanded() && node.children}>
          <For each={node.children!}>
            {(child) => renderNode(child, depth + 1)}
          </For>
        </Show>
      </box>
    )
  }

  return (
    <box flexDirection="column" flexGrow={1}>
      <box paddingBottom={1} paddingLeft={1}>
        <text fg={theme.primary} attributes={TextAttributes.BOLD}>
          📂 Files
        </text>
      </box>
      <box flexDirection="column" flexGrow={1} overflow="hidden">
        <For each={tree()}>
          {(node) => renderNode(node, 0)}
        </For>
      </box>
      <box paddingTop={1} paddingLeft={1}>
        <text fg={theme.textMuted}>
          Click: preview | Double-click: reference
        </text>
      </box>
    </box>
  )
}
