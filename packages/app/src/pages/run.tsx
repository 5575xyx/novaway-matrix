import type {
  MissionDiffView,
  MissionView,
  RunDetail,
  RunEventView,
  RunMetricsView,
  RunReplayView,
  RunView,
  TeamProfileView,
} from "@novaway/sdk/v2"
import { Button } from "@novaway/ui/button"
import { Icon } from "@novaway/ui/icon"
import { Tag } from "@novaway/ui/tag"
import { createMemo, createSignal, For, onCleanup, onMount, Show, type Component } from "solid-js"
import { PageHeader } from "@/components/page-header"
import { RunGuide, type GuideStep } from "@/components/run-guide"
import { guideStates } from "@/components/run-guide.steps"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

const TERMINAL = new Set(["done", "partial", "failed", "exceeded", "cancelled"])

/**
 * 生成的 SDK 把 `Schema.Number` 展开成 `number | "NaN" | "Infinity" | "-Infinity"`。
 * 求和时非数字一律按 0 处理 —— 差异统计出错不该让整行渲染崩掉。
 */
const numeric = (value: number | string) => (typeof value === "number" ? value : 0)

/**
 * 墙钟耗时（毫秒 → 人话）。
 *
 * 只在 `startedAt` 存在时有意义；运行中按当前时间算，终态按 `endedAt` 算。
 * 分钟以上给「N 分 M 秒」，一分钟以内只给秒 —— 看板要的是量级，不是精确到毫秒的假精度。
 */
const elapsed = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return minutes > 0 ? minutes + " 分 " + seconds + " 秒" : seconds + " 秒"
}

/**
 * 「团队运行」页。
 *
 * 它回答的是「这次交付到底成立吗」，而不是「聊到哪了」：
 * 左侧是运行列表，右侧是验收台账 —— 通过、失败、未验证、证据过期
 * 四个数字分开显示，未验证永远不会被并进「通过」。
 * 每个数字都能点开看到对应的验收项与实测结果。
 */
