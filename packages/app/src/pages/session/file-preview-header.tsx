/**
 * 文件预览统一外壳。
 *
 * 右栏只有一行头部，永远不换行：左边是文件名与保存状态，右边是
 * 「撤销 · 重做 · 保存 · 查找 · 视图▾ · 阅读·编辑 · ⋯」。动词只有这一处入口 ——
 * 撤销/重做/保存直接摆在手上，视图切换单独成下拉，导出、打印、低频命令
 * 仍然按分组收在「⋯」里。窄面板下文件名先截断，控件永不溢出。
 */
import { For, Show } from "solid-js"
import { DropdownMenu } from "@novaway/ui/dropdown-menu"
import { Icon } from "@novaway/ui/icon"
import { IconButton } from "@novaway/ui/icon-button"
import { getFilename } from "@novaway/core/util/path"
import { useLanguage } from "@/context/language"
import { PREVIEW_ACTIVE_CLASS } from "./office-ribbon"

export type FilePreviewSaveStatus = "saved" | "dirty" | "saving" | "error"

export type PreviewMenuItem = {
  id: string
  label: string
  onSelect: () => void
  checked?: boolean
  disabled?: boolean
  /** 右侧的快捷键 / 补充说明，例如 ⌘F。 */
  hint?: string
}

export type PreviewMenuGroup = {
  label?: string
  items: PreviewMenuItem[]
}

export type FilePreviewHeaderProps = {
  path: string
  saveStatus: FilePreviewSaveStatus
  editing: boolean
  canEdit: boolean
  /** 编辑按钮文案：文档是「编辑」，PDF 这类是「工具」。 */
  editLabel?: string
  onToggleEditing: () => void
  onFind?: () => void
  /** 撤销 / 重做：由宿主路由到当前文件真正在用的那条历史栈。 */
  onUndo?: () => void
  onRedo?: () => void
  canUndo?: boolean
  canRedo?: boolean
  /** 宿主历史里下一步叫什么（「撤销：改成标题」），放在悬停提示里。 */
  undoLabel?: string
  redoLabel?: string
  /** 保存：唯一的写盘按钮，脏了才亮，⌘/Ctrl+S 走同一个函数。 */
  onSave?: () => void
  /** 用本机默认关联应用打开文件。 */
  onOpenNative?: () => void
  openNativeLabel?: string
  openNativeMenu?: PreviewMenuItem[]
  /** 「视图▾」下拉：预览/源码/表格这类互斥切换，不用二次展开「⋯」。 */
  viewMenu?: PreviewMenuItem[]
  /** 「⋯」菜单：空分组会被跳过。 */
  menu: PreviewMenuGroup[]
  /** 文件名旁边的小徽标，例如「改动」「只读」。 */
  badge?: string
  /** 内嵌文件树右栏的开关：宿主提供时才渲染按钮。 */
  treeOpen?: boolean
  onToggleTree?: () => void
}

function iconOf(path: string) {
  const lower = path.toLowerCase()
  if (/\.(png|jpe?g|gif|webp|bmp|ico|avif|svg)$/.test(lower)) return "lu-image"
  if (/\.(xlsx?|xlsm|xltx|xltm|csv)$/.test(lower)) return "lu-table"
  if (/\.(pptx?|pptm|potx|potm|ppsx|ppsm|odp)$/.test(lower)) return "lu-presentation"
  if (/\.(md|markdown|mdx)$/.test(lower)) return "lu-file-text"
  if (/\.(html?|xhtml|shtml)$/.test(lower)) return "lu-globe"
  if (/\.(tsx?|jsx?|mjs|cjs|jsonc?|css|scss|less|py|rs|go|java|c|cpp|h|hpp|sh|ya?ml|toml)$/.test(lower))
    return "code-lines"
  return "lu-file-text"
}

