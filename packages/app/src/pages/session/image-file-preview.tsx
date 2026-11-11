/**
 * 独立图片查看器：
 * 缩放 / 适应、旋转 90°、水平/垂直翻转、全屏、裁剪、标注。
 *
 * 缩放、全屏只是显示层，不写盘；旋转/翻转、裁剪、标注通过 `onSaveImage(base64)`
 * 持久化（画布重新编码成 base64 写回）。所有可持久化的编辑都先落到离屏 canvas，
 * 点「应用」才写回，取消则丢弃。
 */
import { createEffect, createMemo, createSignal, For, onCleanup, Show, type Component } from "solid-js"
import { Icon } from "@novaway/ui/icon"
import { Button } from "@novaway/ui/button"
import { Dialog } from "@novaway/ui/dialog"
import { useDialog } from "@novaway/ui/context/dialog"
import { base64ToBytes } from "@/pages/session/office-preview-utils"
import {
  canvasToBase64,
  drawCropped,
  drawFlipped,
  drawRotated,
  loadImage,
  mimeOf,
  paintStroke,
  type AnnotateTool,
  type Stroke,
} from "@/pages/session/image-geometry"
import { PaneStatusBar } from "@/pages/session/pane-status-bar"

function objectUrlOf(base64: string, mime: string): string | undefined {
  if (!base64) return undefined
  return URL.createObjectURL(new Blob([base64ToBytes(base64)], { type: mime }))
}

export type ImageSave = (base64: string) => Promise<void>

const TOOL_META: Array<{ tool: AnnotateTool; icon: Parameters<typeof Icon>[0]["name"]; label: string }> = [
  { tool: "pen", icon: "lu-pen-line", label: "画笔" },
  { tool: "highlighter", icon: "lu-highlighter", label: "荧光笔" },
  { tool: "arrow", icon: "lu-arrow-up-right", label: "箭头" },
  { tool: "text", icon: "lu-type", label: "文字" },
  { tool: "rect", icon: "lu-square", label: "方框" },
  { tool: "circle", icon: "lu-circle", label: "圆圈" },
]

