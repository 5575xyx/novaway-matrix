import { useFile } from "@/context/file"
import { encodeFilePath } from "@/context/file/path"
import { usePlatform } from "@/context/platform"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"
import { Collapsible } from "@novaway/ui/collapsible"
import { ContextMenu } from "@novaway/ui/context-menu"
import { FileIcon } from "@novaway/ui/file-icon"
import { Icon } from "@novaway/ui/icon"
import { showToast } from "@novaway/ui/toast"
import { writeClipboard } from "@novaway/ui/util/clipboard"
import {
  createEffect,
  createMemo,
  For,
  Match,
  on,
  Show,
  splitProps,
  Switch,
  untrack,
  type ComponentProps,
  type ParentProps,
} from "solid-js"
import { Dynamic } from "solid-js/web"
import type { FileNode } from "@novaway/sdk/v2"

const MAX_DEPTH = 128

function pathToFileUrl(filepath: string): string {
  return `file://${encodeFilePath(filepath)}`
}

type Kind = "add" | "del" | "mix"

type Filter = {
  files: Set<string>
  dirs: Set<string>
}

// 纯逻辑（根目录/展开目录的取数时机）抽到 file-tree-model.ts：
// 组件 import 了 Kobalte（ContextMenu / Collapsible），模块作用域会触碰客户端 API，
// 单测只能解析到 SSR 构建。这里再导出，保持既有 import 路径可用。
import { dirsToExpand, shouldListRoot, shouldListExpanded } from "./file-tree-model"
export { dirsToExpand, shouldListRoot, shouldListExpanded }

const kindLabel = (kind: Kind) => {
  if (kind === "add") return "A"
  if (kind === "del") return "D"
  return "M"
}

const kindTextColor = (kind: Kind) => {
  if (kind === "add") return "color: var(--diff-added)"
  if (kind === "del") return "color: var(--diff-removed)"
  return "color: var(--git-modified)"
}

const kindDotColor = (kind: Kind) => {
  if (kind === "add") return "background-color: var(--diff-added)"
  if (kind === "del") return "background-color: var(--diff-removed)"
  return "background-color: var(--git-modified)"
}

const visibleKind = (node: FileNode, kinds?: ReadonlyMap<string, Kind>, marks?: Set<string>) => {
  const kind = kinds?.get(node.path)
  if (!kind) return
  if (!marks?.has(node.path)) return
  return kind
}

const buildDragImage = (target: HTMLElement) => {
  const icon = target.querySelector('[data-component="file-icon"]') ?? target.querySelector("svg")
  const text = target.querySelector("span")
  if (!icon || !text) return

  const image = document.createElement("div")
  image.className =
    "flex items-center gap-x-2 px-2 py-1 bg-surface rounded-md border border-border text-12-regular text-foreground"
  image.style.position = "absolute"
  image.style.top = "-1000px"
  image.innerHTML = (icon as SVGElement).outerHTML + (text as HTMLSpanElement).outerHTML
  return image
}

const withFileDragImage = (event: DragEvent) => {
  const image = buildDragImage(event.currentTarget as HTMLElement)
  if (!image) return
  document.body.appendChild(image)
  event.dataTransfer?.setDragImage(image, 0, 12)
  setTimeout(() => document.body.removeChild(image), 0)
}

