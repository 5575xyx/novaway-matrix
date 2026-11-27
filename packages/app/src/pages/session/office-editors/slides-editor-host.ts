/**
 * PPTX 编辑器 Host：把 Lexora 的 GenOffice 演示文稿编辑器接入 NovaWay 文件面板。
 *
 * 与 docx/sheets host 同构：Lexora `mountSlidesEditor` 接收同样的
 * `OfficeEditorOptions`（context / container / bytes / name / onDirty /
 * onSaveRequest / onSave），返回 `OfficeEditor`（save / markSaved / dispose）。
 * NovaWay 只提供演示文稿编辑器实际用到的 ViewContext 子集：
 *   - workers.create → new Worker(slides-worker.js)；
 *   - clipboard → navigator.clipboard 读写（原生复制）；
 *   - resources.pickFiles + readBytes → 插入图片（分块读回选中文件字节）；
 *   - resources.saveFile → 导出图片/压缩包；
 *   - signal → Host 的 abort signal；
 *   - environment.colorScheme + onEnvironmentChange → 主题跟随。
 * 编辑器通过 `new URL("./slides-worker.js", import.meta.url)`、CSS 同理，
 * 空白演示文稿由打包内的 buildBlank() 生成，无需额外静态资源。
 */
import type { OfficeEditor, OfficeEditorContext, OfficeEditorMount } from "../office-editor-host"
import { buildLexoraContext, type LexoraViewContext } from "./lexora-view-context"

/** /office/ 下的演示文稿编辑器 bundle（Vite 原样托管 public/）。 */
const OFFICE_BUNDLE_URL = "/office/slides-editor.js"

/** 由 slides-editor.js 导出的 mountSlidesEditor 类型（产物里是 ESM export mountSlidesEditor）。 */
interface SlidesEditorBundle {
  mountSlidesEditor: (options: {
    context: LexoraViewContext
    container: HTMLElement
    bytes: Uint8Array
    name: string
    onDirty: (dirty: boolean) => void
    onSaveRequest?: () => Promise<void>
    onSave?: (bytes: Uint8Array) => Promise<void>
  }) => Promise<OfficeEditor>
}

let bundlePromise: Promise<SlidesEditorBundle> | undefined

/**
 * 动态加载演示文稿编辑器 bundle（单例，避免重复下载 5MB）。
 * URL 必须在运行时拼接（随机 query），让 esbuild 无法常量折叠、Vite 无法
 * 静态解析出 public 路径，从而交给浏览器原生 import()。Vite 的
 * office-static 中间件在 HTTP 层原样响应 /office/*。
 */
function loadSlidesBundle(): Promise<SlidesEditorBundle> {
  bundlePromise ??= import(/* @vite-ignore */ buildBundleUrl()) as Promise<SlidesEditorBundle>
  return bundlePromise
}

/** 后台预热 PPTX 编辑器资源，不创建编辑器实例。 */
export function preloadSlidesEditor() {
  return loadSlidesBundle().then(() => undefined)
}

/** 运行时拼接 bundle URL：加随机 query 片段让 esbuild 无法常量折叠。 */
function buildBundleUrl(): string {
  return `${OFFICE_BUNDLE_URL}?novaway=${Math.random().toString(36).slice(2)}`
}

/**
 * PPTX 系列（PPTX/PPTM/POTX/POTM/PPSX/PPSM）的浏览器内编辑器挂载函数。
 * 把 NovaWay `OfficeEditorContext` 映射成 Lexora 的 options，返回统一 `OfficeEditor`。
 */
export const mountSlidesEditor: OfficeEditorMount = async (host) => {
  const bundle = await loadSlidesBundle()
  const context = buildLexoraContext(host)
  return bundle.mountSlidesEditor({
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
