import { renderAsync, type Options } from "docx-preview"
import { createEffect, createMemo, createResource, createSignal, For, onCleanup, Show, type Component } from "solid-js"
import { docxEngine } from "@novaway/core/office/engine/docx"
import { Spinner } from "@novaway/ui/spinner"
import { showToast } from "@novaway/ui/toast"
import { base64ToBytes } from "@/pages/session/office-preview-utils"

export type DocxStylePatch = {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  size?: number
  color?: string
  align?: "l" | "ctr" | "r" | "just"
}

const STYLE_COLORS = ["000000", "374151", "DC2626", "EA580C", "CA8A04", "16A34A", "2563EB", "7C3AED"]

// 配置对齐 ZCode previewPaneOfficeDocxContent:保留分页/页眉页脚/脚注,
// useBase64URL 让文档内嵌图片走 data URL(无需额外的媒体通道)。
const RENDER_OPTIONS = {
  breakPages: true,
  debug: false,
  experimental: true,
  ignoreFonts: false,
  ignoreHeight: false,
  // ignoreLastRenderedPageBreak=false 时,纸张相同但边距不同的相邻 section 会被合并,
  // 封面后的正文的独立分页与页边距会丢失 —— 保持 ZCode 同款的保守配置。
  ignoreLastRenderedPageBreak: true,
  ignoreWidth: false,
  inWrapper: true,
  renderAltChunks: false,
  renderChanges: false,
  renderComments: false,
  renderEndnotes: true,
  renderFooters: true,
  renderFootnotes: true,
  renderHeaders: true,
  useBase64URL: true,
} satisfies Partial<Options>

/**
 * Word 真实渲染(docx-preview):按文档自身的分页与样式铺出真实页面,
 * 适宽缩放让整页在面板内可见,仍可滚动翻页。
 */
