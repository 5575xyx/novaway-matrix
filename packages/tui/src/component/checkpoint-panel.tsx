import { createSignal, onMount, For, Show } from "solid-js"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { DialogConfirm } from "../ui/dialog-confirm"
import { checkpointApi, type CheckpointItem } from "../util/mimo-panel-api"
import { icon } from "../util/panel-icons"

export interface CheckpointPanelProps {
  sessionID: string
}

export function CheckpointPanel(props: CheckpointPanelProps) {
  const sdk = useSDK()
  const { theme } = useTheme()
  const dialog = useDialog()

  const [checkpoints, setCheckpoints] = createSignal<CheckpointItem[]>([])
  const [loading, setLoading] = createSignal(true)

  async function loadData() {
    setLoading(true)
    try {
      setCheckpoints(await checkpointApi.list(sdk.client, props.sessionID))
    } finally {
      setLoading(false)
    }
  }

  async function refresh() {
    await loadData()
  }

  async function createCheckpoint() {
    const ok = await checkpointApi.create(
      sdk.client,
      props.sessionID,
      `手动检查点 ${new Date().toLocaleTimeString()}`,
      "手动创建",
    )
    if (ok) await refresh()
  }

  async function restoreCheckpoint(checkpointId: string) {
    const confirmed = await DialogConfirm.show(dialog, "恢复检查点", "确定要恢复到此检查点吗？当前会话状态将被覆盖。")
    if (!confirmed) return
    const ok = await checkpointApi.restore(sdk.client, checkpointId)
    if (ok) await refresh()
  }

  async function deleteCheckpoint(checkpointId: string) {
    const confirmed = await DialogConfirm.show(dialog, "删除检查点", "确定要删除此检查点吗？")
    if (!confirmed) return
    const ok = await checkpointApi.remove(sdk.client, checkpointId)
    if (ok) await refresh()
  }

  onMount(loadData)

  return (
    <box flexDirection="column" gap={1}>
      {/* 标题 */}
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text}>
          <b>{icon("checkpoint")} 检查点</b>
        </text>
        <text fg={theme.textMuted} onMouseUp={refresh}>
          {loading() ? "..." : "刷新"}
        </text>
      </box>

      {/* 创建按钮 */}
      <text fg={theme.primary} onMouseUp={createCheckpoint}>
        [创建检查点]
      </text>

      {/* 列表 */}
      <Show
        when={checkpoints().length > 0}
        fallback={<text fg={theme.textMuted}>{loading() ? "加载中..." : "暂无检查点"}</text>}
      >
        <For each={checkpoints()}>
          {(cp) => (
            <box flexDirection="column" gap={0} paddingBottom={1}>
              <text fg={theme.text} wrapMode="none">
                <span style={{ fg: theme.accent }}>●</span> {cp.name}
              </text>
              <Show when={cp.reason}>
                <text fg={theme.textMuted}>原因: {cp.reason}</text>
              </Show>
              <text fg={theme.textMuted}>
                {new Date(cp.createdAt).toLocaleString()}
              </text>
              <Show when={cp.tags.length > 0}>
                <box flexDirection="row" gap={1} flexWrap="wrap">
                  <For each={cp.tags.slice(0, 3)}>
                    {(tag) => (
                      <text fg={theme.textMuted}>[{tag}]</text>
                    )}
                  </For>
                </box>
              </Show>
              <box flexDirection="row" gap={1}>
                <text fg={theme.success} onMouseUp={() => restoreCheckpoint(cp.id)}>
                  [恢复]
                </text>
                <text fg={theme.error} onMouseUp={() => deleteCheckpoint(cp.id)}>
                  [删除]
                </text>
              </box>
            </box>
          )}
        </For>
      </Show>
    </box>
  )
}