export const RunPage: Component<{
  directory: string
  onBack: () => void
  onOpenSession?: (sessionID: string) => void
  /** 从团队页「最近运行」进入时直接选中那次运行，不让用户再找一遍。 */
  initialRunID?: string
}> = (props) => {
  const sdk = useGlobalSDK()
  const language = useLanguage()
  const t = (key: string, vars?: Record<string, unknown>) => language.t(key as never, vars as never)

  const [runs, setRuns] = createSignal<RunView[]>([])
  const [selected, setSelected] = createSignal<string | undefined>(undefined)
  const [detail, setDetail] = createSignal<RunDetail | undefined>(undefined)
  const [error, setError] = createSignal("")
  // 成功也要说出来：合并之后用户需要知道合进了哪个分支、是哪个提交。
  const [notice, setNotice] = createSignal("")
  const [busy, setBusy] = createSignal("")
  // 「试跑」：用内置模板直接发起一次运行，不要求用户先去建团队。
  const [profiles, setProfiles] = createSignal<TeamProfileView[]>([])
  // 用哪份模板发起：模板可以有多份，静默取第一份等于替用户选了编制。
  const [profileID, setProfileID] = createSignal("")
  const [composing, setComposing] = createSignal(false)
  const [goal, setGoal] = createSignal("")
  const [criteria, setCriteria] = createSignal("")
  // 范围与约束（§5.3 brief）：每行一条，写进队长提示词；不填就是不限定。
  const [scope, setScope] = createSignal("")
  const [constraints, setConstraints] = createSignal("")
  const [budget, setBudget] = createSignal(100_000)
  // 墙钟上限（分钟）：0 表示不限。超过即停的是新的派发（§7.3）。
  const [wallMinutes, setWallMinutes] = createSignal(0)
  // 成本上限（模型目录的计价单位）：0 表示不限。成本事后才有权威值，所以停的也是新派发。
  const [costCap, setCostCap] = createSignal(0)
  // 持久目标（§3.2）：可选归属。选「新建」时会先建目标再建运行。
  const [missions, setMissions] = createSignal<MissionView[]>([])
  const [missionID, setMissionID] = createSignal("")
  const [missionGoal, setMissionGoal] = createSignal("")
  // 目标累计差异：baseSHA → 当前内容。没有目标时为空。
  const [missionDiff, setMissionDiff] = createSignal<MissionDiffView | undefined>(undefined)
  // 展开中的验收项：点一下看证据，再点一下收起。
  const [openLine, setOpenLine] = createSignal<string | undefined>(undefined)
  // 命令类验收（§19.1）：命令由人写进去，注册后界面不再回显它。
  const [commandOpen, setCommandOpen] = createSignal(false)
  const [commandText, setCommandText] = createSignal("")
  const [commandRun, setCommandRun] = createSignal("")
  const [commandSeconds, setCommandSeconds] = createSignal(120)
  // 总控开关（§13.1）：关闭时不能启动运行，但历史与计划照旧可以看、可以改。
  const [switchedOn, setSwitchedOn] = createSignal(true)
  // 事件流：按需加载，收起时不发请求。
  const [showEvents, setShowEvents] = createSignal(false)
  const [loadingEvents, setLoadingEvents] = createSignal(false)
  const [events, setEvents] = createSignal<RunEventView[]>([])
  // 指标（§12）：默认收起。收起时不发请求，展开时拉一次由自己的慢轮询刷新。
  const [showMetrics, setShowMetrics] = createSignal(false)
  const [metrics, setMetrics] = createSignal<RunMetricsView | undefined>(undefined)
  const [loadingMetrics, setLoadingMetrics] = createSignal(false)
  // 决策链回放（§12）：按需加载；记住锁属哪次运行，切换运行时不会张冠李戴。
  const [showReplay, setShowReplay] = createSignal(false)
  const [replay, setReplay] = createSignal<RunReplayView | undefined>(undefined)
  const [replayRunID, setReplayRunID] = createSignal<string | undefined>(undefined)
  const [loadingReplay, setLoadingReplay] = createSignal(false)
  const NEW_MISSION = "__new"

  const loadRuns = async (select?: string) => {
    try {
      const result = await sdk.client.run.list({ directory: props.directory })
      const list = result.data ?? []
      setRuns(list)
      setError("")
      // 外部点进来指定的运行优先于「之前选的那条」：用户的心智是「打开我刚点的那次」。
      // 只有它确实在本目录的列表里才采用，避免拿着别的项目的 id 显示空白详情。
      const requested = select ?? props.initialRunID
      const next =
        (requested && list.some((run) => run.id === requested) ? requested : undefined) ?? selected() ?? list[0]?.id
      setSelected(next)
      if (next) await loadDetail(next)
      else setDetail(undefined)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const loadDetail = async (runID: string) => {
    try {
      const result = await sdk.client.run.detail({ runID, directory: props.directory })
      if (selected() !== runID) return
      setDetail(result.data ?? undefined)
      setError("")
      const missionID = result.data?.run.missionID
      if (missionID) await loadMissionDiff(missionID)
      else setMissionDiff(undefined)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  /** 目标的累计差异；算不出来就显示原因，不显示「0 个文件」。 */
  const loadMissionDiff = async (missionID: string) => {
    try {
      const result = await sdk.client.mission.diff({ missionID, directory: props.directory })
      setMissionDiff(result.data ?? undefined)
    } catch {
      // 差异只是附加信息：读失败不该盖掉运行本身的错误提示。
      setMissionDiff(undefined)
    }
  }

  /**
   * 运行指标（§12）。
   *
   * 附加信息：读失败不盖掉运行本身的错误提示 —— 指标缺了不影响「这次交付成立吗」。
   * 展开时才拉，且用 15 秒的慢轮询：指标要扫最近若干次运行的事件，不该跟着 3 秒的看板刷新走。
   */
  const loadMetrics = async () => {
    setLoadingMetrics(true)
    try {
      const result = await sdk.client.run.metrics({ directory: props.directory })
      setMetrics(result.data ?? undefined)
    } catch {
      setMetrics(undefined)
    } finally {
      setLoadingMetrics(false)
    }
  }

  /**
   * 决策链回放（§12）。
   *
   * 与事件流同一份日志，但回答的是另一个问题：「为什么它认为完成了」。
   * 读失败只影响这个面板，不盖掉运行本身的错误提示 —— 回放是补充证据，不是判据。
   */
  const loadReplay = async (runID: string) => {
    setLoadingReplay(true)
    try {
      const result = await sdk.client.run.replay({ runID, directory: props.directory })
      if (selected() !== runID) return
      setReplay(result.data ?? undefined)
      setReplayRunID(runID)
    } catch {
      setReplay(undefined)
      setReplayRunID(runID)
    } finally {
      setLoadingReplay(false)
    }
  }

  const toggleReplay = async (runID: string) => {
    if (showReplay()) {
      setShowReplay(false)
      return
    }
    setShowReplay(true)
    if (replayRunID() !== runID) await loadReplay(runID)
  }

  const toggleMetrics = () => {
    const next = !showMetrics()
    setShowMetrics(next)
    if (next) void loadMetrics()
  }

  const reload = async () => {
    const runID = selected()
    if (runID) await loadDetail(runID)
  }

  /**
   * 展开 / 收起事件流。
   *
   * 展开时才拉一次；收起再展开会重新读 —— 运行中事件一直在增长，
   * 缓存一份旧日志只会让人以为「后面什么都没发生」。
   */
  const toggleEvents = async (runID: string) => {
    if (showEvents()) {
      setShowEvents(false)
      return
    }
    setLoadingEvents(true)
    try {
      const result = await sdk.client.run.events({ runID, directory: props.directory })
      // 只留最近 200 条并倒序：看板回答「刚发生了什么」，不是归档。
      setEvents([...(result.data ?? [])].slice(-200).reverse())
      setShowEvents(true)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoadingEvents(false)
    }
  }
  /** 收起时也能看出「有多少条」：否则按钮不说明任何事。 */
  const eventCount = () => (showEvents() ? events().length : 0)

  const act = async (label: string, action: () => Promise<unknown>) => {
    setBusy(label)
    setNotice("")
    try {
      await action()
      await reload()
      await loadRuns(selected())
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy("")
    }
  }

  const loadMissions = async () => {
    try {
      const result = await sdk.client.mission.list({ directory: props.directory })
      setMissions(result.data ?? [])
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const loadProfiles = async () => {
    try {
      const result = await sdk.client.profile.list({ directory: props.directory })
      const list = result.data ?? []
      setProfiles(list)
      // 第一份只作为初始值；用户选过之后不再覆盖。
      if (!profileID() && list.length > 0) setProfileID(list[0].id)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  /**
   * 用内置模板发起运行。
   *
   * 运行只走到 `awaiting_approval`：模板可以替用户编排，不能替用户授权。
   * 验收必须由用户给 —— 没写验收的运行无论跑成什么样都不该显示「已完成」。
   */
  const start = async () => {
    const profile = profiles().find((item) => item.id === profileID()) ?? profiles()[0]
    const text = goal().trim()
    const lines = criteria()
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
    const scopeLines = scope()
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
    const constraintLines = constraints()
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
    if (!profile || !text || lines.length === 0) return
    setBusy("create")
    try {
      // 目标先建：目标准备失败时不该留下一个跑不了的运行。
      let attached = missionID()
      if (attached === NEW_MISSION) {
        const createdMission = await sdk.client.mission.create({
          query_directory: props.directory,
          body_directory: props.directory,
          goal: missionGoal().trim() || text,
        })
        attached = createdMission.data?.id ?? ""
        if (!attached) throw new Error(t("run.new.missionFailed"))
      }
      const session = await sdk.client.session.create({ directory: props.directory, title: text })
      const sessionID = session.data?.id
      if (!sessionID) throw new Error(t("run.new.sessionFailed"))
      const created = await sdk.client.run.create({
        // 请求体里的 directory 和查询参数同名，生成器把它们拆成了 body_directory / query_directory。
        query_directory: props.directory,
        body_directory: props.directory,
        sessionID,
        mode: "team",
        goal: text,
        profileID: profile.id,
        missionID: attached || undefined,
        // 范围与约束原样交给服务端：以前这里不传，用户写了也没人看。
        brief:
          scopeLines.length > 0 || constraintLines.length > 0
            ? {
                ...(scopeLines.length > 0 ? { scope: scopeLines } : {}),
                ...(constraintLines.length > 0 ? { constraints: constraintLines } : {}),
              }
            : undefined,
        budget: {
          tokens: budget(),
          ...(wallMinutes() > 0 ? { wallMs: Math.round(wallMinutes() * 60_000) } : {}),
          ...(costCap() > 0 ? { cost: costCap() } : {}),
        },
        acceptance: lines.map((line, index) => ({ specID: "review-" + (index + 1), text: line })),
      })
      setComposing(false)
      setGoal("")
      setCriteria("")
      setScope("")
      setConstraints("")
      setMissionID("")
      setMissionGoal("")
      await loadMissions()
      await loadRuns(created.data?.run.id)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy("")
    }
  }

  const execute = () =>
    act("execute", async () => {
      const runID = selected()
      if (!runID) return
      await sdk.client.run.execute({ runID, directory: props.directory })
    })

  /**
   * 清理工作区：只在终态、且确实还有 worktree 时才出现。
   *
   * 集成分支就是这次运行的可交付物 —— 删之前应该已经合并或明确放弃，
   * 所以不做「跑完自动删」，而是留给用户一次明确的点击。
   */
  const cleanup = () =>
    act("cleanup", async () => {
      const runID = selected()
      if (!runID) return
      const result = await sdk.client.run.worktrees.remove({ runID, directory: props.directory })
      const failed = (result.data ?? []).filter((item) => !item.removed)
      if (failed.length > 0)
        setError(failed.map((item) => item.directory + "：" + (item.error ?? "")).join(String.fromCharCode(10)))
    })

  /**
   * 显式放行（§11.2）。
   *
   * 拒绝在本次运行内保持有效，所以「再问一次」必须由人点出来 ——
   * 不做「过一会儿自动重试弹窗」，那等于把用户的拒绝当成噪音。
   */
  const allowDenied = () =>
    act("denials", async () => {
      const runID = selected()
      if (!runID) return
      const result = await sdk.client.run.denials.clear({ runID, directory: props.directory })
      setNotice(t("run.denials.cleared", { count: String(numeric(result.data?.cleared ?? 0)) }))
    })

  /**
   * 复核一条结果不明的工具操作（§8.5）。
   *
   * 人核对完副作用之后的结论只有两种，它们决定的是「同一个调用要不要重跑」：
   * 执行过 → 同键永远跳过；没有执行 → 允许重试。界面不做猜测，也不提供「跳过复核」。
   */
  const reviewOp = (opID: string, verdict: "succeeded" | "abandoned") =>
    act("review", async () => {
      const runID = selected()
      if (!runID) return
      await sdk.client.run.op.review({ runID, opID, directory: props.directory, verdict })
      setNotice(t("run.review.recorded"))
    })

  /**
   * 注册一条命令类验收（§6.2 / §19.1）。
   *
   * 命令只在待人写的这里进入系统：注册之后界面不会再回显它 —— 命令行常带凭据，
   * 之后能看到的只有「这条验收是命令验的、超时多久」。
   */
  const addCommandAcceptance = () =>
    act("acceptance", async () => {
      const runID = selected()
      if (!runID) return
      const text = commandText().trim()
      const run = commandRun().trim()
      if (!text || !run) return
      await sdk.client.run.acceptance.add({
        runID,
        directory: props.directory,
        specID: "cmd-" + Date.now().toString(36),
        text,
        kind: "test",
        verifier: {
          kind: "command",
          run,
          ...(commandSeconds() > 0 ? { timeoutMs: Math.round(commandSeconds() * 1000) } : {}),
        },
      })
      setCommandText("")
      setCommandRun("")
      setCommandOpen(false)
    })

  const acceptanceFor = (acceptanceID: string) => (detail()?.acceptances ?? []).find((item) => item.id === acceptanceID)

  const hasWorktrees = createMemo(() => (detail()?.teams ?? []).some((team) => !!team.worktree))
  /** 当前运行属于哪个目标：编号只给人看，悬停给出目标描述。 */
  const currentMission = createMemo(() => missions().find((item) => item.id === detail()?.run.missionID))

  /**
   * 目标的结束只能由用户声明（§3.2）。
   *
   * 运行结束不等于目标完成，目标完成也不会停掉运行 —— 两件事的生命周期是分开的。
   * 所以这里没有「跑完自动完成」的捷径，只有这一下明确的点击。
   */
  /**
   * 放弃的目标才谈得上清理工作区（§3.2）。
   *
   * 活跃目标下次运行还要从这份工作区接着做；已完成的目标还要靠它回答「总共改了什么」。
   * 拒绝的原因要原样显示 —— 「点了没反应」比「不能清」更让人困惑。
   */
  const cleanupMission = () =>
    act("mission", async () => {
      const mission = currentMission()
      if (!mission) return
      const result = await sdk.client.mission.cleanup({ missionID: mission.id, directory: props.directory })
      const data = result.data
      setNotice(data?.removed ? t("run.mission.cleaned") : (data?.reason ?? t("run.mission.cleanupNothing")))
      await loadMissions()
    })

  const setMissionStatus = (status: "active" | "done" | "abandoned") =>
    act("mission", async () => {
      const mission = currentMission()
      if (!mission) return
      await sdk.client.mission.update({ missionID: mission.id, directory: props.directory, status })
      await loadMissions()
    })

  /**
   * 显式合并：把集成分支合进用户当前检出的分支。
   *
   * 它不是运行的收尾动作 —— 跑完不等于要合。合进用户分支是不可撤销地改变
   * 用户的仓库，只能由用户点这一下决定。
   */
  const merge = () =>
    act("merge", async () => {
      const runID = selected()
      if (!runID) return
      const result = await sdk.client.run.merge({ runID, directory: props.directory })
      const data = result.data
      if (data?.merged) {
        // 重复点击不等于又合了一次：这时只说「早就合过了」，并给出当时的分支。
        setNotice(
          data.alreadyMerged
            ? t("run.merge.already", { branch: data.branch ?? "" })
            : t("run.merge.done", { branch: data.branch ?? "", sha: (data.sha ?? "").slice(0, 12) }),
        )
        return
      }
      setNotice("")
      setError(data?.message ?? t("run.merge.failed"))
    })

  const cancel = () =>
    act("cancel", async () => {
      const runID = selected()
      if (!runID) return
      await sdk.client.run.cancel({ runID, directory: props.directory })
    })

  const approve = () =>
    act("approve", async () => {
      const run = detail()?.run
      if (!run) return
      await sdk.client.run.approve({
        runID: run.id,
        directory: props.directory,
        planVersion: run.planVersion,
        budget: run.budget ?? { tokens: 200_000 },
        by: "user",
      })
    })

  /**
   * 改授权（§11.1）：只读 ↔ 可写只能在批准之前切换。
   *
   * 这是「放宽必须是显式的」唯一的入口 —— 默认只读，允许改工作区只能由人在
   * 这里点出来；改完版本号递增，刚才的批准作废，要按新授权重新批准。
   */
  const setPolicy = (readOnly: boolean) =>
    act("policy", async () => {
      const run = detail()?.run
      if (!run) return
      await sdk.client.run.policy({ runID: run.id, directory: props.directory, readOnly })
    })

  onMount(() => {
    void loadRuns(props.initialRunID)
    void loadProfiles()
    void loadMissions()
    void sdk.client.kernel
      .capabilities({ directory: props.directory })
      .then((result) => {
        const feature = (result.data?.features ?? []).find((item) => item.id === "team_orchestration")
        // 老版本内核不报这一项：按开启处理，不因为版本落后就把按钮禁掉。
        setSwitchedOn(feature ? feature.enabled : true)
      })
      .catch(() => setSwitchedOn(true))
    // 运行是后台推进的；没有推送时用轮询保证看板不会停在旧状态。
    const timer = setInterval(() => {
      void reload()
    }, 3000)
    // 指标是慢变量：只在这个面板展开时刷新，且频率比看板低。
    const metricsTimer = setInterval(() => {
      if (showMetrics()) void loadMetrics()
      // 回放会随轮次增长：展开时跟着慢轮询刷新，收起时完全不发请求。
      const runID = selected()
      if (showReplay() && runID) void loadReplay(runID)
    }, 15000)
    onCleanup(() => clearInterval(timer))
    onCleanup(() => clearInterval(metricsTimer))
  })

  const stateLabel = (state: string) => t(`run.state.${state}`)
  // 同一个目标可以有多次运行：列表里标出目标编号，才知道几次运行在往下做同一件事。
  const missionLabel = (missionID: string | null | undefined) =>
    missionID ? missions().find((mission) => mission.id === missionID)?.label : undefined
  const summary = createMemo(() => detail()?.summary)
  /** 某条验收项的验证记录；按落库顺序显示，最新一次在最后。 */
  const evidenceFor = (acceptanceID: string) =>
    (detail()?.verifications ?? []).filter((record) => record.acceptanceID === acceptanceID)
  /** 上下文被截断的地方：逐条摊开，不让它默默发生（§6.4）。 */
  const truncations = createMemo(() =>
    (detail()?.teams ?? []).flatMap((team) =>
      (team.context?.omitted ?? []).map((item) => ({
        teamID: team.id,
        kind: item.kind,
        count: item.count,
        reason: item.reason,
      })),
    ),
  )
  /** 任务板（§5.5）：按团队摊平，只回答「做什么、到哪一步、谁在做」。 */
  const board = createMemo(() =>
    (detail()?.teams ?? []).flatMap((team) => (team.tasks ?? []).map((task) => ({ teamID: team.id, ...task }))),
  )
  // 与后端同一条规则：批准前、以及批准后还没开工（running 且没有 phase）时可以改授权。
  // 会话里点名的团队会自动批准并落在 running，所以这一段不能漏 —— 否则界面上就没法放宽。
  const canChangePolicy = createMemo(() => {
    const run = detail()?.run
    if (!run) return false
    if (run.state === "planning" || run.state === "awaiting_approval") return true
    return run.state === "running" && !run.phase
  })
  const canExecute = createMemo(() => {
    if (!switchedOn()) return false
    const run = detail()?.run
    if (!run) return false
    // 与后端同一条规则：未批准不跑；已经在执行时也不再显示按钮（重复执行会派发两遍）。
    if (TERMINAL.has(run.state) || run.state === "awaiting_approval") return false
    // 结果不明的工具操作没核对完之前不许续跑（后端同样拒绝）：按钮不出现，
    // 该做的是在上面那几行里核对副作用，而不是再点一次执行。
    if ((detail()?.needsReview?.length ?? 0) > 0) return false
    return !(run.state === "running" && run.phase)
  })

  /**
   * 运行状态的人话标签。
   *
   * `running` 同时表示「已批准、还没开始」与「正在执行」。只看状态会把「等人点开始」
   * 说成「执行中」，用户于是以为它已经在跑，也就不明白为什么还要再点一次。
   */
  const runStateLabel = (run: { state: string; phase?: string }) =>
    run.state === "running" && !run.phase ? t("run.state.ready") : t(`run.state.${run.state}`)

  /**
   * 现在该做什么。
   *
   * 看板以前只把状态、轮次、计划版本摆出来，用户得自己推断下一步该点哪里 ——
   * 于是最常见的结果是「点了执行没反应」或者根本不知道还能点。这里把下一步写成
   * 一句话 + 一个按钮，其他地方的动作都是可选的高级操作。
   */
  const nextStep = createMemo(() => {
    const data = detail()
    if (!data) return undefined
    const run = data.run
    const teams = data.teams.length
    const pending = data.needsReview?.length ?? 0
    if (pending > 0)
      return {
        title: t("run.step.reviewTitle", { count: String(pending) }),
        hint: t("run.step.reviewHint"),
      }
    // 计划还没建好时（API / 命令行发起），这里没有按钮可点：先说实话，别落到「失败」。
    if (run.state === "planning") return { title: t("run.step.planningTitle"), hint: t("run.step.planningHint") }
    if (run.state === "awaiting_approval")
      return {
        title: t("run.step.approveTitle", { count: String(teams) }),
        hint: t("run.step.approveHint"),
        action: { label: t("run.action.approve"), busy: "approve", run: approve },
      }
    if (run.state === "running" && !run.phase)
      return {
        title: t("run.step.startTitle", { count: String(teams) }),
        hint: t("run.step.startHint"),
        action: canExecute() ? { label: t("run.action.start"), busy: "execute", run: execute } : undefined,
      }
    if (run.state === "running")
      return {
        title: t("run.step.runningTitle", { round: String(run.roundMain) }),
        hint: t("run.step.runningHint"),
      }
    // `needs_review` 且已没有待核对项：能做的和 `paused` 一样 —— 继续。
    if (run.state === "paused" || run.state === "needs_review")
      return {
        title: t("run.step.resumeTitle"),
        hint: t("run.step.resumeHint"),
        action: canExecute() ? { label: t("run.action.resume"), busy: "execute", run: execute } : undefined,
      }
    if (run.state === "blocked")
      return {
        title: t("run.step.retryTitle"),
        hint: t("run.step.retryHint"),
        action: canExecute() ? { label: t("run.action.retry"), busy: "execute", run: execute } : undefined,
      }
    if (run.state === "done")
      return {
        title: t("run.step.doneTitle"),
        hint: !hasWorktrees()
          ? t("run.step.doneHintNoMerge")
          : run.mergeState === "merged"
            ? t("run.step.doneHintMerged")
            : run.mergeState === "merge_failed"
              ? t("run.step.doneHintMergeFailed")
              : t("run.step.doneHint"),
        // 合过之后不再提合并：再说一次就是在制造「还能再合一次」的错觉。
        action:
          hasWorktrees() && run.mergeState !== "merged"
            ? { label: t("run.action.merge"), busy: "merge", run: merge }
            : undefined,
      }
    if (run.state === "partial")
      return {
        title: t("run.step.partialTitle"),
        hint: run.mergeState === "merged" ? t("run.step.partialHintMerged") : t("run.step.partialHint"),
        action:
          hasWorktrees() && run.mergeState !== "merged"
            ? { label: t("run.action.merge"), busy: "merge", run: merge }
            : undefined,
      }
    if (run.state === "exceeded") return { title: t("run.step.exceededTitle"), hint: t("run.step.exceededHint") }
    if (run.state === "cancelled") return { title: t("run.step.cancelledTitle"), hint: t("run.step.cancelledHint") }
    return { title: t("run.step.failedTitle"), hint: t("run.step.failedHint") }
  })

  /**
   * 使用引导的步骤条（§4.3）。
   *
   * 它和「现在该做什么」分工不同：那一句回答「此刻点哪里」，这一条回答
   * 「一共几步、走到哪了、后面还有什么」。状态只影响高亮，说明文字是静态的，
   * 点开就能看到每一步在做什么 —— 新用户不必先去读文档。
   */
  const guideSteps = createMemo<GuideStep[]>(() => {
    const data = detail()
    if (!data) return []
    const run = data.run
    return guideStates({
      state: run.state,
      mergeState: run.mergeState,
      accepted: (data.summary?.lines?.length ?? 0) > 0,
      hasWorktrees: hasWorktrees(),
    }).map((step) => ({
      id: step.id,
      state: step.state,
      title: t("run.guide." + step.id + ".title"),
      hint: t("run.guide." + step.id + ".hint"),
    }))
  })

  /**
   * 空状态的三步：第一条先看有没有团队模板。
   *
   * 没有模板时，新建按钮根本不出现 —— 与其让人点一个不存在的入口，
   * 不如把「先建模板」写成第一步并标成当前。
   */
  const emptySteps = createMemo(() => [
    { text: t("run.empty.step1"), done: profiles().length > 0 },
    { text: t("run.empty.step2"), done: false },
    { text: t("run.empty.step3"), done: false },
  ])

  /**
   * 只读提醒：最常见的误解是「跑完了怎么没改我的代码」。
   * 只在开工前说 —— 开工后改授权需要重新批准，说了也做不了。
   */
  const guideNote = createMemo(() => {
    const run = detail()?.run
    if (!run || !canChangePolicy() || !run.readOnly) return undefined
    return t("run.guide.readOnly")
  })

  return (
    <div class="flex h-full min-h-0 flex-col bg-background">
      {/* 「刷新」放在左边栏顶部而不是顶行右侧：右上角是窗口自绘的窗控条。 */}
      <PageHeader onBack={() => props.onBack()} title={t("run.page.title")} hint={t("run.page.hint")} />

      <Show when={error()}>
        <div class="shrink-0 border-b border-border px-4 py-1.5 text-ui-xs text-destructive">{error()}</div>
      </Show>

      <Show when={notice()}>
        <div class="shrink-0 border-b border-border px-4 py-1.5 text-ui-xs text-success">{notice()}</div>
      </Show>

      {/* 关闭 ≠ 删数据、也不停已在跑的运行：页面照旧可看可改，只是不能开始新的执行。 */}
      <Show when={!switchedOn()}>
        <div class="shrink-0 border-b border-border px-4 py-1.5 text-ui-xs text-warning">{t("run.switch.off")}</div>
      </Show>

      <div class="flex min-h-0 flex-1">
        <aside class="flex w-64 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border p-2">
          <div class="flex items-center gap-1.5 px-1 pb-1">
            <Button variant="ghost" size="small" class="min-w-0 flex-1 justify-start" onClick={() => void loadRuns()}>
              <Icon name="refresh" size="small" />
              {t("run.action.refresh")}
            </Button>
            <Show when={profiles().length > 0}>
              <Button variant="ghost" size="small" title={t("run.action.newHint")} onClick={() => setComposing(true)}>
                <Icon name="plus" size="small" />
                {t("run.action.new")}
              </Button>
            </Show>
          </div>
          {/*
            当前运行的操作放在左边栏顶部（页面的操作都在这边，右上角留给窗口控件）。
            顺序按「现在最该做的事」排，最上面那一个就是下一步。
          */}
          <Show when={detail()}>
            {(data) => (
              <div class="flex flex-col gap-1 rounded-lg border border-border bg-surface p-1">
                <Show when={nextStep()?.action}>
                  {(action) => (
                    <Button
                      variant="primary"
                      size="small"
                      class="w-full justify-start"
                      disabled={busy() !== ""}
                      onClick={() => void action().run()}
                    >
                      {busy() === action().busy ? t("run.action.working") : action().label}
                    </Button>
                  )}
                </Show>
                {/* 授权只能在开工之前改；放开写操作是人的决定，不是默认值。 */}
                <Show when={canChangePolicy()}>
                  <Button
                    variant="ghost"
                    size="small"
                    class="w-full justify-start"
                    title={t("run.policy.hint")}
                    disabled={busy() !== ""}
                    onClick={() => void setPolicy(!data().run.readOnly)}
                  >
                    {data().run.readOnly ? t("run.policy.allowWrites") : t("run.policy.makeReadOnly")}
                  </Button>
                </Show>
                <Show when={data().run.state === "blocked" || data().run.state === "needs_review"}>
                  <Button
                    variant="ghost"
                    size="small"
                    class="w-full justify-start"
                    title={t("run.action.openSessionHint")}
                    disabled={!props.onOpenSession}
                    onClick={() => props.onOpenSession?.(data().run.sessionID)}
                  >
                    {t("run.action.openSession")}
                  </Button>
                </Show>
                <Show when={TERMINAL.has(data().run.state) && hasWorktrees() && data().run.mergeState !== "merged"}>
                  <Button
                    variant="ghost"
                    size="small"
                    class="w-full justify-start"
                    title={t("run.action.mergeHint")}
                    disabled={busy() !== ""}
                    onClick={() => void merge()}
                  >
                    {busy() === "merge" ? t("run.action.merging") : t("run.action.merge")}
                  </Button>
                </Show>
                <Show when={TERMINAL.has(data().run.state) && hasWorktrees()}>
                  <Button
                    variant="ghost"
                    size="small"
                    class="w-full justify-start"
                    title={t("run.action.cleanupHint")}
                    disabled={busy() !== ""}
                    onClick={() => void cleanup()}
                  >
                    {busy() === "cleanup" ? t("run.action.cleaning") : t("run.action.cleanup")}
                  </Button>
                </Show>
                <Show when={!TERMINAL.has(data().run.state) && !(data().run.state === "running" && !data().run.phase)}>
                  <Button
                    variant="ghost"
                    size="small"
                    class="w-full justify-start"
                    disabled={busy() !== ""}
                    onClick={() => void cancel()}
                  >
                    {t("run.action.cancel")}
                  </Button>
                </Show>
              </div>
            )}
          </Show>
          <Show
            when={runs().length > 0}
            fallback={
              <div class="px-2 py-3 text-ui-xs leading-relaxed text-foreground-subtle">{t("run.empty.title")}</div>
            }
          >
            <For each={runs()}>
              {(run) => (
                <button
                  type="button"
                  class="flex w-full flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-hover"
                  classList={{ "bg-surface": run.id === selected() }}
                  onClick={() => setSelected(run.id)}
                >
                  <span class="w-full truncate text-ui-base text-foreground">{run.goal}</span>
                  <span class="w-full truncate text-ui-xs text-foreground-subtle">
                    {missionLabel(run.missionID) ? missionLabel(run.missionID) + " · " : ""}
                    {runStateLabel(run)} · {run.mode}
                  </span>
                </button>
              )}
            </For>
          </Show>
          {/* 指标（§12）：本地统计，不上报、不排名。默认收起，展开时才拉一次。 */}
          <div class="mt-2 border-t border-border px-1 pt-2">
            <button
              type="button"
              class="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left text-ui-xs text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
              onClick={toggleMetrics}
              title={t("run.metrics.hint")}
            >
              <Icon size="small" name={showMetrics() ? "chevron-down" : "chevron-right"} />
              {t("run.metrics.title")}
            </button>
            <Show when={showMetrics()}>
              <Show
                when={metrics()}
                fallback={
                  <div class="px-1 py-1 text-ui-xs text-foreground-subtlest">
                    {loadingMetrics() ? t("run.metrics.loading") : t("run.metrics.empty")}
                  </div>
                }
              >
                {(data) => (
                  <Show
                    when={numeric(data().window.runs) > 0}
                    fallback={<div class="px-1 py-1 text-ui-xs text-foreground-subtlest">{t("run.metrics.empty")}</div>}
                  >
                    <div class="flex flex-col gap-1 px-1 py-1 text-ui-xs leading-relaxed text-foreground-subtle">
                      <div>
                        {t("run.metrics.window", {
                          runs: numeric(data().window.runs),
                          covered: numeric(data().window.eventsCovered),
                        })}
                      </div>
                      <div class="flex flex-wrap gap-x-2 gap-y-0.5">
                        <For each={data().states}>
                          {(entry) => (
                            <span>
                              {stateLabel(entry.state)} {numeric(entry.runs)}
                            </span>
                          )}
                        </For>
                      </div>
                      <div class="flex flex-wrap gap-x-2 gap-y-0.5">
                        <span>{t("run.metrics.settled", { n: numeric(data().tokens.settled).toLocaleString() })}</span>
                        {/* 用量不明单独显示：不并入已结算，也不并进总数。 */}
                        <Show when={numeric(data().tokens.unknown) > 0}>
                          <span class="text-warning">
                            {t("run.metrics.unknown", { n: numeric(data().tokens.unknown).toLocaleString() })}
                          </span>
                        </Show>
                        <span class="text-foreground-subtlest">
                          {t("run.metrics.coverage", {
                            covered: numeric(data().tokens.covered),
                            runs: numeric(data().window.runs),
                          })}
                        </span>
                        <Show when={numeric(data().tokens.overrunRuns) > 0}>
                          <span class="text-destructive">
                            {t("run.metrics.overrun", { n: numeric(data().tokens.overrunRuns) })}
                          </span>
                        </Show>
                        {/* 成本只统计有提供方回报的运行；覆盖率单列，不把缺数据的运行当 0。 */}
                        <Show when={numeric(data().tokens.costCovered) > 0}>
                          <span title={t("run.metrics.costHint")}>
                            {t("run.metrics.cost", {
                              n: numeric(data().tokens.cost).toFixed(4),
                              runs: numeric(data().tokens.costCovered),
                            })}
                          </span>
                        </Show>
                      </div>
                      <div class="flex flex-wrap gap-x-2 gap-y-0.5">
                        <For each={data().rounds}>
                          {(entry) => (
                            <span>
                              {t("run.metrics.round", { round: numeric(entry.round), runs: numeric(entry.runs) })}
                            </span>
                          )}
                        </For>
                      </div>
                      <Show when={numeric(data().rework.total) > 0}>
                        <div class="flex flex-col gap-0.5">
                          <span>{t("run.metrics.rework", { n: numeric(data().rework.total) })}</span>
                          <For each={data().rework.top}>
                            {(entry) => (
                              <span class="truncate pl-2 text-foreground-subtlest" title={entry.reason}>
                                {entry.reason} × {numeric(entry.count)}
                              </span>
                            )}
                          </For>
                        </div>
                      </Show>
                      <div>
                        {data().attempts.failureRate !== undefined
                          ? t("run.metrics.failureRate", {
                              failed: numeric(data().attempts.failed),
                              dispatched: numeric(data().attempts.dispatched),
                              percent: Math.round(numeric(data().attempts.failureRate!) * 100),
                            })
                          : t("run.metrics.failureUnknown")}
                      </div>
                      <div>
                        {data().blockers.rate !== undefined
                          ? t("run.metrics.blocked", {
                              n: numeric(data().blockers.runs),
                              percent: Math.round(numeric(data().blockers.rate!) * 100),
                            })
                          : t("run.metrics.blockedUnknown")}
                      </div>
                      {/* 验证开销占比（§12）：只算有用途标注的结算；历史账本单列说明。 */}
                      <div>
                        {data().spend.verificationShare !== undefined
                          ? t("run.metrics.verification", {
                              percent: Math.round(numeric(data().spend.verificationShare!) * 100),
                              dispatch: numeric(data().spend.dispatch).toLocaleString(),
                              verification: numeric(data().spend.verification).toLocaleString(),
                            })
                          : t("run.metrics.verificationUnknown")}
                        <Show when={numeric(data().spend.partialRuns) > 0}>
                          <span class="text-foreground-subtlest">
                            {" "}
                            {t("run.metrics.verificationPartial", { n: numeric(data().spend.partialRuns) })}
                          </span>
                        </Show>
                      </div>
                      {/* 算不出来的指标要说出来：空着会被读成「没有这项」。 */}
                      <For each={data().unavailable}>
                        {(entry) => (
                          <div class="text-foreground-subtlest">
                            {t("run.metrics.unavailable", { metric: entry.metric, reason: entry.reason })}
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                )}
              </Show>
            </Show>
          </div>
        </aside>

        <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          <Show when={composing()}>
            <div class="flex flex-col gap-3 p-4">
              <div>
                <div class="text-15-medium text-foreground">{t("run.new.title")}</div>
                <div class="mt-1 text-ui-xs text-foreground-subtle">
                  {profiles().find((item) => item.id === profileID())?.description ?? t("run.new.hint")}
                </div>
                {/* 先说清顺序：创建 ≠ 开始跑。不写这一步，用户填完表单会以为活已经派下去了。 */}
                <ol class="mt-2 flex flex-col gap-1.5 rounded-md border border-border bg-surface px-2.5 py-2 text-ui-xs leading-relaxed text-foreground-subtle">
                  <For each={[t("run.new.step1"), t("run.new.step2"), t("run.new.step3")]}>
                    {(text, index) => (
                      <li class="flex items-start gap-2">
                        <span class="mt-px grid size-4 shrink-0 place-items-center rounded-full bg-primary/15 text-[10px] text-primary">
                          {index() + 1}
                        </span>
                        <span>{text}</span>
                      </li>
                    )}
                  </For>
                </ol>
              </div>
              <label class="flex flex-col gap-1">
                <span class="text-ui-xs text-foreground-subtle">{t("run.new.template")}</span>
                <select
                  class="h-9 w-full rounded-md border border-border bg-surface px-2 text-ui-base text-foreground outline-none"
                  value={profileID()}
                  onChange={(event) => setProfileID(event.currentTarget.value)}
                >
                  <For each={profiles()}>
                    {(profile) => (
                      <option value={profile.id}>
                        {profile.name} · {t("team.profiles.memberCount", { count: profile.memberCount })}
                      </option>
                    )}
                  </For>
                </select>
              </label>
              <label class="flex flex-col gap-1">
                <span class="text-ui-xs text-foreground-subtle">{t("run.new.goal")}</span>
                <textarea
                  class="min-h-16 resize-none rounded-md border border-border bg-surface px-2 py-1.5 text-ui-base text-foreground outline-none placeholder:text-foreground-subtle focus:border-border-focus"
                  rows={2}
                  value={goal()}
                  placeholder={t("run.new.goalPlaceholder")}
                  onInput={(event) => setGoal(event.currentTarget.value)}
                />
              </label>
              <label class="flex flex-col gap-1">
                <span class="text-ui-xs text-foreground-subtle">{t("run.new.acceptance")}</span>
                <textarea
                  class="min-h-24 resize-none rounded-md border border-border bg-surface px-2 py-1.5 text-ui-base text-foreground outline-none placeholder:text-foreground-subtle focus:border-border-focus"
                  rows={4}
                  value={criteria()}
                  placeholder={t("run.new.acceptancePlaceholder")}
                  onInput={(event) => setCriteria(event.currentTarget.value)}
                />
                <span class="text-ui-xs text-foreground-subtlest">{t("run.new.acceptanceHint")}</span>
              </label>
              <div class="grid gap-3 sm:grid-cols-2">
                <label class="flex flex-col gap-1">
                  <span class="text-ui-xs text-foreground-subtle">{t("run.new.scope")}</span>
                  <textarea
                    class="min-h-16 resize-none rounded-md border border-border bg-surface px-2 py-1.5 text-ui-base text-foreground outline-none placeholder:text-foreground-subtle focus:border-border-focus"
                    rows={2}
                    value={scope()}
                    placeholder={t("run.new.scopePlaceholder")}
                    onInput={(event) => setScope(event.currentTarget.value)}
                  />
                </label>
                <label class="flex flex-col gap-1">
                  <span class="text-ui-xs text-foreground-subtle">{t("run.new.constraints")}</span>
                  <textarea
                    class="min-h-16 resize-none rounded-md border border-border bg-surface px-2 py-1.5 text-ui-base text-foreground outline-none placeholder:text-foreground-subtle focus:border-border-focus"
                    rows={2}
                    value={constraints()}
                    placeholder={t("run.new.constraintsPlaceholder")}
                    onInput={(event) => setConstraints(event.currentTarget.value)}
                  />
                </label>
              </div>
              <span class="-mt-2 text-ui-xs text-foreground-subtlest">{t("run.new.briefHint")}</span>
              <label class="flex flex-col gap-1">
                <span class="text-ui-xs text-foreground-subtle">{t("run.new.mission")}</span>
                <select
                  class="h-8 rounded-md border border-border bg-surface px-2 text-ui-base text-foreground outline-none focus:border-border-focus"
                  value={missionID()}
                  onChange={(event) => setMissionID(event.currentTarget.value)}
                >
                  <option value="">{t("run.new.missionNone")}</option>
                  <For each={missions()}>
                    {(mission) => <option value={mission.id}>{mission.label + " · " + mission.goal}</option>}
                  </For>
                  <option value={NEW_MISSION}>{t("run.new.missionNew")}</option>
                </select>
                <Show when={missionID() === NEW_MISSION}>
                  <input
                    class="h-8 rounded-md border border-border bg-surface px-2 text-ui-base text-foreground outline-none placeholder:text-foreground-subtle focus:border-border-focus"
                    value={missionGoal()}
                    placeholder={t("run.new.missionGoalPlaceholder")}
                    onInput={(event) => setMissionGoal(event.currentTarget.value)}
                  />
                </Show>
                <span class="text-ui-xs text-foreground-subtlest">{t("run.new.missionHint")}</span>
              </label>
              <div class="flex flex-wrap items-center gap-3">
                <label class="flex items-center gap-2">
                  <span class="text-ui-xs text-foreground-subtle">{t("run.new.budget")}</span>
                  <input
                    type="number"
                    min="1000"
                    step="1000"
                    class="h-8 w-32 rounded-md border border-border bg-surface px-2 text-ui-base text-foreground outline-none focus:border-border-focus"
                    value={budget()}
                    onInput={(event) => setBudget(Number(event.currentTarget.value) || 0)}
                  />
                </label>
                {/* 墙钟上限（§7.3）：0 表示不限；超过即停的是新的派发，不是正在跑的。 */}
                <label class="flex items-center gap-2">
                  <span class="text-ui-xs text-foreground-subtle">{t("run.new.wall")}</span>
                  <input
                    type="number"
                    min="0"
                    step="5"
                    class="h-8 w-24 rounded-md border border-border bg-surface px-2 text-ui-base text-foreground outline-none focus:border-border-focus"
                    value={wallMinutes()}
                    onInput={(event) => setWallMinutes(Number(event.currentTarget.value) || 0)}
                  />
                </label>
                {/* 成本上限（§7.3）：同样 0 表示不限；成本只在调用返回后才有权威值。 */}
                <label class="flex items-center gap-2">
                  <span class="text-ui-xs text-foreground-subtle">{t("run.new.cost")}</span>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    class="h-8 w-24 rounded-md border border-border bg-surface px-2 text-ui-base text-foreground outline-none focus:border-border-focus"
                    value={costCap()}
                    onInput={(event) => setCostCap(Number(event.currentTarget.value) || 0)}
                  />
                </label>
              </div>
              <div class="flex flex-wrap items-center gap-1.5">
                <Button
                  variant="primary"
                  size="small"
                  disabled={busy() !== "" || !goal().trim() || !criteria().trim()}
                  onClick={() => void start()}
                >
                  {busy() === "create" ? t("run.new.creating") : t("run.new.start")}
                </Button>
                <Button variant="ghost" size="small" onClick={() => setComposing(false)}>
                  {t("run.new.cancel")}
                </Button>
                <span class="text-ui-xs text-foreground-subtlest">{t("run.new.approvalHint")}</span>
              </div>
            </div>
          </Show>
          <Show when={!composing()}>
            <Show
              when={detail()}
              fallback={
                <div class="flex h-full items-center justify-center p-6">
                  <div class="w-full max-w-md rounded-xl border border-border bg-surface p-5 text-center">
                    <div class="text-15-medium text-foreground">{t("run.empty.title")}</div>
                    <div class="mt-1 text-ui-xs leading-relaxed text-foreground-subtle">{t("run.empty.hint")}</div>
                    <div class="mt-3 text-left text-ui-xs text-foreground-subtle">{t("run.empty.steps")}</div>
                    <ol class="mt-1 flex flex-col gap-1.5 text-left text-ui-xs leading-relaxed text-foreground-subtle">
                      <For each={emptySteps()}>
                        {(step, index) => (
                          <li class="flex items-start gap-2">
                            <span
                              class="mt-px grid size-4 shrink-0 place-items-center rounded-full text-[10px]"
                              classList={{
                                "bg-success/15 text-success": step.done,
                                "bg-primary/15 text-primary": !step.done && index() === (profiles().length > 0 ? 1 : 0),
                                "bg-border text-foreground-subtle":
                                  !step.done && index() !== (profiles().length > 0 ? 1 : 0),
                              }}
                            >
                              <Show when={step.done} fallback={index() + 1}>
                                <Icon name="circle-check" size="small" />
                              </Show>
                            </span>
                            <span>{step.text}</span>
                          </li>
                        )}
                      </For>
                    </ol>
                    <Show
                      when={profiles().length > 0}
                      fallback={
                        <div class="mt-3 text-ui-xs leading-relaxed text-foreground-subtlest">
                          {t("run.empty.noProfile")}
                        </div>
                      }
                    >
                      <Button variant="primary" size="small" class="mt-3" onClick={() => setComposing(true)}>
                        {t("run.empty.action")}
                      </Button>
                    </Show>
                  </div>
                </div>
              }
            >
              {(data) => (
                <div class="flex flex-col gap-3 p-4">
                  {/*
                    「现在该做什么」放在最上面：一个标题、一句解释、一个按钮。
                    看板的其他部分都是证据与细节，不该让人先读一遍才知道下一步点哪里。
                  */}
                  <Show when={nextStep()}>
                    {(step) => (
                      <div class="flex flex-col gap-2 rounded-lg border border-border bg-surface px-3 py-2">
                        {/* 步骤条：先让人看到全局，再读「现在该做什么」。 */}
                        <RunGuide steps={guideSteps()} />
                        <div class="flex flex-wrap items-center gap-3 border-t border-border pt-2">
                          <div class="min-w-0 flex-1">
                            <div class="text-15-medium text-foreground">{step().title}</div>
                            <div class="mt-0.5 text-ui-xs leading-relaxed text-foreground-subtle">{step().hint}</div>
                            <Show when={guideNote()}>
                              {(note) => <div class="mt-1 text-ui-xs leading-relaxed text-warning">{note()}</div>}
                            </Show>
                          </div>
                          <Show when={step().action}>
                            {(action) => (
                              <Button
                                variant="primary"
                                size="small"
                                disabled={busy() !== ""}
                                onClick={() => void action().run()}
                              >
                                {busy() === action().busy ? t("run.action.working") : action().label}
                              </Button>
                            )}
                          </Show>
                        </div>
                      </div>
                    )}
                  </Show>
                  <div class="flex items-start gap-2">
                    <div class="min-w-0 flex-1">
                      <div class="truncate text-15-medium text-foreground">{data().run.goal}</div>
                      {/* 用户自己声明的范围与约束（§5.3）：它们确实进了队长提示词，这里可回看。 */}
                      <Show when={data().run.brief}>
                        {(brief) => (
                          <div
                            class="mt-0.5 truncate text-ui-xs text-foreground-subtle"
                            title={[brief().scope?.join("、"), brief().constraints?.join("、"), brief().context]
                              .filter(Boolean)
                              .join(" ｜ ")}
                          >
                            {t("run.brief", {
                              scope: (brief().scope ?? []).join("、") || t("run.brief.none"),
                              constraints: (brief().constraints ?? []).join("、") || t("run.brief.none"),
                            })}
                          </div>
                        )}
                      </Show>
                      <div class="mt-1 flex flex-wrap items-center gap-1.5">
                        <Tag>{runStateLabel(data().run)}</Tag>
                        {/*
                          §4.3：头部要同时给运行状态与当前阶段。阶段只做展示
                          （调度器不拿它做判断），但它回答「现在卡在哪一步」。
                        */}
                        <Show when={data().run.phase}>
                          {(phase) => <Tag title={t("run.phaseHint")}>{t(`run.phase.${phase()}`)}</Tag>}
                        </Show>
                        <Tag>{data().run.mode}</Tag>
                        {/* 只读 / 可写是这次运行的实际授权，不是提示词里的承诺。 */}
                        <Tag title={t("run.policy.hint")}>
                          {data().run.readOnly ? t("run.policy.readOnly") : t("run.policy.write")}
                        </Tag>
                        <Show when={currentMission()}>
                          {(mission) => (
                            <Tag title={mission().goal}>
                              {mission().label + " · " + t(`run.mission.status.${mission().status}`)}
                            </Tag>
                          )}
                        </Show>
                        <Tag>{"第 " + data().run.roundMain + " 轮"}</Tag>
                        {Number(data().run.planVersion) > 0 ? <Tag>{"计划 v" + data().run.planVersion}</Tag> : null}
                        {/*
                          合并状态单独一颗标签（§4.3）：`done` 说的是「交付通过验收」，
                          不是「已经合进你的分支」。没有这一颗，刷新之后看板就答不上「合没合」。
                        */}
                        <Show when={TERMINAL.has(data().run.state) || data().run.mergeState !== "unmerged"}>
                          <Tag
                            class={data().run.mergeState === "merge_failed" ? "text-destructive" : undefined}
                            title={t("run.merge.stateHint")}
                          >
                            {t(`run.merge.state.${data().run.mergeState}`)}
                          </Tag>
                        </Show>
                        {/*
                          §4.3：头部要同时给「预算用了多少 / 上限」与墙钟。
                          预算按承诺量（已结算 + 用量不明 + 在途预占）算 —— 只报已结算会让
                          「还剩多少」在运行中一直是假的。
                        */}
                        <Show when={data().run.usage}>
                          {(usage) => (
                            <Tag title={t("run.usage.capHint")}>
                              {t("run.usage.cap", {
                                used: (
                                  numeric(usage().reserved) +
                                  numeric(usage().settled) +
                                  numeric(usage().unknown)
                                ).toLocaleString(),
                                cap: numeric(usage().cap).toLocaleString(),
                              })}
                            </Tag>
                          )}
                        </Show>
                        <Show when={data().run.startedAt}>
                          {(started) => (
                            <Tag title={t("run.wall.hint")}>
                              {t("run.wall", {
                                time: elapsed(numeric(data().run.endedAt ?? Date.now()) - numeric(started())),
                              })}
                            </Tag>
                          )}
                        </Show>
                      </div>
                      {/*
                        终态/阻塞的原因：接口一直有 `run.error`，界面却从不显示 ——
                        用户只看到「失败」两个字，不知道是名册坏了、集成冲突还是没交付。
                        这里只放内核写下的那句总结（团队 id / 原因），不放任何事件原文。
                      */}
                      <Show when={data().run.error}>
                        {(reason) => (
                          <div class="mt-1 text-ui-xs text-foreground-subtle" title={reason()}>
                            {t("run.reason", { reason: reason() })}
                          </div>
                        )}
                      </Show>
                    </div>
                  </div>

                  <div class="grid grid-cols-4 gap-2">
                    <div class="rounded-lg border border-border bg-surface px-3 py-2">
                      <div class="text-ui-xs text-foreground-subtle" title={t("run.metric.passHint")}>
                        {t("run.metric.pass")}
                      </div>
                      <div class="text-18-medium text-success">{summary()?.pass ?? 0}</div>
                    </div>
                    <div class="rounded-lg border border-border bg-surface px-3 py-2">
                      <div class="text-ui-xs text-foreground-subtle" title={t("run.metric.failHint")}>
                        {t("run.metric.fail")}
                      </div>
                      <div class="text-18-medium text-destructive">{summary()?.fail ?? 0}</div>
                    </div>
                    <div class="rounded-lg border border-border bg-surface px-3 py-2">
                      <div class="text-ui-xs text-foreground-subtle" title={t("run.metric.unverifiedHint")}>
                        {t("run.metric.unverified")}
                      </div>
                      {/* 未验证用警示色，不是绿色也不是灰色：它不是通过。 */}
                      <div class="text-18-medium text-warning">{summary()?.unverified ?? 0}</div>
                    </div>
                    <div class="rounded-lg border border-border bg-surface px-3 py-2">
                      <div class="text-ui-xs text-foreground-subtle" title={t("run.metric.staleHint")}>
                        {t("run.metric.stale")}
                      </div>
                      <div class="text-18-medium text-warning">{summary()?.stale ?? 0}</div>
                    </div>
                  </div>

                  <Show when={currentMission()}>
                    {(mission) => (
                      <div class="flex flex-col gap-1 rounded-lg border border-border px-3 py-2">
                        <div class="flex flex-wrap items-center gap-1.5 text-ui-xs text-foreground-subtle">
                          <span>{t("run.mission.title", { label: mission().label })}</span>
                          <Tag title={t("run.mission.statusHint")}>{t(`run.mission.status.${mission().status}`)}</Tag>
                          <Show when={missionDiff()?.skippedReason}>
                            {(reason) => <span class="text-warning">{reason()}</span>}
                          </Show>
                          <Show when={missionDiff()?.head}>
                            {(head) => (
                              <span class="text-foreground-subtlest">
                                {t("run.mission.head", { sha: head().slice(0, 7) })}
                              </span>
                            )}
                          </Show>
                          <div class="ml-auto flex items-center gap-1">
                            <Show when={mission().status !== "done"}>
                              <Button
                                variant="ghost"
                                size="small"
                                disabled={busy() === "mission"}
                                onClick={() => void setMissionStatus("done")}
                              >
                                {t("run.mission.markDone")}
                              </Button>
                            </Show>
                            <Show when={mission().status !== "abandoned"}>
                              <Button
                                variant="ghost"
                                size="small"
                                disabled={busy() === "mission"}
                                onClick={() => void setMissionStatus("abandoned")}
                              >
                                {t("run.mission.abandon")}
                              </Button>
                            </Show>
                            <Show when={mission().status !== "active"}>
                              <Button
                                variant="ghost"
                                size="small"
                                disabled={busy() === "mission"}
                                onClick={() => void setMissionStatus("active")}
                              >
                                {t("run.mission.reopen")}
                              </Button>
                            </Show>
                            <Show when={mission().status === "abandoned" && !!mission().worktree}>
                              <Button
                                variant="ghost"
                                size="small"
                                disabled={busy() === "mission"}
                                onClick={() => void cleanupMission()}
                              >
                                {t("run.mission.cleanup")}
                              </Button>
                            </Show>
                          </div>
                        </div>
                        <Show when={missionDiff()?.files?.length}>
                          <div class="flex flex-wrap items-center gap-1.5">
                            <Tag class="text-success">
                              {"+" + (missionDiff()?.files ?? []).reduce((sum, file) => sum + numeric(file.added), 0)}
                            </Tag>
                            <Tag class="text-destructive">
                              {"-" + (missionDiff()?.files ?? []).reduce((sum, file) => sum + numeric(file.removed), 0)}
                            </Tag>
                            <span class="text-ui-xs text-foreground-subtle">
                              {t("run.mission.files", { count: String((missionDiff()?.files ?? []).length) })}
                            </span>
                          </div>
                        </Show>
                        <For each={(missionDiff()?.files ?? []).slice(0, 5)}>
                          {(file) => (
                            <div class="flex items-center gap-1.5 text-ui-xs text-foreground-subtle">
                              <span class="min-w-0 flex-1 truncate">{file.path}</span>
                              <span class="shrink-0 text-success">{"+" + numeric(file.added)}</span>
                              <span class="shrink-0 text-destructive">{"-" + numeric(file.removed)}</span>
                            </div>
                          )}
                        </For>
                        <Show when={(missionDiff()?.files ?? []).length > 5 || missionDiff()?.truncated}>
                          <span class="text-ui-xs text-foreground-subtlest">{t("run.mission.more")}</span>
                        </Show>
                        {/* 未跟踪文件不是已交付：单独说清楚，不并进上面的改动数字。 */}
                        <Show when={(missionDiff()?.untracked ?? []).length > 0}>
                          <span class="text-ui-xs text-warning">
                            {t("run.mission.untracked", { count: String((missionDiff()?.untracked ?? []).length) })}
                          </span>
                        </Show>
                      </div>
                    )}
                  </Show>

                  {/*
                    截断必须可见（§6.4）：自己少给了模型几条，就不能在复盘时怪模型没看到。
                    清单在每次派发时落库，这里只显示「哪一队、少了什么、为什么」。
                  */}
                  <Show when={truncations().length > 0}>
                    <div class="flex flex-col gap-1 rounded-lg border border-border bg-surface px-3 py-2">
                      <div class="text-ui-xs text-warning">
                        {t("run.context.truncated", { count: String(truncations().length) })}
                      </div>
                      <For each={truncations()}>
                        {(item) => (
                          <div class="text-ui-xs text-foreground-subtle">
                            {item.teamID +
                              " · " +
                              item.kind +
                              " " +
                              t("run.context.omitted", { count: String(item.count) })}
                            <span class="text-foreground-subtlest">{" " + item.reason}</span>
                          </div>
                        )}
                      </For>
                      <div class="text-ui-xs text-foreground-subtlest">{t("run.context.hint")}</div>
                    </div>
                  </Show>

                  {/*
                    阻塞与拒绝（§11.2）：拒绝不能被静默吞掉。权限类要标出「换成别人也没用」——
                    换一个「权限更高」的人做同一件事就是提权，只能由用户放行。
                  */}
                  {/*
                    待核对的操作（§8.5）：重启时有工具停在「已开始、结果未写回」。
                    在清空之前，这次运行不能自动续跑 —— 先把副作用（文件 / 进程 / 提交）核对掉。
                    只显示工具名与开始时间：参数里常有命令与凭据。
                  */}
                  <Show when={(data().needsReview ?? []).length > 0}>
                    <div class="flex flex-col gap-1 rounded-lg border border-warning bg-surface px-3 py-2">
                      <div class="text-ui-xs text-warning" title={t("run.review.hint")}>
                        {t("run.review.title", { count: String(data().needsReview.length) })}
                      </div>
                      <For each={data().needsReview}>
                        {(op) => (
                          <div class="flex flex-wrap items-center gap-1.5 text-ui-xs text-foreground-subtle">
                            <Tag>{op.tool}</Tag>
                            <Tag>{op.outcome}</Tag>
                            <span class="min-w-0 flex-1 truncate">
                              {t("run.review.startedAt", { time: new Date(numeric(op.startedAt)).toLocaleString() })}
                            </span>
                            {/* 核对结论要能写回去：否则这个面板只能看、不能处理，运行永远续不上。 */}
                            <Button
                              variant="ghost"
                              size="small"
                              disabled={busy() !== ""}
                              title={t("run.review.happenedHint")}
                              onClick={() => void reviewOp(op.id, "succeeded")}
                            >
                              {t("run.review.happened")}
                            </Button>
                            <Button
                              variant="ghost"
                              size="small"
                              disabled={busy() !== ""}
                              title={t("run.review.missedHint")}
                              onClick={() => void reviewOp(op.id, "abandoned")}
                            >
                              {t("run.review.missed")}
                            </Button>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                  <Show when={(data().denials ?? []).length > 0}>
                    <div class="flex flex-col gap-1 rounded-lg border border-border bg-surface px-3 py-2">
                      <div class="flex items-center justify-between gap-2">
                        <div class="text-ui-xs text-warning" title={t("run.denials.hint")}>
                          {t("run.denials.title", { count: String(data().denials.length) })}
                        </div>
                        {/* 放行是人的决定：模型没有接口把自己被拒的动作重新打开。 */}
                        <Button
                          variant="ghost"
                          size="small"
                          disabled={busy() !== ""}
                          onClick={() => void allowDenied()}
                        >
                          {t("run.denials.clear")}
                        </Button>
                      </div>
                      <For each={data().denials}>
                        {(denial) => (
                          <div class="flex flex-wrap items-center gap-1.5 text-ui-xs text-foreground-subtle">
                            <Tag>{denial.tool}</Tag>
                            <span class="min-w-0 flex-1 truncate">{denial.reason ?? ""}</span>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                  <Show when={(data().blockers ?? []).length > 0}>
                    <div class="flex flex-col gap-1 rounded-lg border border-border bg-surface px-3 py-2">
                      <div class="text-ui-xs text-destructive">
                        {t("run.blocked.title", { count: String((data().blockers ?? []).length) })}
                      </div>
                      <For each={data().blockers ?? []}>
                        {(blocker) => (
                          <div class="flex flex-wrap items-center gap-1.5 text-ui-xs text-foreground-subtle">
                            <Tag>{blocker.kind}</Tag>
                            <Show when={blocker.tool}>{(tool) => <Tag>{tool()}</Tag>}</Show>
                            <span class="min-w-0 flex-1 truncate">{blocker.reason ?? ""}</span>
                            <span class={blocker.swappable ? "text-foreground-subtlest" : "text-warning"}>
                              {blocker.swappable ? t("run.blocked.swappable") : t("run.blocked.noSwap")}
                            </span>
                            {/* §4.3：每个阻塞都能一键跳到对应会话处理，看板只给结论。 */}
                            <Show when={props.onOpenSession}>
                              <Button
                                variant="ghost"
                                size="small"
                                title={t("run.action.openSessionHint")}
                                onClick={() => props.onOpenSession?.(data().run.sessionID)}
                              >
                                {t("run.action.openSession")}
                              </Button>
                            </Show>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>

                  {/* 成本分两列：已结算只算提供方回报的用量，用量不明单独一列，不冒充实际花费。 */}
                  <Show when={data().run.usage}>
                    {(usage) => (
                      <div class="flex flex-col gap-1 rounded-lg border border-border px-3 py-2">
                        <div class="flex flex-wrap items-center gap-1.5 text-ui-xs">
                          <span class="text-foreground-subtle">{t("run.usage.budget")}</span>
                          <Tag title={t("run.usage.capHint")}>
                            {t("run.usage.cap", {
                              used: (
                                numeric(usage().reserved) +
                                numeric(usage().settled) +
                                numeric(usage().unknown)
                              ).toLocaleString(),
                              cap: numeric(usage().cap).toLocaleString(),
                            })}
                          </Tag>
                          <Show when={usage().overrun}>
                            <Tag class="text-destructive">{t("run.usage.overrun")}</Tag>
                          </Show>
                        </div>
                        <div class="flex flex-wrap items-center gap-1.5 text-ui-xs text-foreground-subtle">
                          <span>{t("run.usage.settled", { n: numeric(usage().settled).toLocaleString() })}</span>
                          <span>{t("run.usage.unknown", { n: numeric(usage().unknown).toLocaleString() })}</span>
                          <span>{t("run.usage.reserved", { n: numeric(usage().reserved).toLocaleString() })}</span>
                          {/* 成本只在提供方回报时出现：老运行与免费模型不该显示一个假的 0。 */}
                          <Show when={usage().cost !== undefined}>
                            <span title={t("run.usage.costHint")}>
                              {t("run.usage.cost", { n: numeric(usage().cost ?? 0).toFixed(4) })}
                            </span>
                          </Show>
                        </div>
                      </div>
                    )}
                  </Show>

                  <Show when={(data().run.usage?.byJob ?? []).length > 0}>
                    <div class="flex flex-col gap-1.5">
                      <div class="text-ui-xs text-foreground-subtle">{t("run.usage.title")}</div>
                      <div class="flex flex-wrap items-center gap-1.5">
                        <For each={data().run.usage?.byJob ?? []}>
                          {(item) => (
                            <Tag title={t("run.usage.hint")}>{item.job + " · " + item.committed.toLocaleString()}</Tag>
                          )}
                        </For>
                      </div>
                      <div class="text-ui-xs text-foreground-subtlest">{t("run.usage.hint")}</div>
                    </div>
                  </Show>

                  <div class="flex flex-col gap-1.5">
                    <div class="flex items-center justify-between gap-2">
                      <div class="text-ui-xs text-foreground-subtle">{t("run.page.about")}</div>
                      {/*
                        命令类验收（§19.1）：退出码就是结论，不交给模型去评。
                        命令由人写、由人负责；写完之后界面不再回显它。
                      */}
                      <Button
                        variant="ghost"
                        size="small"
                        title={t("run.acceptance.commandHint")}
                        onClick={() => setCommandOpen((open) => !open)}
                      >
                        {t("run.acceptance.command")}
                      </Button>
                    </div>
                    <Show when={commandOpen()}>
                      <div class="flex flex-col gap-1.5 rounded-lg border border-border bg-surface px-3 py-2">
                        <div class="text-ui-xs text-foreground-subtlest">{t("run.acceptance.commandHint")}</div>
                        <input
                          class="h-8 rounded-md border border-border bg-surface px-2 text-ui-base text-foreground outline-none placeholder:text-foreground-subtle focus:border-border-focus"
                          value={commandText()}
                          placeholder={t("run.acceptance.commandText")}
                          onInput={(event) => setCommandText(event.currentTarget.value)}
                        />
                        <input
                          class="h-8 rounded-md border border-border bg-surface px-2 font-mono text-ui-base text-foreground outline-none placeholder:text-foreground-subtle focus:border-border-focus"
                          value={commandRun()}
                          placeholder={t("run.acceptance.commandRun")}
                          onInput={(event) => setCommandRun(event.currentTarget.value)}
                        />
                        <div class="flex flex-wrap items-center gap-2">
                          <span class="text-ui-xs text-foreground-subtle">{t("run.acceptance.commandTimeout")}</span>
                          <input
                            type="number"
                            min="0"
                            step="10"
                            class="h-8 w-24 rounded-md border border-border bg-surface px-2 text-ui-base text-foreground outline-none focus:border-border-focus"
                            value={commandSeconds()}
                            onInput={(event) => setCommandSeconds(Number(event.currentTarget.value) || 0)}
                          />
                          <Button
                            variant="primary"
                            size="small"
                            disabled={busy() !== "" || !commandText().trim() || !commandRun().trim()}
                            onClick={() => void addCommandAcceptance()}
                          >
                            {t("run.acceptance.commandAdd")}
                          </Button>
                        </div>
                      </div>
                    </Show>
                    <Show
                      when={(data().summary.lines ?? []).length > 0}
                      fallback={
                        <div class="px-1 py-2 text-ui-xs text-foreground-subtlest">{t("run.acceptance.empty")}</div>
                      }
                    >
                      <For each={data().summary.lines ?? []}>
                        {(line) => (
                          <div class="rounded-lg border border-border">
                            {/*
                              每个结论都能点开：验证器、绑定快照、实测值、证据引用。
                              「通过」若看不到依据，就只是一个颜色。
                            */}
                            <button
                              type="button"
                              class="flex w-full items-start gap-2 px-3 py-2 text-left"
                              title={t("run.evidence.hint")}
                              onClick={() =>
                                setOpenLine((current) =>
                                  current === line.acceptanceID ? undefined : line.acceptanceID,
                                )
                              }
                            >
                              <span
                                classList={{
                                  "mt-1 size-2 shrink-0 rounded-full": true,
                                  "bg-success": line.outcome === "pass",
                                  "bg-destructive": line.outcome === "fail",
                                  "bg-warning": line.outcome !== "pass" && line.outcome !== "fail",
                                }}
                              />
                              <div class="min-w-0 flex-1">
                                <div class="text-ui-base text-foreground">{line.text}</div>
                                <div class="mt-0.5 flex flex-wrap items-center gap-1.5 text-ui-xs text-foreground-subtle">
                                  <Tag>{line.outcome}</Tag>
                                  {/* 档位由调度器按改动面判定：点开提示能看到它为什么验得轻 / 重（§19.1）。 */}
                                  <Show when={line.tier}>
                                    {(tier) => (
                                      <Tag title={line.tierReason ?? t("run.tierHint")}>{t(`run.tier.${tier()}`)}</Tag>
                                    )}
                                  </Show>
                                  <Show when={acceptanceFor(line.acceptanceID)?.verifier}>
                                    {(verifier) => (
                                      <Tag title={t("run.acceptance.commandTagHint")}>
                                        {t("run.acceptance.commandTag", {
                                          seconds: String(Math.round(numeric(verifier().timeoutMs ?? 0) / 1000)),
                                        })}
                                      </Tag>
                                    )}
                                  </Show>
                                  <Show when={line.measured}>{(measured) => <span>{measured()}</span>}</Show>
                                  {/* 驳回时的「建议」是下一步动作，和实测值一样要紧（§4.3）。 */}
                                  <Show when={line.suggestion}>
                                    {(suggestion) => (
                                      <span class="text-foreground-subtle">
                                        {t("run.evidence.suggestion", { text: suggestion() })}
                                      </span>
                                    )}
                                  </Show>
                                  <Show when={line.snapshotID}>
                                    {(snapshot) => <span class="truncate">{snapshot()}</span>}
                                  </Show>
                                </div>
                              </div>
                            </button>
                            <Show when={openLine() === line.acceptanceID}>
                              <div class="flex flex-col gap-1 border-t border-border px-3 py-2">
                                <div class="text-ui-xs text-foreground-subtle">{t("run.evidence.title")}</div>
                                <Show
                                  when={evidenceFor(line.acceptanceID).length > 0}
                                  fallback={<div class="text-ui-xs text-warning">{t("run.evidence.empty")}</div>}
                                >
                                  <For each={evidenceFor(line.acceptanceID)}>
                                    {(record) => (
                                      <div class="flex flex-wrap items-center gap-1.5 text-ui-xs text-foreground-subtle">
                                        <Tag>{t("run.evidence.attempt", { n: record.attempt })}</Tag>
                                        <Tag>{record.outcome}</Tag>
                                        <Show when={record.tier}>
                                          {(tier) => (
                                            <Tag title={record.tierReason ?? t("run.tierHint")}>
                                              {t(`run.tier.${tier()}`)}
                                            </Tag>
                                          )}
                                        </Show>
                                        <span class="truncate">{record.verifierVersion}</span>
                                        <span class="truncate">{record.snapshotID}</span>
                                        <Show when={record.measured}>
                                          {(measured) => <span class="truncate">{measured()}</span>}
                                        </Show>
                                        <Show when={record.suggestion}>
                                          {(suggestion) => (
                                            <span class="min-w-0 truncate">
                                              {t("run.evidence.suggestion", { text: suggestion() })}
                                            </span>
                                          )}
                                        </Show>
                                        <Show when={record.evidenceRef}>
                                          {(ref) => <span class="min-w-0 truncate">{ref()}</span>}
                                        </Show>
                                        {/* 缓存命中也算证据，但必须看得出它不是这次新验的（§19.1）。 */}
                                        <Show when={record.reused}>
                                          <Tag class="text-warning" title={t("run.evidence.reusedHint")}>
                                            {t("run.evidence.reused")}
                                          </Tag>
                                        </Show>
                                      </div>
                                    )}
                                  </For>
                                </Show>
                              </div>
                            </Show>
                          </div>
                        )}
                      </For>
                    </Show>
                  </div>

                  <div class="flex flex-wrap items-center gap-1.5">
                    <For each={data().teams}>
                      {(team) => (
                        // 有 worktree 就把它挂在提示里：证据绑定的是那个目录的快照；
                        // 有产物就连版本一起显示 —— 下游依赖的是具体版本，不是「大概那一版」。
                        <Tag
                          title={[
                            team.worktree ?? "",
                            (team.artifacts ?? []).map((item) => item.name + "@" + item.version).join(" "),
                            // 任务范围（§11.1）：越界写会被拦下，界面要能回答「为什么」。
                            team.scope?.length ? t("run.team.scope", { paths: (team.scope ?? []).join("、") }) : "",
                          ]
                            .filter(Boolean)
                            .join(String.fromCharCode(10))}
                        >
                          {team.id + " · " + team.phase}
                          {team.dependsOn.length > 0
                            ? " · " +
                              t("run.team.deps", {
                                deps: team.dependsOn.map((dep) => "#" + (numeric(dep) + 1)).join("、"),
                              })
                            : ""}
                        </Tag>
                      )}
                    </For>
                  </div>

                  {/*
                    任务板（§5.5 / §4.3）：只显示做法与进度。
                    任务存在不代表有会话正在做 —— 界面上也不替它做这个暗示。
                  */}
                  <Show when={board().length > 0}>
                    <div class="flex flex-col gap-1 rounded-lg border border-border px-3 py-2">
                      <div class="flex items-center gap-2 text-ui-xs text-foreground-subtle">
                        <span class="text-foreground-subtlest">
                          {t("run.tasks.title", { count: String(board().length) })}
                        </span>
                        <span class="min-w-0 flex-1 truncate text-foreground-subtlest">{t("run.tasks.hint")}</span>
                      </div>
                      <For each={board()}>
                        {(task) => (
                          <div class="flex flex-wrap items-center gap-1.5 text-ui-xs text-foreground-subtle">
                            <Tag>{task.status}</Tag>
                            <span class="min-w-0 flex-1 truncate">{task.subject}</span>
                            <span class="shrink-0 text-foreground-subtlest">
                              {t("run.tasks.owner", { owner: task.owner ?? "—" })}
                            </span>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>

                  {/*
                    事件流（§4.3 / §12）：只读、可展开、按需加载。
                    只显示种类与时间，不展开 payload —— 里面可能有命令与路径，
                    它们属于「要复跑时去本地读」的那一类，不该直接铺在界面上。
                  */}
                  <div class="flex flex-col gap-1.5">
                    <Button
                      variant="ghost"
                      size="small"
                      class="justify-start"
                      disabled={loadingEvents()}
                      onClick={() => void toggleEvents(data().run.id)}
                    >
                      <Icon name={showEvents() ? "chevron-down" : "chevron-right"} size="small" />
                      {showEvents() ? t("run.events.toggleCount", { count: eventCount() }) : t("run.events.toggle")}
                    </Button>
                    <Show when={showEvents()}>
                      <div class="flex flex-col gap-1 rounded-lg border border-border px-3 py-2">
                        <Show
                          when={events().length > 0}
                          fallback={<div class="text-ui-xs text-foreground-subtlest">{t("run.events.empty")}</div>}
                        >
                          <For each={events()}>
                            {(event) => (
                              <div class="flex items-center gap-2 text-ui-xs text-foreground-subtle">
                                <span class="w-10 shrink-0 text-foreground-subtlest">{"#" + event.seq}</span>
                                <span class="min-w-0 flex-1 truncate">{event.kind}</span>
                                <span class="shrink-0 text-foreground-subtlest">
                                  {new Date(Number(event.at) || 0).toLocaleTimeString()}
                                </span>
                              </div>
                            )}
                          </For>
                        </Show>
                        <div class="text-ui-xs text-foreground-subtlest">{t("run.events.hint")}</div>
                      </div>
                    </Show>
                  </div>
                  {/*
                    决策链回放（§12）：回答「为什么它认为完成了」。
                    和「重跑」不是一回事（§8.5）—— 文案里不承诺重新执行会得到同样结果。
                  */}
                  <div class="flex flex-col gap-1.5">
                    <Button
                      variant="ghost"
                      size="small"
                      class="justify-start"
                      disabled={loadingReplay()}
                      onClick={() => void toggleReplay(data().run.id)}
                    >
                      <Icon name={showReplay() ? "chevron-down" : "chevron-right"} size="small" />
                      {t("run.replay.toggle")}
                    </Button>
                    <Show when={showReplay() && replayRunID() === data().run.id && replay()}>
                      {(chain) => (
                        <div class="flex flex-col gap-2 rounded-lg border border-border px-3 py-2">
                          <div class="flex flex-wrap items-center gap-1.5">
                            <Tag>{stateLabel(chain().conclusion.state)}</Tag>
                            <Tag>{t(`run.replay.verdict.${chain().conclusion.verdict}`)}</Tag>
                            <span class="text-ui-xs text-foreground-subtle">
                              {t("run.replay.counts", {
                                pass: numeric(chain().conclusion.counts.pass),
                                fail: numeric(chain().conclusion.counts.fail),
                                unverified: numeric(chain().conclusion.counts.unverified),
                                stale: numeric(chain().conclusion.counts.stale),
                              })}
                            </span>
                          </div>
                          {/* 必须照实说的边界：未验证/过期不计入通过、结论是否有事件背书。 */}
                          <For each={chain().conclusion.notes}>
                            {(note) => <div class="text-ui-xs text-warning">{note}</div>}
                          </For>
                          <Show when={chain().steps.length > 0}>
                            <div class="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
                              <For each={chain().steps}>
                                {(step) => (
                                  <div class="flex items-center gap-2 text-ui-xs text-foreground-subtle">
                                    <span class="w-10 shrink-0 text-foreground-subtlest">
                                      {"#" + numeric(step.seq)}
                                    </span>
                                    <span class="min-w-0 flex-1 truncate">{step.kind}</span>
                                    <Show when={step.teamID}>
                                      {(teamID) => <span class="shrink-0 text-foreground-subtlest">{teamID()}</span>}
                                    </Show>
                                    <Show when={step.round !== undefined}>
                                      <span class="shrink-0 text-foreground-subtlest">
                                        {t("run.replay.round", { round: numeric(step.round!) })}
                                      </span>
                                    </Show>
                                    <Show when={step.outcome}>{(outcome) => <Tag>{outcome()}</Tag>}</Show>
                                  </div>
                                )}
                              </For>
                            </div>
                          </Show>
                          <div class="text-ui-xs text-foreground-subtlest">{t("run.replay.hint")}</div>
                        </div>
                      )}
                    </Show>
                  </div>
                </div>
              )}
            </Show>
          </Show>
        </div>
      </div>
    </div>
  )
}
