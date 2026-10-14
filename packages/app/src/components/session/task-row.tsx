import { Icon } from "@novaway/ui/icon"
import { Show, type Accessor, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"
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
}

const STATUS_DOT_CLASS: Record<TaskStatus, string> = {
  running: "bg-text-interactive-base animate-pulse",
  waiting: "bg-surface-warning-strong",
  failed: "bg-text-diff-delete-base",
  idle: "bg-border-strong-base",
}

export const TaskRow = (props: TaskRowProps): JSX.Element => {
  const language = useLanguage()
  const t = language.t
  const now = () => Date.now()
  const selected = () => props.selected?.() ?? false
  return (
    <div
      classList={{
        "group/task row relative flex h-9 items-center gap-2 px-2 rounded-md cursor-default transition-colors hover:bg-surface-base-hover": true,
        "before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-full before:bg-[var(--task-row-color,var(--border-hover))]":
          selected(),
      }}
      style={selected() ? { "--task-row-color": props.modeColor?.() ?? "var(--border-hover)" } : undefined}
      onClick={props.onClick}
    >
      <span class={`size-1.5 rounded-full shrink-0 ${STATUS_DOT_CLASS[props.status()]}`} />
      <span class="text-ui-caption text-text-strong truncate flex-1 min-w-0">{props.title()}</span>
      <Show when={props.waitingBadge?.()}>
        <span class="text-ui-xs px-1 rounded border border-surface-warning-strong text-surface-warning-strong shrink-0">
          {t("taskCenter.waiting")}
        </span>
      </Show>
      <Show when={props.branch?.()}>
        <span class="text-ui-xs text-text-weak shrink-0 max-w-[120px] truncate flex items-center gap-1">
          <Icon name="branch" size="small" />
          <span class="truncate">{props.branch?.()}</span>
        </span>
      </Show>
      <Show when={props.updated?.()}>
        <span class="text-ui-xs text-text-weak shrink-0">{formatRelativeTime(props.updated?.(), now(), t)}</span>
      </Show>
      <Show when={(props.additions?.() ?? 0) + (props.deletions?.() ?? 0) > 0}>
        <span class="text-ui-xs tabular-nums shrink-0">
          <span class="text-[var(--diff-added)]">+{props.additions?.() ?? 0}</span>
          <span class="text-[var(--diff-removed)]">-{props.deletions?.() ?? 0}</span>
        </span>
      </Show>
    </div>
  )
}
