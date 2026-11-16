import { TextAttributes } from "@opentui/core"
import { For, onCleanup, onMount, Show, createSignal } from "solid-js"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"

type MarketplaceOperation = {
  operationId: string
  operationType: string
  packageId: string
  phase: string
  installationStatus: string
  activationStatus: string
  consumerStatus: string
  cleanupStatus: string
  disposeStatus: string
  requiresRestart: boolean
  progress: number
  errorCode?: string
  recoveryHint?: string
}

const terminal = (operation: MarketplaceOperation) => operation.phase === "completed" || operation.phase === "failed"

export function DialogMarketplace() {
  const sdk = useSDK()
  const { theme } = useTheme()
  const dialog = useDialog()
  const [operations, setOperations] = createSignal<MarketplaceOperation[]>([])
  const [error, setError] = createSignal<string>()

  const load = async () => {
    try {
      const result = await sdk.client.extension.marketplaceOperations({ directory: sdk.directory })
      setOperations((result.data as MarketplaceOperation[] | undefined) ?? [])
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  onMount(() => {
    void load()
    const timer = setInterval(() => {
      if (operations().some((operation) => !terminal(operation))) void load()
    }, 800)
    onCleanup(() => clearInterval(timer))
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          插件市场操作
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <Show when={error()}>
        {(message) => <text fg={theme.error}>读取操作历史失败：{message()}</text>}
      </Show>
      <Show when={operations().length > 0} fallback={<text fg={theme.textMuted}>没有插件市场操作记录</text>}>
        <For each={operations().slice(-12).reverse()}>
          {(operation) => (
            <box gap={0}>
              <box flexDirection="row" gap={1}>
                <text fg={operation.phase === "failed" ? theme.error : operation.phase === "completed" ? theme.success : theme.warning}>
                  {operation.phase === "failed" ? "✗" : operation.phase === "completed" ? "✓" : "●"}
                </text>
                <text fg={theme.text}>
                  <b>{operation.operationType}</b> {operation.packageId}
                </text>
                <text fg={theme.textMuted}>{operation.phase} {operation.progress}%</text>
              </box>
              <text fg={theme.textMuted} wrapMode="word">
                install={operation.installationStatus} · activation={operation.activationStatus} · consumer={operation.consumerStatus} · cleanup={operation.cleanupStatus} · dispose={operation.disposeStatus}
                {operation.requiresRestart ? " · restart required" : ""}
              </text>
              <Show when={operation.errorCode || operation.recoveryHint}>
                <text fg={theme.error} wrapMode="word">
                  {operation.errorCode ?? "failed"}{operation.recoveryHint ? ` · ${operation.recoveryHint}` : ""}
                </text>
              </Show>
            </box>
          )}
        </For>
      </Show>
    </box>
  )
}
