import { useProject } from "../../context/project"
import { useSync } from "../../context/sync"
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js"
import { useTheme } from "../../context/theme"
import { useTuiConfig } from "../../config"
import { InstallationChannel, InstallationVersion } from "@novaway/core/installation/version"
import { usePluginRuntime } from "../../plugin/runtime"

import { getScrollAcceleration } from "../../util/scroll"
import { icon } from "../../util/panel-icons"
import { WorkspaceLabel } from "../../component/workspace-label"
import { TUI_BRAND } from "../../brand"
import { FileTree } from "../../component/file-tree"
import { MemoryPanel } from "../../component/memory-panel"
import { EvolutionPanel } from "../../component/evolution-panel"
import { CheckpointPanel } from "../../component/checkpoint-panel"
import { GoalPanel } from "../../component/goal-panel"
import { WorkflowPanel } from "../../component/workflow-panel"
import { OrchestratorPanel } from "../../component/orchestrator-panel"

export interface SidebarProps {
  sessionID: string
  overlay?: boolean
  onFileSelect?: (filePath: string) => void
  onFileDoubleClick?: (filePath: string) => void
}

type SidebarTab = "files" | "info" | "hub"

// 智能中枢内的可折叠分区(记忆 / 进化 / 检查点 / 目标 / 工作流)
type HubSection = "memory" | "evolution" | "checkpoint" | "goal" | "workflow" | "orchestrator"

const HUB_SECTIONS: Array<{ id: HubSection; text: string }> = [
  { id: "memory", text: "记忆" },
  { id: "evolution", text: "进化" },
  { id: "checkpoint", text: "检查点" },
  { id: "goal", text: "目标" },
  { id: "workflow", text: "工作流" },
  { id: "orchestrator", text: "编排" },
]

