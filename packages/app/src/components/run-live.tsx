import { For, Show, createMemo, type JSX } from "solid-js"
import { Icon } from "@novaway/ui/icon"
import { Tag } from "@novaway/ui/tag"
import { useLanguage } from "@/context/language"
import { summarizeLive, type LiveTask, type LiveTeam } from "./run-live.logic"

/**
 * 执行中的实时进度（§4.3）。
 *
 * 竞品都把「它还在动吗」当成一等信息：Magentic-UI 用计划进度条，
 * AutoGen Studio 用实时消息流，LangGraph Studio 用逐步状态。看板不需要
 * 再抄一份日志 —— 它只要回答三件事：第几轮、做到多少、此刻在做什么。
 *
 * 只显示任务标题与计数，不显示成员会话里的命令或输出：那属于过程记录，
 * 不是看板该铺开的内容。
 */
export function RunLive(props: {
  state: string
  /** 恢复流程会清空 phase；这时仍可看最后的任务进度，只是不再说「正在执行」。 */
  phase?: string
  round: number | string
  updatedAt: number | string
  tasks: LiveTask[]
  teams: LiveTeam[]
}): JSX.Element {
  const language = useLanguage()
  const t = (key: string, vars?: Record<string, unknown>) => language.t(key as never, vars as never)
  const summary = createMemo(() => summarizeLive({ tasks: props.tasks, teams: props.teams }))
  const waiting = () => t(`run.live.waiting.${props.phase ?? "idle"}`)
  const time = () => new Date(Number(props.updatedAt)).toLocaleTimeString()

  return (
    <div class="flex flex-col gap-1.5 rounded-lg border border-border bg-background px-3 py-2">
      <div class="flex flex-wrap items-center gap-1.5 text-ui-xs">
        <Icon name="lu-activity" size="small" class="text-foreground-subtle" />
        <span class="text-foreground">{t(`run.state.${props.state}`)}</span>
        <Show when={props.phase}>{(phase) => <Tag>{t(`run.phase.${phase()}`)}</Tag>}</Show>
        <Tag>{t("run.live.round", { round: String(Math.round(Number(props.round))) })}</Tag>
        <span class="ml-auto text-foreground-subtlest">{t("run.live.updated", { time: time() })}</span>
      </div>

      <Show
        when={summary().total > 0}
        fallback={<div class="text-ui-xs leading-relaxed text-foreground-subtle">{waiting()}</div>}
      >
        <div class="flex items-center gap-2 text-ui-xs text-foreground-subtle">
          {/* 进度条只是辅助：数字在右边，不让人靠一条色带猜。 */}
          <div class="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-border">
            <div class="h-full rounded-full bg-primary transition-all" style={{ width: summary().percent + "%" }} />
          </div>
          <span class="shrink-0">
            {t("run.live.tasks", { done: String(summary().done), total: String(summary().total) })}
          </span>
        </div>
        <Show
          when={summary().current.length > 0}
          fallback={<div class="text-ui-xs leading-relaxed text-foreground-subtle">{waiting()}</div>}
        >
          <For each={summary().current}>
            {(task) => (
              <div class="flex items-center gap-1.5 text-ui-xs text-foreground-subtle">
                <span class="size-1.5 shrink-0 rounded-full bg-primary" />
                <span class="min-w-0 flex-1 truncate" title={task.subject}>
                  {task.subject}
                </span>
              </div>
            )}
          </For>
        </Show>
        <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-ui-xs text-foreground-subtlest">
          <span>{t("run.live.active", { count: String(summary().active) })}</span>
          <Show when={summary().totalTeams > 0}>
            <span>
              {t("run.live.teams", {
                done: String(summary().deliveredTeams),
                total: String(summary().totalTeams),
              })}
            </span>
          </Show>
          <Show when={summary().failed > 0}>
            <span class="text-destructive">{t("run.live.failed", { count: String(summary().failed) })}</span>
          </Show>
        </div>
      </Show>
    </div>
  )
}
