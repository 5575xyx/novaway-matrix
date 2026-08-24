import { createSignal, createMemo, onMount, For, Show, batch } from "solid-js"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { DialogConfirm } from "../ui/dialog-confirm"

interface Goal {
  id: string
  title: string
  description: string | null
  status: "pending" | "in_progress" | "completed" | "cancelled"
  priority: "high" | "medium" | "low"
  progress: number
  tags: string[]
  createdAt: Date
}

export interface GoalPanelProps {
  sessionID: string
}

export function GoalPanel(props: GoalPanelProps) {
  const sdk = useSDK()
  const { theme } = useTheme()
  const dialog = useDialog()

  const [goals, setGoals] = createSignal<Goal[]>([])
  const [loading, setLoading] = createSignal(true)
  const [filter, setFilter] = createSignal<"all" | "pending" | "in_progress" | "completed">("all")

  const filteredGoals = createMemo(() => {
    if (filter() === "all") return goals()
    return goals().filter((g) => g.status === filter())
  })

  async function loadData() {
    setLoading(true)
    try {
      const result = await (sdk.client as any).get(`/session/${props.sessionID}/goals`)
      setGoals(result.data ?? [])
    } catch {
      // 静默失败
    } finally {
      setLoading(false)
    }
  }

  async function refresh() {
    await loadData()
  }

  async function createGoal() {
    // 这里可以打开创建对话框
    try {
      await (sdk.client as any).post(`/session/${props.sessionID}/goals`, {
        title: "新目标",
        priority: "medium",
      })
      await refresh()
    } catch {
      // 静默失败
    }
  }

  async function updateGoalStatus(goalId: string, status: Goal["status"]) {
    try {
      await (sdk.client as any).patch(`/goals/${goalId}`, { status })
      await refresh()
    } catch {
      // 静默失败
    }
  }

  function priorityLabel(priority: string): string {
    const labels: Record<string, string> = {
      high: "🔴 高",
      medium: "🟡 中",
      low: "🟢 低",
    }
    return labels[priority] ?? priority
  }

  function statusLabel(status: string): string {
    const labels: Record<string, string> = {
      pending: "待处理",
      in_progress: "进行中",
      completed: "已完成",
      cancelled: "已取消",
    }
    return labels[status] ?? status
  }

  onMount(loadData)

  return (
    <box flexDirection="column" gap={1}>
      {/* 标题 */}
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text}>
          <b>🎯 目标</b>
        </text>
        <text fg={theme.textMuted} onMouseUp={refresh}>
          {loading() ? "..." : "刷新"}
        </text>
      </box>

      {/* 创建按钮 */}
      <text fg={theme.primary} onMouseUp={createGoal}>
        [创建目标]
      </text>

      {/* 筛选 */}
      <box flexDirection="row" gap={1}>
        <For each={["all", "pending", "in_progress", "completed"] as const}>
          {(f) => (
            <text
              fg={filter() === f ? theme.primary : theme.textMuted}
              onMouseUp={() => setFilter(f)}
            >
              [{f === "all" ? "全部" : statusLabel(f)}]
            </text>
          )}
        </For>
      </box>

      {/* 列表 */}
      <Show
        when={filteredGoals().length > 0}
        fallback={<text fg={theme.textMuted}>{loading() ? "加载中..." : "暂无目标"}</text>}
      >
        <For each={filteredGoals()}>
          {(goal) => (
            <box flexDirection="column" gap={0} paddingBottom={1}>
              <text fg={theme.text} wrapMode="none">
                <span style={{ fg: theme.accent }}>●</span> {goal.title}
              </text>
              <box flexDirection="row" gap={1}>
                <text fg={theme.textMuted}>
                  {priorityLabel(goal.priority)} · {statusLabel(goal.status)}
                </text>
              </box>
              {/* 进度条 */}
              <box flexDirection="row" gap={1}>
                <text fg={theme.textMuted}>进度:</text>
                <text fg={theme.primary}>{goal.progress.toFixed(0)}%</text>
              </box>
              <Show when={goal.tags.length > 0}>
                <box flexDirection="row" gap={1} flexWrap="wrap">
                  <For each={goal.tags.slice(0, 3)}>
                    {(tag) => (
                      <text fg={theme.textMuted}>[{tag}]</text>
                    )}
                  </For>
                </box>
              </Show>
              {/* 操作按钮 */}
              <box flexDirection="row" gap={1}>
                <Show when={goal.status === "pending"}>
                  <text fg={theme.success} onMouseUp={() => updateGoalStatus(goal.id, "in_progress")}>
                    [开始]
                  </text>
                </Show>
                <Show when={goal.status === "in_progress"}>
                  <text fg={theme.success} onMouseUp={() => updateGoalStatus(goal.id, "completed")}>
                    [完成]
                  </text>
                </Show>
                <Show when={goal.status !== "cancelled" && goal.status !== "completed"}>
                  <text fg={theme.error} onMouseUp={() => updateGoalStatus(goal.id, "cancelled")}>
                    [取消]
                  </text>
                </Show>
              </box>
            </box>
          )}
        </For>
      </Show>
    </box>
  )
}
