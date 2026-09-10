import { Match, onMount, Show, Switch } from "solid-js"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { useTuiConfig } from "../config"
import { useBindings } from "../keymap"
import { DbPanel } from "./db-panel"
import { MemoryPanel } from "./memory-panel"
import { EvolutionPanel } from "./evolution-panel"
import { CheckpointPanel } from "./checkpoint-panel"
import { GoalPanel } from "./goal-panel"
import { WorkflowPanel } from "./workflow-panel"
import { OrchestratorPanel } from "./orchestrator-panel"
import { icon, type PanelIconKey } from "../util/panel-icons"

export type WorkbenchView = "data" | "memory" | "evolution" | "checkpoint" | "goal" | "workflow" | "orchestrator"

const workbenchIcon = (view: WorkbenchView): PanelIconKey => (view === "data" ? "db" : view)

const HUB_VIEWS: Array<{ value: WorkbenchView; title: string; description: string }> = [
  { value: "memory", title: "持久记忆", description: "查看和管理会话记忆" },
  { value: "evolution", title: "自我进化", description: "查看经验与进化记录" },
  { value: "checkpoint", title: "检查点", description: "浏览会话检查点" },
  { value: "goal", title: "目标", description: "查看当前目标" },
  { value: "workflow", title: "工作流", description: "查看工作流状态" },
  { value: "orchestrator", title: "编排", description: "查看任务编排" },
]

export function workbenchOptions(): DialogSelectOption<WorkbenchView>[] {
  return [
    {
      value: "data",
      title: "数据",
      description: "浏览数据库连接、表结构和查询结果",
      category: "数据",
      titleView: <span>{icon("db")} 数据</span>,
    },
    ...HUB_VIEWS.map((view) => ({
      value: view.value,
      title: view.title,
      description: view.description,
      category: "智能中枢",
      titleView: (
        <span>
          {icon(workbenchIcon(view.value))} {view.title}
        </span>
      ),
    })),
  ]
}

export function DialogWorkbench(props: { directory: string; sessionID?: string }) {
  const dialog = useDialog()
  const options = workbenchOptions()
  onMount(() => dialog.setSize("xlarge"))

  return (
    <DialogSelect
      title="工具工作台"
      placeholder="搜索工具"
      options={options}
      footerHints={[
        { title: "选择工具", label: "Enter" },
        { title: "关闭", label: "Esc", side: "right" },
      ]}
      onSelect={(option) => {
        dialog.replace(() => <WorkbenchPanel {...props} view={option.value} />)
      }}
    />
  )
}

function WorkbenchPanel(props: { directory: string; sessionID?: string; view: WorkbenchView }) {
  const dialog = useDialog()
  const tuiConfig = useTuiConfig()
  const { theme } = useTheme()
  const onBack = () => dialog.replace(() => <DialogWorkbench {...props} />)
  onMount(() => dialog.setSize("xlarge"))

  useBindings(() => ({
    commands: [
      {
        name: "workbench.back",
        title: "返回工具工作台",
        category: "工作台",
        run: onBack,
      },
    ],
    bindings: tuiConfig.keybinds.gather("dialog.workbench", ["workbench.back"]),
  }))

  const title =
    props.view === "data" ? "数据" : (HUB_VIEWS.find((item) => item.value === props.view)?.title ?? "智能中枢")

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0} paddingLeft={2} paddingRight={2}>
      <box flexDirection="row" justifyContent="space-between" paddingBottom={1} flexShrink={0}>
        <text fg={theme.text}>
          <b>
            {icon(workbenchIcon(props.view))} {title}
          </b>
        </text>
        <text fg={theme.textMuted} onMouseUp={onBack}>
          ← 返回工具箱
        </text>
      </box>
      <scrollbox flexGrow={1} minHeight={0}>
        <Show when={props.view === "data"}>
          <DbPanel directory={props.directory} />
        </Show>
        <Show when={props.view !== "data"}>
          <Show when={props.sessionID} fallback={<text fg={theme.textMuted}>开始对话后可用</text>}>
            <Switch>
              <Match when={props.view === "memory"}>
                <MemoryPanel sessionID={props.sessionID!} />
              </Match>
              <Match when={props.view === "evolution"}>
                <EvolutionPanel sessionID={props.sessionID!} />
              </Match>
              <Match when={props.view === "checkpoint"}>
                <CheckpointPanel sessionID={props.sessionID!} />
              </Match>
              <Match when={props.view === "goal"}>
                <GoalPanel sessionID={props.sessionID!} />
              </Match>
              <Match when={props.view === "workflow"}>
                <WorkflowPanel sessionID={props.sessionID!} />
              </Match>
              <Match when={props.view === "orchestrator"}>
                <OrchestratorPanel sessionID={props.sessionID!} />
              </Match>
            </Switch>
          </Show>
        </Show>
      </scrollbox>
      <text fg={theme.textMuted} paddingTop={1}>
        ← 返回工具箱 · Esc 关闭
      </text>
    </box>
  )
}
