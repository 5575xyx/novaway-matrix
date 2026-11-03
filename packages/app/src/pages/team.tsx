import type {
  Agent,
  RunDetail,
  RunView,
  TeamDetail,
  TeamEmployeeRecordView,
  TeamEmployeeUsageView,
  TeamEmployeeView,
  TeamMemberView,
  TeamMessageView,
  TeamProfileDetail,
  TeamProfileView,
  TeamSummaryView,
} from "@novaway/sdk/v2"
import { Button } from "@novaway/ui/button"
import { Icon } from "@novaway/ui/icon"
import { IconButton } from "@novaway/ui/icon-button"
import { Tag } from "@novaway/ui/tag"
import { Switch } from "@novaway/ui/switch"
import { showToast } from "@novaway/ui/toast"
import { Dialog } from "@novaway/ui/dialog"
import { useDialog } from "@novaway/ui/context/dialog"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type Component } from "solid-js"
import { PageHeader } from "@/components/page-header"
import { TeamDrilldown } from "@/components/team-drilldown"
import { buildDrill, type DrillAcceptance } from "@/components/team-drilldown.logic"
import { TeamGraph } from "@/components/team-graph"
import { RunConsole } from "@/components/run-console"
import type { GraphLaneInput } from "@/components/team-graph.layout"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { agentDisplayName } from "@/utils/agent"
import { agentAvatar } from "@/utils/agent-avatar"
import { formatRelativeTime } from "@/utils/relative-time"

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** 团队头像用名字前两个字：不引入额外图片资源，也足够在列表里区分。 */
const initials = (name: string) => name.trim().slice(0, 2) || "队"

/**
 * AI 员工的展示名。
 *
 * 内置员工的 `options.displayName` 本来就是中文（agency / office 系列都带），
 * 自定义员工则读 `display_name`；两样都没有时才退回本地词表翻译。
 * 团队页所有露出角色名的地方都走它，别再把 `corporate-training-designer`
 * 这种 id 直接摆到用户面前。
 */
const agentLabel = (name: string, agents: readonly Agent[]) =>
  agentDisplayName(name, agents.find((agent) => agent.name === name)?.options)

/**
 * 团队成员行的名字。
 *
 * 名册里的 `name` 可能是员工自定义的名字，也可能只是 agent id 的回填
 * （建队时没给名字）或 `team-lead` 这种内部占位；后两种一律按展示名说话。
 */
const memberLabel = (member: TeamMemberView, agents: readonly Agent[]) =>
  member.role === "lead" || member.name === member.agent ? agentLabel(member.agent, agents) : member.name

/** 头像与展示名同源：员工配置里挑过头像就按挑的生成。 */
const agentAvatarOf = (name: string, agents: readonly Agent[]) =>
  agentAvatar(name, agents.find((agent) => agent.name === name)?.options)

/** 内置员工带一个中文分类标签（营销 / 工程 / 设计…），列表里当副标题用。 */
const agentCategory = (agent: Agent) => {
  const value = agent.options?.category
  return typeof value === "string" && value.trim() ? value : undefined
}

const statusIcon = (status: TeamMemberView["status"]) =>
  status === "active" ? "lu-activity" : status === "archived" ? "circle-ban-sign" : "lu-circle"

const statusTone = (status: TeamMemberView["status"]) =>
  status === "active" ? "text-success" : status === "archived" ? "text-foreground-subtlest" : "text-foreground-subtle"

/**
 * 运行状态在列表里只用一个图标 + 属性色表达。
 *
 * `partial` / `needs_review` 用警示色而不是成功色：它们都还没到「已验证交付」，
 * 用绿色会让人以为已经可以合并了（§10.2）。
 */
/** 工作线列表里的状态点：颜色回答「要不要点开它」，不再多摆一排标签。 */
const runDot = (run: { state: string }) => ({
  "bg-success": run.state === "done",
  "bg-warning": run.state === "partial" || run.state === "needs_review" || run.state === "awaiting_approval",
  "bg-primary": run.state === "running" || run.state === "blocked" || run.state === "paused",
  "bg-border":
    run.state === "failed" || run.state === "cancelled" || run.state === "exceeded" || run.state === "planning",
})

const runStateTone = (state: string) =>
  state === "done"
    ? "text-success"
    : state === "partial" || state === "needs_review" || state === "awaiting_approval"
      ? "text-warning"
      : state === "failed" || state === "exceeded" || state === "cancelled"
        ? "text-foreground-subtlest"
        : "text-foreground-subtle"

/** 用量字段在 JSON 里可能是字符串化的 Infinity/NaN，统一先转成有限数字。 */
const numeric = (value: number | string | undefined) => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0
  return Number.isFinite(parsed) ? parsed : 0
}

