import type { PptxBox, PptxTextStyle } from "@novaway/core/office/pptx-edit"
import { resizeBox, rotationFromPointer } from "@/utils/pptx-box"
import { createSignal, For, Show, type Component } from "solid-js"

// 画布编辑器：选中框（拖动/缩放）、原地改字（contenteditable）、格式工具条。
// 这些都只负责「看起来像在 PowerPoint 里编辑」，真正的落盘由上层调
// POST /office/pptx-edit 完成 —— 组件本身不碰文件。

const HANDLES = [
  { id: "nw", left: 0, top: 0, cursor: "nwse-resize" },
  { id: "n", left: 0.5, top: 0, cursor: "ns-resize" },
  { id: "ne", left: 1, top: 0, cursor: "nesw-resize" },
  { id: "e", left: 1, top: 0.5, cursor: "ew-resize" },
  { id: "se", left: 1, top: 1, cursor: "nwse-resize" },
  { id: "s", left: 0.5, top: 1, cursor: "ns-resize" },
  { id: "sw", left: 0, top: 1, cursor: "nesw-resize" },
  { id: "w", left: 0, top: 0.5, cursor: "ew-resize" },
] as const

type HandleId = (typeof HANDLES)[number]["id"]

/** 像素差 → 幻灯片坐标差。显示缩放是线性的，除以 scale 即可。 */
const toSlide = (pixels: number, scale: number) => (scale > 0 ? pixels / scale : 0)

/**
 * 选中框：中间可以拖动整块，八个把手可以改尺寸。
 * 拖动过程中只更新本地的 live 值（框跟着鼠标走），松手才写回文件。
 */
export const PptxShapeFrame: Component<{
  box: PptxBox
  scale: number
  rotation?: number
  /** 整页/组合不允许直接拖 */
  movable: boolean
  onLive: (box: PptxBox) => void
  onCommit: (box: PptxBox) => void
  onRotate?: (degrees: number) => void
}> = (props) => {
  let drag: { pointer: PointerEvent; handle: HandleId | "move"; box: PptxBox; moved: boolean } | undefined
  let current = () => props.box
  let frame: HTMLDivElement | undefined
  const [liveRotation, setLiveRotation] = createSignal<number>()

  const begin = (event: PointerEvent, handle: HandleId | "move") => {
    if (!props.movable) return
    // 拖整块时不要 preventDefault：那会连带吞掉 click/dblclick，
    // 双击改字就进不去了。文字选中靠 select-none 挡住。
    if (handle !== "move") event.preventDefault()
    event.stopPropagation()
    drag = { pointer: event, handle, box: { ...props.box }, moved: false }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", end)
    window.addEventListener("pointercancel", end)
  }

  const move = (event: PointerEvent) => {
    if (!drag) return
    const dx = toSlide(event.clientX - drag.pointer.clientX, props.scale)
    const dy = toSlide(event.clientY - drag.pointer.clientY, props.scale)
    if (Math.abs(dx) + Math.abs(dy) > 0) drag.moved = true
    current = () => resizeBox(drag!.box, drag!.handle, dx, dy)
    props.onLive(current())
  }

  const end = () => {
    window.removeEventListener("pointermove", move)
    window.removeEventListener("pointerup", end)
    window.removeEventListener("pointercancel", end)
    const finished = drag?.moved ? current() : undefined
    drag = undefined
    if (finished) props.onCommit(finished)
  }

  /** 顶上的旋转把手：按鼠标相对中心的角度算，松手才写回。 */
  let rotating: PointerEvent | undefined
  const rotate = (event: PointerEvent) => {
    if (!rotating || !frame) return
    const rect = frame.getBoundingClientRect()
    const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    setLiveRotation(rotationFromPointer({ centerX: center.x, centerY: center.y, x: event.clientX, y: event.clientY }))
  }
  const endRotate = () => {
    window.removeEventListener("pointermove", rotate)
    window.removeEventListener("pointerup", endRotate)
    window.removeEventListener("pointercancel", endRotate)
    rotating = undefined
    const value = liveRotation()
    setLiveRotation(undefined)
    if (value !== undefined) props.onRotate?.(value)
  }

  return (
    <div
      ref={frame}
      data-component="pptx-shape-frame"
      class="absolute z-20 cursor-move border-2 border-emerald-400 select-none"
      classList={{ "pointer-events-none": !props.movable }}
      style={{
        left: `${props.box.x * props.scale}px`,
        top: `${props.box.y * props.scale}px`,
        width: `${Math.max(2, props.box.w * props.scale)}px`,
        height: `${Math.max(2, props.box.h * props.scale)}px`,
        transform: `rotate(${liveRotation() ?? props.rotation ?? 0}deg)`,
      }}
      onPointerDown={(event) => begin(event, "move")}
    >
      <Show when={props.movable}>
        <span
          data-handle="rotate"
          class="absolute left-1/2 -top-6 size-3 -translate-x-1/2 cursor-grab rounded-full border border-emerald-500 bg-white"
          onPointerDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
            rotating = event
            window.addEventListener("pointermove", rotate)
            window.addEventListener("pointerup", endRotate)
            window.addEventListener("pointercancel", endRotate)
          }}
        />
        <For each={HANDLES}>
          {(handle) => (
            <span
              data-handle={handle.id}
              class="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-[1px] border border-emerald-500 bg-white"
              style={{
                left: `${handle.left * 100}%`,
                top: `${handle.top * 100}%`,
                cursor: handle.cursor,
              }}
              onPointerDown={(event) => begin(event, handle.id)}
            />
          )}
        </For>
      </Show>
    </div>
  )
}

