import { useSDK } from "@/context/sdk"

export type WorkflowState = {
  route?: string
  phase?: string
  routeLocked?: boolean
  questionCalls?: number
  questionBudget?: number
  verificationStatus?: string
  deliveryStatus?: string
  revision?: number
}

export type WorkflowStatePatch = Pick<WorkflowState, "route" | "phase" | "verificationStatus" | "deliveryStatus">
export type WorkflowSDK = ReturnType<typeof useSDK>
export type WorkflowConflict = { base: WorkflowState; local: WorkflowState; remote: WorkflowState }

const phaseOrder = [
  "intake",
  "grill-me",
  "design",
  "plan",
  "implementation",
  "review",
  "verification",
  "delivery",
  "completed",
  "blocked",
]

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

export async function updateWorkflowState(
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
