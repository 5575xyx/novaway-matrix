import { createEffect, createMemo, createSignal, For, on, onCleanup, Show, type Component } from "solid-js"
import { Dynamic } from "solid-js/web"
import { parseRichBlocks, sanitizeInlineHtml, type RichBlock } from "@novaway/core/office/rich/model"
import { searchMatches, replaceAll, replaceMatch, type SearchOptions } from "@novaway/core/office/text/search"
import { rememberScroll, scrollOf } from "@/pages/session/editor-memory"
import { CodeHighlight } from "@/pages/session/code-highlight"
import { pastedTextToHtml, sanitizePastedHtml } from "@/pages/session/rich-clipboard"
import { showToast } from "@novaway/ui/toast"
import { RibbonChoice, RibbonRow } from "@/pages/session/office-ribbon"
import { InspectorSection, InspectorToggle, PaneInspector } from "@/pages/session/pane-inspector"
import { PaneStatusBar } from "@/pages/session/pane-status-bar"

/**
 * 富文本（HTML）编辑器：设计视图 + 源码视图。
 *
 * **HTML 文本本身就是文档**。
 * 两个视图编辑的是同一份文本，所以不存在「设计态和源码对不上」；
 * 保存只重写被改过的那个块（或者源码视图里的整篇），文档头、样式表、
 * 没动过的段落逐字节不变。
 *
 * 设计视图每段独立 contenteditable：用户改一段时，别的段落的原始标记
 * 不会被浏览器的序列化顺手改写。
 */

export type RichOp = Record<string, unknown> & { op: string }

export type RichFilePreviewProps = {
  /** 当前 HTML 文本（从文件读出来的内容）。 */
  content: string
  /** 文件路径：只用来记住设计视图的滚动位置（切走再切回来不跳回顶部）。 */
  path?: string
  /** 阅读模式：隐藏编辑工具栏，段落不可编辑。 */
  readOnly?: boolean
  /** 保存单个块：只发被改过的那一段。 */
  onSaveBlock?: (block: number, html: string) => Promise<void>
  /** 结构操作：换段落类型、改对齐等。 */
  onSaveOps?: (ops: RichOp[]) => Promise<void>
  /** 保存源码视图里的整篇 HTML。 */
  onSaveSource?: (html: string) => Promise<void>
  /** 头部「查找」转进来的请求：值变一次就开一次源码查找条（查找入口只有头部那一处）。 */
  findRequest?: () => number
  /** 外部文件头的视图选择：设计预览或原文源码。 */
  mode?: "design" | "source"
  onModeChange?: (mode: "design" | "source") => void
}

/** 读成 data URI（富文本里的图片自包含，不改动文档目录）。 */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ""))
    reader.onerror = () => reject(reader.error ?? new Error("读不了这个图片"))
    reader.readAsDataURL(file)
  })
}

type ListGroup = { list: "ul" | "ol"; items: RichBlock[] }
type Item = { kind: "block"; block: RichBlock } | { kind: "list"; group: ListGroup }

const BLOCK_CHOICES = [
  { tag: "p", label: "正文" },
  { tag: "h1", label: "标题 1" },
  { tag: "h2", label: "标题 2" },
  { tag: "h3", label: "标题 3" },
  { tag: "blockquote", label: "引用" },
  { tag: "pre", label: "代码块" },
] as const

/** 对齐的四个互斥按钮压成一个 RibbonChoice；title 保持原来的「左对齐」等写法。 */
const ALIGN_CHOICES = [
  { id: "left", label: "左", title: "左对齐" },
  { id: "center", label: "中", title: "中对齐" },
  { id: "right", label: "右", title: "右对齐" },
  { id: "justify", label: "两端", title: "两端对齐" },
] as const

const LINE_HEIGHT_CHOICES = [1.2, 1.5, 1.75, 2, 2.5] as const
/** 字号（px）：写回成 span 的 font-size。 */
const SIZE_CHOICES = [12, 14, 16, 18, 20, 24, 28, 32] as const
/** 每次缩进 24px，上限 240px：和常见富文本编辑器的「Tab 一级」对齐。 */
const INDENT_STEP = 24
const INDENT_LIMIT = 240

/** 块级行高 / 缩进直接映射成内联样式，和文件里的 style 保持一致。 */
function blockStyle(block: RichBlock): Record<string, string | undefined> {
  return {
    "line-height": block.lineHeight !== undefined ? String(block.lineHeight) : undefined,
    "padding-left": block.indent ? `${block.indent}px` : undefined,
    "text-indent": block.firstLineIndent ? `${block.firstLineIndent}px` : undefined,
  }
}

/** 连续的列表项合成一个 ul/ol，否则 DOM 结构不合法。 */
function groupItems(blocks: RichBlock[]): Item[] {
  const items: Item[] = []
  for (const block of blocks) {
    if (block.tag === "li" && block.list) {
      const last = items.at(-1)
      if (last?.kind === "list" && last.group.list === block.list) {
        last.group.items.push(block)
        continue
      }
      items.push({ kind: "list", group: { list: block.list, items: [block] } })
      continue
    }
    items.push({ kind: "block", block })
  }
  return items
}

