import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { rebuildOfficeArtifact, type OfficeArtifact, type OfficeSlide } from "./office-artifact"
import { addOfficeSlide, moveOfficeSlide, removeOfficeSlide } from "./office-slide-editor-state"
import { officePptTemplatePreview, officePptTemplateSlidePreview, type OfficePptTemplateChoice } from "./office-export"
import { officeAssetKind, officeAssetTarget } from "./office-asset-kind"
import {
  xlsxSheetNamesFromBase64,
  type OfficeAssetContent,
  type OfficePptTemplateShape,
  officePptTemplateSlideShapes,
} from "./office-ppt-template-fill"

const slideLayoutOptions: OfficeSlide["layout"][] = [
  "cards",
  "comparison",
  "timeline",
  "highlight",
  "split",
  "chart",
  "architecture",
  "process",
  "matrix",
  "funnel",
  "pyramid",
  "cycle",
  "framework",
  "infographic",
  "map",
  "scene",
  "gantt",
  "donut",
  "waterfall",
  "heatmap",
  "radar",
  "venn",
  "fishbone",
  "journey",
  "kpi",
  "gauge",
  "roadmap",
  "mindmap",
  "pillars",
  "table",
  "schedule",
  "orgtree",
  "hbar",
  "line",
  "pareto",
  "bubble",
  "sankey",
  "treemap",
  "financial",
  "team",
]

