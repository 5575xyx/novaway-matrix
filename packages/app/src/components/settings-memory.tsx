import type { Config, MemoryReviewCandidate } from "@opencode-ai/sdk/v2/client"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Switch } from "@opencode-ai/ui/switch"
import { Tag } from "@opencode-ai/ui/tag"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query"
import { createMemo, createSignal, For, Show, type Component, type JSX } from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { ReviewActionButton } from "./review-action-button"
import { finiteNumber } from "./review-ui-helpers"
import { modeGroupLabel, modeGroups, type ModeGroup } from "./settings-mode-groups"
import {
  filterMemoryReviewCandidates,
  memoryCandidateSource,
  memoryReviewCounts,
  memoryReviewSourceCounts,
  type CandidateSource,
  type ReviewStatus,
} from "./settings-memory.helpers"
import { SettingsList } from "./settings-list"

const queryOptions = {
  staleTime: 10_000,
  refetchOnWindowFocus: false,
}

const statusLabels: Record<ReviewStatus, string> = {
  pending: "settings.memory.status.pending",
  applied: "settings.memory.status.applied",
  dismissed: "settings.memory.status.dismissed",
}

const sourceLabels: Record<CandidateSource, string> = {
  all: "settings.review.source.all",
  explicit: "settings.review.source.explicit",
  background: "settings.review.source.background",
  compaction: "settings.review.source.compaction",
  "session-end": "settings.review.source.sessionEnd",
}

const SettingsPage: Component<{ title: string; description: string; children: JSX.Element }> = (props) => (
  <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
    <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
      <div class="flex flex-col gap-1 pt-6 pb-8 w-full">
        <h2 class="text-16-medium text-text-strong">{props.title}</h2>
        <p class="text-13-regular text-text-weak">{props.description}</p>
      </div>
    </div>
    <div class="flex flex-col gap-8 w-full">{props.children}</div>
  </div>
)

const SectionTitle: Component<{ title: string; description?: string }> = (props) => (
  <div class="flex flex-col gap-1 pb-2">
    <h3 class="text-14-medium text-text-strong">{props.title}</h3>
    <Show when={props.description}>
      <p class="text-12-regular text-text-weak">{props.description}</p>
    </Show>
  </div>
)

const EmptyState: Component<{ message: string }> = (props) => (
  <div class="py-4 text-14-regular text-text-weak">{props.message}</div>
)

function candidateTags(candidate: MemoryReviewCandidate) {
  return Array.isArray(candidate.tags) ? candidate.tags : []
}

const LoadingState: Component = () => (
  <div class="flex items-center gap-2 py-4 text-14-regular text-text-weak">
    <span class="size-4 rounded-full border border-border-strong-base border-t-transparent animate-spin" />
    <span>加载中...</span>
  </div>
)

const SegmentTabs: Component<{
  value: ReviewStatus
  onChange: (value: ReviewStatus) => void
  counts: Record<ReviewStatus, number>
}> = (props) => {
  const language = useLanguage()
  return (
    <div class="flex flex-wrap gap-1 pb-3">
      <For each={["pending", "applied", "dismissed"] as ReviewStatus[]}>
        {(value) => (
          <button
            type="button"
            class="h-8 px-3 rounded-md text-13-medium border transition-colors"
            classList={{
              "bg-surface-base-active text-text-strong border-border-weak-base": props.value === value,
              "bg-transparent text-text-weak border-transparent hover:bg-surface-base-hover hover:text-text-strong":
                props.value !== value,
            }}
            onClick={() => props.onChange(value)}
          >
            {language.t(statusLabels[value] as never)} {props.counts[value]}
          </button>
        )}
      </For>
    </div>
  )
}

