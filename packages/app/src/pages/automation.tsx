import { Button } from "@novaway/ui/button"
import { useDialog } from "@novaway/ui/context/dialog"
import { Dialog } from "@novaway/ui/dialog"
import { Icon } from "@novaway/ui/icon"
import { IconButton } from "@novaway/ui/icon-button"
import { Switch } from "@novaway/ui/switch"
import { Tag } from "@novaway/ui/tag"
import { TextField } from "@novaway/ui/text-field"
import { showToast } from "@novaway/ui/toast"
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query"
import { createMemo, createSignal, For, Show, type Component } from "solid-js"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { decode64 } from "@/utils/base64"
import { useParams } from "@solidjs/router"

type TriggerInput =
  | { type: "interval"; minutes: number }
  | { type: "daily"; time: string }
  | { type: "weekly"; dayOfWeek: number; time: string }

type Schedule = {
  id: string
  title: string
  scene: string
  prompt: string
  status: "active" | "paused"
  nextRunAt: number
  trigger: TriggerInput | { type: string; [key: string]: unknown }
}

type Template = {
  id: string
  title: string
  description: string
  prompt: string
  trigger: TriggerInput
}

const TEMPLATES: Template[] = [
  {
    id: "morning",
    title: "晨间动态",
    description: "汇总上一个工作日以来的提交、模块变化、CI 状态和待跟进事项，生成不超过 6 条的摘要。只读分析，不改代码。",
    prompt:
      "汇总自上一个工作日以来的 git 提交、变更模块、测试/CI 状态与待跟进事项。只做只读分析，不要修改任何文件。输出不超过 6 条的精简摘要。",
    trigger: { type: "daily", time: "09:00" },
  },
  {
    id: "risk",
    title: "风险扫描",
    description: "检查最近 24 小时的代码变更，识别运行错误、数据丢失、权限绕过、资源泄漏与兼容性风险，附代码片段。",
    prompt:
      "检查最近 24 小时的代码变更，识别运行错误、数据丢失、权限绕过、资源泄漏与跨端兼容性等高置信风险。逐条给出证据、影响范围与建议。只读，不要修改文件。",
    trigger: { type: "daily", time: "10:00" },
  },
  {
    id: "release",
    title: "发布简报",
    description: "整理本周合并的 PR 和 commit，按功能、修复、体验与工程改进分类，生成对外的精简发布说明。",
    prompt:
      "整理本周合并的 PR 与 commit，按功能、修复、体验、工程改进分类，生成一份面向用户的精简发布说明。只读分析，不要修改文件。",
    trigger: { type: "weekly", dayOfWeek: 5, time: "16:00" },
  },
  {
    id: "docs",
    title: "文档同步检查",
    description: "对照最近 7 天的代码、配置、接口与文档变更，找出已改变公开行为但文档尚未同步的高置信差异。",
    prompt:
      "对照最近 7 天的代码、配置、接口与文档变更，找出「公开行为已改变但文档未同步」的高置信差异，附文件路径与建议修改点。只读分析，不要修改文件。",
    trigger: { type: "weekly", dayOfWeek: 3, time: "15:00" },
  },
]

const describeTrigger = (
  trigger: Schedule["trigger"],
  language: ReturnType<typeof useLanguage>,
) => {
  if (trigger.type === "daily") {
    return language.t("automation.trigger.daily" as never, { time: String(trigger.time) } as never)
  }
  if (trigger.type === "weekly") {
    const days = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
    return language.t("automation.trigger.weekly" as never, {
      day: days[(Number(trigger.dayOfWeek) || 1) - 1] ?? "周一",
      time: String(trigger.time),
    } as never)
  }
  if (trigger.type === "interval") {
    return language.t("automation.trigger.interval" as never, { minutes: Number(trigger.minutes) || 60 } as never)
  }
  return String(trigger.type)
}

const formatNext = (time: number) =>
  new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(
    new Date(time),
  )

/**
 * 自动化（定时任务）页。
 *
 * 对齐 ZCode 的「自动化」：把一段提示词按「每天 / 每周 / 每 N 小时」定时跑一次，
 * 每次运行创建一条新的会话并执行，运行记录可回看。
 *
 * 调度在服务端完成（/office/platform/schedules，ticker 每分钟检查一次），
 * 所以窗口关掉不会跑，但应用开着时不需要页面停留。
 */
