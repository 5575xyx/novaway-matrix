import JSZip from "jszip"
import { createMemo, For, onCleanup, Show, type Component } from "solid-js"
import { Spinner } from "@novaway/ui/spinner"
import { createResource } from "solid-js"

export const OFFICE_EXTENSIONS = [".docx", ".pptx", ".xlsx", ".pdf"] as const

export function isOfficePreviewPath(path: string | undefined) {
  if (!path) return false
  const lower = path.toLowerCase()
  return OFFICE_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

type Slide = { index: number; title: string; lines: string[] }
type Sheet = { name: string; rows: string[][] }

type OfficePreview =
  | { kind: "pptx"; slides: Slide[] }
  | { kind: "docx"; title: string; paragraphs: string[] }
  | { kind: "xlsx"; sheets: Sheet[] }
  | { kind: "pdf" }

const decodeXml = (value: string) =>
  value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")

const textOf = (xml: string, tag: string) =>
  Array.from(xml.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "g")))
    .map((match) => decodeXml(match[1]!.replace(/<[^>]+>/g, "")))
    .filter(Boolean)

const naturalCompare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })

async function parseOffice(path: string, base64: string): Promise<OfficePreview> {
  const lower = path.toLowerCase()
  // PDF 交给 Chromium 自带的阅读器：用 Blob URL 直接 embed，缩略图/翻页/缩放都由它提供，
  // 比手写解析器可靠得多。
  if (lower.endsWith(".pdf")) return { kind: "pdf" }

  const zip = await JSZip.loadAsync(base64, { base64: true })

  if (lower.endsWith(".pptx")) {
    const names = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort(naturalCompare)
    const slides = await Promise.all(
      names.map(async (name, index) => {
        const xml = (await zip.file(name)?.async("string")) ?? ""
        const lines = textOf(xml, "a:t")
        return { index: index + 1, title: lines[0] ?? `第 ${index + 1} 页`, lines: lines.slice(1) }
      }),
    )
    return { kind: "pptx", slides }
  }

  if (lower.endsWith(".docx")) {
    const xml = (await zip.file("word/document.xml")?.async("string")) ?? ""
    const paragraphs = Array.from(xml.matchAll(/<w:p[\s>][\s\S]*?<\/w:p>/g))
      .map((match) => textOf(match[0], "w:t").join("").trim())
      .filter(Boolean)
    return { kind: "docx", title: paragraphs[0] ?? path, paragraphs }
  }

  // xlsx：共享字符串 + 每张工作表的单元格文本。样式/公式不求值，只展示静态内容。
  const sharedXml = (await zip.file("xl/sharedStrings.xml")?.async("string")) ?? ""
  const shared = Array.from(sharedXml.matchAll(/<si[\s>][\s\S]*?<\/si>/g)).map((match) =>
    textOf(match[0], "t").join(""),
  )
  const sheetNames = Object.keys(zip.files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort(naturalCompare)
  const sheets = await Promise.all(
    sheetNames.map(async (name, index) => {
      const xml = (await zip.file(name)?.async("string")) ?? ""
      const rows = Array.from(xml.matchAll(/<row[\s>][\s\S]*?<\/row>/g)).map((row) =>
        Array.from(row[0].matchAll(/<c[\s>][\s\S]*?<\/c>/g)).map((cell) => {
          const value = textOf(cell[0], "v")[0] ?? textOf(cell[0], "t")[0] ?? ""
          return cell[0].includes('t="s"') ? (shared[Number(value)] ?? "") : value
        }),
      )
      return { name: `Sheet ${index + 1}`, rows: rows.filter((row) => row.some(Boolean)) }
    }),
  )
  return { kind: "xlsx", sheets }
}

/**
 * 办公文件只读预览（DOCX / PPTX / XLSX）。
 *
 * 对齐 ZCode 右栏可以直接看办公文档：这里用 JSZip 在前端解析 OOXML，
 * 抽出段落、幻灯片文本与表格单元格。不做版式还原，只保证"能读、能核对内容"；
 * 需要编辑请让 AI 用办公技能处理。
 */
export const OfficeFilePreview: Component<{ path: string; base64: string }> = (props) => {
  const isPdf = () => props.path.toLowerCase().endsWith(".pdf")
  const pdfUrl = createMemo(() => {
    if (!isPdf() || !props.base64) return
    const binary = atob(props.base64)
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }))
  })
  const [data] = createResource(
    () => `${props.path}\u0000${props.base64.length}`,
    () => parseOffice(props.path, props.base64),
  )

  // 三个分支的数据各取一份具类型的 memo。
  // 之前直接在 JSX 里写 `preview().kind === "pptx" ? preview().slides : []`，
  // 编译器无法把第二次调用的返回值收窄到 pptx 分支，于是报 slides 不存在。
  const slides = createMemo(() => {
    const value = data()
    return value?.kind === "pptx" ? value.slides : []
  })
  const paragraphs = createMemo(() => {
    const value = data()
    return value?.kind === "docx" ? value.paragraphs : []
  })
  const sheets = createMemo(() => {
    const value = data()
    return value?.kind === "xlsx" ? value.sheets : []
  })
  const slideCount = createMemo(() => slides().length)

  onCleanup(() => {
    const url = pdfUrl()
    if (url) URL.revokeObjectURL(url)
  })

  return (
    <>
      <Show when={!isPdf()}>
        <div class="h-full overflow-y-auto px-6 py-4">
          <Show when={!data.loading} fallback={<Spinner class="size-4 text-foreground-subtle" />}>
            <Show
              when={!data.error}
              fallback={<p class="text-12-regular text-foreground-subtle">无法解析该办公文件。</p>}
            >
              <Show when={data()}>
                {(preview) => (
                  <>
                    <Show when={preview().kind === "pptx"}>
                      <div class="mb-3 text-12-regular text-foreground-subtle">共 {slideCount()} 页 · 只读预览</div>
                      <div class="grid grid-cols-1 gap-3 xl:grid-cols-2">
                        <For each={slides()}>
                          {(slide) => (
                            <div class="flex flex-col overflow-hidden rounded-xl border border-border bg-panel">
                              <div class="flex min-h-0 flex-1 flex-col gap-2 bg-surface/40 px-5 py-4">
                                <div class="flex items-center gap-2">
                                  <span class="grid size-5 shrink-0 place-items-center rounded bg-surface text-11-medium text-foreground-subtle">
                                    {slide.index}
                                  </span>
                                  <span class="truncate text-14-medium text-foreground">{slide.title}</span>
                                </div>
                                <ul class="flex flex-col gap-1.5 pl-1">
                                  <For each={slide.lines.slice(0, 8)}>
                                    {(line) => (
                                      <li class="flex gap-2 text-12-regular leading-5 text-foreground-subtle">
                                        <span class="mt-2 size-1 shrink-0 rounded-full bg-foreground-subtlest" />
                                        <span class="min-w-0">{line}</span>
                                      </li>
                                    )}
                                  </For>
                                </ul>
                              </div>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>

                    <Show when={preview().kind === "docx"}>
                      {/* 白纸卡片：对齐办公软件里的页面观感（浅色下是白页、深色下是面板色）。 */}
                      <div class="mx-auto w-full max-w-3xl rounded-xl border border-border bg-panel px-10 py-8 shadow-sm">
                        <For each={paragraphs()}>
                          {(paragraph, index) => (
                            <p
                              class="text-foreground"
                              classList={{
                                "mb-4 text-18-semibold": index() === 0,
                                "mb-3 text-[14px] leading-7": index() !== 0,
                              }}
                            >
                              {paragraph}
                            </p>
                          )}
                        </For>
                      </div>
                    </Show>

                    <Show when={preview().kind === "xlsx"}>
                      <div class="flex flex-col gap-4">
                        <For each={sheets()}>
                          {(sheet) => (
                            <div class="flex flex-col gap-2">
                              <span class="text-13-medium text-foreground">{sheet.name}</span>
                              <div class="max-h-[520px] overflow-auto rounded-lg border border-border">
                                <table class="w-full border-collapse text-12-regular">
                                  <tbody>
                                    <For each={sheet.rows.slice(0, 200)}>
                                      {(row, rowIndex) => (
                                        <tr
                                          class="border-t border-border first:border-t-0"
                                          classList={{ "bg-surface/60": rowIndex() === 0 }}
                                        >
                                          <For each={row}>
                                            {(cell) => (
                                              <td
                                                class="max-w-[320px] truncate border-r border-border px-2.5 py-1.5 text-foreground last:border-r-0"
                                                classList={{ "font-medium": rowIndex() === 0 }}
                                              >
                                                {cell}
                                              </td>
                                            )}
                                          </For>
                                        </tr>
                                      )}
                                    </For>
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  </>
                )}
              </Show>
            </Show>
          </Show>
        </div>
      </Show>
      <Show when={isPdf()}>
        <Show
          when={pdfUrl()}
          fallback={
            <div class="flex h-full items-center justify-center text-12-regular text-foreground-subtle">
              正在加载 PDF…
            </div>
          }
        >
          {(url) => <iframe src={url()} title={props.path} class="h-full w-full border-0 bg-background" />}
        </Show>
      </Show>
    </>
  )
}
