import { For, Show, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { IconButton } from "@novaway/ui/icon-button"
import { showToast } from "@novaway/ui/toast"
import { useLanguage } from "@/context/language"
import { useLayout, sidePaneSubagentTabId } from "@/context/layout"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { agentDisplayName } from "@/utils/agent"
import { agentAvatarSrc } from "@/utils/agent-avatar"
import {
  canMessage,
  canStop,
  currentTask,
  leadOnlyInProgress,
  memberStat,
  openTasks,
  taskOwnerName,
  taskProgress,
  usageBreakdown,
  usageLabel,
  visibleMembers,
  type AgentMember,
  type AgentTask,
} from "./agents-section-model"
import type { StatusPanelSection } from "./status-panel"

type Overview = {
  team?: { id: string; name: string; description?: string; rootSessionID: string }
  members: AgentMember[]
  tasks: AgentTask[]
  usage?: AgentMember["usage"]
}

const EMPTY: Overview = { members: [], tasks: [] }

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err))

// 团队状态没有服务端推送，和后台任务一样用轮询换取实时感。
// 只有确实存在团队成员时才把区块塞进面板，避免普通单代理会话多出一张空卡。
export type AgentsSection = {
  section: () => StatusPanelSection | null
  /** 已在团队卡片里展示的成员会话，供后台任务卡片去重。 */
  memberSessionIDs: () => ReadonlySet<string>
}

