import type { Config, MemoryRelation, MemoryReviewCandidate } from "@novaway/sdk/v2/client"
import { Button } from "@novaway/ui/button"
import { Icon } from "@novaway/ui/icon"
import { Switch } from "@novaway/ui/switch"
import { Tag } from "@novaway/ui/tag"
import { TextField } from "@novaway/ui/text-field"
import { showToast } from "@novaway/ui/toast"
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query"
import { createEffect, createMemo, createSignal, For, Show, type Component, type JSX } from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { ReviewActionButton } from "./review-action-button"
import { finiteNumber } from "./review-ui-helpers"
import { memorySetupState, runMemorySetup } from "./settings-memory-setup-state"
import {
  memoryCandidateSource,
  memoryConfidenceLabel,
  memoryDomainLabel,
  memoryKindLabel,
  memoryOperationLabel,
  memoryReviewCounts,
  memoryVersionLabel,
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
    <span class="size-4 rounded-full border border-border-strong-base border-t-transparent novaway-spinner" />
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

const CandidateRow: Component<{
  candidate: MemoryReviewCandidate
  disabled: boolean
  onApply: (scope: "global" | "project") => void
  onDismiss: () => void
}> = (props) => {
  const [scope, setScope] = createSignal<"global" | "project">(
    props.candidate.scope === "global" ? "global" : "project",
  )
  const language = useLanguage()
  const created = () =>
    new Intl.DateTimeFormat(language.intl(), { dateStyle: "short", timeStyle: "short" }).format(
      finiteNumber(props.candidate.time?.created),
    )
  const status = () => props.candidate.status as ReviewStatus

  return (
    <div class="flex items-start justify-between gap-4 rounded-lg border border-border-weak-base bg-surface-base px-4 py-3">
      <div class="flex min-w-0 flex-1 items-start gap-3">
        <Icon name="brain" class="size-5 shrink-0 icon-strong-base mt-0.5" />
        <div class="flex min-w-0 flex-col gap-1">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-14-medium text-text-strong break-words">
              {props.candidate.summary || props.candidate.content}
            </span>
            <Tag>{language.t(statusLabels[status()] as never)}</Tag>
            <Tag>{language.t(sourceLabels[memoryCandidateSource(candidateTags(props.candidate))] as never)}</Tag>
            <Tag>{memoryDomainLabel(props.candidate.domain)}</Tag>
            <Tag>{memoryKindLabel(props.candidate.kind)}</Tag>
            <Tag>{memoryOperationLabel(props.candidate.operation)}</Tag>
            <Tag>{memoryConfidenceLabel(props.candidate.confidence)}</Tag>
            <div class="flex items-center gap-1">
              <button
                type="button"
                class="h-5 rounded px-1.5 text-11-medium border"
                classList={{
                  "border-border-strong-base bg-surface-base-active": scope() === "global",
                  "border-transparent text-text-weak": scope() !== "global",
                }}
                onClick={() => setScope("global")}
              >
                全局
              </button>
              <button
                type="button"
                class="h-5 rounded px-1.5 text-11-medium border"
                classList={{
                  "border-border-strong-base bg-surface-base-active": scope() === "project",
                  "border-transparent text-text-weak": scope() !== "project",
                }}
                onClick={() => setScope("project")}
              >
                本项目
              </button>
            </div>
          </div>
          <Show when={props.candidate.summary}>
            <span class="text-12-regular text-text-base break-words">{props.candidate.content}</span>
          </Show>
          <div class="flex flex-wrap items-center gap-2 text-12-regular text-text-weak">
            <span>{props.candidate.reason}</span>
            <span>{memoryVersionLabel(props.candidate)}</span>
            <span>{created()}</span>
          </div>
          <Show when={candidateTags(props.candidate).length > 0}>
            <div class="flex flex-wrap gap-1 pt-1">
              <For each={candidateTags(props.candidate)}>{(tag) => <Tag>{tag}</Tag>}</For>
            </div>
          </Show>
          <Show when={(props.candidate.entities?.length ?? 0) > 0}>
            <div class="flex flex-wrap gap-1 pt-1">
              <For each={props.candidate.entities}>
                {(entity) => <Tag>{entity.type ? `${entity.type}:${entity.name}` : entity.name}</Tag>}
              </For>
            </div>
          </Show>
        </div>
      </div>
      <Show when={props.candidate.status === "pending"}>
        <div class="flex shrink-0 items-center gap-1">
          <ReviewActionButton
            icon="check"
            disabled={props.disabled}
            onClick={() => props.onApply(scope())}
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

type MemoryView = "config" | "review" | "relations" | "entries"

const memoryViews: Array<{ id: MemoryView; label: string; icon: "archive" | "bullet-list" | "branch" | "brain" }> = [
  { id: "config", label: "设置", icon: "archive" },
  { id: "review", label: "审查候选", icon: "bullet-list" },
  { id: "relations", label: "关系图谱", icon: "branch" },
  { id: "entries", label: "已写入", icon: "brain" },
]

const MemoryViewTabs: Component<{ value: MemoryView; onChange: (value: MemoryView) => void }> = (props) => (
  <div class="flex flex-wrap gap-1">
    <For each={memoryViews}>
      {(view) => (
        <button
          type="button"
          class="h-9 px-4 rounded-md text-13-medium border transition-colors"
          classList={{
            "bg-surface-base-active text-text-strong border-border-weak-base": props.value === view.id,
            "bg-transparent text-text-weak border-transparent hover:bg-surface-base-hover hover:text-text-strong":
              props.value !== view.id,
          }}
          onClick={() => props.onChange(view.id)}
        >
          <span class="flex items-center gap-1.5">
            <Icon name={view.icon} class="size-4" />
            {view.label}
          </span>
        </button>
      )}
    </For>
  </div>
)

function relationNodeColor(type?: string) {
  if (type === "person") return "#22d3ee"
  if (type === "product") return "#a78bfa"
  if (type === "organization" || type === "company") return "#f59e0b"
  if (type === "place") return "#34d399"
  return "#64748b"
}

const RelationGraph: Component<{
  relations: readonly MemoryRelation[]
  loading: boolean
}> = (props) => {
  const width = 560
  const height = 420
  const centerX = width / 2
  const centerY = height / 2

  const graph = createMemo(() => {
    const degree = new Map<string, number>()
    const types = new Map<string, string>()
    for (const relation of props.relations) {
      degree.set(relation.source, (degree.get(relation.source) ?? 0) + 1)
      degree.set(relation.target, (degree.get(relation.target) ?? 0) + 1)
      if (relation.sourceType) types.set(relation.source, relation.sourceType)
      if (relation.targetType) types.set(relation.target, relation.targetType)
    }
    const entries = Array.from(degree.entries()).toSorted((a, b) => b[1] - a[1])
    const center = entries[0]?.[0]
    const others = entries.filter(([name]) => name !== center)
    const radius = Math.min(150, Math.max(84, others.length * 22))
    const positions = new Map<string, { x: number; y: number }>()
    if (center) positions.set(center, { x: centerX, y: centerY })
    others.forEach(([name], index) => {
      const angle = (index / Math.max(others.length, 1)) * Math.PI * 2 - Math.PI / 2
      positions.set(name, {
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
      })
    })
    const nodes = Array.from(positions.entries()).map(([name, position]) => ({
      name,
      ...position,
      type: types.get(name),
    }))
    const edges = props.relations.map((relation) => {
      const from = positions.get(relation.source) ?? { x: centerX, y: centerY }
      const to = positions.get(relation.target) ?? { x: centerX, y: centerY }
      return {
        relation,
        from,
        to,
        label: relation.relation,
        mid: {
          x: (from.x + to.x) / 2,
          y: (from.y + to.y) / 2 - 8,
        },
      }
    })
    return { nodes, edges }
  })

  return (
    <div class="rounded-lg border border-border-weak-base bg-surface-base px-3 py-3">
      <Show
        when={props.loading}
        fallback={
          <Show when={props.relations.length > 0} fallback={<EmptyState message="暂无关系记录" />}>
            <svg class="w-full h-auto" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="关系图谱">
              <For each={graph().edges}>
                {(edge) => (
                  <>
                    <line
                      x1={edge.from.x}
                      y1={edge.from.y}
                      x2={edge.to.x}
                      y2={edge.to.y}
                      stroke="#64748b"
                      stroke-opacity="0.45"
                      stroke-width="1.5"
                    />
                    <text x={edge.mid.x} y={edge.mid.y} text-anchor="middle" class="fill-text-weak text-10-medium">
                      {edge.label}
                    </text>
                  </>
                )}
              </For>
              <For each={graph().nodes}>
                {(node) => (
                  <g>
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r="22"
                      fill={relationNodeColor(node.type)}
                      fill-opacity="0.16"
                      stroke={relationNodeColor(node.type)}
                      stroke-width="1.5"
                    />
                    <text x={node.x} y={node.y + 4} text-anchor="middle" class="fill-text-strong text-11-medium">
                      {node.name}
                    </text>
                  </g>
                )}
              </For>
            </svg>
          </Show>
        }
      >
        <LoadingState />
      </Show>
    </div>
  )
}

export const SettingsMemory: Component<{ embedded?: boolean }> = (props) => {
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const queryClient = useQueryClient()
  const platform = usePlatform()
  const [tab, setTab] = createSignal<ReviewStatus>("pending")
  const [view, setView] = createSignal<MemoryView>("config")
  const [candidateSearch, setCandidateSearch] = createSignal("")
  const [installDir, setInstallDir] = createSignal("")
  const [modelsDir, setModelsDir] = createSignal("")

  createEffect(() => {
    const memory = globalSync.data.config.memory
    if (memory?.embedding_ollama_install_dir !== undefined) {
      setInstallDir(memory.embedding_ollama_install_dir)
    }
    if (memory?.embedding_ollama_models_dir !== undefined) {
      setModelsDir(memory.embedding_ollama_models_dir)
    }
  })

  const memoryConfig = createMemo(() => {
    const raw = globalSync.data.config.memory ?? {}
    return {
      ...raw,
      enabled: raw.enabled ?? true,
      review_enabled: raw.review_enabled ?? true,
      review_llm: raw.review_llm ?? true,
      review_interval: raw.review_interval ?? 1,
      auto_apply: raw.auto_apply ?? true,
      prefetch_limit: raw.prefetch_limit ?? 5,
      embedding_mode: raw.embedding_mode ?? "auto",
    }
  })

  const reviewStatus = useQuery(() => ({
    queryKey: ["settings", "memory", "review-status"],
    queryFn: () => globalSDK.client.memory.reviewStatus().then((x) => x.data),
    ...queryOptions,
  }))

  const entries = useQuery(() => ({
    queryKey: ["settings", "memory", "entries"],
    queryFn: () => globalSDK.client.memory.list({ limit: 100 } as never).then((x) => x.data ?? []),
    ...queryOptions,
  }))

  const relations = useQuery(() => ({
    queryKey: ["settings", "memory", "relations"],
    queryFn: () => globalSDK.client.memory.listRelations({ limit: "200" }).then((x) => x.data ?? []),
    ...queryOptions,
  }))

  const embeddingStatus = useQuery(() => ({
    queryKey: ["settings", "memory", "embedding-status"],
    queryFn: async () => {
      const res = await (globalSDK.client.memory as any).embeddingStatus()
      return res.data
    },
    ...queryOptions,
    staleTime: 5_000,
  }))

  createEffect(() => {
    const status = embeddingStatus.data
    if (!status) return
    if (!installDir() && status.installDir) setInstallDir(status.installDir)
    if (!modelsDir() && status.modelsDir) setModelsDir(status.modelsDir)
  })

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

  const removeRelation = useMutation(() => ({
    mutationFn: (relationID: string) => globalSDK.client.memory.removeRelation({ relationID }),
    onSuccess: () => queryClient.refetchQueries({ queryKey: ["settings", "memory", "relations"] }),
    onError: (err) =>
      showToast({
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      }),
  }))

  const apply = useMutation(() => ({
    mutationFn: (input: { candidateID: string; scope?: "global" | "project" | "session" }) =>
      globalSDK.client.memory.applyReviewCandidate(input),
    onSuccess: async (_data, variables) => {
      await refetchReview()
      const label = variables.scope === "global" ? "全局" : variables.scope === "session" ? "本会话" : "本项目"
      showToast({
        variant: "success",
        icon: "circle-check",
        title: `已记为【${label}】`,
        description: "记忆已写入，后续相关对话会按需召回。",
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

  const updateEmbeddingMode = (value: "auto" | "local" | "provider" | "ollama" | "off") =>
    updateConfig.mutate({
      ...memoryConfig(),
      embedding_mode: value,
    })

  const setupLocalEmbedding = async () => {
    await globalSync.updateConfig({
      memory: {
        ...memoryConfig(),
        embedding_ollama_install_dir: installDir().trim() || undefined,
        embedding_ollama_models_dir: modelsDir().trim() || undefined,
      },
    } as Config)
    const setup = runMemorySetup(async (updatePhase) => {
      const poll = async () => {
        try {
          const res = await (globalSDK.client.memory as any).embeddingStatus()
          const phase = res.data?.phase
          if (phase) updatePhase(phase)
        } catch {
          // ignore polling errors
        }
      }
      const pollHandle = setInterval(poll, 2_000)
      try {
        const res = await (globalSDK.client.memory as any).embeddingSetupLocal({
          allowInstall: true,
          applyConfig: true,
          installDir: installDir().trim() || undefined,
          modelsDir: modelsDir().trim() || undefined,
        })
        return res.data
      } finally {
        clearInterval(pollHandle)
      }
    })
    if (!setup.started) return
    try {
      const data = await setup.promise
      if (data.config) {
        await globalSync.updateConfig({
          memory: {
            ...memoryConfig(),
            ...data.config,
          },
        } as Config)
      }
      await queryClient.refetchQueries({ queryKey: ["settings", "memory", "embedding-status"] })
      showToast({
        variant: data.ok ? "success" : "error",
        icon: data.ok ? "circle-check" : "circle-x",
        title: data.ok
          ? language.t("settings.memory.retrieval.setup.success" as never)
          : language.t("settings.memory.retrieval.setup.partial" as never),
        description: data.status?.hint || data.status?.message || data.status?.downloadURL || "",
      })
    } catch (err) {
      showToast({
        title: language.t("settings.memory.retrieval.setup.failed" as never),
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const setupPhaseLabel = () => {
    const phase = memorySetupState.phase
    if (!phase) return ""
    return language.t(`settings.memory.retrieval.setup.phase.${phase}` as never)
  }

  const isOllamaReady = createMemo(() => {
    const data = embeddingStatus.data
    return Boolean(data?.cliInstalled && data?.daemonRunning && data?.hasEmbedModel)
  })

  const embeddingMode = () => memoryConfig().embedding_mode ?? "auto"
  const formatEmbeddingStatus = () => {
    const data = embeddingStatus.data as
      | {
          ready?: boolean
          cliInstalled?: boolean
          daemonRunning?: boolean
          hasEmbedModel?: boolean
          selectedModel?: string
          activeBackendLabel?: string
          message?: string
          hint?: string
        }
      | undefined
    if (embeddingStatus.isLoading) return "正在检测本机 Ollama…"
    if (!data) return "尚未检测"
    if (data.ready) return `本地向量已就绪${data.selectedModel ? `（${data.selectedModel}）` : ""}`
    if (!data.cliInstalled) return "未检测到 Ollama（可一键尝试安装）"
    if (!data.daemonRunning) return "已安装 Ollama，但服务未运行"
    if (!data.hasEmbedModel) return "Ollama 已运行，仍需拉取嵌入模型"
    return data.message || "状态未知"
  }

  const embeddingModeHintKey = () => `settings.memory.retrieval.mode.${embeddingMode()}.hint` as const

  const saveOllamaDirectories = () => {
    updateConfig.mutate({
      ...memoryConfig(),
      embedding_ollama_install_dir: installDir().trim() || undefined,
      embedding_ollama_models_dir: modelsDir().trim() || undefined,
    })
  }

  const chooseOllamaDirectory = async (target: "install" | "models") => {
    const result = await platform.openDirectoryPickerDialog?.({
      title: target === "install" ? "选择 Ollama 程序安装目录" : "选择 Ollama 模型存储目录",
      multiple: false,
    })
    const value = Array.isArray(result) ? result[0] : result
    if (!value) return
    if (target === "install") setInstallDir(value)
    else setModelsDir(value)
  }

  const updateReviewInterval = (value: string) =>
    updateConfig.mutate({
      ...memoryConfig(),
      review_interval: Math.max(Math.floor(Number(value) || 0), 0),
    })

  const counts = createMemo(() => memoryReviewCounts(reviewStatus.data))
  const filteredCandidates = createMemo(() => {
    const query = candidateSearch().trim().toLowerCase()
    const list = candidates.data ?? []
    if (!query) return list
    return list.filter((candidate) =>
      [
        candidate.content,
        candidate.summary,
        candidate.reason,
        candidate.kind,
        candidate.domain,
        ...candidateTags(candidate),
      ]
        .map((value) => String(value ?? "").toLowerCase())
        .some((value) => value.includes(query)),
    )
  })
  const filteredEntries = createMemo(() => entries.data ?? [])

  const body = (
    <>
      <MemoryViewTabs value={view()} onChange={setView} />
      <Show when={view() === "config"}>
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
                checked={memoryConfig().enabled !== false}
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
                checked={memoryConfig().review_enabled !== false}
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
                checked={memoryConfig().review_llm !== false}
                disabled={updateConfig.isPending || memoryConfig().review_enabled === false}
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
            title={language.t("settings.memory.section.retrieval" as never)}
            description={language.t("settings.memory.retrieval.guide.body" as never)}
          />
          <SettingsList>
            <div class="flex flex-col gap-3 py-3 border-b border-border-weak-base">
              <div class="flex flex-col gap-1">
                <span class="text-14-medium text-text-strong">
                  {language.t("settings.memory.retrieval.guide.title" as never)}
                </span>
                <pre class="whitespace-pre-wrap text-12-regular text-text-weak font-sans m-0">
                  {language.t("settings.memory.retrieval.guide.steps" as never)}
                </pre>
                <span class="text-12-regular text-text-weak">
                  {language.t("settings.memory.retrieval.docs" as never)}
                </span>
              </div>
            </div>
            <div class="flex flex-col gap-3 py-3">
              <div class="flex flex-col gap-1">
                <span class="text-14-medium text-text-strong">
                  {language.t("settings.memory.retrieval.mode.title" as never)}
                </span>
                <span class="text-12-regular text-text-weak">
                  {language.t("settings.memory.retrieval.mode.description" as never)}
                </span>
              </div>
              <div class="flex flex-wrap gap-1">
                <For each={["auto", "local", "provider", "ollama", "off"] as const}>
                  {(value) => (
                    <button
                      type="button"
                      class="h-8 px-3 rounded-md text-13-medium border transition-colors"
                      classList={{
                        "bg-surface-base-active text-text-strong border-border-weak-base": embeddingMode() === value,
                        "bg-transparent text-text-weak border-transparent hover:bg-surface-base-hover":
                          embeddingMode() !== value,
                      }}
                      disabled={updateConfig.isPending}
                      onClick={() => updateEmbeddingMode(value)}
                    >
                      {language.t(`settings.memory.retrieval.mode.${value}` as never)}
                    </button>
                  )}
                </For>
              </div>
              <span class="text-12-regular text-text-weak">{language.t(embeddingModeHintKey() as never)}</span>
            </div>
            <div class="flex flex-col gap-3 py-3 border-t border-border-weak-base">
              <div class="flex flex-col gap-1">
                <span class="text-14-medium text-text-strong">
                  {language.t("settings.memory.retrieval.setup.title" as never)}
                </span>
                <span class="text-12-regular text-text-weak">
                  {language.t("settings.memory.retrieval.setup.description" as never)}
                </span>
              </div>
              <div class="rounded-md border border-border-weak-base bg-surface-base px-3 py-2 text-12-regular text-text-weak">
                <div>
                  {language.t("settings.memory.retrieval.status.title" as never)}?{formatEmbeddingStatus()}
                </div>
                <Show when={embeddingStatus.data?.activeBackendLabel}>
                  <div class="mt-1">当前后端：{embeddingStatus.data?.activeBackendLabel}</div>
                </Show>
                <Show when={embeddingStatus.data?.hint}>
                  <div class="mt-1">{embeddingStatus.data?.hint}</div>
                </Show>
                <Show when={embeddingStatus.data?.installDir}>
                  <div class="mt-1">当前程序目录：{embeddingStatus.data?.installDir}</div>
                </Show>
                <Show when={embeddingStatus.data?.modelsDir}>
                  <div class="mt-1">当前模型目录：{embeddingStatus.data?.modelsDir}</div>
                </Show>
              </div>
              <div class="flex flex-col gap-3 rounded-md border border-border-weak-base bg-surface-base px-3 py-3">
                <TextField
                  label="Ollama 程序安装目录"
                  value={installDir()}
                  onChange={setInstallDir}
                  placeholder="留空使用系统默认目录"
                  spellcheck={false}
                  autocorrect="off"
                  autocomplete="off"
                  autocapitalize="off"
                />
                <div class="flex justify-end">
                  <Button type="button" variant="secondary" onClick={() => void chooseOllamaDirectory("install")}>
                    选择程序目录
                  </Button>
                </div>
                <TextField
                  label="Ollama 模型存储目录"
                  value={modelsDir()}
                  onChange={setModelsDir}
                  placeholder="建议选择空间充足的非系统盘目录"
                  spellcheck={false}
                  autocorrect="off"
                  autocomplete="off"
                  autocapitalize="off"
                />
                <div class="flex justify-end">
                  <Button type="button" variant="secondary" onClick={() => void chooseOllamaDirectory("models")}>
                    选择模型目录
                  </Button>
                </div>
                <div class="text-12-regular text-text-weak">
                  模型目录会用于 `OLLAMA_MODELS`。修改后需要重新启动 Ollama 服务才会完全生效。
                </div>
                <div class="flex justify-end">
                  <Button type="button" variant="secondary" onClick={saveOllamaDirectories}>
                    保存目录设置
                  </Button>
                </div>
              </div>
              <Show when={memorySetupState.running}>
                <Show when={memorySetupState.phase}>
                  <div class="flex flex-col gap-1 rounded-md border border-border-weak-base bg-surface-base px-3 py-2">
                    <div class="flex items-center gap-2 text-13-medium text-text-strong">
                      <span class="inline-block size-3 novaway-spinner rounded-full border-2 border-text-weak border-t-transparent" />
                      <span>{setupPhaseLabel()}</span>
                    </div>
                    <div class="text-12-regular text-text-weak">
                      {language.t("settings.memory.retrieval.status.title" as never)}?{formatEmbeddingStatus()}
                    </div>
                  </div>
                </Show>
                <Show when={!memorySetupState.phase}>
                  <div class="flex items-center gap-2 text-13-medium text-text-strong">
                    <span class="inline-block size-3 novaway-spinner rounded-full border-2 border-text-weak border-t-transparent" />
                    <span>{language.t("settings.memory.retrieval.setup.running" as never)}</span>
                  </div>
                </Show>
              </Show>
              <Show when={!isOllamaReady() && !memorySetupState.running}>
                <Button variant="primary" disabled={updateConfig.isPending} onClick={() => void setupLocalEmbedding()}>
                  {language.t("settings.memory.retrieval.setup.button" as never)}
                </Button>
              </Show>
              <Show when={memorySetupState.log}>
                <pre class="whitespace-pre-wrap text-12-regular text-text-weak font-sans m-0 max-h-40 overflow-auto">
                  {memorySetupState.log}
                </pre>
              </Show>
            </div>
          </SettingsList>
        </div>
      </Show>

      <Show when={view() === "review"}>
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
            <TextField
              label="搜索候选"
              value={candidateSearch()}
              onChange={setCandidateSearch}
              placeholder="按内容、标签或领域搜索"
              spellcheck={false}
              autocorrect="off"
              autocomplete="off"
              autocapitalize="off"
            />
          </div>
          <div class="flex flex-col gap-2">
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
                      onApply={(scope) => apply.mutate({ candidateID: candidate.id, scope })}
                      onDismiss={() => dismiss.mutate(candidate.id)}
                    />
                  )}
                </For>
              </Show>
            </Show>
          </div>
        </div>
      </Show>
      <Show when={view() === "relations"}>
        <div>
          <SectionTitle title="关系图谱" description="自动汇总当前记忆中的实体关系。" />
          <RelationGraph relations={relations.data ?? []} loading={relations.isLoading} />
          <div class="mt-3 rounded-lg border border-border-weak-base bg-surface-base px-4 py-2">
            <Show when={!relations.isLoading} fallback={<LoadingState />}>
              <Show when={(relations.data?.length ?? 0) > 0} fallback={<EmptyState message="暂无关系记录" />}>
                <For each={relations.data}>
                  {(relation) => (
                    <div class="flex flex-wrap items-center gap-2 py-3 border-b border-border-weak-base last:border-none">
                      <Tag>{relation.source}</Tag>
                      <span class="text-12-medium text-text-weak">{relation.relation}</span>
                      <Tag>{relation.target}</Tag>
                      <span class="text-11-regular text-text-weak">{relation.memoryID}</span>
                      <ReviewActionButton
                        icon="close"
                        disabled={removeRelation.isPending}
                        onClick={() => removeRelation.mutate(relation.id)}
                        label="删除关系"
                      />
                    </div>
                  )}
                </For>
              </Show>
            </Show>
          </div>
        </div>
      </Show>

      <Show when={view() === "entries"}>
        <div>
          <SectionTitle
            title="已写入记忆"
            description="按范围查看当前生效的长期记忆（全局跨项目，本项目仅当前工作区）。"
          />
          <SettingsList>
            <Show when={!entries.isLoading} fallback={<LoadingState />}>
              <Show when={filteredEntries().length > 0} fallback={<EmptyState message="暂无已写入记忆" />}>
                <For each={filteredEntries()}>
                  {(item) => (
                    <div class="flex items-start justify-between gap-4 py-3 border-b border-border-weak-base last:border-none">
                      <div class="min-w-0 flex flex-col gap-1">
                        <div class="flex flex-wrap items-center gap-2">
                          <span class="text-14-medium text-text-strong break-words">
                            {item.summary || item.content}
                          </span>
                          <Tag>{item.scope === "global" ? "全局" : item.scope === "session" ? "本会话" : "本项目"}</Tag>
                          <Tag>{item.target === "user" ? "用户画像" : "项目记忆"}</Tag>
                          <Tag>{memoryKindLabel(item.kind)}</Tag>
                        </div>
                        <Show when={item.summary}>
                          <span class="text-12-regular text-text-base break-words">{item.content}</span>
                        </Show>
                        <Show when={(item.entities?.length ?? 0) > 0}>
                          <div class="flex flex-wrap gap-1 pt-1">
                            <For each={item.entities}>
                              {(entity) => <Tag>{entity.type ? `${entity.type}:${entity.name}` : entity.name}</Tag>}
                            </For>
                          </div>
                        </Show>
                      </div>
                    </div>
                  )}
                </For>
              </Show>
            </Show>
          </SettingsList>
        </div>
      </Show>
    </>
  )
  if (props.embedded) return body
  return (
    <SettingsPage
      title={language.t("settings.memory.title" as never)}
      description={language.t("settings.memory.description" as never)}
    >
      {body}
    </SettingsPage>
  )
}
