import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { BasicTool, ToolRegistry } from "@novaway/ui/message-part"
import { Icon } from "@novaway/ui/icon"
import { Markdown } from "@novaway/ui/markdown"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { ExecutorAvatar } from "@/components/executor-avatar"
import { executorTheme } from "@/utils/executor-theme"
import {
  normalizeTeamRunState,
  teamRunApprovalLabelKey,
  teamRunExecutor,
  teamRunIsTerminal,
  teamRunPolicy,
  teamRunPolicyLabelKey,
  teamRunStateLabelKey,
  type TeamRunState,
} from "./team-run-tool.logic"

type TeamRunDetail = {
  run?: {
    state?: string
    phase?: string
    goal?: string
    readOnly?: boolean
    error?: string
    terminalReason?: string
  }
  teams?: Array<{
    id?: string
    profileID?: string
    phase?: string
    members?: Array<{ id?: string; name?: string; role?: string }>
  }>
  assignments?: Array<{ status?: string; objective?: string; employeeID?: string }>
}

const active = new Set<TeamRunState>(["queued", "planning", "running"])

/**
 * 聊天里的协作工具行。
 *
 * Claude Code 风格的关键不是把后台表格塞进聊天，而是把协作折叠成主助手的一步：
 * 默认只显示「正在调用专家 / 团队」和一条进度摘要，用户展开后才看名册、派工和
 * 原始报告。这样专家是主助手的执行细节，而不是另一个需要用户操作的后台产品。
 */
