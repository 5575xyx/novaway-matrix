import type { Config, EvolutionCandidate, MemoryReviewCandidate } from "@opencode-ai/sdk/v2/client"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Popover } from "@opencode-ai/ui/popover"
import { Switch } from "@opencode-ai/ui/switch"
import { Tag } from "@opencode-ai/ui/tag"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query"
import { createMemo, createSignal, For, Show } from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { ReviewActionButton } from "./review-action-button"
import { pendingBadgeLabel } from "./review-ui-helpers"

const queryOptions = {
  staleTime: 10_000,
  refetchOnWindowFocus: false,
}

export function MemoryEvolutionPanel() {
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const queryClient = useQueryClient()
  const [shown, setShown] = createSignal(false)
  const [preview, setPreview] = createSignal<{ id: string; text: string }>()

  const memoryStatus = useQuery(() => ({
    queryKey: ["settings", "memory", "review-status"],
    queryFn: () => globalSDK.client.memory.reviewStatus().then((x) => x.data),
    ...queryOptions,
  }))
  const memoryCandidates = useQuery(() => ({
    queryKey: ["settings", "memory", "review-candidates", "panel"],
    queryFn: () =>
      globalSDK.client.memory.listReviewCandidates({ status: "pending", limit: 5 }).then((x) => x.data ?? []),
    ...queryOptions,
  }))
  const evolutionStatus = useQuery(() => ({
    queryKey: ["settings", "evolution", "status"],
    queryFn: () => globalSDK.client.evolution.status().then((x) => x.data),
    ...queryOptions,
  }))
  const evolutionCandidates = useQuery(() => ({
    queryKey: ["settings", "evolution", "candidates", "panel"],
    queryFn: () => globalSDK.client.evolution.listCandidates({ status: "pending", limit: 5 }).then((x) => x.data ?? []),
    ...queryOptions,
  }))

  const memoryConfig = createMemo(() => globalSync.data.config.memory ?? {})
  const evolutionConfig = createMemo(() => globalSync.data.config.evolution ?? {})
  const pending = createMemo(() => number(memoryStatus.data?.pending) + number(evolutionStatus.data?.pending))
  const refresh = async () => {
    await Promise.all([
      queryClient.refetchQueries({ queryKey: ["settings", "memory"] }),
      queryClient.refetchQueries({ queryKey: ["settings", "evolution"] }),
    ])
  }
  const toastError = (err: unknown) =>
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: err instanceof Error ? err.message : String(err),
    })

  const updateConfig = useMutation(() => ({
    mutationFn: (config: Config) => globalSync.updateConfig(config),
    onError: toastError,
  }))
  const applyMemory = useMutation(() => ({
    mutationFn: (candidateID: string) => globalSDK.client.memory.applyReviewCandidate({ candidateID }),
    onSuccess: async () => {
      await refresh()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: "已写入持久记忆",
        description: "候选已转为记忆条目，可在设置 > 记忆 > 已应用查看。",
      })
    },
    onError: toastError,
  }))
  const dismissMemory = useMutation(() => ({
    mutationFn: (candidateID: string) => globalSDK.client.memory.dismissReviewCandidate({ candidateID }),
    onSuccess: refresh,
    onError: toastError,
  }))
  const applyEvolution = useMutation(() => ({
    mutationFn: (candidateID: string) =>
      globalSDK.client.evolution.applyFileCandidate({ candidateID }).then((x) => x.data),
    onSuccess: async (data) => {
      await refresh()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: "已确认并写入进化文件",
        description: data?.dryRun.files.map((file) => file.path).join("、") || "已写入 .novaway 进化文件，进化已生效。",
      })
    },
    onError: toastError,
  }))
  const dismissEvolution = useMutation(() => ({
    mutationFn: (candidateID: string) => globalSDK.client.evolution.dismissCandidate({ candidateID }),
    onSuccess: refresh,
    onError: toastError,
  }))
  const dryRunEvolution = useMutation(() => ({
    mutationFn: (candidateID: string) =>
      globalSDK.client.evolution.dryRunCandidate({ candidateID }).then((x) => x.data),
    onSuccess: (data) => {
      if (data)
        setPreview({
          id: data.id,
          text: [
            `预览：不会写入磁盘。`,
            ...data.files.map((file) => [`目标文件：${file.path}`, file.diff].join("\n")),
          ].join("\n\n"),
        })
    },
    onError: toastError,
  }))

  const setMemory = (key: "enabled" | "review_enabled" | "review_llm", value: boolean) =>
    updateConfig.mutate({ memory: { ...memoryConfig(), [key]: value } } as Config)
  const setEvolution = (key: "enabled" | "review_llm", value: boolean) =>
    updateConfig.mutate({ evolution: { ...evolutionConfig(), [key]: value } } as Config)
  const setMemoryInterval = (value: string) =>
    updateConfig.mutate({
      memory: {
        ...memoryConfig(),
        review_interval: Math.max(Math.floor(Number(value) || 0), 0),
      },
    } as Config)
  const setEvolutionInterval = (value: string) =>
    updateConfig.mutate({
      evolution: {
        ...evolutionConfig(),
        review_interval: Math.max(Math.floor(Number(value) || 0), 0),
      },
    } as Config)

  return (
    <Popover
      open={shown()}
      onOpenChange={setShown}
      triggerAs={Button}
      triggerProps={{
        variant: "ghost",
        class:
          "h-9 min-w-[96px] shrink-0 rounded-md border border-border-active/70 bg-[linear-gradient(135deg,rgba(20,184,166,0.16),rgba(56,189,248,0.10))] px-2 text-text-strong shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08),0_0_18px_rgba(20,184,166,0.16)] transition-all duration-150 hover:scale-[1.03] hover:border-border-active hover:bg-surface-base-hover",
        "aria-label": "记忆与进化",
        style: { scale: 1 },
      }}
      trigger={
        <Tooltip value="记忆与进化" placement="bottom">
          <div class="relative flex h-full items-center justify-center gap-1.5 whitespace-nowrap">
            <Icon size="small" name={shown() ? "brain" : "review"} class="text-icon-strong" />
            <span class="text-12-medium leading-none tracking-normal">记忆与进化</span>
            <Show when={pending() > 0}>
              <span class="absolute -top-2 -right-3 min-w-3.5 h-3.5 px-0.5 rounded-full bg-red-solid-base text-10-medium text-invert-base flex items-center justify-center leading-none">
                {pendingBadgeLabel(pending())}
              </span>
            </Show>
          </div>
        </Tooltip>
      }
      class="[&_[data-slot=popover-body]]:p-0 w-[420px] max-w-[calc(100vw-32px)] bg-background-strong shadow-[var(--shadow-lg-border-base)] rounded-lg border border-border-weak-base"
      gutter={4}
      placement="bottom-end"
      shift={-160}
    >
      <Show when={shown()}>
        <div class="flex max-h-[min(720px,calc(100vh-76px))] flex-col overflow-hidden">
          <div class="flex items-center justify-between border-b border-border-weak-base px-3 py-2">
            <div class="flex items-center gap-2">
              <Icon name="review" size="small" />
              <span class="text-13-medium text-text-strong">记忆与自我进化</span>
            </div>
            <Button
              variant="ghost"
              size="small"
              icon="reset"
              disabled={memoryStatus.isFetching || evolutionStatus.isFetching}
              onClick={() => void refresh()}
            >
              刷新
            </Button>
          </div>

          <div class="flex-1 overflow-auto p-3">
            <Section
              icon="brain"
              title="持久记忆"
              count={number(memoryStatus.data?.pending)}
              enabled={memoryConfig().enabled === true}
              reviewEnabled={memoryConfig().review_enabled === true}
              llmEnabled={memoryConfig().review_llm === true}
              intervalLabel="审查间隔"
              intervalValue={memoryConfig().review_interval}
              intervalDefault={1}
              disabled={updateConfig.isPending}
              onEnabled={(value) => setMemory("enabled", value)}
              onReview={(value) => setMemory("review_enabled", value)}
              onLLM={(value) => setMemory("review_llm", value)}
              onInterval={setMemoryInterval}
            />
            <CandidateList
              empty="暂无待审记忆"
              items={memoryCandidates.data ?? []}
              render={(item) => (
                <MemoryRow
                  candidate={item}
                  disabled={applyMemory.isPending || dismissMemory.isPending}
                  onApply={() => applyMemory.mutate(item.id)}
                  onDismiss={() => dismissMemory.mutate(item.id)}
                />
              )}
            />

            <div class="my-3 h-px bg-border-weak-base" />

            <Section
              icon="branch"
              title="自我进化"
              count={number(evolutionStatus.data?.pending)}
              enabled={evolutionConfig().enabled === true}
              reviewEnabled={evolutionConfig().enabled === true}
              llmEnabled={evolutionConfig().review_llm === true}
              intervalLabel="发现间隔"
              intervalValue={evolutionConfig().review_interval}
              intervalDefault={3}
              disabled={updateConfig.isPending}
              onEnabled={(value) => setEvolution("enabled", value)}
              onReview={(value) => setEvolution("enabled", value)}
              onLLM={(value) => setEvolution("review_llm", value)}
              onInterval={setEvolutionInterval}
            />
            <CandidateList
              empty="暂无待审进化"
              items={evolutionCandidates.data ?? []}
              render={(item) => (
                <EvolutionRow
                  candidate={item}
                  preview={preview()?.id === item.id ? preview()?.text : undefined}
                  disabled={dryRunEvolution.isPending || applyEvolution.isPending || dismissEvolution.isPending}
                  onDryRun={() => dryRunEvolution.mutate(item.id)}
                  onApply={() => applyEvolution.mutate(item.id)}
                  onDismiss={() => dismissEvolution.mutate(item.id)}
                />
              )}
            />
          </div>
        </div>
      </Show>
    </Popover>
  )
}

