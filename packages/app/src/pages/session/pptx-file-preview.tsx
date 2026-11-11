import {
  buildPresentation,
  materializeSlideNodes,
  parseZipLazyMedia,
  RECOMMENDED_ZIP_LIMITS,
  renderSlide,
  type PresentationData,
  type SlideHandle,
  type SlideNode,
  type SlideRendererOptions,
  type TextBody,
} from "@aiden0z/pptx-renderer/browser"
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  on,
  onCleanup,
  Show,
  type Component,
} from "solid-js"
import { Icon } from "@novaway/ui/icon"
import { Spinner } from "@novaway/ui/spinner"
import { showToast } from "@novaway/ui/toast"
import { useLanguage } from "@/context/language"
import { usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import {
  elementCommentItem,
  hitTestNodes,
  slideElementDetail,
  slideElementLabel,
  type SlideElementAnchor,
} from "@/utils/element-comment"
import { base64ToBytes } from "@/pages/session/office-file-preview"
import { rememberZoom, zoomOf } from "@/pages/session/editor-memory"
import { PREVIEW_ACTIVE_CLASS, RIBBON_BUTTON, RibbonRow, useOfficeRibbonTabs } from "@/pages/session/office-ribbon"
import {
  InspectorField,
  InspectorSection,
  InspectorToggle,
  INSPECTOR_INPUT,
  PaneInspector,
} from "@/pages/session/pane-inspector"
import { PaneStatusBar } from "@/pages/session/pane-status-bar"
import { PptxFormatBar, PptxShapeFrame, PptxTextEditor } from "@/pages/session/pptx-canvas-editor"
import {
  childIdentity,
  clearGroupChildText,
  EMU_PER_POINT,
  hitInGroup,
  restoreGroupChildText,
} from "@/pages/session/pptx-group-hit"
import { type PptxBox, type PptxShapeKind, type PptxTextStyle } from "@novaway/core/office/pptx-edit"
import { pptxEngine, type PptxNodePt, type PptxState } from "@novaway/core/office/engine/pptx"
import { pptxApplyOverrides, pptxShapeKey, type PptxTextOverride } from "@/pages/session/pptx-text-override"

type PptxDoc = PresentationData

/** 原地编辑的请求体：文字/格式、几何、图片三类，可以一次只发其中一类。 */
type EditPayload = {
  edits?: Array<{
    slide: number
    shapeId?: string
    shapeName?: string
    paragraph?: number
    text?: string
    style?: PptxTextStyle
    cell?: { row: number; col: number }
  }>
  shapes?: Array<{ slide: number; shapeId?: string; shapeName?: string; box?: PptxBox; rotation?: number }>
  images?: Array<{ slide: number; shapeId?: string; shapeName?: string; dataBase64: string; mime: string }>
  structure?: Array<
    | { op: "addTextBox"; slide: number; text: string; box?: PptxBox; style?: PptxTextStyle }
    | {
        op: "addShape"
        slide: number
        kind: PptxShapeKind
        box?: PptxBox
        fill?: string
        line?: string
        text?: string
        style?: PptxTextStyle
      }
    | { op: "addPicture"; slide: number; dataBase64: string; mime: string; box?: PptxBox }
    | { op: "deleteShape"; slide: number; shapeId?: string; shapeName?: string }
  >
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ""
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

async function openPptx(base64: string): Promise<PptxDoc> {
  const buffer = base64ToBytes(base64).buffer as ArrayBuffer
  const files = await parseZipLazyMedia(buffer, RECOMMENDED_ZIP_LIMITS)
  return buildPresentation(files, { lazySlides: true })
}

/**
 * PPT 真实渲染(@aiden0z/pptx-renderer):
 * 左侧缩略图栏(懒渲染)+ 右侧单页主视图 + 底部翻页/缩放条。
 * 主视图与缩略图共享 mediaUrlCache,内嵌图片的 blob URL 只解析一次。
 *
 * 传了 `path`（工作区相对路径）才有「选取元素 + 评论」：点中某一页上的形状/图片/表格，
 * 写一句要改什么，作为文件上下文挂到输入框上方，发送后由 AI 落回这一页。
 */
export type PptxSlideOp =
  | { op: "deleteSlide"; slide: number }
  | { op: "moveSlide"; from: number; to: number }
  | { op: "duplicateSlide"; slide: number }
  | { op: "addSlide"; after?: number; layout?: string }

export const PptxFilePreview: Component<{
  base64: string
  path?: string
  /** 阅读模式只显示幻灯片；双击画布会先请求切到编辑。 */
  editing?: boolean
  onRequestEdit?: () => void
  onEdited?: () => void
  /**
   * 本地纯文字改动：渲染层已就地反映，宿主只刷新撤销历史、不重读整篇（消除编辑闪烁）。
   * 几何 / 结构 / 图片类改动仍走 `onEdited`（需要新字节才能反映）。
   */
  onLocalEdit?: () => void
  /** 删页 / 调顺序；由文件页注入，走和 AI 相同的 office.document.edit。 */
  onSlideOp?: (op: PptxSlideOp) => Promise<void>
  /** PPTX 演讲者备注由宿主提交，统一刷新撤销历史与预览字节。 */
  onSaveSlideNotes?: (slide: number, text: string) => Promise<void>
}> = (props) => {
  const language = useLanguage()
  const prompt = usePrompt()
  const sdk = useSDK()
  const [doc] = createResource(() => props.base64, openPptx)
  // 必须赶在 renderSlideData 之前声明：主视图 effect 的 on() 会在组件体执行期间同步求值
  // renderSlideData()，而它读 presentation()；声明晚了会踩 TDZ（打开 PPT 即崩）。
  const presentation = createMemo(() => (doc.state === "ready" ? doc() : undefined))
  const pageCount = createMemo(() => presentation()?.slides.length ?? 0)
  const [page, setPage] = createSignal(0)
  // zoom=1 表示"适宽";± 按钮在其上乘系数。
  // 缩放跟着文件走：切走再切回来还是上次的倍数（和光标/滚动一样属于标签记忆）。
  const [zoom, setZoom] = createSignal(props.path ? (zoomOf(props.path) ?? 1) : 1)
  createEffect(() => {
    if (props.path) rememberZoom(props.path, zoom())
  })
  const [mainSize, setMainSize] = createSignal({ width: 0, height: 0 })

  // 元素选取：picking 是"准星已举起"，target 是"已经点中、正等着写评论"。
  const [picking, setPicking] = createSignal(false)
  const [target, setTarget] = createSignal<SlideElementAnchor>()
  const [comment, setComment] = createSignal("")
  // 画布内直接改字：paragraphs 与 XML 里的 <a:p> 一一对应，逐段回写。
  const [drafting, setDrafting] = createSignal<string[]>()
  const [saving, setSaving] = createSignal(false)
  // 拖动/缩放时的实时几何：框跟着鼠标走，松手才落盘。
  const [liveBox, setLiveBox] = createSignal<PptxBox>()
  // 撤销栈在宿主：面板头部那一行「撤销 / 重做」是唯一的入口，这里不再自己问状态、
  // 也不再摆第二个撤销按钮（切一次标签历史就没了，AI 改的也接不上）。
  // 切回阅读模式时收起选取和编辑态，界面上不留上一轮编辑的选区框。
  createEffect(
    on(
      () => props.editing,
      (value) => {
        if (value !== false) return
        setPicking(false)
        setTarget(undefined)
        setDrafting(undefined)
      },
    ),
  )

  // XML 侧的真相：真实字号/颜色/对齐、单元格、图片关系都在这里。
  // 渲染器只负责「画」，编辑要改的属性得从原始 XML 读。
  //
  // 这里走的是 office/engine 的 PPTX 适配层，几何单位是 **pt**
  // （16:9 页面 960×540），和渲染器、画布、拖动完全一致；
  // EMU 只在引擎读写 XML 的那一层出现，UI 不需要知道 12700 这个数。
  const [officeDoc] = createResource(
    () => props.base64,
    (value) => pptxEngine.open(base64ToBytes(value)),
  )
  const layoutState = createMemo<PptxState | undefined>(() => {
    const value = officeDoc()
    return value?.ok ? value.data : undefined
  })
  const layout = createMemo(() => layoutState()?.nodes)
  /** 新建页时选的版式名；空串 = 沿用相邻页（引擎的默认行为）。 */
  const [newSlideLayout, setNewSlideLayout] = createSignal("")
  const slideLayouts = createMemo(() => layoutState()?.layouts ?? [])
  const [slideNotes, setSlideNotes] = createSignal("")
  const [notesBusy, setNotesBusy] = createSignal(false)
  const [inspector, setInspector] = createSignal(false)
  const notesForPage = createMemo(() => layoutState()?.slides.find((item) => item.index === page() + 1)?.notes ?? "")
  createEffect(on(notesForPage, setSlideNotes))
  const layoutNode = createMemo<PptxNodePt | undefined>(() => {
    const anchor = target()
    const nodes = layout()
    if (!anchor || !nodes) return undefined
    const sameSlide = nodes.filter((node) => node.slide === anchor.slide)
    // 先按 id 对，对不上再按形状名 —— 渲染器的 id 与 cNvPr@id 通常一致，
    // 但对不上时要能退化到名字，而不是直接失去编辑能力。
    if (anchor.shapeId) {
      const byId = sameSlide.find((node) => node.shapeId === anchor.shapeId)
      if (byId) return byId
    }
    return anchor.name ? sameSlide.find((node) => node.shapeName === anchor.name) : undefined
  })
  const targetBox = createMemo(() => liveBox() ?? layoutNode()?.box ?? target()?.box)
  const targetStyles = createMemo(() => layoutNode()?.styles ?? [])

  // 原地改字的乐观覆盖：保存成功后先写进这里，渲染层与编辑器种子立刻反映新文字，
  // 不再重读整篇字节（消除整屏闪烁）。base64 真正变化（撤销 / 外部写 / 结构改动）时清空，
  // 改用磁盘上的权威文本。
  const [textOverrides, setTextOverrides] = createSignal(new Map<string, PptxTextOverride[]>())
  createEffect(
    on(
      () => props.base64,
      () => setTextOverrides(new Map()),
      { defer: true },
    ),
  )
  const nodeOverrides = createMemo(
    () => textOverrides().get(pptxShapeKey(page() + 1, layoutNode()?.shapeId ?? "")) ?? [],
  )
  /** 覆盖只作用于整块段落（无行列定位的那批）；表格格子走 activeCellData 单独补。 */
  const overrideParagraphTexts = (base: string[]) => {
    const shapeLevel = nodeOverrides().filter((item) => item.row === undefined && item.col === undefined)
    if (shapeLevel.length === 0) return base
    const next = [...base]
    for (const item of shapeLevel) next[item.paragraph] = item.text
    return next
  }
  const targetParagraphs = createMemo(() =>
    overrideParagraphTexts(layoutNode()?.paragraphs ?? target()?.paragraphs ?? []),
  )

  /**
   * 改字时把渲染层里这个形状的文字抽掉：编辑浮层是透明的（对齐 PowerPoint 的原地改字），
   * 不抽掉正在敲的字会和渲染出来的旧字叠成两遍。形状底色与边框照旧渲染。
   * 组合里的子形状文字是渲染器懒解析的原始 XML：每次渲染都从 DOM 现读 `<a:p>`，
   * 没有持久 textBody 对象可清空，所以直接改 DOM 并记录原内容，取消编辑时写回。
   */
  const clearedGroupText = new Map<Element, string>()
  const renderSlideData = createMemo(() => {
    const slide = presentation()?.slides[page()]
    if (!slide) return slide
    // 先把乐观覆盖铺到当前页的节点上（未编辑状态下立刻显示新文字）。
    const overrides = textOverrides()
    let nodes = slide.nodes
    let touched = false
    if (overrides.size > 0) {
      const slideNo = page() + 1
      nodes = nodes.map((item) => {
        const list = item.id ? overrides.get(pptxShapeKey(slideNo, item.id)) : undefined
        if (!list) return item
        touched = true
        return pptxApplyOverrides(item, list)
      })
    }
    // 正在编辑的形状：清空它的渲染文字，交给透明编辑浮层（否则会和新敲的字叠成两遍）。
    const node = drafting() ? layoutNode() : undefined
    if (!node) return touched ? { ...slide, nodes } : slide
    const cleared = nodes.map((item) => {
      const match = node.shapeId ? item.id === node.shapeId : item.name === node.shapeName
      // 顶层 shape / 表格：清空内存 textBody（保留底色边框），编辑浮层覆盖上去。
      if (match && item.nodeType === "shape" && item.textBody) {
        touched = true
        return { ...item, textBody: { ...item.textBody, paragraphs: [] } }
      }
      // 组合：编辑目标是组内某个子形状 → 从该组合的子 XML 里清掉匹配子形状的文字。
      if (item.nodeType === "group" && node.parentId && item.id === node.parentId) {
        if (clearGroupChildText(item, node.shapeId, node.shapeName, clearedGroupText)) touched = true
      }
      return item
    })
    return touched ? { ...slide, nodes: cleared } : slide
  })
  // 取消编辑（未保存）时把清掉的子形状文字写回，恢复原文渲染；换页/换文件/保存后
  // base64 变化会重建整个 presentation，旧 DOM 已弃用，这里写回无害。
  createEffect(() => {
    if (!drafting()) restoreGroupChildText(clearedGroupText)
  })
  // 表格：当前点中的单元格（画布上点表格的某个格子 → 编辑框落在那个格子上）。
  const [activeCell, setActiveCell] = createSignal<{ row: number; col: number }>()
  const activeCellData = createMemo(() => {
    const cell = activeCell()
    if (!cell) return undefined
    const found = layoutNode()?.cells?.find((item) => item.row === cell.row && item.col === cell.col)
    if (!found) return undefined
    const cellList = nodeOverrides().filter((item) => item.row === cell.row && item.col === cell.col)
    if (cellList.length === 0) return found
    const paragraphs = [...found.paragraphs]
    for (const item of cellList) paragraphs[item.paragraph] = item.text
    return { ...found, paragraphs }
  })
  // 点中单元格后，选中框/改字框都落在格子上而不是整个表格。
  const activeBox = createMemo(() => liveBox() ?? activeCellData()?.box ?? targetBox())

  let mainMount: HTMLDivElement | undefined
  // ref 走 signal:主视图容器在 <Show> 内挂载,普通变量在 effect 里读不到挂载时机。
  const [mainViewport, setMainViewport] = createSignal<HTMLDivElement>()

  // 主视图与缩略图共用的渲染选项:媒体 blob URL 全局复用。
  const mediaUrlCache = new Map<string, string>()
  const rendererOptions = (): SlideRendererOptions => ({
    mediaUrlCache,
    externalMedia: "block",
  })

  /** 页面操作：删页后停在原来的位置，调顺序后光标跟着这一页走。 */
  const [slideBusy, setSlideBusy] = createSignal(false)
  /** 复制页后要选中的新页（0 起）；等重新加载出新页数再跳，否则会被夹回原页。 */
  const [pendingPage, setPendingPage] = createSignal<number | null>(null)
  createEffect(() => {
    const pending = pendingPage()
    if (pending === null) return
    if (pageCount() > pending) {
      setPage(pending)
      setPendingPage(null)
    }
  })
  const runSlideOp = (op: PptxSlideOp) => {
    if (!props.onSlideOp || slideBusy()) return
    void (async () => {
      setSlideBusy(true)
      try {
        await props.onSlideOp!(op)
        setTarget(undefined)
        setPicking(false)
        if (op.op === "deleteSlide") setPage((current) => Math.max(0, Math.min(current, pageCount() - 2)))
        else if (op.op === "duplicateSlide") setPendingPage(page() + 1)
        else if (op.op === "addSlide") setPendingPage(op.after ?? pageCount() - 1)
        else setPage(op.to - 1)
        props.onEdited?.()
      } catch (error) {
        showToast({
          variant: "error",
          title: "页面没有改成功",
          description: error instanceof Error ? error.message : String(error),
        })
      } finally {
        setSlideBusy(false)
      }
    })()
  }
  // 页面尺寸以文档自己的 `<p:sldSz>` 为准（引擎已换算成 pt），渲染器只作兜底。
  const pageSize = createMemo(() => {
    const state = layoutState()
    if (state) return { width: state.size.w, height: state.size.h }
    const value = presentation()
    return { width: value?.width ?? 960, height: value?.height ?? 540 }
  })

  // 观察主视图区域尺寸,算出适宽基准。面板宽度带 1s 过渡动画,
  // 挂载瞬间的 clientWidth 是中间态,必须靠 ResizeObserver 追到最终值。
  createEffect(() => {
    const viewport = mainViewport()
    if (!viewport) return
    const update = () => setMainSize({ width: viewport.clientWidth, height: viewport.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(viewport)
    onCleanup(() => observer.disconnect())
  })

  const fitScale = createMemo(() => {
    const size = mainSize()
    const box = pageSize()
    if (size.width <= 0 || size.height <= 0) return 0
    return Math.min((size.width - 48) / box.width, (size.height - 24) / box.height)
  })
  const displayScale = createMemo(() => fitScale() * zoom())

  // 换文件后收起上一份文件的选取与编辑态（历史按路径存在宿主，面板不用管）。
  createEffect(
    on(
      () => props.path,
      () => {
        setTarget(undefined)
        setDrafting(undefined)
        setLiveBox(undefined)
        setActiveCell(undefined)
      },
      { defer: true },
    ),
  )

  // 文件被重写后（onEdited → 重新读字节）丢掉拖动时的临时几何，改用新读出来的坐标。
  createEffect(
    on(
      () => props.base64,
      () => {
        setLiveBox(undefined)
        setDrafting(undefined)
      },
      { defer: true },
    ),
  )

  // 换页/换文件后锚点立刻失效：它描述的是「第 N 页上的某个形状」，页面一变就对不上。
  createEffect(
    on(
      page,
      () => {
        setTarget(undefined)
        setComment("")
        setDrafting(undefined)
        setActiveCell(undefined)
      },
      { defer: true },
    ),
  )

  /**
   * 屏幕坐标 → 幻灯片坐标 → 命中的形状 / 表格格子。
   * 外框尺寸正好是 `pageSize × displayScale`，所以用外框 rect 反算即可，
   * 不必关心滚动位置和内层 transform。
   */
  const locateAt = (clientX: number, clientY: number, element: HTMLElement) => {
    const value = presentation()
    if (!value) return undefined
    const slide = value.slides[page()]
    if (!slide || displayScale() <= 0) return undefined
    const rect = element.getBoundingClientRect()
    const point = {
      x: (clientX - rect.left) / displayScale(),
      y: (clientY - rect.top) / displayScale(),
    }
    // 懒加载的幻灯片此刻才解析形状树；materializeSlideNodes 自带幂等标记
    materializeSlideNodes(value, slide)
    const node = hitTestNodes(slide.nodes, point)
    // 点中组合时再往里找一层：命中子 XML 后，anchor 用 layout 里对应的子形状
    // （layout 的 scanBlocks 已把组内子形状展开成带页面坐标的可编辑块）。
    const groupHit =
      node?.nodeType === "group" && node.id
        ? hitInGroup(node, { x: point.x * EMU_PER_POINT, y: point.y * EMU_PER_POINT })
        : undefined
    const innerChild = groupHit?.child
    const groupId = groupHit?.parentId
    // 组合子节点的 id / name 在 cNvPr 上，不在 p:sp / p:pic 元素本身。
    const innerIdentity = innerChild ? childIdentity(innerChild) : undefined
    const innerId = innerIdentity?.id
    const innerAnchor =
      innerId && innerChild && groupId
        ? (() => {
            const childNode = layout()?.find(
              (item) => item.slide === page() + 1 && item.parentId === groupId && item.shapeId === innerId,
            )
            if (!childNode) return undefined
            return {
              slide: page() + 1,
              kind: childNode.kind,
              shapeId: childNode.shapeId,
              name: childNode.shapeName ?? innerIdentity?.name,
              text: childNode.paragraphs.join("\n"),
              paragraphs: childNode.paragraphs,
              box: childNode.box,
              slideSize: { w: value.width, h: value.height },
            } satisfies SlideElementAnchor
          })()
        : undefined
    const picked = innerAnchor ?? node
    // 表格：再算一次落在哪个格子上（格子盒子来自 layout 的行高列宽累加）。
    // 组合子形状的 anchor 本来就是 SlideElementAnchor；渲染节点要转一遍。
    const anchor = picked ? ("nodeType" in picked ? anchorOf(picked, page() + 1, value) : picked) : undefined
    const cellNode = anchor?.shapeId
      ? layout()?.find((item) => item.slide === anchor.slide && item.shapeId === anchor.shapeId)
      : undefined
    const cellBox = cellNode?.cells?.find(
      (item) =>
        item.box &&
        point.x >= item.box.x &&
        point.x <= item.box.x + item.box.w &&
        point.y >= item.box.y &&
        point.y <= item.box.y + item.box.h,
    )
    const next =
      anchor ?? ({ slide: page() + 1, kind: "slide", slideSize: { w: value.width, h: value.height } } as const)
    return {
      anchor: next as SlideElementAnchor,
      cell: cellBox ? { row: cellBox.row, col: cellBox.col } : undefined,
    }
  }

  /** 单击：命中谁就选中谁；点空白处按「整页」选中（可以给整页写评论）。 */
  const pickAt = (event: MouseEvent & { currentTarget: HTMLElement }) => {
    const found = locateAt(event.clientX, event.clientY, event.currentTarget)
    setComment("")
    setDrafting(undefined)
    setLiveBox(undefined)
    if (!found) return
    setActiveCell(found.cell)
    setTarget(found.anchor)
  }

  /**
   * 双击：先按坐标命中形状，再直接进原地改字（和 PowerPoint 一样），
   * 不需要先点「选取元素」。阅读模式下顺手请求切到编辑模式。
   */
  const editAt = (event: MouseEvent & { currentTarget: HTMLElement }) => {
    pickAt(event)
    const anchor = target()
    // 只有带文字的形状 / 表格格子才值得进改字：点击图片或空白不该切编辑模式。
    const textEditable =
      (anchor?.kind === "shape" && (anchor.paragraphs?.length ?? 0) > 0) ||
      (anchor?.kind === "table" && activeCellData() !== undefined)
    if (!textEditable) return
    if (props.editing === false) props.onRequestEdit?.()
    startInlineEdit()
  }

  /** 这一块能不能直接拖：整页和组合没有独立坐标，形状/图片/表格都可以。 */
  const movable = () => {
    const kind = target()?.kind
    return !!layoutNode() && kind !== "slide" && kind !== "group"
  }

  const shapeRef = () => {
    const anchor = target()
    const id = layoutNode()?.shapeId ?? anchor?.shapeId
    if (!anchor || !id) return undefined
    return { slide: anchor.slide, shapeId: id }
  }

  /**
   * 记下一条文字覆盖：按「页 + 形状 id」归到 textOverrides，供渲染层与编辑器种子就地反映。
   * 同一段（含表格同一格同一段）以最新一次为准。
   */
  const recordTextOverrides = (edits: NonNullable<EditPayload["edits"]>) => {
    const additions = new Map<string, Map<string, PptxTextOverride>>()
    for (const edit of edits) {
      if (edit.text === undefined) continue
      const slide = edit.slide ?? page() + 1
      if (!edit.shapeId) continue
      const key = pptxShapeKey(slide, edit.shapeId)
      const bucket = additions.get(key) ?? new Map<string, PptxTextOverride>()
      bucket.set(`${edit.cell?.row ?? ""}:${edit.cell?.col ?? ""}:${edit.paragraph ?? 0}`, {
        paragraph: edit.paragraph ?? 0,
        text: edit.text,
        row: edit.cell?.row,
        col: edit.cell?.col,
      })
      additions.set(key, bucket)
    }
    if (additions.size === 0) return
    setTextOverrides((prev) => {
      const next = new Map(prev)
      for (const [key, bucket] of additions) {
        for (const item of next.get(key) ?? [])
          bucket.set(`${item.row ?? ""}:${item.col ?? ""}:${item.paragraph}`, item)
        next.set(key, [...bucket.values()])
      }
      return next
    })
  }

  /**
   * 发一次原地编辑。
   *
   * 写回走的是「宿主会话」那条路：服务端会把结果记进撤销栈，
   * 所以这里不用再存反向操作，撤销按钮的可用性由头部统一去问宿主。
   *
   * `text: true` 表示纯文字改动：成功后只更新乐观覆盖 + 让宿主刷新撤销历史（onLocalEdit），
   * 不重读整篇字节；其余（几何 / 结构 / 图片）仍需 onEdited 触发重载。
   */
  const runEdit = async (payload: EditPayload, _label: string, opts?: { text?: boolean }) => {
    if (!props.path) return false
    setSaving(true)
    try {
      await sdk.client.office.pptx.edit({ directory: sdk.directory, path: props.path, ...payload })
      if (opts?.text) {
        if (payload.edits) recordTextOverrides(payload.edits)
        props.onLocalEdit?.()
      } else {
        props.onEdited?.()
      }
      return true
    } catch (error) {
      showToast({
        title: "保存失败",
        description: error instanceof Error ? error.message : "这块内容没法原地修改。",
      })
      return false
    } finally {
      setSaving(false)
    }
  }

  /** 拖动/缩放松手：写回几何（只动这一个块）。 */
  const commitBox = async (box: PptxBox) => {
    const ref = shapeRef()
    const previous = layoutNode()?.box
    if (!ref || !previous) {
      setLiveBox(undefined)
      return
    }
    // 成功后不清 liveBox：等新字节回来、layout 一更新再撤，
    // 否则框会先跳回旧位置再跳过去。
    const ok = await runEdit({ shapes: [{ ...ref, box }] }, "移动/缩放")
    if (!ok) setLiveBox(undefined)
  }

  /** 旋转：写回 `<a:xfrm rot>`，单位度。 */
  const commitRotation = async (rotation: number) => {
    const ref = shapeRef()
    if (!ref) return
    await runEdit({ shapes: [{ ...ref, rotation }] }, "旋转")
  }

  /** 格式：整块统一改；点中表格格子时只改这个格子；正在改字时只改当前这一段。 */
  const applyStyle = async (patch: PptxTextStyle, paragraph?: number) => {
    const ref = shapeRef()
    if (!ref) return
    // 表格格子：格式落到 cell 上，样式取格子自己的。
    const cell = activeCellData()
    if (cell) {
      await runEdit(
        { edits: [{ ...ref, cell: { row: cell.row, col: cell.col }, style: patch }] },
        `改表格格式 r${cell.row}c${cell.col}`,
      )
      return
    }
    const indices = paragraph === undefined ? targetParagraphs().map((_, index) => index) : [paragraph]
    if (indices.length === 0) return
    await runEdit({ edits: indices.map((index) => ({ ...ref, paragraph: index, style: patch })) }, "改格式")
  }

  /** 原地改字：逐段对比，只把改过的段落发上去。表格里带上 cell 定位。 */
  let editTexts: string[] = []
  const startInlineEdit = () => {
    if (drafting()) return
    const node = layoutNode()
    const cell = activeCellData()
    // 形状走整块段落；表格必须先点中某个格子（没有格子信息就没法定位）。
    if (node?.kind === "table" && cell) {
      setComment("")
      editTexts = [...cell.paragraphs]
      setDrafting(cell.paragraphs.length > 0 ? cell.paragraphs : [""])
      return
    }
    const paragraphs = targetParagraphs()
    // kind 是 shape（含组合里点出来的子形状）、且 layout 里有对应块时才能原地改。
    if (target()?.kind !== "shape" || !target()?.shapeId || paragraphs.length === 0) return
    setComment("")
    editTexts = [...paragraphs]
    setDrafting([...paragraphs])
  }

  const saveInlineEdit = async () => {
    const ref = shapeRef()
    const next = editTexts
    const cell = activeCellData()
    if (!ref || !next) return
    setDrafting(undefined)
    // 表格：只发这个格子；revert 用保存前的格子文本。
    if (ref.shapeId && cell && layoutNode()?.kind === "table") {
      const edits = next.map((text, index) => ({
        ...ref,
        paragraph: index,
        text,
        cell: { row: cell.row, col: cell.col },
      }))
      const changed = edits.filter((item) => item.text !== (cell.paragraphs[item.paragraph] ?? ""))
      if (changed.length === 0) return
      const ok = await runEdit({ edits: changed }, `改表格 r${cell.row}c${cell.col}`, { text: true })
      if (ok) showToast({ title: "已保存", description: "只改了这一个单元格。" })
      return
    }
    const previous = targetParagraphs()
    const edits = next
      .map((text, index) => ({ ...ref, paragraph: index, text }))
      .filter((item) => item.text !== (previous[item.paragraph] ?? ""))
    if (edits.length === 0) return
    const ok = await runEdit({ edits }, "改文字", { text: true })
    if (ok) {
      showToast({ title: "已保存", description: "只改了这一块的文字，其它页与素材未动。" })
      setPicking(false)
    }
  }

  /** 删除形状：会先确认一次，删掉的字节仍在宿主撤销栈里。 */
  const deleteShape = async (shapeId: string) => {
    if (!props.path || saving()) return
    if (typeof window !== "undefined" && !window.confirm("删除这个形状？可以从撤销按钮恢复。")) return
    const ok = await runEdit({ structure: [{ op: "deleteShape", slide: page() + 1, shapeId }] }, "删除形状")
    if (ok) {
      setTarget(undefined)
      setPicking(false)
      showToast({ title: "已删除", description: "可以用撤销按钮恢复。" })
    }
  }

  /** 新增文本框：放在当前页中心偏上，正文默认 18pt。 */
  const addTextBox = async () => {
    if (!props.path || saving()) return
    const size = pageSize()
    const box = { x: size.width * 0.12, y: size.height * 0.4, w: size.width * 0.76, h: size.height * 0.16 }
    const ok = await runEdit(
      { structure: [{ op: "addTextBox", slide: page() + 1, text: "点击这里输入文字", box, style: { size: 18 } }] },
      "新增文本框",
    )
    if (ok) showToast({ title: "已添加文本框", description: "双击它可以原地改字。" })
  }

  // 插入形状：预设几何（rect / ellipse / arrow …），PowerPoint 里可以继续拖动、改色、加动画。
  const [shapeKind, setShapeKind] = createSignal<PptxShapeKind>("rect")
  const [shapeFill, setShapeFill] = createSignal("#4472C4")
  const addShape = async () => {
    if (!props.path || saving()) return
    const size = pageSize()
    const ok = await runEdit(
      {
        structure: [
          {
            op: "addShape",
            slide: page() + 1,
            kind: shapeKind(),
            box: { x: size.width * 0.25, y: size.height * 0.3, w: size.width * 0.5, h: size.height * 0.2 },
            fill: shapeFill().replace(/^#/, "").toUpperCase(),
          },
        ],
      },
      "插入形状",
    )
    if (ok) showToast({ title: "已插入形状", description: "可以拖动、缩放和改颜色。" })
  }

  /** 替换图片：新图作为独立媒体条目写进包里，旧图不动。 */
  let imageInput: HTMLInputElement | undefined
  const chooseImage = () => imageInput?.click()
  const applyImage = async (file: File | undefined) => {
    const ref = shapeRef()
    if (!ref || !file) return
    const dataBase64 = bytesToBase64(new Uint8Array(await file.arrayBuffer()))
    const ok = await runEdit({ images: [{ ...ref, dataBase64, mime: file.type || "image/png" }] }, "替换图片")
    if (ok) showToast({ title: "已替换图片", description: "版式与其它素材未变。" })
  }

  /** 新增图片：和其它形状一样落成这一页的一个 <p:pic>，媒体条目单独进包。 */
  let pictureInput: HTMLInputElement | undefined
  const choosePicture = () => pictureInput?.click()
  const addPicture = async (file: File | undefined) => {
    if (!file || saving()) return
    const dataBase64 = bytesToBase64(new Uint8Array(await file.arrayBuffer()))
    const size = pageSize()
    const ok = await runEdit(
      {
        structure: [
          {
            op: "addPicture",
            slide: page() + 1,
            dataBase64,
            mime: file.type || "image/png",
            box: { x: size.width * 0.15, y: size.height * 0.2, w: size.width * 0.5, h: size.height * 0.4 },
          },
        ],
      },
      "插入图片",
    )
    if (ok) showToast({ title: "已插入图片", description: "可以用鼠标拖动和缩放。" })
  }

  const addCommentToConversation = () => {
    const anchor = target()
    if (!anchor || !props.path) return
    prompt.context.add(
      elementCommentItem({
        path: props.path,
        label: slideElementLabel(anchor),
        anchor: slideElementLabel(anchor),
        detail: slideElementDetail(anchor),
        comment: comment(),
      }),
    )
    setTarget(undefined)
    setComment("")
    setPicking(false)
    showToast({ title: "已添加到对话", description: "在输入框补充一句后发送，AI 会按评论改这一页。" })
    document.querySelector<HTMLElement>('[data-component="prompt-input"]')?.focus()
  }

  // 主视图:翻页/缩放变化时重渲染当前页。
  createEffect(
    on(
      () => [presentation(), page(), displayScale(), renderSlideData()] as const,
      ([value, _current, scale, slide]) => {
        if (!value || !mainMount || scale <= 0) return
        if (!slide) return
        mainMount.replaceChildren()
        const handle: SlideHandle = renderSlide(value, slide, rendererOptions())
        mainMount.append(handle.element)
        mainMount.style.width = `${value.width}px`
        mainMount.style.height = `${value.height}px`
        void handle.ready.catch(() => {})
        onCleanup(() => handle.dispose())
      },
    ),
  )

  // ---------------------------------------------------------------------------
  // 放映：整屏铺满一页，方向键 / 空格翻页，Esc 退出。
  // 放映只读：放映期间不改文件。
  // ---------------------------------------------------------------------------
  const [showing, setShowing] = createSignal(false)
  const [showPage, setShowPage] = createSignal(0)
  let showMount: HTMLDivElement | undefined
  const [showViewport, setShowViewport] = createSignal<{ width: number; height: number }>({ width: 0, height: 0 })

  const openShowcase = () => {
    setShowPage(page())
    setShowing(true)
  }
  const closeShowcase = () => {
    setPage(showPage())
    setShowing(false)
  }
  const stepShowcase = (delta: number) => {
    const total = pageCount()
    if (total === 0) return
    setShowPage((current) => Math.max(0, Math.min(total - 1, current + delta)))
  }

  createEffect(() => {
    if (!showing()) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        closeShowcase()
        return
      }
      if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") {
        event.preventDefault()
        stepShowcase(1)
        return
      }
      if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault()
        stepShowcase(-1)
      }
    }
    const onResize = () => {
      setShowViewport({ width: window.innerWidth, height: window.innerHeight })
    }
    onResize()
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("resize", onResize)
    onCleanup(() => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("resize", onResize)
    })
  })

  const showScale = createMemo(() => {
    const value = presentation()
    if (!value) return 0
    const viewport = showViewport()
    if (viewport.width <= 0 || viewport.height <= 0) return 0
    return Math.min(viewport.width / value.width, viewport.height / value.height)
  })

  /** 放映时按窗口尺寸等比放大（不放大超过 1:1，避免小页面糊成马赛克）。 */
  const showBox = createMemo(() => {
    const value = presentation()
    const scale = showScale()
    if (!value || scale <= 0) return undefined
    return { width: value.width * scale, height: value.height * scale, scale }
  })

  createEffect(
    on(
      () => [showing(), showPage(), showScale(), presentation()] as const,
      ([active, current, scale, value]) => {
        if (!active || !value || scale <= 0 || !showMount) return
        const slide = value.slides[current]
        if (!slide) return
        showMount.replaceChildren()
        const handle = renderSlide(value, slide, rendererOptions())
        showMount.append(handle.element)
        showMount.style.width = `${value.width}px`
        showMount.style.height = `${value.height}px`
        void handle.ready.catch(() => {})
        onCleanup(() => handle.dispose())
      },
    ),
  )

  // 页码越界保护(文件被替换时)。
  createEffect(
    on(pageCount, (count) => {
      if (count > 0 && page() >= count) setPage(count - 1)
    }),
  )

  onCleanup(() => {
    for (const [key, url] of mediaUrlCache) {
      URL.revokeObjectURL(url)
      mediaUrlCache.delete(key)
    }
  })

  /**
   * 功能区（宿主画标签行，这里只画命令）。
   * 翻页/缩放属于状态条，这里只放会改文件的命令。
   */
  const homeTab = () => (
    <Show
      when={pageCount() > 0}
      fallback={<span class="text-11-regular text-foreground-subtlest">正在加载演示文稿…</span>}
    >
      <RibbonRow>
        <Show when={props.path}>
          <button
            type="button"
            data-action="pptx-pick-toggle"
            title={picking() ? "退出元素选取" : "选取元素并评论"}
            aria-pressed={picking()}
            onClick={() => {
              setPicking(!picking())
              setTarget(undefined)
            }}
            class={[
              "flex h-6 shrink-0 items-center gap-1 rounded border px-1.5 text-11-regular transition-colors",
              picking()
                ? PREVIEW_ACTIVE_CLASS
                : "border-transparent text-foreground-subtle hover:bg-hover hover:text-foreground",
            ].join(" ")}
          >
            <Icon name="window-cursor" size="small" class="shrink-0" />
            <span class="truncate">选取元素</span>
          </button>
        </Show>
        <Show when={props.onSlideOp && pageCount() > 0}>
          <>
            <button
              type="button"
              data-action="pptx-slide-up"
              title="把这一页往前挪"
              class={RIBBON_BUTTON}
              disabled={slideBusy() || page() <= 0}
              onClick={() => runSlideOp({ op: "moveSlide", from: page() + 1, to: page() })}
            >
              上调
            </button>
            <button
              type="button"
              data-action="pptx-slide-down"
              title="把这一页往后挪"
              class={RIBBON_BUTTON}
              disabled={slideBusy() || page() >= pageCount() - 1}
              onClick={() => runSlideOp({ op: "moveSlide", from: page() + 1, to: page() + 2 })}
            >
              下调
            </button>
            <button
              type="button"
              data-action="pptx-slide-duplicate"
              title="复制这一页（内容照抄，紧接着改字就是新的一页）"
              class={RIBBON_BUTTON}
              disabled={slideBusy() || pageCount() === 0}
              onClick={() => runSlideOp({ op: "duplicateSlide", slide: page() + 1 })}
            >
              复制页
            </button>
            <button
              type="button"
              data-action="pptx-slide-add"
              title="新建一页，插在当前页之后（版式在检查器里选）"
              class={RIBBON_BUTTON}
              disabled={slideBusy() || pageCount() === 0}
              onClick={() =>
                runSlideOp({
                  op: "addSlide",
                  after: page() + 1,
                  ...(newSlideLayout() ? { layout: newSlideLayout() } : {}),
                })
              }
            >
              新建页
            </button>
            <button
              type="button"
              data-action="pptx-slide-delete"
              title="删除这一页（至少保留一页）"
              class={RIBBON_BUTTON}
              disabled={slideBusy() || pageCount() <= 1}
              onClick={() => runSlideOp({ op: "deleteSlide", slide: page() + 1 })}
            >
              删页
            </button>
          </>
        </Show>
        <InspectorToggle
          open={inspector()}
          onToggle={() => setInspector(!inspector())}
          title="打开检查器：新建页版式 / 形状类型与填充色"
        />
      </RibbonRow>
    </Show>
  )

  const insertTab = () => (
    <RibbonRow>
      <button
        type="button"
        data-action="pptx-add-textbox"
        title="在这一页加一个文本框"
        class={RIBBON_BUTTON}
        disabled={slideBusy() || saving() || pageCount() === 0}
        onClick={() => void addTextBox()}
      >
        ＋文本框
      </button>
      <button
        type="button"
        data-action="pptx-add-shape"
        title="在这一页插入一个预设形状（类型和填充色在检查器里选）"
        class={RIBBON_BUTTON}
        disabled={slideBusy() || saving() || pageCount() === 0}
        onClick={() => void addShape()}
      >
        ＋形状
      </button>
      <button
        type="button"
        data-action="pptx-add-picture"
        title="在这一页插入一张图片（作为独立媒体条目写进包里）"
        class={RIBBON_BUTTON}
        disabled={slideBusy() || saving() || pageCount() === 0}
        onClick={() => choosePicture()}
      >
        ＋图片
      </button>
      <input
        ref={(el) => {
          pictureInput = el
        }}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
        class="hidden"
        data-action="pptx-add-picture-input"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ""
          void addPicture(file)
        }}
      />
      <InspectorToggle
        open={inspector()}
        onToggle={() => setInspector(!inspector())}
        title="打开检查器：新建页版式 / 形状类型与填充色"
      />
    </RibbonRow>
  )

  /** 检查器抽屉：版式 / 形状类型 / 填充色这些「带值的控件」收在这里，工具条只留动词。 */
  const inspectorPanel = () => (
    <PaneInspector title="演示文稿" hint={`第 ${page() + 1} / ${pageCount()} 页`} onClose={() => setInspector(false)}>
      <Show when={props.onSlideOp && pageCount() > 0}>
        <InspectorSection label="新建页">
          <InspectorField label="版式" title="新建页使用的版式">
            <select
              data-action="pptx-slide-layout"
              class={INSPECTOR_INPUT}
              value={newSlideLayout()}
              onChange={(event) => setNewSlideLayout(event.currentTarget.value)}
            >
              <option value="">沿用当前版式</option>
              <For each={slideLayouts()}>{(item) => <option value={item.name}>{item.name}</option>}</For>
            </select>
          </InspectorField>
        </InspectorSection>
      </Show>
      <Show when={props.path && pageCount() > 0}>
        <InspectorSection label="演讲备注">
          <textarea
            data-action="pptx-slide-notes"
            class={INSPECTOR_INPUT + " min-h-24 resize-y"}
            value={slideNotes()}
            onInput={(event) => setSlideNotes(event.currentTarget.value)}
            placeholder="输入此页的演讲者备注"
          />
          <button
            type="button"
            data-action="pptx-slide-notes-save"
            class={RIBBON_BUTTON}
            disabled={notesBusy() || slideNotes() === notesForPage()}
            onClick={() => {
              const saveNotes = props.onSaveSlideNotes
              if (notesBusy() || saving() || !saveNotes) return
              setNotesBusy(true)
              void (async () => {
                try {
                  await saveNotes(page() + 1, slideNotes())
                  setSlideNotes(notesForPage())
                } catch (error) {
                  showToast({
                    variant: "error",
                    title: "备注没有保存成功",
                    description: error instanceof Error ? error.message : String(error),
                  })
                } finally {
                  setNotesBusy(false)
                }
              })()
            }}
          >
            {notesBusy() ? "保存中…" : "保存备注"}
          </button>
        </InspectorSection>
      </Show>
      <Show when={props.path}>
        <InspectorSection label="形状">
          <InspectorField label="类型" title="插入形状时使用的预设几何">
            <select
              data-action="pptx-shape-kind"
              class={INSPECTOR_INPUT}
              value={shapeKind()}
              onChange={(event) => setShapeKind(event.currentTarget.value as PptxShapeKind)}
            >
              <option value="rect">矩形</option>
              <option value="roundRect">圆角矩形</option>
              <option value="ellipse">椭圆</option>
              <option value="triangle">三角形</option>
              <option value="diamond">菱形</option>
              <option value="rightArrow">箭头</option>
              <option value="line">线条</option>
              <option value="star5">五角星</option>
            </select>
          </InspectorField>
          <InspectorField label="填充色" title="形状填充色">
            <input
              type="color"
              data-action="pptx-shape-fill"
              class="h-6 min-w-0 flex-1 cursor-pointer rounded border border-border bg-transparent p-0"
              value={shapeFill()}
              onInput={(event) => setShapeFill(event.currentTarget.value)}
            />
          </InspectorField>
        </InspectorSection>
      </Show>
    </PaneInspector>
  )

  useOfficeRibbonTabs(() => [
    { id: "home", label: "开始", render: homeTab },
    // 只读打开（没有文件路径）时不能加文本框，标签也不用出现。
    ...(props.path ? [{ id: "insert", label: "插入", render: insertTab }] : []),
  ])

  return (
    <Show
      when={presentation()}
      fallback={
        <Show
          when={!doc.error}
          fallback={
            <div class="flex h-full items-center justify-center text-12-regular text-foreground-subtle">
              无法渲染该演示文稿。
            </div>
          }
        >
          <div class="flex h-full items-center justify-center">
            <Spinner class="size-4 text-foreground-subtle" />
          </div>
        </Show>
      }
    >
      {(value) => (
        <div class="relative flex h-full min-h-0 flex-col">
          <div class="flex min-h-0 flex-1">
            {/* 缩略图栏 */}
            <div class="w-36 shrink-0 overflow-y-auto border-r border-border bg-panel p-2">
              <div class="flex flex-col gap-2">
                <For each={value().slides}>
                  {(_, index) => (
                    <PptxThumbnail
                      presentation={value()}
                      pageIndex={index()}
                      selected={page() === index()}
                      rendererOptions={rendererOptions()}
                      onSelect={() => setPage(index())}
                    />
                  )}
                </For>
              </div>
            </div>
            {/* 主视图:单页居中,外框按显示尺寸,内层 transform 缩放。 */}
            <div ref={setMainViewport} class="relative min-w-0 flex-1 overflow-auto bg-background-weak">
              <div class="flex min-h-full min-w-full items-center justify-center p-3">
                <div
                  data-component="pptx-page"
                  class="relative shrink-0 overflow-hidden bg-background shadow-md"
                  style={{
                    width: `${pageSize().width * displayScale()}px`,
                    height: `${pageSize().height * displayScale()}px`,
                  }}
                  onClick={editAt}
                >
                  <div
                    ref={mainMount}
                    class="origin-top-left"
                    style={{
                      transform: `scale(${displayScale()})`,
                      width: `${pageSize().width}px`,
                      height: `${pageSize().height}px`,
                    }}
                  />
                  {/* 命中层：盖在渲染结果上接管点击，单击即选中并进入改字。 */}
                  <Show when={picking() || props.editing !== false}>
                    <div
                      data-component="pptx-pick-layer"
                      class={
                        picking() ? "absolute inset-0 z-10 cursor-crosshair" : "absolute inset-0 z-10 cursor-default"
                      }
                      onClick={editAt}
                    />
                  </Show>
                  {/* 选中框：可以拖动整块，八个把手改尺寸；松手才写回文件。
                      表格点中某个格子时，框落在格子上（拖动格子没有意义，只作定位）。 */}
                  <Show when={activeBox()}>
                    {(box) => (
                      <PptxShapeFrame
                        box={box()}
                        scale={displayScale()}
                        rotation={layoutNode()?.rotation}
                        movable={movable() && !activeCellData()}
                        onLive={setLiveBox}
                        onCommit={(next) => void commitBox(next)}
                        onRotate={(degrees) => void commitRotation(degrees)}
                      />
                    )}
                  </Show>
                  {/* 原地改字：半透明画布压在被框住的位置，字体字号照 XML 里的实际值。 */}
                  <Show when={drafting() && activeBox()}>
                    <PptxTextEditor
                      box={activeBox()!}
                      scale={displayScale()}
                      paragraphs={drafting()!}
                      styles={activeCellData()?.styles ?? targetStyles()}
                      onInput={(index, text) => {
                        editTexts[index] = text
                      }}
                      onSave={() => void saveInlineEdit()}
                      onCancel={() => setDrafting(undefined)}
                    />
                  </Show>
                </div>
              </div>
            </div>
          </div>
          {/* 元素面板：选中后可以直接改（画布拖动/改字/格式/换图），也可以写一句话交给 AI。 */}
          <Show when={target()}>
            {(anchor) => (
              <div class="flex shrink-0 flex-col gap-2 border-t border-border bg-panel px-3 py-2.5">
                <div class="flex min-w-0 items-center gap-1.5">
                  <Icon name="window-cursor" size="small" class="shrink-0 text-foreground-subtle" />
                  <span class="truncate text-12-medium text-foreground">{slideElementLabel(anchor())}</span>
                  <span class="ml-auto shrink-0 text-11-regular text-foreground-subtlest">
                    {drafting() ? "⌘/Ctrl+Enter 保存，Esc 取消" : "拖动可移动，双击可直接改字"}
                  </span>
                </div>
                <Show when={drafting()}>
                  <div class="flex items-center gap-2">
                    <span class="min-w-0 flex-1 truncate text-11-regular text-foreground-subtlest">
                      改动只写回这一块的文字，其它页与素材不动
                    </span>
                    <button
                      type="button"
                      class="rounded-lg px-2.5 py-1.5 text-12-medium text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
                      onClick={() => setDrafting(undefined)}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      data-action="pptx-inline-save"
                      disabled={saving()}
                      class="rounded-lg border border-icon-blue/40 bg-icon-blue/10 px-3 py-1.5 text-12-medium text-icon-blue transition-colors hover:bg-icon-blue/20 disabled:opacity-50"
                      onClick={() => void saveInlineEdit()}
                    >
                      {saving() ? "保存中…" : "保存"}
                    </button>
                  </div>
                </Show>
                <Show when={!drafting()}>
                  <Show when={targetParagraphs().length > 0 || (layoutNode()?.kind === "table" && activeCellData())}>
                    <PptxFormatBar
                      style={(activeCellData()?.styles ?? targetStyles())[0] ?? {}}
                      disabled={saving()}
                      onChange={(patch) => void applyStyle(patch)}
                    />
                  </Show>
                  <textarea
                    value={comment()}
                    onInput={(event) => setComment(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault()
                        setTarget(undefined)
                        return
                      }
                      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                        event.preventDefault()
                        addCommentToConversation()
                      }
                    }}
                    placeholder="例如：这张卡片换成蓝绿色；标题字号再大一点…"
                    class="min-h-12 w-full resize-y rounded-lg border border-border bg-background p-2 text-12-regular leading-relaxed text-foreground outline-none transition-colors focus:border-border-hover"
                  />
                  <div class="flex items-center gap-2">
                    <span class="min-w-0 flex-1 truncate text-11-regular text-foreground-subtlest">
                      改不动的地方写一句，发送后由 AI 改这一页
                    </span>
                    <Show
                      when={
                        props.path &&
                        (anchor().kind === "shape" || (anchor().kind === "table" && !!activeCellData())) &&
                        (anchor().kind === "table" || targetParagraphs().length > 0)
                      }
                    >
                      <button
                        type="button"
                        data-action="pptx-inline-start"
                        title="直接在画布上改这段文字，只改这一个形状"
                        class="rounded-lg px-2.5 py-1.5 text-12-medium text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
                        onClick={startInlineEdit}
                      >
                        改字
                      </button>
                    </Show>
                    <Show when={props.path && anchor().kind === "picture"}>
                      <button
                        type="button"
                        data-action="pptx-replace-image"
                        title="换一张图片，位置和尺寸保持不变"
                        class="rounded-lg px-2.5 py-1.5 text-12-medium text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
                        onClick={chooseImage}
                      >
                        换图
                      </button>
                    </Show>
                    {/* 删除形状：和 AI 的 deleteShape 是同一条 op（组合里的子形状会被拒绝）。 */}
                    <Show when={props.path && anchor().shapeId}>
                      <button
                        type="button"
                        data-action="pptx-delete-shape"
                        title="从这一页删掉选中的形状"
                        class="rounded-lg px-2.5 py-1.5 text-12-medium text-icon-critical-base transition-colors hover:bg-surface-critical-weak"
                        onClick={() => void deleteShape(anchor().shapeId!)}
                      >
                        删除形状
                      </button>
                    </Show>
                    <button
                      type="button"
                      class="rounded-lg px-2.5 py-1.5 text-12-medium text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
                      onClick={() => setTarget(undefined)}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      data-action="pptx-pick-add"
                      class="rounded-lg border border-icon-blue/40 bg-icon-blue/10 px-3 py-1.5 text-12-medium text-icon-blue transition-colors hover:bg-icon-blue/20"
                      onClick={addCommentToConversation}
                    >
                      添加到对话
                    </button>
                  </div>
                </Show>
              </div>
            )}
          </Show>
          <input
            ref={imageInput}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
            class="hidden"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ""
              void applyImage(file)
            }}
          />
          {/* 底部状态栏：翻页、放映、缩放都在这里，缩放不再单独在别处放一套。 */}
          <PaneStatusBar
            zoom={{
              value: () => Math.round(displayScale() * 100),
              onStep: (zoomIn) =>
                setZoom((x) => Math.min(4, Math.max(0.25, Math.round(x * 10 * (zoomIn ? 1.1 : 0.9)) / 10))),
              onReset: () => setZoom(1),
              fitLabel: "适应",
              onFit: () => setZoom(1),
              fitted: () => zoom() === 1,
            }}
            info={
              <div class="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  class="grid size-6 place-items-center rounded text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground disabled:opacity-40"
                  disabled={page() <= 0}
                  aria-label={language.t("session.filePreview.prevPage")}
                  onClick={() => setPage((x) => Math.max(0, x - 1))}
                >
                  ‹
                </button>
                <span class="min-w-16 text-center text-ui-xs tabular-nums text-foreground-subtle">
                  {language.t("session.filePreview.pageOf", { page: page() + 1, total: pageCount() })}
                </span>
                <button
                  type="button"
                  class="grid size-6 place-items-center rounded text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground disabled:opacity-40"
                  disabled={page() >= pageCount() - 1}
                  aria-label={language.t("session.filePreview.nextPage")}
                  onClick={() => setPage((x) => Math.min(pageCount() - 1, x + 1))}
                >
                  ›
                </button>
              </div>
            }
            extra={
              <button
                type="button"
                data-action="pptx-showcase-start"
                title="从当前页开始放映"
                class="rounded px-1.5 py-0.5 text-ui-xs text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground disabled:opacity-40"
                disabled={pageCount() === 0}
                onClick={openShowcase}
              >
                放映
              </button>
            }
          />
          {/* 放映：整屏只读呈现当前页；方向键 / 空格翻页，Esc 退出。 */}
          <Show when={showing()}>
            <div class="fixed inset-0 z-50 flex flex-col bg-black" data-action="pptx-showcase">
              <div class="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
                <Show when={showBox()}>
                  {(box) => (
                    <div
                      class="relative shrink-0 overflow-hidden"
                      style={{ width: `${box().width}px`, height: `${box().height}px` }}
                    >
                      <div
                        ref={showMount}
                        class="origin-top-left"
                        style={{
                          transform: `scale(${box().scale})`,
                          width: `${value().width}px`,
                          height: `${value().height}px`,
                        }}
                      />
                    </div>
                  )}
                </Show>
              </div>
              <div class="flex h-10 shrink-0 items-center justify-center gap-4 text-12-regular text-white/70">
                <button type="button" class="px-2 hover:text-white" onClick={() => stepShowcase(-1)}>
                  ‹ 上一页
                </button>
                <span class="tabular-nums">
                  {showPage() + 1} / {pageCount()}
                </span>
                <button type="button" class="px-2 hover:text-white" onClick={() => stepShowcase(1)}>
                  下一页 ›
                </button>
                <button type="button" class="px-2 hover:text-white" onClick={closeShowcase}>
                  退出（Esc）
                </button>
              </div>
            </div>
          </Show>
          <Show when={inspector()}>{inspectorPanel()}</Show>
        </div>
      )}
    </Show>
  )
}

