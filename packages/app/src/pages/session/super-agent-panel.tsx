import { For, Show, createEffect, createSignal } from "solid-js"
import { Icon } from "@novaway/ui/icon"
import { showToast } from "@novaway/ui/toast"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"

type Approval = { id: string; taskID: string; reason: string; scope: string; status: string }
type Evidence = { id: string; kind: string; source: string; measured?: string; acceptanceIDs?: string[] }
type Verification = { id: string; acceptanceID: string; outcome: string; verifierID: string }
type Mutation = { taskID?: string; version?: number; toStatus?: string; status?: string }
type Run = {
  id: string
  status: string
  createdAt?: number
  goal?: { text?: string }
  graph?: { version?: number; rootTaskID?: string; nodes?: Array<{ id: string; title?: string; objective?: string }> }
}

const runTitle = (run: Run) =>
  run.graph?.nodes?.find((node) => node.id === run.graph?.rootTaskID)?.title ?? run.goal?.text ?? run.id

const statusLabel = (status: string) =>
  ({
    draft: "Draft",
    planning: "Planning",
    ready: "Ready",
    running: "Running",
    waiting_approval: "Waiting for approval",
    paused: "Paused",
    needs_review: "Needs review",
    completed: "Completed",
    failed: "Failed",
    cancelled: "Cancelled",
  })[status] ?? status

