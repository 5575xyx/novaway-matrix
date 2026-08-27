import { useSDK } from "../../context/sdk"
import { useTheme } from "../../context/theme"
import { useDialog, type DialogContext } from "../../ui/dialog"
import { DialogSelect, type DialogSelectOption } from "../../ui/dialog-select"
import { DialogConfirm } from "../../ui/dialog-confirm"
import { createSignal, onMount, For } from "solid-js"
import {
  evolutionApi,
  type EvolutionCandidate,
} from "../../util/memory-evolution-api"

type FilterStatus = "pending" | "applied" | "dismissed"

function evolutionKindLabel(kind: string): string {
  const labels: Record<string, string> = {
    skill: "技能",
    agent: "智能体",
    workflow: "工作流",
    prompt: "提示词",
    tool: "工具",
    project: "项目",
    strategy: "策略",
    habit: "习惯",
    knowledge: "知识",
  }
  return labels[kind] ?? kind
}

function evolutionDomainLabel(domain: string): string {
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

export interface DialogEvolutionReviewProps {
  sessionID: string
}

export function DialogEvolutionReview(props: DialogEvolutionReviewProps) {
  const sdk = useSDK()
  const { theme } = useTheme()
  const dialog = useDialog()

  const [candidates, setCandidates] = createSignal<EvolutionCandidate[]>([])
  const [filter, setFilter] = createSignal<FilterStatus>("pending")
  const [loading, setLoading] = createSignal(true)

  async function loadData(status?: FilterStatus) {
    setLoading(true)
    const data = await evolutionApi.listCandidates(sdk.client, {
      status: status ?? filter(),
      limit: 50,
    })
    setCandidates(data)
    setLoading(false)
  }

  async function applyCandidate(candidateID: string) {
    const success = await evolutionApi.applyFileCandidate(sdk.client, candidateID)
    if (success) await loadData()
  }

  async function dismissCandidate(candidateID: string) {
    const confirmed = await DialogConfirm.show(dialog, "驳回进化", "确定要驳回此进化候选吗？")
    if (!confirmed) return
    const success = await evolutionApi.dismissCandidate(sdk.client, candidateID)
    if (success) await loadData()
  }

  async function previewCandidate(candidateID: string): Promise<string> {
    const data = await evolutionApi.dryRunCandidate(sdk.client, candidateID)
    if (data?.files && data.files.length > 0) {
      return data.files.map((f: any) => `${f.path}:\n${f.diff}`).join("\n\n")
    }
    return "无差异预览"
  }

  function toOptions(list: EvolutionCandidate[]): DialogSelectOption<EvolutionCandidate>[] {
    return list.map((c) => ({
      title: c.title,
      value: c,
      description: `${evolutionKindLabel(c.kind)} · ${evolutionDomainLabel(c.domain)} · ${c.contentFormat === "unified_diff" ? "差异" : "全文"}`,
      details: [
        `目标: ${c.target}`,
        `原因: ${c.reason}`,
        `标签: ${c.tags.join(", ") || "无"}`,
        `验证: ${c.validationStatus === "validated" ? "已通过" : c.validationStatus === "failed" ? "失败" : "待验证"}`,
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

  function showActions(dlg: DialogContext, candidate: EvolutionCandidate) {
    const actions: DialogSelectOption<string>[] = [
      {
        title: "应用写入",
        value: "apply",
        description: "将进化候选写入项目文件",
        onSelect: async () => {
          await applyCandidate(candidate.id)
          dlg.clear()
        },
      },
      {
        title: "预览差异",
        value: "preview",
        description: "查看将要写入的文件变更",
        onSelect: async () => {
          const diff = await previewCandidate(candidate.id)
          dlg.replace(() => (
            <DialogSelect
              title={`预览: ${candidate.title}`}
              options={[{
                title: diff,
                value: "diff",
                onSelect: () => dlg.clear(),
              }]}
            />
          ))
        },
      },
      {
        title: "驳回",
        value: "dismiss",
        description: "丢弃此进化候选",
        onSelect: async () => {
          await dismissCandidate(candidate.id)
          dlg.clear()
        },
      },
    ]

    dlg.replace(() => (
      <DialogSelect
        title={`进化: ${candidate.title}`}
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
      title={`进化审查 (待审: ${candidates().filter((c) => c.status === "pending").length})`}
      placeholder="搜索进化候选..."
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
