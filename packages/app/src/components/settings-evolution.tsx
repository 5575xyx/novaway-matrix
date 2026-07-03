import type { Config, EvolutionCandidate, EvolutionCandidateDryRun } from "@opencode-ai/sdk/v2/client"
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
  evolutionCandidateSource,
  evolutionCounts,
  evolutionSourceCounts,
  filterEvolutionCandidates,
  type CandidateSource,
  type CandidateStatus,
} from "./settings-evolution.helpers"
import { SettingsList } from "./settings-list"

type CandidateContentFormat = EvolutionCandidate["contentFormat"]

const queryOptions = {
  staleTime: 10_000,
  refetchOnWindowFocus: false,
}

const statusLabels: Record<CandidateStatus, string> = {
  pending: "settings.evolution.status.pending",
  applied: "settings.evolution.status.applied",
  dismissed: "settings.evolution.status.dismissed",
}

const contentFormatLabels: Record<CandidateContentFormat, string> = {
  content: "settings.evolution.contentFormat.content",
  unified_diff: "settings.evolution.contentFormat.unifiedDiff",
}

const sourceLabels: Record<CandidateSource, string> = {
  all: "settings.review.source.all",
  background: "settings.review.source.background",
  "session-end": "settings.review.source.sessionEnd",
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err)
}