const SourceFilter: Component<{
  value: CandidateSource
  onChange: (value: CandidateSource) => void
  counts: Record<CandidateSource, number>
}> = (props) => {
  const language = useLanguage()
  return (
    <div class="flex flex-wrap gap-1">
      <For each={["all", "explicit", "background", "compaction", "session-end"] as CandidateSource[]}>
        {(value) => (
          <button
            type="button"
            class="h-7 px-2.5 rounded-md text-12-medium border transition-colors"
            classList={{
              "bg-surface-base-active text-text-strong border-border-weak-base": props.value === value,
              "bg-transparent text-text-weak border-transparent hover:bg-surface-base-hover hover:text-text-strong":
                props.value !== value,
            }}
            onClick={() => props.onChange(value)}
          >
            {language.t(sourceLabels[value] as never)} {props.counts[value]}
          </button>
        )}
      </For>
    </div>
  )
}

const ModeFilter: Component<{
  value: ModeGroup
  onChange: (value: ModeGroup) => void
  counts: Record<ModeGroup, number>
}> = (props) => (
  <div class="flex flex-wrap gap-1">
    <For each={modeGroups}>
      {(group) => (
        <button
          type="button"
          class="h-7 px-2.5 rounded-md text-12-medium border transition-colors"
          classList={{
            "bg-surface-base-active text-text-strong border-border-weak-base": props.value === group.value,
            "bg-transparent text-text-weak border-transparent hover:bg-surface-base-hover hover:text-text-strong":
              props.value !== group.value,
          }}
          onClick={() => props.onChange(group.value)}
        >
          {modeGroupLabel(group.value)} {props.counts[group.value]}
        </button>
      )}
    </For>
  </div>
)

const CandidateRow: Component<{
  candidate: MemoryReviewCandidate
  disabled: boolean
  onApply: () => void
  onDismiss: () => void
}> = (props) => {
  const language = useLanguage()
  const created = () =>
    new Intl.DateTimeFormat(language.intl(), { dateStyle: "short", timeStyle: "short" }).format(
      finiteNumber(props.candidate.time?.created),
    )
  const status = () => props.candidate.status as ReviewStatus

  return (
    <div class="flex items-start justify-between gap-4 py-3 border-b border-border-weak-base last:border-none">
      <div class="flex min-w-0 flex-1 items-start gap-3">
        <Icon name="brain" class="size-5 shrink-0 icon-strong-base mt-0.5" />
        <div class="flex min-w-0 flex-col gap-1">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-14-medium text-text-strong break-words">
              {props.candidate.summary || props.candidate.content}
            </span>
            <Tag>{language.t(statusLabels[status()] as never)}</Tag>
            <Tag>{language.t(sourceLabels[memoryCandidateSource(candidateTags(props.candidate))] as never)}</Tag>
            <Tag>{props.candidate.scope}</Tag>
          </div>
          <Show when={props.candidate.summary}>
            <span class="text-12-regular text-text-base break-words">{props.candidate.content}</span>
          </Show>
          <div class="flex flex-wrap items-center gap-2 text-12-regular text-text-weak">
            <span>{props.candidate.reason}</span>
            <span>{created()}</span>
          </div>
          <Show when={candidateTags(props.candidate).length > 0}>
            <div class="flex flex-wrap gap-1 pt-1">
              <For each={candidateTags(props.candidate)}>{(tag) => <Tag>{tag}</Tag>}</For>
            </div>
          </Show>
        </div>
      </div>
      <Show when={props.candidate.status === "pending"}>
        <div class="flex shrink-0 items-center gap-1">
          <ReviewActionButton
            icon="check"
            disabled={props.disabled}
            onClick={props.onApply}
            label={language.t("settings.memory.action.apply" as never)}
          />
          <ReviewActionButton
            icon="close"
            disabled={props.disabled}
            onClick={props.onDismiss}
            label={language.t("settings.memory.action.dismiss" as never)}
          />
        </div>
      </Show>
    </div>
  )
}