export const DocxFilePreview: Component<{
  base64: string
  path?: string
  onEdited?: () => void
  /** 保存一段文字；由上层注入（组件本身不依赖 SDK 上下文，方便单测）。 */
  onSaveParagraph?: (paragraph: number, text: string) => Promise<void>
  /** 保存段落格式（加粗/字号/颜色/对齐）。 */
  onSaveParagraphStyle?: (paragraph: number, style: DocxStylePatch) => Promise<void>
}> = (props) => {
  let viewport: HTMLDivElement | undefined
  let surface: HTMLDivElement | undefined
  let mount: HTMLDivElement | undefined
  const [state, setState] = createSignal<"loading" | "ready" | "error">("loading")
  const [natural, setNatural] = createSignal({ width: 0, height: 0 })
  const [scale, setScale] = createSignal(1)
  // 原地改字：双击段落进入编辑，失焦 / Enter 保存，Esc 取消。
  const [saving, setSaving] = createSignal(false)
  let editing: HTMLElement | undefined
  let editingIndex = -1
  let originalText = ""

  // 单击选中段落：上方出现格式条，改的是这一段的 w:rPr / w:pPr。
  const [selected, setSelected] = createSignal<number>()
  const [selectedElement, setSelectedElement] = createSignal<HTMLElement>()
  const [docx] = createResource(
    () => props.base64,
    async (value) => docxEngine.open(base64ToBytes(value)),
  )
  const paragraphs = createMemo(() => {
    const result = docx()
    return result?.ok ? result.data.paragraphs : []
  })
  const selectedStyle = createMemo(() => {
    const index = selected()
    return index === undefined ? undefined : paragraphs()[index]
  })
  // 引擎读出来的对齐是 OOXML 语义（left/center/right/both），操作契约用 l/ctr/r/just。
  const selectedAlign = createMemo(() => {
    const value = selectedStyle()?.align
    if (value === "center") return "ctr"
    if (value === "right") return "r"
    if (value === "both") return "just"
    if (value === "left") return "l"
    return undefined
  })

  const clearSelection = () => {
    const element = selectedElement()
    if (element) {
      element.style.outline = ""
      element.style.outlineOffset = ""
    }
    setSelectedElement(undefined)
    setSelected(undefined)
  }

  const selectAt = (event: MouseEvent) => {
    const target = (event.target as HTMLElement | null)?.closest("p")
    if (!target || !mount || !mount.contains(target) || !target.closest("article")) return
    if (editing) return
    const list = Array.from(mount.querySelectorAll("article p"))
    const index = list.indexOf(target)
    if (index < 0) return
    const previous = selectedElement()
    if (previous && previous !== target) {
      previous.style.outline = ""
      previous.style.outlineOffset = ""
    }
    setSelected(index)
    setSelectedElement(target)
    target.style.outline = "1.5px solid var(--color-primary, #2563eb)"
    target.style.outlineOffset = "3px"
  }

  const applyStyle = (patch: DocxStylePatch) => {
    const index = selected()
    if (index === undefined || !props.onSaveParagraphStyle || saving()) return
    void (async () => {
      setSaving(true)
      try {
        await props.onSaveParagraphStyle!(index + 1, patch)
      } catch (error) {
        showToast({
          variant: "error",
          title: "保存格式失败",
          description: error instanceof Error ? error.message : String(error),
        })
      } finally {
        setSaving(false)
      }
    })()
  }

  const updateFit = () => {
    // 尺寸可能还没稳定(renderAsync resolve 不代表布局完成),每次都重测一次兜底。
    if (!viewport || !mount) return
    const page = mount.querySelector("section.docx") as HTMLElement | null
    const wrapper = mount.querySelector(".docx-wrapper") as HTMLElement | null
    const width = page?.offsetWidth || 0
    const height = wrapper?.offsetHeight || 0
    if (width > 0) setNatural({ width, height })
    const box = natural()
    if (box.width <= 0) return
    // 视口减去两侧留白;缩放只放大到 1(100%),缩小时保证整页宽度可见。
    const next = Math.min(1, (viewport.clientWidth - 48) / box.width)
    setScale(next > 0 ? next : 1)
  }

  createEffect(() => {
    const data = props.base64
    if (!data || !mount) return
    clearSelection()
    setState("loading")
    const bytes = base64ToBytes(data)
    renderAsync(bytes.buffer as ArrayBuffer, mount, undefined, RENDER_OPTIONS)
      .then(() => {
        // 双 rAF:等一帧让 docx-preview 注入的页面完成布局,再量尺寸。
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (!mount) return
            updateFit()
            setState("ready")
          }),
        )
      })
      .catch(() => setState("error"))
  })

  createEffect(() => {
    if (state() !== "ready" || !viewport) return
    const observer = new ResizeObserver(() => updateFit())
    observer.observe(viewport)
    onCleanup(() => observer.disconnect())
  })

  const cleanupEditing = () => {
    const target = editing
    editing = undefined
    if (!target) return
    target.removeAttribute("contenteditable")
    target.style.outline = ""
    target.style.outlineOffset = ""
    target.blur()
  }

  const cancelEdit = () => {
    const target = editing
    if (!target) return
    target.innerText = originalText
    cleanupEditing()
  }

  /**
   * 只把改过的这一段发上去。docx-preview 的正文段落都在 <article> 里，
   * 页眉/页脚/脚注不在 article 内 —— 和引擎按 word/document.xml 数的段落一一对应。
   */
  const commitEdit = async () => {
    const target = editing
    if (!target || saving()) return
    const paragraph = editingIndex + 1
    const text = target.innerText
      .replace(/\u00a0/g, " ")
      .split("\n")
      .map((line) => line.trim())
      .join(" ")
    cleanupEditing()
    if (text === originalText) return
    const save = props.onSaveParagraph
    if (!save) {
      target.innerText = originalText
      showToast({ variant: "error", title: "无法保存", description: "这个预览没有写回通道。" })
      return
    }
    setSaving(true)
    try {
      await save(paragraph, text)
      clearSelection()
      showToast({ title: "已保存", description: "只改了这一段，其它格式与版式未动。" })
      props.onEdited?.()
    } catch (error) {
      target.innerText = originalText
      showToast({
        variant: "error",
        title: "保存失败",
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSaving(false)
    }
  }

  const startEdit = (event: MouseEvent) => {
    const target = (event.target as HTMLElement | null)?.closest("p")
    if (!target || !mount || !mount.contains(target)) return
    // 页眉/页脚/脚注不参与正文段落编号，不能直接改。
    if (!target.closest("article")) return
    if (saving()) return
    if (editing && editing !== target) void commitEdit()
    const paragraphs = Array.from(mount.querySelectorAll("article p"))
    const index = paragraphs.indexOf(target)
    if (index < 0) return

    event.preventDefault()
    editing = target
    editingIndex = index
    originalText = target.innerText
    target.setAttribute("contenteditable", "true")
    target.style.outline = "2px solid var(--color-primary, #2563eb)"
    target.style.outlineOffset = "2px"
    target.focus()

    // 把光标放到双击的位置，而不是段首。
    const selection = window.getSelection()
    const caret = document.caretRangeFromPoint?.(event.clientX, event.clientY)
    if (selection && caret && target.contains(caret.startContainer)) {
      selection.removeAllRanges()
      selection.addRange(caret)
    }
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!editing) return
    if (event.key === "Escape") {
      event.preventDefault()
      cancelEdit()
      return
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      void commitEdit()
    }
  }

  const handleFocusOut = (event: FocusEvent) => {
    if (!editing) return
    if (event.target === editing) void commitEdit()
  }

  return (
    <div ref={viewport} class="docx-preview-viewport relative h-full overflow-auto bg-background-weak px-6 py-4">
      <Show when={state() === "loading"} fallback={null}>
        <div class="flex h-full items-center justify-center">
          <Spinner class="size-4 text-foreground-subtle" />
        </div>
      </Show>
      <Show when={state() === "ready" && props.path}>
        <div class="sticky top-0 z-10 flex flex-col gap-1.5">
          <div class="pointer-events-none flex justify-end">
            <span class="rounded-full bg-background/90 px-2 py-0.5 text-11-regular text-foreground-subtle shadow-sm">
              {saving() ? "正在保存…" : editing ? "Enter 保存，Esc 取消" : "单击选中改格式，双击段落改字"}
            </span>
          </div>
          <Show when={selectedStyle()}>
            {(style) => (
              <div class="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-panel/95 px-2 py-1.5 shadow-sm">
                <For
                  each={
                    [
                      { key: "bold" as const, label: "B", title: "加粗", className: "font-bold" },
                      { key: "italic" as const, label: "I", title: "斜体", className: "italic" },
                      { key: "underline" as const, label: "U", title: "下划线", className: "underline" },
                    ] as const
                  }
                >
                  {(item) => (
                    <button
                      type="button"
                      data-action={`docx-format-${item.key}`}
                      title={item.title}
                      class={[
                        "grid size-6 place-items-center rounded border text-11-medium transition-colors",
                        style()[item.key]
                          ? "border-emerald-300/60 bg-emerald-300/15 text-emerald-100"
                          : "border-transparent text-foreground-subtle hover:bg-hover hover:text-foreground",
                      ].join(" ")}
                      disabled={saving()}
                      onClick={() => applyStyle({ [item.key]: !style()[item.key] })}
                    >
                      <span class={item.className}>{item.label}</span>
                    </button>
                  )}
                </For>
                <label class="flex items-center gap-1 text-11-regular text-foreground-subtlest">
                  <input
                    type="number"
                    data-action="docx-format-size"
                    min={6}
                    max={200}
                    step={1}
                    value={style().size ? Math.round(style().size!) : ""}
                    disabled={saving()}
                    class="h-6 w-12 rounded border border-border bg-background px-1 text-11-regular text-foreground outline-none focus:border-border-hover"
                    onChange={(event) => {
                      const size = Number(event.currentTarget.value)
                      if (Number.isFinite(size) && size >= 6 && size <= 200) applyStyle({ size })
                    }}
                  />
                  <span>pt</span>
                </label>
                <For each={STYLE_COLORS}>
                  {(color) => (
                    <button
                      type="button"
                      data-action="docx-format-color"
                      title={`#${color}`}
                      class="size-4 rounded-[2px] border border-border transition-transform hover:scale-110"
                      classList={{ "ring-2 ring-emerald-400": style().color === color }}
                      style={{ "background-color": `#${color}` }}
                      disabled={saving()}
                      onClick={() => applyStyle({ color })}
                    />
                  )}
                </For>
                <For
                  each={
                    [
                      { id: "l" as const, label: "左" },
                      { id: "ctr" as const, label: "中" },
                      { id: "r" as const, label: "右" },
                      { id: "just" as const, label: "两端" },
                    ] as const
                  }
                >
                  {(item) => (
                    <button
                      type="button"
                      data-action="docx-format-align"
                      class={[
                        "grid size-6 place-items-center rounded border text-11-medium transition-colors",
                        selectedAlign() === item.id
                          ? "border-emerald-300/60 bg-emerald-300/15 text-emerald-100"
                          : "border-transparent text-foreground-subtle hover:bg-hover hover:text-foreground",
                      ].join(" ")}
                      disabled={saving()}
                      title={`${item.label}对齐`}
                      onClick={() => applyStyle({ align: item.id })}
                    >
                      {item.label}
                    </button>
                  )}
                </For>
              </div>
            )}
          </Show>
        </div>
      </Show>
      <Show when={state() === "error"}>
        <div class="flex h-full items-center justify-center text-12-regular text-foreground-subtle">
          无法渲染该 Word 文档。
        </div>
      </Show>
      <div
        ref={surface}
        class="mx-auto"
        style={{
          width: `${natural().width * scale()}px`,
          height: `${natural().height * scale()}px`,
          display: state() === "ready" ? undefined : "none",
        }}
      >
        <div
          ref={mount}
          onClick={selectAt}
          onDblClick={startEdit}
          onKeyDown={handleKeyDown}
          onFocusOut={handleFocusOut}
          style={{
            transform: `scale(${scale()})`,
            "transform-origin": "top left",
            width: natural().width > 0 ? `${natural().width}px` : undefined,
          }}
        />
      </div>
    </div>
  )
}
