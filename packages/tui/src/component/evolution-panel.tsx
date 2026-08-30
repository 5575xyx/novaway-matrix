import { createSignal, createMemo, For, Show, batch } from "solid-js"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { DialogConfirm } from "../ui/dialog-confirm"
import {
  evolutionApi,
  type EvolutionCandidate,
  type EvolutionStatus,
} from "../util/memory-evolution-api"
import { useAutoRefresh } from "../util/auto-refresh"

type FilterStatus = "pending" | "applied" | "dismissed"

function evolutionKindLabel(kind: string): string {
  const labels: Record<string, string> = {
    skill: "技能",
    agent: "智能体",
    workflow: "工作流",
    prompt: "提示词",
    tool: "工具",
    project: "项目",
    strategy: "策略",
    habit: "习惯",
    knowledge: "知识",
  }
  return labels[kind] ?? kind
}

function evolutionDomainLabel(domain: string): string {
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

function evolutionValidationLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: "待验证",
    validated: "已验证",
    failed: "验证失败",
  }
  return labels[status] ?? status
}

export interface EvolutionPanelProps {
  sessionID: string
}

export function EvolutionPanel(props: EvolutionPanelProps) {
  const sdk = useSDK()
  const { theme } = useTheme()
  const dialog = useDialog()

  const [status, setStatus] = createSignal<EvolutionStatus | null>(null)
  const [candidates, setCandidates] = createSignal<EvolutionCandidate[]>([])
  const [filter, setFilter] = createSignal<FilterStatus>("pending")
  const [loading, setLoading] = createSignal(true)

  const pendingCount = createMemo(() => status()?.pending ?? 0)

  const filteredCandidates = createMemo(() => {
    return candidates().filter((c) => c.status === filter())
  })

  async function loadData() {
    setLoading(true)
    try {
      const [statusRes, candidatesRes] = await Promise.all([
        evolutionApi.status(sdk.client),
        evolutionApi.listCandidates(sdk.client, { status: filter(), limit: 20 }),
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
    const success = await evolutionApi.applyFileCandidate(sdk.client, candidateID)
    if (success) await refresh()
  }

  async function dismissCandidate(candidateID: string) {
    const confirmed = await DialogConfirm.show(dialog, "驳回进化", "确定要驳回此进化候选吗？")
    if (!confirmed) return
    const success = await evolutionApi.dismissCandidate(sdk.client, candidateID)
    if (success) await refresh()
  }

  async function switchFilter(s: FilterStatus) {
    setFilter(s)
    const data = await evolutionApi.listCandidates(sdk.client, { status: s, limit: 20 })
    setCandidates(data)
  }

  // 挂载即加载 + 定时轮询(分区折叠/切走标签页时面板卸载,轮询自动停)
  useAutoRefresh(loadData)

  return (
    <box flexDirection="column" gap={1}>
      {/* 统计 */}
      <text fg={theme.textMuted}>
        {pendingCount()} 待审 · {status()?.total ?? 0} 总计
      </text>

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
                <span style={{ fg: theme.accent }}>●</span> {candidate.title}
              </text>
              <box flexDirection="row" gap={1}>
                <text fg={theme.textMuted}>
                  {evolutionKindLabel(candidate.kind)}
                  {" · "}
                  {evolutionDomainLabel(candidate.domain)}
                  {" · "}
                  {candidate.contentFormat === "unified_diff" ? "差异" : "全文"}
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
              <Show when={candidate.validationStatus !== "pending"}>
                <text fg={candidate.validationStatus === "validated" ? theme.success : theme.error}>
                  {evolutionValidationLabel(candidate.validationStatus)}
                </text>
              </Show>
              <Show when={candidate.status === "pending"}>
                <box flexDirection="row" gap={1}>
                  <text fg={theme.success} onMouseUp={() => applyCandidate(candidate.id)}>
                    [应用写入]
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
