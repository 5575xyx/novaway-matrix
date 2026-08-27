import { createSignal, createMemo, onMount, For, Show, batch } from "solid-js"
import { icon } from "../util/panel-icons"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { DialogConfirm } from "../ui/dialog-confirm"
import {
  memoryApi,
  type MemoryReviewCandidate,
  type MemoryReviewStatus,
} from "../util/memory-evolution-api"

type FilterStatus = "pending" | "applied" | "dismissed"

function memoryDomainLabel(domain: string): string {
  const labels: Record<string, string> = {
    general: "通用",
    coding: "编程",
    office: "办公",
    personal: "个人",
    research: "研究",
    ops: "运维",
  }
  return labels[domain] ?? domain
}

function memoryKindLabel(kind: string | undefined): string {
  if (!kind) return ""
  const labels: Record<string, string> = {
    episodic: "事件",
    semantic: "语义",
    preference: "偏好",
    goal: "目标",
    decision: "决策",
    relationship: "关系",
    lesson: "教训",
    procedure: "流程",
  }
  return labels[kind] ?? kind
}

function memoryOperationLabel(op: string): string {
  const labels: Record<string, string> = {
    add: "新增",
    update: "更新",
    archive: "归档",
    confirm: "确认",
  }
  return labels[op] ?? op
}

export interface MemoryPanelProps {
  sessionID: string
}

export function MemoryPanel(props: MemoryPanelProps) {
  const sdk = useSDK()
  const { theme } = useTheme()
  const dialog = useDialog()

  const [status, setStatus] = createSignal<MemoryReviewStatus | null>(null)
  const [candidates, setCandidates] = createSignal<MemoryReviewCandidate[]>([])
  const [filter, setFilter] = createSignal<FilterStatus>("pending")
  const [loading, setLoading] = createSignal(true)
  const [scope, setScope] = createSignal<"global" | "project" | "session">("project")

  const pendingCount = createMemo(() => status()?.pending ?? 0)

  const filteredCandidates = createMemo(() => {
    return candidates().filter((c) => c.status === filter())
  })

  async function loadData() {
    setLoading(true)
    try {
      const [statusRes, candidatesRes] = await Promise.all([
        memoryApi.reviewStatus(sdk.client),
        memoryApi.listReviewCandidates(sdk.client, { status: filter(), limit: 20 }),
      ])
      batch(() => {
        setStatus(statusRes)
        setCandidates(candidatesRes)
      })
    } catch {
      // 静默失败
    } finally {
      setLoading(false)
    }
  }

  async function refresh() {
    await loadData()
  }

  async function applyCandidate(candidateID: string) {
    const success = await memoryApi.applyReviewCandidate(sdk.client, {
      candidateID,
      scope: scope(),
    })
    if (success) await refresh()
  }

  async function dismissCandidate(candidateID: string) {
    const confirmed = await DialogConfirm.show(dialog, "驳回记忆", "确定要驳回此记忆候选吗？")
    if (!confirmed) return
    const success = await memoryApi.dismissReviewCandidate(sdk.client, candidateID)
    if (success) await refresh()
  }

  async function switchFilter(s: FilterStatus) {
    setFilter(s)
    const data = await memoryApi.listReviewCandidates(sdk.client, { status: s, limit: 20 })
    setCandidates(data)
  }

  onMount(loadData)

  return (
    <box flexDirection="column" gap={1}>
      {/* 标题 */}
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text}>
          <b>{icon("memory")} 持久记忆</b>
        </text>
        <text fg={theme.textMuted} onMouseUp={refresh}>
          {loading() ? "..." : "刷新"}
        </text>
      </box>

      {/* 统计 */}
      <text fg={theme.textMuted}>
        {pendingCount()} 待审 · {status()?.total ?? 0} 总计
      </text>

      {/* Scope 选择 */}
      <box flexDirection="row" gap={1}>
        <text fg={theme.textMuted}>范围:</text>
        <For each={["global", "project", "session"] as const}>
          {(s) => (
            <text
              fg={scope() === s ? theme.primary : theme.textMuted}
              onMouseUp={() => setScope(s)}
            >
              [{s === "global" ? "全局" : s === "project" ? "项目" : "会话"}]
            </text>
          )}
        </For>
      </box>

      {/* 状态筛选 */}
      <box flexDirection="row" gap={1}>
        <For each={["pending", "applied", "dismissed"] as const}>
          {(s) => (
            <text
              fg={filter() === s ? theme.primary : theme.textMuted}
              onMouseUp={() => switchFilter(s)}
            >
              [{s === "pending" ? "待审" : s === "applied" ? "已应用" : "已驳回"}]
            </text>
          )}
        </For>
      </box>

      {/* 候选列表 */}
      <Show
        when={filteredCandidates().length > 0}
        fallback={<text fg={theme.textMuted}>{loading() ? "加载中..." : "暂无数据"}</text>}
      >
        <For each={filteredCandidates()}>
          {(candidate) => (
            <box flexDirection="column" gap={0} paddingBottom={1}>
              <text fg={theme.text} wrapMode="none">
                <span style={{ fg: theme.accent }}>●</span>{" "}
                {candidate.summary ?? candidate.content.slice(0, 40)}
              </text>
              <box flexDirection="row" gap={1}>
                <text fg={theme.textMuted}>
                  {memoryDomainLabel(candidate.domain)}
                  {candidate.kind ? ` · ${memoryKindLabel(candidate.kind)}` : ""}
                  {" · "}
                  {memoryOperationLabel(candidate.operation)}
                </text>
              </box>
              <Show when={candidate.tags.length > 0}>
                <box flexDirection="row" gap={1} flexWrap="wrap">
                  <For each={candidate.tags.slice(0, 3)}>
                    {(tag) => (
                      <text fg={theme.textMuted}>[{tag}]</text>
                    )}
                  </For>
                </box>
              </Show>
              <Show when={candidate.status === "pending"}>
                <box flexDirection="row" gap={1}>
                  <text fg={theme.success} onMouseUp={() => applyCandidate(candidate.id)}>
                    [应用]
                  </text>
                  <text fg={theme.error} onMouseUp={() => dismissCandidate(candidate.id)}>
                    [驳回]
                  </text>
                </box>
              </Show>
            </box>
          )}
        </For>
      </Show>
    </box>
  )
}
