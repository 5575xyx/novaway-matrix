import type { Config, MemoryRelation, MemoryReviewCandidate } from "@novaway/sdk/v2/client"
import { Button } from "@novaway/ui/button"
import { Dialog } from "@novaway/ui/dialog"
import { useDialog } from "@novaway/ui/context/dialog"
import { Icon } from "@novaway/ui/icon"
import { IconButton } from "@novaway/ui/icon-button"
import { Switch } from "@novaway/ui/switch"
import { Tag } from "@novaway/ui/tag"
import { Select } from "@novaway/ui/select"
import { TextField } from "@novaway/ui/text-field"
import { showToast } from "@novaway/ui/toast"
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query"
import { createEffect, createMemo, createSignal, For, Show, type Component, type JSX } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { ReviewActionButton } from "./review-action-button"
import { AiFixButton } from "./ai-fix-button"
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
import { SettingsGroup, SettingsRow } from "./settings-parts"
import { formatRelativeTime } from "@/utils/relative-time"
import { aiFixLabels, buildAiFixDetails, type AiFixContext } from "@/utils/ai-fix"

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
    <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--popover)_calc(100%_-_24px),transparent)]">
      <div class="flex flex-col gap-1 pt-6 pb-8 w-full">
        <h2 class="text-16-medium text-foreground">{props.title}</h2>
        <p class="text-13-regular text-foreground-subtle">{props.description}</p>
      </div>
    </div>
    <div class="flex flex-col gap-8 w-full">{props.children}</div>
  </div>
)

const SectionTitle: Component<{ title: string; description?: string }> = (props) => (
  <div class="flex flex-col gap-1 pb-2">
    <h3 class="text-14-medium text-foreground">{props.title}</h3>
    <Show when={props.description}>
      <p class="text-12-regular text-foreground-subtle">{props.description}</p>
    </Show>
  </div>
)

const EmptyState: Component<{ message: string }> = (props) => (
  <div class="py-4 text-14-regular text-foreground-subtle">{props.message}</div>
)

function candidateTags(candidate: MemoryReviewCandidate) {
  return Array.isArray(candidate.tags) ? candidate.tags : []
}

const LoadingState: Component = () => (
  <div class="flex items-center gap-2 py-4 text-14-regular text-foreground-subtle">
    <span class="size-4 rounded-full border border-border-hover border-t-transparent novaway-spinner" />
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
              "bg-selected text-foreground border-border": props.value === value,
              "bg-transparent text-foreground-subtle border-transparent hover:bg-hover hover:text-foreground":
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
    <div class="flex items-start justify-between gap-4 rounded-lg border border-border bg-surface px-4 py-3">
      <div class="flex min-w-0 flex-1 items-start gap-3">
        <Icon name="brain" class="size-5 shrink-0 icon-strong-base mt-0.5" />
        <div class="flex min-w-0 flex-col gap-1">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-14-medium text-foreground break-words">
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
                  "border-border-hover bg-selected": scope() === "global",
                  "border-transparent text-foreground-subtle": scope() !== "global",
                }}
                onClick={() => setScope("global")}
              >
                全局
              </button>
              <button
                type="button"
                class="h-5 rounded px-1.5 text-11-medium border"
                classList={{
                  "border-border-hover bg-selected": scope() === "project",
                  "border-transparent text-foreground-subtle": scope() !== "project",
                }}
                onClick={() => setScope("project")}
              >
                本项目
              </button>
            </div>
          </div>
          <Show when={props.candidate.summary}>
            <span class="text-12-regular text-foreground break-words">{props.candidate.content}</span>
          </Show>
          <div class="flex flex-wrap items-center gap-2 text-12-regular text-foreground-subtle">
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
            "bg-selected text-foreground border-border": props.value === view.id,
            "bg-transparent text-foreground-subtle border-transparent hover:bg-hover hover:text-foreground":
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
    <div class="rounded-lg border border-border bg-surface px-3 py-3">
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
                    <text
                      x={edge.mid.x}
                      y={edge.mid.y}
                      text-anchor="middle"
                      class="fill-foreground-subtle text-10-medium"
                    >
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
                    <text x={node.x} y={node.y + 4} text-anchor="middle" class="fill-foreground text-11-medium">
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

