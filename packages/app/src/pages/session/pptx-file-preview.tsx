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

type PptxDoc = PresentationData

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
  const pageSize = createMemo(() => {
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

  // 换页/换文件后锚点立刻失效：它描述的是「第 N 页上的某个形状」，页面一变就对不上。
  createEffect(
    on(
      page,
      () => {
        setTarget(undefined)
        setComment("")
        setDrafting(undefined)
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
    setComment("")
    setTarget(
      node
        ? anchorOf(node, page() + 1, value)
        : { slide: page() + 1, kind: "slide", slideSize: { w: value.width, h: value.height } },
    )
  }

  /** 点中带文字的形状 → 进入画布内改字：每一段一个输入框，改完只回写变化的段落。 */
  const startInlineEdit = () => {
    const anchor = target()
    if (anchor?.kind !== "shape" || !anchor.shapeId || !anchor.paragraphs?.length) return
    setDrafting([...anchor.paragraphs])
  }

  const saveInlineEdit = async () => {
    const anchor = target()
    const next = drafting()
    if (!anchor?.shapeId || !next || !props.path) return
    const edits = next
      .map((text, index) => ({ slide: anchor.slide, shapeId: anchor.shapeId, paragraph: index, text }))
      .filter((item) => item.text !== (anchor.paragraphs?.[item.paragraph] ?? ""))
    if (edits.length === 0) {
      setDrafting(undefined)
      return
    }

    setSaving(true)
    try {
      await sdk.client.office.pptx.edit({ directory: sdk.directory, path: props.path, edits })
      showToast({ title: "已保存", description: "只改了这一块的文字，其它页与素材未动。" })
      setDrafting(undefined)
      setTarget(undefined)
      setPicking(false)
      props.onEdited?.()
    } catch (error) {
      showToast({
        title: "保存失败",
        description: error instanceof Error ? error.message : "这个形状没法原地改字。",
      })
    } finally {
      setSaving(false)
    }
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
                      放在缩放到最终尺寸的盒子里，点击坐标就是屏幕坐标。 */}
                  <Show when={picking()}>
                    <div
                      data-component="pptx-pick-layer"
                      class="absolute inset-0 z-10 cursor-crosshair"
                      onClick={pickAt}
                    />
                  </Show>
                  {/* 画布内改字：输入框就压在被框住的那块位置，改完写回 slideN.xml。 */}
                  <Show when={drafting() && target()?.box}>
                    <div
                      data-component="pptx-inline-editor"
                      class="absolute z-30 flex flex-col gap-0.5 overflow-auto rounded-[2px] border-2 border-emerald-400 bg-white/95 p-1 shadow-[0_8px_24px_rgba(0,0,0,0.28)]"
                      style={{
                        left: `${(target()?.box?.x ?? 0) * displayScale()}px`,
                        top: `${(target()?.box?.y ?? 0) * displayScale()}px`,
                        width: `${Math.max(120, (target()?.box?.w ?? 0) * displayScale())}px`,
                        height: `${Math.max(40, (target()?.box?.h ?? 0) * displayScale())}px`,
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault()
                          setDrafting(undefined)
                          return
                        }
                        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                          event.preventDefault()
                          void saveInlineEdit()
                        }
                      }}
                    >
                      <For each={drafting()}>
                        {(text, index) => (
                          <input
                            value={text}
                            ref={(element) => {
                              // 挂载时 Solid 还没把它插进 DOM，下一帧再抢焦点。
                              if (index() === 0) queueMicrotask(() => element.focus())
                            }}
                            onFocus={(event) => event.currentTarget.select()}
                            onInput={(event) => {
                              const value = event.currentTarget.value
                              setDrafting((current) =>
                                (current ?? []).map((item, at) => (at === index() ? value : item)),
                              )
                            }}
                            class="w-full rounded-[2px] border border-transparent bg-transparent px-1 py-0.5 text-black outline-none focus:border-emerald-400 focus:bg-emerald-50"
                            style={{ "font-size": `${Math.min(28, Math.max(12, displayScale() * 18))}px` }}
                          />
                        )}
                      </For>
                    </div>
                  </Show>
                  {/* 选中框：位置按 displayScale 换算回屏幕像素，只是给人看的，不挡点击。 */}
                  <Show when={target()?.box}>
                    {(box) => (
                      <div
                        class="pointer-events-none absolute z-20 border-2 border-emerald-400 bg-emerald-400/10"
                        style={{
                          left: `${box().x * displayScale()}px`,
                          top: `${box().y * displayScale()}px`,
                          width: `${box().w * displayScale()}px`,
                          height: `${box().h * displayScale()}px`,
                        }}
                      />
                    )}
                  </Show>
                </div>
              </div>
            </div>
          </div>
          {/* 元素评论：选中后写一句话，挂到输入框上方，发送时随消息带给模型。 */}
          <Show when={target()}>
            {(anchor) => (
              <div class="flex shrink-0 flex-col gap-2 border-t border-border bg-panel px-3 py-2.5">
                <div class="flex min-w-0 items-center gap-1.5">
                  <Icon name="window-cursor" size="small" class="shrink-0 text-foreground-subtle" />
                  <span class="truncate text-12-medium text-foreground">{slideElementLabel(anchor())}</span>
                  <span class="ml-auto shrink-0 text-11-regular text-foreground-subtlest">
                    说一句要改什么，发送后由 AI 改这一页
                  </span>
                </div>
                {/* 直接改字：画布上压一层输入框，回车/点保存写回 slideN.xml（只动这一块）。 */}
                <Show
                  when={drafting()}
                  fallback={
                    <>
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
                        class="min-h-14 w-full resize-y rounded-lg border border-border bg-background p-2 text-12-regular leading-relaxed text-foreground outline-none transition-colors focus:border-border-hover"
                      />
                      <div class="flex items-center gap-2">
                        <span class="min-w-0 flex-1 truncate text-11-regular text-foreground-subtlest">
                          添加到对话后可在输入框继续补充
                        </span>
                        <Show
                          when={
                            props.path && anchor().kind === "shape" && anchor().shapeId && anchor().paragraphs?.length
                          }
                        >
                          <button
                            type="button"
                            data-action="pptx-inline-start"
                            title="直接在画布上改这段文字，只改这一个形状"
                            class="rounded-lg px-2.5 py-1.5 text-12-medium text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
                            onClick={startInlineEdit}
                          >
                            直接改字
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
                    </>
                  }
                >
                  <div class="flex items-center gap-2">
                    <span class="min-w-0 flex-1 truncate text-11-regular text-foreground-subtlest">
                      改动只写回这一块的文字，其它页与素材不动；⌘/Ctrl+Enter 保存
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
              </div>
            )}
          </Show>
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
