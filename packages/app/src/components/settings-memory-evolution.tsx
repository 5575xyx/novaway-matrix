import type { Config, Memory } from "@novaway/sdk/v2/client"
import { Button } from "@novaway/ui/button"
import { Dialog } from "@novaway/ui/dialog"
import { useDialog } from "@novaway/ui/context/dialog"
import { Icon } from "@novaway/ui/icon"
import { IconButton } from "@novaway/ui/icon-button"
import { Switch } from "@novaway/ui/switch"
import { Select } from "@novaway/ui/select"
import { TextField } from "@novaway/ui/text-field"
import { showToast } from "@novaway/ui/toast"
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query"
import { createMemo, createSignal, For, Show, type Component, type JSX } from "solid-js"
import { getFilename } from "@novaway/core/util/path"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { formatRelativeTime } from "@/utils/relative-time"
import { SettingsMemory } from "./settings-memory"
import { SettingsEvolution } from "./settings-evolution"
import { SettingsGroup, SettingsPage, SettingsRow } from "./settings-parts"

const queryOptions = { staleTime: 5_000, refetchOnWindowFocus: true }

function LearningHistory(props: { directory?: string }) {
  const sdk = useGlobalSDK()
  const history = useQuery(() => ({
    queryKey: ["settings", "memory", "learning-history", props.directory],
    queryFn: () => sdk.client.memory.learningHistory({ directory: props.directory }).then((x) => x.data ?? []),
    refetchInterval: (query) => (query.state.data?.some((job) => job.status === "running") ? 2_000 : false),
    ...queryOptions,
  }))
  return (
    <section class="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
      <div class="flex items-center justify-between">
        <h3 class="text-14-medium text-foreground">学习运行记录</h3>
        <button
          type="button"
          class="text-12-medium text-foreground-subtle hover:text-foreground"
          onClick={() => void history.refetch()}
        >
          刷新
        </button>
      </div>
      <p class="text-12-regular text-foreground-subtle">
        区分未触发、无候选与执行失败。这里记录后台审查状态，不代表进化效果已验证。
      </p>
      <Show
        when={history.isLoading}
        fallback={
          <Show
            when={(history.data ?? []).length > 0}
            fallback={
              <div class="text-12-regular text-foreground-subtle">还没有运行记录；完成对话后将显示学习审查结果。</div>
            }
          >
            <div class="flex flex-col divide-y divide-border">
              <For each={history.data ?? []}>
                {(job) => (
                  <div class="flex items-start gap-2 py-2 first:pt-0 last:pb-0">
                    <Icon
                      name={
                        job.status === "error" ? "circle-x" : job.status === "running" ? "lu-clock" : "circle-check"
                      }
                      size="small"
                    />
                    <div class="min-w-0 flex-1">
                      <div class="flex flex-wrap gap-x-2 text-12-medium text-foreground">
                        <span>{job.type === "learning.memory" ? "记忆审查" : "进化审查"}</span>
                        <span>
                          {job.status === "running"
                            ? "执行中"
                            : job.status === "error"
                              ? "失败"
                              : job.status === "cancelled"
                                ? "已取消"
                                : "已完成"}
                        </span>
                        <span class="text-foreground-subtle">{new Date(job.started_at).toLocaleString()}</span>
                      </div>
                      <Show when={typeof job.metadata?.trigger === "string" ? job.metadata.trigger : undefined}>
                        {(trigger) => <div class="mt-1 text-12-regular text-foreground-subtle">触发：{trigger()}</div>}
                      </Show>
                      <Show when={typeof job.metadata?.stage === "string" ? job.metadata.stage : undefined}>
                        {(stage) => <div class="mt-1 text-12-regular text-foreground-subtle">失败阶段：{stage()}</div>}
                      </Show>
                      <div class="mt-1 break-words text-12-regular text-foreground-subtle">
                        {job.error ?? job.output ?? "等待结果"}
                      </div>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        }
      >
        <div class="text-12-regular text-foreground-subtle">读取记录中…</div>
      </Show>
    </section>
  )
}

function updatedTs(item: Memory) {
  const value = Number(item.time?.updated ?? item.time?.created)
  return Number.isFinite(value) ? value : 0
}

/** 单个作用域的记忆卡片：图标 + 标题 + 「N 个记忆文件 · 更新于 …」+ 展开/清空。 */
const ScopeCard: Component<{
  testId: string
  icon: "globe" | "folder"
  title: string
  entries: Memory[]
  loading: boolean
  onRemove: (id: string) => void
  onClear: () => void
  removing: boolean
}> = (props) => {
  const language = useLanguage()
  const [open, setOpen] = createSignal(false)
  const latest = createMemo(() => props.entries.reduce((max, item) => Math.max(max, updatedTs(item)), 0))
  const updatedLabel = createMemo(() => formatRelativeTime(latest() || undefined, Date.now(), language.t))
  return (
    <section
      data-component={props.testId}
      class="overflow-hidden rounded-xl border border-border/80 bg-surface shadow-sm"
    >
      <div class="flex items-center gap-3 px-4 py-4">
        <span class="grid size-10 shrink-0 place-items-center rounded-xl bg-background text-foreground-subtle">
          <Icon name={props.icon} class="size-5" />
        </span>
        <div class="min-w-0 flex-1">
          <div class="truncate text-14-medium text-foreground">{props.title}</div>
          <div class="mt-0.5 truncate text-12-regular text-foreground-subtle">
            {props.loading ? "读取中…" : `${props.entries.length} 个记忆文件`}
            <Show when={!props.loading && updatedLabel()}>{(label) => <span> · 更新于 {label()}</span>}</Show>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <IconButton
            icon={open() ? "chevron-down" : "folder"}
            variant="ghost"
            size="small"
            data-action={`expand-${props.testId}`}
            aria-label={open() ? "收起" : "展开"}
            onClick={() => setOpen(!open())}
          />
          <IconButton
            icon="trash"
            variant="ghost"
            size="small"
            class="text-critical-base"
            data-action={`clear-${props.testId}`}
            aria-label="清空"
            disabled={props.entries.length === 0 || props.removing}
            onClick={props.onClear}
          />
        </div>
      </div>
      <Show when={open()}>
        <div data-slot={`${props.testId}-list`} class="border-t border-border/80 px-4 py-2">
          <Show
            when={props.entries.length > 0}
            fallback={<div class="py-3 text-12-regular text-foreground-subtle">暂无记忆</div>}
          >
            <For each={props.entries}>
              {(item) => (
                <div class="group flex items-start gap-3 border-t border-border/60 py-2.5 first:border-t-0">
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-13-medium text-foreground">{item.summary || item.content}</div>
                    <Show when={item.summary}>
                      <div class="line-clamp-2 text-11-regular text-foreground-subtle">{item.content}</div>
                    </Show>
                  </div>
                  <IconButton
                    icon="trash"
                    variant="ghost"
                    size="small"
                    class="shrink-0 text-foreground-subtlest opacity-60 group-hover:opacity-100"
                    data-action={`remove-${props.testId}`}
                    aria-label={language.t("common.delete")}
                    disabled={props.removing}
                    onClick={() => props.onRemove(item.id)}
                  />
                </div>
              )}
            </For>
          </Show>
        </div>
      </Show>
    </section>
  )
}

const Collapse: Component<{ testId: string; title: string; description?: string; children: JSX.Element }> = (props) => {
  const [open, setOpen] = createSignal(false)
  return (
    <section class="flex flex-col gap-2">
      <button
        type="button"
        data-action={`toggle-${props.testId}`}
        class="flex items-center gap-2 self-start text-13-medium text-foreground-subtle hover:text-foreground"
        onClick={() => setOpen(!open())}
      >
        <Icon name={open() ? "chevron-down" : "chevron-right"} size="small" />
        {props.title}
        <Show when={props.description}>
          <span class="text-12-regular text-foreground-subtlest">{props.description}</span>
        </Show>
      </button>
      <Show when={open()}>{props.children}</Show>
    </section>
  )
}

/** 设置侧栏：记忆与进化。默认只露出「记忆行为 + 全局/项目记忆卡片」，其余折叠。 */
export const SettingsMemoryEvolution: Component<{ directory?: string }> = (props) => {
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const queryClient = useQueryClient()
  const dialog = useDialog()

  const client = createMemo(() => {
    if (!props.directory) return globalSDK.client
    return globalSDK.createClient({ directory: props.directory, throwOnError: true })
  })

  const memoryConfig = createMemo(() => globalSync.data.config.memory ?? {})
  const evolutionConfig = createMemo(() => globalSync.data.config.evolution ?? {})
  const dreamConfig = createMemo(() => globalSync.data.config.dream ?? {})
  const projectName = createMemo(() => (props.directory ? getFilename(props.directory) : "本项目"))

  const entries = useQuery(() => ({
    queryKey: ["settings", "memory", "entries-simple", props.directory],
    queryFn: () =>
      client()
        .memory.list({ limit: 500, includeGlobal: "true" })
        .then((x) => x.data ?? []),
    ...queryOptions,
  }))
  const globalEntries = createMemo(() => (entries.data ?? []).filter((item) => item.scope === "global"))
  const projectEntries = createMemo(() => (entries.data ?? []).filter((item) => item.scope !== "global"))

  const evolutionStatus = useQuery(() => ({
    queryKey: ["settings", "evolution", "status-simple", props.directory],
    queryFn: () => globalSDK.client.evolution.status({ directory: props.directory }).then((x) => x.data),
    ...queryOptions,
  }))
  const evolutionPending = createMemo(() => Number(evolutionStatus.data?.pending ?? 0) || 0)

  const updateConfig = useMutation(() => ({
    mutationFn: (config: Config) => globalSync.updateConfig(config),
    onError: (err) =>
      showToast({
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      }),
  }))
  const updateMemory = (patch: Partial<Config["memory"]>) =>
    updateConfig.mutate({ memory: { ...memoryConfig(), ...patch } } as Config)
  const updateEvolution = (patch: Partial<Config["evolution"]>) =>
    updateConfig.mutate({ evolution: { ...evolutionConfig(), ...patch } } as Config)
  const updateDream = (patch: Partial<Config["dream"]>) =>
    updateConfig.mutate({ dream: { ...dreamConfig(), ...patch } } as Config)
  const updateGoal = (patch: Partial<Config["goal"]>) =>
    updateConfig.mutate({ goal: { ...(globalSync.data.config.goal ?? {}), ...patch } } as Config)
  const updatePermissionAuto = (patch: Partial<NonNullable<Config["permission_auto"]>>) =>
    updateConfig.mutate({
      permission_auto: { ...(globalSync.data.config.permission_auto ?? {}), ...patch },
    } as Config)
  const updateSkills = (patch: Partial<Config["skills"]>) =>
    updateConfig.mutate({ skills: { ...(globalSync.data.config.skills ?? {}), ...patch } } as Config)
  const updateSandbox = (patch: Partial<Config["sandbox"]>) =>
    updateConfig.mutate({ sandbox: { ...(globalSync.data.config.sandbox ?? {}), ...patch } } as Config)
  const updateArena = (patch: Partial<Config["arena"]>) =>
    updateConfig.mutate({ arena: { ...(globalSync.data.config.arena ?? {}), ...patch } } as Config)
  const updateComputerLoop = (patch: Partial<Config["computer"]>) =>
    updateConfig.mutate({ computer: { ...(globalSync.data.config.computer ?? {}), ...patch } } as Config)
  const updateChannels = (patch: Partial<NonNullable<Config["channels"]>>) =>
    updateConfig.mutate({ channels: { ...(globalSync.data.config.channels ?? {}), ...patch } } as Config)
  const toggleScope = (key: "global_enabled" | "project_enabled", value: boolean) => updateMemory({ [key]: value })
  const numericControl = (value: number | undefined, fallback: number, save: (value: number) => void, min = 0) => (
    <TextField
      type="number"
      min={String(min)}
      step="1"
      value={String(value ?? fallback)}
      label=""
      hideLabel
      disabled={updateConfig.isPending}
      onBlur={(event: FocusEvent & { currentTarget: HTMLInputElement }) => {
        const parsed = Number(event.currentTarget.value)
        if (!Number.isFinite(parsed)) return
        save(Math.max(min, Math.floor(parsed)))
      }}
      onKeyDown={(event: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
        if (event.key === "Enter") event.currentTarget.blur()
      }}
    />
  )

  const removeEntry = useMutation(() => ({
    mutationFn: (memoryID: string) => client().memory.remove({ memoryID }),
    onSuccess: () => {
      void entries.refetch()
      showToast({ variant: "success", icon: "circle-check", title: "已删除记忆" })
    },
  }))

  const clearScope = (title: string, list: Memory[]) => {
    if (list.length === 0) return
    dialog.show(() => (
      <Dialog title={`清空${title}`} description={`将删除 ${list.length} 条记忆，此操作不可撤销。`} fit>
        <div class="flex justify-end gap-2 px-4 pb-4">
          <Button variant="ghost" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              dialog.close()
              void (async () => {
                for (const item of list) await removeEntry.mutateAsync(item.id)
                void queryClient.invalidateQueries({ queryKey: ["settings", "memory", "entries-simple"] })
              })()
            }}
          >
            {language.t("common.delete")}
          </Button>
        </div>
      </Dialog>
    ))
  }

  return (
    <SettingsPage
      title="记忆与进化"
      description="管理持久记忆与自我进化。关闭某个范围后，自动学习不再读取或写入该范围；手动添加仍然可用。"
    >
      <div data-component="memory-settings" class="flex flex-col gap-6">
        <div class="flex flex-col gap-2">
          <h3 class="text-14-medium text-foreground">记忆行为</h3>
          <SettingsGroup>
            <SettingsRow
              label="全局记忆"
              description="在所有项目中读取和更新个人偏好与习惯。"
              control={
                <Switch
                  checked={memoryConfig().global_enabled !== false}
                  disabled={updateConfig.isPending}
                  onChange={(value) => toggleScope("global_enabled", value)}
                  data-action="toggle-global"
                  hideLabel
                >
                  全局记忆
                </Switch>
              }
            />
            <SettingsRow
              label="项目记忆"
              description="按项目读取和更新代码库规则与经验。"
              control={
                <Switch
                  checked={memoryConfig().project_enabled !== false}
                  disabled={updateConfig.isPending}
                  onChange={(value) => toggleScope("project_enabled", value)}
                  data-action="toggle-project"
                  hideLabel
                >
                  项目记忆
                </Switch>
              }
            />
            <SettingsRow
              label="相关性筛选"
              description="额外调用小模型筛选当前请求相关的记忆，会增加首字延迟。"
              control={
                <Switch
                  checked={memoryConfig().prefetch_llm === true}
                  disabled={updateConfig.isPending}
                  onChange={(value) => updateMemory({ prefetch_llm: value })}
                  hideLabel
                >
                  相关性筛选
                </Switch>
              }
            />
            <SettingsRow
              label="陈旧记忆提醒"
              description="在记忆索引中标记较久未更新的条目，提醒使用前核实。"
              control={
                <Switch
                  checked={memoryConfig().staleness_reminders !== false}
                  disabled={updateConfig.isPending}
                  onChange={(value) => updateMemory({ staleness_reminders: value })}
                  hideLabel
                >
                  陈旧记忆提醒
                </Switch>
              }
            />
            <SettingsRow
              label="自动技能抽取"
              description="达到本轮工具调用阈值后生成技能候选；写入仍按进化审阅流程处理。"
              control={
                <Switch
                  checked={evolutionConfig().auto_skill === true}
                  disabled={updateConfig.isPending || evolutionConfig().enabled === false}
                  onChange={(value) => updateEvolution({ auto_skill: value })}
                  hideLabel
                >
                  自动技能抽取
                </Switch>
              }
              detail={
                <SettingsRow
                  label="触发工具调用数"
                  control={numericControl(
                    evolutionConfig().auto_skill_threshold,
                    20,
                    (value) => void updateEvolution({ auto_skill_threshold: value }),
                  )}
                />
              }
            />
            <SettingsRow
              label="技能生命周期巡检"
              description="定期标记长期未使用技能并归档；默认关闭。"
              control={
                <Switch
                  checked={evolutionConfig().curator_enabled === true}
                  disabled={updateConfig.isPending}
                  onChange={(value) => updateEvolution({ curator_enabled: value })}
                  hideLabel
                >
                  技能生命周期巡检
                </Switch>
              }
              detail={
                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <SettingsRow
                    label="标记闲置（天）"
                    control={numericControl(
                      evolutionConfig().curator_stale_days,
                      30,
                      (value) => void updateEvolution({ curator_stale_days: value }),
                    )}
                  />
                  <SettingsRow
                    label="归档闲置（天）"
                    control={numericControl(
                      evolutionConfig().curator_archive_days,
                      90,
                      (value) => void updateEvolution({ curator_archive_days: value }),
                    )}
                  />
                </div>
              }
            />
            <SettingsRow
              label="跨会话记忆整合"
              description="满足最小间隔和会话数后生成可审阅的整合结果；默认关闭。"
              control={
                <Switch
                  checked={dreamConfig().consolidation_enabled === true}
                  disabled={updateConfig.isPending}
                  onChange={(value) => updateDream({ consolidation_enabled: value })}
                  hideLabel
                >
                  跨会话记忆整合
                </Switch>
              }
              detail={
                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <SettingsRow
                    label="最小间隔（小时）"
                    control={numericControl(
                      dreamConfig().min_hours,
                      24,
                      (value) => void updateDream({ min_hours: value }),
                    )}
                  />
                  <SettingsRow
                    label="最少会话数"
                    control={numericControl(
                      dreamConfig().min_sessions,
                      5,
                      (value) => void updateDream({ min_sessions: value }),
                    )}
                  />
                  <SettingsRow
                    label="允许写入全局记忆"
                    control={
                      <Switch
                        checked={dreamConfig().user_scope_enabled === true}
                        disabled={updateConfig.isPending || dreamConfig().consolidation_enabled !== true}
                        onChange={(value) => updateDream({ user_scope_enabled: value })}
                        hideLabel
                      >
                        全局记忆整合
                      </Switch>
                    }
                  />
                </div>
              }
            />
          </SettingsGroup>
        </div>

        <ScopeCard
          testId="memory-card-global"
          icon="globe"
          title="全局记忆"
          entries={globalEntries()}
          loading={entries.isLoading}
          removing={removeEntry.isPending}
          onRemove={(id) => removeEntry.mutate(id)}
          onClear={() => clearScope("全局记忆", globalEntries())}
        />

        <ScopeCard
          testId="memory-card-project"
          icon="folder"
          title={projectName()}
          entries={projectEntries()}
          loading={entries.isLoading}
          removing={removeEntry.isPending}
          onRemove={(id) => removeEntry.mutate(id)}
          onClear={() => clearScope("项目记忆", projectEntries())}
        />

        <Collapse
          testId="evolution"
          title="自我进化"
          description={evolutionPending() > 0 ? `${evolutionPending()} 个待确认候选` : "无待确认候选"}
        >
          <SettingsEvolution embedded directory={props.directory} />
        </Collapse>

        <Collapse testId="history" title="学习运行记录">
          <LearningHistory directory={props.directory} />
        </Collapse>

        <Collapse testId="advanced" title="高级设置" description="审查候选、关系图谱、检索与嵌入配置">
          <SettingsMemory embedded directory={props.directory} />
        </Collapse>

        <section class="flex flex-col gap-2">
          <h3 class="text-14-medium text-foreground">自动执行与实验</h3>
          <p class="text-12-regular text-foreground-subtle">
            这些设置控制自主目标、命令隔离与多模型运行。启用前请检查平台支持和运行成本。
          </p>
          <SettingsGroup>
            <SettingsRow
              label="Goal 自主执行"
              description="允许目标在单轮对话后继续规划、执行和验证；预算默认不限制。"
              control={
                <Switch
                  checked={globalSync.data.config.goal?.enabled === true}
                  disabled={updateConfig.isPending}
                  onChange={(value) => updateGoal({ enabled: value })}
                  hideLabel
                >
                  Goal 自主执行
                </Switch>
              }
              detail={
                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <SettingsRow
                    label="最大追加轮数"
                    control={numericControl(
                      globalSync.data.config.goal?.max_iterations,
                      20,
                      (value) => updateGoal({ max_iterations: value }),
                      1,
                    )}
                  />
                  <SettingsRow
                    label="累计 Token 上限（0 不限）"
                    control={numericControl(globalSync.data.config.goal?.max_tokens, 0, (value) =>
                      updateGoal({ max_tokens: value || undefined }),
                    )}
                  />
                  <SettingsRow
                    label="执行时长上限（分钟，0 不限）"
                    control={numericControl(
                      globalSync.data.config.goal?.max_active_ms === undefined
                        ? 0
                        : Math.ceil(globalSync.data.config.goal.max_active_ms / 60_000),
                      0,
                      (value) => updateGoal({ max_active_ms: value ? value * 60_000 : undefined }),
                    )}
                  />
                  <SettingsRow
                    label="验证方式"
                    control={
                      <Select
                        options={[
                          { value: "judge" as const, label: "裁判模型" },
                          { value: "agent" as const, label: "只读验证 Agent" },
                        ]}
                        current={[
                          { value: "judge" as const, label: "裁判模型" },
                          { value: "agent" as const, label: "只读验证 Agent" },
                        ].find((option) => option.value === (globalSync.data.config.goal?.verifier ?? "judge"))}
                        value={(option) => option.value}
                        label={(option) => option.label}
                        onSelect={(option) => option && updateGoal({ verifier: option.value })}
                        disabled={updateConfig.isPending || globalSync.data.config.goal?.enabled !== true}
                        variant="secondary"
                        size="small"
                        triggerVariant="settings"
                      />
                    }
                  />
                </div>
              }
            />
            <SettingsRow
              label="Auto 权限安全分类器"
              description="仅在默认权限模式选择“自动”时生效；关闭时仍会询问用户。设置页的默认权限档位可在“常规 → 权限”中选择。"
              control={
                <Switch
                  checked={globalSync.data.config.permission_auto?.classifier === true}
                  disabled={updateConfig.isPending}
                  onChange={(value) => updatePermissionAuto({ classifier: value })}
                  hideLabel
                >
                  Auto 权限分类器
                </Switch>
              }
              detail={
                <SettingsRow
                  label="连续拒绝后转交用户（次数）"
                  control={numericControl(globalSync.data.config.permission_auto?.denial_limit, 3, (value) =>
                    updatePermissionAuto({ denial_limit: value }),
                  )}
                />
              }
            />
            <SettingsRow
              label="技能列表预算"
              description="限制技能说明占用的提示词预算比例；有效范围为 0 到 1，默认 0.05。"
              control={
                <TextField
                  type="number"
                  min="0.01"
                  max="1"
                  step="0.01"
                  value={String(globalSync.data.config.skills?.listing_budget_fraction ?? 0.05)}
                  label="技能列表预算比例"
                  hideLabel
                  disabled={updateConfig.isPending}
                  onBlur={(event: FocusEvent & { currentTarget: HTMLInputElement }) => {
                    const value = Number(event.currentTarget.value)
                    if (Number.isFinite(value) && value > 0 && value <= 1)
                      updateSkills({ listing_budget_fraction: value })
                  }}
                />
              }
            />
            <SettingsRow
              label="命令 OS 沙盒"
              description={
                typeof window !== "undefined" && navigator.platform.toLowerCase().includes("win")
                  ? "当前 Windows 不提供 OS 级隔离；开启后仍会依赖权限规则，命令不会因此变成隔离运行。"
                  : "启用后 Shell 和验证命令通过所选后端隔离运行；后端不可用时不会静默降级执行。"
              }
              control={
                <Switch
                  checked={globalSync.data.config.sandbox?.enabled === true}
                  disabled={updateConfig.isPending}
                  onChange={(value) => updateSandbox({ enabled: value })}
                  hideLabel
                >
                  命令 OS 沙盒
                </Switch>
              }
              detail={
                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <SettingsRow
                    label="隔离后端"
                    control={
                      <Select
                        options={[
                          { value: "auto", label: "自动" },
                          { value: "bwrap", label: "Bubblewrap" },
                          { value: "landlock", label: "Landlock" },
                          { value: "seatbelt", label: "Seatbelt" },
                          { value: "docker", label: "Docker" },
                          { value: "podman", label: "Podman" },
                        ]}
                        current={[
                          { value: "auto", label: "自动" },
                          { value: "bwrap", label: "Bubblewrap" },
                          { value: "landlock", label: "Landlock" },
                          { value: "seatbelt", label: "Seatbelt" },
                          { value: "docker", label: "Docker" },
                          { value: "podman", label: "Podman" },
                        ].find((option) => option.value === (globalSync.data.config.sandbox?.backend ?? "auto"))}
                        value={(option) => option.value}
                        label={(option) => option.label}
                        onSelect={(option) =>
                          option &&
                          updateSandbox({ backend: option.value as NonNullable<Config["sandbox"]>["backend"] })
                        }
                        disabled={updateConfig.isPending || globalSync.data.config.sandbox?.enabled !== true}
                        variant="secondary"
                        size="small"
                        triggerVariant="settings"
                      />
                    }
                  />
                  <SettingsRow
                    label="允许网络"
                    control={
                      <Switch
                        checked={globalSync.data.config.sandbox?.network === true}
                        disabled={updateConfig.isPending || globalSync.data.config.sandbox?.enabled !== true}
                        onChange={(value) => updateSandbox({ network: value })}
                        hideLabel
                      >
                        允许网络
                      </Switch>
                    }
                  />
                </div>
              }
            />
            <SettingsRow
              label="Arena 多模型竞技"
              description="允许助手使用 arena_run 在独立 worktree 中并行比较多个模型；运行入口仍在会话工具或 CLI。"
              control={
                <Switch
                  checked={globalSync.data.config.arena?.enabled === true}
                  disabled={updateConfig.isPending}
                  onChange={(value) => updateArena({ enabled: value })}
                  hideLabel
                >
                  Arena 多模型竞技
                </Switch>
              }
              detail={
                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <SettingsRow
                    label="并行数"
                    control={numericControl(
                      globalSync.data.config.arena?.concurrency,
                      2,
                      (value) => updateArena({ concurrency: Math.max(1, value) }),
                      1,
                    )}
                  />
                  <SettingsRow
                    label="每次最大模型数"
                    control={numericControl(
                      globalSync.data.config.arena?.max_contenders,
                      4,
                      (value) => updateArena({ max_contenders: Math.max(1, value) }),
                      1,
                    )}
                  />
                  <SettingsRow
                    label="保留运行 worktree"
                    control={
                      <Switch
                        checked={globalSync.data.config.arena?.keep_worktrees === true}
                        disabled={updateConfig.isPending || globalSync.data.config.arena?.enabled !== true}
                        onChange={(value) => updateArena({ keep_worktrees: value })}
                        hideLabel
                      >
                        保留 worktree
                      </Switch>
                    }
                  />
                </div>
              }
            />
            <SettingsRow
              label="外部 IM 通道"
              description="启用已在配置中登记的通道实例；凭据与实例仍需通过受保护的连接器/秘密配置管理。"
              control={
                <Switch
                  checked={globalSync.data.config.channels?.enabled === true}
                  disabled={updateConfig.isPending || (globalSync.data.config.channels?.channels?.length ?? 0) === 0}
                  onChange={(value) => updateChannels({ enabled: value })}
                  hideLabel
                >
                  外部 IM 通道
                </Switch>
              }
            />
            <SettingsRow
              label="Computer-use 循环"
              description="启用有步数上限的截图、推理与动作循环；需要同时开启上方电脑控制能力。"
              control={
                <Switch
                  checked={globalSync.data.config.computer?.enabled === true}
                  disabled={updateConfig.isPending || globalSync.data.config.experimental?.computer_control !== true}
                  onChange={(value) => updateComputerLoop({ enabled: value })}
                  hideLabel
                >
                  Computer-use 循环
                </Switch>
              }
              detail={
                <SettingsRow
                  label="最大动作步数"
                  control={numericControl(
                    globalSync.data.config.computer?.max_steps,
                    10,
                    (value) => updateComputerLoop({ max_steps: Math.max(1, value) }),
                    1,
                  )}
                />
              }
            />
          </SettingsGroup>
        </section>
      </div>
    </SettingsPage>
  )
}
