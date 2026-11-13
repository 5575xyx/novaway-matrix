import { createEffect, createSignal, For, Match, onCleanup, Show, Switch, type Component } from "solid-js"
import type { OfficeOp } from "@novaway/core/office/engine/contract"
import {
  extractPdfPages,
  mergePdfPages,
  pdfEngine,
  splitPdfPages,
  type PdfPageImage,
} from "@novaway/core/office/pdf/engine"
import { usePlatform } from "@/context/platform"
import { officeFormatOf } from "@novaway/core/office/engine/registry"
import { showToast } from "@novaway/ui/toast"
import { detectLegacyExtension, readLegacyDocument, type LegacyDocument } from "@novaway/core/office/legacy/read"
import { ImageFilePreview, type ImageSave } from "@/pages/session/image-file-preview"
import { base64ToBytes, bytesToBase64, isImagePreviewPath } from "@/pages/session/office-preview-utils"
import { OfficeEditorHost } from "@/pages/session/office-editor-host-component"
import { PaneStatusBar } from "@/pages/session/pane-status-bar"
import { useOfficeRibbonTabs, RibbonRow, RIBBON_BUTTON } from "@/pages/session/office-ribbon"
import {
  INSPECTOR_INPUT,
  InspectorAction,
  InspectorField,
  InspectorSection,
  InspectorToggle,
  PaneInspector,
} from "@/pages/session/pane-inspector"

export {
  OFFICE_EXTENSIONS,
  IMAGE_EXTENSIONS,
  RICH_TEXT_EXTENSIONS,
  isOfficePreviewPath,
  isImagePreviewPath,
  isRichTextPath,
  base64ToBytes,
} from "@/pages/session/office-preview-utils"

export type PdfPageOp = OfficeOp

export type OfficeFilePreviewProps = {
  path: string
  base64: string
  /** 画布内改字写回文件后通知上层重读，预览才能看到新内容。 */
  onEdited?: () => void
  /** 兼容嵌入预览的旧格式段落写回；文件面板主链路使用旧格式转 OOXML 的转换编辑。 */
  onSaveParagraph?: (paragraph: number, text: string) => Promise<void>
  /** 兼容嵌入预览的旧格式单元格写回；文件面板主链路使用旧格式转 OOXML 的转换编辑。 */
  onSaveCell?: (sheet: string, cell: string, value: string) => Promise<void>
  /** 图片编辑（旋转/翻转/裁剪/标注）写回：由文件页注入，预览组件不直接依赖 SDK 上下文。 */
  onSaveImage?: ImageSave
  /** 未保存状态联动：Lexora 编辑器 dirty 时由面板显示指示。 */
  onDirty?: (dirty: boolean) => void
  /** 保存前检查磁盘版本，避免静默覆盖外部更改。 */
  beforeOfficeSave?: (baselineBytes: Uint8Array, targetPath?: string) => Promise<string | false>
  /** Host 独占的写盘回调：项目文件和桌面外部文件使用各自的平台 API。 */
  writeOfficeBytes?: (bytes: Uint8Array, expectedBaselineSha256?: string, targetPath?: string) => Promise<void>
  /** Legacy-format bridge: convert legacy bytes to a modern OOXML editor document. */
  prepareLegacyEditor?: (sourcePath: string, bytes: Uint8Array) => Promise<{ path: string; bytes: Uint8Array }>
  /** 旧版 NovaWay PDF 页面操作，经宿主 document.edit 写入并进入撤销栈。 */
  onPdfPageOp?: (op: OfficeOp) => Promise<void>
  /** 切换 Lexora 与兼容 PDF 工具前由面板检查 dirty 状态。 */
  onTogglePdfTools?: (open: boolean) => boolean
  onPdfPage?: (page: number) => void
  /** 关闭守卫/保活回收对齐的标签路径（旧格式转换编辑时是原始文件路径）。 */
  closeGuardPath?: string
}

/**
 * 右栏文件预览分发器:
 * PDF 走 Chromium 内嵌阅读器,图片走真实 <img>,DOCX/PPTX/XLSX 交给各自的真实渲染器。
 */
export const OfficeFilePreview: Component<OfficeFilePreviewProps> = (props) => {
  const [pdfToolsOpen, setPdfToolsOpen] = createSignal(false)
  createEffect(() => {
    props.path
    setPdfToolsOpen(false)
  })
  // 按 core registry 的别名表分派：docm / xlsm / pptm 这些带宏变体和正式格式同构，
  // 走同一个渲染器，不再逐个后缀写 endsWith。
  const format = () => officeFormatOf(props.path)
  const togglePdfTools = () => {
    const next = !pdfToolsOpen()
    if (props.onTogglePdfTools && !props.onTogglePdfTools(next)) return
    setPdfToolsOpen(next)
  }
  return (
    <Switch>
      <Match when={format() === "pdf"}>
        <div class="flex h-full min-h-0 flex-col">
          <div class="flex h-8 shrink-0 items-center justify-end border-b border-border px-2">
            <button
              type="button"
              class="rounded px-2 py-1 text-11-regular text-foreground-subtle hover:bg-hover hover:text-foreground"
              data-action="toggle-pdf-compat-tools"
              onClick={togglePdfTools}
            >
              {pdfToolsOpen() ? "返回 Lexora PDF 编辑器" : "更多 PDF 页面工具"}
            </button>
          </div>
          <Show
            when={pdfToolsOpen()}
            fallback={
              <OfficeEditorHost
                path={props.path}
                base64={props.base64}
                onDirty={props.onDirty}
                beforeSave={props.beforeOfficeSave}
                writeBytes={props.writeOfficeBytes}
                closeGuardPath={props.closeGuardPath ?? props.path}
              />
            }
          >
            <PdfPageTools
              base64={props.base64}
              path={props.path}
              onPageOp={props.onPdfPageOp}
              onPage={props.onPdfPage}
            />
          </Show>
        </div>
      </Match>
      <Match when={format() === "legacy"}>
        <Show
          when={props.prepareLegacyEditor}
          fallback={
            <LegacyFrame
              base64={props.base64}
              path={props.path}
              onSaveParagraph={props.onSaveParagraph}
              onSaveCell={props.onSaveCell}
              onEdited={props.onEdited}
            />
          }
        >
          {(prepare) => (
            <LegacyEditorFrame
              base64={props.base64}
              path={props.path}
              prepare={prepare()!}
              onDirty={props.onDirty}
              beforeSave={props.beforeOfficeSave}
              writeBytes={props.writeOfficeBytes}
              closeGuardPath={props.closeGuardPath ?? props.path}
            />
          )}
        </Show>
      </Match>
      <Match when={isImagePreviewPath(props.path)}>
        <ImageFilePreview base64={props.base64} path={props.path} onSaveImage={props.onSaveImage} />
      </Match>
      <Match when={format() === "docx" || format() === "pptx" || format() === "xlsx"}>
        <OfficeEditorHost
          path={props.path}
          base64={props.base64}
          onDirty={props.onDirty}
          beforeSave={props.beforeOfficeSave}
          writeBytes={props.writeOfficeBytes}
          closeGuardPath={props.closeGuardPath ?? props.path}
        />
      </Match>
    </Switch>
  )
}

