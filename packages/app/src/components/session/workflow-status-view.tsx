import { createEffect, createSignal, Show, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useParams } from "@solidjs/router"
import { Icon, type IconProps } from "@novaway/ui/icon"
import { Popover } from "@novaway/ui/popover"
import { useSDK } from "@/context/sdk"
import {
  patchFrom,
  mergeWorkflowState,
  readWorkflowState,
  updateWorkflowState,
  type WorkflowConflict,
  type WorkflowState,
  type WorkflowStatePatch,
} from "./workflow-status-state"

type RouteInfo = { label: string; description: string; icon: IconProps["name"] }

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

const routeInfo: Record<string, RouteInfo> = {
  l0: { label: "L0", description: "机械修改：文案、格式、样式等低风险变更", icon: "lu-zap" },
  l1: { label: "L1", description: "普通 Bug、小功能和低风险代码修改", icon: "lu-wrench" },
  l2: { label: "L2", description: "模块、接口、插件、Workflow 或集成类工作", icon: "tree-structure" },
  l3: { label: "L3", description: "架构、迁移、部署或基础设施变更", icon: "file-tree" },
  l4: { label: "L4", description: "安全审计、合规、生产事故或核心架构工作", icon: "shield" },
  "non-coding": { label: "Non-coding", description: "PRD、文档、调研、运营或数据分析任务", icon: "lu-file-text" },
}

function getRouteInfo(route: string | undefined): RouteInfo {
  return (
    routeInfo[route ?? ""] ?? {
      label: route?.toUpperCase() || "Workflow",
      description: "当前会话的 Workflow 路由",
      icon: "task",
    }
  )
}

const phaseLabels: Record<string, string> = {
  intake: "需求接收",
  "grill-me": "需求澄清",
  design: "方案设计",
  plan: "计划制定",
  implementation: "实施执行",
  review: "方案审查",
  verification: "结果验证",
  delivery: "交付发布",
  completed: "已完成",
  blocked: "已阻塞",
}

function phaseLabel(value: string | undefined): string {
  return (value && phaseLabels[value]) || displayValue(value)
}

