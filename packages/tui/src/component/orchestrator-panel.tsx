import { createSignal, onMount, onCleanup, For, Show } from "solid-js"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { DialogConfirm } from "../ui/dialog-confirm"
import { orchestratorApi, type OrchestratorPlanItem } from "../util/mimo-panel-api"
import { useAutoRefresh } from "../util/auto-refresh"

export interface OrchestratorPanelProps {
  sessionID: string
}

export function OrchestratorPanel(props: OrchestratorPanelProps) {
  const sdk = useSDK()
  const { theme } = useTheme()
  const dialog = useDialog()

  const [plans, setPlans] = createSignal<OrchestratorPlanItem[]>([])
  const [loading, setLoading] = createSignal(true)
  let timer: ReturnType<typeof setInterval> | undefined

  async function loadData() {
    setLoading(true)
    try {
      const list = await orchestratorApi.list(sdk.client, props.sessionID)
      setPlans(list)
    } finally {
      setLoading(false)
    }
  }

  async function refresh() {
    const list = await orchestratorApi.list(sdk.client, props.sessionID)
    setPlans(list)
  }

  async function executePlan(planId: string) {
    const ok = await orchestratorApi.execute(sdk.client, planId)
    if (ok) await refresh()
  }

  async function deletePlan(planId: string) {
    const confirmed = await DialogConfirm.show(dialog, "删除编排计划", "确定要删除此编排计划吗？")
    if (!confirmed) return
    const ok = await orchestratorApi.remove(sdk.client, planId)
    if (ok) await refresh()
  }

  function statusLabel(status: string): string {
    const labels: Record<string, string> = {
      draft: "草稿",
      running: "运行中",
      completed: "已完成",
      failed: "失败",
      pending: "待运行",
    }
    return labels[status] ?? status
  }

  function statusColor(status: string) {
    const colors: Record<string, typeof theme.text> = {
      draft: theme.textMuted,
      running: theme.primary,
      completed: theme.success,
      failed: theme.error,
      pending: theme.textMuted,
    }
    return colors[status] ?? theme.text
  }

  // 挂载即加载 + 定时轮询(分区折叠/切走标签页时面板卸载,轮询自动停)。
  // 运行中的计划在后台推进,这里另加一个更快的轮询盯着任务状态。
  useAutoRefresh(loadData)
  onMount(() => {
    timer = setInterval(() => {
      if (plans().some((p) => p.status === "running")) void refresh()
    }, 2000)
  })
  onCleanup(() => timer && clearInterval(timer))

  return (
    <box flexDirection="column" gap={1}>
      <text fg={theme.textMuted} wrapMode="word">
        通过 orchestrator 工具或让代理创建含依赖的任务计划,此处可执行与监控。
      </text>

      <Show
        when={plans().length > 0}
        fallback={<text fg={theme.textMuted}>{loading() ? "加载中..." : "暂无编排计划"}</text>}
      >
        <For each={plans()}>
          {(plan) => {
            const done = () => plan.tasks.filter((t) => t.status === "completed").length
            return (
              <box flexDirection="column" gap={0} paddingBottom={1}>
                <text fg={theme.text} wrapMode="none">
                  <span style={{ fg: theme.accent }}>●</span> {plan.name}
                </text>
                <box flexDirection="row" gap={1}>
                  <text fg={statusColor(plan.status)}>{statusLabel(plan.status)}</text>
                  <text fg={theme.textMuted}>
                    · 进度 {done()}/{plan.tasks.length}
                  </text>
                </box>
                {/* 任务列表 */}
                <box flexDirection="column" gap={0} paddingLeft={1}>
                  <For each={plan.tasks}>
                    {(task) => (
                      <text fg={statusColor(task.status)} wrapMode="none">
                        {task.status === "completed" ? "✓" : task.status === "failed" ? "✗" : task.status === "running" ? "▸" : "○"}{" "}
                        {task.name}
                        <Show when={task.dependencies.length > 0}>
                          <span style={{ fg: theme.textMuted }}> ←({task.dependencies.join(",")})</span>
                        </Show>
                        <Show when={task.error}>
                          <span style={{ fg: theme.error }}> — {task.error}</span>
                        </Show>
                      </text>
                    )}
                  </For>
                </box>
                <Show when={plan.error}>
                  <text fg={theme.error} wrapMode="none">
                    错误: {plan.error}
                  </text>
                </Show>
                {/* 操作按钮 */}
                <box flexDirection="row" gap={1}>
                  <Show when={plan.status !== "running"}>
                    <text fg={theme.success} onMouseUp={() => executePlan(plan.id)}>
                      [执行]
                    </text>
                  </Show>
                  <text fg={theme.error} onMouseUp={() => deletePlan(plan.id)}>
                    [删除]
                  </text>
                </box>
              </box>
            )
          }}
        </For>
      </Show>
    </box>
  )
}
