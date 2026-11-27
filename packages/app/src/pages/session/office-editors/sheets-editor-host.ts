/**
 * XLSX 编辑器 Host：把 Lexora 的 GenOffice 表格编辑器接入 NovaWay 文件面板。
 *
 * 与 docx-editor-host.ts 同构：Lexora `mountSheets` 接收同样的
 * `OfficeEditorOptions`（context / container / bytes / name / onDirty /
 * onSaveRequest / onSave），返回 `SheetsEditorHandle`（save / markSaved /
 * dispose）。NovaWay 只提供表格编辑器实际用到的 ViewContext 子集：
 *   - workers.create → new Worker(engine-worker.js)；
 *   - clipboard → navigator.clipboard 读写；
 *   - signal → Host 的 abort signal；
 *   - environment.colorScheme + onEnvironmentChange → 主题跟随。
 * 表格编辑器自身通过 `new URL("./blank.xlsx", import.meta.url)` 相对解析
 * 空白工作簿，`./engine-worker.js`、`./sheets-editor.css` 同理，无需改产物。
 */
import JSZip from "jszip"
import type { OfficeEditor, OfficeEditorMount } from "../office-editor-host"
import { buildLexoraContext, type LexoraViewContext } from "./lexora-view-context"

let activeThemeConsumers = 0

/** Univer's embedded Tailwind bundle scopes dark: utilities under .univer-dark. */
function acquireUniverColorScheme(context: LexoraViewContext) {
  let released = false
  const apply = ({ colorScheme }: { colorScheme: string }) => {
    document.documentElement.classList.toggle("univer-dark", colorScheme === "dark")
  }
  activeThemeConsumers++
  apply(context.environment)
  const subscription = context.onEnvironmentChange(apply)
  return () => {
    if (released) return
    released = true
    subscription.dispose()
    activeThemeConsumers = Math.max(0, activeThemeConsumers - 1)
    if (activeThemeConsumers === 0) document.documentElement.classList.remove("univer-dark")
  }
}

/** /office/ 下的表格编辑器 bundle（Vite 原样托管 public/）。 */
const OFFICE_BUNDLE_URL = "/office/sheets-editor.js"

/** 由 sheets-editor.js 导出的 mountSheets 类型（产物里是 ESM export mountSheets）。 */
interface SheetsEditorBundle {
  mountSheets: (options: {
    context: LexoraViewContext
    container: HTMLElement
    bytes: Uint8Array
    name: string
    onDirty: (dirty: boolean) => void
    onSaveRequest?: () => Promise<void>
    onSave?: (bytes: Uint8Array) => Promise<void>
  }) => Promise<OfficeEditor>
}

let bundlePromise: Promise<SheetsEditorBundle> | undefined

/**
 * 动态加载表格编辑器 bundle（单例，避免重复下载 11.9MB）。
 * URL 必须在运行时拼接（随机 query），让 esbuild 无法常量折叠、Vite 无法
 * 静态解析出 public 路径，从而交给浏览器原生 import()。Vite 的
 * office-static 中间件在 HTTP 层原样响应 /office/*。
 */
function loadSheetsBundle(): Promise<SheetsEditorBundle> {
  bundlePromise ??= import(/* @vite-ignore */ buildBundleUrl()) as Promise<SheetsEditorBundle>
  return bundlePromise
}

/** 后台预热 XLSX 编辑器资源，不创建编辑器实例。 */
export function preloadSheetsEditor() {
  return loadSheetsBundle().then(() => undefined)
}

/** 运行时拼接 bundle URL：加随机 query 片段让 esbuild 无法常量折叠。 */
function buildBundleUrl(): string {
  return `${OFFICE_BUNDLE_URL}?novaway=${Math.random().toString(36).slice(2)}`
}

function templateContentType(name: string): string | undefined {
  if (name.toLowerCase().endsWith(".xltx"))
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml"
  return undefined
}

const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"

/**
 * Univer currently accepts the workbook content type, but rejects the Excel template
 * content type before mounting. Normalize only the main part for the in-browser editor;
 * restore the exact template type on every serialized save so Save As and normal Save
 * retain the source extension/package contract.
 */
async function normalizeTemplateBytes(bytes: Uint8Array, name: string): Promise<Uint8Array> {
  const sourceType = templateContentType(name)
  if (!sourceType) return bytes
  const zip = await JSZip.loadAsync(bytes)
  const entry = zip.file("[Content_Types].xml")
  if (!entry) return bytes
  const types = await entry.async("string")
  if (!types.includes(sourceType)) return bytes
  zip.file("[Content_Types].xml", types.replace(sourceType, XLSX_CONTENT_TYPE))
  return zip.generateAsync({ type: "uint8array" })
}

async function restoreTemplateBytes(bytes: Uint8Array, name: string): Promise<Uint8Array> {
  const target = templateContentType(name)
  if (!target) return bytes
  const zip = await JSZip.loadAsync(bytes)
  const entry = zip.file("[Content_Types].xml")
  if (!entry) return bytes
  const types = await entry.async("string")
  const restored = types.replace(XLSX_CONTENT_TYPE, target)
  if (restored === types) return bytes
  zip.file("[Content_Types].xml", restored)
  return zip.generateAsync({ type: "uint8array" })
}

export const mountSheetsEditor: OfficeEditorMount = async (host) => {
  const bundle = await loadSheetsBundle()
  const context = buildLexoraContext(host)
  const releaseTheme = acquireUniverColorScheme(context)
  let editor: Awaited<ReturnType<SheetsEditorBundle["mountSheets"]>>
  try {
    editor = await bundle.mountSheets({
      context,
      container: host.container,
      bytes: await normalizeTemplateBytes(host.bytes, host.name),
      // The editor's importer gates the workbook mode by filename in some builds.
      // Give it the canonical workbook name; the Host still keeps the real template
      // name and restores its content type on serialization.
      name: templateContentType(host.name) ? host.name.replace(/\.(xltx|xltm)$/i, ".xlsx") : host.name,
      onDirty: host.onDirty,
      onSaveRequest: host.onSaveRequest,
      onSave: async () => {
        await host.onSaveRequest?.()
      },
    })
  } catch (error) {
    releaseTheme()
    throw error
  }
  let lastEditorBytes: Uint8Array | undefined
  return {
    save: async () => {
      lastEditorBytes = await editor.save()
      return restoreTemplateBytes(lastEditorBytes, host.name)
    },
    markSaved: async (bytes) => {
      // The wrapped editor saw the normalized package. Keep its own baseline in
      // that representation while the Host writes the restored template package.
      await editor.markSaved?.(lastEditorBytes ?? bytes)
    },
    dispose: () => {
      releaseTheme()
      editor.dispose()
    },
  }
}