function compactTokens(value: number | string | undefined) {
  const total = numeric(value)
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
  // 团队模板（§4.1）：编制是可复用的资产，团队页要能建、能改、能删。
  const [profiles, setProfiles] = createSignal<TeamProfileView[]>([])
  // 总控（§4.1）：项目级一档。关闭后团队只作组织管理，不可被调用。
  const [orchestrationOn, setOrchestrationOn] = createSignal(true)
  const [teamConcurrency, setTeamConcurrency] = createSignal(3)
  // 这支团队的运行历史（§4.1）：按团队筛，不拉全量再自己比对。
  const [teamRuns, setTeamRuns] = createSignal<RunView[]>([])
  // 默认模式（§4.5）：只决定新会话选择器的初始值，不改已有会话。
  const [teamDefaultMode, setTeamDefaultMode] = createSignal<"off" | "auto" | "selected">("off")
  const [teamDefaultIDs, setTeamDefaultIDs] = createSignal<string[]>([])
  const [controlBusy, setControlBusy] = createSignal(false)
  // 运行设置默认收起：总控开关在，并发与默认模式收进「设置」，不占左栏。
  const [showControl, setShowControl] = createSignal(false)
  // 工作线视图：默认看图，聊天退到第二个页签 —— 团队页首先回答「它干成了什么」。
  const [view, setView] = createSignal<"lines" | "chat">("lines")
  // 选中的工作线（一次运行）与它的详情：图画的就是这一次。
  const [lineID, setLineID] = createSignal<string | undefined>(undefined)
  const [lineDetail, setLineDetail] = createSignal<RunDetail | undefined>(undefined)
  // 图里点中的节点：点谁看谁，换一条工作线就清掉，不让上一条的详情跟着走。
  const [selectedNode, setSelectedNode] = createSignal<{ laneID: string; nodeID: string } | undefined>(undefined)
  // 新建运行的表单展开状态：工作线本身就是运行，新建入口留在这个页面里。
  const [runComposing, setRunComposing] = createSignal(false)
  // 每条工作线的实际参与人：只为列表里看得见的那几条拉一次，不跟着轮询刷。
  const [linePeople, setLinePeople] = createSignal<Record<string, string[]>>({})
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
    void loadProfiles()
    void loadControl()
    // 成员回复是后台跑完才写回来的；轮询让群聊在没有推送的情况下也能更新。
    const timer = window.setInterval(() => {
      const id = selected()
      if (!id) return
      void loadDetail(id, true)
      // 运行是后台推进的，状态会变；不跟着刷的话「最近运行」会一直停在打开那一刻。
      void loadTeamRuns(id)
    }, 4000)
    onCleanup(() => window.clearInterval(timer))
  })

  // 换一条工作线时先清掉上一条的详情：图不能停在上一条线上，等控制台拉回新的。
  createEffect(() => {
    lineID()
    setLineDetail(undefined)
  })

  createEffect(() => {
    const id = selected()
    if (!id) {
      setDetail(undefined)
      setTeamRuns([])
      return
    }
    void loadDetail(id)
    void loadTeamRuns(id)
    setTarget("")
    // 换团队就是换一组工作线：上一条的图和参与人都不再成立。
    setLineID(undefined)
    setLineDetail(undefined)
    primedLines.clear()
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
  /** 工作线图的数据：一次运行的每支团队一条泳道。 */
  const lineTeams = createMemo<GraphLaneInput[]>(() =>
    (lineDetail()?.teams ?? []).map((team) => ({
      id: team.id,
      name:
        profiles().find((profile) => profile.id === team.profileID)?.name ??
        t("run.plan.teamFallback", { id: team.id }),
      phase: team.phase,
      // 返工轮次要能在图上看出来；没有轮次记录时按第 1 轮画，不编一个更大的数。
      round: Math.max(1, numeric(team.roundCaptain)),
      members: (team.members ?? []).map((member) => ({
        id: member.id,
        name: member.name,
        job: member.job,
        role: member.role,
      })),
      tasks: (team.tasks ?? []).map((task) => ({
        id: task.id,
        subject: task.subject,
        status: task.status,
        ...(task.updatedAt ? { updatedAt: numeric(task.updatedAt) } : {}),
        ...(task.owner ? { owner: task.owner } : {}),
        ...(task.ownerName ? { ownerName: task.ownerName } : {}),
        ...(task.ownerJob ? { ownerJob: task.ownerJob } : {}),
        ...(task.ownerRole ? { ownerRole: task.ownerRole } : {}),
      })),
    })),
  )
  const lineRun = createMemo(() => teamRuns().find((run) => run.id === lineID()))

  /**
   * 点节点之后的详情：任务 → 认领人，成员 → 他领的所有活，队长 → 整条泳道。
   *
   * 验收结论按最近一次验证算（`summary.lines` 已经处理了快照失效与「验过但不算」），
   * 这里不重新判断，只把结论贴到对应的任务上。
   */
  const drill = createMemo(() => {
    const current = selectedNode()
    if (!current) return undefined
    const lane = lineTeams().find((team) => team.id === current.laneID)
    if (!lane) return undefined
    const detail = lineDetail()
    const outcomes = new Map((detail?.summary.lines ?? []).map((line) => [line.acceptanceID, line.outcome]))
    const acceptances = (detail?.acceptances ?? []).map((acceptance): DrillAcceptance => {
      const outcome = outcomes.get(acceptance.id)
      return {
        id: acceptance.id,
        ...(acceptance.taskID ? { taskID: acceptance.taskID } : {}),
        text: acceptance.text,
        kind: acceptance.kind,
        ...(outcome ? { outcome } : {}),
      }
    })
    const view = buildDrill({ nodeID: current.nodeID, lane, acceptances })
    return view ? { view, laneName: lane.name, round: lane.round } : undefined
  })

  // 换一条工作线：图换了，选中的节点也不再成立。
  createEffect(() => {
    lineID()
    setSelectedNode(undefined)
  })

  /**
   * 最近运行。
   *
   * 读失败就清空而不是保留上一次的列表：换了一支团队却还显示上一支的运行，
   * 比什么都不显示更容易误导。
   */
  const loadTeamRuns = async (teamID: string) => {
    try {
      const result = await sdk.client.run.list({ directory: props.directory, teamID })
      const list = (result.data ?? []) as RunView[]
      setTeamRuns(list)
      primeLinePeople(list)
      // 选中的那条不在列表里（换了团队 / 被删）时退回最新一条：图不能停在上一条线上。
      const next = list.find((run) => run.id === lineID())?.id ?? list[0]?.id
      setLineID(next)
    } catch {
      setTeamRuns([])
    }
  }
  /**
   * 一条工作线的「实际参与人」。
   *
   * 只算真正认领过任务的人：名册里有他没干活，不该算进这个数字。
   * 未认领的任务不算人；任务还没派下去时是空数组，界面说「还没人认领」。
   */
  const participantsOf = (detail: RunDetail) => [
    ...new Set(
      detail.teams.flatMap((team) => (team.tasks ?? []).flatMap((task) => (task.ownerName ? [task.ownerName] : []))),
    ),
  ]

  /**
   * 选中工作线的详情。
   *
   * 详情由嵌在下面的运行控制台拉取并回传（`RunConsole.onDetail`）：同一个请求画图、
   * 画验收、画参与人，团队页不再自己再拉一遍。只有「这次运行」的详情才收下，
   * 避免切换过程中把上一条的结果贴到新的线上。
   */
  const applyDetail = (detail: RunDetail | undefined) => {
    // 切线的瞬间还拿着上一条的详情：只收当前选中那条，别把旧的画到新的线上。
    if (detail && lineID() && detail.run.id !== lineID()) return
    setLineDetail(detail)
    if (!detail) return
    const id = detail.run.id
    setLinePeople((current) => (current[id] ? current : { ...current, [id]: participantsOf(detail) }))
  }

  /** 已经拉过参与人的工作线：列表每 4 秒刷新一次，不能每轮都把详情重拉一遍。 */
  const primedLines = new Set<string>()
  const primeLinePeople = (runs: readonly RunView[]) => {
    for (const run of runs.slice(0, 5)) {
      if (primedLines.has(run.id)) continue
      primedLines.add(run.id)
      void sdk.client.run.detail({ runID: run.id, directory: props.directory }).then((result) => {
        const data = result.data
        if (data) setLinePeople((current) => ({ ...current, [run.id]: participantsOf(data) }))
      })
    }
  }

  const loadEmployees = async () => {
    try {
      const result = await sdk.client.employee.list({ directory: props.directory })
      setEmployees((result.data ?? []) as TeamEmployeeView[])
    } catch {
      // 员工库只是附加面板：读失败不盖掉团队本身的错误提示。
      setEmployees([])
    }
  }

  const loadProfiles = async () => {
    try {
      const result = await sdk.client.profile.list({ directory: props.directory })
      setProfiles((result.data ?? []) as TeamProfileView[])
    } catch {
      // 模板只是附加面板：读失败不盖掉团队本身的错误提示。
      setProfiles([])
    }
  }

  const loadControl = async () => {
    try {
      const result = await sdk.client.config.get({ directory: props.directory })
      const experimental = result.data?.experimental
      // 缺省即开：只有显式 false 才算关闭，与 TeamSwitch.enabled 的口径一致。
      setOrchestrationOn(experimental?.team_orchestration !== false)
      setTeamConcurrency(experimental?.team_concurrency ?? 3)
      setTeamDefaultMode(experimental?.team_default_mode ?? "off")
      setTeamDefaultIDs([...(experimental?.team_default_ids ?? [])])
    } catch {
      // 读不到就按默认值显示；不要因为一次读取失败把开关画成「关闭」。
    }
  }

  const updateControl = async (patch: {
    team_orchestration?: boolean
    team_concurrency?: number
    team_default_mode?: "off" | "auto" | "selected"
    team_default_ids?: string[]
  }) => {
    setControlBusy(true)
    try {
      await sdk.client.config.update({ directory: props.directory, config: { experimental: patch } })
      setError("")
      await loadControl()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setControlBusy(false)
    }
  }

  /** 默认名单里点一个团队：切到 `selected` 是顺带的，省一次下拉。 */
  const toggleDefaultTeam = (teamID: string) => {
    const next = teamDefaultIDs().includes(teamID)
      ? teamDefaultIDs().filter((id) => id !== teamID)
      : [...teamDefaultIDs(), teamID]
    setTeamDefaultIDs(next)
    void updateControl({ team_default_mode: next.length ? "selected" : "off", team_default_ids: next })
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

  const openProfiles = () => {
    dialog.show(() => (
      <DialogProfiles
        directory={props.directory}
        agents={agents()}
        employees={employees()}
        onChanged={() => {
          void loadProfiles()
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
          {/* 新建运行也在这一列：工作线就是运行，入口跟着页面自己的左栏走。 */}
          <div class="flex items-center gap-1.5 px-1 pb-1">
            <Button
              variant="secondary"
              size="small"
              class="min-w-0 flex-1 justify-start"
              title={t("run.action.newHint")}
              onClick={() => {
                setView("lines")
                setRunComposing(true)
              }}
            >
              <Icon name="plus" size="small" />
              {t("run.action.new")}
            </Button>
          </div>
          {/* 模板（§4.1）：建好的编制可以反复用；不在主行上挤，单独一行留在左栏。 */}
          <div class="flex items-center gap-1.5 px-1 pb-1">
            <Button
              variant="ghost"
              size="small"
              class="min-w-0 flex-1 justify-start"
              title={t("team.profiles.hint")}
              onClick={openProfiles}
            >
              {t("team.profiles.open", { count: profiles().length })}
            </Button>
          </div>
          {/* 总控（§4.1）：项目级一档，写回 novaway.json；关闭不影响已有计划与正在跑的运行。 */}
          <div class="mx-1 mb-1 flex flex-col gap-2 rounded-lg border border-border px-2 py-2">
            <div class="flex items-center justify-between gap-2">
              <span class="text-ui-xs text-foreground-subtle">{t("team.control.title")}</span>
              <Switch
                checked={orchestrationOn()}
                disabled={controlBusy()}
                aria-label={t("team.control.title")}
                onChange={(value) => void updateControl({ team_orchestration: value })}
              />
            </div>
            <button
              type="button"
              class="flex items-center gap-1 text-left text-ui-xs text-foreground-subtle transition-colors hover:text-foreground"
              onClick={() => setShowControl((open) => !open)}
            >
              <Icon name={showControl() ? "chevron-down" : "chevron-right"} size="small" />
              {showControl() ? t("team.control.less") : t("team.control.more")}
            </button>
            <Show when={showControl()}>
              <div class="flex items-center justify-between gap-2">
                <span class="text-ui-xs text-foreground-subtle">{t("team.control.concurrency")}</span>
                <select
                  class="h-7 rounded-[6px] border border-border bg-surface px-1 text-ui-xs text-foreground outline-none disabled:opacity-50"
                  value={String(teamConcurrency())}
                  disabled={controlBusy()}
                  onChange={(event) => void updateControl({ team_concurrency: Number(event.currentTarget.value) })}
                >
                  <For each={[1, 2, 3, 4, 5]}>{(count) => <option value={String(count)}>{count}</option>}</For>
                </select>
              </div>
              <div class="flex items-center justify-between gap-2">
                <span class="text-ui-xs text-foreground-subtle">{t("team.control.defaultMode")}</span>
                <select
                  class="h-7 rounded-[6px] border border-border bg-surface px-1 text-ui-xs text-foreground outline-none disabled:opacity-50"
                  value={teamDefaultMode()}
                  disabled={controlBusy() || !orchestrationOn()}
                  onChange={(event) =>
                    void updateControl({ team_default_mode: event.currentTarget.value as "off" | "auto" | "selected" })
                  }
                >
                  <option value="off">{t("team.control.default.off")}</option>
                  <option value="auto">{t("team.control.default.auto")}</option>
                  <option value="selected">{t("team.control.default.selected")}</option>
                </select>
              </div>
              <Show when={orchestrationOn() && teamDefaultMode() === "selected"}>
                <div class="flex flex-col gap-1">
                  <Show
                    when={teams().length > 0}
                    fallback={<div class="text-ui-xs text-foreground-subtlest">{t("team.control.default.empty")}</div>}
                  >
                    <For each={teams()}>
                      {(team) => (
                        <button
                          type="button"
                          class="flex items-center justify-between gap-2 rounded-[6px] px-1.5 py-1 text-left text-ui-xs transition-colors hover:bg-hover"
                          onClick={() => toggleDefaultTeam(team.id)}
                        >
                          <span class="min-w-0 truncate text-foreground-subtle">{team.name}</span>
                          <Icon
                            name={teamDefaultIDs().includes(team.id) ? "circle-check" : "lu-circle"}
                            classList={{
                              "shrink-0 text-12": true,
                              "text-primary": teamDefaultIDs().includes(team.id),
                              "text-foreground-subtlest": !teamDefaultIDs().includes(team.id),
                            }}
                          />
                        </button>
                      )}
                    </For>
                  </Show>
                </div>
              </Show>
            </Show>
            <div class="text-ui-xs leading-relaxed text-foreground-subtlest">
              {orchestrationOn() ? t("team.control.on") : t("team.control.off")}
            </div>
          </div>
          <Show
            when={teams().length > 0}
            fallback={<div class="px-2 py-3 text-ui-xs leading-relaxed text-foreground-subtle">{t("team.empty")}</div>}
          >
            {/*
              左栏按群聊的方式排：头像、队名、一行副标题（人数 · 最近活动）。
              点一个进一个，扫描顺序和用户找「那支队」的方式一致。
            */}
            <For each={teams()}>
              {(team) => (
                <button
                  type="button"
                  class="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-hover"
                  classList={{ "bg-surface": team.id === selected() }}
                  onClick={() => setSelected(team.id)}
                >
                  <span class="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-ui-xs text-primary">
                    {initials(team.name)}
                  </span>
                  <span class="flex min-w-0 flex-1 flex-col">
                    <span class="truncate text-ui-base text-foreground">{team.name}</span>
                    <span class="truncate text-ui-xs text-foreground-subtle">
                      {t("team.memberCount", { count: team.memberCount })}
                      {" · "}
                      {formatRelativeTime(Number(team.updatedAt) || undefined, Date.now(), language.t)}
                    </span>
                  </span>
                  <span class="size-1.5 shrink-0 rounded-full bg-primary/70" />
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
                        <div class="flex items-center gap-1.5 rounded-full border border-border py-0.5 pl-0.5 pr-2">
                          <img
                            src={agentAvatarOf(member.agent, agents())}
                            alt=""
                            draggable={false}
                            class="size-5 shrink-0 rounded-full object-cover"
                          />
                          <button
                            type="button"
                            class="max-w-32 truncate text-ui-xs text-foreground hover:underline"
                            title={t("team.openSession")}
                            onClick={() => props.onOpenSession(member.sessionID)}
                          >
                            {memberLabel(member, agents())}
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
                        <For each={usableAgents()}>
                          {(agent) => <option value={agent.name}>{agentLabel(agent.name, agents())}</option>}
                        </For>
                      </select>
                      <Show when={adding()}>
                        <Button variant="ghost" size="small" onClick={() => void addMember()}>
                          {t("team.member.add")}
                        </Button>
                      </Show>
                    </Show>
                  </div>
                </div>

                {/*
                  两个页签：默认是「工作线」——团队页首先要回答「它干成了什么」；
                  群聊是过程记录，点开才看。不是两个并列的世界，主次很清楚。
                */}
                <div class="flex shrink-0 items-center gap-1 border-b border-border px-3 py-1.5">
                  <For
                    each={[
                      { id: "lines" as const, label: t("team.tab.lines") },
                      { id: "chat" as const, label: t("team.tab.chat") },
                    ]}
                  >
                    {(item) => (
                      <button
                        type="button"
                        class="rounded-md px-2 py-1 text-ui-xs transition-colors"
                        classList={{
                          "bg-surface text-foreground": view() === item.id,
                          "text-foreground-subtle hover:bg-hover": view() !== item.id,
                        }}
                        onClick={() => setView(item.id)}
                      >
                        {item.label}
                      </button>
                    )}
                  </For>
                </div>

                <Show when={view() === "lines"}>
                  {/*
                    工作线 = 运行。左边是这条团队跑过的每一次，右边是「图 + 运行控制台」：
                    批准、执行、验收、合并都在同一屏，不再跳到另一个「运行」页面。
                  */}
                  <div class="flex min-h-0 flex-1">
                    <div class="flex w-56 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border p-2">
                      <div class="px-1 pb-1 text-ui-xs text-foreground-subtle">{t("team.runs.title")}</div>
                      <Show
                        when={teamRuns().length > 0}
                        fallback={
                          <div class="px-1 py-3 text-ui-xs leading-relaxed text-foreground-subtlest">
                            {t("team.runs.empty")}
                          </div>
                        }
                      >
                        <For each={teamRuns()}>
                          {(run) => (
                            <button
                              type="button"
                              class="flex w-full flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-hover"
                              classList={{ "bg-surface": run.id === lineID() }}
                              onClick={() => setLineID(run.id)}
                            >
                              <span class="flex w-full items-center gap-1.5">
                                <span class="size-1.5 shrink-0 rounded-full" classList={runDot(run)} />
                                <span class="min-w-0 flex-1 truncate text-ui-base text-foreground">{run.goal}</span>
                              </span>
                              {/* 每条工作线都写清「几个人参与、是谁」：这是它和一条普通日志的区别。 */}
                              <span class="w-full truncate pl-3 text-ui-xs text-foreground-subtle">
                                {linePeople()[run.id]?.length
                                  ? t("team.line.people", {
                                      count: String(linePeople()[run.id].length),
                                      names: linePeople()[run.id].slice(0, 3).join("、"),
                                    })
                                  : t("team.line.peoplePending")}
                              </span>
                              <span class="w-full truncate pl-3 text-ui-xs text-foreground-subtlest">
                                {t("run.state." + run.state)} ·{" "}
                                {formatRelativeTime(Number(run.updatedAt) || undefined, Date.now(), language.t)}
                              </span>
                            </button>
                          )}
                        </For>
                      </Show>
                    </div>

                    <div class="flex min-h-0 min-w-0 flex-1 flex-col">
                      {/* 图只占上半屏：形状看一眼就够，剩下的空间留给证据与操作。 */}
                      <Show when={lineID()}>
                        <div class="max-h-[42%] shrink-0 overflow-y-auto border-b border-border px-3 py-2">
                          <Show
                            when={lineDetail()}
                            fallback={<div class="text-ui-xs text-foreground-subtlest">{t("team.line.loading")}</div>}
                          >
                            {(detail) => (
                              <div class="flex flex-col gap-2">
                                <div class="flex flex-wrap items-center gap-1.5 text-ui-xs text-foreground-subtle">
                                  <span class="min-w-0 truncate text-foreground">
                                    {lineRun()?.goal ?? detail().run.goal}
                                  </span>
                                  <Tag class={runStateTone(detail().run.state)}>
                                    {t("run.state." + detail().run.state)}
                                  </Tag>
                                  <span>{t("run.info.round", { round: String(detail().run.roundMain) })}</span>
                                </div>
                                <Show
                                  when={lineTeams().length > 0}
                                  fallback={
                                    <div class="rounded-lg border border-dashed border-border px-3 py-4 text-center text-ui-xs text-foreground-subtlest">
                                      {t("team.line.noTeams")}
                                    </div>
                                  }
                                >
                                  <TeamGraph
                                    teams={lineTeams()}
                                    nameOf={(lane) => lane.name}
                                    selected={selectedNode()}
                                    onSelect={(lane, node) => {
                                      const current = selectedNode()
                                      setSelectedNode(
                                        current?.laneID === lane.id && current.nodeID === node.id
                                          ? undefined
                                          : { laneID: lane.id, nodeID: node.id },
                                      )
                                    }}
                                  />
                                </Show>
                                <Show when={drill()}>
                                  {(current) => (
                                    <TeamDrilldown
                                      view={current().view}
                                      laneName={current().laneName}
                                      round={current().round}
                                      onClose={() => setSelectedNode(undefined)}
                                      {...(props.onOpenSession ? { onOpenSession: props.onOpenSession } : {})}
                                    />
                                  )}
                                </Show>
                              </div>
                            )}
                          </Show>
                        </div>
                      </Show>
                      <RunConsole
                        directory={props.directory}
                        {...(lineID() ? { runID: lineID()! } : {})}
                        onDetail={applyDetail}
                        onCreated={(runID) => {
                          // 新建的运行还没进列表：先刷新列表再选中它。
                          void loadTeamRuns(selected() ?? "")
                          setLineID(runID)
                          setView("lines")
                        }}
                        composing={runComposing()}
                        onComposingChange={setRunComposing}
                        {...(props.onOpenSession ? { onOpenSession: props.onOpenSession } : {})}
                      />
                    </div>
                  </div>
                </Show>

                <Show when={view() === "chat"}>
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
                        <For each={team().members}>
                          {(member) => <option value={member.name}>{member.name}</option>}
                        </For>
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
                </Show>
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
  // 用途量回答「这个人花了多少」；未归属单列，不能摊到他头上。
  const [usage, setUsage] = createSignal<Record<string, TeamEmployeeUsageView>>({})
  // 事实记录（§12.1）：参与、团队驳回、团队一次通过率；只记录，不排名。
  const [facts, setFacts] = createSignal<Record<string, TeamEmployeeRecordView>>({})

  const loadUsage = async (employees: TeamEmployeeView[]) => {
    const entries = await Promise.all(
      employees.map(async (employee) => {
        try {
          const [usage, record] = await Promise.all([
            sdk.client.employee.usage({ directory: props.directory, employeeID: employee.id }),
            sdk.client.employee.record({ directory: props.directory, employeeID: employee.id }),
          ])
          return [employee.id, usage.data, record.data] as const
        } catch {
          // 用量或记录读不出来不影响员工库本身：行照常显示，只是少了那行小字。
          return [employee.id, undefined, undefined] as const
        }
      }),
    )
    const nextUsage: Record<string, TeamEmployeeUsageView> = {}
    const nextFacts: Record<string, TeamEmployeeRecordView> = {}
    for (const [id, usage, record] of entries) {
      if (usage) nextUsage[id] = usage
      if (record) nextFacts[id] = record
    }
    setUsage(nextUsage)
    setFacts(nextFacts)
  }

  const load = async () => {
    try {
      const result = await sdk.client.employee.list({ directory: props.directory })
      const employees = (result.data ?? []) as TeamEmployeeView[]
      setList(employees)
      await loadUsage(employees)
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

  /**
   * 事实记录的一行文案（§12.1）。
   *
   * 未给比率时写「暂无」而不是 0%：0 条验收不等于一次都没通过。
   * 这里的数字全是「所在团队」的事实，tooltip 里原样带出内核给的口径说明。
   */
  const factsLine = (entry: TeamEmployeeRecordView) => {
    const rate = entry.firstPass.rate
    return t("team.employees.facts", {
      runs: numeric(entry.participations.runs),
      teams: numeric(entry.participations.teams),
      rework: numeric(entry.rework.total),
      rate: rate === undefined ? t("team.employees.factsNoRate") : Math.round(numeric(rate) * 100) + "%",
    })
  }
  const factsHint = (entry: TeamEmployeeRecordView) => entry.caveats.join("，")

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
                  <img
                    src={agentAvatarOf(employee.job, props.agents)}
                    alt=""
                    draggable={false}
                    class="size-8 shrink-0 rounded-lg object-cover"
                  />
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1.5">
                      <span
                        classList={{ "truncate text-14-regular": true, "text-foreground-subtlest": employee.archived }}
                      >
                        {employee.name}
                      </span>
                      <Tag>{agentLabel(employee.job, props.agents)}</Tag>
                      <Show when={employee.tier}>{(tier) => <Tag>{tier()}</Tag>}</Show>
                      <Show when={employee.archived}>
                        <Tag class="text-foreground-subtlest">{t("team.employees.archived")}</Tag>
                      </Show>
                    </div>
                    <Show when={employee.prompt}>
                      {(text) => <div class="mt-0.5 truncate text-ui-xs text-foreground-subtle">{text()}</div>}
                    </Show>
                    {/* 事实记录（§12.1）：参与次数与「所在团队」的驳回/一次通过率。 */}
                    <Show when={facts()[employee.id]}>
                      {(entry) => (
                        <Show when={numeric(entry().participations.runs) > 0}>
                          <div class="mt-0.5 text-ui-xs text-foreground-subtlest" title={factsHint(entry())}>
                            {factsLine(entry())}
                          </div>
                        </Show>
                      )}
                    </Show>
                    <Show when={usage()[employee.id]}>
                      {(entry) => (
                        <div class="mt-0.5 text-ui-xs text-foreground-subtlest" title={t("team.employees.usageHint")}>
                          {numeric(entry().totals.sessions) > 0
                            ? t("team.employees.usage", {
                                n: compactTokens(entry().totals.tokens),
                                runs: entry().runs.length,
                              })
                            : t("team.employees.usageEmpty")}
                          <Show when={numeric(entry().unattributed.tokens) > 0}>
                            {" · " +
                              t("team.employees.usageUnattributed", {
                                n: compactTokens(entry().unattributed.tokens),
                              })}
                          </Show>
                        </div>
                      )}
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
                        <For each={props.agents}>
                          {(agent) => <option value={agent.name}>{agentLabel(agent.name, props.agents)}</option>}
                        </For>
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
              <For each={props.agents}>
                {(agent) => <option value={agent.name}>{agentLabel(agent.name, props.agents)}</option>}
              </For>
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

/**
 * 团队模板（§4.1 / §5.2）。
 *
 * 模板是「编制」：谁当队长、队里有谁、每个人在这支队里的职责。它是可复用的资产，
 * 不是某一次运行的一部分 —— 改了模板，已经在跑的运行仍按发起时的快照解释自己。
 *
 * 界面只做三件事：建、改、删。版本号可见，但不提供「回滚」：历史运行自带快照，
 * 想比较版本去运行详情，不在这里另起一套版本管理。
 */
function DialogProfiles(props: {
  directory: string
  agents: Agent[]
  employees: TeamEmployeeView[]
  onChanged: () => void
}) {
  const dialog = useDialog()
  const language = useLanguage()
  const sdk = useGlobalSDK()
  const t = (key: string, vars?: Record<string, unknown>) => language.t(key as never, vars as never)

  const [list, setList] = createSignal<TeamProfileView[]>([])
  // 员工可能刚在员工库里建好：对话框自己再拉一次，不依赖页面打开那一刻的快照。
  const [people, setPeople] = createSignal<TeamEmployeeView[]>(props.employees)
  const [form, setForm] = createSignal(false)
  const [editing, setEditing] = createSignal<string>()
  const [draft, setDraft] = createSignal({
    name: "",
    description: "",
    captain: "",
    roster: [] as Array<{ employeeID: string; duty: string }>,
  })
  const [confirming, setConfirming] = createSignal<string>()
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal("")

  const load = async () => {
    try {
      const [result, employees] = await Promise.all([
        sdk.client.profile.list({ directory: props.directory }),
        sdk.client.employee.list({ directory: props.directory }),
      ])
      setList((result.data ?? []) as TeamProfileView[])
      setPeople((employees.data ?? []) as TeamEmployeeView[])
      setError("")
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  onMount(() => {
    void load()
  })

  const person = (employeeID: string) => people().find((item) => item.id === employeeID)
  const picked = (employeeID: string) => draft().roster.some((entry) => entry.employeeID === employeeID)
  const dutyOf = (employeeID: string) => draft().roster.find((entry) => entry.employeeID === employeeID)?.duty ?? ""

  const openCreate = () => {
    setEditing(undefined)
    setDraft({ name: "", description: "", captain: "", roster: [] })
    setError("")
    setForm(true)
  }

  const openEdit = async (profile: TeamProfileView) => {
    setBusy(true)
    try {
      const result = await sdk.client.profile.detail({ directory: props.directory, profileID: profile.id })
      const detail = result.data as TeamProfileDetail | undefined
      setEditing(profile.id)
      setDraft({
        name: detail?.profile.name ?? profile.name,
        description: detail?.profile.description ?? "",
        captain: detail?.profile.captainMember ?? profile.captainMember,
        roster: (detail?.members ?? []).map((member) => ({ employeeID: member.employeeID, duty: member.duty ?? "" })),
      })
      setError("")
      setForm(true)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const toggleMember = (employeeID: string) => {
    const current = draft()
    if (picked(employeeID)) {
      // 队长被移出名单时一起清掉：不能提交一个「队长不在名册里」的模板。
      setDraft({
        ...current,
        roster: current.roster.filter((entry) => entry.employeeID !== employeeID),
        captain: current.captain === employeeID ? "" : current.captain,
      })
      return
    }
    setDraft({ ...current, roster: [...current.roster, { employeeID, duty: "" }] })
  }

  const setDuty = (employeeID: string, duty: string) => {
    const current = draft()
    setDraft({
      ...current,
      roster: current.roster.map((entry) => (entry.employeeID === employeeID ? { ...entry, duty } : entry)),
    })
  }

  const submit = async () => {
    const value = draft()
    const name = value.name.trim()
    if (!name || !value.captain) {
      setError(t("team.profiles.required"))
      return
    }
    setBusy(true)
    try {
      const members = value.roster.map((entry) => ({
        employeeID: entry.employeeID,
        duty: entry.duty.trim() || undefined,
      }))
      if (editing()) {
        await sdk.client.profile.update({
          directory: props.directory,
          profileID: editing()!,
          name,
          // 空串就是清空描述；版本只在真改了东西时递增（内核的语义）。
          description: value.description.trim(),
          captain: value.captain,
          members,
        })
      } else {
        await sdk.client.profile.create({
          directory: props.directory,
          name,
          description: value.description.trim() || undefined,
          captain: value.captain,
          members,
        })
      }
      setForm(false)
      setError("")
      await load()
      props.onChanged()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (profileID: string) => {
    setBusy(true)
    try {
      await sdk.client.profile.remove({ directory: props.directory, profileID })
      setConfirming(undefined)
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
    <Dialog title={t("team.profiles.title")}>
      <div class="flex max-h-[70vh] flex-col gap-4 overflow-y-auto p-5">
        <div class="text-12-regular leading-relaxed text-foreground-subtle">{t("team.profiles.hint")}</div>
        <Show when={error()}>
          <div class="text-12-regular text-destructive">{error()}</div>
        </Show>

        <Show when={!form()}>
          <Show
            when={list().length > 0}
            fallback={<div class="text-ui-xs text-foreground-subtle">{t("team.profiles.empty")}</div>}
          >
            <div class="flex flex-col gap-2">
              <For each={list()}>
                {(profile) => (
                  <div class="rounded-lg border border-border">
                    <div class="flex items-center gap-2 px-3 py-2">
                      <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-1.5">
                          <span class="truncate text-14-regular">{profile.name}</span>
                          <Tag>{t("team.profiles.version", { version: profile.version })}</Tag>
                          <Tag>{t("team.profiles.memberCount", { count: profile.memberCount })}</Tag>
                          <Show when={profile.autoEligible}>
                            <Tag>{t("team.profiles.auto")}</Tag>
                          </Show>
                        </div>
                        <Show when={profile.description}>
                          {(text) => <div class="mt-0.5 truncate text-ui-xs text-foreground-subtle">{text()}</div>}
                        </Show>
                      </div>
                      <Show
                        when={confirming() === profile.id}
                        fallback={
                          <>
                            <Button
                              variant="ghost"
                              size="small"
                              disabled={busy()}
                              onClick={() => void openEdit(profile)}
                            >
                              {t("team.profiles.edit")}
                            </Button>
                            <Button
                              variant="ghost"
                              size="small"
                              disabled={busy()}
                              onClick={() => setConfirming(profile.id)}
                            >
                              {t("team.profiles.remove")}
                            </Button>
                          </>
                        }
                      >
                        <span class="shrink-0 text-ui-xs text-foreground-subtle">
                          {t("team.profiles.confirmRemove")}
                        </span>
                        <Button
                          variant="ghost"
                          size="small"
                          class="text-destructive"
                          disabled={busy()}
                          onClick={() => void remove(profile.id)}
                        >
                          {t("team.profiles.remove")}
                        </Button>
                        <Button variant="ghost" size="small" onClick={() => setConfirming(undefined)}>
                          {t("common.cancel")}
                        </Button>
                      </Show>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
          <div class="flex items-center justify-end gap-1.5 border-t border-border pt-3">
            <Button variant="ghost" size="small" onClick={() => dialog.close()}>
              {t("common.close")}
            </Button>
            <Button variant="primary" size="small" disabled={busy()} onClick={openCreate}>
              {t("team.profiles.new")}
            </Button>
          </div>
        </Show>

        <Show when={form()}>
          <div class="flex flex-col gap-3 border-t border-border pt-3">
            <div class="flex flex-col gap-1">
              <label class="text-13-medium text-foreground">{t("team.profiles.name")}</label>
              <input
                class="flex h-9 w-full rounded-[8px] border border-border bg-surface px-3 text-14-regular text-foreground outline-none focus:border-primary"
                value={draft().name}
                placeholder={t("team.profiles.namePlaceholder")}
                onInput={(event) => setDraft({ ...draft(), name: event.currentTarget.value })}
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-13-medium text-foreground">{t("team.profiles.description")}</label>
              <input
                class="flex h-9 w-full rounded-[8px] border border-border bg-surface px-3 text-14-regular text-foreground outline-none focus:border-primary"
                value={draft().description}
                placeholder={t("team.profiles.descriptionPlaceholder")}
                onInput={(event) => setDraft({ ...draft(), description: event.currentTarget.value })}
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-13-medium text-foreground">{t("team.profiles.members")}</label>
              <div class="text-ui-xs text-foreground-subtle">{t("team.profiles.membersHint")}</div>
              <Show
                when={people().length > 0}
                fallback={<div class="text-ui-xs text-foreground-subtle">{t("team.profiles.noEmployees")}</div>}
              >
                <div class="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-lg border border-border p-2">
                  <For each={people()}>
                    {(employee) => (
                      <div class="flex items-center gap-2">
                        <input
                          type="checkbox"
                          class="shrink-0"
                          checked={picked(employee.id)}
                          disabled={employee.archived && !picked(employee.id)}
                          onChange={() => toggleMember(employee.id)}
                        />
                        <img
                          src={agentAvatarOf(employee.job, props.agents)}
                          alt=""
                          draggable={false}
                          class="size-6 shrink-0 rounded-md object-cover"
                        />
                        <span
                          classList={{
                            "min-w-0 flex-1 truncate text-14-regular": true,
                            "text-foreground-subtlest": employee.archived,
                          }}
                        >
                          {employee.name}
                        </span>
                        <Tag>{agentLabel(employee.job, props.agents)}</Tag>
                        <Show when={employee.archived}>
                          <Tag class="text-foreground-subtlest">{t("team.employees.archived")}</Tag>
                        </Show>
                        <Show when={picked(employee.id)}>
                          <input
                            class="h-8 w-40 shrink-0 rounded-[8px] border border-border bg-surface px-2 text-ui-xs text-foreground outline-none focus:border-primary"
                            value={dutyOf(employee.id)}
                            placeholder={t("team.profiles.dutyPlaceholder")}
                            onInput={(event) => setDuty(employee.id, event.currentTarget.value)}
                          />
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-13-medium text-foreground">{t("team.profiles.captain")}</label>
              <select
                class="h-9 w-full rounded-[8px] border border-border bg-surface px-2 text-14-regular text-foreground outline-none"
                value={draft().captain}
                onChange={(event) => setDraft({ ...draft(), captain: event.currentTarget.value })}
              >
                <option value="">{t("team.profiles.captainPlaceholder")}</option>
                <For each={draft().roster}>
                  {(entry) => (
                    <option value={entry.employeeID}>{person(entry.employeeID)?.name ?? entry.employeeID}</option>
                  )}
                </For>
              </select>
            </div>
            <div class="flex items-center justify-end gap-1.5">
              <Button variant="ghost" size="small" onClick={() => setForm(false)}>
                {t("common.cancel")}
              </Button>
              <Button variant="primary" size="small" disabled={busy()} onClick={() => void submit()}>
                {editing() ? t("common.save") : t("team.profiles.create")}
              </Button>
            </div>
          </div>
        </Show>
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
    // 搜索同时匹配原始 id 和展示名 —— 用户看到的是中文，输入的可能仍是英文。
    return props.agents
      .filter((agent) => {
        if (!query) return true
        if (agent.name.toLowerCase().includes(query)) return true
        return agentLabel(agent.name, props.agents).toLowerCase().includes(query)
      })
      .slice(0, 60)
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
            <For each={props.agents}>
              {(agent) => <option value={agent.name}>{agentLabel(agent.name, props.agents)}</option>}
            </For>
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
          {/* 已选的人先摆出来：列表很长时，光看一个数字不知道自己挑的是谁。 */}
          <Show when={picked().length > 0}>
            <div class="flex flex-wrap items-center gap-1">
              <For each={picked()}>
                {(name) => (
                  <button
                    type="button"
                    class="flex items-center gap-1 rounded-full border border-border py-0.5 pl-0.5 pr-1.5 text-ui-xs text-foreground transition-colors hover:bg-hover"
                    title={name}
                    onClick={() => toggle(name)}
                  >
                    <img
                      src={agentAvatarOf(name, props.agents)}
                      alt=""
                      draggable={false}
                      class="size-4 shrink-0 rounded-full object-cover"
                    />
                    <span class="max-w-28 truncate">{agentLabel(name, props.agents)}</span>
                    <Icon name="close-small" size="small" class="text-foreground-subtle" />
                  </button>
                )}
              </For>
            </div>
          </Show>{" "}
          <div class="grid max-h-56 grid-cols-2 gap-1 overflow-y-auto">
            <For each={candidates()}>
              {(agent) => (
                <button
                  type="button"
                  class="flex min-w-0 items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors"
                  classList={{
                    "border-primary bg-surface": picked().includes(agent.name),
                    "border-border hover:bg-hover": !picked().includes(agent.name),
                  }}
                  title={agent.name}
                  onClick={() => toggle(agent.name)}
                >
                  <img
                    src={agentAvatar(agent.name, agent.options)}
                    alt=""
                    draggable={false}
                    class="size-7 shrink-0 rounded-lg object-cover"
                  />
                  <span class="flex min-w-0 flex-1 flex-col">
                    <span class="truncate text-ui-base text-foreground">{agentLabel(agent.name, props.agents)}</span>
                    <Show when={agentCategory(agent)}>
                      {(category) => <span class="truncate text-ui-xs text-foreground-subtlest">{category()}</span>}
                    </Show>
                  </span>
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