function Section(props: {
  icon: string
  title: string
  count: number
  enabled: boolean
  reviewEnabled: boolean
  llmEnabled: boolean
  intervalLabel: string
  intervalValue?: number
  intervalDefault: number
  disabled: boolean
  onEnabled: (value: boolean) => void
  onReview: (value: boolean) => void
  onLLM: (value: boolean) => void
  onInterval: (value: string) => void
}) {
  return (
    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <Icon name={props.icon as never} size="small" />
          <span class="text-13-medium text-text-strong">{props.title}</span>
          <Tag>{props.count} 待审</Tag>
        </div>
      </div>
      <div class="grid grid-cols-3 gap-2">
        <Toggle label="启用" checked={props.enabled} onChange={props.onEnabled} />
        <Toggle label="审查" checked={props.reviewEnabled} onChange={props.onReview} />
        <Toggle label="智能" checked={props.llmEnabled} onChange={props.onLLM} />
      </div>
      <div class="flex h-9 items-center justify-between gap-3 rounded-md border border-border-weak-base bg-surface-base px-2">
        <span class="min-w-0 text-12-regular text-text-base">{props.intervalLabel}</span>
        <div class="w-20 shrink-0">
          <TextField
            type="number"
            min="0"
            step="1"
            value={String(props.intervalValue ?? props.intervalDefault)}
            disabled={props.disabled}
            label={props.intervalLabel}
            hideLabel
            onBlur={(event: FocusEvent & { currentTarget: HTMLInputElement }) =>
              props.onInterval(event.currentTarget.value)
            }
            onKeyDown={(event: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
              if (event.key === "Enter") event.currentTarget.blur()
            }}
          />
        </div>
      </div>
    </div>
  )
}