export function OfficeSlideEditor(props: {
  artifact: OfficeArtifact
  template: OfficePptTemplateChoice
  assets: string[]
  readAsset?: (path: string) => Promise<OfficeAssetContent>
  onCopy: (artifact: OfficeArtifact) => void
  onExport: (artifact: OfficeArtifact) => void
  onSave: (artifact: OfficeArtifact) => void
  onRevise: (slide: OfficeSlide, mode: "polish" | "regenerate") => void
}) {
  const [slides, setSlides] = createStore<OfficeSlide[]>(props.artifact.slides.map((slide) => ({ ...slide })))
  const [activeIndex, setActiveIndex] = createSignal(0)
  const [previewFailed, setPreviewFailed] = createSignal(false)
  const [sheetNames, setSheetNames] = createSignal<string[]>([])
  const [sheetLoading, setSheetLoading] = createSignal(false)
  const [templateShapes, setTemplateShapes] = createSignal<OfficePptTemplateShape[]>([])
  const [selectedShapeId, setSelectedShapeId] = createSignal<number>()
  const [shapeDrag, setShapeDrag] = createSignal<{
    id: number
    mode: "move" | "resize"
    pointerId: number
    startClientX: number
    startClientY: number
    origin: { x: number; y: number; cx: number; cy: number }
  }>()
  const active = createMemo(() => slides[activeIndex()] ?? slides[0])
  const current = createMemo(() => rebuildOfficeArtifact(props.artifact, slides))
  const activePreview = createMemo(() => {
    const slide = active()
    return slide
      ? officePptTemplateSlidePreview(props.template, officeSlidePreviewRole(slide, slides.length))
      : undefined
  })
  const fallbackPreview = createMemo(() => officePptTemplatePreview(props.template))

  createEffect(() => {
    activeIndex()
    setPreviewFailed(false)
  })

  createEffect(async () => {
    const slide = active()
    const xlsxAsset = slide?.assets?.find((asset) => /\.xlsx$/i.test(asset))
    if (!xlsxAsset || !props.readAsset) {
      setSheetNames([])
      return
    }
    setSheetLoading(true)
    try {
      const content = await props.readAsset(xlsxAsset)
      const base64 = typeof content === "string" ? content : content.content
      setSheetNames(await xlsxSheetNamesFromBase64(base64))
    } catch {
      setSheetNames([])
    } finally {
      setSheetLoading(false)
    }
  })

  createEffect(async () => {
    activeIndex()
    setTemplateShapes([])
    const slide = active()
    const role = officeSlidePreviewRole(slide, slides.length)
    try {
      setTemplateShapes(
        await officePptTemplateSlideShapes(props.template, role, undefined, {
          pageIndex: activeIndex(),
          totalPages: slides.length,
        }),
      )
    } catch {
      setTemplateShapes([])
    }
  })

  function update(field: "title" | "content" | "visual" | "notes" | "layout", value: string) {
    const index = activeIndex()
    if (index < 0 || index >= slides.length) return
    if (field === "layout") {
      const layout = slideLayoutOptions.find((option) => option === value)
      setSlides(index, "layout", layout)
      return
    }
    setSlides(index, field, value)
  }

  function addSlide() {
    const next = addOfficeSlide(slides)
    setSlides(next)
    setActiveIndex(next.length - 1)
  }

  function removeSlide(index: number) {
    if (slides.length <= 1 || index < 0 || index >= slides.length) return
    const next = removeOfficeSlide(slides, index)
    setSlides(next)
    setActiveIndex(Math.min(index, next.length - 1))
  }

  function moveSlide(index: number, direction: -1 | 1) {
    const next = moveOfficeSlide(slides, index, direction)
    setSlides(next)
    setActiveIndex(index + direction)
  }

  function updateMotion(section: "transition" | "animation", field: "effect" | "duration" | "stagger", value: string) {
    const index = activeIndex()
    if (index < 0 || index >= slides.length) return
    const motion = active()?.motion ?? {}
    const sectionValue = motion[section] ?? {}
    const nextSection = {
      ...sectionValue,
      [field]: field === "effect" ? value || undefined : optionalNumber(value),
    }
    setSlides(index, "motion", { ...motion, [section]: nextSection })
  }

  function updateAudioTiming(field: "startFloor" | "padding", value: string) {
    const index = activeIndex()
    const audio = active()?.audio
    if (index < 0 || index >= slides.length || !audio) return
    const numberValue = optionalNumber(value) ?? 0
    setSlides(index, "audio", { ...audio, [field]: numberValue })
  }

  function toggleSlideAsset(asset: string) {
    const index = activeIndex()
    if (index < 0 || index >= slides.length) return
    const current = active()?.assets ?? []
    const next = current.includes(asset) ? current.filter((item) => item !== asset) : [...current, asset]
    setSlides(index, "assets", next)
  }

  function updateChartType(value: string) {
    const index = activeIndex()
    if (index < 0 || index >= slides.length) return
    const chartType = (
      ["bar", "line", "area", "radar", "scatter", "bubble", "donut", "waterfall", "combo"] as OfficeSlide["chartType"][]
    ).find((item) => item === value)
    setSlides(index, "chartType", chartType)
  }

  function updateChartOption(field: "showDataLabels" | "showLegend" | "showPercent" | "showGridlines", value: boolean) {
    const index = activeIndex()
    if (index < 0 || index >= slides.length) return
    const current = active()?.chartOptions ?? {}
    setSlides(index, "chartOptions", { ...current, [field]: value })
  }

  function updateChartTitle(value: string) {
    const index = activeIndex()
    if (index < 0 || index >= slides.length) return
    const current = active()?.chartOptions ?? {}
    setSlides(index, "chartOptions", { ...current, title: value })
  }

  function updateChartSheet(value: string) {
    const index = activeIndex()
    if (index < 0 || index >= slides.length) return
    const current = active()?.chartOptions ?? {}
    setSlides(index, "chartOptions", { ...current, xlsxSheet: value || undefined })
  }

  function updateChartAxisTitle(field: "xAxisTitle" | "yAxisTitle", value: string) {
    const index = activeIndex()
    if (index < 0 || index >= slides.length) return
    const current = active()?.chartOptions ?? {}
    setSlides(index, "chartOptions", { ...current, [field]: value })
  }

  function updateChartLegendPosition(value: string) {
    const index = activeIndex()
    if (index < 0 || index >= slides.length) return
    const position = (["bottom", "right", "top", "left"] as const).find((item) => item === value)
    if (!position) return
    const current = active()?.chartOptions ?? {}
    setSlides(index, "chartOptions", { ...current, legendPosition: position })
  }

  function updateChartSort(value: string) {
    const index = activeIndex()
    if (index < 0 || index >= slides.length) return
    const sortData = (["none", "asc", "desc"] as const).find((item) => item === value)
    if (!sortData) return
    const current = active()?.chartOptions ?? {}
    setSlides(index, "chartOptions", { ...current, sortData })
  }

  function updateChartColor(colorIndex: 0 | 1, value: string) {
    const index = activeIndex()
    if (index < 0 || index >= slides.length) return
    const current = active()?.chartOptions ?? {}
    const colors = [...(current.colors ?? ["2FBF8F", "1954A6"])]
    colors[colorIndex] = value.replace(/^#/, "").toUpperCase()
    setSlides(index, "chartOptions", { ...current, colors })
  }

  function shapeGeometry(shape: OfficePptTemplateShape) {
    const override = active()?.shapeOverrides?.find((item) => item.id === shape.id)
    return {
      x: override?.x ?? shape.x,
      y: override?.y ?? shape.y,
      cx: override?.cx ?? shape.cx,
      cy: override?.cy ?? shape.cy,
    }
  }

  function shapeStyle(shape: OfficePptTemplateShape) {
    const geometry = shapeGeometry(shape)
    return {
      left: `${(geometry.x / 12192000) * 100}%`,
      top: `${(geometry.y / 6858000) * 100}%`,
      width: `${(geometry.cx / 12192000) * 100}%`,
      height: `${(geometry.cy / 6858000) * 100}%`,
    }
  }

  function updateShapeOverride(shape: OfficePptTemplateShape, patch: Partial<OfficePptTemplateShape>) {
    const index = activeIndex()
    if (index < 0 || index >= slides.length) return
    const current = active()?.shapeOverrides ?? []
    const existing = current.find((item) => item.id === shape.id)
    const next = existing ? { ...existing, ...patch } : { id: shape.id, ...patch }
    setSlides(index, "shapeOverrides", [...current.filter((item) => item.id !== shape.id), next])
  }

  function selectedShape() {
    return templateShapes().find((shape) => shape.id === selectedShapeId())
  }

  function updateSelectedGeometry(field: "x" | "y" | "cx" | "cy", value: string) {
    const shape = selectedShape()
    if (!shape) return
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed < 0) return
    updateShapeOverride(shape, { [field]: Math.round(parsed) })
  }

  function startShapeDrag(shape: OfficePptTemplateShape, mode: "move" | "resize", event: PointerEvent) {
    event.preventDefault()
    const target = event.currentTarget
    if (!(target instanceof HTMLElement)) return
    setSelectedShapeId(shape.id)
    const canvas = target.closest("[data-office-canvas]")
    if (!(canvas instanceof HTMLElement)) return
    setShapeDrag({
      id: shape.id,
      mode,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      origin: shapeGeometry(shape),
    })
    target.setPointerCapture(event.pointerId)
  }

  function moveShapeDrag(shape: OfficePptTemplateShape, event: PointerEvent) {
    const drag = shapeDrag()
    if (!drag || drag.id !== shape.id || drag.pointerId !== event.pointerId) return
    const target = event.currentTarget
    if (!(target instanceof HTMLElement)) return
    const canvas = target.closest("[data-office-canvas]")
    if (!(canvas instanceof HTMLElement)) return
    const rect = canvas.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const dx = ((event.clientX - drag.startClientX) / rect.width) * 12192000
    const dy = ((event.clientY - drag.startClientY) / rect.height) * 6858000
    if (drag.mode === "move") {
      updateShapeOverride(shape, {
        x: Math.max(0, Math.round(drag.origin.x + dx)),
        y: Math.max(0, Math.round(drag.origin.y + dy)),
        cx: drag.origin.cx,
        cy: drag.origin.cy,
      })
      return
    }
    updateShapeOverride(shape, {
      x: drag.origin.x,
      y: drag.origin.y,
      cx: Math.max(10000, Math.round(drag.origin.cx + dx)),
      cy: Math.max(10000, Math.round(drag.origin.cy + dy)),
    })
  }

  function endShapeDrag(event: PointerEvent) {
    const drag = shapeDrag()
    if (!drag || drag.pointerId !== event.pointerId) return
    setShapeDrag(undefined)
    const target = event.currentTarget
    if (target instanceof HTMLElement && target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId)
    }
  }

  function resetShapeLayout() {
    const index = activeIndex()
    if (index < 0 || index >= slides.length) return
    setSlides(index, "shapeOverrides", undefined)
  }

  const inputClass =
    "w-full rounded-[8px] border border-border-weak-base bg-background-base px-3 py-2 text-13-regular leading-relaxed text-text-strong outline-none transition-colors placeholder:text-text-muted focus:border-emerald-300/70 focus:ring-2 focus:ring-emerald-300/25"

  return (
    <Dialog title={`逐页编辑：${props.artifact.title}`} class="w-full max-w-[1400px] mx-auto">
      <div class="flex min-h-[78vh] max-h-[86vh] flex-col overflow-hidden md:flex-row">
        <aside class="w-full shrink-0 space-y-1 overflow-y-auto border-b border-border-weaker-base bg-surface-raised-base/40 p-2 md:w-64 md:border-b-0 md:border-r">
          <div class="flex items-center justify-between gap-2 px-1 py-1">
            <span class="text-11-medium text-text-muted">页面</span>
            <button
              type="button"
              class="grid size-6 place-items-center rounded-[6px] border border-border-weak-base bg-background-base text-text-muted transition-colors hover:border-emerald-300/50 hover:text-emerald-200"
              title="新增页面"
              onClick={addSlide}
            >
              <Icon name="plus" size="small" />
            </button>
          </div>
          <For each={slides}>
            {(slide, index) => (
              <div
                class="flex items-center gap-1 rounded-[8px] p-1 transition-colors"
                classList={{
                  "bg-emerald-300/12": index() === activeIndex(),
                  "hover:bg-surface-raised-base": index() !== activeIndex(),
                }}
              >
                <button
                  type="button"
                  class="flex min-w-0 flex-1 items-center gap-2 rounded-[7px] px-2 py-2 text-left"
                  onClick={() => setActiveIndex(index())}
                >
                  <span class="grid h-9 w-14 shrink-0 place-items-center overflow-hidden rounded-[5px] border border-border-weak-base bg-background-base">
                    <Show
                      when={slideThumbnail(props.template, slide, slides.length)}
                      fallback={
                        <span class="grid size-6 place-items-center text-11-medium text-text-muted">{slide.index}</span>
                      }
                    >
                      {(src) => (
                        <img
                          src={src()}
                          alt=""
                          class="h-full w-full object-cover"
                          onError={(event) => {
                            event.currentTarget.style.display = "none"
                          }}
                        />
                      )}
                    </Show>
                  </span>
                  <span class="min-w-0 flex-1 truncate text-12-medium text-text-weak">
                    {slide.title || `第 ${slide.index} 页`}
                  </span>
                </button>
                <div class="flex shrink-0 flex-col items-center">
                  <button
                    type="button"
                    class="grid size-5 place-items-center rounded-[5px] text-text-muted transition-colors hover:bg-background-base hover:text-text-strong disabled:opacity-30"
                    title="上移"
                    disabled={index() === 0}
                    onClick={() => moveSlide(index(), -1)}
                  >
                    <Icon name="arrow-up" size="small" />
                  </button>
                  <button
                    type="button"
                    class="grid size-5 place-items-center rounded-[5px] text-text-muted transition-colors hover:bg-background-base hover:text-text-strong disabled:opacity-30"
                    title="下移"
                    disabled={index() === slides.length - 1}
                    onClick={() => moveSlide(index(), 1)}
                  >
                    <Icon name="chevron-down" size="small" />
                  </button>
                </div>
                <button
                  type="button"
                  class="grid size-6 shrink-0 place-items-center rounded-[6px] text-text-muted transition-colors hover:bg-red-500/10 hover:text-red-400"
                  title="删除页面"
                  onClick={() => removeSlide(index())}
                >
                  <Icon name="trash" size="small" />
                </button>
              </div>
            )}
          </For>
        </aside>

        <div class="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.72fr)]">
          <section class="min-w-0 space-y-3 p-4 order-last">
            <label class="block">
              <span class="mb-1.5 block text-12-medium text-text-muted">页面标题</span>
              <input
                value={active()?.title ?? ""}
                onInput={(event) => update("title", event.currentTarget.value)}
                class={inputClass}
              />
            </label>

            <div class="grid gap-3 sm:grid-cols-2">
              <label class="block">
                <span class="mb-1.5 block text-12-medium text-text-muted">版式</span>
                <select
                  value={active()?.layout ?? ""}
                  onChange={(event) => update("layout", event.currentTarget.value)}
                  class="w-full rounded-[8px] border border-border-weak-base bg-background-base px-3 py-2 text-13-regular text-text-strong outline-none focus:border-emerald-300/70 focus:ring-2 focus:ring-emerald-300/25"
                >
                  <option value="">自动</option>
                  <For each={slideLayoutOptions}>{(layout) => <option value={layout}>{layout}</option>}</For>
                </select>
              </label>
              <div class="flex items-end">
                <Show when={active()?.layout}>
                  {(layout) => (
                    <span class="rounded-[6px] border border-emerald-300/30 bg-emerald-300/10 px-2 py-1 text-11-medium text-emerald-100">
                      {layout()}
                    </span>
                  )}
                </Show>
              </div>
            </div>

            <label class="block">
              <span class="mb-1.5 flex items-center justify-between text-12-medium text-text-muted">
                <span>图表类型</span>
                <Show
                  when={active()?.chartType && active()?.assets?.some((asset) => officeAssetKind(asset) === "data")}
                >
                  <span class="rounded-[5px] border border-emerald-300/30 bg-emerald-300/10 px-1.5 py-0.5 text-10-medium text-emerald-200">
                    自动匹配
                  </span>
                </Show>
              </span>
              <select
                value={active()?.chartType ?? ""}
                onChange={(event) => updateChartType(event.currentTarget.value)}
                class="w-full rounded-[8px] border border-border-weak-base bg-background-base px-3 py-2 text-13-regular text-text-strong outline-none focus:border-emerald-300/70 focus:ring-2 focus:ring-emerald-300/25"
              >
                <option value="">自动</option>
                <option value="bar">柱状</option>
                <option value="line">折线</option>
                <option value="area">面积</option>
                <option value="radar">雷达</option>
                <option value="scatter">散点</option>
                <option value="bubble">气泡</option>
                <option value="donut">环形</option>
                <option value="waterfall">瀑布</option>
                <option value="combo">柱线组合</option>
              </select>
            </label>

            <label class="block">
              <span class="mb-1.5 block text-12-medium text-text-muted">图表标题</span>
              <input
                value={active()?.chartOptions?.title ?? ""}
                onInput={(event) => updateChartTitle(event.currentTarget.value)}
                class={inputClass}
              />
            </label>

            <label class="block">
              <span class="mb-1.5 flex items-center justify-between text-12-medium text-text-muted">
                <span>XLSX 工作表</span>
                <Show when={sheetLoading()}>
                  <span class="text-10-medium text-text-muted">读取中</span>
                </Show>
              </span>
              <Show
                when={sheetNames().length > 0}
                fallback={
                  <input
                    value={active()?.chartOptions?.xlsxSheet ?? ""}
                    onInput={(event) => updateChartSheet(event.currentTarget.value)}
                    placeholder="留空时自动选择第一个有数据的工作表"
                    class={inputClass}
                  />
                }
              >
                <select
                  value={active()?.chartOptions?.xlsxSheet ?? ""}
                  onChange={(event) => updateChartSheet(event.currentTarget.value)}
                  class="w-full rounded-[8px] border border-border-weak-base bg-background-base px-3 py-2 text-13-regular text-text-strong outline-none focus:border-emerald-300/70 focus:ring-2 focus:ring-emerald-300/25"
                >
                  <option value="">自动</option>
                  <For each={sheetNames()}>{(name) => <option value={name}>{name}</option>}</For>
                </select>
              </Show>
            </label>

            <div class="grid grid-cols-2 gap-3">
              <label class="block">
                <span class="mb-1.5 block text-12-medium text-text-muted">横轴标题</span>
                <input
                  value={active()?.chartOptions?.xAxisTitle ?? ""}
                  onInput={(event) => updateChartAxisTitle("xAxisTitle", event.currentTarget.value)}
                  class={inputClass}
                />
              </label>
              <label class="block">
                <span class="mb-1.5 block text-12-medium text-text-muted">纵轴标题</span>
                <input
                  value={active()?.chartOptions?.yAxisTitle ?? ""}
                  onInput={(event) => updateChartAxisTitle("yAxisTitle", event.currentTarget.value)}
                  class={inputClass}
                />
              </label>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <label class="flex h-9 items-center gap-2 rounded-[8px] border border-border-weak-base bg-background-panel px-3">
                <input
                  type="checkbox"
                  checked={active()?.chartOptions?.showDataLabels ?? false}
                  onChange={(event) => updateChartOption("showDataLabels", event.currentTarget.checked)}
                  class="size-3.5 accent-emerald-400"
                />
                <span class="text-12-medium text-text-weak">数据标签</span>
              </label>
              <label class="flex h-9 items-center gap-2 rounded-[8px] border border-border-weak-base bg-background-panel px-3">
                <input
                  type="checkbox"
                  checked={active()?.chartOptions?.showLegend ?? false}
                  onChange={(event) => updateChartOption("showLegend", event.currentTarget.checked)}
                  class="size-3.5 accent-emerald-400"
                />
                <span class="text-12-medium text-text-weak">图例</span>
              </label>
            </div>

            <label class="block">
              <span class="mb-1.5 block text-12-medium text-text-muted">图例位置</span>
              <select
                value={active()?.chartOptions?.legendPosition ?? "bottom"}
                onChange={(event) => updateChartLegendPosition(event.currentTarget.value)}
                class="w-full rounded-[8px] border border-border-weak-base bg-background-base px-3 py-2 text-13-regular text-text-strong outline-none focus:border-emerald-300/70 focus:ring-2 focus:ring-emerald-300/25"
              >
                <option value="bottom">底部</option>
                <option value="right">右侧</option>
                <option value="top">顶部</option>
                <option value="left">左侧</option>
              </select>
            </label>

            <label class="block">
              <span class="mb-1.5 block text-12-medium text-text-muted">数据排序</span>
              <select
                value={active()?.chartOptions?.sortData ?? "none"}
                onChange={(event) => updateChartSort(event.currentTarget.value)}
                class="w-full rounded-[8px] border border-border-weak-base bg-background-base px-3 py-2 text-13-regular text-text-strong outline-none focus:border-emerald-300/70 focus:ring-2 focus:ring-emerald-300/25"
              >
                <option value="none">不排序</option>
                <option value="asc">升序</option>
                <option value="desc">降序</option>
              </select>
            </label>

            <label class="flex h-9 items-center gap-2 rounded-[8px] border border-border-weak-base bg-background-panel px-3">
              <input
                type="checkbox"
                checked={active()?.chartOptions?.showPercent ?? false}
                onChange={(event) => updateChartOption("showPercent", event.currentTarget.checked)}
                class="size-3.5 accent-emerald-400"
              />
              <span class="text-12-medium text-text-weak">百分比标签</span>
            </label>

            <label class="flex h-9 items-center gap-2 rounded-[8px] border border-border-weak-base bg-background-panel px-3">
              <input
                type="checkbox"
                checked={active()?.chartOptions?.showGridlines ?? true}
                onChange={(event) => updateChartOption("showGridlines", event.currentTarget.checked)}
                class="size-3.5 accent-emerald-400"
              />
              <span class="text-12-medium text-text-weak">网格线</span>
            </label>

            <div class="grid grid-cols-2 gap-3">
              <label class="flex h-9 items-center gap-2 rounded-[8px] border border-border-weak-base bg-background-panel px-3">
                <input
                  type="color"
                  value={`#${active()?.chartOptions?.colors?.[0] ?? "2FBF8F"}`}
                  onInput={(event) => updateChartColor(0, event.currentTarget.value)}
                  class="size-5 shrink-0 cursor-pointer rounded-[5px] border-0 bg-transparent p-0"
                />
                <span class="text-12-medium text-text-weak">主色</span>
              </label>
              <label class="flex h-9 items-center gap-2 rounded-[8px] border border-border-weak-base bg-background-panel px-3">
                <input
                  type="color"
                  value={`#${active()?.chartOptions?.colors?.[1] ?? "1954A6"}`}
                  onInput={(event) => updateChartColor(1, event.currentTarget.value)}
                  class="size-5 shrink-0 cursor-pointer rounded-[5px] border-0 bg-transparent p-0"
                />
                <span class="text-12-medium text-text-weak">辅色</span>
              </label>
            </div>

            <label class="block">
              <span class="mb-1.5 block text-12-medium text-text-muted">主文案</span>
              <textarea
                value={active()?.content ?? ""}
                onInput={(event) => update("content", event.currentTarget.value)}
                rows={7}
                class={inputClass}
              />
            </label>

            <label class="block">
              <span class="mb-1.5 block text-12-medium text-text-muted">视觉建议</span>
              <textarea
                value={active()?.visual ?? ""}
                onInput={(event) => update("visual", event.currentTarget.value)}
                rows={3}
                class={inputClass}
              />
            </label>

            <label class="block">
              <span class="mb-1.5 block text-12-medium text-text-muted">演讲备注</span>
              <textarea
                value={active()?.notes ?? ""}
                onInput={(event) => update("notes", event.currentTarget.value)}
                rows={4}
                class={inputClass}
              />
            </label>

            <fieldset class="rounded-[8px] border border-border-weak-base bg-background-panel p-3">
              <legend class="px-1 text-11-medium text-text-muted">逐页动画</legend>
              <div class="grid gap-3 sm:grid-cols-2">
                <label class="block">
                  <span class="mb-1.5 block text-12-medium text-text-muted">转场</span>
                  <select
                    value={active()?.motion?.transition?.effect ?? ""}
                    onChange={(event) => updateMotion("transition", "effect", event.currentTarget.value)}
                    class="w-full rounded-[8px] border border-border-weak-base bg-background-base px-3 py-2 text-13-regular text-text-strong outline-none focus:border-emerald-300/70 focus:ring-2 focus:ring-emerald-300/25"
                  >
                    <option value="">自动</option>
                    <option value="fade">淡入</option>
                    <option value="wipe">擦除</option>
                    <option value="push">推入</option>
                  </select>
                </label>
                <label class="block">
                  <span class="mb-1.5 block text-12-medium text-text-muted">转场时长</span>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={active()?.motion?.transition?.duration ?? ""}
                    onInput={(event) => updateMotion("transition", "duration", event.currentTarget.value)}
                    class={inputClass}
                  />
                </label>
                <label class="block">
                  <span class="mb-1.5 block text-12-medium text-text-muted">动画效果</span>
                  <select
                    value={active()?.motion?.animation?.effect ?? ""}
                    onChange={(event) => updateMotion("animation", "effect", event.currentTarget.value)}
                    class="w-full rounded-[8px] border border-border-weak-base bg-background-base px-3 py-2 text-13-regular text-text-strong outline-none focus:border-emerald-300/70 focus:ring-2 focus:ring-emerald-300/25"
                  >
                    <option value="">自动</option>
                    <option value="fade">淡入</option>
                    <option value="wipe">擦除</option>
                    <option value="fly">飞入</option>
                    <option value="zoom">缩放</option>
                  </select>
                </label>
                <div class="grid grid-cols-2 gap-3">
                  <label class="block">
                    <span class="mb-1.5 block text-12-medium text-text-muted">时长</span>
                    <input
                      type="number"
                      min="0.1"
                      step="0.1"
                      value={active()?.motion?.animation?.duration ?? ""}
                      onInput={(event) => updateMotion("animation", "duration", event.currentTarget.value)}
                      class={inputClass}
                    />
                  </label>
                  <label class="block">
                    <span class="mb-1.5 block text-12-medium text-text-muted">间隔</span>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={active()?.motion?.animation?.stagger ?? ""}
                      onInput={(event) => updateMotion("animation", "stagger", event.currentTarget.value)}
                      class={inputClass}
                    />
                  </label>
                </div>
              </div>
              <Show when={active()?.audio}>
                <div class="mt-3 grid grid-cols-2 gap-3 border-t border-border-weaker-base pt-3">
                  <label class="block">
                    <span class="mb-1.5 block text-12-medium text-text-muted">旁白起步</span>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={active()?.audio?.startFloor ?? 0.8}
                      onInput={(event) => updateAudioTiming("startFloor", event.currentTarget.value)}
                      class={inputClass}
                    />
                  </label>
                  <label class="block">
                    <span class="mb-1.5 block text-12-medium text-text-muted">页尾停留</span>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={active()?.audio?.padding ?? 0.5}
                      onInput={(event) => updateAudioTiming("padding", event.currentTarget.value)}
                      class={inputClass}
                    />
                  </label>
                </div>
              </Show>
            </fieldset>

            <fieldset class="rounded-[8px] border border-border-weak-base bg-background-panel p-3">
              <legend class="px-1 text-11-medium text-text-muted">本页素材</legend>
              <div class="flex max-h-40 flex-col gap-1 overflow-y-auto">
                <For each={props.assets}>
                  {(asset) => {
                    const selected = active()?.assets?.includes(asset)
                    return (
                      <label class="flex items-center gap-2 rounded-[7px] px-2 py-1.5 transition-colors hover:bg-surface-raised-base">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleSlideAsset(asset)}
                          class="size-3.5 shrink-0 accent-emerald-400"
                        />
                        <span class="min-w-0 flex-1 truncate text-12-regular text-text-weak">{asset}</span>
                        <span class="shrink-0 rounded-[5px] border border-border-weak-base px-1.5 py-0.5 text-10-medium text-text-muted">
                          {officeAssetTarget(asset)}
                        </span>
                      </label>
                    )
                  }}
                </For>
                <Show when={props.assets.length === 0}>
                  <div class="px-2 py-1.5 text-12-regular text-text-muted">请先通过项目素材库选择素材。</div>
                </Show>
              </div>
            </fieldset>
          </section>

          <section class="min-w-0 border-t border-border-weaker-base bg-surface-raised-base/45 p-4 order-first lg:border-r lg:border-t-0">
            <div class="rounded-[8px] border border-border-weak-base bg-background-panel p-4 shadow-[0_14px_40px_rgba(0,0,0,0.10)]">
              <div class="flex items-start justify-between gap-3 border-b border-border-weaker-base pb-3">
                <div class="min-w-0">
                  <div class="text-11-medium text-emerald-200">第 {active()?.index ?? 0} 页</div>
                  <div class="mt-1 truncate text-16-medium text-text-strong">{active()?.title || "未命名页面"}</div>
                </div>
                <Icon name="layout-bottom" size="small" class="shrink-0 text-icon-weak" />
              </div>
              <div class="flex justify-end pb-2">
                <button
                  type="button"
                  class="rounded-[6px] border border-border-weak-base px-2 py-1 text-10-medium text-text-muted transition-colors hover:bg-surface-raised-base hover:text-text-strong"
                  onClick={resetShapeLayout}
                >
                  重置布局
                </button>
              </div>
              <Show when={selectedShape()}>
                {(shape) => (
                  <div class="mb-3 grid grid-cols-4 gap-2 rounded-[8px] border border-border-weak-base bg-background-base p-2">
                    <label class="block">
                      <span class="mb-1 block text-10-medium text-text-muted">X</span>
                      <input
                        type="number"
                        min="0"
                        value={shapeGeometry(shape()).x}
                        onInput={(event) => updateSelectedGeometry("x", event.currentTarget.value)}
                        class="w-full rounded-[6px] border border-border-weak-base bg-background-panel px-2 py-1 text-11-regular text-text-strong outline-none"
                      />
                    </label>
                    <label class="block">
                      <span class="mb-1 block text-10-medium text-text-muted">Y</span>
                      <input
                        type="number"
                        min="0"
                        value={shapeGeometry(shape()).y}
                        onInput={(event) => updateSelectedGeometry("y", event.currentTarget.value)}
                        class="w-full rounded-[6px] border border-border-weak-base bg-background-panel px-2 py-1 text-11-regular text-text-strong outline-none"
                      />
                    </label>
                    <label class="block">
                      <span class="mb-1 block text-10-medium text-text-muted">宽</span>
                      <input
                        type="number"
                        min="10000"
                        value={shapeGeometry(shape()).cx}
                        onInput={(event) => updateSelectedGeometry("cx", event.currentTarget.value)}
                        class="w-full rounded-[6px] border border-border-weak-base bg-background-panel px-2 py-1 text-11-regular text-text-strong outline-none"
                      />
                    </label>
                    <label class="block">
                      <span class="mb-1 block text-10-medium text-text-muted">高</span>
                      <input
                        type="number"
                        min="10000"
                        value={shapeGeometry(shape()).cy}
                        onInput={(event) => updateSelectedGeometry("cy", event.currentTarget.value)}
                        class="w-full rounded-[6px] border border-border-weak-base bg-background-panel px-2 py-1 text-11-regular text-text-strong outline-none"
                      />
                    </label>
                  </div>
                )}
              </Show>
              <Show when={activePreview() && !previewFailed()}>
                <div
                  data-office-canvas
                  class="relative mt-3 overflow-hidden rounded-[8px] border border-border-weaker-base bg-background-base"
                >
                  <img
                    src={activePreview()}
                    alt={active()?.title ?? "模板预览"}
                    class="aspect-[16/9] max-h-[58vh] w-full object-contain"
                    onError={(event) => {
                      const fallback = fallbackPreview()
                      const currentSrc = event.currentTarget.getAttribute("src") ?? ""
                      if (fallback && !currentSrc.endsWith(fallback)) {
                        event.currentTarget.setAttribute("src", fallback)
                        return
                      }
                      setPreviewFailed(true)
                    }}
                  />
                  <Show when={templateShapes().length > 0}>
                    <div class="pointer-events-none absolute inset-0">
                      <For each={templateShapes()}>
                        {(shape) => (
                          <div
                            class="pointer-events-auto absolute cursor-move rounded-[3px] border border-cyan-300/80 bg-cyan-300/10 shadow-[0_0_0_1px_rgba(103,232,249,0.25),0_8px_24px_rgba(0,0,0,0.22)]"
                            style={shapeStyle(shape)}
                            title={shape.name || shape.kind}
                            onPointerDown={(event) => startShapeDrag(shape, "move", event)}
                            onPointerMove={(event) => moveShapeDrag(shape, event)}
                            onPointerUp={endShapeDrag}
                          >
                            <span class="pointer-events-none absolute -top-5 left-0 max-w-full truncate rounded-[4px] bg-cyan-300 px-1.5 py-0.5 text-9-medium text-slate-900">
                              {shape.kind === "text" ? shape.text || shape.name : shape.kind}
                            </span>
                            <div
                              class="absolute -bottom-1.5 -right-1.5 size-3.5 cursor-nwse-resize rounded-full border border-cyan-200 bg-cyan-300 shadow-[0_2px_8px_rgba(0,0,0,0.28)]"
                              onPointerDown={(event) => {
                                event.stopPropagation()
                                startShapeDrag(shape, "resize", event)
                              }}
                              onPointerMove={(event) => moveShapeDrag(shape, event)}
                              onPointerUp={endShapeDrag}
                            />
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              </Show>
              <Show when={!activePreview() || previewFailed()}>
                <div class="mt-3 flex flex-col gap-2">
                  <For each={previewLines(active())}>
                    {(line, index) => (
                      <div
                        classList={{
                          "text-13-medium text-emerald-100": index() === 0,
                          "text-12-regular leading-relaxed text-text-weak": index() !== 0,
                        }}
                      >
                        {line}
                      </div>
                    )}
                  </For>
                  <Show when={!active()?.content?.trim()}>
                    <div class="text-12-regular text-text-muted">暂无页面正文，请补充主文案后导出。</div>
                  </Show>
                </div>
              </Show>
            </div>
          </section>
        </div>
      </div>

      <div class="flex flex-wrap items-center justify-end gap-2 border-t border-border-weaker-base px-5 py-3">
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-[8px] border border-cyan-300/35 bg-cyan-300/[0.08] px-3 py-2 text-12-medium text-cyan-100 transition-colors hover:bg-cyan-300/15"
          onClick={() => props.onRevise(active(), "polish")}
        >
          <Icon name="pencil-line" size="small" />
          <span>AI 润色本页</span>
        </button>
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-[8px] border border-cyan-300/35 bg-cyan-300/[0.08] px-3 py-2 text-12-medium text-cyan-100 transition-colors hover:bg-cyan-300/15"
          onClick={() => props.onRevise(active(), "regenerate")}
        >
          <Icon name="refresh" size="small" />
          <span>AI 重新生成本页</span>
        </button>
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-[8px] border border-border-weak-base bg-background-base px-3 py-2 text-12-medium text-text-weak transition-colors hover:bg-surface-raised-base hover:text-text-strong"
          onClick={() => props.onCopy(current())}
        >
          <Icon name="copy" size="small" />
          <span>复制修改产物</span>
        </button>
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-[8px] border border-border-weak-base bg-background-base px-3 py-2 text-12-medium text-text-weak transition-colors hover:bg-surface-raised-base hover:text-text-strong"
          onClick={() => props.onSave(current())}
        >
          <Icon name="folder-add-left" size="small" />
          <span>保存修改到项目</span>
        </button>
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-[8px] border border-emerald-300/45 bg-emerald-300/10 px-3 py-2 text-12-medium text-emerald-100 transition-colors hover:bg-emerald-300/18"
          onClick={() => props.onExport(current())}
        >
          <Icon name="download" size="small" />
          <span>导出修改 PPTX</span>
        </button>
      </div>
    </Dialog>
  )
}

