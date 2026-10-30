import type { MissionDiffView, MissionView, RunDetail, RunView, TeamProfileView } from "@novaway/sdk/v2"
import { Button } from "@novaway/ui/button"
import { Icon } from "@novaway/ui/icon"
import { Tag } from "@novaway/ui/tag"
import { createMemo, createSignal, For, onCleanup, onMount, Show, type Component } from "solid-js"
import { PageHeader } from "@/components/page-header"
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
  const [composing, setComposing] = createSignal(false)
  const [goal, setGoal] = createSignal("")
  const [criteria, setCriteria] = createSignal("")
  const [budget, setBudget] = createSignal(100_000)
  // 持久目标（§3.2）：可选归属。选「新建」时会先建目标再建运行。
  const [missions, setMissions] = createSignal<MissionView[]>([])
  const [missionID, setMissionID] = createSignal("")
  const [missionGoal, setMissionGoal] = createSignal("")
  // 目标累计差异：baseSHA → 当前内容。没有目标时为空。
  const [missionDiff, setMissionDiff] = createSignal<MissionDiffView | undefined>(undefined)
  const NEW_MISSION = "__new"

  const loadRuns = async (select?: string) => {
    try {
      const result = await sdk.client.run.list({ directory: props.directory })
      const list = (result.data ?? []) as RunView[]
      setRuns(list)
      setError("")
      const next = select ?? selected() ?? list[0]?.id
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
      setDetail((result.data ?? undefined) as RunDetail | undefined)
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

  const reload = async () => {
    const runID = selected()
    if (runID) await loadDetail(runID)
  }

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
      setProfiles(result.data ?? [])
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
    const profile = profiles()[0]
    const text = goal().trim()
    const lines = criteria()
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
        budget: { tokens: budget() },
        acceptance: lines.map((line, index) => ({ specID: "review-" + (index + 1), text: line })),
      })
      setComposing(false)
      setGoal("")
      setCriteria("")
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

  const hasWorktrees = createMemo(() => (detail()?.teams ?? []).some((team) => !!team.worktree))
  /** 当前运行属于哪个目标：编号只给人看，悬停给出目标描述。 */
  const currentMission = createMemo(() => missions().find((item) => item.id === detail()?.run.missionID))

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
        setNotice(t("run.merge.done", { branch: data.branch ?? "", sha: (data.sha ?? "").slice(0, 12) }))
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

  onMount(() => {
    void loadRuns()
    void loadProfiles()
    void loadMissions()
    // 运行是后台推进的；没有推送时用轮询保证看板不会停在旧状态。
    const timer = setInterval(() => {
      void reload()
    }, 3000)
    onCleanup(() => clearInterval(timer))
  })

  const stateLabel = (state: string) => t(`run.state.${state}`)
  const summary = createMemo(() => detail()?.summary)
  const canExecute = createMemo(() => {
    const run = detail()?.run
    if (!run) return false
    // 与后端同一条规则：未批准不跑；已经在执行时也不再显示按钮（重复执行会派发两遍）。
    if (TERMINAL.has(run.state) || run.state === "awaiting_approval") return false
    return !(run.state === "running" && run.phase)
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
          <Show
            when={runs().length > 0}
            fallback={<div class="px-2 py-3 text-ui-xs leading-relaxed text-foreground-subtle">{t("run.empty")}</div>}
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
                    {stateLabel(run.state)} · {run.mode}
                  </span>
                </button>
              )}
            </For>
          </Show>
        </aside>

        <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          <Show when={composing()}>
            <div class="flex flex-col gap-3 p-4">
              <div>
                <div class="text-15-medium text-foreground">{t("run.new.title")}</div>
                <div class="mt-1 text-ui-xs text-foreground-subtle">
                  {profiles()[0]?.description ?? t("run.new.hint")}
                </div>
              </div>
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
                <div class="flex h-full items-center justify-center text-ui-sm text-foreground-subtle">
                  {t("run.empty")}
                </div>
              }
            >
              {(data) => (
                <div class="flex flex-col gap-3 p-4">
                  <div class="flex items-start gap-2">
                    <div class="min-w-0 flex-1">
                      <div class="truncate text-15-medium text-foreground">{data().run.goal}</div>
                      <div class="mt-1 flex flex-wrap items-center gap-1.5">
                        <Tag>{stateLabel(data().run.state)}</Tag>
                        <Tag>{data().run.mode}</Tag>
                        {/* 只读 / 可写是这次运行的实际授权，不是提示词里的承诺。 */}
                        <Tag title={t("run.policy.hint")}>
                          {data().run.readOnly ? t("run.policy.readOnly") : t("run.policy.write")}
                        </Tag>
                        <Show when={currentMission()}>
                          {(mission) => <Tag title={mission().goal}>{mission().label + " · " + mission().status}</Tag>}
                        </Show>
                        <Tag>{"第 " + data().run.roundMain + " 轮"}</Tag>
                        {Number(data().run.planVersion) > 0 ? <Tag>{"计划 v" + data().run.planVersion}</Tag> : null}
                      </div>
                    </div>
                    <div class="flex shrink-0 items-center gap-1.5">
                      <Show when={data().run.state === "awaiting_approval"}>
                        <Button variant="primary" size="small" disabled={busy() !== ""} onClick={() => void approve()}>
                          {t("run.action.approve")}
                        </Button>
                      </Show>
                      <Show when={canExecute()}>
                        <Button variant="primary" size="small" disabled={busy() !== ""} onClick={() => void execute()}>
                          {t("run.action.execute")}
                        </Button>
                      </Show>
                      <Show when={!TERMINAL.has(data().run.state)}>
                        <Button variant="ghost" size="small" disabled={busy() !== ""} onClick={() => void cancel()}>
                          {t("run.action.cancel")}
                        </Button>
                      </Show>
                      <Show when={TERMINAL.has(data().run.state) && hasWorktrees()}>
                        <Button
                          variant="primary"
                          size="small"
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
                          title={t("run.action.cleanupHint")}
                          disabled={busy() !== ""}
                          onClick={() => void cleanup()}
                        >
                          {busy() === "cleanup" ? t("run.action.cleaning") : t("run.action.cleanup")}
                        </Button>
                      </Show>
                    </div>
                  </div>

                  <div class="grid grid-cols-4 gap-2">
                    <div class="rounded-lg border border-border bg-surface px-3 py-2">
                      <div class="text-ui-xs text-foreground-subtle">{t("run.metric.pass")}</div>
                      <div class="text-18-medium text-success">{summary()?.pass ?? 0}</div>
                    </div>
                    <div class="rounded-lg border border-border bg-surface px-3 py-2">
                      <div class="text-ui-xs text-foreground-subtle">{t("run.metric.fail")}</div>
                      <div class="text-18-medium text-destructive">{summary()?.fail ?? 0}</div>
                    </div>
                    <div class="rounded-lg border border-border bg-surface px-3 py-2">
                      <div class="text-ui-xs text-foreground-subtle">{t("run.metric.unverified")}</div>
                      {/* 未验证用警示色，不是绿色也不是灰色：它不是通过。 */}
                      <div class="text-18-medium text-warning">{summary()?.unverified ?? 0}</div>
                    </div>
                    <div class="rounded-lg border border-border bg-surface px-3 py-2">
                      <div class="text-ui-xs text-foreground-subtle">{t("run.metric.stale")}</div>
                      <div class="text-18-medium text-warning">{summary()?.stale ?? 0}</div>
                    </div>
                  </div>

                  <Show when={currentMission()}>
                    {(mission) => (
                      <div class="flex flex-col gap-1 rounded-lg border border-border px-3 py-2">
                        <div class="flex flex-wrap items-center gap-1.5 text-ui-xs text-foreground-subtle">
                          <span>{t("run.mission.title", { label: mission().label })}</span>
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
                    <div class="text-ui-xs text-foreground-subtle">{t("run.page.about")}</div>
                    <Show
                      when={(data().summary.lines ?? []).length > 0}
                      fallback={
                        <div class="px-1 py-2 text-ui-xs text-foreground-subtlest">{t("run.acceptance.empty")}</div>
                      }
                    >
                      <For each={data().summary.lines ?? []}>
                        {(line) => (
                          <div class="flex items-start gap-2 rounded-lg border border-border px-3 py-2">
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
                                <Show when={line.measured}>{(measured) => <span>{measured()}</span>}</Show>
                                <Show when={line.snapshotID}>
                                  {(snapshot) => <span class="truncate">{snapshot()}</span>}
                                </Show>
                              </div>
                            </div>
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
                          ]
                            .filter(Boolean)
                            .join(String.fromCharCode(10))}
                        >
                          {team.id + " · " + team.phase}
                        </Tag>
                      )}
                    </For>
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
