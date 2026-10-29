import { createMemo, Match, onCleanup, Show, Switch, type Component } from "solid-js"
import { DocxFilePreview } from "@/pages/session/docx-file-preview"
import { PptxFilePreview } from "@/pages/session/pptx-file-preview"
import { XlsxFilePreview } from "@/pages/session/xlsx-file-preview"

export const OFFICE_EXTENSIONS = [".docx", ".pptx", ".xlsx", ".pdf"] as const

export const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".avif", ".svg"] as const

export function isOfficePreviewPath(path: string | undefined) {
  if (!path) return false
  const lower = path.toLowerCase()
  return OFFICE_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export function isImagePreviewPath(path: string | undefined) {
  if (!path) return false
  const lower = path.toLowerCase()
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** 共享给各渲染器的 base64 载荷:切文件时整块替换。 */
export type OfficeFilePreviewProps = { path: string; base64: string }

/**
 * 右栏文件预览分发器(对齐 ZCode 的 PreviewPaneContent):
 * PDF 走 Chromium 内嵌阅读器,图片走真实 <img>,DOCX/PPTX/XLSX 交给各自的真实渲染器。
 */
export const OfficeFilePreview: Component<OfficeFilePreviewProps> = (props) => (
  <Switch>
    <Match when={props.path.toLowerCase().endsWith(".pdf")}>
      <PdfFrame base64={props.base64} path={props.path} />
    </Match>
    <Match when={isImagePreviewPath(props.path)}>
      <ImagePreview base64={props.base64} path={props.path} />
    </Match>
    <Match when={props.path.toLowerCase().endsWith(".docx")}>
      <DocxFilePreview base64={props.base64} />
    </Match>
    <Match when={props.path.toLowerCase().endsWith(".pptx")}>
      <PptxFilePreview base64={props.base64} />
    </Match>
    <Match when={props.path.toLowerCase().endsWith(".xlsx")}>
      <XlsxFilePreview base64={props.base64} />
    </Match>
  </Switch>
)

// PDF 交给 Chromium 自带的阅读器:用 Blob URL 直接 embed,缩略图/翻页/缩放都由它提供。
const PdfFrame: Component<{ base64: string; path: string }> = (props) => {
  const url = createMemo(() => {
    if (!props.base64) return
    return URL.createObjectURL(new Blob([base64ToBytes(props.base64)], { type: "application/pdf" }))
  })
  onCleanup(() => {
    const value = url()
    if (value) URL.revokeObjectURL(value)
  })
  return (
    <Show
      when={url()}
      fallback={
        <div class="flex h-full items-center justify-center text-12-regular text-foreground-subtle">正在加载 PDF…</div>
      }
    >
      {(resolved) => <iframe src={resolved()} title={props.path} class="h-full w-full border-0 bg-background" />}
    </Show>
  )
}

const ImagePreview: Component<{ base64: string; path: string }> = (props) => {
  const url = createMemo(() => {
    if (!props.base64) return
    const mime = (() => {
      const lower = props.path.toLowerCase()
      const ext = lower.slice(lower.lastIndexOf(".") + 1)
      if (ext === "svg") return "image/svg+xml"
      if (ext === "jpg") return "image/jpeg"
      return `image/${ext}`
    })()
    return URL.createObjectURL(new Blob([base64ToBytes(props.base64)], { type: mime }))
  })
  onCleanup(() => {
    const value = url()
    if (value) URL.revokeObjectURL(value)
  })
  return (
    <div class="flex h-full items-center justify-center overflow-auto p-6">
      <Show when={url()} fallback={<span class="text-12-regular text-foreground-subtle">正在加载图片…</span>}>
        {(resolved) => (
          <img
            src={resolved()}
            alt={props.path}
            class="max-h-full max-w-full object-contain shadow-md"
            draggable={false}
          />
        )}
      </Show>
    </div>
  )
}
