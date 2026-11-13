import { For, Show, createMemo, createSignal } from "solid-js"
import { BasicTool, ToolRegistry } from "@novaway/ui/message-part"
import { Icon } from "@novaway/ui/icon"
import { Markdown } from "@novaway/ui/markdown"
import { useLanguage } from "@/context/language"
import { describeWorkflowCard } from "./workflow-card"

/**
 * 动态工作流的工具行。
 *
 * 与别的工具不同，它有三个阶段要看：
 *   1. **跑着**：只有元数据里的进度快照（阶段、步数、报告条数），没有输出；
 *   2. **刚跑完**：输出是一段给人看的摘要（结论、报告、用量）；
 *   3. **查历史**：`workflow_run` 的输出是库里那一行的渲染，形状一样。
 *
 * 所以渲染只依赖三样东西：进度快照画头部的进度与阶段，输出交给 Markdown 铺开，
 * 名字与状态来自 input/status。这样同一次 run 在「跑」和「查」两个入口长得一样。
 */
export function WorkflowToolComponent(props: {
  input: Record<string, any>
  metadata: Record<string, any>
  output?: string
  status?: string
}) {
  const language = useLanguage()
  const [openOutput, setOpenOutput] = createSignal(false)
  const card = createMemo(() =>
    describeWorkflowCard({ input: props.input ?? {}, metadata: props.metadata ?? {}, status: props.status }),
  )
  const reports = createMemo(() => {
    const value = props.metadata?.reports
    return Array.isArray(value) ? value : []
  })

  return (
    <BasicTool
      {...props}
      icon="lu-list-checks"
      badge={{ color: "violet" }}
      status={props.status}
      trigger={{
        title: language.t("workflow.tool.title"),
        subtitle: card().title,
        args: [card().summary, card().phaseLabel].filter((item): item is string => !!item),
      }}
    >
      <div class="flex flex-col gap-2 p-2">
        {/* 进度条：只按「已经开始」的步数算，不编总数。 */}
        <Show when={card().percent > 0}>
          <div class="flex items-center gap-2">
            <div class="h-1 flex-1 overflow-hidden rounded-full bg-border">
              <div
                class="h-full rounded-full bg-[color-mix(in_srgb,var(--indicator-interactive-base)_75%,transparent)] transition-[width] duration-300"
                style={{ width: `${card().percent}%` }}
                data-component="workflow-progress"
              />
            </div>
            <span class="shrink-0 text-11-regular text-foreground-subtle">{card().percent}%</span>
          </div>
        </Show>

        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-11-regular text-foreground-subtle">
          <Show when={card().phaseLabel}>
            <span class="inline-flex items-center gap-1">
              <Icon name="chevron-double-right" size="small" />
              {card().phaseLabel}
            </span>
          </Show>
          <Show when={card().reports > 0}>
            <span>{language.t("workflow.tool.reports", { count: card().reports })}</span>
          </Show>
          <Show when={card().cached > 0}>
            <span>{language.t("workflow.tool.cached", { count: card().cached })}</span>
          </Show>
          <Show when={card().failed > 0}>
            <span class="text-critical-base">{language.t("workflow.tool.failed", { count: card().failed })}</span>
          </Show>
        </div>

        {/* 报告：跑着的时候就有，先折叠；点开看全文。 */}
        <Show when={reports().length > 0}>
          <div class="flex flex-col gap-1">
            <button
              type="button"
              class="self-start rounded-md px-2 py-1 text-11-medium text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
              onClick={() => setOpenOutput(!openOutput())}
            >
              {openOutput() ? language.t("workflow.tool.hideReports") : language.t("workflow.tool.showReports")}
            </button>
            <Show when={openOutput()}>
              <For each={reports()}>
                {(item) => (
                  <div class="rounded-md border border-border/60 bg-surface/60 px-2 py-1.5">
                    <Markdown
                      text={
                        "```json" +
                        String.fromCharCode(10) +
                        JSON.stringify(item, null, 2) +
                        String.fromCharCode(10) +
                        "```"
                      }
                    />
                  </div>
                )}
              </For>
            </Show>
          </div>
        </Show>

        <Show when={props.output}>
          <div data-component="tool-output" data-scrollable>
            <Markdown text={props.output!} />
          </div>
        </Show>
      </div>
    </BasicTool>
  )
}

ToolRegistry.register({ name: "create_workflow", render: WorkflowToolComponent })
ToolRegistry.register({ name: "workflow_run", render: WorkflowToolComponent })
ToolRegistry.register({ name: "resume_workflow_run", render: WorkflowToolComponent })
ToolRegistry.register({ name: "save_workflow", render: WorkflowToolComponent })
ToolRegistry.register({ name: "list_saved_workflows", render: WorkflowToolComponent })
