import { createSignal, For, Show } from "solid-js"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { DialogConfirm } from "../ui/dialog-confirm"
import {
  workflowApi,
  type WorkflowItem,
  type WorkflowRunItem,
  type WorkflowTemplateItem,
} from "../util/mimo-panel-api"
import { useAutoRefresh } from "../util/auto-refresh"

export interface WorkflowPanelProps {
  sessionID: string
}

export function WorkflowPanel(props: WorkflowPanelProps) {
  const sdk = useSDK()
  const { theme } = useTheme()
  const dialog = useDialog()

  const [workflows, setWorkflows] = createSignal<WorkflowItem[]>([])
  const [templates, setTemplates] = createSignal<WorkflowTemplateItem[]>([])
  // 每个工作流最近一次运行,用于展示步骤进度
  const [latestRuns, setLatestRuns] = createSignal<Record<string, WorkflowRunItem | undefined>>({})
  const [loading, setLoading] = createSignal(true)
  const [showTemplates, setShowTemplates] = createSignal(false)

  async function loadData() {
    setLoading(true)
    try {
      const [list, tpls] = await Promise.all([
        workflowApi.list(sdk.client, props.sessionID),
        workflowApi.listTemplates(sdk.client),
      ])
      setWorkflows(list)
      setTemplates(tpls)
      // 拉取每个工作流的最近运行(并行)
      const runsEntries = await Promise.all(
        list.map(async (w) => {
          const runs = await workflowApi.listRuns(sdk.client, w.id)
          return [w.id, runs[runs.length - 1]] as const
        }),
      )
      setLatestRuns(Object.fromEntries(runsEntries))
    } finally {
      setLoading(false)
    }
  }

  async function refresh() {
    await loadData()
  }

  async function createWorkflow() {
    const ok = await workflowApi.create(sdk.client, props.sessionID, "新工作流")
    if (ok) await refresh()
  }

  async function createFromTemplate(templateId: string) {
    const ok = await workflowApi.createFromTemplate(sdk.client, props.sessionID, templateId)
    if (ok) {
      setShowTemplates(false)
      await refresh()
    }
  }

  async function startWorkflow(workflowId: string) {
    const ok = await workflowApi.start(sdk.client, workflowId)
    if (ok) await refresh()
  }

  async function deleteWorkflow(workflowId: string) {
    const confirmed = await DialogConfirm.show(dialog, "删除工作流", "确定要删除此工作流吗？")
    if (!confirmed) return
    const ok = await workflowApi.remove(sdk.client, workflowId)
    if (ok) await refresh()
  }

  function statusLabel(status: string): string {
    const labels: Record<string, string> = {
      draft: "草稿",
      running: "运行中",
      paused: "已暂停",
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
      paused: theme.warning,
      completed: theme.success,
      failed: theme.error,
      pending: theme.textMuted,
    }
    return colors[status] ?? theme.text
  }

  // 挂载即加载 + 定时轮询(分区折叠/切走标签页时面板卸载,轮询自动停)
  useAutoRefresh(loadData)

  return (
    <box flexDirection="column" gap={1}>
      {/* 创建入口 */}
      <box flexDirection="row" gap={2}>
        <text fg={theme.primary} onMouseUp={createWorkflow}>
          [创建空白]
        </text>
        <text fg={theme.accent} onMouseUp={() => setShowTemplates((v) => !v)}>
          {showTemplates() ? "[收起模板]" : "[从模板创建]"}
        </text>
      </box>

      {/* 模板列表 */}
      <Show when={showTemplates()}>
        <box flexDirection="column" gap={0} paddingLeft={1}>
          <For each={templates()} fallback={<text fg={theme.textMuted}>暂无模板</text>}>
            {(tpl) => (
              <box flexDirection="column" gap={0} paddingBottom={1}>
                <text fg={theme.primary} onMouseUp={() => createFromTemplate(tpl.id)} wrapMode="none">
                  ＋ {tpl.name} <span style={{ fg: theme.textMuted }}>({tpl.steps} 步)</span>
                </text>
                <text fg={theme.textMuted}>{tpl.description}</text>
              </box>
            )}
          </For>
        </box>
      </Show>

      {/* 列表 */}
      <Show
        when={workflows().length > 0}
        fallback={<text fg={theme.textMuted}>{loading() ? "加载中..." : "暂无工作流"}</text>}
      >
        <For each={workflows()}>
          {(workflow) => {
            const run = () => latestRuns()[workflow.id]
            const done = () => run()?.state?.completedSteps.length ?? 0
            return (
              <box flexDirection="column" gap={0} paddingBottom={1}>
                <text fg={theme.text} wrapMode="none">
                  <span style={{ fg: theme.accent }}>●</span> {workflow.name}
                </text>
                <box flexDirection="row" gap={1}>
                  <text fg={statusColor(run()?.status ?? workflow.status)}>
                    {statusLabel(run()?.status ?? workflow.status)}
                  </text>
                  <text fg={theme.textMuted}>· {workflow.steps.length} 步骤</text>
                  <Show when={run()}>
                    <text fg={theme.textMuted}>
                      · 进度 {done()}/{workflow.steps.length}
                    </text>
                  </Show>
                </box>
                <Show when={run()?.state?.currentStep}>
                  <text fg={theme.textMuted} wrapMode="none">
                    当前: {run()!.state!.currentStep}
                  </text>
                </Show>
                <Show when={run()?.error}>
                  <text fg={theme.error} wrapMode="none">
                    错误: {run()!.error}
                  </text>
                </Show>
                <Show when={workflow.description}>
                  <text fg={theme.textMuted}>{workflow.description}</text>
                </Show>
                {/* 操作按钮 */}
                <box flexDirection="row" gap={1}>
                  <Show when={workflow.status !== "running"}>
                    <text fg={theme.success} onMouseUp={() => startWorkflow(workflow.id)}>
                      [启动]
                    </text>
                  </Show>
                  <text fg={theme.error} onMouseUp={() => deleteWorkflow(workflow.id)}>
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