const FileTreeNode = (
  p: ParentProps &
    ComponentProps<"div"> &
    ComponentProps<"button"> & {
      node: FileNode
      level: number
      active?: string
      nodeClass?: string
      draggable: boolean
      kinds?: ReadonlyMap<string, Kind>
      marks?: Set<string>
      as?: "div" | "button"
      onCopyPath?: (path: string) => void
      onCopyRelativePath?: (path: string) => void
      onRevealInOS?: (path: string) => void
      onOpenInTerminal?: (path: string) => void
    },
) => {
  const [local, rest] = splitProps(p, [
    "node",
    "level",
    "active",
    "nodeClass",
    "draggable",
    "kinds",
    "marks",
    "as",
    "children",
    "class",
    "classList",
    "onCopyPath",
    "onCopyRelativePath",
    "onRevealInOS",
    "onOpenInTerminal",
  ])
  const kind = () => visibleKind(local.node, local.kinds, local.marks)
  const active = () => !!kind() && !local.node.ignored
  const color = () => {
    const value = kind()
    if (!value) return
    return kindTextColor(value)
  }

  return (
    <ContextMenu>
      <ContextMenu.Trigger>
        <Dynamic
          component={local.as ?? "div"}
          classList={{
            "w-full min-w-0 h-6 flex items-center justify-start gap-x-1.5 rounded-md px-1.5 py-0 text-left hover:bg-hover active:bg-selected transition-colors cursor-pointer": true,
            "bg-selected": local.node.path === local.active,
            ...local.classList,
            [local.class ?? ""]: !!local.class,
            [local.nodeClass ?? ""]: !!local.nodeClass,
          }}
          style={`padding-left: ${Math.max(0, 8 + local.level * 12 - (local.node.type === "file" ? 24 : 4))}px`}
          draggable={local.draggable}
          onDragStart={(event: DragEvent) => {
            if (!local.draggable) return
            event.dataTransfer?.setData("text/plain", `file:${local.node.path}`)
            event.dataTransfer?.setData("text/uri-list", pathToFileUrl(local.node.path))
            if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy"
            withFileDragImage(event)
          }}
          {...rest}
        >
          {local.children}
          <span
            classList={{
              "flex-1 min-w-0 text-12-medium whitespace-nowrap truncate": true,
              "text-foreground-subtlest": local.node.ignored,
              "text-foreground-subtle": !local.node.ignored && !active(),
            }}
            style={active() ? color() : undefined}
          >
            {local.node.name}
          </span>
          {(() => {
            const value = kind()
            if (!value) return null
            if (local.node.type === "file") {
              return (
                <span class="shrink-0 w-4 text-center text-12-medium" style={kindTextColor(value)}>
                  {kindLabel(value)}
                </span>
              )
            }
            return <div class="shrink-0 size-1.5 mr-1.5 rounded-full" style={kindDotColor(value)} />
          })()}
        </Dynamic>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content class="min-w-[180px] p-1 bg-surface border border-border rounded-lg shadow-lg z-50">
          <ContextMenu.Item
            class="flex items-center gap-2 px-2 py-1.5 text-12-medium text-foreground rounded-md hover:bg-hover cursor-pointer outline-none"
            onSelect={() => local.onRevealInOS?.(local.node.absolute)}
          >
            <Icon name="open-file" size="small" />
            在文件资源管理器中显示
          </ContextMenu.Item>
          <ContextMenu.Item
            class="flex items-center gap-2 px-2 py-1.5 text-12-medium text-foreground rounded-md hover:bg-hover cursor-pointer outline-none"
            onSelect={() => local.onOpenInTerminal?.(local.node.absolute)}
          >
            <Icon name="terminal" size="small" />
            在集成终端中打开
          </ContextMenu.Item>
          <ContextMenu.Separator class="h-px bg-border my-1" />
          <ContextMenu.Item
            class="flex items-center gap-2 px-2 py-1.5 text-12-medium text-foreground rounded-md hover:bg-hover cursor-pointer outline-none"
            onSelect={() => local.onCopyPath?.(local.node.absolute)}
          >
            <Icon name="copy" size="small" />
            复制路径
          </ContextMenu.Item>
          <ContextMenu.Item
            class="flex items-center gap-2 px-2 py-1.5 text-12-medium text-foreground rounded-md hover:bg-hover cursor-pointer outline-none"
            onSelect={() => local.onCopyRelativePath?.(local.node.path)}
          >
            <Icon name="copy" size="small" />
            复制相对路径
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu>
  )
}