export const RichFilePreview: Component<RichFilePreviewProps> = (props) => {
  const [html, setHtml] = createSignal(props.content)
  // 源码模式在首帧就直接使用文件内容。不能等 `switchMode()` 初始化：
  // 父组件默认也是 source 时不会触发切换，异步加载的文件就会一直只显示空的第 1 行。
  const [mode, setMode] = createSignal<"design" | "source">("source")
  const [source, setSource] = createSignal(props.content)
  // 画布宽度：手机（公众号文章的常见版心）和桌面（铺满面板）。
  const [canvas, setCanvas] = createSignal<"phone" | "desktop">("desktop")
  const [active, setActive] = createSignal<number>()
  // 源码视图也是代码：Shiki 着色 + 行号，和文本预览同一套观感。
  // 行号跟着 textarea 的滚动走；着色完成前显示普通文本（见 code-highlight.tsx）。
  const [sourceHighlightSynced, setSourceHighlightSynced] = createSignal(false)
  const [sourceSelection, setSourceSelection] = createSignal(0)
  const [sourceScroll, setSourceScroll] = createSignal({ top: 0, left: 0 })
  const sourceLineNumbers = createMemo(() =>
    Array.from({ length: source().split("\n").length }, (_, index) => index + 1),
  )
  // 有选区时文本框自己画字：透明文字的选区只看得到底色、看不到字。
  const sourceHighlightOn = createMemo(() => sourceHighlightSynced() && sourceSelection() === 0)
  const [saving, setSaving] = createSignal(false)
  const [inspector, setInspector] = createSignal(false)
  const [splitting, setSplitting] = createSignal(false)
  // 源码视图的缩放：对整块（行号 + 着色层 + textarea）放大，三者同步不脱节。
  const [fontZoom, setFontZoom] = createSignal(100)
  // 工具栏要按「当前正在编辑的那一段」算选区，所以记住获得焦点的可编辑元素。
  let focusedElement: HTMLElement | undefined
  // 设计视图的滚动容器和源码 textarea：切走时要记位置，切回来要还原。
  let designScroll: HTMLDivElement | undefined
  let sourceArea: HTMLTextAreaElement | undefined
  let sourceGutter: HTMLDivElement | undefined
  // 隐藏的选图输入：工具栏按钮点它，和浏览器里的富文本编辑器一致。
  let imageInput: HTMLInputElement | undefined

  // 切标签会销毁整块 DOM，所以滚动位置存在组件外面（和文本编辑器的光标记忆同一份）。
  const rememberScrollNow = () => {
    const p = props.path
    if (!p) return
    if (mode() === "design" && designScroll) rememberScroll(p, designScroll.scrollTop, designScroll.scrollLeft)
  }
  onCleanup(rememberScrollNow)

  /** 等这一帧 DOM 落地后再还原：刚挂载时滚动容器还没有内容高度。 */
  const restoreScroll = () => {
    const p = props.path
    if (!p) return
    const saved = scrollOf(p)
    if (!saved) return
    requestAnimationFrame(() => {
      if (!designScroll) return
      designScroll.scrollTop = saved.top
      designScroll.scrollLeft = saved.left
    })
  }

  // 文件被重新读出来（自己保存或 Agent 改完）时同步，但不要打断正在编辑的段。
  createEffect(
    on(
      () => props.content,
      (value) => {
        if (value === html()) return

        const previous = html()
        setHtml(value)
        // 源码模式下，只有编辑器仍然跟着旧文件内容时才同步。
        // 如果用户已经输入了未保存内容，source() 会与 previous 不同，不能被异步
        // 的 file.load() 覆盖掉；保存完成后的下一次重读则会再次对齐。
        if (mode() === "source" && source() === previous) {
          setSource(value)
          setSourceHighlightSynced(false)
          setSourceSelection(0)
        }
      },
      { defer: true },
    ),
  )

  const blocks = createMemo(() => parseRichBlocks(html()))
  const items = createMemo(() => groupItems(blocks()))
  const activeBlock = createMemo(() => blocks().find((block) => block.index === active()))

  const innerOf = (block: RichBlock) => html().slice(block.textStart, block.textEnd)
  /**
   * 渲染用（也是「有没有改动」的基线）：去掉内联事件属性，
   * 别让文件里的 onerror / onclick 在面板里执行。
   */
  const displayInner = (block: RichBlock) => sanitizeInlineHtml(innerOf(block))

  const run = async (task: () => Promise<void>, title: string) => {
    if (saving()) return
    setSaving(true)
    try {
      await task()
    } catch (error) {
      showToast({
        variant: "error",
        title,
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSaving(false)
    }
  }

  /** 设计视图：只发改过的那一段，保存的是它的 innerHTML。 */
  const commitBlock = (block: RichBlock, element: HTMLElement) => {
    if (props.readOnly) return
    // 正在拆段时浏览器的临时 DOM 结构不合法，先别把它当成用户改动存上去。
    if (splitting()) return
    const inner = element.innerHTML
    const original = displayInner(block)
    if (inner === original) return
    if (!props.onSaveBlock) {
      element.innerHTML = original
      showToast({ variant: "error", title: "无法保存", description: "这个预览没有写回通道。" })
      return
    }
    void run(async () => {
      await props.onSaveBlock!(block.index, inner)
      // 本地也同步一份，等待上层重读期间不会看到旧内容。
      const updated = html().slice(0, block.textStart) + inner + html().slice(block.textEnd)
      setHtml(updated)
    }, "保存失败")
  }

  const switchMode = (next: "design" | "source") => {
    if (next === "source") {
      setSource(html())
      // 新挂载的着色层要重新算，期间先按普通文本显示。
      setSourceHighlightSynced(false)
      setSourceSelection(0)
      setSourceScroll({ top: 0, left: 0 })
    }
    setActive(undefined)
    setMode(next)
    props.onModeChange?.(next)
  }

  // 顶部文件头的视图菜单和富文本内部 Ribbon 共用同一个模式。
  createEffect(() => {
    const next = props.mode
    if (next !== undefined && next !== mode()) switchMode(next)
  })

  const saveSource = () => {
    const value = source()
    if (value === html()) return
    if (!props.onSaveSource && !props.onSaveOps) return
    void run(async () => {
      if (props.onSaveSource) await props.onSaveSource(value)
      else await props.onSaveOps!([{ op: "setText", text: value }])
      setHtml(value)
      showToast({ title: "已保存", description: "整篇 HTML 已写回，编码与换行符保持不变。" })
    }, "保存失败")
  }

  const applyBlockOp = (op: RichOp) => {
    if (!props.onSaveOps) return
    void run(async () => {
      await props.onSaveOps!([op])
    }, "保存失败")
  }

  /**
   * 回车拆段：把当前块从光标处切成两块，走 setBlockHtml + insertBlock 两个 op，
   * 和其它编辑共用同一条写盘路径。Shift+Enter 仍然交给浏览器插入 <br>。
   */
  const splitAtCaret = (block: RichBlock, element: HTMLElement) => {
    if (!props.onSaveOps || saving()) return
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return
    const range = selection.getRangeAt(0)
    if (!element.contains(range.startContainer)) return

    const before = document.createRange()
    before.selectNodeContents(element)
    before.setEnd(range.startContainer, range.startOffset)
    const after = document.createRange()
    after.selectNodeContents(element)
    after.setStart(range.endContainer, range.endOffset)

    const toHtml = (fragment: DocumentFragment) => {
      const holder = document.createElement("div")
      holder.appendChild(fragment)
      return holder.innerHTML
    }
    const left = toHtml(before.cloneContents())
    const right = toHtml(after.cloneContents())

    setSplitting(true)
    setActive(undefined)
    void run(async () => {
      await props.onSaveOps!([
        { op: "setBlockHtml", block: block.index, html: left },
        { op: "insertBlock", after: block.index, html: right },
      ])
    }, "拆分段落失败").finally(() => setSplitting(false))
  }

  const handleBlockKeyDown = (block: RichBlock, event: KeyboardEvent & { currentTarget: HTMLElement }) => {
    if (props.readOnly) return
    if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey) return
    // 列表项和普通段落都能拆；拆出来的新块类型保持一致，和编辑器直觉一致。
    event.preventDefault()
    splitAtCaret(block, event.currentTarget as HTMLElement)
  }

  /** 选区在块纯文本里的偏移；返回 undefined 表示没有选中文字。 */
  const selectionOffsets = (element: HTMLElement): { start: number; end: number } | undefined => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return undefined
    const range = selection.getRangeAt(0)
    if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return undefined
    const offsetOf = (node: Node, offset: number) => {
      const probe = document.createRange()
      probe.selectNodeContents(element)
      probe.setEnd(node, offset)
      return probe.toString().length
    }
    const start = offsetOf(range.startContainer, range.startOffset)
    const end = offsetOf(range.endContainer, range.endOffset)
    return { start: Math.min(start, end), end: Math.max(start, end) }
  }

  /**
   * 改字号：走 formatRange 而不是 execCommand("fontSize")。
   * 后者会写出 <font size="7">，模型的允许列表里没有 font，保存时这整段会变成只读。
   */
  const applyFontSize = (size: number) => {
    const block = activeBlock()
    const element = focusedElement
    if (!block || !element) return
    const span = selectionOffsets(element)
    // 没有选中文字时改整段：和 Word 里「不选就改这一段」的直觉一致。
    const range = span && span.start !== span.end ? span : { start: 0, end: block.text.length }
    if (range.end <= range.start) return
    setActive(undefined)
    applyBlockOp({
      op: "formatRange",
      block: block.index,
      start: range.start,
      end: range.end,
      patch: { size },
    })
  }

  /**
   * 加 / 去链接：走 formatRange 的 link 补丁。
   *
   * 不用 execCommand("createLink")：它会写出 `<a>` 但拿不到我们自己的模型，
   * 而且危险协议要靠引擎的白名单拦住 —— 统一从 op 走，UI 和 AI 的写法就一致了。
   */
  const applyLink = (value: string) => {
    const block = activeBlock()
    if (!block) return
    const span = focusedElement ? selectionOffsets(focusedElement) : undefined
    const range = span && span.start !== span.end ? span : { start: 0, end: block.text.length }
    if (range.end <= range.start) return
    setActive(undefined)
    applyBlockOp({ op: "formatRange", block: block.index, start: range.start, end: range.end, patch: { link: value } })
  }

  /**
   * 清除格式：走 formatRange 的 clear 补丁，只清字体层面的东西（链接保留），
   * 和 Word / 大多数编辑器一致。不用 execCommand("removeFormat")——
   * 它清不干净 span 上的颜色和字号，留下来的样式下次保存又会被规范化。
   */
  const clearFormatting = () => {
    const block = activeBlock()
    if (!block) return
    const span = focusedElement ? selectionOffsets(focusedElement) : undefined
    const range = span && span.start !== span.end ? span : { start: 0, end: block.text.length }
    if (range.end <= range.start) return
    setActive(undefined)
    applyBlockOp({
      op: "formatRange",
      block: block.index,
      start: range.start,
      end: range.end,
      patch: { clear: true },
    })
  }

  // ---- 源码视图的查找 / 替换 ----
  // 和文本编辑器的查找共用 core 的纯函数（同一份匹配语义），
  // 这里只负责把命中区间选中，替换后仍然靠「保存」走整篇写回。
  const [findOpen, setFindOpen] = createSignal(false)
  const [findQuery, setFindQuery] = createSignal("")
  const [findReplacement, setFindReplacement] = createSignal("")
  const [findCaseSensitive, setFindCaseSensitive] = createSignal(false)
  const [findIndex, setFindIndex] = createSignal(0)

  const findOptions = (): SearchOptions => ({ caseSensitive: findCaseSensitive() })
  const findMatches = createMemo(() => {
    const query = findQuery()
    if (!query) return []
    try {
      return searchMatches(source(), query, findOptions())
    } catch {
      return []
    }
  })
  const focusMatch = (index: number) => {
    const matches = findMatches()
    if (matches.length === 0 || !sourceArea) return
    const target = matches[((index % matches.length) + matches.length) % matches.length]
    setFindIndex(matches.indexOf(target))
    sourceArea.focus()
    sourceArea.setSelectionRange(target.start, target.end)
    setSourceSelection(target.end - target.start)
    // 让命中的那一行尽量落在可视区中间（textarea 没有 scrollIntoView）。
    const line = source().slice(0, target.start).split(String.fromCharCode(10)).length
    const lineHeight = 24
    sourceArea.scrollTop = Math.max(0, (line - 3) * lineHeight)
  }

  const findStep = (delta: number) => focusMatch(findIndex() + delta)

  const replaceCurrent = () => {
    const matches = findMatches()
    const target = matches[Math.min(findIndex(), matches.length - 1)]
    if (!target) return
    const next = replaceMatch(source(), target, findReplacement())
    setSource(next)
    requestAnimationFrame(() => focusMatch(findIndex()))
  }

  const replaceEvery = () => {
    const query = findQuery()
    if (!query) return
    const result = replaceAll(source(), query, findReplacement(), findOptions())
    if (result.count === 0) return
    setSource(result.text)
    setFindIndex(0)
    showToast({ variant: "success", title: `已替换 ${result.count} 处` })
  }

  const openFind = () => {
    setFindOpen(true)
    requestAnimationFrame(() => {
      if (sourceArea) {
        const selected = sourceArea.value.slice(sourceArea.selectionStart, sourceArea.selectionEnd)
        if (selected.length > 0 && selected.length <= 100) setFindQuery(selected)
      }
    })
  }

  // 头部按「查找」：先切到源码视图（查找条挂在那里），再开条。
  createEffect(
    on(
      () => props.findRequest?.() ?? 0,
      () => {
        if (mode() !== "source") switchMode("source")
        openFind()
      },
      { defer: true },
    ),
  )

  /** 图片大小上限：data URI 会直接写进 HTML，太大就不是「文本文件」了。 */
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024

  /**
   * 插入图片：读成 data URI 直接写进这一段（文件保持自包含，换台机器也能看）。
   * 只支持本地图片，不抓网络地址。
   */
  const insertImage = (file: File) => {
    const block = activeBlock()
    if (!block || !props.onSaveBlock || saving()) return
    if (file.size > MAX_IMAGE_BYTES) {
      showToast({ variant: "error", title: "图片太大", description: "单个图片请控制在 5 MB 以内。" })
      return
    }
    void run(async () => {
      const data = await readAsDataUrl(file)
      const tag = '<img src="' + data + '" alt="' + file.name.replace(/"/g, "") + '">'
      const inner = displayInner(block) + tag
      await props.onSaveBlock!(block.index, inner)
      setHtml(html().slice(0, block.textStart) + inner + html().slice(block.textEnd))
      showToast({ variant: "success", title: "图片已插入这一段" })
    }, "插入图片失败")
  }

  const exec = (command: string, value?: string) => {
    // execCommand 处理「选区上的行内格式」，是浏览器里最贴近 contenteditable
    // 语义的实现；保存时再由 setBlockHtml 统一规范成 strong/em/u/s/span。
    document.execCommand(command, false, value)
  }

  /**
   * 粘贴：先把剪贴板内容归一成编辑器支持的行内 HTML，再插到光标处。
   * 「保留行内样式、丢掉脚本」——
   * 不归一化的话，从网页 / Word 粘进来的结构会让保存整体失败。
   */
  const handlePaste = (event: ClipboardEvent & { currentTarget: HTMLElement }) => {
    const data = event.clipboardData
    if (!data) return
    const html = data.getData("text/html")
    const text = data.getData("text/plain")
    if (html.length === 0 && text.length === 0) return
    event.preventDefault()
    const clean = (html.length > 0 ? sanitizePastedHtml(html) : "") || pastedTextToHtml(text)
    if (clean.length === 0) return
    // insertHTML 在 Chromium 里可用；万一失败就退回纯文本，至少不丢内容。
    if (!document.execCommand("insertHTML", false, clean)) document.execCommand("insertText", false, text)
  }

  /** 检查器抽屉：段落 / 字符 / 插入这些带值控件收在这里，工具条只留视图与 B/I/U。 */
  const inspectorPanel = () => (
    <Show when={mode() === "design" ? activeBlock() : undefined}>
      {(block) => (
        <PaneInspector title="段落格式" onClose={() => setInspector(false)}>
          <InspectorSection label="段落">
            {/* 对齐：四个互斥按钮压成一个下拉，选中态由 RibbonChoice 的 ✓ 表示。 */}
            <RibbonChoice
              id="rich-align"
              label="对齐"
              display={`对齐 · ${ALIGN_CHOICES.find((choice) => choice.id === block().align)?.label ?? "默认"}`}
              value={block().align}
              disabled={saving()}
              options={ALIGN_CHOICES}
              onSelect={(align) => applyBlockOp({ op: "setBlockAlign", block: block().index, align })}
            />
            {/* 列表：包成 ul/ol、换类型、再选同一项就取消。
                      走 setBlockList，和 Agent 调的是同一条 op。 */}
            <RibbonChoice
              id="rich-list"
              label="列表"
              title="项目符号 / 编号"
              value={block().list ?? "none"}
              disabled={saving()}
              options={
                [
                  { id: "none", label: "无列表" },
                  { id: "ul", label: "•", title: "无序列表（再点取消）" },
                  { id: "ol", label: "1.", title: "有序列表（再点取消）" },
                ] as const
              }
              onSelect={(kind) =>
                applyBlockOp({
                  op: "setBlockList",
                  block: block().index,
                  kind: kind === "none" || block().list === kind ? "none" : kind,
                })
              }
            />
            {/* 行高 / 缩进和 Align 一样走 setBlockLineHeight / setBlockIndent，
                  改的是块级 style，正文行内格式不受影响。 */}
            <label class="flex items-center gap-1 text-11-regular text-foreground-subtlest" title="行高（倍数）">
              行高
              <select
                class="h-6 rounded border border-border bg-background px-1 text-11-regular text-foreground outline-none"
                value={block().lineHeight ?? ""}
                disabled={saving()}
                onChange={(event) => {
                  const value = Number(event.currentTarget.value)
                  if (!Number.isFinite(value) || value <= 0) return
                  applyBlockOp({ op: "setBlockLineHeight", block: block().index, value })
                }}
              >
                <option value="">默认</option>
                <For each={LINE_HEIGHT_CHOICES}>{(value) => <option value={value}>{value}</option>}</For>
                <Show
                  when={
                    block().lineHeight !== undefined &&
                    !(LINE_HEIGHT_CHOICES as readonly number[]).includes(block().lineHeight!)
                  }
                >
                  <option value={block().lineHeight}>{block().lineHeight}</option>
                </Show>
              </select>
            </label>
            <button
              type="button"
              data-action="rich-indent-out"
              title="减少缩进"
              class="grid size-6 place-items-center rounded border border-transparent text-11-medium text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground disabled:opacity-40"
              disabled={saving() || (block().indent ?? 0) <= 0}
              onClick={() =>
                applyBlockOp({
                  op: "setBlockIndent",
                  block: block().index,
                  value: Math.max(0, (block().indent ?? 0) - INDENT_STEP),
                })
              }
            >
              ⇤
            </button>
            <button
              type="button"
              data-action="rich-indent-in"
              title="增加缩进"
              class="grid size-6 place-items-center rounded border border-transparent text-11-medium text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground disabled:opacity-40"
              disabled={saving() || (block().indent ?? 0) >= INDENT_LIMIT}
              onClick={() =>
                applyBlockOp({
                  op: "setBlockIndent",
                  block: block().index,
                  value: Math.min(INDENT_LIMIT, (block().indent ?? 0) + INDENT_STEP),
                })
              }
            >
              ⇥
            </button>
            {/* 首行缩进：中文排版最常用的一项，和左缩进分开。 */}
            <label class="flex items-center gap-1 text-11-regular text-foreground-subtlest" title="首行缩进">
              首行
              <select
                data-action="rich-first-line-indent"
                class="h-6 rounded border border-border bg-background px-1 text-11-regular text-foreground outline-none"
                value={String(block().firstLineIndent ?? 0)}
                disabled={saving()}
                onChange={(event) => {
                  const value = Number(event.currentTarget.value)
                  if (!Number.isFinite(value)) return
                  applyBlockOp({ op: "setBlockFirstLineIndent", block: block().index, value })
                }}
              >
                <option value="0">无</option>
                <option value="32">2 字</option>
                <option value="48">3 字</option>
                <option value="64">4 字</option>
                <Show
                  when={block().firstLineIndent !== undefined && ![0, 32, 48, 64].includes(block().firstLineIndent!)}
                >
                  <option value={block().firstLineIndent}>{block().firstLineIndent}px</option>
                </Show>
              </select>
            </label>
            <button
              type="button"
              data-action="rich-insert-block"
              title="在这一段下方插入一段"
              class="rounded px-1.5 py-0.5 text-11-regular text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground disabled:opacity-40"
              disabled={saving()}
              onClick={() => applyBlockOp({ op: "insertBlock", after: block().index })}
            >
              插入段落
            </button>
            <button
              type="button"
              data-action="rich-delete-block"
              title="删除这一段"
              class="rounded px-1.5 py-0.5 text-11-regular text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground disabled:opacity-40"
              disabled={saving()}
              onClick={() => {
                setActive(undefined)
                applyBlockOp({ op: "deleteBlock", block: block().index })
              }}
            >
              删除
            </button>
          </InspectorSection>
          <InspectorSection label="字符">
            <button
              type="button"
              title="删除线"
              class="grid size-6 place-items-center rounded border border-transparent text-11-medium text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground disabled:opacity-40"
              disabled={saving()}
              onMouseDown={(event) => {
                event.preventDefault()
                exec("strikeThrough")
              }}
            >
              S
            </button>
            {/* 清除格式：只清字体层面（粗体/颜色/字号），链接保留（对齐 Word）。 */}
            <button
              type="button"
              data-action="rich-clear-format"
              title="清除格式（保留链接）"
              class="rounded px-1.5 py-0.5 text-11-regular text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground disabled:opacity-40"
              disabled={saving()}
              onMouseDown={(event) => {
                // 保住 contenteditable 里的选区，按钮点击不能把焦点抢走。
                event.preventDefault()
                clearFormatting()
              }}
            >
              清除格式
            </button>
            <label
              class="flex items-center gap-1 text-11-regular text-foreground-subtlest"
              title="字号（px）：选中文字后应用，不选则改整段"
            >
              字号
              <select
                data-action="rich-font-size"
                class="h-6 rounded border border-border bg-background px-1 text-11-regular text-foreground outline-none"
                value=""
                disabled={saving()}
                onChange={(event) => {
                  const size = Number(event.currentTarget.value)
                  event.currentTarget.value = ""
                  if (Number.isFinite(size) && size > 0) applyFontSize(size)
                }}
              >
                <option value="">默认</option>
                <For each={SIZE_CHOICES}>{(size) => <option value={size}>{size}</option>}</For>
              </select>
            </label>
            <input
              data-action="rich-link"
              class="h-6 w-28 rounded border border-border bg-background px-1 text-11-regular text-foreground outline-none placeholder:text-foreground-subtlest"
              placeholder="链接，回车应用"
              spellcheck={false}
              disabled={saving()}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return
                event.preventDefault()
                const input = event.currentTarget
                const value = input.value.trim()
                // 空输入 = 去掉选中的链接，和 Word 的「插入超链接 → 删除链接」等价。
                applyLink(value)
                input.value = ""
              }}
            />
            <label class="flex items-center gap-1 text-11-regular text-foreground-subtlest" title="文字颜色">
              字
              <input
                type="color"
                class="size-5 cursor-pointer rounded border border-border bg-transparent p-0"
                onChange={(event) => exec("foreColor", event.currentTarget.value)}
              />
            </label>
            <label class="flex items-center gap-1 text-11-regular text-foreground-subtlest" title="高亮颜色">
              亮
              <input
                type="color"
                class="size-5 cursor-pointer rounded border border-border bg-transparent p-0"
                onChange={(event) => exec("hiliteColor", event.currentTarget.value)}
              />
            </label>
          </InspectorSection>
          <InspectorSection label="插入">
            <button
              type="button"
              data-action="rich-insert-image"
              title="在这一段末尾插入本地图片（内嵌为 data URI）"
              class="rounded px-1.5 py-0.5 text-11-regular text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground disabled:opacity-40"
              disabled={saving()}
              onClick={() => imageInput?.click()}
            >
              图片
            </button>
          </InspectorSection>
        </PaneInspector>
      )}
    </Show>
  )

  return (
    <div class="relative flex h-full min-h-0 flex-col bg-background">
      <Show when={mode() === "design"}>
        <RibbonRow>
          <RibbonChoice
            id="rich-mode"
            label="视图"
            title="设计 / 源码"
            display={mode() === "design" ? "设计" : "源码"}
            value={mode()}
            onSelect={switchMode}
            options={
              [
                { id: "design", label: "设计" },
                { id: "source", label: "源码" },
              ] as const
            }
          />

          <Show when={!props.readOnly}>
            <Show when={mode() === "design"}>
              <RibbonChoice
                id="rich-canvas"
                label="画布"
                title="画布宽度：手机（公众号版心）/ 桌面（铺满面板）"
                display={canvas() === "phone" ? "手机" : "桌面"}
                value={canvas()}
                onSelect={(next) => setCanvas(next)}
                options={
                  [
                    { id: "phone", label: "手机" },
                    { id: "desktop", label: "桌面" },
                  ] as const
                }
              />
            </Show>

            <Show when={mode() === "design" ? activeBlock() : undefined}>
              {(block) => (
                <>
                  <select
                    class="h-6 rounded border border-border bg-background px-1 text-11-regular text-foreground outline-none"
                    value={block().tag}
                    disabled={saving()}
                    onChange={(event) =>
                      applyBlockOp({ op: "setBlockType", block: block().index, tag: event.currentTarget.value })
                    }
                  >
                    <For each={BLOCK_CHOICES}>{(choice) => <option value={choice.tag}>{choice.label}</option>}</For>
                    <Show when={!BLOCK_CHOICES.some((choice) => choice.tag === block().tag)}>
                      <option value={block().tag}>{block().tag}</option>
                    </Show>
                  </select>
                  <For
                    each={
                      [
                        { label: "B", title: "加粗", command: "bold" },
                        { label: "I", title: "斜体", command: "italic" },
                        { label: "U", title: "下划线", command: "underline" },
                      ] as const
                    }
                  >
                    {(item) => (
                      <button
                        type="button"
                        title={item.title}
                        class="grid size-6 place-items-center rounded border border-transparent text-11-medium text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground disabled:opacity-40"
                        disabled={saving()}
                        onMouseDown={(event) => {
                          event.preventDefault()
                          exec(item.command)
                        }}
                      >
                        {item.label}
                      </button>
                    )}
                  </For>
                  <InspectorToggle
                    open={inspector()}
                    onToggle={() => setInspector(!inspector())}
                    title="打开检查器：段落 / 字符 / 插入"
                  />
                </>
              )}
            </Show>
          </Show>

          <span class="ml-auto shrink-0 text-11-regular text-foreground-subtlest">
            {props.readOnly
              ? mode() === "design"
                ? "阅读模式"
                : "只读源码"
              : mode() === "design"
                ? saving()
                  ? "保存中…"
                  : "点段落编辑，失焦自动保存"
                : "⌘/Ctrl+S 保存整篇"}
          </span>
        </RibbonRow>
      </Show>

      <Show when={mode() === "design"}>
        <input
          ref={(el) => {
            imageInput = el
          }}
          type="file"
          accept="image/*"
          class="hidden"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ""
            if (file) insertImage(file)
          }}
        />
        <div
          ref={(el) => {
            designScroll = el
            restoreScroll()
          }}
          class="min-h-0 flex-1 overflow-auto px-6 py-5"
          onScroll={() => rememberScrollNow()}
        >
          {/* 设计视图里链接不该被点走：点一下只放光标，改文字由本组件负责。 */}
          <div
            class="mx-auto w-full space-y-2 text-14-regular leading-relaxed text-foreground"
            classList={{ "max-w-[677px]": canvas() === "phone", "max-w-3xl": canvas() === "desktop" }}
            onClick={(event) => {
              if ((event.target as HTMLElement).closest?.("a")) event.preventDefault()
            }}
          >
            <For each={items()}>
              {(item) =>
                item.kind === "list" ? (
                  <Dynamic
                    component={item.group.list}
                    class={item.group.list === "ol" ? "list-decimal pl-6" : "list-disc pl-6"}
                  >
                    <For each={item.group.items}>
                      {(block) => (
                        <li
                          class="outline-offset-2"
                          style={blockStyle(block)}
                          contentEditable={(!props.readOnly && block.editable) || undefined}
                          onKeyDown={(event) => handleBlockKeyDown(block, event)}
                          onPaste={handlePaste}
                          onFocus={(event) => {
                            focusedElement = event.currentTarget
                            setActive(block.index)
                          }}
                          onBlur={(event) => commitBlock(block, event.currentTarget)}
                          title={block.editable ? undefined : block.reason}
                          innerHTML={block.editable ? displayInner(block) : undefined}
                        >
                          {block.editable ? undefined : block.text}
                        </li>
                      )}
                    </For>
                  </Dynamic>
                ) : (
                  <Dynamic
                    component={item.block.tag}
                    class="outline-offset-2"
                    style={blockStyle(item.block)}
                    classList={{ "opacity-60": !item.block.editable }}
                    contentEditable={(!props.readOnly && item.block.editable) || undefined}
                    onKeyDown={(event: KeyboardEvent & { currentTarget: HTMLElement }) =>
                      handleBlockKeyDown(item.block, event)
                    }
                    onPaste={handlePaste}
                    onFocus={(event: FocusEvent & { currentTarget: HTMLElement }) => {
                      focusedElement = event.currentTarget
                      setActive(item.block.index)
                    }}
                    onBlur={(event: FocusEvent & { currentTarget: HTMLElement }) =>
                      commitBlock(item.block, event.currentTarget)
                    }
                    title={item.block.editable ? undefined : (item.block.reason ?? "这一段暂不支持编辑")}
                    // 不可编辑的块只显示纯文字：表格/脚本/自定义元素不经过 innerHTML，
                    // 免得把文件里的脚本或事件属性带进渲染进程。
                    innerHTML={item.block.editable ? displayInner(item.block) : undefined}
                  >
                    {item.block.editable ? undefined : item.block.text}
                  </Dynamic>
                )
              }
            </For>
          </div>
        </div>
      </Show>

      <Show when={mode() === "source"}>
        <div class="flex min-h-0 flex-1 flex-col">
          <div class="flex items-center gap-2 border-b border-border px-3 py-1.5">
            <span class="min-w-0 flex-1 truncate text-11-regular text-foreground-subtlest">
              这是文件的真实内容；设计视图和它永远一致
            </span>
            <Show when={!props.readOnly}>
              <button
                type="button"
                data-action="rich-source-save"
                class="rounded-lg border border-border bg-background px-3 py-1 text-12-medium text-foreground transition-colors hover:bg-hover disabled:opacity-50"
                disabled={saving() || source() === html()}
                onClick={saveSource}
              >
                {saving() ? "保存中…" : "保存"}
              </button>
            </Show>
          </div>
          <Show when={findOpen()}>
            <RibbonRow>
              <input
                type="text"
                data-action="rich-source-find-query"
                placeholder="查找"
                class="h-6 w-44 rounded border border-border bg-background px-1.5 text-11-regular text-foreground outline-none focus:border-border-hover"
                value={findQuery()}
                onInput={(event) => {
                  setFindQuery(event.currentTarget.value)
                  setFindIndex(0)
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault()
                    findStep(event.shiftKey ? -1 : 1)
                  }
                  if (event.key === "Escape") {
                    event.preventDefault()
                    setFindOpen(false)
                  }
                }}
              />
              <span class="min-w-12 text-11-regular text-foreground-subtlest">
                {findQuery()
                  ? findMatches().length === 0
                    ? "无结果"
                    : `${findIndex() + 1}/${findMatches().length}`
                  : ""}
              </span>
              <button
                type="button"
                data-action="rich-source-find-prev"
                class="rounded px-1.5 py-0.5 text-11-regular text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground disabled:opacity-40"
                disabled={findMatches().length === 0}
                onClick={() => findStep(-1)}
              >
                上一个
              </button>
              <button
                type="button"
                data-action="rich-source-find-next"
                class="rounded px-1.5 py-0.5 text-11-regular text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground disabled:opacity-40"
                disabled={findMatches().length === 0}
                onClick={() => findStep(1)}
              >
                下一个
              </button>
              <button
                type="button"
                data-action="rich-source-find-case"
                title="区分大小写"
                class={[
                  "rounded border px-1.5 py-0.5 text-11-medium transition-colors",
                  findCaseSensitive()
                    ? "border-border bg-hover text-foreground"
                    : "border-transparent text-foreground-subtlest hover:bg-hover hover:text-foreground",
                ].join(" ")}
                onClick={() => setFindCaseSensitive(!findCaseSensitive())}
              >
                Aa
              </button>
              <Show when={!props.readOnly}>
                <input
                  type="text"
                  data-action="rich-source-find-replacement"
                  placeholder="替换为"
                  class="h-6 w-40 rounded border border-border bg-background px-1.5 text-11-regular text-foreground outline-none focus:border-border-hover"
                  value={findReplacement()}
                  onInput={(event) => setFindReplacement(event.currentTarget.value)}
                />
                <button
                  type="button"
                  data-action="rich-source-replace"
                  class="rounded px-1.5 py-0.5 text-11-regular text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground disabled:opacity-40"
                  disabled={findMatches().length === 0}
                  onClick={replaceCurrent}
                >
                  替换
                </button>
                <button
                  type="button"
                  data-action="rich-source-replace-all"
                  class="rounded px-1.5 py-0.5 text-11-regular text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground disabled:opacity-40"
                  disabled={findMatches().length === 0}
                  onClick={replaceEvery}
                >
                  全部替换
                </button>
              </Show>
            </RibbonRow>
          </Show>
          {/* 行号 + 着色层 + 透明 textarea：和文本预览的代码编辑器同一套结构。 */}
          <div class="flex min-h-0 flex-1 overflow-hidden" style={{ zoom: String(fontZoom() / 100) }}>
            <div
              ref={(el) => {
                sourceGutter = el
              }}
              data-action="rich-source-gutter"
              class="w-10 shrink-0 overflow-hidden bg-background py-4 pr-2 text-right font-mono text-13 leading-6 text-foreground-subtle select-none"
              style={{ "line-height": "24px" }}
            >
              <For each={sourceLineNumbers()}>
                {(line) => (
                  <div class="h-6" style={{ height: "24px", "line-height": "24px" }}>
                    {line}
                  </div>
                )}
              </For>
            </div>
            <div class="relative min-w-0 flex-1 bg-background">
              <CodeHighlight
                text={source()}
                path={props.path}
                scrollTop={sourceScroll().top}
                scrollLeft={sourceScroll().left}
                onSync={setSourceHighlightSynced}
              />
              <textarea
                ref={(el) => {
                  sourceArea = el
                }}
                data-action="rich-source-textarea"
                class="relative h-full w-full resize-none py-4 pr-4 font-mono text-13 leading-6 outline-none"
                classList={{
                  "overflow-x-auto": true,
                  "bg-transparent text-transparent": sourceHighlightOn(),
                  "bg-background text-foreground": !sourceHighlightOn(),
                }}
                style={{ "line-height": "24px", "caret-color": "var(--foreground)" }}
                spellcheck={false}
                wrap="off"
                readOnly={props.readOnly}
                value={source()}
                onScroll={(event) => {
                  const position = {
                    top: event.currentTarget.scrollTop,
                    left: event.currentTarget.scrollLeft,
                  }
                  if (sourceGutter) sourceGutter.scrollTop = position.top
                  setSourceScroll(position)
                }}
                onSelect={(event) =>
                  setSourceSelection(event.currentTarget.selectionEnd - event.currentTarget.selectionStart)
                }
                onInput={(event) => {
                  setSource(event.currentTarget.value)
                  setSourceSelection(0)
                }}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
                    event.preventDefault()
                    if (!props.readOnly) saveSource()
                    return
                  }
                  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
                    event.preventDefault()
                    openFind()
                    return
                  }
                  if (event.key === "Escape" && findOpen()) {
                    event.preventDefault()
                    setFindOpen(false)
                  }
                }}
              />
            </div>
          </div>
        </div>
      </Show>
      <Show when={inspector()}>{inspectorPanel()}</Show>
      <PaneStatusBar
        info={<span class="truncate">{mode() === "source" ? `${sourceLineNumbers().length} 行` : "设计视图"}</span>}
        zoom={{
          value: () => fontZoom(),
          onStep: (zoomIn) => setFontZoom((x) => Math.max(50, Math.min(200, x + (zoomIn ? 10 : -10)))),
          onReset: () => setFontZoom(100),
        }}
      />
    </div>
  )
}
