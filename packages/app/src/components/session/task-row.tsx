import { Icon } from "@novaway/ui/icon"
import { IconButton } from "@novaway/ui/icon-button"
import { DropdownMenu } from "@novaway/ui/dropdown-menu"
import { createSignal, Show, type Accessor, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import { useDialog } from "@novaway/ui/context/dialog"
import { DialogDeleteSession } from "@/pages/layout/dialog-delete-session"
import { formatRelativeTime } from "@/utils/relative-time"

export type TaskStatus = "running" | "waiting" | "failed" | "idle"

export type TaskRowProps = {
  title: Accessor<string>
  status: Accessor<TaskStatus>
  branch?: Accessor<string | undefined>
  updated?: Accessor<number | undefined>
  additions?: Accessor<number>
  deletions?: Accessor<number>
  waitingBadge?: Accessor<boolean>
  selected?: Accessor<boolean>
  modeColor?: Accessor<string | undefined>
  onClick: () => void
  /** 重命名：写回后调用方负责刷新本地 store。 */
  onRename?: (title: string) => Promise<void> | void
  onArchive?: () => void
  onDelete?: () => void
  /** 删除确认框要按 id + directory 定位会话。 */
  sessionID?: string
  directory?: string
  /** 树形层级：0 = 项目下的根会话，1+ = 子会话。只影响缩进。 */
  level?: number
  /** 有子会话时显示展开/折叠箭头。 */
  expander?: { expanded: boolean; toggle: () => void }
  /** 已置顶（行首显示一个图钉）。 */
  pinned?: boolean
  onTogglePin?: () => void
}

const STATUS_DOT_CLASS: Record<TaskStatus, string> = {
  running: "bg-icon-blue animate-pulse",
  waiting: "bg-warning",
  failed: "bg-diff-removed",
  idle: "bg-border-hover",
}

export const TaskRow = (props: TaskRowProps): JSX.Element => {
  const language = useLanguage()
  const dialog = useDialog()
  const t = language.t
  const now = () => Date.now()
  const selected = () => props.selected?.() ?? false

  // 行内重命名：对齐侧栏会话项的交互（点菜单「重命名」后标题就地变输入框），
  // 不做弹窗——任务行的标题本来就短，就地编辑更快。
  const [editing, setEditing] = createSignal(false)
  const [draft, setDraft] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  let inputRef: HTMLInputElement | undefined

  const openTitleEditor = () => {
    if (!props.onRename) return
    setDraft(props.title())
    setEditing(true)
    requestAnimationFrame(() => {
      inputRef?.focus()
      inputRef?.select()
    })
  }

  const cancelEditing = () => {
    setEditing(false)
    setDraft("")
  }

  const saveTitle = async () => {
    if (saving()) return
    const next = draft().trim()
    if (!next || next === props.title()) {
      cancelEditing()
      return
    }
    setSaving(true)
    try {
      await props.onRename?.(next)
      setEditing(false)
    } catch {
      // 失败时留在编辑态，用户可以改名重试
    }
    setSaving(false)
  }

  const hasMenu = () => !!(props.onRename || props.onArchive || props.onDelete)

  return (
    <div
      data-component="task-row"
      data-level={props.level ?? 0}
      classList={{
        "group/task row relative flex h-9 items-center gap-2 px-2 rounded-md cursor-default transition-colors hover:bg-hover": true,
        "before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-full before:bg-[var(--task-row-color,var(--border-hover))]":
          selected(),
      }}
      style={{
        // 按层级缩进（`level` 是相对项目根的深度，见 sidebar-tasks 的注释）。
        // 用行内的 padding 而不是外层包 div：行本身的 hover 底色要跟着缩进后的宽度走，
        // 包一层会让 hover 区域退回到项目全宽。
        "padding-left": `${8 + (props.level ?? 0) * 16}px`,
        ...(selected() ? { "--task-row-color": props.modeColor?.() ?? "var(--border-hover)" } : {}),
      }}
      onClick={(event) => {
        if (editing()) return
        // 3 点菜单是行内的另一个交互目标，点它不应该顺带打开会话。
        // 放在行上判断而不是给 Trigger 加 onClick：Kobalte 的 Trigger 自己要用
        // click/pointerdown 开菜单，覆盖它的处理器会让菜单根本打不开。
        if ((event.target as Element | null)?.closest("[data-row-action]")) return
        props.onClick()
      }}
    >
      <Show when={props.expander}>
        {(expander) => (
          <button
            type="button"
            data-row-action
            class="grid size-4 shrink-0 place-items-center rounded text-foreground-subtlest transition-colors hover:bg-hover hover:text-foreground"
            aria-expanded={expander().expanded}
            aria-label={expander().expanded ? t("sidebar.project.collapse") : t("sidebar.project.expand")}
            onClick={(event) => {
              event.stopPropagation()
              expander().toggle()
            }}
          >
            <Icon name={expander().expanded ? "chevron-down" : "chevron-right"} size="small" />
          </button>
        )}
      </Show>
      <Show when={props.pinned}>
        <Icon name="pin" size="small" class="shrink-0 text-foreground-subtlest" />
      </Show>
      <span class={`size-1.5 rounded-full shrink-0 ${STATUS_DOT_CLASS[props.status()]}`} />
      <Show
        when={editing()}
        fallback={<span class="text-ui-caption text-foreground truncate flex-1 min-w-0">{props.title()}</span>}
      >
        <input
          ref={inputRef}
          value={draft()}
          class="flex-1 min-w-0 h-6 rounded border border-border bg-background px-1 text-ui-caption text-foreground outline-none focus:border-border-hover"
          aria-label={t("common.rename")}
          onClick={(event) => event.stopPropagation()}
          onInput={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            // 中文输入法组字期间的回车不算确认，否则会打断候选词上屏。
            if (event.isComposing) return
            if (event.key === "Enter") {
              event.preventDefault()
              void saveTitle()
            }
            if (event.key === "Escape") {
              event.preventDefault()
              cancelEditing()
            }
          }}
          onBlur={() => void saveTitle()}
        />
      </Show>
      <Show when={props.waitingBadge?.()}>
        <span class="text-ui-xs px-1 rounded border border-warning text-warning shrink-0">
          {t("taskCenter.waiting")}
        </span>
      </Show>
      <Show when={props.branch?.()}>
        <span class="text-ui-xs text-foreground-subtle shrink-0 max-w-[120px] truncate flex items-center gap-1">
          <Icon name="branch" size="small" />
          <span class="truncate">{props.branch?.()}</span>
        </span>
      </Show>
      <Show when={props.updated?.()}>
        <span class="text-ui-xs text-foreground-subtle shrink-0">{formatRelativeTime(props.updated?.(), now(), t)}</span>
      </Show>
      <Show when={(props.additions?.() ?? 0) + (props.deletions?.() ?? 0) > 0}>
        <span class="text-ui-xs tabular-nums shrink-0">
          <span class="text-[var(--diff-added)]">+{props.additions?.() ?? 0}</span>
          <span class="text-[var(--diff-removed)]">-{props.deletions?.() ?? 0}</span>
        </span>
      </Show>

      {/* 3 点菜单（重命名 / 归档 / 删除）。常驻但压到 60% 不透明度，
          hover 或菜单打开时提亮 —— 用户明确要求每行右边要有这三个点，
          所以不做成"只有 hover 才出现"（那样等于没有入口）。 */}
      <Show when={hasMenu() && !editing()}>
        <div data-row-action class="contents">
          <DropdownMenu gutter={4} placement="bottom-end">
            <DropdownMenu.Trigger
              as={IconButton}
              icon="dot-grid"
              variant="ghost"
              size="small"
              class="shrink-0 text-foreground-subtlest opacity-60 transition-opacity hover:opacity-100 group-hover/task:opacity-100 data-[expanded]:opacity-100"
              aria-label={t("common.moreOptions")}
            />
            <DropdownMenu.Portal>
              <DropdownMenu.Content style={{ "min-width": "140px" }}>
              <Show when={props.onTogglePin}>
                <DropdownMenu.Item onSelect={() => props.onTogglePin?.()}>
                  <DropdownMenu.ItemLabel>
                    {t(props.pinned ? "common.unpin" : "common.pin")}
                  </DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
              </Show>
              <Show when={props.onRename}>
                <DropdownMenu.Item onSelect={openTitleEditor}>
                  <DropdownMenu.ItemLabel>{t("common.rename")}</DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
              </Show>
              <Show when={props.onArchive}>
                <DropdownMenu.Item onSelect={() => props.onArchive?.()}>
                  <DropdownMenu.ItemLabel>{t("common.archive")}</DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
              </Show>
              <Show when={props.onDelete}>
                <DropdownMenu.Separator />
                <DropdownMenu.Item
                  onSelect={() =>
                    dialog.show(() => (
                      <DialogDeleteSession
                        sessionID={props.sessionID ?? ""}
                        title={props.title()}
                        directory={props.directory ?? ""}
                      />
                    ))
                  }
                >
                  <DropdownMenu.ItemLabel>{t("common.delete")}</DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
              </Show>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu>
        </div>
      </Show>
    </div>
  )
}