function Toggle(props: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label class="flex h-8 items-center justify-between gap-2 rounded-md border border-border-weak-base bg-surface-base px-2">
      <span class="text-12-regular text-text-base">{props.label}</span>
      <Switch checked={props.checked} onChange={props.onChange} hideLabel>
        {props.label}
      </Switch>
    </label>
  )
}

function CandidateList<T>(props: { empty: string; items: readonly T[]; render: (item: T) => unknown }) {
  return (
    <div class="mt-2 flex flex-col rounded-md border border-border-weak-base">
      <Show
        when={props.items.length > 0}
        fallback={<div class="px-3 py-4 text-center text-12-regular text-text-weak">{props.empty}</div>}
      >
        <For each={props.items}>{(item) => props.render(item) as never}</For>
      </Show>
    </div>
  )
}

function MemoryRow(props: {
  candidate: MemoryReviewCandidate
  disabled: boolean
  onApply: () => void
  onDismiss: () => void
}) {
  return (
    <div class="flex items-start justify-between gap-3 border-b border-border-weak-base px-3 py-2 last:border-none">
      <div class="min-w-0 flex-1">
        <div class="truncate text-12-medium text-text-strong">{props.candidate.summary || props.candidate.content}</div>
        <div class="mt-1 line-clamp-2 text-12-regular text-text-weak">{props.candidate.reason}</div>
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <ReviewActionButton icon="check" disabled={props.disabled} onClick={props.onApply} label="应用记忆候选" />
        <ReviewActionButton icon="close" disabled={props.disabled} onClick={props.onDismiss} label="忽略记忆候选" />
      </div>
    </div>
  )
}

function EvolutionRow(props: {
  candidate: EvolutionCandidate
  preview?: string
  disabled: boolean
  onDryRun: () => void
  onApply: () => void
  onDismiss: () => void
}) {
  return (
    <div class="flex flex-col gap-2 border-b border-border-weak-base px-3 py-2 last:border-none">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <div class="truncate text-12-medium text-text-strong">{props.candidate.title}</div>
          <div class="mt-1 flex flex-wrap gap-1">
            <Tag>{props.candidate.kind}</Tag>
            <Tag>{props.candidate.target}</Tag>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <ReviewActionButton icon="open-file" disabled={props.disabled} onClick={props.onDryRun} label="预览" />
          <ReviewActionButton
            icon="download"
            disabled={props.disabled}
            onClick={props.onApply}
            label="确认写入进化文件"
          />
          <ReviewActionButton icon="close" disabled={props.disabled} onClick={props.onDismiss} label="忽略候选" />
        </div>
      </div>
      <Show when={props.preview}>
        {(text) => (
          <pre class="max-h-44 overflow-auto whitespace-pre-wrap rounded-md bg-surface-base px-2 py-2 text-11-regular text-text-base">
            {text()}
          </pre>
        )}
      </Show>
    </div>
  )
}

function number(value: number | string | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}
