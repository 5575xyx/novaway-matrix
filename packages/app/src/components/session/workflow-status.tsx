import { createEffect, createSignal, Show, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useParams } from "@solidjs/router"
import { useSDK } from "@/context/sdk"

export type WorkflowState = {
  route?: string
  phase?: string
  questionCalls?: number
  questionBudget?: number
  verificationStatus?: string
  deliveryStatus?: string
  revision?: number
}

export type WorkflowStatePatch = Pick<WorkflowState, "route" | "phase" | "verificationStatus" | "deliveryStatus">
type WorkflowSDK = ReturnType<typeof useSDK>
type WorkflowConflict = { base: WorkflowState; local: WorkflowState; remote: WorkflowState }

const phaseOrder = ["intake", "grill-me", "design", "plan", "implementation", "review", "verification", "delivery", "completed", "blocked"]

export async function readWorkflowState(sdk: WorkflowSDK, id: string): Promise<WorkflowState | undefined> {
  try {
    const response = await sdk.request(`${sdk.url}/session/${encodeURIComponent(id)}/workflow-state`)
    if (!response.ok) return undefined
    const body = await response.text()
    if (!body.trim()) return undefined
    return JSON.parse(body) as WorkflowState
  } catch {
    // The endpoint is optional for older servers and may return an empty body
    // while a session is being created. Status UI should stay silent in either case.
    return undefined
  }
}

export function mergeWorkflowState(base: WorkflowState, local: WorkflowState, remote: WorkflowState): WorkflowState {
  const choose = <K extends keyof WorkflowState>(key: K) =>
    local[key] !== base[key] && remote[key] === base[key] ? local[key] : remote[key]
  const localPhase = phaseOrder.indexOf(local.phase ?? "")
  const remotePhase = phaseOrder.indexOf(remote.phase ?? "")
  return {
    ...remote,
    route: choose("route"),
    // A phase can only move forward. This prevents a stale browser from
    // taking a workflow back to an earlier phase after a conflict.
    phase: localPhase > remotePhase ? local.phase : remote.phase,
    verificationStatus: choose("verificationStatus"),
    deliveryStatus: choose("deliveryStatus"),
  }
}

export function patchFrom(remote: WorkflowState, merged: WorkflowState): WorkflowStatePatch {
  const patch: WorkflowStatePatch = {}
  for (const key of ["route", "phase", "verificationStatus", "deliveryStatus"] as const) {
    if (merged[key] !== undefined && merged[key] !== remote[key]) patch[key] = merged[key]
  }
  return patch
}

async function updateWorkflowState(
  sdk: WorkflowSDK,
  id: string,
  base: WorkflowState,
  patch: WorkflowStatePatch,
): Promise<{ state?: WorkflowState; conflict?: WorkflowConflict; error?: string }> {
  const expectedRevision = base.revision ?? 0
  try {
    const response = await sdk.request(`${sdk.url}/session/${encodeURIComponent(id)}/workflow-state`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision, patch }),
    })
    if (response.status === 409) {
      const remote = await readWorkflowState(sdk, id)
      if (!remote) return { error: "无法加载冲突后的最新 Workflow 状态" }
      const conflictBase = base
      const local = { ...conflictBase, ...patch }
      return { conflict: { base: conflictBase, local, remote } }
    }
    if (!response.ok) return { error: `Workflow 状态更新失败（${response.status}）` }
    return { state: (await response.json()) as WorkflowState }
  } catch {
    return { error: "无法连接 Workflow 服务" }
  }
}

