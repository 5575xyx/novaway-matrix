import { createSignal, createMemo, onMount, For, Show } from "solid-js"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"

interface Workflow {
  id: string
  name: string
  description: string | null
  status: "draft" | "running" | "paused" | "completed" | "failed"
  steps: Array<{ id: string; name: string; type: string }>
  createdAt: Date
}

export interface WorkflowPanelProps {
  sessionID: string
}

export function WorkflowPanel(props: WorkflowPanelProps) {
  const sdk = useSDK()
  const { theme } = useTheme()

  const [workflows, setWorkflows] = createSignal<Workflow[]>([])
  const [loading, setLoading] = createSignal(true)

  async function loadData() {
    setLoading(true)
    try {
      const result = await (sdk.client as any).get(`/session/${props.sessionID}/workflows`)
      setWorkflows(result.data ?? [])
    } catch {
      // 静默失败
    } finally {
      setLoading(false)
    }
  }

  async function refresh() {
    await loadData()
  }

  async function createWorkflow() {
    try {
      await (sdk.client as any).post(`/session/${props.sessionID}/workflows`, {
        name: "新工作流",
        steps: [],
      })
      await refresh()
    } catch {
      // 静默失败
    }
  }

  async function startWorkflow(workflowId: string) {
    try {
      await (sdk.client as any).post(`/workflows/${workflowId}/start`)
      await refresh()
    } catch {
      // 静默失败
    }
  }

  async function pauseWorkflow(workflowId: string) {
    try {
      await (sdk.client as any).post(`/workflows/${workflowId}/pause`)
      await refresh()
    } catch {
      // 静默失败
    }
  }

  async function resumeWorkflow(workflowId: string) {
    try {
      await (sdk.client as any).post(`/workflows/${workflowId}/resume`)
      await refresh()
    } catch {
      // 静默失败
    }
  }

  function statusLabel(status: string): string {
    const labels: Record<string, string> = {
      draft: "草稿",
      running: "运行中",
      paused: "已暂停",
      completed: "已完成",
      failed: "失败",
    }
    return labels[status] ?? status
  }

  function statusColor(status: string) {
    const colors: Record<string, typeof theme.text> = {
      draft: theme.textMuted,
      running: theme.primary,
      paused: theme.warning,
      completed: theme.success,
      failed: theme.error,
    }
    return colors[status] ?? theme.text
  }

  onMount(loadData)

  return (
    <box flexDirection="column" gap={1}>
      {/* 标题 */}
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text}>
          <b>🔄 工作流</b>
        </text>
        <text fg={theme.textMuted} onMouseUp={refresh}>
          {loading() ? "..." : "刷新"}
        </text>
      </box>

      {/* 创建按钮 */}
      <text fg={theme.primary} onMouseUp={createWorkflow}>
        [创建工作流]
      </text>

      {/* 列表 */}
      <Show
        when={workflows().length > 0}
        fallback={<text fg={theme.textMuted}>{loading() ? "加载中..." : "暂无工作流"}</text>}
      >
        <For each={workflows()}>
          {(workflow) => (
            <box flexDirection="column" gap={0} paddingBottom={1}>
              <text fg={theme.text} wrapMode="none">
                <span style={{ fg: theme.accent }}>●</span> {workflow.name}
              </text>
              <box flexDirection="row" gap={1}>
                <text fg={statusColor(workflow.status)}>
                  {statusLabel(workflow.status)}
                </text>
                <text fg={theme.textMuted}>
                  · {workflow.steps.length} 步骤
                </text>
              </box>
              <Show when={workflow.description}>
                <text fg={theme.textMuted}>{workflow.description}</text>
              </Show>
              {/* 操作按钮 */}
              <box flexDirection="row" gap={1}>
                <Show when={workflow.status === "draft"}>
                  <text fg={theme.success} onMouseUp={() => startWorkflow(workflow.id)}>
                    [启动]
                  </text>
                </Show>
                <Show when={workflow.status === "running"}>
                  <text fg={theme.warning} onMouseUp={() => pauseWorkflow(workflow.id)}>
                    [暂停]
                  </text>
                </Show>
                <Show when={workflow.status === "paused"}>
                  <text fg={theme.success} onMouseUp={() => resumeWorkflow(workflow.id)}>
                    [恢复]
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
