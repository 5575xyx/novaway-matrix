import { renderAsync, type Options } from "docx-preview"
import { createEffect, createSignal, onCleanup, Show, type Component } from "solid-js"
import { Spinner } from "@novaway/ui/spinner"
import { base64ToBytes } from "@/pages/session/office-file-preview"

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
export const DocxFilePreview: Component<{ base64: string }> = (props) => {
  let viewport: HTMLDivElement | undefined
  let surface: HTMLDivElement | undefined
  let mount: HTMLDivElement | undefined
  const [state, setState] = createSignal<"loading" | "ready" | "error">("loading")
  const [natural, setNatural] = createSignal({ width: 0, height: 0 })
  const [scale, setScale] = createSignal(1)

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

  return (
    <div ref={viewport} class="docx-preview-viewport h-full overflow-auto bg-background-weak px-6 py-4">
      <Show when={state() === "loading"} fallback={null}>
        <div class="flex h-full items-center justify-center">
          <Spinner class="size-4 text-foreground-subtle" />
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
