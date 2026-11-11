/**
 * Office Editor Host：Lexora 式浏览器内编辑器的统一接入边界。
 *
 * NovaWay 的文件读写权归 Host，编辑器只拿到初始字节、文件名、DOM 容器和
 * 受限回调 —— 不直接碰本地文件，也不认识 NovaWay 的 SDK / 路径。
 * 这是把 Lexora 的 `OfficeEditor`（save / markSaved / dispose）映射到
 * NovaWay 文件面板的适配层：保存走 `office.document.save`（整字节写回原路径，
 * 进宿主撤销栈 + 原子写 + watcher 广播），与 op 级 `office.document.edit` 并存。
 */

/** 编辑器交给 Host 的统一生命周期（对齐 Lexora `OfficeEditor`）。 */
export interface OfficeEditor {
  /** 取出编辑器当前完整字节（dirty 时的保存内容）。 */
  save: () => Promise<Uint8Array>
  /** 保存成功后由 Host 回调：编辑器据此清掉内部脏状态 / 撤销基线。 */
  markSaved?: (bytes?: Uint8Array) => void | Promise<void>
  /** 卸载编辑器，释放 React root / worker / 事件监听 / 样式与字体资源。 */
  dispose: () => void
}

/** 编辑器需要的受限运行环境（对齐 Lexora `OfficeEditorOptions` 的宿主侧）。 */
export interface OfficeEditorContext {
  /** 编辑器挂载的 DOM 容器（Host 提供）。 */
  container: HTMLElement
  /** 初始文件字节（base64 解码后）。 */
  bytes: Uint8Array
  /** 文件名（含扩展名），编辑器据此选布局/引擎。 */
  name: string
  /** 脏状态通知：true 表示有未保存改动，Host 更新面板指示。 */
  onDirty: (dirty: boolean) => void
  /** 编辑器主动请求保存（如 Ctrl+S / 定时备份），Host 负责写盘。 */
  onSaveRequest?: () => Promise<void>
  /** 保存前校验磁盘版本；返回获准写入版本的 SHA-256，false 表示取消。 */
  beforeSave?: (baselineBytes: Uint8Array) => Promise<string | false>
  /** 中止信号：Host 卸载时触发，编辑器须释放资源。 */
  signal?: AbortSignal
}

/**
 * 编辑器工厂：按文件格式返回对应的浏览器内编辑器挂载函数。
 * 动态 import，让 DOCX / XLSX / PPTX / PDF 各自的依赖（React、Univer、
 * pdfjs WASM 等）只在打开该格式时才加载。
 */
export type OfficeEditorMount = (context: OfficeEditorContext) => Promise<OfficeEditor>

/**
 * 按文件扩展名选编辑器挂载函数。
 *
 * Legacy-format bridge converts DOC/XLS/PPT/RTF/ODF to a modern OOXML
 * sibling before this factory is called; the factory itself only mounts the
 * native modern editor bundles.
 *
 * DOCX 系列（DOCX/DOCM/DOTX/DOTM）、XLSX 系列（XLSX/XLSM/XLTX/XLTM）、
 * PPTX 系列（PPTX/PPTM/POTX/POTM/PPSX/PPSM）与 PDF 已接入 Lexora GenOffice
 * 编辑器（public/office/*，动态 import）。
 */
export function officeEditorMountFor(path: string | undefined): OfficeEditorMount | undefined {
  if (!path) return undefined
  const lower = path.toLowerCase()
  if (isDocxPath(lower)) {
    // 动态 import，让 DOCX 编辑器（7.4MB bundle）只在打开 DOCX 时才加载。
    return async (context) => {
      const { mountDocxEditor } = await import("./office-editors/docx-editor-host")
      return mountDocxEditor(context)
    }
  }
  if (isSheetsPath(lower)) {
    // 动态 import，让表格编辑器（11.9MB bundle）只在打开 XLSX 时才加载。
    return async (context) => {
      const { mountSheetsEditor } = await import("./office-editors/sheets-editor-host")
      return mountSheetsEditor(context)
    }
  }
  if (isSlidesPath(lower)) {
    // 动态 import，让演示文稿编辑器（5MB bundle）只在打开 PPTX 时才加载。
    return async (context) => {
      const { mountSlidesEditor } = await import("./office-editors/slides-editor-host")
      return mountSlidesEditor(context)
    }
  }
  if (lower.endsWith(".pdf")) {
    // 动态 import，让 PDF 编辑器（2.6MB bundle + pdfjs wasm/字体）只在打开 PDF 时加载。
    return async (context) => {
      const { mountPdfEditor } = await import("./office-editors/pdf-editor-host")
      return mountPdfEditor(context)
    }
  }
  return undefined
}

/** DOCX 系列扩展名（含带宏/模板变体）。 */
function isDocxPath(lower: string): boolean {
  return lower.endsWith(".docx") || lower.endsWith(".docm") || lower.endsWith(".dotx") || lower.endsWith(".dotm")
}

/** XLSX 系列扩展名（含带宏/模板变体）。 */
function isSheetsPath(lower: string): boolean {
  return lower.endsWith(".xlsx") || lower.endsWith(".xlsm") || lower.endsWith(".xltx") || lower.endsWith(".xltm")
}

/** PPTX 系列扩展名（含带宏/模板/放映变体）。 */
function isSlidesPath(lower: string): boolean {
  return (
    lower.endsWith(".pptx") ||
    lower.endsWith(".pptm") ||
    lower.endsWith(".potx") ||
    lower.endsWith(".potm") ||
    lower.endsWith(".ppsx") ||
    lower.endsWith(".ppsm")
  )
}