export const ImageFilePreview: Component<{ base64: string; path: string; onSaveImage?: ImageSave }> = (props) => {
  const [zoom, setZoom] = createSignal(100)
  const [natural, setNatural] = createSignal<{ width: number; height: number }>()
  const [viewQuarter, setViewQuarter] = createSignal(0)
  const [flipH, setFlipH] = createSignal(false)
  const [flipV, setFlipV] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const dialog = useDialog()
  let imgEl: HTMLImageElement | undefined

  const mime = () => mimeOf(props.path)
  const url = createMemo(() => objectUrlOf(props.base64, mime()))
  onCleanup(() => {
    const value = url()
    if (value) URL.revokeObjectURL(value)
  })

  const onLoad = () => {
    if (imgEl && imgEl.naturalWidth > 0) setNatural({ width: imgEl.naturalWidth, height: imgEl.naturalHeight })
  }

  const viewTransform = () => {
    const q = ((viewQuarter() % 4) + 4) % 4
    const flip = flipH() ? "scaleX(-1)" : flipV() ? "scaleY(-1)" : ""
    const rotate = q ? `rotate(${q * 90}deg)` : ""
    return [flip, rotate].filter(Boolean).join(" ")
  }

  const persist = async (base64: string) => {
    if (!props.onSaveImage) return
    setBusy(true)
    try {
      await props.onSaveImage(base64)
    } finally {
      setBusy(false)
    }
  }

  const applyRotate = async (quarters: number) => {
    const src = url()
    if (!src || busy()) return
    try {
      const img = await loadImage(src)
      const next = drawRotated(img, quarters)
      await persist(canvasToBase64(next))
      setViewQuarter((q) => q + quarters)
    } catch {
      /* 解码失败静默。 */
    }
  }

  const applyFlip = async (horizontal: boolean) => {
    const src = url()
    if (!src || busy()) return
    try {
      const img = await loadImage(src)
      const next = drawFlipped(img, horizontal, !horizontal)
      await persist(canvasToBase64(next))
      if (horizontal) setFlipH((v) => !v)
      else setFlipV((v) => !v)
    } catch {
      /* 静默。 */
    }
  }

  const fullscreen = () => {
    const el = document.querySelector<HTMLElement>('[data-component="pane-image-preview"]')
    if (!el) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void el.requestFullscreen().catch(() => undefined)
  }

  /** 弹裁剪框；应用返回新 base64，取消返回 undefined。 */
  const openCrop = () =>
    new Promise<string | undefined>((resolve) => {
      let settled = false
      const finish = (value: string | undefined) => {
        if (settled) return
        settled = true
        resolve(value)
      }
      void dialog.show(
        () => (
          <CropDialog
            base64={props.base64}
            mime={mime()}
            onCancel={() => {
              finish(undefined)
              dialog.close()
            }}
            onApply={async (base64) => {
              finish(base64)
              dialog.close()
            }}
          />
        ),
        () => finish(undefined),
      )
    })

  /** 弹标注框；应用返回新 base64，取消返回 undefined。 */
  const openAnnotate = () =>
    new Promise<string | undefined>((resolve) => {
      let settled = false
      const finish = (value: string | undefined) => {
        if (settled) return
        settled = true
        resolve(value)
      }
      void dialog.show(
        () => (
          <AnnotateDialog
            base64={props.base64}
            mime={mime()}
            onCancel={() => {
              finish(undefined)
              dialog.close()
            }}
            onApply={async (base64) => {
              finish(base64)
              dialog.close()
            }}
          />
        ),
        () => finish(undefined),
      )
    })

  const startCrop = async () => {
    const base64 = await openCrop()
    if (base64) await persist(base64)
  }

  const startAnnotate = async () => {
    const base64 = await openAnnotate()
    if (base64) await persist(base64)
  }

  return (
    <div class="relative flex h-full flex-col" data-component="pane-image-preview">
      <div
        class="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6"
        style={{ zoom: zoom() > 100 ? String(zoom() / 100) : undefined }}
      >
        <Show when={url()} fallback={<span class="text-12-regular text-foreground-subtle">正在加载图片…</span>}>
          {(resolved) => (
            <img
              ref={imgEl}
              src={resolved()}
              alt={props.path}
              onLoad={onLoad}
              class="max-h-full max-w-full object-contain shadow-md transition-transform"
              style={{ transform: viewTransform() }}
              draggable={false}
            />
          )}
        </Show>
      </div>

      <PaneStatusBar
        info={
          <span class="truncate">
            {natural() ? `${natural()!.width} × ${natural()!.height} px` : (props.path.split("/").pop() ?? "")}
          </span>
        }
        extra={
          <div class="flex items-center gap-0.5">
            <IconAction
              icon="lu-rotate-ccw"
              label="逆时针旋转 90°"
              disabled={busy()}
              onClick={() => void applyRotate(-1)}
            />
            <IconAction
              icon="lu-rotate-cw"
              label="顺时针旋转 90°"
              disabled={busy()}
              onClick={() => void applyRotate(1)}
            />
            <IconAction
              icon="lu-flip-horizontal-2"
              label="水平翻转"
              disabled={busy()}
              onClick={() => void applyFlip(true)}
            />
            <IconAction
              icon="lu-flip-vertical-2"
              label="垂直翻转"
              disabled={busy()}
              onClick={() => void applyFlip(false)}
            />
            <IconAction icon="lu-crop" label="裁剪" onClick={() => void startCrop()} />
            <IconAction icon="lu-pen-line" label="标注" onClick={() => void startAnnotate()} />
            <IconAction icon="lu-maximize" label="全屏" onClick={fullscreen} />
          </div>
        }
        zoom={{
          value: () => zoom(),
          onStep: (zoomIn) => setZoom((x) => Math.max(25, Math.min(400, x + (zoomIn ? 10 : -10)))),
          onReset: () => setZoom(100),
          fitLabel: "适应",
          onFit: () => setZoom(100),
          fitted: () => zoom() === 100,
        }}
      />
    </div>
  )
}

function IconAction(props: {
  icon: Parameters<typeof Icon>[0]["name"]
  label: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      data-action={`image-${props.label}`}
      class="grid size-6 place-items-center rounded text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <Icon name={props.icon} size="small" />
    </button>
  )
}

/** 把 canvas 的绘制面按真实像素画布渲染（图片 + 已有笔画 + 正在画的笔画）。 */
function useCanvasRepaint(
  surface: () => HTMLCanvasElement | undefined,
  img: () => HTMLImageElement | undefined,
  strokes: () => Stroke[],
  draft: () => Stroke | undefined,
) {
  createEffect(() => {
    const el = surface()
    const picture = img()
    if (!el || !picture) return
    const ctx = el.getContext("2d")
    if (!ctx) return
    ctx.clearRect(0, 0, el.width, el.height)
    ctx.drawImage(picture, 0, 0)
    for (const stroke of strokes()) paintStroke(ctx, stroke)
    const active = draft()
    if (active) paintStroke(ctx, active)
  })
}

