/**
 * 保存前检测到「磁盘已被外部修改」的冲突提示。
 *
 * 用户打开文件后、保存前，磁盘内容被别处（另一个窗口 / 进程 / Agent）改过：
 * 直接写盘会静默覆盖外部改动。这里让用户选：保留我的（覆盖磁盘）、
 * 用磁盘的（丢弃草稿回到磁盘版本）、或先看差异再决定。
 */
import { Button } from "@novaway/ui/button"
import { Dialog } from "@novaway/ui/dialog"
import { useDialog } from "@novaway/ui/context/dialog"

export function ConflictDialog(props: {
  file: string
  disk: string
  draft: string
  onKeepMine: () => void
  onUseDisk: () => void
  onSeeDiff: () => void
}) {
  const dialog = useDialog()

  const keepMine = () => {
    props.onKeepMine()
    dialog.close()
  }
  const useDisk = () => {
    props.onUseDisk()
    dialog.close()
  }
  const seeDiff = () => {
    props.onSeeDiff()
    dialog.close()
  }

  return (
    <Dialog
      title="文件已被外部修改"
      description={props.file.split(/[\\/]/).pop()}
      footer={
        <>
          <Button variant="ghost" size="large" onClick={useDisk}>
            用磁盘的
          </Button>
          <Button variant="ghost" size="large" onClick={seeDiff}>
            看差异
          </Button>
          <Button variant="primary" size="large" onClick={keepMine}>
            保留我的
          </Button>
        </>
      }
    >
      <div class="flex flex-col gap-2 p-5 text-14-regular text-foreground">
        <p>这个文件在别处被改过，直接保存会覆盖掉外部改动。</p>
        <ul class="list-disc pl-5 text-13-regular text-foreground-subtle">
          <li>保留我的：用你编辑的内容写盘，覆盖磁盘上的外部改动。</li>
          <li>用磁盘的：丢掉你这份草稿，重新载入磁盘上的最新内容。</li>
          <li>看差异：并排对照磁盘版本与你编辑的内容，再决定。</li>
        </ul>
      </div>
    </Dialog>
  )
}