export const SettingsMemory: Component = () => {
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const queryClient = useQueryClient()
  const [tab, setTab] = createSignal<ReviewStatus>("pending")
  const [source, setSource] = createSignal<CandidateSource>("all")
  const [modeGroup, setModeGroup] = createSignal<ModeGroup>("all")
  const memoryConfig = createMemo(() => globalSync.data.config.memory ?? {})

  const reviewStatus = useQuery(() => ({
    queryKey: ["settings", "memory", "review-status"],
    queryFn: () => globalSDK.client.memory.reviewStatus().then((x) => x.data),
    ...queryOptions,
  }))

  const candidates = useQuery(() => ({
    queryKey: ["settings", "memory", "review-candidates", tab()],
    queryFn: () =>
      globalSDK.client.memory.listReviewCandidates({ status: tab(), limit: 100 }).then((x) => x.data ?? []),
    ...queryOptions,
  }))

  const refetchReview = async () => {
    await Promise.all([
      queryClient.refetchQueries({ queryKey: ["settings", "memory", "review-status"] }),
      queryClient.refetchQueries({ queryKey: ["settings", "memory", "review-candidates"] }),
    ])
  }

  const updateConfig = useMutation(() => ({
    mutationFn: (memory: Config["memory"]) => globalSync.updateConfig({ memory } as Config),
    onSuccess: () =>
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.management.toast.saved.title"),
        description: language.t("settings.management.toast.saved.description"),
      }),
    onError: (err) =>
      showToast({
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      }),
  }))

  const apply = useMutation(() => ({
    mutationFn: (candidateID: string) => globalSDK.client.memory.applyReviewCandidate({ candidateID }),
    onSuccess: async () => {
      await refetchReview()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: "已写入持久记忆",
        description: "候选已转为记忆条目，可在已应用列表查看。",
      })
    },
    onError: (err) =>
      showToast({
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      }),
  }))

  const dismiss = useMutation(() => ({
    mutationFn: (candidateID: string) => globalSDK.client.memory.dismissReviewCandidate({ candidateID }),
    onSuccess: () => refetchReview(),
  }))

  const toggleConfig = (key: "enabled" | "review_enabled" | "review_llm", value: boolean) =>
    updateConfig.mutate({
      ...memoryConfig(),
      [key]: value,
    })

  const updateReviewInterval = (value: string) =>
    updateConfig.mutate({
      ...memoryConfig(),
      review_interval: Math.max(Math.floor(Number(value) || 0), 0),
    })

  const counts = createMemo(() => memoryReviewCounts(reviewStatus.data))
  const sourceCounts = createMemo(() => memoryReviewSourceCounts(reviewStatus.data, tab()))
  const sourceFilteredCandidates = createMemo(() => filterMemoryReviewCandidates(candidates.data ?? [], source()))
  const modeCounts = createMemo(
    () =>
      Object.fromEntries(
        modeGroups.map((group) => [
          group.value,
          filterMemoryReviewCandidates(sourceFilteredCandidates(), "all", group.value).length,
        ]),
      ) as Record<ModeGroup, number>,
  )
  const filteredCandidates = createMemo(() =>
    filterMemoryReviewCandidates(candidates.data ?? [], source(), modeGroup()),
  )

  return (
    <SettingsPage
      title={language.t("settings.memory.title" as never)}
      description={language.t("settings.memory.description" as never)}
    >
      <div>
        <SectionTitle title={language.t("settings.memory.section.config" as never)} />
        <SettingsList>
          <div class="flex items-center justify-between gap-4 py-3 border-b border-border-weak-base">
            <div class="flex flex-col gap-1">
              <span class="text-14-medium text-text-strong">
                {language.t("settings.memory.config.enabled.title" as never)}
              </span>
              <span class="text-12-regular text-text-weak">
                {language.t("settings.memory.config.enabled.description" as never)}
              </span>
            </div>
            <Switch
              checked={memoryConfig().enabled === true}
              disabled={updateConfig.isPending}
              onChange={(value) => toggleConfig("enabled", value)}
              hideLabel
            >
              {language.t("settings.memory.config.enabled.title" as never)}
            </Switch>
          </div>
          <div class="flex items-center justify-between gap-4 py-3 border-b border-border-weak-base">
            <div class="flex flex-col gap-1">
              <span class="text-14-medium text-text-strong">
                {language.t("settings.memory.config.review.title" as never)}
              </span>
              <span class="text-12-regular text-text-weak">
                {language.t("settings.memory.config.review.description" as never)}
              </span>
            </div>
            <Switch
              checked={memoryConfig().review_enabled === true}
              disabled={updateConfig.isPending}
              onChange={(value) => toggleConfig("review_enabled", value)}
              hideLabel
            >
              {language.t("settings.memory.config.review.title" as never)}
            </Switch>
          </div>
          <div class="flex items-center justify-between gap-4 py-3 border-b border-border-weak-base">
            <div class="flex flex-col gap-1">
              <span class="text-14-medium text-text-strong">
                {language.t("settings.memory.config.llm.title" as never)}
              </span>
              <span class="text-12-regular text-text-weak">
                {language.t("settings.memory.config.llm.description" as never)}
              </span>
            </div>
            <Switch
              checked={memoryConfig().review_llm === true}
              disabled={updateConfig.isPending || memoryConfig().review_enabled !== true}
              onChange={(value) => toggleConfig("review_llm", value)}
              hideLabel
            >
              {language.t("settings.memory.config.llm.title" as never)}
            </Switch>
          </div>
          <div class="flex items-center justify-between gap-4 py-3">
            <div class="flex flex-col gap-1">
              <span class="text-14-medium text-text-strong">
                {language.t("settings.memory.config.interval.title" as never)}
              </span>
              <span class="text-12-regular text-text-weak">
                {language.t("settings.memory.config.interval.description" as never)}
              </span>
            </div>
            <div class="w-24 shrink-0">
              <TextField
                type="number"
                min="0"
                step="1"
                value={String(memoryConfig().review_interval ?? 1)}
                disabled={updateConfig.isPending}
                label={language.t("settings.memory.config.interval.title" as never)}
                hideLabel
                onBlur={(event: FocusEvent & { currentTarget: HTMLInputElement }) =>
                  updateReviewInterval(event.currentTarget.value)
                }
                onKeyDown={(event: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
                  if (event.key === "Enter") event.currentTarget.blur()
                }}
              />
            </div>
          </div>
        </SettingsList>
      </div>

      <div>
        <SectionTitle
          title={language.t("settings.memory.section.review" as never)}
          description={language.t("settings.memory.review.description" as never)}
        />
        <div class="flex flex-wrap items-center justify-between gap-2 pb-3">
          <SegmentTabs value={tab()} onChange={setTab} counts={counts()} />
          <Button
            variant="secondary"
            icon="reset"
            disabled={candidates.isFetching || reviewStatus.isFetching}
            onClick={() => void refetchReview()}
          >
            {language.t("settings.management.action.retry")}
          </Button>
        </div>
        <div class="pb-3">
          <SourceFilter value={source()} onChange={setSource} counts={sourceCounts()} />
        </div>
        <div class="pb-3">
          <ModeFilter value={modeGroup()} onChange={setModeGroup} counts={modeCounts()} />
        </div>
        <SettingsList>
          <Show when={!candidates.isLoading && !reviewStatus.isLoading} fallback={<LoadingState />}>
            <Show
              when={filteredCandidates().length > 0}
              fallback={<EmptyState message={language.t("settings.memory.review.empty" as never)} />}
            >
              <For each={filteredCandidates()}>
                {(candidate) => (
                  <CandidateRow
                    candidate={candidate}
                    disabled={apply.isPending || dismiss.isPending}
                    onApply={() => apply.mutate(candidate.id)}
                    onDismiss={() => dismiss.mutate(candidate.id)}
                  />
                )}
              </For>
            </Show>
          </Show>
        </SettingsList>
      </div>
    </SettingsPage>
  )
}