/** 命中的形状节点 → 评论锚点（页码 + 名称 + 文字 + 几何，坐标用幻灯片单位）。 */
function anchorOf(node: SlideNode, slide: number, presentation: PresentationData): SlideElementAnchor {
  const paragraphs = nodeParagraphs(node)
  return {
    slide,
    kind: node.nodeType,
    shapeId: node.id,
    name: node.name,
    text: paragraphs?.join("\n"),
    paragraphs,
    box: { x: node.position.x, y: node.position.y, w: node.size.w, h: node.size.h },
    slideSize: { w: presentation.width, h: presentation.height },
  }
}

/** 形状逐段文字；图片/图表没有可读文字（表格拼成一行一格）。 */
function nodeParagraphs(node: SlideNode): string[] | undefined {
  if (node.nodeType === "shape") return bodyParagraphs(node.textBody)
  if (node.nodeType === "table") {
    return node.rows
      .map((row) => row.cells.map((cell) => bodyParagraphs(cell.textBody).join("")).join(" | "))
      .filter(Boolean)
  }
  return undefined
}

function bodyParagraphs(body: TextBody | undefined) {
  if (!body) return []
  return body.paragraphs.map((paragraph) =>
    paragraph.runs
      .map((run) => run.text)
      .join("")
      .trim(),
  )
}