function CropDialog(props: {
  base64: string
  mime: string
  onCancel: () => void
  onApply: (base64: string) => Promise<void>
}) {
  const [img, setImg] = createSignal<HTMLImageElement>()
  const [drag, setDrag] = createSignal<{ x: number; y: number; w: number; h: number } | undefined>()
  const [start, setStart] = createSignal<[number, number] | undefined>()
  const [busy, setBusy] = createSignal(false)
  let surface: HTMLCanvasElement | undefined

  createEffect(() => {
    const src = objectUrlOf(props.base64, props.mime)
    if (!src) return
    let cancelled = false
    void loadImage(src).then((loaded) => {
      if (cancelled) {
        URL.revokeObjectURL(src)
        return
      }
      setImg(loaded)
    })
    onCleanup(() => {
      cancelled = true
      URL.revokeObjectURL(src)
    })
  })

  const toNatural = (event: PointerEvent): [number, number] => {
    const el = surface
    const picture = img()
    if (!el || !picture) return [0, 0]
    const rect = el.getBoundingClientRect()
    return [
      ((event.clientX - rect.left) / rect.width) * picture.naturalWidth,
      ((event.clientY - rect.top) / rect.height) * picture.naturalHeight,
    ]
  }

  const begin = (event: PointerEvent) => {
    const picture = img()
    if (!picture) return
    const [x, y] = toNatural(event)
    setStart([x, y])
    setDrag({ x, y, w: 0, h: 0 })
    surface?.setPointerCapture(event.pointerId)
  }

  const move = (event: PointerEvent) => {
    const origin = start()
    const picture = img()
    if (!origin || !picture) return
    const [x, y] = toNatural(event)
    setDrag({
      x: Math.min(origin[0], x),
      y: Math.min(origin[1], y),
      w: Math.abs(x - origin[0]),
      h: Math.abs(y - origin[1]),
    })
  }

  const end = () => {
    setStart(undefined)
    const d = drag()
    if (d && d.w < 8 && d.h < 8) setDrag(undefined)
  }

  const apply = async () => {
    const picture = img()
    const d = drag()
    if (!picture || !d || d.w < 8 || d.h < 8 || busy()) return
    setBusy(true)
    try {
      const canvas = drawCropped(picture, d)
      await props.onApply(canvasToBase64(canvas))
    } finally {
      setBusy(false)
    }
  }

  const valid = () => (drag()?.w ?? 0) >= 8 && (drag()?.h ?? 0) >= 8

  return (
    <Dialog
      title="裁剪图片"
      description="拖动选择要保留的区域"
      footer={
        <>
          <Button variant="ghost" size="large" onClick={props.onCancel}>
            取消
          </Button>
          <Button variant="primary" size="large" disabled={busy() || !valid()} onClick={() => void apply()}>
            {busy() ? "处理中…" : "应用裁剪"}
          </Button>
        </>
      }
    >
      <div class="relative p-5">
        <canvas
          ref={(el) => {
            surface = el
          }}
          width={img()?.naturalWidth ?? 0}
          height={img()?.naturalHeight ?? 0}
          class="block max-h-[60vh] max-w-full cursor-crosshair touch-none rounded border border-border"
          onPointerDown={begin}
          onPointerMove={move}
          onPointerUp={end}
        />
        <Show when={drag()}>
          {(d) => (
            <div
              class="pointer-events-none absolute border-2 border-primary/80"
              style={{
                left: `${(d().x / (img()?.naturalWidth ?? 1)) * 100}%`,
                top: `${(d().y / (img()?.naturalHeight ?? 1)) * 100}%`,
                width: `${(d().w / (img()?.naturalWidth ?? 1)) * 100}%`,
                height: `${(d().h / (img()?.naturalHeight ?? 1)) * 100}%`,
              }}
            />
          )}
        </Show>
      </div>
    </Dialog>
  )
}