export const SettingsMemory: Component<{ embedded?: boolean; directory?: string }> = (props) => {
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  // 记忆是**按项目**存的（global 作用域属于所有项目）。全局 SDK 客户端不带
  // directory，会落到服务端默认实例上——那会把「已写入」永远显示成当前项目之外
  // 的记忆（通常就是 0 条）。这里显式按当前目录建一个客户端。
  const client = createMemo(() => {
    const directory = props.directory
    if (!directory) return globalSDK.client
    return globalSDK.createClient({ directory, throwOnError: true })
  })
  const globalSync = useGlobalSync()
  const queryClient = useQueryClient()
  const platform = usePlatform()
  const dialog = useDialog()
  const [tab, setTab] = createSignal<ReviewStatus>("pending")
  const [view, setView] = createSignal<MemoryView>("config")
  const [candidateSearch, setCandidateSearch] = createSignal("")
  const [entrySearch, setEntrySearch] = createSignal("")
  // ZCode 记忆页左侧的项目下拉：这里用记忆的写入范围代替（全局 / 本项目 / 本会话），
  // 默认「全部范围」，与右侧条数、搜索同一行。
  const [entryScope, setEntryScope] = createSignal<"all" | "global" | "project" | "session">("all")
  const scopeOptions = createMemo(() => [
    { value: "all" as const, label: language.t("settings.memory.entries.scope.all" as never) },
    { value: "project" as const, label: language.t("settings.memory.entries.scope.project" as never) },
    { value: "session" as const, label: language.t("settings.memory.entries.scope.session" as never) },
    { value: "global" as const, label: language.t("settings.memory.entries.scope.global" as never) },
  ])
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
    queryFn: () =>
      client()
        .memory.reviewStatus()
        .then((x) => x.data),
    ...queryOptions,
  }))

  const entries = useQuery(() => ({
    queryKey: ["settings", "memory", "entries"],
    queryFn: () =>
      client()
        .memory.list({ limit: 100, includeGlobal: true } as never)
        .then((x) => x.data ?? []),
    ...queryOptions,
  }))

  const removeEntry = useMutation(() => ({
    mutationFn: (memoryID: string) => client().memory.remove({ memoryID }),
    onSuccess: () => {
      void entries.refetch()
      showToast({ variant: "success", icon: "circle-check", title: "已删除记忆" })
    },
  }))
  const confirmRemoveEntry = (item: { id: string; summary?: string; content: string }) => {
    dialog.show(() => (
      <Dialog title={language.t("common.delete")} description={item.summary || item.content} fit>
        <div class="flex justify-end gap-2 px-4 pb-4">
          <Button variant="ghost" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              removeEntry.mutate(item.id)
              dialog.close()
            }}
          >
            {language.t("common.delete")}
          </Button>
        </div>
      </Dialog>
    ))
  }

  const relations = useQuery(() => ({
    queryKey: ["settings", "memory", "relations"],
    queryFn: () =>
      client()
        .memory.listRelations({ limit: "200" })
        .then((x) => x.data ?? []),
    ...queryOptions,
  }))

  const embeddingStatus = useQuery(() => ({
    queryKey: ["settings", "memory", "embedding-status"],
    queryFn: async () => {
      const res = await (client().memory as any).embeddingStatus()
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
      client()
        .memory.listReviewCandidates({ status: tab(), limit: 100 })
        .then((x) => x.data ?? []),
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
    mutationFn: (relationID: string) => client().memory.removeRelation({ relationID }),
    onSuccess: () => queryClient.refetchQueries({ queryKey: ["settings", "memory", "relations"] }),
    onError: (err) =>
      showToast({
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      }),
  }))

  const apply = useMutation(() => ({
    mutationFn: (input: { candidateID: string; scope?: "global" | "project" | "session" }) =>
      client().memory.applyReviewCandidate(input),
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
    mutationFn: (candidateID: string) => client().memory.dismissReviewCandidate({ candidateID }),
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

  const navigate = useNavigate()
  const params = useParams()

  /** 安装卡住时，把状态和日志交给 AI，由它调用 memory_embedding_setup 继续排查。 */
  const askAiToFix = (context: AiFixContext) => {
    const details = buildAiFixDetails(context, aiFixLabels(language.t as never))
    const prompt = language.t("settings.memory.retrieval.aiFixPrompt", {
      installDir: installDir().trim() || "（默认）",
      modelsDir: modelsDir().trim() || "（默认）",
      details,
    })
    navigate(`/${params.dir}/session?prompt=${encodeURIComponent(prompt)}&submit=1`)
  }

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
          const res = await (client().memory as any).embeddingStatus()
          const phase = res.data?.phase
          if (phase) updatePhase(phase)
        } catch {
          // ignore polling errors
        }
      }
      const pollHandle = setInterval(poll, 2_000)
      try {
        const res = await (client().memory as any).embeddingSetupLocal({
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
        persistent: !data.ok,
        actions: data.ok
          ? undefined
          : [
              {
                label: language.t("aiFix.action"),
                onClick: () =>
                  askAiToFix({
                    status: formatEmbeddingStatus(),
                    hint: data.status?.hint,
                    log: memorySetupState.log,
                  }),
              },
            ],
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
  const filteredEntries = createMemo(() => {
    const scope = entryScope()
    const list = (entries.data ?? []).filter((item) => scope === "all" || item.scope === scope)
    const query = entrySearch().trim().toLowerCase()
    if (!query) return list
    return list.filter((item) =>
      [item.summary, item.content, item.kind, ...(item.entities ?? []).map((e) => e.name)]
        .map((value) => String(value ?? "").toLowerCase())
        .some((value) => value.includes(query)),
    )
  })

  // created/updated 在 API 里是 number | "NaN" 之类的联合，先归一化成 number 再格式化。
  const entryUpdatedLabel = (item: { time?: { created?: unknown; updated?: unknown } }) => {
    const value = Number(item.time?.updated ?? item.time?.created)
    if (!Number.isFinite(value)) return ""
    return formatRelativeTime(value, Date.now(), language.t)
  }

  const body = (
    <>
      <MemoryViewTabs value={view()} onChange={setView} />
      <Show when={view() === "config"}>
        <div>
          <SectionTitle title={language.t("settings.memory.section.config" as never)} />
          <SettingsGroup>
            <SettingsRow
              label={language.t("settings.memory.config.enabled.title" as never)}
              description={language.t("settings.memory.config.enabled.description" as never)}
              control={
                <Switch
                  checked={memoryConfig().enabled !== false}
                  disabled={updateConfig.isPending}
                  onChange={(value) => toggleConfig("enabled", value)}
                  hideLabel
                >
                  {language.t("settings.memory.config.enabled.title" as never)}
                </Switch>
              }
            />
            <SettingsRow
              label={language.t("settings.memory.config.review.title" as never)}
              description={language.t("settings.memory.config.review.description" as never)}
              control={
                <Switch
                  checked={memoryConfig().review_enabled !== false}
                  disabled={updateConfig.isPending}
                  onChange={(value) => toggleConfig("review_enabled", value)}
                  hideLabel
                >
                  {language.t("settings.memory.config.review.title" as never)}
                </Switch>
              }
            />
            <SettingsRow
              label={language.t("settings.memory.config.llm.title" as never)}
              description={language.t("settings.memory.config.llm.description" as never)}
              control={
                <Switch
                  checked={memoryConfig().review_llm !== false}
                  disabled={updateConfig.isPending || memoryConfig().review_enabled === false}
                  onChange={(value) => toggleConfig("review_llm", value)}
                  hideLabel
                >
                  {language.t("settings.memory.config.llm.title" as never)}
                </Switch>
              }
            />
            <SettingsRow
              label={language.t("settings.memory.config.interval.title" as never)}
              description={language.t("settings.memory.config.interval.description" as never)}
              control={
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
              }
            />
          </SettingsGroup>
        </div>

        <div>
          <SectionTitle
            title={language.t("settings.memory.section.retrieval" as never)}
            description={language.t("settings.memory.retrieval.guide.body" as never)}
          />
          <SettingsGroup>
            <SettingsRow
              label={language.t("settings.memory.retrieval.guide.title" as never)}
              description={
                <pre class="m-0 whitespace-pre-wrap font-sans text-12-regular text-foreground-subtle">
                  {language.t("settings.memory.retrieval.guide.steps" as never)}
                </pre>
              }
              control={null}
              detail={
                <span class="text-12-regular text-foreground-subtle">
                  {language.t("settings.memory.retrieval.docs" as never)}
                </span>
              }
            />
            <SettingsRow
              layout="wide"
              label={language.t("settings.memory.retrieval.mode.title" as never)}
              description={language.t("settings.memory.retrieval.mode.description" as never)}
              control={
                <div class="flex flex-wrap justify-end gap-1">
                  <For each={["auto", "local", "provider", "ollama", "off"] as const}>
                    {(value) => (
                      <button
                        type="button"
                        class="h-8 rounded-md border px-3 text-13-medium transition-colors"
                        classList={{
                          "bg-selected text-foreground border-border": embeddingMode() === value,
                          "bg-transparent text-foreground-subtle border-transparent hover:bg-hover":
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
              }
              detail={
                <span class="text-12-regular text-foreground-subtle">
                  {language.t(embeddingModeHintKey() as never)}
                </span>
              }
            />
            <SettingsRow
              label={language.t("settings.memory.retrieval.setup.title" as never)}
              description={language.t("settings.memory.retrieval.setup.description" as never)}
              control={
                <Show when={!isOllamaReady() && !memorySetupState.running}>
                  <div class="flex flex-wrap items-center justify-end gap-2">
                    <AiFixButton
                      promptKey="settings.memory.retrieval.aiFixPrompt"
                      params={{
                        installDir: installDir().trim() || "（默认）",
                        modelsDir: modelsDir().trim() || "（默认）",
                      }}
                      context={() => ({
                        status: formatEmbeddingStatus(),
                        hint: embeddingStatus.data?.hint,
                        log: memorySetupState.log,
                        facts: {
                          "active backend": embeddingStatus.data?.activeBackendLabel,
                          "ollama cli": embeddingStatus.data?.cliInstalled ? "installed" : "missing",
                          daemon: embeddingStatus.data?.daemonRunning ? "running" : "stopped",
                          "embedding model": embeddingStatus.data?.hasEmbedModel
                            ? (embeddingStatus.data?.selectedModel ?? "ready")
                            : "missing",
                          "install dir": installDir().trim() || undefined,
                          "models dir": modelsDir().trim() || undefined,
                        },
                      })}
                    />
                    <Button
                      variant="primary"
                      disabled={updateConfig.isPending}
                      onClick={() => void setupLocalEmbedding()}
                    >
                      {language.t("settings.memory.retrieval.setup.button" as never)}
                    </Button>
                  </div>
                </Show>
              }
              detail={
                <div class="flex flex-col gap-3">
                  <div class="rounded-md border border-border bg-background px-3 py-2 text-12-regular text-foreground-subtle">
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
                  <div class="flex flex-col gap-3 rounded-md border border-border bg-background px-3 py-3">
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
                    <div class="text-12-regular text-foreground-subtle">
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
                      <div class="flex flex-col gap-1 rounded-md border border-border bg-background px-3 py-2">
                        <div class="flex items-center gap-2 text-13-medium text-foreground">
                          <span class="inline-block size-3 novaway-spinner rounded-full border-2 border-border border-t-transparent" />
                          <span>{setupPhaseLabel()}</span>
                        </div>
                        <div class="text-12-regular text-foreground-subtle">
                          {language.t("settings.memory.retrieval.status.title" as never)}?{formatEmbeddingStatus()}
                        </div>
                      </div>
                    </Show>
                    <Show when={!memorySetupState.phase}>
                      <div class="flex items-center gap-2 text-13-medium text-foreground">
                        <span class="inline-block size-3 novaway-spinner rounded-full border-2 border-border border-t-transparent" />
                        <span>{language.t("settings.memory.retrieval.setup.running" as never)}</span>
                      </div>
                    </Show>
                  </Show>
                  <Show when={memorySetupState.log}>
                    <pre class="m-0 max-h-40 overflow-auto whitespace-pre-wrap font-sans text-12-regular text-foreground-subtle">
                      {memorySetupState.log}
                    </pre>
                  </Show>
                </div>
              }
            />
          </SettingsGroup>
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
          <div class="mt-3 rounded-lg border border-border bg-surface px-4 py-2">
            <Show when={!relations.isLoading} fallback={<LoadingState />}>
              <Show when={(relations.data?.length ?? 0) > 0} fallback={<EmptyState message="暂无关系记录" />}>
                <For each={relations.data}>
                  {(relation) => (
                    <div class="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
                      <Tag>{relation.source}</Tag>
                      <span class="text-12-medium text-foreground-subtle">{relation.relation}</span>
                      <Tag>{relation.target}</Tag>
                      <span class="text-11-regular text-foreground-subtle">{relation.memoryID}</span>
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
        <div class="flex flex-col gap-3">
          {/*
            对齐 ZCode 的记忆页（`MemorySettingsSection`）：顶部一行是
            「条数 + 搜索」，下面是**文件行**（图标 + 名称 + 时间 + 右侧操作），
            不是一堆带边框的卡片。我们的记忆是 DB 记录而不是磁盘文件，
            所以"文件名"用 `summary`（没有就截断 content），"时间"用 updated。
          */}
          <div class="flex flex-wrap items-center gap-3">
            <Select
              options={scopeOptions()}
              current={scopeOptions().find((option) => option.value === entryScope())}
              value={(option) => option.value}
              label={(option) => option.label}
              onSelect={(option) => {
                if (option) setEntryScope(option.value)
              }}
              variant="secondary"
              size="small"
            />
            <div class="h-4 w-px bg-border" aria-hidden="true" />
            <span class="shrink-0 text-12-regular text-foreground-subtle">
              {language.t("settings.memory.entries.count" as never, { count: filteredEntries().length } as never)}
            </span>
            <div class="ml-auto w-full sm:w-64">
              <TextField
                value={entrySearch()}
                onChange={setEntrySearch}
                placeholder={language.t("settings.memory.entries.search" as never)}
                spellcheck={false}
                autocorrect="off"
                autocomplete="off"
                autocapitalize="off"
              />
            </div>
          </div>

          <div class="flex items-center gap-2">
            <span class="text-12-medium text-foreground-subtle">
              {language.t("settings.memory.entries.files" as never)}
            </span>
            <IconButton
              icon="reset"
              variant="ghost"
              size="small"
              class="ml-auto"
              disabled={entries.isFetching}
              aria-label={language.t("common.refresh")}
              onClick={() => void entries.refetch()}
            />
          </div>

          <SettingsGroup>
            <Show when={!entries.isLoading} fallback={<LoadingState />}>
              <Show when={filteredEntries().length > 0} fallback={<EmptyState message="暂无已写入记忆" />}>
                <For each={filteredEntries()}>
                  {(item) => (
                    <div class="group flex items-start gap-3 border-t border-border px-4 py-3 transition-colors first:border-t-0 hover:bg-hover">
                      <span class="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-background">
                        <Icon name="review" size="small" class="text-foreground-subtle" />
                      </span>
                      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span class="truncate text-13-medium text-foreground">{item.summary || item.content}</span>
                        <span class="truncate text-11-regular text-foreground-subtle">
                          {item.scope === "global" ? "全局" : item.scope === "session" ? "本会话" : "本项目"}
                          <span class="text-foreground-subtlest"> · </span>
                          {memoryKindLabel(item.kind)}
                          <Show when={entryUpdatedLabel(item)}>
                            {(label) => (
                              <>
                                <span class="text-foreground-subtlest"> · </span>
                                {label()}
                              </>
                            )}
                          </Show>
                        </span>
                        <Show when={item.summary}>
                          <span class="line-clamp-2 text-11-regular text-foreground-subtle">{item.content}</span>
                        </Show>
                      </div>
                      {/* ZCode 的文件行右侧有编辑器操作；记忆是 DB 记录，对应操作就是删除。 */}
                      <IconButton
                        icon="trash"
                        variant="ghost"
                        size="small"
                        class="shrink-0 text-foreground-subtlest opacity-60 transition-opacity hover:opacity-100 group-hover:opacity-100"
                        aria-label={language.t("common.delete")}
                        onClick={() => confirmRemoveEntry(item)}
                      />
                    </div>
                  )}
                </For>
              </Show>
            </Show>
          </SettingsGroup>
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