/**
 * 原地改字：一块半透明画布压在被框住的形状上，逐段可编辑。
 * 字号/颜色/对齐按 XML 里的真实属性换算，看起来就是「直接在幻灯片上打字」。
 */
export const PptxTextEditor: Component<{
  box: PptxBox
  scale: number
  paragraphs: string[]
  styles: PptxTextStyle[]
  onInput: (index: number, text: string) => void
  onSave: () => void
  onCancel: () => void
}> = (props) => {
  // 非受控：每段的 DOM 只在挂载时创建一次。改字时只把文本回传，
  // 不触发重渲染 —— 否则每敲一个字都会重建 contenteditable，光标就丢了。
  const editors: HTMLElement[] = []

  const focusAt = (index: number) => {
    const target = editors[Math.max(0, Math.min(editors.length - 1, index))]
    target?.focus()
  }

  return (
    <div
      data-component="pptx-inline-editor"
      class="absolute z-30 flex flex-col overflow-hidden rounded-[2px] bg-white/95 p-1 shadow-[0_8px_24px_rgba(0,0,0,0.28)] ring-2 ring-emerald-400"
      style={{
        left: `${props.box.x * props.scale}px`,
        top: `${props.box.y * props.scale}px`,
        width: `${Math.max(120, props.box.w * props.scale)}px`,
        height: `${Math.max(40, props.box.h * props.scale)}px`,
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault()
          props.onCancel()
          return
        }
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          props.onSave()
        }
      }}
    >
      <For each={props.paragraphs}>
        {(text, index) => (
          <div
            ref={(element) => {
              editors[index()] = element
              // 挂载后抢焦点：Solid 插进 DOM 之前 focus() 不生效。
              if (index() === 0) queueMicrotask(() => element.focus())
            }}
            data-paragraph={index()}
            contentEditable="plaintext-only"
            spellcheck={false}
            class="min-h-[1.2em] w-full whitespace-pre-wrap break-words rounded-[2px] px-1 outline-none focus:bg-emerald-50"
            style={paragraphStyle(props.styles[index()], props.scale)}
            onInput={(event) => props.onInput(index(), event.currentTarget.textContent ?? "")}
            onFocus={(event) => {
              // 选中整段：和 PowerPoint 里点进文本框后「全选」一个感觉。
              const range = document.createRange()
              range.selectNodeContents(event.currentTarget)
              const selection = window.getSelection()
              selection?.removeAllRanges()
              selection?.addRange(range)
            }}
            onKeyDown={(event) => {
              // 段落结构不能在这里新增：回车跳到下一段，最后一段再回车就保存。
              if (event.key !== "Enter" || event.shiftKey) return
              event.preventDefault()
              if (index() === props.paragraphs.length - 1) props.onSave()
              else focusAt(index() + 1)
            }}
          />
        )}
      </For>
    </div>
  )
}