export function WorkflowStatus() {
  const sdk = useSDK()
  const params = useParams()
  const [state, setState] = createStore<{ value?: WorkflowState }>({})
  const [editing, setEditing] = createSignal(false)
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const [draft, setDraft] = createStore<WorkflowStatePatch>({})
  const [conflict, setConflict] = createSignal<WorkflowConflict>()
  let requestVersion = 0

  const applyState = (next: WorkflowState | undefined) => {
    setState("value", next)
    if (next) setDraft({ route: next.route, phase: next.phase, verificationStatus: next.verificationStatus, deliveryStatus: next.deliveryStatus })
  }

  const refresh = async (id: string) => {
    const version = ++requestVersion
    const next = await readWorkflowState(sdk, id)
    if (version !== requestVersion) return
    applyState(next)
  }

  const save = async () => {
    const id = params.id
    const current = state.value
    if (!id || !current || saving()) return
    setSaving(true)
    setError(undefined)
    const result = await updateWorkflowState(sdk, id, current, draft)
    setSaving(false)
    if (result.state) {
      setEditing(false)
      setConflict(undefined)
      applyState(result.state)
      return
    }
    if (result.conflict) {
      const merged = mergeWorkflowState(result.conflict.base, result.conflict.local, result.conflict.remote)
      setConflict({ ...result.conflict, local: merged })
      setDraft(patchFrom(result.conflict.remote, merged))
      return
    }
    setError(result.error)
  }

  const reloadConflict = async () => {
    const id = params.id
    if (!id) return
    setSaving(true)
    const latest = await readWorkflowState(sdk, id)
    setSaving(false)
    if (latest) {
      setConflict(undefined)
      applyState(latest)
      setError(undefined)
    } else setError("无法加载最新 Workflow 状态")
  }

  const retryConflict = async () => {
    const item = conflict()
    const id = params.id
    if (!item || !id || saving()) return
    setSaving(true)
    setError(undefined)
    const remote = item.remote as WorkflowState
    const local = item.local as WorkflowState
    const result = await updateWorkflowState(sdk, id, remote, patchFrom(remote, local))
    setSaving(false)
    if (result.state) {
      setConflict(undefined)
      setEditing(false)
      applyState(result.state)
    } else if (result.conflict) {
      const merged = mergeWorkflowState(result.conflict.base, result.conflict.local, result.conflict.remote)
      setConflict({ ...result.conflict, local: merged })
      setDraft(patchFrom(result.conflict.remote, merged))
    } else setError(result.error)
  }

  createEffect(() => {
    const id = params.id
    requestVersion += 1
    applyState(undefined)
    setConflict(undefined)
    setEditing(false)
    setError(undefined)
    if (id) void refresh(id)
  })

  const timer = setInterval(() => {
    const id = params.id
    if (id && !editing() && !conflict()) void refresh(id)
  }, 5000)
  onCleanup(() => {
    requestVersion += 1
    clearInterval(timer)
  })
  return (
    <Show when={state.value}>
      {(item) => (
        <div class="hidden lg:flex items-center gap-1.5" data-component="workflow-status">
          <div
            class="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-ui-xs text-foreground-subtle"
            title={`Workflow revision ${item().revision ?? 0}`}
          >
            <span class="text-foreground font-medium">{item().route?.toUpperCase()}</span>
            <span>·</span>
            <span>{item().phase}</span>
            <span>·</span>
            <span>Q {item().questionCalls ?? 0}/{item().questionBudget ?? 0}</span>
            <span classList={{ "text-success": item().verificationStatus === "passed", "text-warning": item().verificationStatus === "unverified" }}>
              {item().verificationStatus}
            </span>
            <button type="button" class="text-foreground hover:underline" onClick={() => setEditing(!editing())} aria-label="编辑 Workflow 状态">
              {editing() ? "取消" : "编辑"}
            </button>
          </div>
          <Show when={editing() && !conflict()}>
            <div class="flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-ui-xs">
              <select aria-label="Workflow 阶段" value={draft.phase ?? ""} onChange={(event) => setDraft("phase", event.currentTarget.value)}>
                <ForPhase />
              </select>
              <select aria-label="Workflow 路由" value={draft.route ?? ""} onChange={(event) => setDraft("route", event.currentTarget.value)}>
                <option value="l0">L0</option><option value="l1">L1</option><option value="l2">L2</option><option value="l3">L3</option><option value="l4">L4</option><option value="non-coding">Non-coding</option>
              </select>
              <button type="button" class="text-foreground hover:underline" disabled={saving()} onClick={() => void save()}>{saving() ? "保存中…" : "保存"}</button>
            </div>
          </Show>
          <Show when={conflict()}>
            {(item) => <WorkflowConflictPanel localRevision={item().base.revision ?? 0} remoteRevision={item().remote.revision ?? 0} onReload={() => void reloadConflict()} onRetry={() => void retryConflict()} />}
          </Show>
          <Show when={error()}><span class="text-critical-base text-ui-xs">{error()}</span></Show>
        </div>
      )}
    </Show>
  )
}

function ForPhase() {
  return <>{phaseOrder.map((phase) => <option value={phase}>{phase}</option>)}</>
}

export function WorkflowConflictPanel(props: {
  localRevision: number
  remoteRevision: number
  onReload: () => void
  onRetry: () => void
}) {
  return (
    <div class="flex items-center gap-2 rounded-md border border-warning px-2 py-1 text-ui-xs text-foreground-subtle" data-component="workflow-conflict-panel">
      <span>Workflow 状态已被其他端更新</span>
      <span>{props.localRevision} → {props.remoteRevision}</span>
      <button type="button" class="text-foreground hover:underline" onClick={props.onReload}>加载最新状态</button>
      <button type="button" class="text-foreground hover:underline" onClick={props.onRetry}>合并后重试</button>
    </div>
  )
}