function previewLines(slide: OfficeSlide | undefined) {
  if (!slide) return []
  return [
    slide.title,
    ...slide.content
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
    ...(slide.visual?.trim() ? [slide.visual.trim()] : []),
    ...(slide.notes?.trim() ? [slide.notes.trim()] : []),
  ].slice(0, 8)
}

const dataPreviewLayouts = new Set([
  "chart",
  "data",
  "table",
  "schedule",
  "gantt",
  "donut",
  "waterfall",
  "heatmap",
  "radar",
  "kpi",
  "gauge",
  "line",
  "hbar",
  "pareto",
  "bubble",
  "sankey",
  "treemap",
  "financial",
])

const cardsPreviewLayouts = new Set(["cards", "comparison", "team", "matrix", "orgtree"])

function officeSlidePreviewRole(slide: OfficeSlide, total: number) {
  if (slide.index <= 1 || total <= 1) return "cover"
  if (slide.index === total) return "closing"
  if (
    dataPreviewLayouts.has(slide.layout ?? "") ||
    /图表|表格|数据|指标|预算|甘特|排期|schedule|gantt|chart|table|kpi/i.test(slide.content)
  )
    return "data"
  if (cardsPreviewLayouts.has(slide.layout ?? "")) return "cards"
  if (slide.index <= 3) return "overview"
  return "content"
}

function slideThumbnail(template: OfficePptTemplateChoice, slide: OfficeSlide, total: number) {
  return officePptTemplateSlidePreview(template, officeSlidePreviewRole(slide, total))
}

function optionalNumber(value: string) {
  if (!value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}