function displayValue(value: string | undefined): string {
  return value?.replaceAll("_", " ") || "—"
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
  const [popoverOpen, setPopoverOpen] = createSignal(false)
  let closeTimer: ReturnType<typeof setTimeout> | undefined
  let requestVersion = 0

  const openPopover = () => {
    if (closeTimer) clearTimeout(closeTimer)
    setPopoverOpen(true)
  }

  const schedulePopoverClose = () => {
    if (editing()) return
    if (closeTimer) clearTimeout(closeTimer)
    closeTimer = setTimeout(() => setPopoverOpen(false), 180)
  }

  const applyState = (next: WorkflowState | undefined) => {
    setState("value", next)
    if (next)
      setDraft({
        route: next.route,
        phase: next.phase,
        verificationStatus: next.verificationStatus,
        deliveryStatus: next.deliveryStatus,
      })
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
    if (closeTimer) clearTimeout(closeTimer)
    clearInterval(timer)
  })
  return (
    <Show when={state.value}>
      {(item) => {
        const route = () => getRouteInfo(item().route)
        return (
          <div class="hidden lg:flex items-center gap-1.5" data-component="workflow-status">
            <Popover
              open={popoverOpen()}
              onOpenChange={(open) => {
                setPopoverOpen(open)
                if (!open) setEditing(false)
              }}
              placement="bottom-end"
              gutter={6}
              class="w-[320px] rounded-[12px] border border-border bg-popover p-0 shadow-[var(--shadow-md)]"
              trigger={
                <button
                  type="button"
                  class="group flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-ui-xs text-foreground-subtle transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-interactive-base"
                  aria-label={`当前 Workflow 层级：${route().label}，${route().description}`}
                  aria-haspopup="dialog"
                  onPointerEnter={openPopover}
                  onPointerLeave={schedulePopoverClose}
                  onFocus={openPopover}
                >
                  <Icon name={route().icon} size="small" class="shrink-0 text-interactive-base" />
                  <span class="font-medium text-foreground">{route().label}</span>
                  <span class="hidden xl:inline max-w-[110px] truncate">{phaseLabel(item().phase)}</span>
                  <Icon
                    name="chevron-down"
                    size="small"
                    class="shrink-0 text-foreground-subtlest transition-transform group-data-[expanded=true]:rotate-180"
                  />
                </button>
              }
            >
              <div onPointerEnter={openPopover} onPointerLeave={schedulePopoverClose}>
                <div class="flex items-start gap-2 border-b border-border px-3 py-2.5">
                  <div class="mt-0.5 rounded-md bg-interactive-base/10 p-1.5 text-interactive-base">
                    <Icon name={route().icon} size="normal" />
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1.5">
                      <span class="text-13-medium text-foreground">{route().label}</span>
                      <span class="text-11-regular text-foreground-subtle">Workflow 层级</span>
                    </div>
                    <p class="mt-0.5 text-11-regular leading-4 text-foreground-subtle">{route().description}</p>
                  </div>
                </div>

                <div class="grid grid-cols-2 gap-x-3 gap-y-2 px-3 py-2.5 text-11-regular">
                  <WorkflowDetail label="阶段" value={phaseLabel(item().phase)} />
                  <WorkflowDetail
                    label="提问额度"
                    value={`${item().questionCalls ?? 0} / ${item().questionBudget ?? 0}`}
                  />
                  <WorkflowDetail
                    label="验证"
                    value={displayValue(item().verificationStatus)}
                    status={item().verificationStatus}
                  />
                  <WorkflowDetail
                    label="交付"
                    value={displayValue(item().deliveryStatus)}
                    status={item().deliveryStatus}
                  />
                  <WorkflowDetail label="版本" value={`r${item().revision ?? 0}`} />
                  <WorkflowDetail label="路由锁定" value={item().routeLocked ? "已锁定" : "未锁定"} />
                </div>

                <Show when={!editing()}>
                  <div class="border-t border-border px-3 py-2">
                    <button
                      type="button"
                      class="flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-12-medium text-foreground transition-colors hover:bg-hover"
                      onClick={() => {
                        openPopover()
                        setEditing(true)
                      }}
                    >
                      <Icon name="edit" size="small" />
                      编辑 Workflow
                    </button>
                  </div>
                </Show>

                <Show when={editing() && !conflict()}>
                  <div class="border-t border-border px-3 py-2.5">
                    <div class="grid gap-2">
                      <label class="grid gap-1 text-11-medium text-foreground-subtle">
                        Workflow 阶段
                        <select
                          class="h-7 rounded-md border border-border bg-background px-2 text-12-regular text-foreground outline-none focus:border-interactive-base"
                          aria-label="Workflow 阶段"
                          value={draft.phase ?? ""}
                          onChange={(event) => setDraft("phase", event.currentTarget.value)}
                        >
                          <ForPhase />
                        </select>
                      </label>
                      <label class="grid gap-1 text-11-medium text-foreground-subtle">
                        Workflow 路由
                        <select
                          class="h-7 rounded-md border border-border bg-background px-2 text-12-regular text-foreground outline-none focus:border-interactive-base"
                          aria-label="Workflow 路由"
                          value={draft.route ?? ""}
                          onChange={(event) => setDraft("route", event.currentTarget.value)}
                        >
                          <option value="l0">L0 · 机械修改</option>
                          <option value="l1">L1 · 普通 Bug/小功能</option>
                          <option value="l2">L2 · 模块/接口/插件/集成</option>
                          <option value="l3">L3 · 架构/迁移/部署</option>
                          <option value="l4">L4 · 安全/合规/生产</option>
                          <option value="non-coding">Non-coding · 文档/调研</option>
                        </select>
                      </label>
                    </div>
                    <div class="mt-2 flex items-center justify-end gap-2">
                      <button
                        type="button"
                        class="rounded-md px-2 py-1 text-11-medium text-foreground-subtle hover:bg-hover"
                        onClick={() => setEditing(false)}
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        class="rounded-md bg-interactive-base px-2.5 py-1 text-11-medium text-background hover:opacity-90 disabled:opacity-50"
                        disabled={saving()}
                        onClick={() => void save()}
                      >
                        {saving() ? "保存中…" : "保存"}
                      </button>
                    </div>
                  </div>
                </Show>
              </div>
            </Popover>
            <Show when={conflict()}>
              {(item) => (
                <WorkflowConflictPanel
                  localRevision={item().base.revision ?? 0}
                  remoteRevision={item().remote.revision ?? 0}
                  onReload={() => void reloadConflict()}
                  onRetry={() => void retryConflict()}
                />
              )}
            </Show>
            <Show when={error()}>
              <span class="text-critical-base text-ui-xs">{error()}</span>
            </Show>
          </div>
        )
      }}
    </Show>
  )
}

function WorkflowDetail(props: { label: string; value: string; status?: string }) {
  return (
    <div class="min-w-0">
      <div class="text-foreground-subtlest">{props.label}</div>
      <div
        classList={{
          "truncate capitalize text-foreground": true,
          "text-success": props.status === "passed" || props.status === "completed",
          "text-warning": props.status === "pending" || props.status === "unverified" || props.status === "in_progress",
          "text-critical-base": props.status === "failed" || props.status === "blocked",
        }}
      >
        {props.value}
      </div>
    </div>
  )
}

function ForPhase() {
  return (
    <>
      {phaseOrder.map((phase) => (
        <option value={phase}>{phaseLabel(phase)}</option>
      ))}
    </>
  )
}

export function WorkflowConflictPanel(props: {
  localRevision: number
  remoteRevision: number
  onReload: () => void
  onRetry: () => void
}) {
  return (
    <div
      class="flex items-center gap-2 rounded-md border border-warning px-2 py-1 text-ui-xs text-foreground-subtle"
      data-component="workflow-conflict-panel"
    >
      <span>Workflow 状态已被其他端更新</span>
      <span>
        {props.localRevision} → {props.remoteRevision}
      </span>
      <button type="button" class="text-foreground hover:underline" onClick={props.onReload}>
        加载最新状态
      </button>
      <button type="button" class="text-foreground hover:underline" onClick={props.onRetry}>
        合并后重试
      </button>
    </div>
  )
}
