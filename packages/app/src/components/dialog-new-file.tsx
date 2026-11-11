import { createMemo, createSignal, For, Show } from "solid-js"
import { Button } from "@novaway/ui/button"
import { Dialog } from "@novaway/ui/dialog"
import { showToast } from "@novaway/ui/toast"
import { useDialog } from "@novaway/ui/context/dialog"
import { useSDK } from "@/context/sdk"
import { useFile } from "@/context/file"
import { formatGroups, NEW_FILE_FORMATS, withExtension, type NewFileFormat } from "./new-file-model"

/**
 * 新建文件（「+ 新建」浮层）。
 *
 * 按「Office 文档 / 文本与网页 / 代码与数据」分组。文本类走 `file.write`
 * 直接落字符串；docx / xlsx / pptx 走 `office.document.create`，由服务端
 * 写入器生成真正的 OOXML 包（不能拿空文本冒充二进制文件）。
 *
 * 创建完由调用方打开成右侧标签，用户看到的就是一个可以直接编辑的视图。
 */

export function DialogNewFile(props: { onCreate: (path: string) => void }) {
  const dialog = useDialog()
  const sdk = useSDK()
  const file = useFile()

  const [format, setFormat] = createSignal<NewFileFormat>(
    NEW_FILE_FORMATS.find((item) => item.id === "markdown") ?? NEW_FILE_FORMATS[0]!,
  )
  const [name, setName] = createSignal("")
  const [creating, setCreating] = createSignal(false)
  const [error, setError] = createSignal("")

  const groups = createMemo(() => formatGroups())

  const finalPath = createMemo(() => {
    const value = name().trim()
    if (value.length === 0) return ""
    return withExtension(value, format().extension)
  })

  const submit = async () => {
    if (creating()) return
    const target = finalPath()
    if (!target) {
      setError("先给文件起个名字")
      return
    }
    setError("")
    setCreating(true)
    try {
      // 已存在就不覆盖：写文件是不可逆的，宁可让用户换个名字。
      const exists = await sdk.client.file
        .read({ path: target })
        .then(() => true)
        .catch(() => false)
      if (exists) {
        setError("同名文件已经存在，换一个名字")
        return
      }
      if (format().binary) {
        const title = (target.split(/[\\/]/).pop() ?? target).replace(/\.[^.]+$/, "")
        await sdk.client.office.document.create({ directory: sdk.directory, path: target, title })
      } else {
        await file.write(target, format().template)
      }
      dialog.close()
      props.onCreate(file.normalize(target))
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message)
      showToast({ variant: "error", title: "新建失败", description: message })
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog title="新建文件">
      <div class="flex flex-col gap-4 p-5">
        <div class="flex flex-col gap-2">
          <label class="text-14-medium text-foreground">文件类型</label>
          <For each={groups()}>
            {(group) => (
              <div class="flex flex-col gap-1">
                <span class="text-11-regular text-foreground-subtlest">{group.label}</span>
                <div class="flex flex-wrap gap-1.5">
                  <For each={group.items}>
                    {(item) => (
                      <button
                        type="button"
                        data-action={`new-file-format-${item.id}`}
                        title={item.hint || item.label}
                        class={[
                          "rounded-md border px-2 py-1 text-12-regular transition-colors",
                          format().id === item.id
                            ? "border-primary bg-surface text-foreground"
                            : "border-border text-foreground-subtle hover:bg-hover hover:text-foreground",
                        ].join(" ")}
                        onClick={() => setFormat(item)}
                      >
                        {item.label}
                      </button>
                    )}
                  </For>
                </div>
              </div>
            )}
          </For>
          <span class="text-11-regular text-foreground-subtlest">
            会补上 .{format().extension} 后缀；可以输入子目录，例如 notes/today
          </span>
        </div>

        <div class="flex flex-col gap-2">
          <label class="text-14-medium text-foreground">文件路径</label>
          <input
            class="flex h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-14-regular text-foreground placeholder:text-foreground-subtle outline-none focus:border-primary"
            type="text"
            data-action="new-file-name"
            value={name()}
            placeholder={`例如 notes/today.${format().extension}`}
            autofocus
            onInput={(event) => {
              setName(event.currentTarget.value)
              if (error()) setError("")
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit()
            }}
          />
          <Show when={finalPath() && finalPath() !== name().trim()}>
            <span class="text-11-regular text-foreground-subtlest">将创建：{finalPath()}</span>
          </Show>
          <Show when={error()}>
            <span class="text-12-regular text-icon-critical-base">{error()}</span>
          </Show>
        </div>

        <div class="flex items-center justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={() => dialog.close()}>
            取消
          </Button>
          <Button variant="primary" disabled={creating() || finalPath().length === 0} onClick={() => void submit()}>
            {creating() ? "创建中…" : "创建并打开"}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
