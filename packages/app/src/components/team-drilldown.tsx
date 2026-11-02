import { For, Show, type JSX } from "solid-js"
import { Icon } from "@novaway/ui/icon"
import { IconButton } from "@novaway/ui/icon-button"
import { Tag } from "@novaway/ui/tag"
import { useLanguage } from "@/context/language"
import { formatRelativeTime } from "@/utils/relative-time"
import type { DrillView } from "./team-drilldown.logic"

/**
 * 点开节点后的详情（§4.3）。
 *
 * 图回答「形状」，这里回答「内容」：这一步归谁、他还有哪些活、验收过没过。
 * 只摆任务标题、状态与验收结论 —— 不展开会话里的命令与输出，和事件流同一口径。
 */

const KIND_ICON: Record<DrillView["kind"], "lu-list-checks" | "lu-users" | "lu-zap"> = {
  task: "lu-list-checks",
  member: "lu-users",
  captain: "lu-zap",
}

const TASK_DOT: Record<string, string> = {
  completed: "bg-success",
  in_progress: "bg-primary",
  pending: "bg-border",
  failed: "bg-destructive",
  cancelled: "bg-border",
}

const OUTCOME_DOT: Record<string, string> = {
  pass: "bg-success",
  fail: "bg-destructive",
  stale: "bg-warning",
  unverified: "bg-warning",
}

export function TeamDrilldown(props: {
  view: DrillView
  laneName: string
  round: number
  onClose: () => void
  /** 打开认领人的执行会话：看完整过程仍然去会话页，不在看板上摊开。 */
  onOpenSession?: (sessionID: string) => void
}): JSX.Element {
  const language = useLanguage()
  const t = (key: string, vars?: Record<string, unknown>) => language.t(key as never, vars as never)
  const title = () => (props.view.unclaimed ? t("team.drill.unclaimedTitle") : props.view.title)
  const doneTasks = () => props.view.lines.filter((line) => line.task.status === "completed").length
  const passed = () =>
    props.view.lines.reduce((sum, line) => sum + line.acceptances.filter((item) => item.outcome === "pass").length, 0)
  const totalAcceptances = () => props.view.lines.reduce((sum, line) => sum + line.acceptances.length, 0)
  const statusLabel = (status: string) =>
    ["pending", "in_progress", "completed", "failed", "cancelled"].includes(status)
      ? t(`team.graph.status.${status}`)
      : status
  const outcomeLabel = (outcome: string | undefined) => outcome ?? t("team.drill.notVerified")

  return (
    <div class="flex flex-col gap-2 rounded-lg border border-primary/30 bg-background px-3 py-2">
      <div class="flex flex-wrap items-center gap-1.5 text-ui-xs">
        <Icon name={KIND_ICON[props.view.kind]} size="small" class="text-foreground-subtle" />
        <span class="min-w-0 truncate text-ui-base text-foreground">{title()}</span>
        <Tag>{t("team.graph.round", { round: String(props.round) })}</Tag>
        <span class="text-foreground-subtlest">{props.laneName}</span>
        <IconButton
          icon="close-small"
          size="small"
          variant="ghost"
          class="ml-auto"
          aria-label={t("team.drill.close")}
          title={t("team.drill.close")}
          onClick={props.onClose}
        />
      </div>

      <Show
        when={props.view.person}
        fallback={
          /* 队长节点本来就可能没有名册快照：那时不硬说「没人认领」。 */
          <Show when={props.view.kind !== "captain"}>
            <span class="text-ui-xs text-foreground-subtle">{t("team.drill.unclaimed")}</span>
          </Show>
        }
      >
        {(person) => (
          <div class="flex flex-wrap items-center gap-1.5 text-ui-xs text-foreground-subtle">
            <span class="text-foreground">{person().name}</span>
            <Show when={person().job}>{(job) => <span>{job()}</span>}</Show>
            <Show when={person().role}>{(role) => <Tag>{t(`team.drill.role.${role()}`)}</Tag>}</Show>
            <Show when={props.onOpenSession && props.view.ownerSessionID}>
              <button
                type="button"
                class="ml-auto rounded-md px-1.5 py-0.5 text-ui-xs text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
                onClick={() => props.onOpenSession?.(props.view.ownerSessionID!)}
              >
                {t("team.drill.openSession")}
              </button>
            </Show>
          </div>
        )}
      </Show>

      <div class="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-ui-xs text-foreground-subtlest">
        <span>{t("team.drill.tasks", { done: String(doneTasks()), total: String(props.view.lines.length) })}</span>
        <Show when={totalAcceptances() > 0}>
          <span>{t("team.drill.acceptance", { pass: String(passed()), total: String(totalAcceptances()) })}</span>
        </Show>
        <Show when={props.view.kind === "captain" && props.view.unassigned > 0}>
          <span class="text-warning">{t("team.graph.unassigned", { count: String(props.view.unassigned) })}</span>
        </Show>
      </div>

      <Show
        when={props.view.lines.length > 0}
        fallback={<div class="text-ui-xs text-foreground-subtlest">{t("team.drill.noTasks")}</div>}
      >
        <div class="flex flex-col gap-1.5">
          <For each={props.view.lines}>
            {(line) => (
              <div class="rounded-md border border-border/60 bg-surface px-2 py-1.5">
                <div class="flex items-center gap-1.5 text-ui-xs">
                  <span
                    class="size-1.5 shrink-0 rounded-full"
                    classList={{ [TASK_DOT[line.task.status] ?? "bg-border"]: true }}
                  />
                  <span class="min-w-0 flex-1 truncate text-foreground" title={line.task.subject}>
                    {line.task.subject}
                  </span>
                  {/* 队长视角里一条任务可能属于任何人：谁领的一眼要能看出来。 */}
                  <Show when={props.view.kind === "captain" && line.task.ownerName}>
                    <span class="shrink-0 text-foreground-subtle">{line.task.ownerName}</span>
                  </Show>
                  <span class="shrink-0 text-foreground-subtlest">{statusLabel(line.task.status)}</span>
                  <Show when={line.task.updatedAt}>
                    {(at) => (
                      <span class="shrink-0 text-foreground-subtlest">
                        {formatRelativeTime(Number(at()), Date.now(), language.t)}
                      </span>
                    )}
                  </Show>
                </div>
                <Show
                  when={line.acceptances.length > 0}
                  fallback={
                    <Show when={props.view.kind === "task"}>
                      <div class="mt-1 text-ui-xs text-foreground-subtlest">{t("team.drill.noAcceptance")}</div>
                    </Show>
                  }
                >
                  <div class="mt-1 flex flex-col gap-0.5">
                    <For each={line.acceptances}>
                      {(acceptance) => (
                        <div class="flex items-center gap-1.5 text-ui-xs">
                          <span
                            class="size-1 shrink-0 rounded-full"
                            classList={{ [OUTCOME_DOT[acceptance.outcome ?? ""] ?? "bg-border"]: true }}
                          />
                          <span class="min-w-0 flex-1 truncate text-foreground-subtle" title={acceptance.text}>
                            {acceptance.text}
                          </span>
                          <span class="shrink-0 text-foreground-subtlest">{outcomeLabel(acceptance.outcome)}</span>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