export function SuperAgentPanel() {
  const sdk = useSDK()
  const language = useLanguage()
  const [runs, setRuns] = createSignal<Run[]>([])
  const [selected, setSelected] = createSignal<Run>()
  const [approvals, setApprovals] = createSignal<Approval[]>([])
  const [evidence, setEvidence] = createSignal<Evidence[]>([])
  const [verifications, setVerifications] = createSignal<Verification[]>([])
  const [mutations, setMutations] = createSignal<Mutation[]>([])
  const [goal, setGoal] = createSignal("")
  const [criteria, setCriteria] = createSignal("")
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string>()

  const request = (path: string, init?: RequestInit) =>
    sdk.request(`${sdk.url}${path}`, {
      ...init,
      headers: { "content-type": "application/json", "x-novaway-directory": sdk.directory, ...(init?.headers ?? {}) },
    })
  const selectedStorageKey = () => `novaway.super-agent.selected:${sdk.directory}`
  const loadRuns = async () => {
    setError(undefined)
    try {
      const response = await request("/super-agent/runs")
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const listed = (await response.json()) as Run[]
      setRuns(listed.sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0)))
      const remembered = typeof localStorage === "undefined" ? undefined : localStorage.getItem(selectedStorageKey())
      const restored = remembered ? listed.find((run) => run.id === remembered) : undefined
      if (restored) {
        setSelected(restored)
        void loadDetails(restored)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : language.t("common.requestFailed"))
    }
  }
  const loadDetails = async (run: Run) => {
    try {
      const id = encodeURIComponent(run.id)
      const [approvalResponse, evidenceResponse, verificationResponse, mutationResponse] = await Promise.all([
        request(`/super-agent/runs/${id}/approvals`),
        request(`/super-agent/runs/${id}/evidence`),
        request(`/super-agent/runs/${id}/verifications`),
        request(`/super-agent/runs/${id}/task-mutations`),
      ])
      if (approvalResponse.ok) setApprovals((await approvalResponse.json()) as Approval[])
      if (evidenceResponse.ok) setEvidence((await evidenceResponse.json()) as Evidence[])
      if (verificationResponse.ok) setVerifications((await verificationResponse.json()) as Verification[])
      if (mutationResponse.ok) setMutations((await mutationResponse.json()) as Mutation[])
    } catch {
      setApprovals([])
      setEvidence([])
      setVerifications([])
      setMutations([])
    }
  }
  createEffect(() => {
    void loadRuns()
  })
  const select = (run: Run) => {
    setSelected(run)
    localStorage.setItem(selectedStorageKey(), run.id)
    void loadDetails(run)
  }

  const createRun = async () => {
    const text = goal().trim()
    if (!text || loading()) return
    setLoading(true)
    setError(undefined)
    try {
      const acceptanceCriteria = criteria()
        .split("\n")
        .map((value, index) => ({ id: `criterion-${index + 1}`, text: value.trim(), required: true }))
        .filter((item) => item.text)
      const response = await request("/super-agent/runs", {
        method: "POST",
        body: JSON.stringify({ goal: { text, acceptanceCriteria, source: "user" } }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const run = (await response.json()) as Run
      setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)])
      setSelected(run)
      localStorage.setItem(selectedStorageKey(), run.id)
      setApprovals([])
      setEvidence([])
      setVerifications([])
      setMutations([])
      setGoal("")
      setCriteria("")
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : language.t("common.requestFailed")
      setError(message)
      showToast({ title: language.t("common.requestFailed"), description: message })
    } finally {
      setLoading(false)
    }
  }
  const refreshSelected = async () => {
    const run = selected()
    if (!run) return
    const response = await request(`/super-agent/runs/${encodeURIComponent(run.id)}`)
    if (!response.ok) return
    const updated = (await response.json()) as Run
    setSelected(updated)
    setRuns((current) => current.map((item) => (item.id === updated.id ? updated : item)))
    await loadDetails(updated)
  }
  const approve = async (approval: Approval) => {
    const run = selected()
    if (!run) return
    const response = await request(`/super-agent/runs/${encodeURIComponent(run.id)}/approve`, {
      method: "POST",
      body: JSON.stringify({ requestID: approval.id, status: "approved", decidedBy: "operator" }),
    })
    if (!response.ok) {
      setError(`HTTP ${response.status}`)
      return
    }
    await refreshSelected()
  }
  const transition = async (action: "start" | "pause" | "resume" | "cancel") => {
    const run = selected()
    if (!run) return
    const response = await request(`/super-agent/runs/${encodeURIComponent(run.id)}/${action}`, {
      method: "POST",
      body: action === "pause" ? JSON.stringify({ reason: "paused from Super-Agent panel" }) : undefined,
    })
    if (!response.ok) {
      setError(`HTTP ${response.status}`)
      return
    }
    await refreshSelected()
  }

  return (
    <section data-component="super-agent-panel" class="flex h-full min-h-0 flex-col bg-background text-foreground">
      <header class="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
        <div class="flex items-center gap-2 text-ui-sm font-semibold">
          <Icon name="task" size="small" />
          Super-Agent
        </div>
        <button
          type="button"
          class="rounded px-2 py-1 text-ui-xs text-foreground-subtle hover:bg-hover"
          onClick={() => void loadRuns()}
        >
          Refresh
        </button>
      </header>
      <div class="min-h-0 flex-1 overflow-y-auto p-3">
        <Show when={error()}>
          {(message) => (
            <div class="mb-3 rounded border border-border px-2 py-1 text-ui-xs text-red-500">{message()}</div>
          )}
        </Show>
        <Show
          when={selected()}
          fallback={<RunList runs={runs()} emptyLabel={language.t("superAgent.empty")} onSelect={select} />}
        >
          {(run) => (
            <div data-component="super-agent-details" data-run-id={run().id} class="flex flex-col gap-3">
              <button
                type="button"
                class="self-start text-ui-xs text-foreground-subtle hover:text-foreground"
                onClick={() => setSelected(undefined)}
              >
                ← Runs
              </button>
              <div class="rounded-lg border border-border p-3">
                <div class="text-ui-xs text-foreground-subtle">Run details</div>
                <h2 class="mt-1 break-words text-ui-base font-semibold">{runTitle(run())}</h2>
                <div class="mt-1 text-ui-xs text-foreground-subtle">Status: {statusLabel(run().status)}</div>
                <div class="mt-2 flex items-center justify-between gap-2">
                  <span class="text-ui-xs text-foreground-subtle">State</span>
                  <span class="rounded-full bg-surface px-2 py-0.5 text-ui-xs font-medium" data-status={run().status}>
                    {statusLabel(run().status)}
                  </span>
                </div>
                <Show when={run().graph?.version !== undefined}>
                  <div class="mt-2 text-ui-xs text-foreground-subtle">graph v{run().graph?.version}</div>
                </Show>
              </div>
              <Show when={approvals().length > 0}>
                <div class="flex flex-col gap-2 rounded border border-border p-2">
                  <For each={approvals()}>
                    {(approval) => (
                      <div class="flex flex-col gap-1 text-ui-xs">
                        <div>{approval.reason}</div>
                        <Show
                          when={approval.status === "pending"}
                          fallback={
                            <div>
                              {approval.status} · {approval.scope}
                            </div>
                          }
                        >
                          <button
                            type="button"
                            class="self-start rounded bg-interactive-base px-2 py-1 text-background"
                            onClick={() => void approve(approval)}
                          >
                            Approve
                          </button>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
              <details open class="rounded-lg border border-border px-3 py-2">
                <summary class="cursor-pointer text-ui-xs font-medium">Verification details</summary>
                <div class="mt-2 flex flex-col gap-1 text-ui-xs text-foreground-subtle">
                  <div>Evidence: {evidence().length}</div>
                  <div>Verifications: {verifications().length}</div>
                  <For each={verifications()}>
                    {(verification) => (
                      <div class="text-foreground">
                        {verification.acceptanceID}: {verification.outcome}
                      </div>
                    )}
                  </For>
                  <For each={mutations()}>
                    {(mutation, index) => (
                      <div class="text-foreground">
                        #v{mutation.version ?? index() + 1} {mutation.taskID ?? "task"} →{" "}
                        {mutation.toStatus ?? mutation.status ?? "succeeded"}
                      </div>
                    )}
                  </For>
                </div>
              </details>
              <div class="flex flex-wrap gap-2">
                <Show when={run().status === "draft" || run().status === "ready"}>
                  <button
                    type="button"
                    class="rounded bg-interactive-base px-2 py-1 text-ui-xs text-background"
                    onClick={() => void transition("start")}
                  >
                    Start
                  </button>
                </Show>
                <Show when={run().status === "running"}>
                  <button
                    type="button"
                    class="rounded border border-border px-2 py-1 text-ui-xs"
                    onClick={() => void transition("pause")}
                  >
                    Pause
                  </button>
                </Show>
                <Show when={run().status === "paused"}>
                  <button
                    type="button"
                    class="rounded bg-interactive-base px-2 py-1 text-ui-xs text-background"
                    onClick={() => void transition("resume")}
                  >
                    Resume
                  </button>
                </Show>
                <Show when={!(["completed", "cancelled", "failed"] as string[]).includes(run().status)}>
                  <button
                    type="button"
                    class="rounded border border-border px-2 py-1 text-ui-xs"
                    onClick={() => void transition("cancel")}
                  >
                    Cancel
                  </button>
                </Show>
              </div>
            </div>
          )}
        </Show>
      </div>
      <Show when={!selected()}>
        <form
          class="shrink-0 border-t border-border p-3"
          onSubmit={(event) => {
            event.preventDefault()
            void createRun()
          }}
        >
          <div class="mb-1 text-ui-sm font-semibold">What should Super-Agent accomplish?</div>
          <div class="mb-3 text-ui-xs text-foreground-subtle">
            Describe the result. Add criteria only when you need a precise check.
          </div>
          <textarea
            aria-label="Super-Agent goal"
            placeholder="e.g. Prepare the release notes and verify the links"
            value={goal()}
            onInput={(event) => setGoal(event.currentTarget.value)}
            class="min-h-20 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-ui-sm text-foreground outline-none focus:border-interactive-base"
          />
          <details open class="mt-2">
            <summary class="cursor-pointer text-ui-xs text-foreground-subtle">
              Add acceptance criteria (optional)
            </summary>
            <textarea
              aria-label="Super-Agent acceptance criteria"
              placeholder="One verifiable condition per line"
              value={criteria()}
              onInput={(event) => setCriteria(event.currentTarget.value)}
              class="mt-2 min-h-14 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-ui-xs text-foreground outline-none focus:border-interactive-base"
            />
          </details>
          <button
            type="submit"
            class="mt-3 w-full rounded-lg bg-interactive-base px-3 py-2 text-ui-sm font-medium text-background disabled:opacity-50"
            disabled={!goal().trim() || loading()}
          >
            {loading() ? "Creating…" : "Create Run"}
          </button>
        </form>
      </Show>
    </section>
  )
}

function RunList(props: { runs: Run[]; emptyLabel: string; onSelect: (run: Run) => void }) {
  return (
    <div class="flex flex-col gap-2">
      <Show
        when={props.runs.length > 0}
        fallback={<div class="py-3 text-ui-xs text-foreground-subtle">{props.emptyLabel}</div>}
      >
        <For each={props.runs}>
          {(run) => (
            <button
              type="button"
              data-run-id={run.id}
              class="flex flex-col gap-1 rounded border border-border p-2 text-left hover:bg-hover"
              onClick={() => props.onSelect(run)}
            >
              <span class="truncate text-ui-xs font-medium">{runTitle(run)}</span>
              <span class="text-ui-xs text-foreground-subtle">{statusLabel(run.status)}</span>
            </button>
          )}
        </For>
      </Show>
    </div>
  )
}
