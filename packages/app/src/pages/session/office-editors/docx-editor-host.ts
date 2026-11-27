/**
 * DOCX 编辑器 Host：把 Lexora 的 GenOffice 文档编辑器接入 NovaWay 文件面板。
 *
 * Lexora `mountDocxEditor` 接收一个 `ViewContext` 和 `OfficeEditorOptions`。
 * NovaWay 侧不实现整个 Lexora 宿主协议，只提供 DOCX 编辑器实际用到的
 * 最小子集：
 *   - workers.create → new Worker(URL)，指向 /office/docx-worker.js；
 *   - clipboard → 浏览器 navigator.clipboard 的读写；
 *   - resources.pickFiles / saveFile → 打开文件 / 另存为；
 *   - environment.colorScheme + onEnvironmentChange → 主题跟随；
 *   - signal → Host 的 abort signal；
 *   - onSave → Host 提供的写盘回调（sdk office.document.save）。
 *
 * 编辑器本身是独立 ESM bundle（public/office/docx-editor.js），内部
 * 用 `import.meta.url` 相对解析 docx-worker.js / docx-editor.css / 字体，
 * 所以这里只动态 import 它，不需要改产物。
 */
import type { OfficeEditor, OfficeEditorMount } from "../office-editor-host"
import { buildLexoraContext, type LexoraViewContext } from "./lexora-view-context"

/** /office/ 下的静态资源前缀（Vite 原样托管 public/）。 */
const OFFICE_BUNDLE_URL = "/office/docx-editor.js"

/** 由 docx-editor.js 导出的 mountDocxEditor 类型（产物里是 ESM export）。 */
interface DocxEditorBundle {
  mountDocxEditor: (options: {
    context: LexoraViewContext
    container: HTMLElement
    bytes: Uint8Array
    name: string
    onDirty: (dirty: boolean) => void
    onSaveRequest?: () => Promise<void>
    onSave?: (bytes: Uint8Array) => Promise<void>
  }) => Promise<OfficeEditor>
}

let bundlePromise: Promise<DocxEditorBundle> | undefined

/**
 * 动态加载 DOCX 编辑器 bundle（单例，避免重复下载 7.4MB）。
 *
 * docx-editor.js 是预构建的独立 ESM 产物（public/office/）。
 * Vite 的 import-analysis 在编译期拦「import() 一个 public 下的 .js」：
 *   - 静态字符串会直接抛 "Cannot import non-asset file … inside /public"；
 *   - `@vite-ignore` 只抑制「无法分析」的告警，从不抑制这个抛错；
 *   - 把字面量放进 const 变量没用——esbuild 会把 `const x = "/office/…"`
 *     常量折叠回字面量，Vite 依然在编译期解析出 public 路径。
 * 所以 URL 必须在运行时构造（拼接 + URLSearchParams 随机片段），让 esbuild
 * 无法折叠、Vite 无法静态解析，从而交给浏览器原生 import()。Vite 的
 * office-static 中间件在 HTTP 层用原始静态文件响应 /office/*，
 * 避免二次 transform；`import.meta.url` 相对解析 worker / CSS / 字体仍正确。
 */
function loadDocxBundle(): Promise<DocxEditorBundle> {
  bundlePromise ??= import(/* @vite-ignore */ buildBundleUrl()) as Promise<DocxEditorBundle>
  return bundlePromise
}

/** 后台预热 DOCX 编辑器资源，不创建编辑器实例。 */
export function preloadDocxEditor() {
  return loadDocxBundle().then(() => undefined)
}

/**
 * 运行时拼接 bundle URL：加一个随机 query 片段让 esbuild 无法常量折叠。
 * /office/ 由 Vite 中间件原样托管，query 不影响文件内容。
 */
function buildBundleUrl(): string {
  return `${OFFICE_BUNDLE_URL}?novaway=${Math.random().toString(36).slice(2)}`
}

/**
 * DOCX 系列（DOCX/DOCM/DOTX/DOTM）的浏览器内编辑器挂载函数。
 * 把 NovaWay `OfficeEditorContext` 映射成 Lexora 的 options，返回统一 `OfficeEditor`。
 */
export const mountDocxEditor: OfficeEditorMount = async (host) => {
  const bundle = await loadDocxBundle()
  const context = buildLexoraContext(host)
  return bundle.mountDocxEditor({
    context,
    container: host.container,
    bytes: host.bytes,
    name: host.name,
    onDirty: host.onDirty,
    onSaveRequest: host.onSaveRequest,
    // onSave 由 Host 组件通过 onSaveRequest 触发保存；这里不直接写盘，
    // 编辑器内部调用 options.onSave 时转给 onSaveRequest，统一走 Host 的保存通道。
    onSave: async (bytes) => {
      await host.onSaveRequest?.()
    },
  })
}
