import { createSignal, For, Show } from "solid-js"
import { Button } from "@novaway/ui/button"
import { Dialog } from "@novaway/ui/dialog"
import { IconButton } from "@novaway/ui/icon-button"
import { useDialog } from "@novaway/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"

/**
 * 自定义分组的管理面板（「视图 → 分组方式 → 自定义分组」旁边那个入口）。
 *
 * 组只有名字，成员靠任务行「⋯」菜单里的「移动到组」逐个归类 —— 不做规则引擎：
 * 规则要解释命中逻辑与冲突优先级，成本远高于"手动点两下"，而且侧栏任务量本来不大。
 * 删除组时组里的会话退回「未分组」，不会连带删掉任务本身。
 */
export function DialogTaskGroups() {
  const dialog = useDialog()
  const language = useLanguage()
  const layout = useLayout()
  const [draft, setDraft] = createSignal("")

  const name = () => draft().trim()
  const create = () => {
    const value = name()
    if (!value) return
    layout.taskList.createGroup(value)
    setDraft("")
  }

  return (
    <Dialog title={language.t("sidebar.task.group.manage")}>
      <div class="flex flex-col gap-4 p-5">
        <div class="flex flex-col gap-1.5">
          <span class="text-ui-xs text-foreground-subtle">{language.t("sidebar.task.group.manageHint")}</span>
          <Show when={layout.taskList.groups().length > 0}>
            <div class="flex flex-col gap-1.5">
              <For each={layout.taskList.groups()}>
                {(group) => (
                  <div class="flex items-center gap-1.5">
                    <input
                      class="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-ui-caption text-foreground outline-none focus:border-border-hover"
                      value={group.name}
                      aria-label={language.t("sidebar.task.group.name")}
                      onInput={(event) => layout.taskList.renameGroup(group.id, event.currentTarget.value)}
                    />
                    <IconButton
                      icon="trash"
                      variant="ghost"
                      size="small"
                      data-action="task-group-delete"
                      aria-label={language.t("common.delete")}
                      title={language.t("common.delete")}
                      onClick={() => layout.taskList.deleteGroup(group.id)}
                    />
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>

        <div class="flex items-center gap-1.5">
          <input
            class="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-ui-caption text-foreground placeholder:text-foreground-subtlest outline-none focus:border-border-hover"
            type="text"
            data-action="task-group-new-name"
            value={draft()}
            placeholder={language.t("sidebar.task.group.name")}
            autofocus
            onInput={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.isComposing) return
              if (event.key === "Enter") create()
            }}
          />
          <Button variant="primary" size="small" disabled={!name()} data-action="task-group-create" onClick={create}>
            {language.t("sidebar.task.group.create")}
          </Button>
        </div>

        <div class="flex items-center justify-end gap-3">
          <Button variant="ghost" onClick={() => dialog.close()}>
            {language.t("common.close")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