/**
 * 段落样式：pt → 屏幕像素。
 *
 * 画布坐标本身就是 pt（16:9 页面 960×540），`scale` 是「1 个 pt 占几像素」，
 * 所以字号直接乘 scale。这里曾经多乘了一次 12700（EMU），字会大得离谱、
 * 编辑框也撑到屏幕外 —— 和选中框是同一个单位错误。
 */
function paragraphStyle(style: PptxTextStyle | undefined, scale: number) {
  const value = style ?? {}
  return {
    "font-size": `${Math.max(6, (value.size ?? 18) * scale)}px`,
    "font-weight": value.bold ? 700 : 400,
    "font-style": value.italic ? "italic" : "normal",
    "text-decoration": value.underline ? "underline" : "none",
    color: value.color ? `#${value.color}` : "#111827",
    "text-align": alignCss(value.align),
    "font-family": value.font ? `"${value.font}"` : undefined,
    "line-height": 1.25,
  }
}

function alignCss(align: PptxTextStyle["align"]): "left" | "center" | "right" | "justify" {
  if (align === "ctr") return "center"
  if (align === "r") return "right"
  if (align === "just") return "justify"
  return "left"
}

const COLORS = ["000000", "FFFFFF", "1F2937", "2563EB", "059669", "DC2626", "D97706", "7C3AED"]

/** 格式工具条：加粗/斜体/下划线 + 字号 + 颜色 + 对齐。 */
export const PptxFormatBar: Component<{
  style: PptxTextStyle
  disabled?: boolean
  onChange: (patch: PptxTextStyle) => void
}> = (props) => {
  const button = (active: boolean) =>
    [
      "grid size-6 place-items-center rounded border text-11-medium transition-colors",
      active
        ? "border-emerald-300/60 bg-emerald-300/15 text-emerald-100"
        : "border-transparent text-foreground-subtle hover:bg-hover hover:text-foreground",
    ].join(" ")

  return (
    <div data-component="pptx-format-bar" class="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        data-action="pptx-format-bold"
        class={button(props.style.bold === true)}
        disabled={props.disabled}
        title="加粗"
        onClick={() => props.onChange({ bold: !props.style.bold })}
      >
        <span class="font-bold">B</span>
      </button>
      <button
        type="button"
        data-action="pptx-format-italic"
        class={button(props.style.italic === true)}
        disabled={props.disabled}
        title="斜体"
        onClick={() => props.onChange({ italic: !props.style.italic })}
      >
        <span class="italic">I</span>
      </button>
      <button
        type="button"
        data-action="pptx-format-underline"
        class={button(props.style.underline === true)}
        disabled={props.disabled}
        title="下划线"
        onClick={() => props.onChange({ underline: !props.style.underline })}
      >
        <span class="underline">U</span>
      </button>
      <label class="flex items-center gap-1 text-11-regular text-foreground-subtlest">
        <input
          type="number"
          data-action="pptx-format-size"
          min={6}
          max={200}
          step={1}
          value={props.style.size ? Math.round(props.style.size) : ""}
          disabled={props.disabled}
          class="h-6 w-12 rounded border border-border bg-background px-1 text-11-regular text-foreground outline-none focus:border-border-hover"
          onChange={(event) => {
            const size = Number(event.currentTarget.value)
            if (Number.isFinite(size) && size >= 6 && size <= 200) props.onChange({ size })
          }}
        />
        <span>pt</span>
      </label>
      <div class="flex items-center gap-1">
        <For each={COLORS}>
          {(color) => (
            <button
              type="button"
              data-action="pptx-format-color"
              title={`#${color}`}
              class="size-4 rounded-[2px] border border-border transition-transform hover:scale-110"
              classList={{ "ring-2 ring-emerald-400": props.style.color === color }}
              style={{ "background-color": `#${color}` }}
              disabled={props.disabled}
              onClick={() => props.onChange({ color })}
            />
          )}
        </For>
      </div>
      <div class="flex items-center gap-0.5">
        <For
          each={
            [
              { id: "l", label: "左" },
              { id: "ctr", label: "中" },
              { id: "r", label: "右" },
            ] as const
          }
        >
          {(item) => (
            <button
              type="button"
              data-action="pptx-format-align"
              data-align={item.id}
              class={button(props.style.align === item.id)}
              disabled={props.disabled}
              title={`${item.label}对齐`}
              onClick={() => props.onChange({ align: item.id })}
            >
              {item.label}
            </button>
          )}
        </For>
      </div>
    </div>
  )
}