export function FilePreviewHeader(props: FilePreviewHeaderProps) {
  const language = useLanguage()
  const filename = () => getFilename(props.path)
  // 已保存不必提示，只有本地的状态偏离磁盘时才占用这一行。
  const status = () => {
    if (props.saveStatus === "dirty") return language.t("common.unsaved")
    if (props.saveStatus === "saving") return language.t("common.saving")
    if (props.saveStatus === "error") return language.t("common.saveFailed")
    return undefined
  }
  const groups = () => props.menu.filter((group) => group.items.length > 0)
  const views = () => props.viewMenu ?? []
  const dirty = () => props.saveStatus === "dirty" || props.saveStatus === "error"

  return (
    <div
      class="flex h-10 shrink-0 items-center gap-1.5 overflow-hidden border-b border-border px-2.5"
      data-print-hide
      data-component="file-preview-header"
    >
      {/* 文件树开关放在最左：树展开时它贴着树与预览的分界，收起后仍留在同一位置，
          不会跟着右侧动作区一起漂走。 */}
      <Show when={props.onToggleTree}>
        <IconButton
          icon="tree-structure"
          variant="ghost"
          size="small"
          data-action="file-preview-toggle-tree"
          aria-pressed={!!props.treeOpen}
          classList={{
            "-ml-1 shrink-0": true,
            "text-icon-blue": !!props.treeOpen,
            "text-foreground-subtle": !props.treeOpen,
          }}
          aria-label={props.treeOpen ? language.t("sidePane.tree.hide") : language.t("sidePane.tree.show")}
          title={props.treeOpen ? language.t("sidePane.tree.hide") : language.t("sidePane.tree.show")}
          onClick={() => props.onToggleTree?.()}
        />
      </Show>
      <div class="flex min-w-0 flex-1 items-center gap-1.5">
        <Icon name={iconOf(props.path)} size="small" class="shrink-0 text-foreground-subtlest" />
        <span class="min-w-0 truncate text-ui-sm font-medium text-foreground" title={props.path}>
          {filename()}
        </span>
        <Show when={props.badge}>
          <span class="shrink-0 rounded-full bg-surface px-1.5 py-px text-ui-xs text-foreground-subtle">
            {props.badge}
          </span>
        </Show>
        <Show when={status()}>
          <span
            class="shrink-0 text-ui-xs"
            classList={{
              "text-foreground-subtle": props.saveStatus === "dirty",
              "text-icon-blue": props.saveStatus === "saving",
              "text-icon-critical-base": props.saveStatus === "error",
            }}
          >
            {status()}
          </span>
        </Show>
      </div>

      <div class="flex shrink-0 items-center gap-0.5">
        <Show when={props.onUndo}>
          <IconButton
            icon="lu-undo"
            variant="ghost"
            size="small"
            disabled={!props.canUndo}
            class="shrink-0 text-foreground-subtle"
            aria-label={language.t("session.filePreview.undo")}
            title={
              props.undoLabel
                ? language.t("session.filePreview.undoNamed", { label: props.undoLabel })
                : `${language.t("session.filePreview.undo")} (Ctrl+Z)`
            }
            onClick={() => props.onUndo?.()}
          />
        </Show>
        <Show when={props.onRedo}>
          <IconButton
            icon="lu-redo"
            variant="ghost"
            size="small"
            disabled={!props.canRedo}
            class="shrink-0 text-foreground-subtle"
            aria-label={language.t("session.filePreview.redo")}
            title={
              props.redoLabel
                ? language.t("session.filePreview.redoNamed", { label: props.redoLabel })
                : `${language.t("session.filePreview.redo")} (Ctrl+Shift+Z)`
            }
            onClick={() => props.onRedo?.()}
          />
        </Show>
        <Show when={props.onSave}>
          <IconButton
            icon="lu-save"
            variant="ghost"
            size="small"
            disabled={!dirty() || props.saveStatus === "saving"}
            classList={{
              "shrink-0": true,
              "text-icon-blue": dirty(),
              "text-foreground-subtle": !dirty(),
            }}
            aria-label={language.t("common.save")}
            title={`${language.t("common.save")} (Ctrl+S)`}
            onClick={() => props.onSave?.()}
          />
        </Show>
        <Show when={props.onOpenNative || (props.openNativeMenu?.length ?? 0) > 0}>
          <div class="flex h-6 shrink-0 items-center overflow-hidden rounded-md border border-border bg-surface">
            <Show when={props.onOpenNative}>
              <button
                type="button"
                data-action="file-preview-open-native"
                class="h-full px-2 text-ui-xs text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
                onClick={() => props.onOpenNative?.()}
              >
                {props.openNativeLabel ?? "用默认应用打开"}
              </button>
            </Show>
            <DropdownMenu gutter={4} placement="bottom-end">
              <DropdownMenu.Trigger
                as={IconButton}
                icon="chevron-down"
                variant="ghost"
                size="small"
                class="h-full w-6 shrink-0 rounded-none text-foreground-subtlest"
                aria-label={language.t("session.filePreview.openWith")}
                title={language.t("session.filePreview.openWith")}
              />
              <DropdownMenu.Portal>
                <DropdownMenu.Content class="max-h-[70vh] overflow-y-auto" style={{ "min-width": "210px" }}>
                  <For each={props.openNativeMenu ?? []}>
                    {(item) => (
                      <DropdownMenu.Item disabled={item.disabled} onSelect={item.onSelect}>
                        <DropdownMenu.ItemLabel>{item.label}</DropdownMenu.ItemLabel>
                      </DropdownMenu.Item>
                    )}
                  </For>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu>
          </div>
        </Show>
        <Show when={props.onFind}>
          <IconButton
            icon="magnifying-glass"
            variant="ghost"
            size="small"
            class="shrink-0 text-foreground-subtle"
            aria-label={language.t("session.filePreview.find")}
            title={language.t("session.filePreview.findTitle")}
            onClick={() => props.onFind?.()}
          />
        </Show>
        <Show when={views().length > 1}>
          <DropdownMenu gutter={4} placement="bottom-end">
            <DropdownMenu.Trigger
              as={IconButton}
              icon="lu-eye"
              variant="ghost"
              size="small"
              class="shrink-0 text-foreground-subtle"
              aria-label={language.t("session.filePreview.group.view")}
              title={language.t("session.filePreview.group.view")}
            />
            <DropdownMenu.Portal>
              <DropdownMenu.Content style={{ "min-width": "180px" }}>
                <MenuItems items={views()} />
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu>
        </Show>
        <Show when={props.canEdit}>
          <button
            type="button"
            data-action="file-preview-toggle-edit"
            aria-pressed={props.editing}
            class="flex h-6 items-center gap-1 rounded-md border px-2 text-ui-xs transition-colors"
            classList={{
              "border-border bg-background text-foreground hover:bg-hover": !props.editing,
              [PREVIEW_ACTIVE_CLASS]: props.editing,
            }}
            onClick={() => props.onToggleEditing()}
          >
            <Icon name={props.editing ? "check-small" : "pencil-line"} size="small" class="shrink-0" />
            {props.editing ? language.t("common.done") : (props.editLabel ?? language.t("common.edit"))}
          </button>
        </Show>
        <Show when={groups().length > 0}>
          <DropdownMenu gutter={4} placement="bottom-end">
            <DropdownMenu.Trigger
              as={IconButton}
              icon="dot-grid"
              variant="ghost"
              size="small"
              class="shrink-0 text-foreground-subtle"
              aria-label={language.t("common.moreOptions")}
              title={language.t("common.moreOptions")}
            />
            <DropdownMenu.Portal>
              <DropdownMenu.Content class="max-h-[70vh] overflow-y-auto" style={{ "min-width": "220px" }}>
                <For each={groups()}>
                  {(group, index) => (
                    <>
                      <Show when={index() > 0}>
                        <DropdownMenu.Separator />
                      </Show>
                      <DropdownMenu.Group>
                        <Show when={group.label}>
                          <DropdownMenu.GroupLabel>{group.label}</DropdownMenu.GroupLabel>
                        </Show>
                        <MenuItems items={group.items} />
                      </DropdownMenu.Group>
                    </>
                  )}
                </For>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu>
        </Show>
      </div>
    </div>
  )
}

/** 「视图▾」与「⋯」共用同一套条目渲染：选中勾、快捷键提示只在这里定义一次。 */
function MenuItems(props: { items: PreviewMenuItem[] }) {
  return (
    <For each={props.items}>
      {(item) => (
        <DropdownMenu.Item disabled={item.disabled} onSelect={item.onSelect}>
          <DropdownMenu.ItemLabel class="flex items-center gap-2">
            <span class="w-3 shrink-0 text-ui-xs text-foreground">{item.checked ? "✓" : ""}</span>
            <span class="min-w-0 flex-1 truncate">{item.label}</span>
            <Show when={item.hint}>
              <span class="shrink-0 text-ui-xs text-foreground-subtlest">{item.hint}</span>
            </Show>
          </DropdownMenu.ItemLabel>
        </DropdownMenu.Item>
      )}
    </For>
  )
}
