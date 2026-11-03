import {
  buildPresentation,
  materializeSlideNodes,
  parseZipLazyMedia,
  RECOMMENDED_ZIP_LIMITS,
  renderSlide,
  type GroupNodeData,
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
import { PptxFormatBar, PptxShapeFrame, PptxTextEditor } from "@/pages/session/pptx-canvas-editor"
import { type PptxBox, type PptxTextStyle } from "@novaway/core/office/pptx-edit"
import { pptxEngine, type PptxNodePt, type PptxState } from "@novaway/core/office/engine/pptx"

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
}

/**
 * 撤销用的反向样式：只还原「本次真正改过」的字段。
 * 之前没有值的（比如原本没设颜色）没法还原成「没设」，只能保持现状。
 */
function revertStyle(previous: PptxTextStyle, patch: PptxTextStyle): PptxTextStyle {
  const out: PptxTextStyle = {}
  if (patch.bold !== undefined) out.bold = previous.bold === true
  if (patch.italic !== undefined) out.italic = previous.italic === true
  if (patch.underline !== undefined) out.underline = previous.underline === true
  if (patch.size !== undefined && previous.size !== undefined) out.size = previous.size
  if (patch.color !== undefined && previous.color !== undefined) out.color = previous.color
  if (patch.align !== undefined && previous.align !== undefined) out.align = previous.align
  if (patch.font !== undefined && previous.font !== undefined) out.font = previous.font
  return out
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
 * PPT 真实渲染(@aiden0z/pptx-renderer,ZCode 同款引擎):
 * 左侧缩略图栏(懒渲染)+ 右侧单页主视图 + 底部翻页/缩放条。
 * 主视图与缩略图共享 mediaUrlCache,内嵌图片的 blob URL 只解析一次。
 *
 * 传了 `path`（工作区相对路径）才有「选取元素 + 评论」：点中某一页上的形状/图片/表格，
 * 写一句要改什么，作为文件上下文挂到输入框上方，发送后由 AI 落回这一页。
 */
export const PptxFilePreview: Component<{ base64: string; path?: string; onEdited?: () => void }> = (props) => {
  const language = useLanguage()
  const prompt = usePrompt()
  const sdk = useSDK()
  const [doc] = createResource(() => props.base64, openPptx)
  const [page, setPage] = createSignal(0)
  // zoom=1 表示"适宽";± 按钮在其上乘系数。
  const [zoom, setZoom] = createSignal(1)
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
  // 撤销栈：每一步存的是「反向操作」，点撤销就原样再发一次。
  const [history, setHistory] = createSignal<Array<{ label: string; revert: EditPayload }>>([])

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
  const targetParagraphs = createMemo(() => layoutNode()?.paragraphs ?? target()?.paragraphs ?? [])
  // 表格：当前点中的单元格（画布上点表格的某个格子 → 编辑框落在那个格子上）。
  const [activeCell, setActiveCell] = createSignal<{ row: number; col: number }>()
  const activeCellData = createMemo(() => {
    const cell = activeCell()
    if (!cell) return undefined
    return layoutNode()?.cells?.find((item) => item.row === cell.row && item.col === cell.col)
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

  const presentation = createMemo(() => (doc.state === "ready" ? doc() : undefined))
  const pageCount = createMemo(() => presentation()?.slides.length ?? 0)
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

  // 换文件后撤销栈立刻作废：里面的反向操作指向的是上一份文件的形状。
  createEffect(
    on(
      () => props.path,
      () => {
        setHistory([])
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
   * 主视图上的一次点击 → 幻灯片坐标 → 命中的形状。
   * 外框尺寸正好是 `pageSize × displayScale`，所以用外框 rect 反算即可，
   * 不必关心滚动位置和内层 transform。点空白处按「整页」起一条评论。
   */
  const pickAt = (event: MouseEvent & { currentTarget: HTMLElement }) => {
    const value = presentation()
    if (!value) return
    const slide = value.slides[page()]
    if (!slide || displayScale() <= 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    const point = {
      x: (event.clientX - rect.left) / displayScale(),
      y: (event.clientY - rect.top) / displayScale(),
    }
    // 懒加载的幻灯片此刻才解析形状树；materializeSlideNodes 自带幂等标记
    materializeSlideNodes(value, slide)
    const node = hitTestNodes(slide.nodes, point)
    // 点中组合时再往里找一层：命中子 XML 后，anchor 用 layout 里对应的子形状
    // （layout 的 scanBlocks 已把组内子形状展开成带页面坐标的可编辑块）。
    const innerChild = node?.nodeType === "group" ? hitTestGroupChildren(node, point) : undefined
    const groupId = node?.nodeType === "group" ? node.id : undefined
    const innerId = innerChild?.attr("id")
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
              name: childNode.shapeName ?? innerChild.attr("name"),
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
    setActiveCell(cellBox ? { row: cellBox.row, col: cellBox.col } : undefined)
    setComment("")
    setDrafting(undefined)
    setLiveBox(undefined)
    setTarget(anchor ?? { slide: page() + 1, kind: "slide", slideSize: { w: value.width, h: value.height } })
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

  /** 发一次原地编辑；给了 revert 就记进撤销栈（撤销 = 把反向操作再发一次）。 */
  const runEdit = async (payload: EditPayload, label: string, revert?: EditPayload) => {
    if (!props.path) return false
    setSaving(true)
    try {
      await sdk.client.office.pptx.edit({ directory: sdk.directory, path: props.path, ...payload })
      if (revert) setHistory((items) => [...items.slice(-19), { label, revert }])
      props.onEdited?.()
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

  const undo = async () => {
    const entry = history().at(-1)
    if (!entry) return
    setHistory((items) => items.slice(0, -1))
    if (await runEdit(entry.revert, entry.label)) showToast({ title: "已撤销", description: entry.label })
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
    const ok = await runEdit({ shapes: [{ ...ref, box }] }, "移动/缩放", { shapes: [{ ...ref, box: previous }] })
    if (!ok) setLiveBox(undefined)
  }

  /** 旋转：写回 `<a:xfrm rot>`，单位度。 */
  const commitRotation = async (rotation: number) => {
    const ref = shapeRef()
    const previous = layoutNode()?.rotation ?? 0
    if (!ref) return
    await runEdit({ shapes: [{ ...ref, rotation }] }, "旋转", { shapes: [{ ...ref, rotation: previous }] })
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
        {
          edits: [{ ...ref, cell: { row: cell.row, col: cell.col }, style: revertStyle(cell.styles[0] ?? {}, patch) }],
        },
      )
      return
    }
    const styles = targetStyles()
    const indices = paragraph === undefined ? targetParagraphs().map((_, index) => index) : [paragraph]
    if (indices.length === 0) return
    await runEdit({ edits: indices.map((index) => ({ ...ref, paragraph: index, style: patch })) }, "改格式", {
      edits: indices.map((index) => ({ ...ref, paragraph: index, style: revertStyle(styles[index] ?? {}, patch) })),
    })
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
      const revert = cell.paragraphs.map((text, index) => ({
        ...ref,
        paragraph: index,
        text,
        cell: { row: cell.row, col: cell.col },
      }))
      const ok = await runEdit({ edits: changed }, `改表格 r${cell.row}c${cell.col}`, { edits: revert })
      if (ok) showToast({ title: "已保存", description: "只改了这一个单元格。" })
      return
    }
    const previous = targetParagraphs()
    const edits = next
      .map((text, index) => ({ ...ref, paragraph: index, text }))
      .filter((item) => item.text !== (previous[item.paragraph] ?? ""))
    if (edits.length === 0) return
    const ok = await runEdit({ edits }, "改文字", {
      edits: previous.map((text, index) => ({ ...ref, paragraph: index, text })),
    })
    if (ok) {
      showToast({ title: "已保存", description: "只改了这一块的文字，其它页与素材未动。" })
      setPicking(false)
    }
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
      () => [presentation(), page(), displayScale()] as const,
      ([value, current, scale]) => {
        if (!value || !mainMount || scale <= 0) return
        const slide = value.slides[current]
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
        <div class="flex h-full min-h-0 flex-col">
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
                  class="relative shrink-0 overflow-hidden bg-background shadow-md"
                  style={{
                    width: `${pageSize().width * displayScale()}px`,
                    height: `${pageSize().height * displayScale()}px`,
                  }}
                  onDblClick={() => startInlineEdit()}
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
                  {/* 准星层：盖在渲染结果上接管点击，只在选取模式下存在。
                      放在缩放到最终尺寸的盒子里，点击坐标就是屏幕坐标。
                      双击 = 直接进画布改字（和 PowerPoint 一样）。 */}
                  <Show when={picking()}>
                    <div
                      data-component="pptx-pick-layer"
                      class="absolute inset-0 z-10 cursor-crosshair"
                      onClick={pickAt}
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
                  <Show when={history().length > 0}>
                    <button
                      type="button"
                      data-action="pptx-undo"
                      class="ml-1 shrink-0 rounded px-1.5 py-0.5 text-11-regular text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground disabled:opacity-40"
                      disabled={saving()}
                      title={`撤销：${history().at(-1)?.label ?? ""}`}
                      onClick={() => void undo()}
                    >
                      撤销
                    </button>
                  </Show>
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
                      class="rounded-lg border border-emerald-300/45 bg-emerald-300/12 px-3 py-1.5 text-12-medium text-emerald-100 transition-colors hover:bg-emerald-300/20 disabled:opacity-50"
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
                      class="rounded-lg border border-emerald-300/45 bg-emerald-300/12 px-3 py-1.5 text-12-medium text-emerald-100 transition-colors hover:bg-emerald-300/20"
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
          {/* 底部翻页/缩放条(对齐 ZCode 的 1/14 与缩放控件)。 */}
          <div class="flex h-10 shrink-0 items-center gap-3 border-t border-border px-3">
            <div class="flex min-w-0 flex-1 items-center">
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
                  class="flex items-center gap-1 rounded-md px-2 py-1 text-ui-xs transition-colors hover:bg-hover hover:text-foreground"
                  classList={{
                    "bg-hover text-foreground": picking(),
                    "text-foreground-subtle": !picking(),
                  }}
                >
                  <Icon name="window-cursor" size="small" class="shrink-0" />
                  <span class="truncate">选取元素</span>
                </button>
              </Show>
            </div>
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
            <div class="flex items-center gap-1">
              <button
                type="button"
                class="grid size-6 place-items-center rounded text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
                aria-label={language.t("session.filePreview.zoomOut")}
                onClick={() => setZoom((x) => Math.max(0.25, Math.round(x * 10 * 0.9) / 10))}
              >
                −
              </button>
              <button
                type="button"
                class="min-w-12 rounded px-1 text-center text-ui-xs tabular-nums text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
                aria-label={language.t("session.filePreview.zoomReset")}
                onClick={() => setZoom(1)}
                title={language.t("session.filePreview.zoomReset")}
              >
                {Math.round(displayScale() * 100)}%
              </button>
              <button
                type="button"
                class="grid size-6 place-items-center rounded text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
                aria-label={language.t("session.filePreview.zoomIn")}
                onClick={() => setZoom((x) => Math.min(4, Math.round(x * 10 * 1.1) / 10))}
              >
                +
              </button>
            </div>
          </div>
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

/**
 * 组合内命中：把点从页面坐标换算进组合的子坐标空间，再在子 XML 上挑命中的那个，
 * 返回子 XML 节点（不是渲染节点 —— 编辑定位只需要 cNvPr id / 名称）。
 * 子形状的渲染位置由渲染器按 (off + (child - chOff) * scale) 换算，这里做同样的事。
 * 旋转/翻转的组合没有线性映射，直接返回 undefined（整组选中）。
 */
function hitTestGroupChildren(
  group: GroupNodeData,
  point: { x: number; y: number },
): GroupNodeData["children"][number] | undefined {
  const xfrm = group.source.child("grpSpPr").child("xfrm")
  if (!xfrm.exists()) return undefined
  if ((xfrm.element?.getAttribute("rot") ?? "0") !== "0") return undefined
  if (xfrm.element?.getAttribute("flipH") || xfrm.element?.getAttribute("flipV")) return undefined
  const off = xfrm.child("off")
  const ext = xfrm.child("ext")
  const chOff = xfrm.child("chOff")
  const chExt = xfrm.child("chExt")
  if (!off.exists() || !ext.exists()) return undefined
  const cx = ext.numAttr("cx") ?? 0
  const cy = ext.numAttr("cy") ?? 0
  const chExtCx = chExt.numAttr("cx") ?? cx
  const chExtCy = chExt.numAttr("cy") ?? cy
  if (chExtCx <= 0 || chExtCy <= 0 || cx <= 0 || cy <= 0) return undefined
  const scaleX = cx / chExtCx
  const scaleY = cy / chExtCy
  const childPoint = {
    x: (chOff.numAttr("x") ?? 0) + (point.x - (off.numAttr("x") ?? 0)) / scaleX,
    y: (chOff.numAttr("y") ?? 0) + (point.y - (off.numAttr("y") ?? 0)) / scaleY,
  }
  // 子 XML 只有原始坐标，用原始坐标做矩形命中（近似：与渲染器一致的非旋转情形）。
  for (let index = group.children.length - 1; index >= 0; index--) {
    const child = group.children[index]
    if (!child) continue
    const bounds = childXfrmBounds(child)
    if (
      bounds &&
      childPoint.x >= bounds.x &&
      childPoint.x <= bounds.x + bounds.w &&
      childPoint.y >= bounds.y &&
      childPoint.y <= bounds.y + bounds.h
    ) {
      return child
    }
  }
  return undefined
}

/** 子 XML 节点的原始 xfrm 边界；没有 xfrm 的子节点（极少）忽略。 */
function childXfrmBounds(child: GroupNodeData["children"][number]) {
  const spPr = child.child("spPr").exists() ? child.child("spPr") : child.child("grpSpPr")
  const xfrm = spPr.child("xfrm")
  if (!xfrm.exists()) return undefined
  const off = xfrm.child("off")
  const ext = xfrm.child("ext")
  if (!off.exists() || !ext.exists()) return undefined
  return {
    x: off.numAttr("x") ?? 0,
    y: off.numAttr("y") ?? 0,
    w: ext.numAttr("cx") ?? 0,
    h: ext.numAttr("cy") ?? 0,
  }
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