export const AutomationPage: Component<{ onBack: () => void }> = (props) => {
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const params = useParams()
  const queryClient = useQueryClient()
  const dialog = useDialog()
  // 自动化页挂在布局层（SDK Provider 之外），用全局客户端按当前目录建请求。
  const directory = createMemo(() => decode64(params.dir) ?? "")
  const [tab, setTab] = createSignal<"automation" | "workflow">("automation")
  // 保持唤醒：交给 Electron 的 powerSaveBlocker，浏览器里是空操作。
  const [keepAwake, setKeepAwakeState] = createSignal(window.api?.keepAwakeEnabled === true)
  const setKeepAwake = (value: boolean) => {
    setKeepAwakeState(value)
    void window.api?.setKeepAwake?.(value)
  }
  const client = () => globalSDK.createClient({ directory: directory(), throwOnError: true })

  const schedules = useQuery(() => ({
    queryKey: ["automation", "schedules", directory()],
    queryFn: () => client().office.platform.schedule.list().then((x) => x.data ?? []),
    refetchInterval: 30_000,
  }))

  const runs = useQuery(() => ({
    queryKey: ["automation", "runs", directory()],
    queryFn: () => client().office.platform.run.list().then((x) => x.data ?? []),
    refetchInterval: 30_000,
  }))

  const workflows = useQuery(() => ({
    queryKey: ["automation", "workflows", directory()],
    queryFn: () => client().office.platform.workflow.list().then((x) => x.data ?? []),
    refetchInterval: 60_000,
  }))

  const runWorkflow = useMutation(() => ({
    mutationFn: (id: string) => client().office.platform.workflow.run({ id }).then((x) => x.data),
    onSuccess: async () => {
      await refresh()
      showToast({ variant: "success", icon: "circle-check", title: language.t("automation.toast.started" as never) })
    },
  }))

  const refresh = async () => {
    await Promise.all([
      queryClient.refetchQueries({ queryKey: ["automation", "schedules"] }),
      queryClient.refetchQueries({ queryKey: ["automation", "runs"] }),
    ])
  }

  const create = useMutation(() => ({
    mutationFn: (input: { title: string; prompt: string; trigger: TriggerInput }) =>
      client().office.platform.schedule.create({ ...input, scene: "automation" }).then((x) => x.data),
    onSuccess: async () => {
      await refresh()
      showToast({ variant: "success", icon: "circle-check", title: language.t("automation.toast.created" as never) })
    },
    onError: (error) =>
      showToast({
        variant: "error",
        title: language.t("automation.toast.failed" as never),
        description: error instanceof Error ? error.message : String(error),
      }),
  }))

  const toggle = useMutation(() => ({
    mutationFn: (item: Schedule) =>
      client()
        .office.platform.schedule.update({ id: item.id, status: item.status === "active" ? "paused" : "active" })
        .then((x) => x.data),
    onSuccess: () => refresh(),
  }))

  const runNow = useMutation(() => ({
    mutationFn: (id: string) => client().office.platform.schedule.run({ id }).then((x) => x.data),
    onSuccess: async () => {
      await refresh()
      showToast({ variant: "success", icon: "circle-check", title: language.t("automation.toast.started" as never) })
    },
  }))

  const remove = useMutation(() => ({
    mutationFn: (id: string) => client().office.platform.schedule.delete({ id }).then((x) => x.data),
    onSuccess: () => refresh(),
  }))

  const openCreate = (template?: Template) => {
    dialog.show(() => <AutomationDialog template={template} onSave={(input) => create.mutateAsync(input)} />)
  }

  return (
    <div class="flex h-full flex-col">
      <div class="flex h-12 shrink-0 items-center gap-3 px-3" data-window-drag>
        <button
          type="button"
          class="flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-13-medium text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
          onClick={props.onBack}
        >
          <Icon name="arrow-left" size="small" />
          {language.t("common.goBack")}
        </button>
        <div class="flex-1" />
      </div>

      <div class="flex-1 min-h-0 overflow-y-auto px-6 pb-14 sm:px-10">
        <div class="mx-auto flex w-full max-w-[1000px] flex-col gap-8 pt-4">
          {/* 大标题 + 分段（对齐 ZCode 的「自动化 / 工作流」）。 */}
          <div class="flex flex-col gap-1">
            <div class="flex items-baseline gap-3">
              <For each={["automation", "workflow"] as const}>
                {(value) => (
                  <button
                    type="button"
                    class="text-32-semibold transition-colors"
                    classList={{
                      "text-foreground": tab() === value,
                      "text-foreground-subtlest hover:text-foreground-subtle": tab() !== value,
                    }}
                    onClick={() => setTab(value)}
                  >
                    {language.t(value === "automation" ? ("automation.tab.automation" as never) : ("automation.tab.workflow" as never))}
                  </button>
                )}
              </For>
            </div>
            <p class="text-13-regular text-foreground-subtle">{language.t("automation.subtitle" as never)}</p>
          </div>
          <Show when={tab() === "automation"}>
          <Show
            when={(schedules.data ?? []).length > 0}
            fallback={
              <div class="flex flex-col items-center justify-center gap-4 rounded-2xl border border-border px-6 py-24 text-center">
                <span class="text-14-regular text-foreground-subtle">{language.t("automation.empty.title" as never)}</span>
                <button
                  type="button"
                  class="flex h-9 items-center gap-2 rounded-lg bg-foreground px-3.5 text-13-medium text-background transition-opacity hover:opacity-90"
                  onClick={() => openCreate()}
                >
                  {language.t("automation.create" as never)}
                </button>
              </div>
            }
          >
            <div class="flex flex-col gap-2">
              <div class="flex items-center justify-end">
                <button
                  type="button"
                  class="flex h-9 items-center gap-2 rounded-lg bg-foreground px-3.5 text-13-medium text-background transition-opacity hover:opacity-90"
                  onClick={() => openCreate()}
                >
                  <Icon name="plus-small" size="small" />
                  {language.t("automation.create" as never)}
                </button>
              </div>
              <For each={schedules.data ?? []}>
                {(item) => (
                  <div class="flex min-w-0 items-start gap-3 rounded-xl border border-border px-4 py-3.5">
                    <span class="grid size-9 shrink-0 place-items-center rounded-full border border-border bg-surface">
                      <Icon name="autopilot" class="size-4.5 text-foreground-subtle" />
                    </span>
                    <div class="flex min-w-0 flex-1 flex-col gap-1">
                      <div class="flex min-w-0 flex-wrap items-center gap-2">
                        <span class="truncate text-14-medium text-foreground">{item.title}</span>
                        <Tag>{describeTrigger(item.trigger as TriggerInput, language)}</Tag>
                        <Show when={item.status === "paused"}>
                          <Tag>{language.t("automation.status.paused" as never)}</Tag>
                        </Show>
                      </div>
                      <span class="line-clamp-2 text-13-regular leading-6 text-foreground-subtle">{item.prompt}</span>
                      <span class="text-12-regular text-foreground-subtlest">
                        {language.t("automation.nextRun" as never)} · {formatNext(Number(item.nextRunAt) || Date.now())}
                      </span>
                    </div>
                    <div class="flex shrink-0 items-center gap-1">
                      <IconButton
                        icon="play"
                        variant="ghost"
                        aria-label={language.t("automation.runNow" as never)}
                        disabled={runNow.isPending}
                        onClick={() => runNow.mutate(item.id)}
                      />
                      <IconButton
                        icon={item.status === "active" ? "stop" : "check"}
                        variant="ghost"
                        aria-label={language.t("automation.toggle" as never)}
                        onClick={() => toggle.mutate(item)}
                      />
                      <IconButton
                        icon="trash"
                        variant="ghost"
                        aria-label={language.t("common.delete")}
                        onClick={() => remove.mutate(item.id)}
                      />
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>

          <div class="flex flex-col gap-2">
            <h3 class="text-14-medium text-foreground">{language.t("automation.templates" as never)}</h3>
            <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
              <For each={TEMPLATES}>
                {(template) => (
                  <button
                    type="button"
                    class="flex flex-col items-start gap-2 rounded-xl border border-border px-4 py-3.5 text-left transition-colors hover:border-border-hover"
                    onClick={() => openCreate(template)}
                  >
                    <div class="flex items-center gap-2">
                      <Icon name="autopilot" size="small" class="text-foreground-subtle" />
                      <span class="text-14-medium text-foreground">{template.title}</span>
                    </div>
                    <span class="line-clamp-2 text-13-regular leading-6 text-foreground-subtle">
                      {template.description}
                    </span>
                    <span class="text-12-regular text-foreground-subtlest">
                      {describeTrigger(template.trigger, language)}
                    </span>
                  </button>
                )}
              </For>
            </div>
          </div>

          </Show>

          {/* 工作流：从会话保存下来的可复用提示词。 */}
          <Show when={tab() === "workflow"}>
            <Show
              when={(workflows.data ?? []).length > 0}
              fallback={
                <div class="flex flex-col items-center justify-center gap-2 rounded-2xl border border-border px-6 py-24 text-center">
                  <span class="text-14-regular text-foreground-subtle">
                    {language.t("automation.workflow.empty" as never)}
                  </span>
                  <span class="text-12-regular text-foreground-subtlest">
                    {language.t("automation.workflow.emptyHint" as never)}
                  </span>
                </div>
              }
            >
              <div class="flex flex-col gap-2">
                <For each={workflows.data ?? []}>
                  {(item) => (
                    <div class="flex min-w-0 items-start gap-3 rounded-xl border border-border px-4 py-3.5">
                      <span class="grid size-9 shrink-0 place-items-center rounded-full border border-border bg-surface">
                        <Icon name="branch" class="size-4.5 text-foreground-subtle" />
                      </span>
                      <div class="flex min-w-0 flex-1 flex-col gap-1">
                        <span class="truncate text-14-medium text-foreground">{item.title}</span>
                        <span class="line-clamp-2 text-13-regular leading-6 text-foreground-subtle">{item.prompt}</span>
                      </div>
                      <IconButton
                        icon="play"
                        variant="ghost"
                        aria-label={language.t("automation.runNow" as never)}
                        disabled={runWorkflow.isPending}
                        onClick={() => runWorkflow.mutate(item.id)}
                      />
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </Show>

          {/* 保持唤醒（对齐 ZCode 的提示行 + 开关）。 */}
          <div class="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3">
            <Icon name="help" size="small" class="shrink-0 text-foreground-subtle" />
            <span class="min-w-0 flex-1 text-13-regular text-foreground-subtle">
              {language.t("automation.keepAwake" as never)}
            </span>
            <Switch checked={keepAwake()} onChange={setKeepAwake} hideLabel>
              {language.t("automation.keepAwake" as never)}
            </Switch>
          </div>

          <Show when={(runs.data ?? []).length > 0}>
            <div class="flex flex-col gap-2">
              <h3 class="text-14-medium text-foreground">{language.t("automation.history" as never)}</h3>
              <div class="flex flex-col overflow-hidden rounded-xl border border-border">
                <For each={(runs.data ?? []).slice(-10).reverse()}>
                  {(run) => (
                    <div class="flex items-center gap-3 border-t border-border px-4 py-2.5 text-12-regular first:border-t-0">
                      <span
                        class="size-2 rounded-full"
                        classList={{
                          "bg-[var(--diff-added)]": run.status === "completed",
                          "bg-[var(--icon-blue)] animate-pulse": run.status === "running",
                          "bg-[var(--diff-removed)]": run.status === "error",
                        }}
                      />
                      <span class="min-w-0 flex-1 truncate text-foreground-subtle">
                        {(run.logs ?? []).at(-1) ?? run.id}
                      </span>
                      <span class="shrink-0 text-foreground-subtlest">
                        {formatNext(Number(run.startedAt) || 0)}
                      </span>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>

          <p class="text-11-regular text-foreground-subtlest">{language.t("automation.hint" as never)}</p>
        </div>
      </div>
    </div>
  )
}

const AutomationDialog: Component<{
  template?: Template
  onSave: (input: { title: string; prompt: string; trigger: TriggerInput }) => Promise<unknown>
}> = (props) => {
  const language = useLanguage()
  const dialog = useDialog()
  const [title, setTitle] = createSignal(props.template?.title ?? "")
  const [prompt, setPrompt] = createSignal(props.template?.prompt ?? "")
  const [kind, setKind] = createSignal<"daily" | "weekly" | "interval">(props.template?.trigger.type === "weekly" ? "weekly" : "daily")
  const [time, setTime] = createSignal(
    props.template?.trigger.type === "daily" || props.template?.trigger.type === "weekly"
      ? props.template.trigger.time
      : "09:00",
  )
  const [dayOfWeek, setDayOfWeek] = createSignal(
    props.template?.trigger.type === "weekly" ? props.template.trigger.dayOfWeek : 1,
  )
  const [minutes, setMinutes] = createSignal(60)
  const [error, setError] = createSignal("")
  const [saving, setSaving] = createSignal(false)

  const trigger = (): TriggerInput => {
    if (kind() === "weekly") return { type: "weekly", dayOfWeek: dayOfWeek(), time: time() }
    if (kind() === "interval") return { type: "interval", minutes: Math.max(5, minutes()) }
    return { type: "daily", time: time() }
  }

  const submit = async (event: Event) => {
    event.preventDefault()
    if (saving()) return
    if (!title().trim() || !prompt().trim()) {
      setError(language.t("automation.field.required" as never))
      return
    }
    setSaving(true)
    try {
      await props.onSave({ title: title().trim(), prompt: prompt().trim(), trigger: trigger() })
      dialog.close()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog title={language.t("automation.create" as never)} transition class="w-[min(calc(100vw-40px),620px)]">
      <form class="flex flex-col gap-4 px-2.5 pb-3" onSubmit={(event) => void submit(event)}>
        <TextField
          label={language.t("automation.field.title" as never)}
          value={title()}
          onChange={setTitle}
          disabled={saving()}
        />
        <TextField
          label={language.t("automation.field.prompt" as never)}
          multiline
          value={prompt()}
          onChange={setPrompt}
          class="min-h-40"
          disabled={saving()}
        />
        <div class="flex flex-col gap-2">
          <span class="text-12-medium text-foreground-subtle">{language.t("automation.field.trigger" as never)}</span>
          <div class="flex flex-wrap items-center gap-1.5">
            <For each={["daily", "weekly", "interval"] as const}>
              {(value) => (
                <button
                  type="button"
                  class="h-8 rounded-md border px-3 text-12-medium transition-colors"
                  classList={{
                    "border-border bg-selected text-foreground": kind() === value,
                    "border-transparent bg-transparent text-foreground-subtle hover:bg-hover": kind() !== value,
                  }}
                  onClick={() => setKind(value)}
                >
                  {language.t(`automation.trigger.${value}.short` as never)}
                </button>
              )}
            </For>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <Show when={kind() === "daily" || kind() === "weekly"}>
              <input
                type="time"
                value={time()}
                onInput={(event) => setTime(event.currentTarget.value)}
                class="h-8 rounded-md border border-border bg-background px-2 text-13-regular text-foreground outline-none focus:border-border-hover"
              />
            </Show>
            <Show when={kind() === "weekly"}>
              <select
                value={String(dayOfWeek())}
                onChange={(event) => setDayOfWeek(Number(event.currentTarget.value))}
                class="h-8 rounded-md border border-border bg-background px-2 text-13-regular text-foreground outline-none"
              >
                <For each={["周一", "周二", "周三", "周四", "周五", "周六", "周日"]}>
                  {(label, index) => <option value={String(index() + 1)}>{label}</option>}
                </For>
              </select>
            </Show>
            <Show when={kind() === "interval"}>
              <input
                type="number"
                min="5"
                step="5"
                value={String(minutes())}
                onInput={(event) => setMinutes(Number(event.currentTarget.value))}
                class="h-8 w-20 rounded-md border border-border bg-background px-2 text-13-regular text-foreground outline-none"
              />
              <span class="text-12-regular text-foreground-subtle">{language.t("automation.minutes" as never)}</span>
            </Show>
          </div>
        </div>
        <Show when={error()}>
          <span class="text-12-regular text-destructive">{error()}</span>
        </Show>
        <div class="flex justify-end gap-2">
          <Button type="button" variant="secondary" disabled={saving()} onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button type="submit" icon="check" disabled={saving()}>
            {language.t("automation.save" as never)}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