const SettingsPage: Component<{ title: string; description: string; children: JSX.Element }> = (props) => (
  <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
    <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
      <div class="flex flex-col gap-1 pt-6 pb-8 max-w-[720px]">
        <h2 class="text-16-medium text-text-strong">{props.title}</h2>
        <p class="text-13-regular text-text-weak">{props.description}</p>
      </div>
    </div>
    <div class="flex flex-col gap-8 max-w-[720px]">{props.children}</div>
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

const LoadingState: Component = () => (
  <div class="flex items-center gap-2 py-4 text-14-regular text-text-weak">
    <span class="size-4 rounded-full border border-border-strong-base border-t-transparent animate-spin" />
    <span>加载中...</span>
  </div>
)

const EmptyState: Component<{ message: string }> = (props) => (
  <div class="py-4 text-14-regular text-text-weak">{props.message}</div>
)

function candidateTags(candidate: EvolutionCandidate) {
  return Array.isArray(candidate.tags) ? candidate.tags : []
}

function dryRunFiles(value: EvolutionCandidateDryRun) {
  return Array.isArray(value.files) ? value.files : []
}

const SegmentTabs: Component<{
  value: CandidateStatus
  onChange: (value: CandidateStatus) => void
  counts: Record<CandidateStatus, number>
}> = (props) => {
  const language = useLanguage()
  return (
    <div class="flex flex-wrap gap-1 pb-3">
      <For each={["pending", "applied", "dismissed"] as CandidateStatus[]}>
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
      <For each={["all", "background", "session-end"] as CandidateSource[]}>
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

const ContentFormatControl: Component<{
  value: CandidateContentFormat
  disabled: boolean
  onChange: (value: CandidateContentFormat) => void
}> = (props) => {
  const language = useLanguage()
  return (
    <div class="flex flex-col gap-1">
      <span class="text-12-medium text-text-strong">{language.t("settings.evolution.field.contentFormat" as never)}</span>
      <div class="flex flex-wrap gap-1">
        <For each={["content", "unified_diff"] as CandidateContentFormat[]}>
          {(value) => (
            <button
              type="button"
              disabled={props.disabled}
              class="h-8 px-3 rounded-md text-12-medium border transition-colors disabled:opacity-50"
              classList={{
                "bg-surface-base-active text-text-strong border-border-weak-base": props.value === value,
                "bg-transparent text-text-weak border-transparent hover:bg-surface-base-hover hover:text-text-strong":
                  props.value !== value,
              }}
              onClick={() => props.onChange(value)}
            >
              {language.t(contentFormatLabels[value] as never)}
            </button>
          )}
        </For>
      </div>
    </div>
  )
}

const CandidateRow: Component<{
  candidate: EvolutionCandidate
  disabled: boolean
  onRefresh: () => Promise<void>
  onApplyFile: () => void
  onDismiss: () => void
}> = (props) => {
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const [editing, setEditing] = createSignal(false)
  const [dryRun, setDryRun] = createSignal<EvolutionCandidateDryRun>()
  const [title, setTitle] = createSignal(props.candidate.title)
  const [content, setContent] = createSignal(props.candidate.content)
  const [contentFormat, setContentFormat] = createSignal<CandidateContentFormat>(props.candidate.contentFormat)
  const [reason, setReason] = createSignal(props.candidate.reason)
  const [tags, setTags] = createSignal(candidateTags(props.candidate).join(", "))
  const created = () =>
    new Intl.DateTimeFormat(language.intl(), { dateStyle: "short", timeStyle: "short" }).format(
      finiteNumber(props.candidate.time?.created),
    )
  const status = () => props.candidate.status as CandidateStatus
  const formDisabled = () => props.disabled || save.isPending || loadDryRun.isPending
  const showRequestFailed = (err: unknown) =>
    showToast({
      title: language.t("common.requestFailed"),
      description: errorMessage(err),
    })

  const save = useMutation(() => ({
    mutationFn: () =>
      globalSDK.client.evolution.updateCandidate({
        candidateID: props.candidate.id,
        evolutionCandidateUpdate: {
          title: title(),
          content: content(),
          contentFormat: contentFormat(),
          reason: reason(),
          tags: tags()
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
        },
      }),
    onSuccess: async () => {
      setEditing(false)
      setDryRun(undefined)
      await props.onRefresh()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.evolution.toast.updated.title" as never),
        description: language.t("settings.evolution.toast.updated.description" as never),
      })
    },
    onError: showRequestFailed,
  }))

  const loadDryRun = useMutation(() => ({
    mutationFn: () => globalSDK.client.evolution.dryRunCandidate({ candidateID: props.candidate.id }).then((x) => x.data),
    onSuccess: (data) => {
      if (data) setDryRun(data)
      showToast({
        variant: "success",
        icon: "circle-check",
        title: "预览已生成",
        description: "这里只展示将要写入的文件差异，不会写入磁盘。",
      })
    },
    onError: showRequestFailed,
  }))

  return (
    <div class="flex items-start justify-between gap-4 py-3 border-b border-border-weak-base last:border-none">
      <div class="flex min-w-0 flex-1 items-start gap-3">
        <Icon name="branch" class="size-5 shrink-0 icon-strong-base mt-0.5" />
        <div class="flex min-w-0 flex-col gap-1">
          <Show
            when={editing()}
            fallback={
              <>
                <div class="flex flex-wrap items-center gap-2">
                  <span class="text-14-medium text-text-strong break-words">{props.candidate.title}</span>
                  <Tag>{language.t(statusLabels[status()] as never)}</Tag>
                  <Tag>{language.t(sourceLabels[evolutionCandidateSource(candidateTags(props.candidate))] as never)}</Tag>
                  <Tag>{props.candidate.kind}</Tag>
                  <Tag>{props.candidate.target}</Tag>
                  <Tag>{props.candidate.contentFormat}</Tag>
                </div>
                <span class="text-12-regular text-text-base break-words">{props.candidate.content}</span>
                <div class="flex flex-wrap items-center gap-2 text-12-regular text-text-weak">
                  <span>{props.candidate.reason}</span>
                  <span>{created()}</span>
                </div>
                <Show when={candidateTags(props.candidate).length > 0}>
                  <div class="flex flex-wrap gap-1 pt-1">
                    <For each={candidateTags(props.candidate)}>{(tag) => <Tag>{tag}</Tag>}</For>
                  </div>
                </Show>
                <Show when={dryRun()}>
                  {(item) => (
                    <div class="mt-2 flex flex-col gap-2 rounded-md border border-border-weak-base bg-surface-base px-3 py-2">
                      <span class="text-12-medium text-text-strong">{item().note}</span>
                      <For each={dryRunFiles(item())}>
                        {(file) => (
                          <div class="flex flex-col gap-1">
                            <div class="flex flex-wrap items-center gap-2">
                              <Tag>{file.exists ? language.t("settings.evolution.preview.exists" as never) : language.t("settings.evolution.preview.new" as never)}</Tag>
                              <span class="text-12-medium text-text-strong break-all">{file.path}</span>
                            </div>
                            <pre class="max-h-56 overflow-auto whitespace-pre-wrap text-12-regular text-text-base">{file.diff}</pre>
                          </div>
                        )}
                      </For>
                    </div>
                  )}
                </Show>
              </>
            }
          >
            <div class="flex flex-col gap-3">
              <div class="flex flex-wrap items-center gap-2">
                <Tag>{language.t(statusLabels[status()] as never)}</Tag>
                <Tag>{language.t(sourceLabels[evolutionCandidateSource(candidateTags(props.candidate))] as never)}</Tag>
                <Tag>{props.candidate.kind}</Tag>
                <Tag>{props.candidate.target}</Tag>
                <Tag>{props.candidate.contentFormat}</Tag>
              </div>
              <TextField
                label={language.t("settings.evolution.field.title" as never)}
                value={title()}
                disabled={formDisabled()}
                onChange={setTitle}
              />
              <TextField
                label={language.t("settings.evolution.field.content" as never)}
                value={content()}
                disabled={formDisabled()}
                multiline
                onChange={setContent}
              />
              <ContentFormatControl value={contentFormat()} disabled={formDisabled()} onChange={setContentFormat} />
              <TextField
                label={language.t("settings.evolution.field.reason" as never)}
                value={reason()}
                disabled={formDisabled()}
                multiline
                onChange={setReason}
              />
              <TextField
                label={language.t("settings.evolution.field.tags" as never)}
                value={tags()}
                disabled={formDisabled()}
                onChange={setTags}
              />
            </div>
          </Show>
        </div>
      </div>
      <Show when={props.candidate.status === "pending"}>
        <div class="flex shrink-0 items-center gap-1">
          <Show
            when={editing()}
            fallback={
              <>
                <ReviewActionButton
                  icon="edit"
                  disabled={props.disabled}
                  onClick={() => setEditing(true)}
                  label={language.t("settings.evolution.action.edit" as never)}
                />
                <ReviewActionButton
                  icon="open-file"
                  disabled={props.disabled || loadDryRun.isPending}
                  onClick={() => loadDryRun.mutate()}
                  label="预览"
                />
                <ReviewActionButton
                  icon="download"
                  disabled={props.disabled}
                  onClick={props.onApplyFile}
                  label="确认写入进化文件"
                />
                <ReviewActionButton
                  icon="close"
                  disabled={props.disabled}
                  onClick={props.onDismiss}
                  label={language.t("settings.evolution.action.dismiss" as never)}
                />
              </>
            }
          >
            <ReviewActionButton
              icon="check"
              disabled={formDisabled()}
              onClick={() => save.mutate()}
              label={language.t("settings.evolution.action.save" as never)}
            />
            <ReviewActionButton
              icon="close"
              disabled={formDisabled()}
              onClick={() => setEditing(false)}
              label={language.t("settings.evolution.action.cancel" as never)}
            />
          </Show>
        </div>
      </Show>
    </div>
  )
}

export const SettingsEvolution: Component = () => {
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const queryClient = useQueryClient()
  const [tab, setTab] = createSignal<CandidateStatus>("pending")
  const [source, setSource] = createSignal<CandidateSource>("all")
  const [modeGroup, setModeGroup] = createSignal<ModeGroup>("all")
  const evolutionConfig = createMemo(() => globalSync.data.config.evolution ?? {})

  const status = useQuery(() => ({
    queryKey: ["settings", "evolution", "status"],
    queryFn: () => globalSDK.client.evolution.status().then((x) => x.data),
    ...queryOptions,
  }))

  const candidates = useQuery(() => ({
    queryKey: ["settings", "evolution", "candidates", tab()],
    queryFn: () => globalSDK.client.evolution.listCandidates({ status: tab(), limit: 100 }).then((x) => x.data ?? []),
    ...queryOptions,
  }))

  const refetchEvolution = async () => {
    await Promise.all([
      queryClient.refetchQueries({ queryKey: ["settings", "evolution", "status"] }),
      queryClient.refetchQueries({ queryKey: ["settings", "evolution", "candidates"] }),
    ])
  }
  const showRequestFailed = (err: unknown) =>
    showToast({
      title: language.t("common.requestFailed"),
      description: errorMessage(err),
    })

  const applyFile = useMutation(() => ({
    mutationFn: (candidateID: string) => globalSDK.client.evolution.applyFileCandidate({ candidateID }).then((x) => x.data),
    onSuccess: async (data) => {
      await refetchEvolution()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: "已确认并写入进化文件",
        description: data?.dryRun.files.map((file) => file.path).join("、") || "已写入 .novaway 进化文件，进化已生效。",
      })
    },
    onError: showRequestFailed,
  }))

  const dismiss = useMutation(() => ({
    mutationFn: (candidateID: string) => globalSDK.client.evolution.dismissCandidate({ candidateID }),
    onSuccess: () => refetchEvolution(),
    onError: showRequestFailed,
  }))

  const updateConfig = useMutation(() => ({
    mutationFn: (evolution: Config["evolution"]) => globalSync.updateConfig({ evolution } as Config),
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
        description: errorMessage(err),
      }),
  }))

  const toggleConfig = (key: "enabled" | "review_llm", value: boolean) =>
    updateConfig.mutate({
      ...evolutionConfig(),
      [key]: value,
    })

  const updateReviewInterval = (value: string) =>
    updateConfig.mutate({
      ...evolutionConfig(),
      review_interval: Math.max(Math.floor(Number(value) || 0), 0),
    })

  const counts = createMemo(() => evolutionCounts(status.data))
  const sourceCounts = createMemo(() => evolutionSourceCounts(status.data, tab()))
  const sourceFilteredCandidates = createMemo(() => filterEvolutionCandidates(candidates.data ?? [], source()))
  const modeCounts = createMemo(() =>
    Object.fromEntries(modeGroups.map((group) => [group.value, filterEvolutionCandidates(sourceFilteredCandidates(), "all", group.value).length])) as Record<
      ModeGroup,
      number
    >,
  )
  const filteredCandidates = createMemo(() => filterEvolutionCandidates(candidates.data ?? [], source(), modeGroup()))

  return (
    <SettingsPage title={language.t("settings.evolution.title" as never)} description={language.t("settings.evolution.description" as never)}>
      <div>
        <SectionTitle title={language.t("settings.evolution.section.config" as never)} />
        <SettingsList>
          <div class="flex items-center justify-between gap-4 py-3 border-b border-border-weak-base">
            <div class="flex flex-col gap-1">
              <span class="text-14-medium text-text-strong">{language.t("settings.evolution.config.enabled.title" as never)}</span>
              <span class="text-12-regular text-text-weak">{language.t("settings.evolution.config.enabled.description" as never)}</span>
            </div>
            <Switch
              checked={evolutionConfig().enabled === true}
              disabled={updateConfig.isPending}
              onChange={(value) => toggleConfig("enabled", value)}
              hideLabel
            >
              {language.t("settings.evolution.config.enabled.title" as never)}
            </Switch>
          </div>
          <div class="flex items-center justify-between gap-4 py-3 border-b border-border-weak-base">
            <div class="flex flex-col gap-1">
              <span class="text-14-medium text-text-strong">{language.t("settings.evolution.config.llm.title" as never)}</span>
              <span class="text-12-regular text-text-weak">{language.t("settings.evolution.config.llm.description" as never)}</span>
            </div>
            <Switch
              checked={evolutionConfig().review_llm === true}
              disabled={updateConfig.isPending || evolutionConfig().enabled !== true}
              onChange={(value) => toggleConfig("review_llm", value)}
              hideLabel
            >
              {language.t("settings.evolution.config.llm.title" as never)}
            </Switch>
          </div>
          <div class="flex items-center justify-between gap-4 py-3">
            <div class="flex flex-col gap-1">
              <span class="text-14-medium text-text-strong">{language.t("settings.evolution.config.interval.title" as never)}</span>
              <span class="text-12-regular text-text-weak">{language.t("settings.evolution.config.interval.description" as never)}</span>
            </div>
            <div class="w-24 shrink-0">
              <TextField
                type="number"
                min="0"
                step="1"
                value={String(evolutionConfig().review_interval ?? 3)}
                disabled={updateConfig.isPending}
                label={language.t("settings.evolution.config.interval.title" as never)}
                hideLabel
                onBlur={(event: FocusEvent & { currentTarget: HTMLInputElement }) => updateReviewInterval(event.currentTarget.value)}
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
          title={language.t("settings.evolution.section.candidates" as never)}
          description={language.t("settings.evolution.candidates.description" as never)}
        />
        <div class="flex flex-wrap items-center justify-between gap-2 pb-3">
          <SegmentTabs value={tab()} onChange={setTab} counts={counts()} />
          <Button variant="secondary" icon="reset" disabled={candidates.isFetching || status.isFetching} onClick={() => void refetchEvolution()}>
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
          <Show when={!candidates.isLoading && !status.isLoading} fallback={<LoadingState />}>
            <Show
              when={filteredCandidates().length > 0}
              fallback={<EmptyState message={language.t("settings.evolution.candidates.empty" as never)} />}
            >
              <For each={filteredCandidates()}>
                {(candidate) => (
                  <CandidateRow
                    candidate={candidate}
                    disabled={applyFile.isPending || dismiss.isPending}
                    onRefresh={refetchEvolution}
                    onApplyFile={() => applyFile.mutate(candidate.id)}
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
