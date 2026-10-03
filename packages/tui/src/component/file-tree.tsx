import { createSignal, createMemo, createEffect, For, Show, on } from "solid-js"
import { useTheme } from "../context/theme"
import { Locale } from "../util/locale"
import { FILE_TREE_NAME_MAX } from "../util/sidebar-metrics"
import { fileIcon, treeArrow } from "../util/panel-icons"
import { fileTag, fileTagColor } from "../util/filetype"
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

/**
 * 文件树当前选中的文件,提到模块作用域(先例:sidebar.tsx 的 sidebarTab)。
 *
 * 为什么不能只留组件内部那个 signal:文件树自己只用它给选中行加内衬高亮,而侧栏那张
 * 「快速预览」卡要显示**同一个**选中文件的内容 —— 两者必须看同一个值。组件内的 signal
 * 只有文件树自己读得到,侧栏卡片拿不到。
 *
 * 也不复用 routes/session/index.tsx 与 routes/home.tsx 里那两个同名的 selectedFile:
 * 它们是**路由局部**的,记的是「当前打开的预览标签页指向哪个文件」,关掉标签页就会被清成
 * null,而侧栏要的是「用户在树上点了哪一行」—— 点一下就已经选中了,不该非要再开一个标签页。
 * 两件事会分叉(点文件树也会开标签页,但关掉标签页不该把树里的高亮和预览一起抹掉),
 * 所以这里单开一个,并在文件树点选时写入。
 */
const [selectedPath, setSelectedPath] = createSignal<string | null>(null)
export { selectedPath, setSelectedPath }

/**
 * 这个路径在不在这棵树底下。跨盘符时(Windows 的 C: → D:)path.relative 会直接给一个
 * 绝对路径,所以绝对路径也判成「不在底下」。
 */
function insideTree(rootPath: string, target: string | null) {
  if (!target) return true
  const relative = path.relative(rootPath, target)
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
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
        // 换根目录就把选中项清掉 —— 它是**模块级**的(见上面 selectedPath 的注释),不随组件
        // 重挂而消失:换到另一个会话的目录之后它还指着上一个目录的文件,快速预览卡会去读一个
        // 不存在的路径,正文变成「无法读取该文件」—— 一张看起来坏掉的卡,而不是干脆没有卡。
        //
        // 判据是「选中项还在不在这棵树底下」而不是「这是不是首挂载」:首挂载时那个选中项
        // 同样可能是上一个会话留下的(模块级状态跨重挂存活),而测试里也普遍在挂载前就预设
        // 选中项。按 rootPath 是否变化来判,两种情况都会误伤其中一边。
        if (!insideTree(rootPath, selectedPath())) {
          setSelectedFile(null)
          setSelectedPath(null)
        }
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
    // 组件内那份只管高亮这一行;模块级那份给侧栏的快速预览卡读(见上面的注释)。
    setSelectedFile(filePath)
    setSelectedPath(filePath)
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
    const truncatedName = Locale.truncateToWidth(node.name, FILE_TREE_NAME_MAX)
    // 目录不配语言标签(它没有语言);认不出的扩展名返回 undefined,于是那一行落回文件图标。
    const tag = createMemo(() => (node.isDirectory ? undefined : fileTag(node.name)))

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
          {/* 语言标签占的是原型那个 `.ic` 槽(`.tree .row .ic { width: 14px }`,
              card-design-v7.html:209),也就是终端里原来放文件图标的那 2 列 —— 所以这一段的
              固定开销**一点没变**(见下面名字那段注释里的算式)。

              显式 width={2} 而不是让内容自己撑:TS/JS/{}/PY/RS 各 2 列,而 `Ⓜ`(U+24C2,
              East-Asian Ambiguous)按标准口径只记 1 列(见 util/panel-icons 的文件头)。
              不钉死宽度的话,同一屏里 TS 行与 Ⓜ 行的文件名起点会差 1 列,扫一列名字时
              右边沿像锯齿。少出来的那一列由这个盒子补成空白。 */}
          <Show
            when={tag()}
            fallback={
              <text fg={theme.primary} wrapMode="none" flexShrink={0}>
                {fileIcon(node.name, node.isDirectory, isExpanded())}
              </text>
            }
          >
            {(item) => (
              <box width={2} flexShrink={0}>
                <text fg={fileTagColor(item().kind, theme)} wrapMode="none">
                  {item().text}
                </text>
              </box>
            )}
          </Show>
          {/* 名字这一段**不**设 flexShrink={0}:上层那三段(缩进 / 箭头 / 标签)都是固定开销,
              剩下的列才轮到名字,剩下的不够时 yoga 收缩这个名字 text(渲染器裁尾部)。
              三段全是 flexShrink={0} 的话没有可缩对象,超长的名字只能顶到右边框上 ——
              FILE_TREE_NAME_MAX 是「不触发收缩」的软上限,而**超出的部分按显示列截尾成 `…`**
              (truncateToWidth,扩展名一起吃掉也不留半截),两者都在这一段里发生。

              一行的列预算(与 util/sidebar-metrics 的口径一致):
                2×深度        缩进
              + 2            箭头段(展开/收起字形 + 一个空格,文件行是两个空格)
              + 2            语言标签槽;认不出的扩展名落回文件图标,图标最宽也是 2 列
              + 1            名字前那个空格
              + 1            行右内边距
              = 2×深度 + 6
              + 20(FILE_TREE_NAME_MAX)
              第 5 层是 2×5+6+20 = 36,文件页最窄那一档有 37 列(侧栏 44 − 根卡内边距 4 −
              滚动条 1 − 卡边框 2,见 sidebar-metrics),还剩 1 列;再深一层或名字更长就落到
              上面那条收缩/截尾上。**标签没有吃掉名字的预算**,因为它替换的是图标那 2 列,
              不是新增一列。 */}
          <text fg={isSelected() ? theme.primary : theme.text} wrapMode="none">
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
      {/* 抬头由侧栏那边的「资源管理器」分区卡提供(SidebarCard),这里不再重复一个标题行 */}
      <box flexDirection="column" flexGrow={1} overflow="hidden">
        <NodeChildren dirPath={props.rootPath} depth={0} />
      </box>
      <box paddingTop={1} paddingLeft={1}>
        <text fg={theme.textMuted}>单击:预览 · 双击:引用</text>
      </box>
    </box>
  )
}