export function Sidebar(props: SidebarProps) {
  const pluginRuntime = usePluginRuntime()
  const project = useProject()
  const sync = useSync()
  const { theme } = useTheme()
  const tuiConfig = useTuiConfig()
  const session = createMemo(() => sync.session.get(props.sessionID))
  const workspace = () => {
    const workspaceID = session()?.workspaceID
    if (!workspaceID) return
    return project.workspace.get(workspaceID)
  }
  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))

  const [activeTab, setActiveTab] = createSignal<SidebarTab>("info")

  // 折叠状态:记录被折叠的分区;默认全部展开(集合为空)
  const [collapsed, setCollapsed] = createSignal<Set<HubSection>>(new Set())
  const toggleSection = (id: HubSection) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <Show when={session()}>
      <box
        backgroundColor={theme.backgroundPanel}
        width={42}
        height="100%"
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        position={props.overlay ? "absolute" : "relative"}
        flexDirection="column"
      >
        {/* 标签页栏 */}
        <box flexDirection="row" gap={2} paddingBottom={1}>
          <text
            fg={activeTab() === "info" ? theme.primary : theme.textMuted}
            onMouseUp={() => setActiveTab("info")}
          >
            {icon("info")} 信息
          </text>
          <text
            fg={activeTab() === "files" ? theme.primary : theme.textMuted}
            onMouseUp={() => setActiveTab("files")}
          >
            {icon("files")} 文件
          </text>
          <text
            fg={activeTab() === "hub" ? theme.primary : theme.textMuted}
            onMouseUp={() => setActiveTab("hub")}
          >
            {icon("hub")} 智能中枢
          </text>
        </box>
        {/* 文件树标签页 */}
        <Show when={activeTab() === "files"}>
          <scrollbox
            flexGrow={1}
            scrollAcceleration={scrollAcceleration()}
            verticalScrollbarOptions={{
              trackOptions: {
                backgroundColor: theme.background,
                foregroundColor: theme.borderActive,
              },
            }}
          >
            <FileTree
              rootPath={session()!.directory}
              onFileSelect={(filePath) => {
                props.onFileSelect?.(filePath)
              }}
              onFileDoubleClick={(filePath) => {
                props.onFileDoubleClick?.(filePath)
              }}
            />
          </scrollbox>
        </Show>

        {/* 原始侧边栏内容（Context、MCP、LSP 等全部在一起） */}
        <Show when={activeTab() === "info"}>
          <scrollbox
            flexGrow={1}
            scrollAcceleration={scrollAcceleration()}
            verticalScrollbarOptions={{
              trackOptions: {
                backgroundColor: theme.background,
                foregroundColor: theme.borderActive,
              },
            }}
          >
            <box flexShrink={0} gap={1} paddingRight={1}>
              <pluginRuntime.Slot
                name="sidebar_title"
                mode="single_winner"
                session_id={props.sessionID}
                title={session()!.title}
                share_url={session()!.share?.url}
              >
                <box paddingRight={1}>
                  <text fg={theme.text}>
                    <b>{session()!.title}</b>
                  </text>
                  <Show when={InstallationChannel !== "latest"}>
                    <text fg={theme.textMuted}>{props.sessionID}</text>
                  </Show>
                  <Show when={session()!.workspaceID}>
                    <text fg={theme.textMuted}>
                      <Show
                        when={workspace()}
                        fallback={<WorkspaceLabel type="unknown" name={session()!.workspaceID!} status="error" icon />}
                      >
                        {(item) => (
                          <WorkspaceLabel
                            type={item().type}
                            name={item().name}
                            status={project.workspace.status(item().id) ?? "error"}
                            icon
                          />
                        )}
                      </Show>
                    </text>
                  </Show>
                  <Show when={session()!.share?.url}>
                    <text fg={theme.textMuted}>{session()!.share!.url}</text>
                  </Show>
                </box>
              </pluginRuntime.Slot>
              <pluginRuntime.Slot name="sidebar_content" session_id={props.sessionID} />
            </box>
          </scrollbox>
        </Show>
        {/* 智能中枢标签页:记忆 / 进化 / 检查点 / 目标 / 工作流 合并为可折叠分区 */}
        <Show when={activeTab() === "hub"}>
          <scrollbox
            flexGrow={1}
            scrollAcceleration={scrollAcceleration()}
            verticalScrollbarOptions={{
              trackOptions: {
                backgroundColor: theme.background,
                foregroundColor: theme.borderActive,
              },
            }}
          >
            <box flexShrink={0} gap={1} paddingRight={1}>
              <For each={HUB_SECTIONS}>
                {(section) => (
                  <box flexDirection="column" gap={1}>
                    {/* 分区标题:点击可折叠/展开 */}
                    <text fg={theme.text} onMouseUp={() => toggleSection(section.id)}>
                      <span style={{ fg: theme.textMuted }}>{collapsed().has(section.id) ? "▶" : "▼"}</span>{" "}
                      <b>{icon(section.id)} {section.text}</b>
                    </text>
                    {/* 分区内容:未折叠时渲染对应面板 */}
                    <Show when={!collapsed().has(section.id)}>
                      <Switch>
                        <Match when={section.id === "memory"}>
                          <MemoryPanel sessionID={props.sessionID} />
                        </Match>
                        <Match when={section.id === "evolution"}>
                          <EvolutionPanel sessionID={props.sessionID} />
                        </Match>
                        <Match when={section.id === "checkpoint"}>
                          <CheckpointPanel sessionID={props.sessionID} />
                        </Match>
                        <Match when={section.id === "goal"}>
                          <GoalPanel sessionID={props.sessionID} />
                        </Match>
                        <Match when={section.id === "workflow"}>
                          <WorkflowPanel sessionID={props.sessionID} />
                        </Match>
                        <Match when={section.id === "orchestrator"}>
                          <OrchestratorPanel sessionID={props.sessionID} />
                        </Match>
                      </Switch>
                    </Show>
                  </box>
                )}
              </For>
            </box>
          </scrollbox>
        </Show>

        <box flexShrink={0} gap={1} paddingTop={1}>
          <pluginRuntime.Slot name="sidebar_footer" mode="single_winner" session_id={props.sessionID}>
            <text fg={theme.textMuted}>
              <span style={{ fg: theme.success }}>•</span> <b>{TUI_BRAND.left}</b>
              <span style={{ fg: theme.text }}>
                <b>{TUI_BRAND.right}</b>
              </span>{" "}
              <span>{InstallationVersion}</span>
            </text>
          </pluginRuntime.Slot>
        </box>
      </box>
    </Show>
  )
}
