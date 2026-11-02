import { For, Show, createSignal, type JSX } from "solid-js"
import { Button } from "@novaway/ui/button"
import { Icon } from "@novaway/ui/icon"
import { Tag } from "@novaway/ui/tag"
import { useLanguage } from "@/context/language"

/**
 * 批准前的计划预览（§4.3）。
 *
 * Magentic-UI 的做法值得抄：计划不是黑箱，用户在「接受计划」之前能看清
 * 谁来做、做什么、怎样算做到。看板以前只有一个批准按钮 —— 用户点下去时
 * 并不知道自己批准的是哪几支队伍、有没有验收标准、能不能改文件。
 *
 * 这里刻意只做「看清 + 补验收」，不在这里做计划编排：改团队会重建团队行，
 * 属于另一个动作；而补一条验收是批准前最常见的补救，值得就地完成。
 */

export type PlanReviewTeam = {
  id: string
  /** 已经换成展示名的团队名；找不到模板时由上层给出可辨认的占位。 */
  name: string
  /** SDK 的数字字段可能是字符串化的 Infinity/NaN；展示前统一转成有限数字。 */
  memberCount?: number | string
  scope?: readonly string[]
  dependsOn: readonly (number | string)[]
}

export type PlanReviewAcceptance = {
  id: string
  text: string
  kind: string
  expected?: string
  /** 命令类验收只带类型与超时；命令原文按既有约束不出接口、也不显示。 */
  verifier?: { kind: string; timeoutMs?: number | string }
}

const KIND_KEYS: Record<string, string> = {
  test: "run.plan.kind.test",
  diff: "run.plan.kind.diff",
  file: "run.plan.kind.file",
  rubric: "run.plan.kind.rubric",
  human: "run.plan.kind.human",
}

export function RunPlanReview(props: {
  planVersion: number | string
  teams: PlanReviewTeam[]
  acceptances: PlanReviewAcceptance[]
  readOnly: boolean
  budgetTokens?: number | string
  busy: boolean
  /** 第二个参数是验收归属：不归属任何团队的验收只会在合并后重验，等于没验。 */
  onAddAcceptance: (text: string, owner?: string) => Promise<void>
}): JSX.Element {
  const language = useLanguage()
  const t = (key: string, vars?: Record<string, unknown>) => language.t(key as never, vars as never)
  const [draft, setDraft] = createSignal("")
  // 多队时由用户选归属；默认第一队。只有一队时不必多问。
  const [selectedOwner, setSelectedOwner] = createSignal("")
  const owner = () => selectedOwner() || props.teams[0]?.id || ""

  const kindLabel = (kind: string) => t(KIND_KEYS[kind] ?? "run.plan.kind.other")

  const submit = async () => {
    const text = draft().trim()
    if (!text || props.busy) return
    await props.onAddAcceptance(text, owner() || undefined)
    setDraft("")
  }

  return (
    <div class="flex flex-col gap-2 rounded-lg border border-border bg-background px-3 py-2">
      <div class="flex flex-wrap items-center gap-1.5 text-ui-xs">
        <Icon name="checklist" size="small" class="text-foreground-subtle" />
        <span class="text-foreground">{t("run.plan.title")}</span>
        <span class="text-foreground-subtlest">{t("run.plan.version", { version: String(props.planVersion) })}</span>
      </div>

      {/* 谁来做：团队名、人数、写入范围与依赖，一行一支队。 */}
      <div class="flex flex-col gap-1">
        <For each={props.teams}>
          {(team, index) => (
            <div class="flex flex-wrap items-center gap-1.5 text-ui-xs text-foreground-subtle">
              <Tag>{"#" + (index() + 1)}</Tag>
              <span class="text-foreground">{team.name}</span>
              <Show when={team.memberCount !== undefined}>
                {(count) => (
                  <span class="text-foreground-subtlest">
                    {t("run.plan.members", { count: String(Math.round(Number(count()))) })}
                  </span>
                )}
              </Show>
              <Show when={team.dependsOn.length > 0}>
                <span class="text-foreground-subtlest">
                  {t("run.team.deps", {
                    deps: team.dependsOn.map((dep) => "#" + (Math.round(Number(dep)) + 1)).join("、"),
                  })}
                </span>
              </Show>
              <Show when={(team.scope ?? []).length > 0}>
                <span class="min-w-0 truncate text-foreground-subtlest">
                  {t("run.team.scope", { paths: (team.scope ?? []).join("、") })}
                </span>
              </Show>
            </div>
          )}
        </For>
        <Show when={props.teams.length === 0}>
          <span class="text-ui-xs text-warning">{t("run.plan.noTeams")}</span>
        </Show>
      </div>

      <div class="flex flex-wrap items-center gap-1.5 text-ui-xs">
        <Tag title={t("run.policy.hint")}>{props.readOnly ? t("run.plan.readOnly") : t("run.plan.write")}</Tag>
        <Show when={props.budgetTokens !== undefined}>
          {(tokens) => (
            <Tag title={t("run.usage.capHint")}>
              {t("run.plan.budget", { tokens: Math.round(Number(tokens())).toLocaleString() })}
            </Tag>
          )}
        </Show>
      </div>

      {/* 怎样算做到：没有验收标准是批准前最该被看见的一件事。 */}
      <div class="flex flex-col gap-1">
        <span class="text-ui-xs text-foreground-subtle">
          {t("run.plan.acceptance", { count: String(props.acceptances.length) })}
        </span>
        <Show
          when={props.acceptances.length > 0}
          fallback={<div class="text-ui-xs leading-relaxed text-warning">{t("run.plan.acceptanceEmpty")}</div>}
        >
          <For each={props.acceptances}>
            {(acceptance) => (
              <div class="flex items-start gap-1.5 text-ui-xs">
                <Tag>{kindLabel(acceptance.kind)}</Tag>
                <span class="min-w-0 flex-1 text-foreground-subtle" title={acceptance.expected}>
                  {acceptance.text}
                </span>
                <Show when={acceptance.verifier}>
                  {(verifier) => (
                    <span class="shrink-0 text-foreground-subtlest">
                      {t("run.acceptance.commandTag", {
                        seconds: String(Math.round(Number(verifier().timeoutMs ?? 0) / 1000)),
                      })}
                    </span>
                  )}
                </Show>
              </div>
            )}
          </For>
        </Show>
        {/* 就地补一条：不必翻到页面底部去找验收台账。 */}
        <div class="flex items-center gap-1.5">
          {/* 多团队时必须选归属：不归属的验收不会在团队轮次里被验证。 */}
          <Show when={props.teams.length > 1}>
            <select
              class="h-7 max-w-40 shrink-0 rounded-md border border-border bg-surface px-1 text-ui-xs text-foreground-subtle outline-none focus:border-border-focus"
              value={owner()}
              onChange={(event) => setSelectedOwner(event.currentTarget.value)}
            >
              <For each={props.teams}>{(team) => <option value={team.id}>{team.name}</option>}</For>
            </select>
          </Show>
          <input
            class="h-7 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-ui-xs text-foreground outline-none placeholder:text-foreground-subtlest focus:border-border-focus"
            value={draft()}
            placeholder={t("run.plan.addPlaceholder")}
            onInput={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                void submit()
              }
            }}
          />
          <Button
            variant="ghost"
            size="small"
            disabled={props.busy || draft().trim().length === 0}
            onClick={() => void submit()}
          >
            {props.busy ? t("run.plan.adding") : t("run.plan.add")}
          </Button>
        </div>
      </div>

      <div class="text-ui-xs leading-relaxed text-foreground-subtlest">{t("run.plan.hint")}</div>
    </div>
  )
}