export function useAgentsSection(sessionID: () => string): AgentsSection {
  const sdk = useSDK()
  const sync = useSync()
  const language = useLanguage()
  const layout = useLayout()
  const [store, setStore] = createStore({
    overview: EMPTY,
    error: "",
  })
  const [draft, setDraft] = createSignal<{ sessionID: string; text: string } | undefined>(undefined)

  let inflight = false
  const signature = (value: Overview) => JSON.stringify(value)
  const load = () => {
    const id = sessionID()
    if (!id || inflight) return
    inflight = true
    void sdk.client.team
      .overview({ directory: sdk.directory, sessionID: id })
      .then((result) => {
        const overview = (result.data ?? EMPTY) as Overview
        if (signature(overview) !== signature(store.overview)) setStore({ overview, error: "" })
      })
      .catch((err: unknown) => setStore("error", messageOf(err)))
      .finally(() => {
        inflight = false
      })
  }

  createEffect(
    on(sessionID, (id) => {
      setStore({ overview: EMPTY, error: "" })
      if (id) load()
    }),
  )

  const timer = setInterval(load, 2000)
  onCleanup(() => clearInterval(timer))

  const members = createMemo(() => visibleMembers(store.overview.members))
  // 概览每 2 秒刷新（用量也在变），但成员集合没变时保持同一个 Set，
  // 避免后台任务卡片跟着无意义重算。
  const memberSessionIDs = createMemo<ReadonlySet<string>>((previous) => {
    const next = new Set(members().map((member) => member.sessionID))
    if (previous && previous.size === next.size && [...next].every((id) => previous.has(id))) return previous
    return next
  })
  const progress = createMemo(() => taskProgress(store.overview.tasks))
  // 看板上还没结束的任务。以前面板只显示"成员"，于是“建了 3 个任务、但一个
  // 子代理都没派”时右侧看起来啥也没发生；列出任务本身，用户才能对上到底在跑什么。
  const tasks = createMemo(() => openTasks(store.overview.tasks))
  const leadOnly = createMemo(() => leadOnlyInProgress(store.overview.tasks, members()))
  const totalUsage = createMemo(() => usageLabel(store.overview.usage, language.intl()))
  const totalUsageTitle = createMemo(() => usageBreakdown(store.overview.usage, language.intl()))

  const statusLabel = (member: AgentMember) => {
    if (member.status === "active") return language.t("statusPanel.agents.working")
    if (member.status === "archived") return language.t("statusPanel.agents.archived")
    return language.t("statusPanel.agents.idle")
  }

  const statusClass = (member: AgentMember) => {
    if (member.status === "active") return "text-foreground animate-pulse"
    return "text-foreground-subtlest"
  }

  const taskStatusLabel = (task: AgentTask) => language.t(`statusPanel.agents.task.${task.status}` as never)

  const taskDotClass = (task: AgentTask) => {
    if (task.status === "in_progress") return "bg-icon-blue animate-pulse"
    if (task.status === "failed") return "bg-destructive"
    return "bg-foreground-subtlest"
  }

  // 团队存的是 agent id（如 engineering-code-reviewer）；面板按 AI 员工配置的
  // 显示名展示，和输入框 / 设置页保持一致。
  const agentLabel = (name: string) =>
    agentDisplayName(
      name,
      sync.data.agent.find((agent) => agent.name === name)?.options,
    )

  const open = (member: AgentMember) => {
    // team-lead 就是当前主会话；再在侧边打开一次只会得到一份完全相同的对话。
    if (member.sessionID === sessionID()) return
    layout.sidePane.openSession({
      id: sidePaneSubagentTabId(member.sessionID),
      kind: "subagent",
      sessionID: member.sessionID,
      parentID: sessionID(),
      title: member.name,
    })
  }

  const send = (member: AgentMember) => {
    const text = draft()?.sessionID === member.sessionID ? draft()!.text.trim() : ""
    if (!text) return
    setDraft(undefined)
    void sdk.client.team
      .message({ directory: sdk.directory, sessionID: sessionID(), to: member.name, message: text })
      .then(() => showToast({ title: language.t("statusPanel.agents.sent", { name: member.name }) }))
      .catch((err: unknown) => showToast({ title: language.t("common.requestFailed"), description: messageOf(err) }))
  }

  const stop = (member: AgentMember) => {
    // 停止的是成员自己的会话（abort 会连带取消其后台 job）。
    // backgroundCancel 只对「父会话名下的后台任务」有效，工作流/编排派生的
    // worker 没有这条 job，所以旧实现点了没反应。
    void sdk.client.session
      .abort({ sessionID: member.sessionID })
      .then(() => {
        setStore("error", "")
        load()
      })
      .catch((err: unknown) => setStore("error", messageOf(err)))
  }

  const section = createMemo(() => {
    if (members().length === 0) return null
    const team = store.overview.team
    return {
      id: "agents",
      title: team ? `${language.t("statusPanel.agents.title")} · ${team.name}` : language.t("statusPanel.agents.title"),
      summary: (
        <span class="tabular-nums">
          {memberStat(store.overview.members)}
          <Show when={progress().total > 0}>
            {" "}
            · {progress().done}/{progress().total}
          </Show>
          <Show when={totalUsage()}>
            {(value) => (
              <span class="text-foreground-subtle" title={totalUsageTitle()}>
                {" · "}
                {value()}
              </span>
            )}
          </Show>
        </span>
      ),
      defaultOpen: false,
      children: (
        <div class="flex flex-col gap-0.5 pb-1">
          <For each={members()}>
            {(member) => {
              const task = createMemo(() => currentTask(member, store.overview.tasks))
              const usage = createMemo(() => usageLabel(member.usage, language.intl()))
              const usageTitle = createMemo(() => usageBreakdown(member.usage, language.intl()))
              // 面板始终挂在主会话上：lead 这一行就是当前对话本身，没有可打开的侧栏，
              // 也不该出现「发消息 / 停止」——那会作用到主会话。
              const current = member.sessionID === sessionID()
              return (
                <div class="min-w-0 rounded-lg transition-colors hover:bg-hover">
                  <div class="flex min-w-0 items-start gap-2 px-2 py-1.5">
                    <img
                      src={agentAvatarSrc((member.agent || "agent").toLowerCase())}
                      alt=""
                      draggable={false}
                      class="mt-0.5 size-5 shrink-0 rounded-md object-cover"
                    />
                    <button
                      type="button"
                      class={`min-w-0 flex-1 text-left ${current ? "cursor-default" : ""}`}
                      title={
                        current ? `${member.name} · ${language.t("statusPanel.agents.currentSession")}` : member.name
                      }
                      onClick={() => open(member)}
                    >
                      <div class="flex min-w-0 items-center gap-2">
                        <span class="min-w-0 flex-1 truncate text-ui-base text-foreground">{member.name}</span>
                        <span class={`shrink-0 text-ui-xs tabular-nums ${statusClass(member)}`}>
                          {statusLabel(member)}
                        </span>
                      </div>
                      <div class="mt-0.5 flex min-w-0 items-baseline gap-1 text-ui-xs text-foreground-subtle">
                        <div class="min-w-0 flex-1 truncate">
                          <Show when={task()} fallback={<span title={member.agent}>{agentLabel(member.agent)}</span>}>
                            {(value) => (
                              <span>
                                <span title={member.agent}>{agentLabel(member.agent)}</span>
                                <span class="text-foreground-subtlest">
                                  {" · "}
                                  {value().activeForm ?? value().subject} · {value().status}
                                </span>
                                <Show when={usageLabel(value().usage, language.intl())}>
                                  {(label) => <span class="text-foreground-subtlest"> · {label()}</span>}
                                </Show>
                              </span>
                            )}
                          </Show>
                        </div>
                        <Show when={usage()}>
                          {(label) => (
                            <span class="shrink-0 tabular-nums text-foreground-subtlest" title={usageTitle()}>
                              {label()}
                            </span>
                          )}
                        </Show>
                      </div>
                      <Show when={member.worktreePath}>
                        <div class="mt-0.5 truncate font-mono text-ui-xs text-foreground-subtlest">
                          {member.worktreePath}
                        </div>
                      </Show>
                    </button>
                    <div class="flex shrink-0 items-center gap-0.5">
                      <Show when={!current && canMessage(member)}>
                        <IconButton
                          icon="bubble-5"
                          variant="ghost"
                          size="small"
                          class="h-5 w-5"
                          title={language.t("statusPanel.agents.message")}
                          aria-label={language.t("statusPanel.agents.message")}
                          onClick={() =>
                            setDraft((prev) =>
                              prev?.sessionID === member.sessionID
                                ? undefined
                                : { sessionID: member.sessionID, text: "" },
                            )
                          }
                        />
                      </Show>
                      <Show when={!current && canStop(member)}>
                        <IconButton
                          icon="stop"
                          variant="ghost"
                          size="small"
                          class="h-5 w-5"
                          title={language.t("statusPanel.agents.stop")}
                          aria-label={language.t("statusPanel.agents.stop")}
                          onClick={() => stop(member)}
                        />
                      </Show>
                    </div>
                  </div>
                  <Show when={draft()?.sessionID === member.sessionID}>
                    <div class="ml-6 flex items-center gap-1 pb-1">
                      <input
                        class="h-7 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-ui-xs text-foreground outline-none focus:border-border-focus"
                        placeholder={language.t("statusPanel.agents.messagePlaceholder")}
                        value={draft()?.text ?? ""}
                        onInput={(event) => setDraft({ sessionID: member.sessionID, text: event.currentTarget.value })}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") send(member)
                          if (event.key === "Escape") setDraft(undefined)
                        }}
                      />
                      <IconButton
                        icon="arrow-up"
                        variant="ghost"
                        size="small"
                        class="h-6 w-6"
                        title={language.t("statusPanel.agents.send")}
                        aria-label={language.t("statusPanel.agents.send")}
                        onClick={() => send(member)}
                      />
                    </div>
                  </Show>
                </div>
              )
            }}
          </For>
          <Show when={tasks().length > 0}>
            <div class="mt-1 border-t border-border pt-1">
              <div class="flex min-w-0 items-center gap-2 px-2 py-0.5 text-ui-xs text-foreground-subtlest">
                <span class="flex-1">{language.t("statusPanel.agents.tasks")}</span>
                <Show when={leadOnly()}>
                  <span class="shrink-0 text-warning" title={language.t("statusPanel.agents.tasksIdleHint")}>
                    {language.t("statusPanel.agents.tasksIdle")}
                  </span>
                </Show>
              </div>
              <For each={tasks()}>
                {(task) => (
                  <div class="flex min-w-0 items-start gap-2 px-2 py-1">
                    <span class={`mt-1.5 size-1.5 shrink-0 rounded-full ${taskDotClass(task)}`} />
                    <div class="min-w-0 flex-1">
                      <div class="truncate text-ui-xs text-foreground-subtle" title={task.subject}>
                        {task.subject}
                      </div>
                      <div class="truncate text-ui-xs text-foreground-subtlest">
                        {taskStatusLabel(task)}
                        {" · "}
                        {taskOwnerName(task, members()) ?? language.t("statusPanel.agents.taskUnassigned")}
                      </div>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
          <Show when={store.error}>
            <div class="px-2 text-ui-xs text-destructive">{store.error}</div>
          </Show>
        </div>
      ),
    } satisfies StatusPanelSection
  })

  return { section, memberSessionIDs }
}