export function TeamRunToolComponent(props: {
  input: Record<string, any>
  metadata: Record<string, any>
  output?: string
  status?: string
}) {
  const language = useLanguage()
  const sdk = useSDK()
  const [detail, setDetail] = createSignal<TeamRunDetail>()
  const [showRoster, setShowRoster] = createSignal(false)
  const [showOutput, setShowOutput] = createSignal(false)
  const runID = createMemo(() => (typeof props.metadata?.runID === "string" ? props.metadata.runID : ""))
  const run = createMemo(() => detail()?.run)
  const teams = createMemo(() => detail()?.teams ?? [])
  const assignments = createMemo(() => detail()?.assignments ?? [])
  const activeAssignments = createMemo(
    () =>
      assignments().filter(
        (item) => item.status === "running" || item.status === "accepted" || item.status === "delivered",
      ).length,
  )
  const title = createMemo(() => {
    const target = typeof props.input?.expert === "string" ? props.input.expert : props.input?.team
    return target || language.t("team.run.tool.title")
  })
  const state = createMemo<TeamRunState>(() => {
    const statusState = normalizeTeamRunState(props.status)
    const fallback =
      statusState !== "unknown" ? statusState : props.status === "error" ? "failed" : props.output ? "done" : "running"
    return normalizeTeamRunState(run()?.state ?? props.metadata?.state ?? fallback)
  })
  const phase = createMemo(() => run()?.phase)
  const executor = createMemo(() => teamRunExecutor(props.input ?? {}))
  const theme = createMemo(() => executorTheme(title()))
  const policy = createMemo(() =>
    teamRunPolicy({
      readOnly: run()?.readOnly ?? props.metadata?.readOnly,
      allowWrites: props.input?.allowWrites,
    }),
  )
  const policyLabel = createMemo(() => language.t(teamRunPolicyLabelKey(policy())))
  const stateLabel = createMemo(() => language.t(teamRunStateLabelKey(state())))
  const approvalLabel = createMemo(() => language.t(teamRunApprovalLabelKey({ state: state(), policy: policy() })))
  const toolStatus = createMemo(() => {
    if (active.has(state())) return "running"
    if (state() === "failed" || state() === "exceeded" || state() === "cancelled") return "error"
    return "completed"
  })
  const load = async () => {
    const id = runID()
    if (!id) return
    try {
      const result = await sdk.client.run.detail({ runID: id, directory: sdk.directory })
      setDetail((result.data ?? undefined) as TeamRunDetail | undefined)
    } catch {
      // 运行详情是增强信息；聊天工具行仍然显示基础状态和原始输出。
    }
  }

  createEffect(() => {
    const id = runID()
    if (!id) return
    void load()
    const timer = window.setInterval(() => {
      if (!teamRunIsTerminal(state())) void load()
    }, 2500)
    onCleanup(() => window.clearInterval(timer))
  })

  return (
    <BasicTool
      {...props}
      icon="lu-users"
      badge={{
        color:
          state() === "failed" || state() === "exceeded" || state() === "cancelled"
            ? "red"
            : state() === "partial" || state() === "needs_review" || state() === "awaiting_approval"
              ? "orange"
              : "violet",
      }}
      status={toolStatus()}
      statusLabel={stateLabel()}
      statusTooltip={run()?.error ?? run()?.terminalReason}
      showStatus
      autoCollapseOnComplete
      trigger={{
        title: language.t("team.run.tool.title"),
        subtitle: title(),
        detail: (
          <span
            data-slot="team-run-collaborator"
            class="inline-flex items-center gap-1.5 text-11-regular text-foreground-subtle"
          >
            <ExecutorAvatar kind={executor()} name={title()} class="size-4 rounded-md" />
            {language.t(executor() === "expert" ? "team.run.tool.executor.expert" : "team.run.tool.executor.team")}
          </span>
        ),
        args: [
          language.t(executor() === "expert" ? "team.run.tool.executor.expert" : "team.run.tool.executor.team"),
          phase(),
          policyLabel(),
        ].filter((item): item is string => !!item),
      }}
    >
      <div
        class="flex w-full min-w-0 max-w-full flex-col gap-2 overflow-hidden rounded-xl border border-border/70 p-2"
        style={{
          background: theme().gradient,
          "border-left": `3px solid ${theme().accent}`,
        }}
        data-component="team-run-tool"
      >
        <div
          class="flex flex-wrap items-center gap-x-3 gap-y-1 text-11-regular text-foreground-subtle"
          data-slot="team-run-summary"
        >
          <span class="inline-flex items-center gap-1.5" data-slot="team-run-identity">
            <ExecutorAvatar kind={executor()} name={title()} class="size-6 rounded-lg" />
            <span class="max-w-40 truncate text-foreground">{title()}</span>
          </span>
          <span
            class="inline-flex items-center gap-1 rounded-full border border-border/70 bg-surface/70 px-1.5 py-0.5"
            data-slot="team-run-state"
            data-state={state()}
          >
            <Icon
              name={active.has(state()) ? "lu-loader" : state() === "awaiting_approval" ? "lu-clock" : "check"}
              size="small"
            />
            {stateLabel()}
          </span>
          <span
            class="rounded-full border border-border/60 px-1.5 py-0.5"
            data-slot="team-run-policy"
            data-policy={policy()}
          >
            {policyLabel()}
          </span>
          <span
            class="rounded-full border border-border/60 px-1.5 py-0.5"
            data-slot="team-run-approval"
            data-approval={state() === "awaiting_approval" || state() === "needs_review" ? "attention" : "guarded"}
          >
            {approvalLabel()}
          </span>
          <Show when={phase()}>
            <span>{phase()}</span>
          </Show>
          <Show when={teams().length > 0}>
            <span>{language.t("team.run.tool.teams", { count: teams().length })}</span>
          </Show>
          <Show when={activeAssignments() > 0}>
            <span>{language.t("team.run.tool.assignments", { count: activeAssignments() })}</span>
          </Show>
        </div>

        <Show when={teams().length > 0 || assignments().length > 0}>
          <button
            type="button"
            data-action="team-run-toggle-roster"
            class="self-start rounded-md px-2 py-1 text-11-medium text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
            onClick={() => setShowRoster(!showRoster())}
          >
            {showRoster() ? language.t("team.run.tool.hideRoster") : language.t("team.run.tool.showRoster")}
          </button>
          <Show when={showRoster()}>
            <div class="flex w-full min-w-0 max-w-full flex-col gap-1 overflow-hidden" data-slot="team-run-roster">
              <For each={teams()}>
                {(team) => (
                  <div class="flex w-full min-w-0 max-w-full items-start justify-between gap-2 overflow-hidden rounded-md bg-surface/60 px-2 py-1 text-11-regular">
                    <span class="min-w-0 break-words text-foreground" style={{ "overflow-wrap": "anywhere" }}>
                      {team.members?.find((member) => member.role === "captain")?.name ??
                        team.members?.[0]?.name ??
                        team.profileID ??
                        language.t("team.run.tool.unknownExecutor")}
                    </span>
                    <span class="shrink-0 text-foreground-subtle">{team.phase}</span>
                  </div>
                )}
              </For>
              <For each={assignments()}>
                {(assignment) => (
                  <div class="flex w-full min-w-0 max-w-full items-start justify-between gap-2 overflow-hidden rounded-md px-2 py-1 text-11-regular text-foreground-subtle">
                    <span class="min-w-0" style={{ "overflow-wrap": "anywhere" }}>{assignment.objective ?? assignment.employeeID}</span>
                    <span class="shrink-0">{assignment.status}</span>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Show>

        <Show when={props.output}>
          <button
            type="button"
            data-action="team-run-toggle-output"
            class="self-start rounded-md px-2 py-1 text-11-medium text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
            onClick={() => setShowOutput(!showOutput())}
          >
            {showOutput() ? language.t("team.run.tool.hideDetails") : language.t("team.run.tool.showDetails")}
          </button>
          <Show when={showOutput()}>
            <div data-component="tool-output" data-scrollable>
              <Markdown text={props.output!} />
            </div>
          </Show>
        </Show>
      </div>
    </BasicTool>
  )
}

ToolRegistry.register({ name: "team_run", render: TeamRunToolComponent })
ToolRegistry.register({ name: "team_run_status", render: TeamRunToolComponent })
