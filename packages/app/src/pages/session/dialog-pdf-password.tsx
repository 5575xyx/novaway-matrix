/**
 * 加密 PDF 的密码输入框。
 *
 * 面板里第一次对加密 PDF 执行编辑时弹出；密码只保存在这个标签页的
 * 内存里（按文件路径），不写盘、不进日志。密码对了就关窗并重试刚才的操作；
 * 错了留在原地提示，用户可以再试或取消。
 */
import { createSignal, Show } from "solid-js"
import { Button } from "@novaway/ui/button"
import { Dialog } from "@novaway/ui/dialog"
import { useDialog } from "@novaway/ui/context/dialog"

export function PdfPasswordDialog(props: {
  file: string
  hint?: string
  /** 返回 undefined 表示密码可用；返回字符串表示要显示的错误（密码不对等）。 */
  onSubmit: (password: string) => Promise<string | undefined>
  onCancel: () => void
}) {
  const dialog = useDialog()
  const [value, setValue] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | undefined>(props.hint)

  const cancel = () => {
    props.onCancel()
    dialog.close()
  }

  const commit = async () => {
    const password = value()
    if (password === "" || busy()) return
    setBusy(true)
    setError(undefined)
    try {
      const failure = await props.onSubmit(password)
      if (failure) {
        setError(failure)
        return
      }
      dialog.close()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  const submit = (event: SubmitEvent) => {
    event.preventDefault()
    void commit()
  }

  return (
    <Dialog
      title="打开加密 PDF"
      description={props.file.split(/[\\/]/).pop()}
      footer={
        <>
          <Button variant="ghost" size="large" onClick={cancel}>
            取消
          </Button>
          <Button variant="primary" size="large" disabled={busy() || value() === ""} onClick={() => void commit()}>
            {busy() ? "验证中…" : "解锁并继续"}
          </Button>
        </>
      }
    >
      <form class="flex flex-col gap-3 p-5" onSubmit={submit}>
        <label class="text-14-medium text-foreground">密码</label>
        <input
          class="flex h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-14-regular text-foreground placeholder:text-foreground-subtle outline-none focus:border-interactive-focus"
          type="password"
          autofocus
          value={value()}
          placeholder="用户密码或所有者密码"
          onInput={(event) => {
            setValue(event.currentTarget.value)
            if (error()) setError(undefined)
          }}
        />
        <Show when={error()}>{(message) => <div class="text-12-regular text-critical-base">{message()}</div>}</Show>
        <div class="text-12-regular text-foreground-subtle">
          密码只保存在当前标签页里，不会写入文件；编辑并保存后，这份 PDF 会变成不加密的版本。
        </div>
      </form>
    </Dialog>
  )
}
