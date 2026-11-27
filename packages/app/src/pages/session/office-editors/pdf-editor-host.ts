/**
 * PDF 编辑器 Host：把 Lexora 的 GenOffice PDF 编辑器接入 NovaWay 文件面板。
 *
 * 与 docx/sheets/slides host 同构：Lexora `mountPdfEditor` 接收同样的
 * `OfficeEditorOptions`（context / container / bytes / name / onDirty /
 * onSaveRequest / onSave），返回 `OfficeEditor`（save / markSaved / dispose）。
 * NovaWay 只提供 PDF 编辑器实际用到的 ViewContext 子集：
 *   - workers.create → new Worker(pdf-worker.js)（pdfjs 渲染 worker）；
 *   - resources.pickFiles + readBytes → 插入/合并/替换 PDF（分块读回）；
 *   - resources.saveFile → 导出 PDF/图片/压缩包；
 *   - commands.execute → 签名收藏偏好（localStorage 持久化）；
 *   - signal → Host 的 abort signal；
 *   - environment.colorScheme + onEnvironmentChange → 主题跟随。
 * 编辑器通过 `new URL("./pdf-worker.js", import.meta.url)`、CSS 同理；
 * 渲染/字体运行时资源由 pdf-runtime/、pdfjs/ 相对解析，无需额外静态配置。
 */
import type { OfficeEditor, OfficeEditorContext, OfficeEditorMount } from "../office-editor-host"
import { buildLexoraContext, type LexoraViewContext } from "./lexora-view-context"

/** /office/ 下的 PDF 编辑器 bundle（Vite 原样托管 public/）。 */
const OFFICE_BUNDLE_URL = "/office/pdf-editor.js"

/** 由 pdf-editor.js 导出的 mountPdfEditor 类型（产物里是 ESM export mountPdfEditor）。 */
interface PdfEditorBundle {
  mountPdfEditor: (options: {
    context: LexoraViewContext
    container: HTMLElement
    bytes: Uint8Array
    name: string
    onDirty: (dirty: boolean) => void
    onSaveRequest?: () => Promise<void>
    onSave?: (bytes: Uint8Array) => Promise<void>
  }) => Promise<OfficeEditor>
}

let bundlePromise: Promise<PdfEditorBundle> | undefined

/**
 * 动态加载 PDF 编辑器 bundle（单例，避免重复下载 2.6MB）。
 * URL 必须在运行时拼接（随机 query），让 esbuild 无法常量折叠、Vite 无法
 * 静态解析出 public 路径，从而交给浏览器原生 import()。Vite 的
 * office-static 中间件在 HTTP 层原样响应 /office/*。
 */
function loadPdfBundle(): Promise<PdfEditorBundle> {
  bundlePromise ??= import(/* @vite-ignore */ buildBundleUrl()) as Promise<PdfEditorBundle>
  return bundlePromise
}

/** 后台预热 PDF 编辑器资源，不创建编辑器实例。 */
export function preloadPdfEditor() {
  return loadPdfBundle().then(() => undefined)
}

/** 运行时拼接 bundle URL：加随机 query 片段让 esbuild 无法常量折叠。 */
function buildBundleUrl(): string {
  return `${OFFICE_BUNDLE_URL}?novaway=${Math.random().toString(36).slice(2)}`
}

/**
 * PDF 的浏览器内编辑器挂载函数。
 * 把 NovaWay `OfficeEditorContext` 映射成 Lexora 的 options，返回统一 `OfficeEditor`。
 */
export const mountPdfEditor: OfficeEditorMount = async (host) => {
  const bundle = await loadPdfBundle()
  const context = buildLexoraContext(host)
  return bundle.mountPdfEditor({
    context,
    container: host.container,
    bytes: host.bytes,
    name: host.name,
    onDirty: host.onDirty,
    onSaveRequest: host.onSaveRequest,
    onSave: async () => {
      await host.onSaveRequest?.()
    },
  })
}