export default function FileTree(props: {
  path: string
  class?: string
  nodeClass?: string
  active?: string
  level?: number
  allowed?: readonly string[]
  modified?: readonly string[]
  kinds?: ReadonlyMap<string, Kind>
  draggable?: boolean
  onFileClick?: (file: FileNode) => void
  /**
   * 右键菜单的动作。**递归的子层必须一起带下去** —— 之前只在顶层节点绑了处理函数，
   * 展开第二层以后右键「在文件资源管理器中显示」全是空操作（`local.onRevealInOS` 是 undefined）。
   */
  onCopyPath?: (path: string) => void
  onCopyRelativePath?: (path: string) => void
  onRevealInOS?: (path: string) => void
  onOpenInTerminal?: (path: string) => void

  _filter?: Filter
  _marks?: Set<string>
  _deeps?: Map<string, number>
  _kinds?: ReadonlyMap<string, Kind>
  _chain?: readonly string[]
}) {
  const file = useFile()
  const sdk = useSDK()
  const platform = usePlatform()
  const language = useLanguage()
  const level = props.level ?? 0
  const draggable = () => props.draggable ?? true

  const key = (p: string) =>
    file
      .normalize(p)
      .replace(/[\\/]+$/, "")
      .replaceAll("\\", "/")
  const chain = props._chain ? [...props._chain, key(props.path)] : [key(props.path)]

  /**
   * 复制路径。走 `writeClipboard`（桌面端优先主进程），并按真实结果提示：
   * 之前用 `navigator.clipboard` 且吞掉异常，WebView 里静默失败时用户完全不知道
   * 复制没成功（右键「复制路径」像点了没反应）。
   */
  const copyWithFeedback = async (path: string) => {
    const copied = await writeClipboard(path)
    showToast(
      copied
        ? { variant: "success", icon: "circle-check", title: language.t("common.copied") }
        : { variant: "error", title: language.t("toast.copyFailed.title"), description: path },
    )
  }

  const handleCopyPath = (path: string) => void copyWithFeedback(path)

  const handleCopyRelativePath = (path: string) => void copyWithFeedback(path)

  const handleRevealInOS = (absolutePath: string) => {
    // 文件节点用「显示并选中」语义;openPath 对文件会直接用默认程序打开它,不符合预期。
    if (platform.showItemInFolder) {
      void platform.showItemInFolder(absolutePath).catch(() => {})
      return
    }
    if (platform.openPath) {
      void platform.openPath(absolutePath).catch(() => {})
      return
    }
    sdk.client.pty
      .create({ command: "explorer", args: [absolutePath], title: "reveal" })
      .then(() => {})
      .catch(() => {})
  }

  const handleOpenInTerminal = (absolutePath: string) => {
    sdk.client.pty
      .create({ cwd: absolutePath })
      .then(() => {})
      .catch(() => {})
  }

  // 顶层由调用方传进来（带业务语义）；子层递归时把同一组函数继续往下带。
  // 兜底用本地实现，保证单独使用 FileTree 时右键菜单依然可用。
  const copyPath = (path: string) => (props.onCopyPath ?? handleCopyPath)(path)
  const copyRelativePath = (path: string) => (props.onCopyRelativePath ?? handleCopyRelativePath)(path)
  const revealInOS = (path: string) => (props.onRevealInOS ?? handleRevealInOS)(path)
  const openInTerminal = (path: string) => (props.onOpenInTerminal ?? handleOpenInTerminal)(path)

  const filter = createMemo(() => {
    if (props._filter) return props._filter

    const allowed = props.allowed
    if (!allowed) return

    const files = new Set(allowed)
    const dirs = new Set<string>()

    for (const item of allowed) {
      const parts = item.split("/")
      const parents = parts.slice(0, -1)
      for (const [idx] of parents.entries()) {
        const dir = parents.slice(0, idx + 1).join("/")
        if (dir) dirs.add(dir)
      }
    }

    return { files, dirs }
  })

  const marks = createMemo(() => {
    if (props._marks) return props._marks

    const out = new Set<string>()
    for (const item of props.modified ?? []) out.add(item)
    for (const item of props.kinds?.keys() ?? []) out.add(item)
    if (out.size === 0) return
    return out
  })

  const kinds = createMemo(() => {
    if (props._kinds) return props._kinds
    return props.kinds
  })

  const deeps = createMemo(() => {
    if (props._deeps) return props._deeps

    const out = new Map<string, number>()

    const root = props.path
    if (!(file.tree.state(root)?.expanded ?? false)) return out

    const seen = new Set<string>()
    const stack: { dir: string; lvl: number; i: number; kids: string[]; max: number }[] = []

    const push = (dir: string, lvl: number) => {
      const id = key(dir)
      if (seen.has(id)) return
      seen.add(id)

      const kids = file.tree
        .children(dir)
        .filter((node) => node.type === "directory" && (file.tree.state(node.path)?.expanded ?? false))
        .map((node) => node.path)

      stack.push({ dir, lvl, i: 0, kids, max: lvl })
    }

    push(root, level - 1)

    while (stack.length > 0) {
      const top = stack[stack.length - 1]!

      if (top.i < top.kids.length) {
        const next = top.kids[top.i]!
        top.i++
        push(next, top.lvl + 1)
        continue
      }

      out.set(top.dir, top.max)
      stack.pop()

      const parent = stack[stack.length - 1]
      if (!parent) continue
      parent.max = Math.max(parent.max, top.max)
    }

    return out
  })

  createEffect(() => {
    const current = filter()
    const dirs = dirsToExpand({
      level,
      filter: current,
      expanded: (dir) => untrack(() => file.tree.state(dir)?.expanded) ?? false,
    })
    for (const dir of dirs) file.tree.expand(dir)
  })

  createEffect(
    on(
      () => props.path,
      (path) => {
        const dir = untrack(() => file.tree.state(path))
        if (!shouldListRoot({ level, dir })) return
        void file.tree.list(path)
      },
      { defer: false },
    ),
  )

  const nodes = createMemo(() => {
    const nodes = file.tree.children(props.path)
    const current = filter()
    if (!current) return nodes

    const parent = (path: string) => {
      const idx = path.lastIndexOf("/")
      if (idx === -1) return ""
      return path.slice(0, idx)
    }

    const leaf = (path: string) => {
      const idx = path.lastIndexOf("/")
      return idx === -1 ? path : path.slice(idx + 1)
    }

    const out = nodes.filter((node) => {
      if (node.type === "file") return current.files.has(node.path)
      return current.dirs.has(node.path)
    })

    const seen = new Set(out.map((node) => node.path))

    for (const dir of current.dirs) {
      if (parent(dir) !== props.path) continue
      if (seen.has(dir)) continue
      out.push({
        name: leaf(dir),
        path: dir,
        absolute: dir,
        type: "directory",
        ignored: false,
      })
      seen.add(dir)
    }

    for (const item of current.files) {
      if (parent(item) !== props.path) continue
      if (seen.has(item)) continue
      out.push({
        name: leaf(item),
        path: item,
        absolute: item,
        type: "file",
        ignored: false,
      })
      seen.add(item)
    }

    out.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "directory" ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })

    return out
  })

  return (
    <div data-component="filetree" class={`flex flex-col gap-0.5 ${props.class ?? ""}`}>
      <For each={nodes()}>
        {(node) => {
          const expanded = () => file.tree.state(node.path)?.expanded ?? false
          const deep = () => deeps().get(node.path) ?? -1
          const kind = () => visibleKind(node, kinds(), marks())
          const active = () => !!kind() && !node.ignored

          return (
            <Switch>
              <Match when={node.type === "directory"}>
                <Collapsible
                  variant="ghost"
                  class="w-full"
                  data-scope="filetree"
                  forceMount={false}
                  open={expanded()}
                  onOpenChange={(open) => (open ? file.tree.expand(node.path) : file.tree.collapse(node.path))}
                >
                  <Collapsible.Trigger>
                    <FileTreeNode
                      node={node}
                      level={level}
                      active={props.active}
                      nodeClass={props.nodeClass}
                      draggable={draggable()}
                      kinds={kinds()}
                      marks={marks()}
                      onCopyPath={copyPath}
                      onCopyRelativePath={copyRelativePath}
                      onRevealInOS={revealInOS}
                      onOpenInTerminal={openInTerminal}
                    >
                      <div class="size-4 flex items-center justify-center text-foreground-subtlest">
                        <Icon name={expanded() ? "chevron-down" : "chevron-right"} size="small" />
                      </div>
                    </FileTreeNode>
                  </Collapsible.Trigger>
                  <Collapsible.Content class="relative pt-0.5">
                    <div
                      classList={{
                        "absolute top-0 bottom-0 w-px pointer-events-none bg-border opacity-0 transition-opacity duration-150 ease-out motion-reduce:transition-none": true,
                        "group-hover/filetree:opacity-100": expanded() && deep() === level,
                        "group-hover/filetree:opacity-50": !(expanded() && deep() === level),
                      }}
                      style={`left: ${Math.max(0, 8 + level * 12 - 4) + 8}px`}
                    />
                    <Show
                      when={level < MAX_DEPTH && !chain.includes(key(node.path))}
                      fallback={<div class="px-2 py-1 text-12-regular text-foreground-subtle">...</div>}
                    >
                      <FileTree
                        path={node.path}
                        level={level + 1}
                        allowed={props.allowed}
                        modified={props.modified}
                        kinds={props.kinds}
                        active={props.active}
                        draggable={props.draggable}
                        onFileClick={props.onFileClick}
                        onCopyPath={props.onCopyPath}
                        onCopyRelativePath={props.onCopyRelativePath}
                        onRevealInOS={revealInOS}
                        onOpenInTerminal={props.onOpenInTerminal}
                        _filter={filter()}
                        _marks={marks()}
                        _deeps={deeps()}
                        _kinds={kinds()}
                        _chain={chain}
                      />
                    </Show>
                  </Collapsible.Content>
                </Collapsible>
              </Match>
              <Match when={node.type === "file"}>
                <FileTreeNode
                  node={node}
                  level={level}
                  active={props.active}
                  nodeClass={props.nodeClass}
                  draggable={draggable()}
                  kinds={kinds()}
                  marks={marks()}
                  as="button"
                  type="button"
                  onClick={() => props.onFileClick?.(node)}
                  onCopyPath={copyPath}
                  onCopyRelativePath={copyRelativePath}
                  onRevealInOS={revealInOS}
                  onOpenInTerminal={openInTerminal}
                >
                  <div class="w-4 shrink-0" />
                  <Switch>
                    <Match when={node.ignored}>
                      <FileIcon
                        node={node}
                        class="size-4 filetree-icon filetree-icon--mono"
                        style="color: var(--foreground-subtlest)"
                        mono
                      />
                    </Match>
                    <Match when={active()}>
                      <FileIcon
                        node={node}
                        class="size-4 filetree-icon filetree-icon--mono"
                        style={kindTextColor(kind()!)}
                        mono
                      />
                    </Match>
                    <Match when={!node.ignored}>
                      <span class="filetree-iconpair size-4">
                        <FileIcon
                          node={node}
                          class="size-4 filetree-icon filetree-icon--color opacity-0 group-hover/filetree:opacity-100"
                        />
                        <FileIcon
                          node={node}
                          class="size-4 filetree-icon filetree-icon--mono group-hover/filetree:opacity-0"
                          mono
                        />
                      </span>
                    </Match>
                  </Switch>
                </FileTreeNode>
              </Match>
            </Switch>
          )
        }}
      </For>
    </div>
  )
}
