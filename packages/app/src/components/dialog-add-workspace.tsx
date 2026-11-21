import { Dialog } from "@novaway/ui/dialog"
import { Icon } from "@novaway/ui/icon"
import { useDialog } from "@novaway/ui/context/dialog"
import { useLanguage } from "@/context/language"

/**
 * 「新建工作区」：工作区列表旁的 + 号入口。
 *
 * 两条路放在同一个弹窗里 —— 打开电脑上已有的文件夹，或选保存位置新建项目目录；
 * 具体流程复用侧栏原有的打开 / 新建逻辑，这里只负责把选择摆到台面上。
 */
export function DialogAddWorkspace(props: { onOpenFolder: () => void; onCreateProject: () => void }) {
  const dialog = useDialog()
  const language = useLanguage()

  return (
    <Dialog title={language.t("workspace.add.title")}>
      <div class="flex flex-col gap-2 p-5" data-component="dialog-add-workspace">
        <button
          type="button"
          data-action="workspace-add-open-folder"
          class="flex items-start gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-left transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive-focus"
          onClick={() => {
            // 先关掉本弹窗：原生目录选择器会盖在它上面，取消后也不该再留着这层。
            dialog.close()
            props.onOpenFolder()
          }}
        >
          <Icon name="folder" size="large" class="mt-0.5 shrink-0 text-icon-interactive-base" />
          <span class="flex min-w-0 flex-col gap-0.5">
            <span class="text-14-medium text-foreground">{language.t("workspace.add.open.title")}</span>
            <span class="text-12-regular text-foreground-subtle">{language.t("workspace.add.open.description")}</span>
          </span>
        </button>
        <button
          type="button"
          data-action="workspace-add-create-project"
          class="flex items-start gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-left transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive-focus"
          onClick={props.onCreateProject}
        >
          <Icon name="folder-add-left" size="large" class="mt-0.5 shrink-0 text-icon-interactive-base" />
          <span class="flex min-w-0 flex-col gap-0.5">
            <span class="text-14-medium text-foreground">{language.t("workspace.add.create.title")}</span>
            <span class="text-12-regular text-foreground-subtle">{language.t("workspace.add.create.description")}</span>
          </span>
        </button>
      </div>
    </Dialog>
  )
}
