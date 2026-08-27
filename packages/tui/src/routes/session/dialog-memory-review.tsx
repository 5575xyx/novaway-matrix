import { useSDK } from "../../context/sdk"
import { useTheme } from "../../context/theme"
import { useDialog, type DialogContext } from "../../ui/dialog"
import { DialogSelect, type DialogSelectOption } from "../../ui/dialog-select"
import { DialogConfirm } from "../../ui/dialog-confirm"
import { createSignal, onMount, For } from "solid-js"
import {
  memoryApi,
  type MemoryReviewCandidate,
} from "../../util/memory-evolution-api"

type FilterStatus = "pending" | "applied" | "dismissed"

function memoryDomainLabel(domain: string): string {
  const labels: Record<string, string> = {
    general: "通用",
    coding: "编程",
    office: "办公",
    personal: "个人",
    research: "研究",
    ops: "运维",
  }
  return labels[domain] ?? domain
}

function memoryKindLabel(kind: string | undefined): string {
  if (!kind) return ""
  const labels: Record<string, string> = {
    episodic: "事件",
    semantic: "语义",
    preference: "偏好",
    goal: "目标",
    decision: "决策",
    relationship: "关系",
    lesson: "教训",
    procedure: "流程",
  }
  return labels[kind] ?? kind
}

function memoryOperationLabel(op: string): string {
  const labels: Record<string, string> = {
    add: "新增",
    update: "更新",
    archive: "归档",
    confirm: "确认",
  }
  return labels[op] ?? op
}

export interface DialogMemoryReviewProps {
  sessionID: string
}

export function DialogMemoryReview(props: DialogMemoryReviewProps) {
  const sdk = useSDK()
  const { theme } = useTheme()
  const dialog = useDialog()

  const [candidates, setCandidates] = createSignal<MemoryReviewCandidate[]>([])
  const [filter, setFilter] = createSignal<FilterStatus>("pending")
  const [scope, setScope] = createSignal<"global" | "project" | "session">("project")
  const [loading, setLoading] = createSignal(true)

  async function loadData(status?: FilterStatus) {
    setLoading(true)
    const data = await memoryApi.listReviewCandidates(sdk.client, {
      status: status ?? filter(),
      limit: 50,
    })
    setCandidates(data)
    setLoading(false)
  }

  async function applyCandidate(candidateID: string) {
    const success = await memoryApi.applyReviewCandidate(sdk.client, {
      candidateID,
      scope: scope(),
    })
    if (success) await loadData()
  }

  async function dismissCandidate(candidateID: string) {
    const confirmed = await DialogConfirm.show(dialog, "驳回记忆", "确定要驳回此记忆候选吗？")
    if (!confirmed) return
    const success = await memoryApi.dismissReviewCandidate(sdk.client, candidateID)
    if (success) await loadData()
  }

  function toOptions(list: MemoryReviewCandidate[]): DialogSelectOption<MemoryReviewCandidate>[] {
    return list.map((c) => ({
      title: c.summary ?? c.content.slice(0, 60),
      value: c,
      description: `${memoryDomainLabel(c.domain)}${c.kind ? ` · ${memoryKindLabel(c.kind)}` : ""} · ${memoryOperationLabel(c.operation)}`,
      details: [
        `原因: ${c.reason}`,
        `标签: ${c.tags.join(", ") || "无"}`,
        `置信度: ${typeof c.confidence === "number" ? c.confidence.toFixed(2) : "N/A"}`,
      ],
      category: c.status === "pending" ? "待审" : c.status === "applied" ? "已应用" : "已驳回",
      onSelect: (dlg: DialogContext) => {
        if (c.status === "pending") {
          showActions(dlg, c)
        } else {
          dlg.clear()
        }
      },
    }))
  }

  function showActions(dlg: DialogContext, candidate: MemoryReviewCandidate) {
    const actions: DialogSelectOption<string>[] = [
      {
        title: `应用 (范围: ${scope() === "global" ? "全局" : scope() === "project" ? "项目" : "会话"})`,
        value: "apply",
        description: "将此记忆写入持久存储",
        onSelect: async () => {
          await applyCandidate(candidate.id)
          dlg.clear()
        },
      },
      {
        title: "驳回",
        value: "dismiss",
        description: "丢弃此记忆候选",
        onSelect: async () => {
          await dismissCandidate(candidate.id)
          dlg.clear()
        },
      },
      {
        title: "切换范围",
        value: "scope",
        description: `当前: ${scope()}`,
        onSelect: () => {
          setScope((s) => (s === "global" ? "project" : s === "project" ? "session" : "global"))
          showActions(dlg, candidate)
        },
      },
    ]

    dlg.replace(() => (
      <DialogSelect
        title={`记忆: ${candidate.summary ?? candidate.content.slice(0, 30)}`}
        options={actions.map((a) => ({
          ...a,
          category: undefined,
        }))}
        onSelect={(opt) => opt.value && opt.onSelect?.(dlg)}
      />
    ))
  }

  onMount(() => loadData())

  return (
    <DialogSelect
      title={`记忆审查 (待审: ${candidates().filter((c) => c.status === "pending").length})`}
      placeholder="搜索记忆..."
      options={toOptions(candidates())}
      footer={
        <box flexDirection="row" gap={1}>
          <For each={["pending", "applied", "dismissed"] as const}>
            {(s) => (
              <text
                fg={filter() === s ? theme.primary : theme.textMuted}
                onMouseUp={() => {
                  setFilter(s)
                  loadData(s)
                }}
              >
                [{s === "pending" ? "待审" : s === "applied" ? "已应用" : "已驳回"}]
              </text>
            )}
          </For>
        </box>
      }
    />
  )
}
