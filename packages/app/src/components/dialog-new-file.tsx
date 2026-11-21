import { createMemo, createSignal, For, Show } from "solid-js"
import { Button } from "@novaway/ui/button"
import { Dialog } from "@novaway/ui/dialog"
import { showToast } from "@novaway/ui/toast"
import { useDialog } from "@novaway/ui/context/dialog"
import { Icon } from "@novaway/ui/icon"
import fileIconSprite from "../../../../packages/ui/src/components/file-icons/sprite.svg?url"
import { usePlatform } from "@/context/platform"
import { useSDK } from "@/context/sdk"
import { useFile } from "@/context/file"
import { NEW_FILE_FORMATS, withExtension, type NewFileFormat } from "./new-file-model"

/**
 * 新建文件（「+ 新建」浮层）。
 *
 * 按「Office 文档 / 文本与网页 / 代码与数据」分组。文本类走 `file.write`
 * 直接落字符串；docx / xlsx / pptx 走 `office.document.create`，由服务端
 * 写入器生成真正的 OOXML 包（不能拿空文本冒充二进制文件）。
 *
 * 创建完由调用方打开成右侧标签，用户看到的就是一个可以直接编辑的视图。
 */

export function DialogNewFile(props: { onCreate: (path: string) => void; onOpenExternal: (paths: string[]) => void }) {
  const dialog = useDialog()
  const sdk = useSDK()
  const file = useFile()
  const platform = usePlatform()

  const formats = createMemo(() => NEW_FILE_FORMATS)
  const workspaceDirectory = sdk.directory.replace(/\\/g, "/").replace(/\/$/, "")
  const [format, setFormat] = createSignal<NewFileFormat>(
    NEW_FILE_FORMATS.find((item) => item.id === "markdown") ?? NEW_FILE_FORMATS[0]!,
  )
  const [directory, setDirectory] = createSignal(sdk.directory)
  const [name, setName] = createSignal("")
  const [extension, setExtension] = createSignal(format().extension)
  const [browsing, setBrowsing] = createSignal(false)
  const [creating, setCreating] = createSignal(false)
  const [error, setError] = createSignal("")
  const externalDirectory = createMemo(() => {
    const selected = directory().trim().replace(/\\/g, "/").replace(/\/$/, "")
    return (
      (/^[A-Za-z]:\//.test(selected) || selected.startsWith("/")) &&
      selected !== workspaceDirectory &&
      !selected.startsWith(`${workspaceDirectory}/`)
    )
  })
  const finalPath = createMemo(() => {
    const value = name().trim()
    const suffix = extension().trim().replace(/^\./, "")
    if (value.length === 0 || /[\\/]/.test(value) || !suffix || /[\\/.]/.test(suffix)) return ""
    const selected = directory().trim().replace(/\\/g, "/").replace(/\/$/, "")
    const filename = withExtension(value, suffix)
    if (/^[A-Za-z]:\//.test(selected) || selected.startsWith("/")) {
      if (selected === workspaceDirectory) return filename
      if (selected.startsWith(`${workspaceDirectory}/`))
        return `${selected.slice(workspaceDirectory.length + 1)}/${filename}`
      return `${selected}/${filename}`
    }
    const relative = selected.replace(/^\.\//, "")
    return relative ? `${relative}/${filename}` : filename
  })

  const chooseDirectory = async () => {
    if (!platform.openDirectoryPickerDialog || browsing()) return
    setBrowsing(true)
    try {
      const picked = await platform.openDirectoryPickerDialog({ title: "选择新文件保存位置", multiple: false })
      const selected = Array.isArray(picked) ? picked[0] : picked
      if (!selected) return
      setDirectory(selected)
      setError("")
    } finally {
      setBrowsing(false)
    }
  }

  const submit = async () => {
    if (creating()) return
    const target = finalPath()
    if (!target) {
      setError(
        !name().trim()
          ? "先给文件起个名字"
          : /[\\/]/.test(name().trim())
            ? "文件名不能包含路径分隔符"
            : "请输入有效的保存位置",
      )
      return
    }
    setError("")
    setCreating(true)
    try {
      const external = externalDirectory()
      if (external && !platform.writeLocalFileText) throw new Error("工作区外保存需要桌面版")
      const isNativeBinary = format().binary && extension().trim().replace(/^\./, "") === format().extension
      if (external && isNativeBinary) throw new Error("Office 和 PDF 文件目前只能创建在工作区内")
      if (isNativeBinary) {
        const title = (target.split(/[\\/]/).pop() ?? target).replace(/\.[^.]+$/, "")
        await sdk.client.office.document.create({ directory: sdk.directory, path: target, title })
      } else if (external) {
        const ok = await platform.writeLocalFileText!(target, format().template)
        if (!ok) throw new Error("无法写入所选位置")
      } else {
        await file.write(target, format().template)
      }
      dialog.close()
      props.onCreate(external ? target : file.normalize(target))
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message)
      showToast({ variant: "error", title: "新建失败", description: message })
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog title="文件">
      <div class="flex max-h-[75vh] flex-col gap-4 overflow-y-auto p-5">
        <div class="flex flex-col gap-2">
          <label class="text-14-medium text-foreground">新建文件类型</label>
          <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <For each={formats()}>
              {(item) => {
                const iconName =
                  {
                    docx: "Word",
                    xlsx: "Table",
                    pptx: "Powerpoint",
                    pdf: "Pdf",
                    markdown: "Markdown",
                    text: "Document",
                    richtext: "Document",
                    csv: "Table",
                    json: "Json",
                    python: "Python",
                    go: "Go",
                    rust: "Rust",
                    yaml: "Yaml",
                    toml: "Toml",
                    xml: "Xml",
                    typescript: "Typescript",
                  }[item.id] ?? "Code"
                const iconColor =
                  {
                    docx: "text-[#4285f4]",
                    xlsx: "text-[#0f9d58]",
                    pptx: "text-[#e8710a]",
                    pdf: "text-[#d93025]",
                    markdown: "text-[#7952b3]",
                    text: "text-[#5f6b7a]",
                    richtext: "text-[#0097a7]",
                    csv: "text-[#0f9d58]",
                  }[item.id] ?? "text-[#5f6b7a]"
                return (
                  <button
                    type="button"
                    data-action={`new-file-format-${item.id}`}
                    title={item.hint || item.label}
                    aria-pressed={format().id === item.id}
                    class={[
                      "flex min-h-[76px] items-center gap-3 rounded-md border px-3 text-left transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive-focus",
                      format().id === item.id
                        ? "border-interactive-selected bg-hover text-foreground"
                        : "border-border bg-surface text-foreground-subtle",
                    ].join(" ")}
                    onClick={() => {
                      setFormat(item)
                      setExtension(item.extension)
                    }}
                  >
                    <svg class={`size-10 shrink-0 ${iconColor}`} aria-hidden="true">
                      <use href={`${fileIconSprite}#${iconName}`} />
                    </svg>
                    <span class="min-w-0 truncate text-13-medium text-foreground">
                      {item.id === "docx"
                        ? "文字文档"
                        : item.id === "xlsx"
                          ? "电子表格"
                          : item.id === "pptx"
                            ? "演示文稿"
                            : item.id === "pdf"
                              ? "PDF"
                              : item.label}
                    </span>
                  </button>
                )
              }}
            </For>
          </div>
        </div>

        <button
          type="button"
          data-component="new-file-open-external"
          class="flex min-h-24 items-center gap-4 rounded-xl border border-dashed border-border bg-surface px-5 text-left hover:border-interactive-hover hover:bg-hover"
          onClick={() => {
            if (!platform.openFilePickerDialog) {
              setError("打开外部文件需要桌面版")
              return
            }
            void platform.openFilePickerDialog({ title: "打开外部文件", multiple: true }).then((picked) => {
              const paths = Array.isArray(picked) ? picked : picked ? [picked] : []
              if (!paths.length) return
              dialog.close()
              props.onOpenExternal(paths)
            })
          }}
        >
          <Icon name="folder" size="large" class="text-icon-interactive-base" />
          <span class="flex flex-col gap-1">
            <span class="text-14-medium text-foreground">打开外部文件</span>
            <span class="text-12-regular text-foreground-subtle">从电脑中选择并打开一个或多个文件</span>
          </span>
        </button>

        <div class="flex flex-col gap-3">
          <div class="flex flex-col gap-2">
            <label class="text-14-medium text-foreground">文件名</label>
            <div class="flex h-10 items-center rounded-[8px] border border-border bg-surface px-3 focus-within:border-interactive-focus">
              <input
                class="min-w-0 flex-1 bg-transparent text-14-regular text-foreground placeholder:text-foreground-subtle outline-none"
                type="text"
                data-action="new-file-name"
                value={name()}
                placeholder="输入文件名"
                autofocus
                onInput={(event) => {
                  setName(event.currentTarget.value)
                  if (error()) setError("")
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void submit()
                }}
              />
              <span class="shrink-0 text-12-regular text-foreground-subtlest">.</span>
              <input
                class="w-16 bg-transparent text-12-regular text-foreground-subtlest outline-none"
                aria-label="文件扩展名"
                value={extension()}
                onInput={(event) => setExtension(event.currentTarget.value.replace(/[\\/\\\\]/g, ""))}
              />
            </div>
          </div>
          <div class="flex flex-col gap-2">
            <label class="text-14-medium text-foreground">保存位置</label>
            <div class="flex gap-2">
              <input
                class="h-10 min-w-0 flex-1 rounded-[8px] border border-border bg-surface px-3 text-13-regular text-foreground-subtle outline-none focus:border-interactive-focus"
                value={directory()}
                aria-label="保存位置"
                onInput={(event) => setDirectory(event.currentTarget.value)}
              />
              <Button
                variant="secondary"
                disabled={!platform.openDirectoryPickerDialog || browsing()}
                onClick={() => void chooseDirectory()}
              >
                <Icon name="folder" size="small" />
                选择文件夹
              </Button>
            </div>
          </div>
          <Show when={finalPath()}>
            <span class="text-11-regular text-foreground-subtlest">将创建：{finalPath()}</span>
          </Show>
          <Show
            when={
              externalDirectory() && format().binary && extension().trim().replace(/^\./, "") === format().extension
            }
          >
            <span class="text-11-regular text-critical-base">Office 和 PDF 文件目前只能创建在工作区内</span>
          </Show>
          <Show when={!extension().trim() || /[\\/.]/.test(extension().trim().replace(/^\./, ""))}>
            <span class="text-11-regular text-critical-base">请输入不带点号的文件扩展名</span>
          </Show>
          <Show when={error()}>
            <span class="text-12-regular text-critical-base">{error()}</span>
          </Show>
        </div>

        <div class="flex items-center justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={() => dialog.close()}>
            取消
          </Button>
          <Button
            variant="primary"
            disabled={
              creating() ||
              finalPath().length === 0 ||
              (externalDirectory() &&
                format().binary &&
                extension().trim().replace(/^\./, "") === format().extension) ||
              !extension().trim() ||
              /[\\/.]/.test(extension().trim().replace(/^\./, ""))
            }
            onClick={() => void submit()}
          >
            {creating() ? "创建中…" : "创建并打开"}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
