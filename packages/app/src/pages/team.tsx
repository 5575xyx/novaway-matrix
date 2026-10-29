import type { Agent, TeamDetail, TeamMemberView, TeamMessageView, TeamSummaryView } from "@novaway/sdk/v2"
import { Button } from "@novaway/ui/button"
import { Icon } from "@novaway/ui/icon"
import { IconButton } from "@novaway/ui/icon-button"
import { Tag } from "@novaway/ui/tag"
import { showToast } from "@novaway/ui/toast"
import { Dialog } from "@novaway/ui/dialog"
import { useDialog } from "@novaway/ui/context/dialog"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type Component } from "solid-js"
import { PageHeader } from "@/components/page-header"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { agentColor } from "@/utils/agent"
import { formatRelativeTime } from "@/utils/relative-time"

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

const statusIcon = (status: TeamMemberView["status"]) =>
  status === "active" ? "lu-activity" : status === "archived" ? "circle-ban-sign" : "lu-circle"

const statusTone = (status: TeamMemberView["status"]) =>
  status === "active" ? "text-success" : status === "archived" ? "text-foreground-subtlest" : "text-foreground-subtle"

/** 用量字段在 JSON 里可能是字符串化的 Infinity/NaN，统一先转成有限数字。 */
function compactTokens(value: number | string | undefined) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0
  const total = Number.isFinite(parsed) ? parsed : 0
  if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(1)}M`
  if (total >= 1_000) return `${(total / 1_000).toFixed(1)}k`
  return String(total)
}

/**
 * 「团队」页。
 *
 * 左侧是团队列表，右侧是一条群聊：顶部是成员与共享任务，中间是消息流，
 * 底部输入框可以把任务同时派给所有人或某个成员。发送后服务端会真正启动
 * 对应成员的会话，成员的最终回复再回流到这条群聊里 —— 不是只发一条消息
 * 就结束。
 *
 * 成员本质上就是会话（`session`），所以每张成员卡片都能直接跳到它的会话
 * 看完整工具调用记录；团队页负责「调度」，会话页负责「过程」。
 */
export const TeamPage: Component<{
  directory: string
  onBack: () => void
  onOpenSession: (sessionID: string) => void
  /** 打开设置 → AI 员工，新建或调整角色后再回来组队。 */
  onManageAgents?: () => void
}> = (props) => {
  const sdk = useGlobalSDK()
  const language = useLanguage()
  const dialog = useDialog()

  const [teams, setTeams] = createSignal<TeamSummaryView[]>([])
  const [selected, setSelected] = createSignal<string | undefined>(undefined)
  const [detail, setDetail] = createSignal<TeamDetail | undefined>(undefined)
  const [agents, setAgents] = createSignal<Agent[]>([])
  const [error, setError] = createSignal("")
  const [loading, setLoading] = createSignal(false)
  const [draft, setDraft] = createSignal("")
  const [target, setTarget] = createSignal("")
  const [sending, setSending] = createSignal(false)
  const [confirmDelete, setConfirmDelete] = createSignal(false)
  const [adding, setAdding] = createSignal("")
  let feed: HTMLDivElement | undefined

  const t = (key: string, vars?: Record<string, unknown>) => language.t(key as never, vars as never)

  const loadTeams = async (select?: string) => {
    try {
      const result = await sdk.client.team.list({ directory: props.directory })
      const list = (result.data ?? []) as TeamSummaryView[]
      setTeams(list)
      setError("")
      const next = select ?? selected() ?? list[0]?.id
      setSelected(next)
      if (next) await loadDetail(next)
      else setDetail(undefined)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const loadDetail = async (teamID: string, silent = false) => {
    if (!silent) setLoading(true)
    try {
      const result = await sdk.client.team.detail({ teamID, directory: props.directory })
      if (selected() !== teamID) return
      setDetail((result.data ?? undefined) as TeamDetail | undefined)
      setError("")
    } catch (err) {
      if (!silent) setError(errorMessage(err))
    } finally {
      if (!silent) setLoading(false)
    }
  }

  const loadAgents = async () => {
    try {
      const result = await sdk.client.app.agents()
      const list = (result.data ?? []) as Agent[]
      setAgents(list.filter((agent) => !agent.hidden))
    } catch {
      setAgents([])
    }
  }

  onMount(() => {
    void loadTeams()
    void loadAgents()
    // 成员回复是后台跑完才写回来的；轮询让群聊在没有推送的情况下也能更新。
    const timer = window.setInterval(() => {
      const id = selected()
      if (id) void loadDetail(id, true)
    }, 4000)
    onCleanup(() => window.clearInterval(timer))
  })

  createEffect(() => {
    const id = selected()
    if (!id) {
      setDetail(undefined)
      return
    }
    void loadDetail(id)
    setTarget("")
  })

  createEffect(() => {
    // 新消息到达时滚到底部：群聊里最后一句通常是刚回复的那条。
    const count = detail()?.messages.length ?? 0
    if (!feed) return
    queueMicrotask(() => {
      if (feed) feed.scrollTop = feed.scrollHeight
    })
  })

  const workers = createMemo(() => (detail()?.members ?? []).filter((member) => member.role === "worker"))
  const memberName = (sessionID: string | undefined) =>
    detail()?.members.find((member) => member.sessionID === sessionID)?.name

  const call = async (work: Promise<unknown>, success?: string) => {
    try {
      await work
      if (success) showToast({ title: success })
      setError("")
    } catch (err) {
      showToast({ title: t("team.failed"), description: errorMessage(err), variant: "error" })
    }
  }

  const send = async () => {
    const team = detail()
    const content = draft().trim()
    if (!team || !content || sending()) return
    setSending(true)
    try {
      await sdk.client.team.message2.send({
        teamID: team.team.id,
        directory: props.directory,
        content,
        ...(target() ? { to: target() } : {}),
        dispatch: true,
      })
      setDraft("")
      await loadDetail(team.team.id, true)
    } catch (err) {
      showToast({ title: t("team.failed"), description: errorMessage(err), variant: "error" })
    } finally {
      setSending(false)
    }
  }

  const removeMember = async (sessionID: string) => {
    const team = detail()
    if (!team) return
    await call(
      sdk.client.team.member.remove({
        teamID: team.team.id,
        sessionID,
        directory: props.directory,
      }),
    )
    await loadDetail(team.team.id)
  }

  const addMember = async () => {
    const team = detail()
    const agent = adding()
    if (!team || !agent) return
    await call(
      sdk.client.team.member.add({ teamID: team.team.id, agent, directory: props.directory }),
      t("team.members"),
    )
    setAdding("")
    await loadDetail(team.team.id)
    await loadTeams(team.team.id)
  }

  const removeTeam = async () => {
    const team = detail()
    if (!team) return
    if (!confirmDelete()) {
      setConfirmDelete(true)
      return
    }
    await call(sdk.client.team.remove({ teamID: team.team.id, directory: props.directory }), t("team.deleted"))
    setConfirmDelete(false)
    setSelected(undefined)
    setDetail(undefined)
    await loadTeams()
  }

  const openCreate = () => {
    dialog.show(() => (
      <DialogCreateTeam
        directory={props.directory}
        agents={agents()}
        onCreated={async (teamID) => {
          dialog.close()
          await loadTeams(teamID)
        }}
      />
    ))
  }

  const usableAgents = createMemo(() => {
    const used = new Set((detail()?.members ?? []).map((member) => member.agent))
    return agents().filter((agent) => !used.has(agent.name))
  })

  return (
    <div class="flex h-full min-h-0 flex-col bg-background">
      {/* 顶行只留返回 + 标题：右上角是窗口自绘的窗控条，页面动作放在左边栏顶部。 */}
      <PageHeader onBack={() => props.onBack()} title={t("team.title")} />

      <Show when={error()}>
        <div class="shrink-0 border-b border-border px-4 py-1.5 text-ui-xs text-destructive">{error()}</div>
      </Show>

      <div class="flex min-h-0 flex-1">
        <aside class="flex w-64 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border p-2">
          {/* 页面级动作贴左边：这里是「团队」页自己的左边栏，不占顶行右侧。 */}
          <div class="flex items-center gap-1.5 px-1 pb-1">
            <Show when={props.onManageAgents}>
              <Button
                variant="ghost"
                size="small"
                class="min-w-0 flex-1 justify-start"
                onClick={() => props.onManageAgents!()}
              >
                {t("settings.kernel.manageAgents")}
              </Button>
            </Show>
            <IconButton
              icon="plus-small"
              variant="primary"
              size="small"
              title={t("team.create")}
              aria-label={t("team.create")}
              onClick={openCreate}
            />
          </div>
          <Show
            when={teams().length > 0}
            fallback={<div class="px-2 py-3 text-ui-xs leading-relaxed text-foreground-subtle">{t("team.empty")}</div>}
          >
            <For each={teams()}>
              {(team) => (
                <button
                  type="button"
                  class="flex w-full flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-hover"
                  classList={{ "bg-surface": team.id === selected() }}
                  onClick={() => setSelected(team.id)}
                >
                  <span class="w-full truncate text-ui-base text-foreground">{team.name}</span>
                  <span class="w-full truncate text-ui-xs text-foreground-subtle">
                    {t("team.memberCount", { count: team.memberCount })}
                  </span>
                </button>
              )}
            </For>
          </Show>
        </aside>

        <div class="flex min-h-0 min-w-0 flex-1 flex-col">
          <Show
            when={detail()}
            fallback={
              <div class="flex h-full items-center justify-center px-6 text-center text-ui-sm text-foreground-subtle">
                {t("team.select")}
              </div>
            }
          >
            {(team) => (
              <>
                <div class="shrink-0 border-b border-border px-4 py-3">
                  <div class="flex items-start gap-2">
                    <div class="min-w-0 flex-1">
                      <div class="truncate text-15-medium text-foreground">{team().team.name}</div>
                      <Show when={team().team.description}>
                        {(goal) => <div class="mt-0.5 text-ui-xs text-foreground-subtle">{goal()}</div>}
                      </Show>
                      <div class="mt-1 flex flex-wrap items-center gap-1.5">
                        <Tag>{t("team.memberCount", { count: team().members.length })}</Tag>
                        <Tag>
                          {t("team.usage")} {compactTokens(team().usage?.total)}
                        </Tag>
                      </div>
                    </div>
                    <Button variant="ghost" size="small" onClick={() => void removeTeam()}>
                      <Icon name="close-small" size="small" />
                      {confirmDelete() ? t("common.confirm") : t("team.delete")}
                    </Button>
                  </div>

                  <div class="mt-3 flex flex-wrap items-center gap-1.5">
                    <For each={team().members}>
                      {(member) => (
                        <div class="flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5">
                          <span
                            class="size-1.5 shrink-0 rounded-full"
                            style={{ background: agentColor(member.agent) }}
                          />
                          <button
                            type="button"
                            class="max-w-32 truncate text-ui-xs text-foreground hover:underline"
                            title={t("team.openSession")}
                            onClick={() => props.onOpenSession(member.sessionID)}
                          >
                            {member.name}
                          </button>
                          <Show when={member.role === "lead"}>
                            <span class="text-ui-xs text-foreground-subtlest">{t("team.coordinator")}</span>
                          </Show>
                          {/* Icon 不支持原生 title，用外层 span 承载提示。 */}
                          <span title={t("team.status." + member.status)} class={statusTone(member.status)}>
                            <Icon name={statusIcon(member.status)} size="small" />
                          </span>
                          <Show when={member.role === "worker"}>
                            <IconButton
                              icon="close-small"
                              size="small"
                              variant="ghost"
                              aria-label={t("team.member.remove")}
                              onClick={() => void removeMember(member.sessionID)}
                            />
                          </Show>
                        </div>
                      )}
                    </For>
                    <Show when={usableAgents().length > 0}>
                      <select
                        class="h-6 rounded-md border border-border bg-surface px-1.5 text-ui-xs text-foreground outline-none"
                        value={adding()}
                        aria-label={t("team.member.add")}
                        onChange={(event) => setAdding(event.currentTarget.value)}
                      >
                        <option value="">+ {t("team.member.add")}</option>
                        <For each={usableAgents()}>{(agent) => <option value={agent.name}>{agent.name}</option>}</For>
                      </select>
                      <Show when={adding()}>
                        <Button variant="ghost" size="small" onClick={() => void addMember()}>
                          {t("team.member.add")}
                        </Button>
                      </Show>
                    </Show>
                  </div>

                  <Show when={team().tasks.length > 0}>
                    <div class="mt-3">
                      <div class="text-ui-xs text-foreground-subtle">{t("team.tasks")}</div>
                      <div class="mt-1 flex flex-col gap-0.5">
                        <For each={team().tasks.slice(0, 8)}>
                          {(task) => (
                            <div class="flex min-w-0 items-center gap-1.5">
                              <Icon
                                name={
                                  task.status === "completed"
                                    ? "circle-check"
                                    : task.status === "in_progress"
                                      ? "lu-activity"
                                      : "lu-circle"
                                }
                                size="small"
                                class={
                                  task.status === "completed"
                                    ? "text-success"
                                    : task.status === "in_progress"
                                      ? "text-foreground"
                                      : "text-foreground-subtlest"
                                }
                              />
                              <span class="min-w-0 flex-1 truncate text-ui-xs text-foreground">{task.subject}</span>
                              <span class="shrink-0 text-ui-xs text-foreground-subtlest">
                                {memberName(task.ownerSessionID) ?? ""}
                              </span>
                            </div>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>
                </div>

                <div ref={feed} class="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                  <Show
                    when={team().messages.length > 0}
                    fallback={
                      <div class="py-6 text-center text-ui-xs text-foreground-subtle">{t("team.noMessages")}</div>
                    }
                  >
                    <div class="flex flex-col gap-3">
                      <For each={team().messages}>{(message) => <MessageRow message={message} />}</For>
                    </div>
                  </Show>
                </div>

                <div class="shrink-0 border-t border-border px-4 py-2.5">
                  <div class="flex items-end gap-2">
                    <select
                      class="h-8 shrink-0 rounded-md border border-border bg-surface px-1.5 text-ui-xs text-foreground outline-none"
                      value={target()}
                      aria-label={t("team.chat")}
                      onChange={(event) => setTarget(event.currentTarget.value)}
                    >
                      <option value="">{t("team.toEveryone")}</option>
                      <For each={team().members}>{(member) => <option value={member.name}>{member.name}</option>}</For>
                    </select>
                    <textarea
                      class="min-h-8 flex-1 resize-none rounded-md border border-border bg-surface px-2 py-1.5 text-ui-base text-foreground outline-none placeholder:text-foreground-subtle focus:border-border-focus"
                      rows={1}
                      value={draft()}
                      placeholder={t("team.placeholder")}
                      onInput={(event) => setDraft(event.currentTarget.value)}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" || event.shiftKey) return
                        event.preventDefault()
                        void send()
                      }}
                    />
                    <Button
                      variant="primary"
                      size="small"
                      disabled={sending() || !draft().trim()}
                      onClick={() => void send()}
                    >
                      {sending() ? t("team.sending") : t("team.send")}
                    </Button>
                  </div>
                  <div class="mt-1 text-ui-xs text-foreground-subtlest">{t("team.replyHint")}</div>
                </div>
              </>
            )}
          </Show>
        </div>
      </div>
    </div>
  )
}

function MessageRow(props: { message: TeamMessageView }) {
  const language = useLanguage()
  const now = Date.now()
  const name = () => props.message.fromName ?? props.message.from.slice(-8)
  return (
    <div class="flex flex-col gap-0.5">
      <div class="flex items-baseline gap-1.5">
        <span class="text-ui-xs font-medium text-foreground">{name()}</span>
        <span class="text-ui-xs text-foreground-subtlest">
          {formatRelativeTime(Number(props.message.createdAt), now, (key, vars) =>
            language.t(key as never, vars as never),
          )}
        </span>
        <Show when={props.message.toName}>
          {(to) => <span class="text-ui-xs text-foreground-subtlest">→ {to()}</span>}
        </Show>
      </div>
      <div class="whitespace-pre-wrap break-words text-ui-base leading-relaxed text-foreground">
        {props.message.content}
      </div>
    </div>
  )
}

/**
 * 新建团队：起个名字、挑协调者、勾选成员。
 *
 * 只列非隐藏角色；协调者默认用 build。创建成功后服务端已经为每个成员建好
 * 会话，页面直接切到新团队。
 */
function DialogCreateTeam(props: {
  directory: string
  agents: Agent[]
  onCreated: (teamID: string) => void | Promise<void>
}) {
  const dialog = useDialog()
  const language = useLanguage()
  const sdk = useGlobalSDK()
  const [name, setName] = createSignal("")
  const [goal, setGoal] = createSignal("")
  const [lead, setLead] = createSignal("build")
  const [search, setSearch] = createSignal("")
  const [picked, setPicked] = createSignal<string[]>([])
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal("")

  const t = (key: string, vars?: Record<string, unknown>) => language.t(key as never, vars as never)

  const candidates = createMemo(() => {
    const query = search().trim().toLowerCase()
    // 成员不限于 subagent：build 这类 primary 角色同样可以作为团队里的执行者。
    return props.agents.filter((agent) => !query || agent.name.toLowerCase().includes(query)).slice(0, 60)
  })

  const toggle = (agent: string) => {
    setPicked((current) => (current.includes(agent) ? current.filter((item) => item !== agent) : [...current, agent]))
  }

  const submit = async () => {
    if (!name().trim()) {
      setError(t("team.name"))
      return
    }
    if (picked().length === 0) {
      setError(t("team.emptyMembers"))
      return
    }
    setBusy(true)
    try {
      const result = await sdk.client.team.create({
        directory: props.directory,
        name: name().trim(),
        description: goal().trim() || undefined,
        lead: lead().trim() || undefined,
        members: picked().map((agent) => ({ agent })),
      })
      await props.onCreated((result.data as TeamDetail).team.id)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title={t("team.createTitle")}>
      <div class="flex max-h-[70vh] flex-col gap-4 overflow-y-auto p-5">
        <div class="text-12-regular leading-relaxed text-foreground-subtle">{t("team.createHint")}</div>
        <div class="flex flex-col gap-2">
          <label class="text-13-medium text-foreground">{t("team.name")}</label>
          <input
            class="flex h-9 w-full rounded-[8px] border border-border bg-surface px-3 text-14-regular text-foreground outline-none focus:border-primary"
            value={name()}
            placeholder={t("team.namePlaceholder")}
            autofocus
            onInput={(event) => setName(event.currentTarget.value)}
          />
        </div>
        <div class="flex flex-col gap-2">
          <label class="text-13-medium text-foreground">{t("team.goal")}</label>
          <input
            class="flex h-9 w-full rounded-[8px] border border-border bg-surface px-3 text-14-regular text-foreground outline-none focus:border-primary"
            value={goal()}
            placeholder={t("team.goalPlaceholder")}
            onInput={(event) => setGoal(event.currentTarget.value)}
          />
        </div>
        <div class="flex flex-col gap-2">
          <label class="text-13-medium text-foreground">{t("team.lead")}</label>
          <select
            class="h-9 w-full rounded-[8px] border border-border bg-surface px-2 text-14-regular text-foreground outline-none"
            value={lead()}
            onChange={(event) => setLead(event.currentTarget.value)}
          >
            <For each={props.agents}>{(agent) => <option value={agent.name}>{agent.name}</option>}</For>
          </select>
        </div>
        <div class="flex flex-col gap-2">
          <div class="flex items-baseline justify-between">
            <label class="text-13-medium text-foreground">{t("team.members")}</label>
            <span class="text-ui-xs text-foreground-subtle">{picked().length}</span>
          </div>
          <input
            class="flex h-8 w-full rounded-[8px] border border-border bg-surface px-2.5 text-13-regular text-foreground outline-none focus:border-primary"
            value={search()}
            placeholder={t("team.member.search")}
            onInput={(event) => setSearch(event.currentTarget.value)}
          />
          <div class="grid max-h-56 grid-cols-2 gap-1 overflow-y-auto">
            <For each={candidates()}>
              {(agent) => (
                <button
                  type="button"
                  class="flex min-w-0 items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors"
                  classList={{
                    "border-primary bg-surface": picked().includes(agent.name),
                    "border-border hover:bg-hover": !picked().includes(agent.name),
                  }}
                  onClick={() => toggle(agent.name)}
                >
                  <span class="size-1.5 shrink-0 rounded-full" style={{ background: agentColor(agent.name) }} />
                  <span class="min-w-0 flex-1 truncate text-ui-base text-foreground">{agent.name}</span>
                  <Show when={picked().includes(agent.name)}>
                    <Icon name="check-small" size="small" class="shrink-0 text-foreground" />
                  </Show>
                </button>
              )}
            </For>
          </div>
        </div>
        <Show when={error()}>
          <div class="text-12-regular text-destructive">{error()}</div>
        </Show>
        <div class="flex items-center justify-end gap-3 pt-1">
          <Button variant="secondary" onClick={() => dialog.close()}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" disabled={busy()} onClick={() => void submit()}>
            {t("team.createAction")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