function AnnotateDialog(props: {
  base64: string
  mime: string
  onCancel: () => void
  onApply: (base64: string) => Promise<void>
}) {
  const [tool, setTool] = createSignal<AnnotateTool>("pen")
  const [color, setColor] = createSignal("#ef4444")
  const [size, setSize] = createSignal(4)
  const [strokes, setStrokes] = createSignal<Stroke[]>([])
  const [draft, setDraft] = createSignal<Stroke | undefined>()
  const [img, setImg] = createSignal<HTMLImageElement>()
  const [busy, setBusy] = createSignal(false)
  const [surface, setSurface] = createSignal<HTMLCanvasElement | undefined>()

  createEffect(() => {
    const src = objectUrlOf(props.base64, props.mime)
    if (!src) return
    let cancelled = false
    void loadImage(src).then((loaded) => {
      if (cancelled) {
        URL.revokeObjectURL(src)
        return
      }
      setImg(loaded)
    })
    onCleanup(() => {
      cancelled = true
      URL.revokeObjectURL(src)
    })
  })

  const toPoint = (event: PointerEvent): [number, number] => {
    const el = surface()
    const picture = img()
    if (!el || !picture) return [0, 0]
    const rect = el.getBoundingClientRect()
    return [
      ((event.clientX - rect.left) / rect.width) * picture.naturalWidth,
      ((event.clientY - rect.top) / rect.height) * picture.naturalHeight,
    ]
  }

  const begin = (event: PointerEvent) => {
    if (!img()) return
    setDraft({ tool: tool(), color: color(), size: size(), points: [toPoint(event)] })
    surface()?.setPointerCapture(event.pointerId)
  }

  const move = (event: PointerEvent) => {
    const current = draft()
    if (!current) return
    setDraft({ ...current, points: [...current.points, toPoint(event)] })
  }

  const end = () => {
    const current = draft()
    if (!current) return
    if (current.points.length > 0) setStrokes((list) => [...list, current])
    setDraft(undefined)
  }

  const undo = () => setStrokes((list) => list.slice(0, -1))

  const apply = async () => {
    const picture = img()
    if (!picture || busy()) return
    setBusy(true)
    try {
      const canvas = document.createElement("canvas")
      canvas.width = picture.naturalWidth
      canvas.height = picture.naturalHeight
      const ctx = canvas.getContext("2d")
      if (!ctx) return
      ctx.drawImage(picture, 0, 0)
      for (const stroke of strokes()) paintStroke(ctx, stroke)
      await props.onApply(canvasToBase64(canvas))
    } finally {
      setBusy(false)
    }
  }

  useCanvasRepaint(surface, img, strokes, draft)

  return (
    <Dialog
      title="标注图片"
      description="在图片上绘制，应用后写入文件"
      size="x-large"
      footer={
        <>
          <Button variant="ghost" size="large" onClick={props.onCancel}>
            取消
          </Button>
          <Button variant="ghost" size="large" disabled={strokes().length === 0} onClick={undo}>
            撤销
          </Button>
          <Button
            variant="primary"
            size="large"
            disabled={busy() || strokes().length === 0}
            onClick={() => void apply()}
          >
            {busy() ? "处理中…" : "应用标注"}
          </Button>
        </>
      }
    >
      <div class="flex flex-col gap-3 p-5">
        <div class="flex flex-wrap items-center gap-1">
          <For each={TOOL_META}>
            {(meta) => (
              <button
                type="button"
                data-action={`annotate-${meta.tool}`}
                class="grid size-8 place-items-center rounded transition-colors hover:bg-hover"
                classList={{
                  "bg-hover text-foreground": tool() === meta.tool,
                  "text-foreground-subtle": tool() !== meta.tool,
                }}
                aria-label={meta.label}
                title={meta.label}
                onClick={() => setTool(meta.tool)}
              >
                <Icon name={meta.icon} size="small" />
              </button>
            )}
          </For>
          <div class="mx-2 h-5 w-px bg-border" />
          <For each={["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#111111"]}>
            {(swatch) => (
              <button
                type="button"
                data-action={`annotate-color-${swatch}`}
                class="size-6 rounded-full border transition-transform hover:scale-110"
                classList={{ "border-foreground ring-2 ring-offset-1": color() === swatch }}
                style={{ background: swatch }}
                aria-label={`颜色 ${swatch}`}
                onClick={() => setColor(swatch)}
              />
            )}
          </For>
          <div class="mx-2 h-5 w-px bg-border" />
          <input
            type="range"
            min={2}
            max={20}
            value={size()}
            class="w-28 accent-primary"
            aria-label="画笔大小"
            onInput={(event) => setSize(Number(event.currentTarget.value))}
          />
        </div>
        <canvas
          ref={setSurface}
          width={img()?.naturalWidth ?? 0}
          height={img()?.naturalHeight ?? 0}
          class="block max-h-[60vh] max-w-full cursor-crosshair touch-none rounded border border-border"
          onPointerDown={begin}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
        />
      </div>
    </Dialog>
  )
}