/**
 * Legacy-format bridge. The source remains untouched; its bytes are converted
 * in memory (and seeded into a modern sibling) before the normal OOXML Host mounts.
 */
const LegacyEditorFrame: Component<{
  base64: string
  path: string
  prepare: (sourcePath: string, bytes: Uint8Array) => Promise<{ path: string; bytes: Uint8Array }>
  onDirty?: (dirty: boolean) => void
  beforeSave?: (baselineBytes: Uint8Array, targetPath?: string) => Promise<string | false>
  writeBytes?: (bytes: Uint8Array, expectedBaselineSha256?: string, targetPath?: string) => Promise<void>
  closeGuardPath?: string
}> = (props) => {
  const [prepared, setPrepared] = createSignal<{ path: string; bytes: Uint8Array }>()
  const [error, setError] = createSignal<string>()

  createEffect(() => {
    const sourcePath = props.path
    const sourceBase64 = props.base64
    setPrepared(undefined)
    setError(undefined)
    if (!sourceBase64) return
    void (async () => {
      try {
        setPrepared(await props.prepare(sourcePath, base64ToBytes(sourceBase64)))
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    })()
  })

  return (
    <Show
      when={prepared()}
      fallback={
        <Show
          when={error()}
          fallback={
            <div class="flex h-full items-center justify-center text-12-regular text-foreground-subtle">
              正在把旧格式转换为现代 Office 格式…
            </div>
          }
        >
          {(message) => <div class="p-6 text-12-regular text-critical-base">{message()}</div>}
        </Show>
      }
    >
      {(document) => (
        <div class="flex h-full min-h-0 flex-col">
          <div class="shrink-0 border-b border-border px-3 py-1.5 text-11-regular text-foreground-subtle">
            {props.path.split(/[\\/]/).pop()} 已转换为 {document().path.split(/[\\/]/).pop()}{" "}
            编辑；保存只写入现代格式副本，不覆盖原文件
          </div>
          <div class="min-h-0 flex-1">
            <OfficeEditorHost
              path={document().path}
              base64={bytesToBase64(document().bytes)}
              onDirty={props.onDirty}
              beforeSave={props.beforeSave ? (baseline) => props.beforeSave!(baseline, document().path) : undefined}
              writeBytes={
                props.writeBytes ? (bytes, expected) => props.writeBytes!(bytes, expected, document().path) : undefined
              }
              closeGuardPath={props.closeGuardPath ?? props.path}
            />
          </div>
        </div>
      )}
    </Show>
  )
}

/**
 * 兼容嵌入页面或没有 Host 转换回调时的旧格式摘要预览。
 * 文件面板主链路会优先使用上面的 LegacyEditorFrame。
 */
const LegacyFrame: Component<{
  base64: string
  path: string
  onSaveParagraph?: (paragraph: number, text: string) => Promise<void>
  onSaveCell?: (sheet: string, cell: string, value: string) => Promise<void>
  onEdited?: () => void
}> = (props) => {
  const [doc, setDoc] = createSignal<LegacyDocument | undefined>()
  const [error, setError] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  // 旧格式里只有 ODF（odt / ods / odp）有就地写回引擎；RTF 与 Office 97-2003
  // 二进制（doc / xls / ppt）只能读：core 能解析出文字，但没有写回引擎，
  // 所以这里据实际探测到的格式强制只读，而不是靠调用方不传 onSaveParagraph / onSaveCell。
  const [readonly, setReadonly] = createSignal(false)
  const [editing, setEditing] = createSignal<
    { kind: "paragraph"; index: number } | { kind: "cell"; sheet: string; row: number; col: number } | undefined
  >()
  const [draft, setDraft] = createSignal("")

  createEffect(() => {
    const bytes = props.base64 ? base64ToBytes(props.base64) : undefined
    if (!bytes) return
    void (async () => {
      try {
        const extension = await detectLegacyExtension(bytes)
        // RTF 与 Office 97-2003 二进制没有就地写回引擎，只有 ODF 能改。
        setReadonly(extension === "doc" || extension === "xls" || extension === "ppt" || extension === "rtf")
        setDoc(await readLegacyDocument(bytes, extension))
        setError("")
        setEditing(undefined)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
        setDoc(undefined)
      }
    })()
  })

  const editable = () => !readonly() && Boolean(props.onSaveParagraph || props.onSaveCell)
  const paragraphEditable = () => !readonly() && Boolean(props.onSaveParagraph)
  const cellEditable = () => !readonly() && Boolean(props.onSaveCell)

  const beginParagraph = (index: number, text: string) => {
    if (!paragraphEditable() || saving()) return
    setEditing({ kind: "paragraph", index })
    setDraft(text)
  }

  const beginCell = (sheet: string, row: number, col: number, text: string) => {
    if (!cellEditable() || saving()) return
    setEditing({ kind: "cell", sheet, row, col })
    setDraft(text)
  }

  const cancel = () => {
    if (saving()) return
    setEditing(undefined)
  }

  const commit = async () => {
    const current = editing()
    if (!current || saving()) return
    const value = draft()
    setSaving(true)
    try {
      if (current.kind === "paragraph") {
        await props.onSaveParagraph!(current.index + 1, value)
      } else {
        await props.onSaveCell!(current.sheet, cellRef(current.row, current.col), value)
      }
      setEditing(undefined)
      props.onEdited?.()
    } catch (cause) {
      showToast({
        variant: "error",
        title: "旧格式没有改成功",
        description: cause instanceof Error ? cause.message : String(cause),
      })
    } finally {
      setSaving(false)
    }
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault()
      cancel()
      return
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      void commit()
    }
  }

  const isEditingParagraph = (index: number) => {
    const current = editing()
    return current?.kind === "paragraph" && current.index === index
  }

  const isEditingCell = (sheet: string, row: number, col: number) => {
    const current = editing()
    return current?.kind === "cell" && current.sheet === sheet && current.row === row && current.col === col
  }

  /**
   * 旧格式的功能区：这里没有「点一下就能改」的命令，
   * 但标签行仍然由宿主统一画，位置和其它编辑器一致。
   */
  const homeTab = () => (
    <span class="text-11-regular text-foreground-subtlest">
      {editable()
        ? "可编辑（ODT / ODS / ODP）· 双击段落或单元格改字，回车保存，Esc 取消"
        : "只读预览（旧格式）· 右上角「导出」可另存为 docx / xlsx / pptx 继续编辑，不覆盖原文件"}
      {doc()?.pageCount ? ` · 共 ${doc()!.pageCount} 页` : ""}
    </span>
  )

  useOfficeRibbonTabs(() => [{ id: "home", label: "开始", render: homeTab }])

  return (
    <div class="flex h-full flex-col overflow-hidden">
      <Show when={!error()} fallback={<div class="p-6 text-12-regular text-foreground-subtle">{error()}</div>}>
        <Show
          when={doc()?.kind === "spreadsheet"}
          fallback={
            <div class="min-h-0 flex-1 overflow-auto px-4 py-3">
              <Show
                when={doc()?.paragraphs?.length}
                fallback={<div class="text-12-regular text-foreground-subtle">（没有段落）</div>}
              >
                <For each={doc()!.paragraphs}>
                  {(text, index) => (
                    <Show
                      when={isEditingParagraph(index())}
                      fallback={
                        <div
                          class="flex gap-3 rounded px-1 py-0.5 transition-colors hover:bg-hover"
                          onClick={() => beginParagraph(index(), text)}
                          title={paragraphEditable() ? "点击编辑这一段" : undefined}
                        >
                          <span class="w-8 shrink-0 text-right text-10-regular tabular-nums text-foreground-subtlest">
                            {index() + 1}
                          </span>
                          <span class="min-w-0 whitespace-pre-wrap break-words text-12-regular leading-6 text-foreground">
                            {text || "（空段落）"}
                          </span>
                        </div>
                      }
                    >
                      <div class="flex gap-2 py-0.5">
                        <span class="w-8 shrink-0 text-right text-10-regular tabular-nums text-foreground-subtlest">
                          {index() + 1}
                        </span>
                        <textarea
                          class="min-h-6 flex-1 resize-y rounded border border-border bg-background px-1.5 py-0.5 text-12-regular leading-6 text-foreground outline-none focus:border-border-hover"
                          data-action="legacy-edit-paragraph"
                          value={draft()}
                          autofocus
                          onInput={(event) => setDraft(event.currentTarget.value)}
                          onBlur={() => void commit()}
                          onKeyDown={onKeyDown}
                        />
                      </div>
                    </Show>
                  )}
                </For>
              </Show>
            </div>
          }
        >
          <div class="min-h-0 flex-1 overflow-auto px-4 py-3">
            <For each={doc()!.sheets}>
              {(sheet) => (
                <div class="mb-6">
                  <div class="mb-1 text-12-medium text-foreground">{sheet.name}</div>
                  <table class="w-full table-fixed border-collapse text-12-regular">
                    <tbody>
                      <For each={sheet.rows}>
                        {(row, rowIndex) => (
                          <tr>
                            <For each={row}>
                              {(cell, colIndex) => (
                                <td class="border border-border px-2 py-1 align-top text-foreground">
                                  <Show
                                    when={isEditingCell(sheet.name, rowIndex(), colIndex())}
                                    fallback={
                                      <div
                                        class="min-h-5 cursor-text whitespace-pre-wrap break-words"
                                        onClick={() => beginCell(sheet.name, rowIndex(), colIndex(), cell)}
                                        title={cellEditable() ? "点击改这个单元格" : undefined}
                                      >
                                        {cell}
                                      </div>
                                    }
                                  >
                                    <input
                                      class="w-full rounded border border-border bg-background px-1 py-0.5 text-12-regular text-foreground outline-none focus:border-border-hover"
                                      data-action="legacy-edit-cell"
                                      value={draft()}
                                      autofocus
                                      onInput={(event) => setDraft(event.currentTarget.value)}
                                      onBlur={() => void commit()}
                                      onKeyDown={onKeyDown}
                                    />
                                  </Show>
                                </td>
                              )}
                            </For>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  )
}

/** 0 起行列 → A1；和 `setCellValue` 的坐标一致。 */
function cellRef(row: number, col: number): string {
  let name = ""
  let value = col
  do {
    name = String.fromCharCode(65 + (value % 26)) + name
    value = Math.floor(value / 26) - 1
  } while (value >= 0)
  return name + (row + 1)
}

// PDF 交给 Chromium 自带的阅读器:用 Blob URL 直接 embed,缩略图/翻页/缩放都由它提供。
export const PdfPageTools: Component<{
  base64: string
  path: string
  onPageOp?: (op: PdfPageOp) => Promise<void>
  onPage?: (page: number) => void
}> = (props) => {
  const [url, setUrl] = createSignal<string>()
  const [nextUrl, setNextUrl] = createSignal<string>()
  let urlSequence = 0
  const createdUrls = new Set<string>()
  createEffect(() => {
    const value = props.base64
    if (!value) return
    const sequence = ++urlSequence
    const candidate = URL.createObjectURL(new Blob([base64ToBytes(value)], { type: "application/pdf" }))
    createdUrls.add(candidate)
    setNextUrl(candidate)
    onCleanup(() => {
      if (sequence !== urlSequence) {
        URL.revokeObjectURL(candidate)
        createdUrls.delete(candidate)
      }
    })
  })
  onCleanup(() => {
    for (const value of createdUrls) URL.revokeObjectURL(value)
    createdUrls.clear()
  })

  const commitUrl = (candidate: string) => {
    if (candidate !== nextUrl()) return
    const current = url()
    setUrl(candidate)
    setNextUrl(undefined)
    if (current && current !== candidate) {
      URL.revokeObjectURL(current)
      createdUrls.delete(current)
    }
  }
  const [page, setPage] = createSignal(1)
  // 页码要报到外面：面板的「导出 PNG」默认出当前页。
  createEffect(() => props.onPage?.(page()))
  const [busy, setBusy] = createSignal(false)
  const [overlay, setOverlay] = createSignal("")
  const [findText, setFindText] = createSignal("")
  const [replaceText, setReplaceText] = createSignal("")
  const [noteText, setNoteText] = createSignal("")
  const [crop, setCrop] = createSignal("0")
  // 缩放百分比：100 = 适应页面（Chromium 阅读器用 #zoom= 片段，100 就是 fit 的近似）。
  const [pdfZoom, setPdfZoom] = createSignal(100)
  // AcroForm 字段：填一个文本框 / 勾一个复选框，和 AI 的 fillForm 是同一条 op。
  const [fields, setFields] = createSignal<Array<{ name: string; kind: string; value?: string | boolean }>>([])
  const [formValues, setFormValues] = createSignal<Record<string, string | boolean>>({})
  // 提取 / 拆分：只产出新文件，不改原 PDF，所以不走 `run` 的编辑通道。
  const platform = usePlatform()
  const [extractRange, setExtractRange] = createSignal("1-3")
  const [splitEvery, setSplitEvery] = createSignal("1")
  const [annotateKind, setAnnotateKind] = createSignal<Extract<PdfPageOp, { op: "annotatePage" }>["kind"]>("text")
  const [annotateId, setAnnotateId] = createSignal("")
  const [replyTo, setReplyTo] = createSignal("")
  let imageInput: HTMLInputElement | undefined
  let replaceInput: HTMLInputElement | undefined
  let pageInput: HTMLInputElement | undefined
  let mergeInput: HTMLInputElement | undefined
  // 页面上已有图片的位置：读出来放进输入框，改完用一条 setPageImageBox 写回。
  const [images, setImages] = createSignal<PdfPageImage[]>([])
  const [imageIndex, setImageIndex] = createSignal(1)
  const [imageBox, setImageBox] = createSignal({ x: 0, y: 0, width: 0, height: 0, rotation: 0 })
  // 检查器抽屉：裁边 / 提取拆分 / 批注 / 图片这些带数值或要选文件的命令都收在这里，工具条只留一行命令。
  const [inspector, setInspector] = createSignal(false)

  let imageMetadataSequence = 0
  createEffect(() => {
    const value = props.base64
    const current = Math.max(1, Math.round(page()))
    if (!value) return
    const sequence = ++imageMetadataSequence
    void (async () => {
      const opened = await pdfEngine.open(base64ToBytes(value))
      if (!opened.ok || sequence !== imageMetadataSequence) return
      const list = opened.data.pages[current - 1]?.images ?? []
      setImages(list)
      const chosen = list.find((item) => item.index === imageIndex()) ?? list[0]
      if (!chosen) return
      if (chosen.index !== imageIndex()) setImageIndex(chosen.index)
      setImageBox({
        x: chosen.x,
        y: chosen.y,
        width: chosen.width,
        height: chosen.height,
        rotation: chosen.rotation,
      })
    })()
  })

  let formMetadataSequence = 0
  createEffect(() => {
    const value = props.base64
    if (!value) return
    const sequence = ++formMetadataSequence
    void (async () => {
      const opened = await pdfEngine.open(base64ToBytes(value))
      if (!opened.ok || sequence !== formMetadataSequence) return
      const list = opened.data.fields
      setFields(list)
      setFormValues(
        Object.fromEntries(list.map((field) => [field.name, field.value ?? (field.kind === "checkbox" ? false : "")])),
      )
    })()
  })

  const addImage = async (file: File | undefined) => {
    if (!file || busy()) return
    const bytes = new Uint8Array(await file.arrayBuffer())
    // btoa 一次只吃一个小字符串；分块拼，几十 KB 的截图也不会爆栈。
    let binary = ""
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
    }
    const dataBase64 = btoa(binary)
    run((current) => ({
      op: "addPageImage",
      page: current,
      dataBase64,
      mime: file.type || "image/png",
      x: 40,
      y: 120,
      width: 200,
      height: 120,
    }))
  }

  /** 换图片：把当前页上的第 index 张图（默认第一张）换成新图，位置和缩放不动。 */
  const replaceImage = async (file: File | undefined) => {
    if (!file || busy()) return
    const bytes = new Uint8Array(await file.arrayBuffer())
    let binary = ""
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
    }
    const dataBase64 = btoa(binary)
    run((current) => ({
      op: "replacePageImage",
      page: current,
      index: 1,
      dataBase64,
      mime: file.type || "image/png",
    }))
  }

  const setBoxField = (key: "x" | "y" | "width" | "height", value: number) => {
    if (!Number.isFinite(value)) return
    setImageBox((box) => ({ ...box, [key]: value }))
  }

  /** 方向键每次 10pt。 */
  const nudgeImage = (dx: number, dy: number) => {
    setImageBox((box) => ({ ...box, x: box.x + dx, y: box.y + dy }))
  }

  const rotateImage = (next: number) => {
    setImageBox((box) => {
      const delta = (((next - box.rotation) % 360) + 360) % 360
      // 转 90 / 270 时宽高互换，图片不会在框里变形。
      return delta === 90 || delta === 270
        ? { ...box, rotation: next, width: box.height, height: box.width }
        : { ...box, rotation: next }
    })
  }

  const applyImageBox = () => {
    const box = imageBox()
    run((current) => ({
      op: "setPageImageBox",
      page: current,
      index: imageIndex(),
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      rotation: box.rotation,
    }))
  }

  /** 从另一份 PDF 复制整份页面，插到当前页之后。原 PDF 只读，不受影响。 */
  const insertPages = async (file: File | undefined) => {
    if (!file || busy()) return
    const bytes = new Uint8Array(await file.arrayBuffer())
    let binary = ""
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
    }
    const dataBase64 = btoa(binary)
    run((current) => ({ op: "insertPdfPages", after: current, dataBase64 }))
  }

  const run = (build: (current: number) => PdfPageOp) => {
    if (!props.onPageOp || busy()) return
    const current = Math.max(1, Math.round(page()))
    void (async () => {
      setBusy(true)
      try {
        await props.onPageOp!(build(current))
      } finally {
        setBusy(false)
      }
    })()
  }

  /** 文件名去掉目录和后缀，用来给提取 / 拆分出来的新文件起名。 */
  const fileStem = () => {
    const clean = props.path.replace(/\\/g, "/")
    const base = clean.slice(clean.lastIndexOf("/") + 1)
    const dot = base.lastIndexOf(".")
    return dot > 0 ? base.slice(0, dot) : base
  }

  const joinPath = (dir: string, name: string) => dir.replace(/[\\/]+$/, "") + (dir.includes("\\") ? "\\" : "/") + name

  /** `1-3,5` → [1,2,3,5]；写法不对返回空数组。 */
  const parsePageRange = (input: string) => {
    const pages: number[] = []
    for (const part of input.split(",")) {
      const item = part.trim()
      if (!item) continue
      const range = /^(\d+)-(\d+)$/.exec(item)
      if (range) {
        const from = Number(range[1])
        const to = Number(range[2])
        if (from < 1 || to < from) return []
        for (let page = from; page <= to; page += 1) pages.push(page)
        continue
      }
      const page = Number(item)
      if (!Number.isInteger(page) || page < 1) return []
      pages.push(page)
    }
    return [...new Set(pages)]
  }

  /** 网页端没有本地写盘通道时的兜底：让浏览器下载文件。 */
  const downloadBytes = (bytes: Uint8Array, name: string) => {
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/pdf" }))
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = name
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const extractSelection = () => {
    const pages = parsePageRange(extractRange())
    if (pages.length === 0) {
      showToast({ title: "页码范围不对", description: "用 1-3,5 这种写法，页码从 1 开始。" })
      return
    }
    void (async () => {
      setBusy(true)
      try {
        const bytes = await extractPdfPages(base64ToBytes(props.base64), pages)
        const name = `${fileStem()}-提取.pdf`
        if (platform.saveFilePickerDialog) {
          const saved = await platform.saveFilePickerDialog({ title: "提取页面为 PDF", defaultPath: name, data: bytes })
          if (saved) showToast({ title: "已导出", description: saved })
        } else {
          downloadBytes(bytes, name)
        }
      } catch (error) {
        showToast({ title: "提取失败", description: error instanceof Error ? error.message : String(error) })
      } finally {
        setBusy(false)
      }
    })()
  }

  const splitDocument = () => {
    const size = Number(splitEvery())
    if (!Number.isInteger(size) || size < 1) {
      showToast({ title: "每份页数不对", description: "请输入正整数。" })
      return
    }
    void (async () => {
      setBusy(true)
      try {
        const parts = await splitPdfPages(base64ToBytes(props.base64), size)
        const names = parts.map((_, index) => `${fileStem()}-${index + 1}.pdf`)
        if (platform.openDirectoryPickerDialog && platform.writeLocalFileBase64) {
          const picked = await platform.openDirectoryPickerDialog({ title: "选择拆分后保存的文件夹" })
          const dir = Array.isArray(picked) ? picked[0] : picked
          if (!dir) return
          let written = 0
          for (const [index, part] of parts.entries()) {
            const ok = await platform.writeLocalFileBase64(joinPath(dir, names[index]!), bytesToBase64(part))
            if (ok) written += 1
          }
          showToast({ title: `已拆分成 ${written} 份`, description: dir })
          return
        }
        parts.forEach((part, index) => downloadBytes(part, names[index]!))
      } catch (error) {
        showToast({ title: "拆分失败", description: error instanceof Error ? error.message : String(error) })
      } finally {
        setBusy(false)
      }
    })()
  }

  /** 合并：当前 PDF 在前，所选文件按顺序接在后面，另存为新文件。 */
  const mergeDocuments = (files: Iterable<File> | undefined) => {
    const picked = [...(files ?? [])]
    if (picked.length === 0) return
    void (async () => {
      setBusy(true)
      try {
        const sources = [base64ToBytes(props.base64)]
        for (const file of picked) sources.push(new Uint8Array(await file.arrayBuffer()))
        const bytes = await mergePdfPages(sources)
        const name = `${fileStem()}-合并.pdf`
        if (platform.saveFilePickerDialog) {
          const saved = await platform.saveFilePickerDialog({ title: "合并 PDF", defaultPath: name, data: bytes })
          if (saved) showToast({ title: "已合并", description: saved })
        } else {
          downloadBytes(bytes, name)
        }
      } catch (error) {
        showToast({ title: "合并失败", description: error instanceof Error ? error.message : String(error) })
      } finally {
        setBusy(false)
      }
    })()
  }

  /**
   * 功能区（宿主画标签行，这里只画命令）。
   * 「页面」管结构，「编辑」管内容；阅读和修改不会互相挤占。
   */
  const pageTab = () => (
    <RibbonRow>
      <span class="text-11-regular text-foreground-subtlest">页</span>
      <input
        type="number"
        min={1}
        data-action="pdf-page-input"
        class="h-6 w-12 rounded border border-border bg-background px-1 text-11-regular text-foreground outline-none focus:border-border-hover"
        value={page()}
        onInput={(event) => setPage(Number(event.currentTarget.value) || 1)}
      />
      <button
        type="button"
        data-action="pdf-page-delete"
        disabled={busy()}
        class="rounded px-1.5 py-0.5 text-11-regular text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground disabled:opacity-40"
        onClick={() => run((current) => ({ op: "deletePage", page: current }))}
      >
        删除
      </button>
      <button
        type="button"
        data-action="pdf-page-rotate"
        disabled={busy()}
        class="rounded px-1.5 py-0.5 text-11-regular text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground disabled:opacity-40"
        onClick={() => run((current) => ({ op: "rotatePage", page: current, degrees: 90 }))}
      >
        旋转 90°
      </button>
      <button
        type="button"
        data-action="pdf-page-move-up"
        disabled={busy()}
        class="rounded px-1.5 py-0.5 text-11-regular text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground disabled:opacity-40"
        onClick={() => run((current) => ({ op: "movePage", from: current, to: Math.max(1, current - 1) }))}
      >
        上移
      </button>
      <button
        type="button"
        data-action="pdf-page-move-down"
        disabled={busy()}
        class="rounded px-1.5 py-0.5 text-11-regular text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground disabled:opacity-40"
        onClick={() => run((current) => ({ op: "movePage", from: current, to: current + 1 }))}
      >
        下移
      </button>
      <button
        type="button"
        data-action="pdf-page-insert"
        disabled={busy()}
        class="rounded px-1.5 py-0.5 text-11-regular text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground disabled:opacity-40"
        onClick={() => run((current) => ({ op: "insertBlankPage", after: current }))}
      >
        插入空白页
      </button>
      {/* 从另一份 PDF 复制页面：整份插入到当前页之后。 */}
      <button
        type="button"
        data-action="pdf-insert-pages"
        disabled={busy()}
        class="rounded px-1.5 py-0.5 text-11-regular text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground disabled:opacity-40"
        title="把另一份 PDF 的页面插到当前页之后"
        onClick={() => pageInput?.click()}
      >
        插入页面
      </button>
      <input
        ref={(el) => {
          pageInput = el
        }}
        type="file"
        accept="application/pdf,.pdf"
        class="hidden"
        data-action="pdf-insert-pages-input"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ""
          void insertPages(file)
        }}
      />
      {/* 页面级的数值命令（裁边、提取拆分、合并）同样进抽屉。 */}
      <InspectorToggle
        open={inspector()}
        onToggle={() => setInspector(!inspector())}
        title="打开检查器：裁边 / 提取与拆分 / 合并"
      />
      {busy() ? <span class="text-11-regular text-foreground-subtlest">处理中…</span> : null}
    </RibbonRow>
  )

  const editTab = () => (
    <RibbonRow>
      {/* 叠加文字 / 高亮：坐标先用页面左上角的固定位置，
              在阅读器里看到位置后再用 AI / CLI 精确调整（x/y 都是 pt）。 */}
      <input
        type="text"
        data-action="pdf-overlay-text"
        placeholder="叠加文字（支持中文）"
        class="h-6 min-w-0 flex-1 rounded border border-border bg-background px-1.5 text-11-regular text-foreground outline-none focus:border-border-hover"
        value={overlay()}
        onInput={(event) => setOverlay(event.currentTarget.value)}
      />
      <button
        type="button"
        data-action="pdf-overlay-add-text"
        disabled={busy() || overlay().trim() === ""}
        class="rounded px-1.5 py-0.5 text-11-regular text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground disabled:opacity-40"
        onClick={() =>
          run((current) => ({
            op: "addPageText",
            page: current,
            text: overlay().trim(),
            x: 40,
            y: 40,
            size: 14,
            color: "1F2937",
          }))
        }
      >
        加文字
      </button>
      {/* 原地替换：只换内容流里的字符串，字体和坐标沿用原来的 run。 */}
      <input
        type="text"
        data-action="pdf-find-text"
        placeholder="查找"
        class="h-6 w-20 rounded border border-border bg-background px-1.5 text-11-regular text-foreground outline-none focus:border-border-hover"
        value={findText()}
        onInput={(event) => setFindText(event.currentTarget.value)}
      />
      <input
        type="text"
        data-action="pdf-replace-text"
        placeholder="替换为"
        class="h-6 w-20 rounded border border-border bg-background px-1.5 text-11-regular text-foreground outline-none focus:border-border-hover"
        value={replaceText()}
        onInput={(event) => setReplaceText(event.currentTarget.value)}
      />
      <button
        type="button"
        data-action="pdf-replace-text-run"
        disabled={busy() || findText().trim() === "" || replaceText() === ""}
        class="rounded px-1.5 py-0.5 text-11-regular text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground disabled:opacity-40"
        title="在当前页原地替换文字（保留字体和位置）"
        onClick={() =>
          run((current) => ({
            op: "replacePageText",
            page: current,
            find: findText().trim(),
            replace: replaceText(),
          }))
        }
      >
        替换
      </button>
      {/* 批注、图片、位置尺寸都带数值或要选文件 —— 收进检查器抽屉，这一行只留文字命令。 */}
      <InspectorToggle
        open={inspector()}
        onToggle={() => setInspector(!inspector())}
        title="打开检查器：批注 / 图片 / 图片位置"
      />
      {busy() ? <span class="text-11-regular text-foreground-subtlest">处理中…</span> : null}
    </RibbonRow>
  )

  const formTab = () => (
    <RibbonRow>
      <For each={fields()}>
        {(field) => (
          <Show
            when={field.kind === "checkbox"}
            fallback={
              <label class="flex items-center gap-1 text-11-regular text-foreground-subtlest" title={field.name}>
                <span class="max-w-32 truncate">{field.name}</span>
                <input
                  type="text"
                  data-action={`pdf-form-${field.name}`}
                  class="h-6 w-32 rounded border border-border bg-background px-1.5 text-11-regular text-foreground outline-none focus:border-border-hover"
                  value={String(formValues()[field.name] ?? "")}
                  onInput={(event) => setFormValues({ ...formValues(), [field.name]: event.currentTarget.value })}
                />
              </label>
            }
          >
            <label class="flex items-center gap-1 text-11-regular text-foreground-subtlest">
              <input
                type="checkbox"
                data-action={`pdf-form-${field.name}`}
                checked={formValues()[field.name] === true}
                onChange={(event) => setFormValues({ ...formValues(), [field.name]: event.currentTarget.checked })}
              />
              <span class="max-w-32 truncate">{field.name}</span>
            </label>
          </Show>
        )}
      </For>
      <button
        type="button"
        data-action="pdf-form-fill"
        disabled={busy()}
        class="rounded px-1.5 py-0.5 text-11-regular text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground disabled:opacity-40"
        title="把上面填的值写进表单字段"
        onClick={() => {
          const entries = Object.entries(formValues())
          if (entries.length === 0) return
          run(() => ({ op: "fillForm", fields: entries.map(([name, value]) => ({ name, value })) }))
        }}
      >
        写入表单
      </button>
      {busy() ? <span class="text-11-regular text-foreground-subtlest">处理中…</span> : null}
    </RibbonRow>
  )

  /**
   * 检查器抽屉：带数值、或要点开文件选择器的 PDF 命令。
   *
   * 和工具条读同一批信号，所以显示的就是当前页的真实值；写回也走同一条 run 通道。
   * 它是浮在文档右缘的抽屉，不占 PDF 的显示宽度，关掉也不清空已填的值。
   */
  const inspectorPanel = () => (
    <PaneInspector title="PDF 检查器" hint={`第 ${page()} 页`} onClose={() => setInspector(false)}>
      <InspectorSection label="裁边">
        <InspectorField label="四边" title="四边各裁掉多少 pt，常用来去掉扫描件的白边">
          <input
            type="number"
            min={0}
            step={1}
            data-action="pdf-crop-input"
            class={INSPECTOR_INPUT}
            value={crop()}
            onInput={(event) => setCrop(event.currentTarget.value)}
          />
          <span class="shrink-0 text-11-regular text-foreground-subtlest">pt</span>
        </InspectorField>
        <InspectorAction
          disabled={busy() || !(Number(crop()) > 0)}
          actionId="pdf-crop-page"
          title="裁掉当前页的四边"
          onClick={() =>
            run((current) => {
              const value = Math.max(0, Number(crop()) || 0)
              return { op: "cropPage", page: current, top: value, right: value, bottom: value, left: value }
            })
          }
        >
          裁边
        </InspectorAction>
      </InspectorSection>

      {/* 提取 / 拆分 / 合并只读原 PDF，产出新文件，一个字节都不改原稿。 */}
      <InspectorSection label="提取与拆分">
        <InspectorField label="页码" title="从 1 开始，逗号分隔，可写区间">
          <input
            type="text"
            data-action="pdf-extract-range"
            placeholder="1-3,5"
            class={INSPECTOR_INPUT}
            value={extractRange()}
            onInput={(event) => setExtractRange(event.currentTarget.value)}
          />
        </InspectorField>
        <InspectorAction
          disabled={busy()}
          actionId="pdf-extract-pages"
          title="把指定页提取成一个新的 PDF"
          onClick={extractSelection}
        >
          提取成新文件
        </InspectorAction>
        <InspectorField label="每份页数">
          <input
            type="number"
            min={1}
            data-action="pdf-split-every"
            class={INSPECTOR_INPUT}
            value={splitEvery()}
            onInput={(event) => setSplitEvery(event.currentTarget.value)}
          />
        </InspectorField>
        <InspectorAction
          disabled={busy()}
          actionId="pdf-split-pages"
          title="按每份页数拆成多个 PDF，再选保存文件夹"
          onClick={splitDocument}
        >
          拆分成多份…
        </InspectorAction>
      </InspectorSection>

      <InspectorSection label="合并">
        <InspectorAction
          disabled={busy()}
          actionId="pdf-merge-documents"
          title="当前 PDF 在前，所选 PDF 依次接在后面，另存为新文件"
          onClick={() => mergeInput?.click()}
        >
          选择 PDF 合并…
        </InspectorAction>
        <input
          ref={(el) => {
            mergeInput = el
          }}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          class="hidden"
          data-action="pdf-merge-documents-input"
          onChange={(event) => {
            const files = event.currentTarget.files ? Array.from(event.currentTarget.files) : undefined
            event.currentTarget.value = ""
            mergeDocuments(files)
          }}
        />
      </InspectorSection>

      <InspectorSection label="批注">
        <InspectorField label="内容" title="写进这条批注的文字">
          <input
            type="text"
            data-action="pdf-note-text"
            placeholder="批注内容"
            class={INSPECTOR_INPUT}
            value={noteText()}
            onInput={(event) => setNoteText(event.currentTarget.value)}
          />
        </InspectorField>
        <InspectorField label="类型">
          <select
            data-action="pdf-annotate-kind"
            class={INSPECTOR_INPUT}
            value={annotateKind()}
            onChange={(event) =>
              setAnnotateKind(event.currentTarget.value as Extract<PdfPageOp, { op: "annotatePage" }>["kind"])
            }
          >
            <option value="text">文本框</option>
            <option value="square">矩形</option>
            <option value="circle">圆形</option>
            <option value="line">线条</option>
            <option value="highlight">高亮</option>
            <option value="underline">下划线</option>
            <option value="squiggly">波浪线</option>
            <option value="strikeOut">删除线</option>
          </select>
        </InspectorField>
        <InspectorField label="批注 id" title="给这条批注起个名字，方便别人用 id 回复">
          <input
            type="text"
            data-action="pdf-annotate-id"
            placeholder="留空自动编号"
            class={INSPECTOR_INPUT}
            value={annotateId()}
            onInput={(event) => setAnnotateId(event.currentTarget.value)}
          />
        </InspectorField>
        <InspectorField label="回复 id" title="填另一条批注的 id，这条就变成它的回复">
          <input
            type="text"
            data-action="pdf-annotate-reply"
            placeholder="被回复的批注"
            class={INSPECTOR_INPUT}
            value={replyTo()}
            onInput={(event) => setReplyTo(event.currentTarget.value)}
          />
        </InspectorField>
        <InspectorAction
          disabled={busy() || noteText().trim() === ""}
          actionId="pdf-annotate-note"
          title="在当前页加一条带文字的便签批注"
          onClick={() =>
            run((current) => ({
              op: "annotatePage",
              page: current,
              kind: "note",
              x: 40,
              y: 140,
              width: 160,
              height: 60,
              contents: noteText().trim(),
            }))
          }
        >
          加便签批注
        </InspectorAction>
        <InspectorAction
          disabled={busy()}
          actionId="pdf-annotate-add"
          title="按上面的类型 / 内容 / id 在当前页加一条批注"
          onClick={() => {
            const markup = annotateKind() === "highlight" || annotateKind() === "underline"
            const kind = annotateKind()
            run((current) => ({
              op: "annotatePage",
              page: current,
              kind,
              x: 40,
              y: markup ? 90 : 140,
              width: markup ? 200 : 220,
              height: markup ? 18 : kind === "text" ? 60 : 40,
              ...(noteText().trim() ? { contents: noteText().trim() } : {}),
              ...(annotateId().trim() ? { id: annotateId().trim() } : {}),
              ...(replyTo().trim() ? { replyTo: replyTo().trim() } : {}),
              ...(kind === "text" ? { fontSize: 12 } : {}),
            }))
          }}
        >
          添加批注
        </InspectorAction>
        <InspectorAction
          disabled={busy()}
          actionId="pdf-annotate-highlight"
          title="在当前页左上角加一个可拖动的高亮批注（40,90 起，200×18pt）"
          onClick={() =>
            run((current) => ({
              op: "annotatePage",
              page: current,
              kind: "highlight",
              x: 40,
              y: 90,
              width: 200,
              height: 18,
              color: "FFE066",
            }))
          }
        >
          加高亮批注
        </InspectorAction>
      </InspectorSection>

      <InspectorSection label="图片">
        <InspectorAction
          disabled={busy()}
          actionId="pdf-add-image"
          title="在当前页叠一张图（40,120 起，200×120pt），插入后再用下面的位置微调"
          onClick={() => imageInput?.click()}
        >
          插入图片…
        </InspectorAction>
        <InspectorAction
          disabled={busy()}
          actionId="pdf-replace-image"
          title="把当前页的第一张图换成新图（位置、缩放不变）"
          onClick={() => replaceInput?.click()}
        >
          替换图片…
        </InspectorAction>
        <input
          ref={(el) => {
            replaceInput = el
          }}
          type="file"
          accept="image/png,image/jpeg"
          class="hidden"
          data-action="pdf-replace-image-input"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ""
            void replaceImage(file)
          }}
        />
        <input
          ref={(el) => {
            imageInput = el
          }}
          type="file"
          accept="image/png,image/jpeg"
          class="hidden"
          data-action="pdf-add-image-input"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ""
            void addImage(file)
          }}
        />
      </InspectorSection>

      {/* 已有图片：数字框直接对应 setPageImageBox 的参数，改完一次写回。 */}
      <Show when={images().length > 0}>
        <InspectorSection label="图片位置">
          <InspectorField label="第几张" title="这一页上的第几张图片">
            <select
              data-action="pdf-image-index"
              class={INSPECTOR_INPUT}
              value={String(imageIndex())}
              onChange={(event) => setImageIndex(Number(event.currentTarget.value))}
            >
              <For each={images()}>{(image) => <option value={image.index}>{image.index}</option>}</For>
            </select>
          </InspectorField>
          <InspectorField label="x" title="左下角 x 坐标（pt）">
            <input
              type="number"
              data-action="pdf-image-x"
              class={INSPECTOR_INPUT}
              value={Math.round(imageBox().x * 10) / 10}
              onInput={(event) => setBoxField("x", Number(event.currentTarget.value))}
            />
          </InspectorField>
          <InspectorField label="y" title="左下角 y 坐标（pt）">
            <input
              type="number"
              data-action="pdf-image-y"
              class={INSPECTOR_INPUT}
              value={Math.round(imageBox().y * 10) / 10}
              onInput={(event) => setBoxField("y", Number(event.currentTarget.value))}
            />
          </InspectorField>
          <InspectorField label="宽">
            <input
              type="number"
              min={1}
              data-action="pdf-image-width"
              class={INSPECTOR_INPUT}
              value={Math.round(imageBox().width * 10) / 10}
              onInput={(event) => setBoxField("width", Number(event.currentTarget.value))}
            />
          </InspectorField>
          <InspectorField label="高">
            <input
              type="number"
              min={1}
              data-action="pdf-image-height"
              class={INSPECTOR_INPUT}
              value={Math.round(imageBox().height * 10) / 10}
              onInput={(event) => setBoxField("height", Number(event.currentTarget.value))}
            />
          </InspectorField>
          <InspectorField label="旋转" title="顺时针旋转；转 90°/270° 时宽高互换">
            <select
              data-action="pdf-image-rotation"
              class={INSPECTOR_INPUT}
              value={String(imageBox().rotation)}
              onChange={(event) => rotateImage(Number(event.currentTarget.value))}
            >
              <option value="0">0°</option>
              <option value="90">90°</option>
              <option value="180">180°</option>
              <option value="270">270°</option>
            </select>
          </InspectorField>
          <InspectorField label="微调" title="每次移动 10pt">
            <For
              each={
                [
                  { action: "left", label: "←", dx: -10, dy: 0, title: "左移 10pt" },
                  { action: "right", label: "→", dx: 10, dy: 0, title: "右移 10pt" },
                  { action: "up", label: "↑", dx: 0, dy: -10, title: "上移 10pt" },
                  { action: "down", label: "↓", dx: 0, dy: 10, title: "下移 10pt" },
                ] as const
              }
            >
              {(item) => (
                <button
                  type="button"
                  data-action={`pdf-image-${item.action}`}
                  disabled={busy()}
                  title={item.title}
                  class={RIBBON_BUTTON}
                  onClick={() => nudgeImage(item.dx, item.dy)}
                >
                  {item.label}
                </button>
              )}
            </For>
          </InspectorField>
          <InspectorAction
            disabled={busy() || imageBox().width <= 0 || imageBox().height <= 0}
            actionId="pdf-image-apply"
            title="把上面的位置 / 尺寸 / 角度写回 PDF"
            onClick={applyImageBox}
          >
            应用图片位置
          </InspectorAction>
        </InspectorSection>
      </Show>
    </PaneInspector>
  )

  useOfficeRibbonTabs(() =>
    props.onPageOp
      ? [
          { id: "page", label: "页面", render: pageTab },
          { id: "edit", label: "编辑", render: editTab },
          // 没有表单字段时不多画一个空标签。
          ...(fields().length > 0 ? [{ id: "form", label: "表单", render: formTab }] : []),
        ]
      : [],
  )

  return (
    <div class="relative flex h-full flex-col">
      <div class="relative min-h-0 w-full flex-1 bg-background">
        <Show when={url()}>
          {(resolved) => (
            <iframe
              src={pdfZoom() === 100 ? resolved() : `${resolved()}#zoom=${pdfZoom() / 100}`}
              title={props.path}
              class="absolute inset-0 h-full w-full border-0 bg-background"
              onLoad={() => commitUrl(resolved())}
            />
          )}
        </Show>
        <Show when={!url()}>
          <div class="absolute inset-0 flex items-center justify-center text-12-regular text-foreground-subtle">
            正在加载 PDF…
          </div>
        </Show>
        <Show when={nextUrl()}>
          {(pending) => (
            <iframe
              src={pdfZoom() === 100 ? pending() : `${pending()}#zoom=${pdfZoom() / 100}`}
              title={props.path}
              class="absolute inset-0 h-full w-full border-0 bg-background"
              style={{ opacity: 0, "pointer-events": "none" }}
              onLoad={() => commitUrl(pending())}
            />
          )}
        </Show>
      </div>
      {/* 阅读态没有功能区标签，也就没有入口 —— 抽屉只在能改页面时画。 */}
      <Show when={props.onPageOp && inspector()}>{inspectorPanel()}</Show>
      <PaneStatusBar
        info={<span class="truncate">第 {page()} 页</span>}
        zoom={{
          value: () => pdfZoom(),
          onStep: (zoomIn) => setPdfZoom((x) => Math.max(25, Math.min(400, x + (zoomIn ? 10 : -10)))),
          onReset: () => setPdfZoom(100),
          fitLabel: "适应",
          onFit: () => setPdfZoom(100),
          fitted: () => pdfZoom() === 100,
        }}
      />
    </div>
  )
}