/** 缩略图:进入视口才真正渲染幻灯片(与大视图同引擎、同媒体缓存)。 */
function PptxThumbnail(props: {
  presentation: PresentationData
  pageIndex: number
  selected: boolean
  rendererOptions: SlideRendererOptions
  onSelect: () => void
}) {
  let button: HTMLButtonElement | undefined
  let mount: HTMLDivElement | undefined
  const [visible, setVisible] = createSignal(false)
  const [width, setWidth] = createSignal(0)

  createEffect(() => {
    if (!button) return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? false), {
      rootMargin: "300px 0px",
    })
    observer.observe(button)
    onCleanup(() => observer.disconnect())
  })

  createEffect(() => {
    if (!button) return
    const update = () => setWidth(Math.max(0, button!.clientWidth - 16))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(button)
    onCleanup(() => observer.disconnect())
  })

  const scale = () => {
    const box = props.presentation
    return width() > 0 ? width() / box.width : 0
  }

  createEffect(
    on(
      () => [visible(), scale()] as const,
      ([shown, thumbScale]) => {
        if (!shown || thumbScale <= 0 || !mount) return
        mount.replaceChildren()
        const slide = props.presentation.slides[props.pageIndex]
        if (!slide) return
        const handle = renderSlide(props.presentation, slide, props.rendererOptions)
        mount.append(handle.element)
        mount.style.width = `${props.presentation.width}px`
        mount.style.height = `${props.presentation.height}px`
        void handle.ready.catch(() => {})
        onCleanup(() => handle.dispose())
      },
    ),
  )

  createEffect(
    on(
      () => props.selected,
      (selected) => {
        if (selected) button?.scrollIntoView({ block: "nearest" })
      },
      { defer: true },
    ),
  )

  const box = props.presentation
  return (
    <button
      ref={button}
      type="button"
      aria-current={props.selected ? "page" : undefined}
      class="flex w-full flex-col items-center gap-1 rounded-lg border p-2 text-ui-xs text-foreground-subtle outline-none transition-colors"
      classList={{
        "border-border-hover bg-selected text-foreground": props.selected,
        "border-transparent hover:border-border hover:bg-hover": !props.selected,
      }}
      onClick={props.onSelect}
    >
      <div
        class="flex w-full items-center justify-center overflow-hidden bg-surface"
        style={{ "aspect-ratio": `${box.width} / ${box.height}` }}
      >
        <Show when={visible() && scale() > 0}>
          {/* 外框按缩放后尺寸定宽:mount 的布局宽度是幻灯片原始尺寸,
              若直接塞进居中容器,transform 缩放后视觉内容会漂移到盒子外。 */}
          <div
            class="relative shrink-0 overflow-hidden"
            style={{ width: `${box.width * scale()}px`, height: `${box.height * scale()}px` }}
          >
            <div
              ref={mount}
              class="origin-top-left"
              style={{
                transform: `scale(${scale()})`,
                width: `${box.width}px`,
                height: `${box.height}px`,
              }}
            />
          </div>
        </Show>
      </div>
      <span class="tabular-nums">{props.pageIndex + 1}</span>
    </button>
  )
}
