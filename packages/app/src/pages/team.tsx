import type {
  Agent,
  TeamDetail,
  TeamEmployeeView,
  TeamMemberView,
  TeamMessageView,
  TeamSummaryView,
} from "@novaway/sdk/v2"
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
  // 员工库（§3.1 / §4.5）：模板引用的是「人」，所以人要先能建、能归档。
  const [employees, setEmployees] = createSignal<TeamEmployeeView[]>([])
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
    void loadEmployees()
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

  const loadEmployees = async () => {
    try {
      const result = await sdk.client.employee.list({ directory: props.directory })
      setEmployees((result.data ?? []) as TeamEmployeeView[])
    } catch {
      // 员工库只是附加面板：读失败不盖掉团队本身的错误提示。
      setEmployees([])
    }
  }

  const openEmployees = () => {
    dialog.show(() => (
      <DialogEmployees
        directory={props.directory}
        agents={agents()}
        onChanged={() => {
          void loadEmployees()
        }}
      />
    ))
  }

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

  const toggleAuto = async () => {
    const team = detail()
    if (!team) return
    const next = !team.team.autoEligible
    await call(
      sdk.client.team.update({ teamID: team.team.id, directory: props.directory, autoEligible: next }),
      next ? t("team.auto.enabled") : t("team.auto.disabled"),
    )
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
            <Button
              variant="ghost"
              size="small"
              class="min-w-0 shrink justify-start"
              title={t("team.employees.hint")}
              onClick={openEmployees}
            >
              {t("team.employees.open", { count: employees().filter((item) => !item.archived).length })}
            </Button>
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
                        {/* Auto 是「可以被自动挑中」，不是「自动执行」：打开后模型能选它，
                            但每次派发仍要在运行页批准。所以这里用可点的标签而不是开关。 */}
                        <button
                          type="button"
                          class="rounded border border-border px-1.5 py-px text-ui-xs transition-colors hover:bg-hover"
                          classList={{ "text-icon-blue": team().team.autoEligible }}
                          onClick={() => void toggleAuto()}
                          title={t("team.auto.hint")}
                        >
                          {team().team.autoEligible ? t("team.auto.on") : t("team.auto.off")}
                        </button>
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
/**
 * 员工库（§3.1 / §4.5）。
 *
 * 「人」是模板引用的一层：没有它，模板只能引用播种出来的五个内置员工。
 * 归档的语义写清楚在界面上 —— 不在新团队里出现，但已经建好的模板与已跑的运行不受影响。
 */
function DialogEmployees(props: { directory: string; agents: Agent[]; onChanged: () => void }) {
  const dialog = useDialog()
  const language = useLanguage()
  const sdk = useGlobalSDK()
  const t = (key: string, vars?: Record<string, unknown>) => language.t(key as never, vars as never)

  const [list, setList] = createSignal<TeamEmployeeView[]>([])
  const [name, setName] = createSignal("")
  const [job, setJob] = createSignal(props.agents[0]?.name ?? "build")
  const [duty, setDuty] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal("")
  // 编辑中的行：不弹第二层对话框，展开在原行下面，改完就能看到同一份列表。
  const [editing, setEditing] = createSignal<string>()
  const [draft, setDraft] = createSignal({ name: "", job: "", model: "", skills: "", prompt: "", tier: "" })

  const load = async () => {
    try {
      const result = await sdk.client.employee.list({ directory: props.directory })
      setList((result.data ?? []) as TeamEmployeeView[])
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  onMount(() => {
    void load()
  })

  const create = async () => {
    if (!name().trim() || !job().trim()) {
      setError(t("team.employees.nameRequired"))
      return
    }
    setBusy(true)
    try {
      await sdk.client.employee.create({
        directory: props.directory,
        name: name().trim(),
        job: job().trim(),
        // 职责/提示词是可选的覆盖项：写在这里的东西会进这个人的提示词。
        prompt: duty().trim() || undefined,
      })
      setName("")
      setDuty("")
      setError("")
      await load()
      props.onChanged()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const startEdit = (employee: TeamEmployeeView) => {
    setEditing(employee.id)
    setDraft({
      name: employee.name,
      job: employee.job,
      model: employee.model ?? "",
      // 技能在库里是数组，界面上用逗号串更省事；保存时再拆回去。
      skills: (employee.skills ?? []).join(", "),
      prompt: employee.prompt ?? "",
      tier: employee.tier ?? "",
    })
  }

  const save = async () => {
    const employeeID = editing()
    if (!employeeID) return
    const value = draft()
    if (!value.name.trim() || !value.job.trim()) {
      setError(t("team.employees.nameRequired"))
      return
    }
    setBusy(true)
    try {
      await sdk.client.employee.update({
        directory: props.directory,
        employeeID,
        name: value.name.trim(),
        job: value.job.trim(),
        // 留空 = 清掉这条覆盖。空串与空数组就是这个意思，不需要额外协议。
        model: value.model.trim(),
        skills: value.skills
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        prompt: value.prompt.trim(),
        tier: value.tier.trim(),
      })
      setEditing(undefined)
      setError("")
      await load()
      props.onChanged()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const toggleArchived = async (employee: TeamEmployeeView) => {
    setBusy(true)
    try {
      await sdk.client.employee.update({
        directory: props.directory,
        employeeID: employee.id,
        archived: !employee.archived,
      })
      // 归档要让模板列表也跟着刷新：名册里会显示这个人的状态。
      setError("")
      await load()
      props.onChanged()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title={t("team.employees.title")}>
      <div class="flex max-h-[70vh] flex-col gap-4 overflow-y-auto p-5">
        <div class="text-12-regular leading-relaxed text-foreground-subtle">{t("team.employees.hint")}</div>
        <Show when={error()}>
          <div class="text-12-regular text-destructive">{error()}</div>
        </Show>

        <div class="flex flex-col gap-2">
          <For each={list()}>
            {(employee) => (
              <div class="rounded-lg border border-border">
                <div class="flex items-center gap-2 px-3 py-2">
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1.5">
                      <span
                        classList={{ "truncate text-14-regular": true, "text-foreground-subtlest": employee.archived }}
                      >
                        {employee.name}
                      </span>
                      <Tag>{employee.job}</Tag>
                      <Show when={employee.tier}>{(tier) => <Tag>{tier()}</Tag>}</Show>
                      <Show when={employee.archived}>
                        <Tag class="text-foreground-subtlest">{t("team.employees.archived")}</Tag>
                      </Show>
                    </div>
                    <Show when={employee.prompt}>
                      {(text) => <div class="mt-0.5 truncate text-ui-xs text-foreground-subtle">{text()}</div>}
                    </Show>
                  </div>
                  <Button variant="ghost" size="small" disabled={busy()} onClick={() => startEdit(employee)}>
                    {t("team.employees.edit")}
                  </Button>
                  <Button variant="ghost" size="small" disabled={busy()} onClick={() => void toggleArchived(employee)}>
                    {employee.archived ? t("team.employees.restore") : t("team.employees.archive")}
                  </Button>
                </div>
                <Show when={editing() === employee.id}>
                  <div class="flex flex-col gap-2 border-t border-border px-3 py-2">
                    <div class="flex gap-2">
                      <input
                        class="flex h-9 min-w-0 flex-1 rounded-[8px] border border-border bg-surface px-3 text-14-regular text-foreground outline-none focus:border-primary"
                        value={draft().name}
                        placeholder={t("team.employees.namePlaceholder")}
                        onInput={(event) => setDraft({ ...draft(), name: event.currentTarget.value })}
                      />
                      <select
                        class="h-9 shrink-0 rounded-[8px] border border-border bg-surface px-2 text-14-regular text-foreground outline-none"
                        value={draft().job}
                        onChange={(event) => setDraft({ ...draft(), job: event.currentTarget.value })}
                      >
                        <For each={props.agents}>{(agent) => <option value={agent.name}>{agent.name}</option>}</For>
                      </select>
                      <select
                        class="h-9 shrink-0 rounded-[8px] border border-border bg-surface px-2 text-14-regular text-foreground outline-none"
                        value={draft().tier}
                        onChange={(event) => setDraft({ ...draft(), tier: event.currentTarget.value })}
                      >
                        <option value="">{t("team.employees.tier.none")}</option>
                        <option value="fast">{t("team.employees.tier.fast")}</option>
                        <option value="standard">{t("team.employees.tier.standard")}</option>
                        <option value="deep">{t("team.employees.tier.deep")}</option>
                      </select>
                    </div>
                    <input
                      class="flex h-9 w-full rounded-[8px] border border-border bg-surface px-3 text-14-regular text-foreground outline-none focus:border-primary"
                      value={draft().model}
                      placeholder={t("team.employees.modelPlaceholder")}
                      onInput={(event) => setDraft({ ...draft(), model: event.currentTarget.value })}
                    />
                    <input
                      class="flex h-9 w-full rounded-[8px] border border-border bg-surface px-3 text-14-regular text-foreground outline-none focus:border-primary"
                      value={draft().skills}
                      placeholder={t("team.employees.skillsPlaceholder")}
                      onInput={(event) => setDraft({ ...draft(), skills: event.currentTarget.value })}
                    />
                    <textarea
                      class="min-h-20 w-full resize-y rounded-[8px] border border-border bg-surface px-3 py-2 text-14-regular text-foreground outline-none focus:border-primary"
                      value={draft().prompt}
                      placeholder={t("team.employees.dutyPlaceholder")}
                      onInput={(event) => setDraft({ ...draft(), prompt: event.currentTarget.value })}
                    />
                    <div class="flex items-center justify-end gap-1.5">
                      <Button variant="ghost" size="small" onClick={() => setEditing(undefined)}>
                        {t("common.cancel")}
                      </Button>
                      <Button variant="primary" size="small" disabled={busy()} onClick={() => void save()}>
                        {t("common.save")}
                      </Button>
                    </div>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </div>

        <div class="flex flex-col gap-2 border-t border-border pt-3">
          <label class="text-13-medium text-foreground">{t("team.employees.add")}</label>
          <div class="flex gap-2">
            <input
              class="flex h-9 min-w-0 flex-1 rounded-[8px] border border-border bg-surface px-3 text-14-regular text-foreground outline-none focus:border-primary"
              value={name()}
              placeholder={t("team.employees.namePlaceholder")}
              onInput={(event) => setName(event.currentTarget.value)}
            />
            <select
              class="h-9 shrink-0 rounded-[8px] border border-border bg-surface px-2 text-14-regular text-foreground outline-none"
              value={job()}
              onChange={(event) => setJob(event.currentTarget.value)}
            >
              <For each={props.agents}>{(agent) => <option value={agent.name}>{agent.name}</option>}</For>
            </select>
          </div>
          <input
            class="flex h-9 w-full rounded-[8px] border border-border bg-surface px-3 text-14-regular text-foreground outline-none focus:border-primary"
            value={duty()}
            placeholder={t("team.employees.dutyPlaceholder")}
            onInput={(event) => setDuty(event.currentTarget.value)}
          />
          <div class="flex items-center justify-end gap-1.5">
            <Button variant="ghost" size="small" onClick={() => dialog.close()}>
              {t("common.close")}
            </Button>
            <Button variant="primary" size="small" disabled={busy()} onClick={() => void create()}>
              {t("team.employees.addAction")}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  )
}

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
