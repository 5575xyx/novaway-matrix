import { useProject } from "../../context/project"
import { useSync } from "../../context/sync"
import { createMemo, createSignal, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { useTuiConfig } from "../../config"
import { InstallationChannel, InstallationVersion } from "@novaway/core/installation/version"
import { usePluginRuntime } from "../../plugin/runtime"

import { getScrollAcceleration } from "../../util/scroll"
import { WorkspaceLabel } from "../../component/workspace-label"
import { TUI_BRAND } from "../../brand"
import { FileTree } from "../../component/file-tree"
import { MemoryPanel } from "../../component/memory-panel"
import { EvolutionPanel } from "../../component/evolution-panel"
import { CheckpointPanel } from "../../component/checkpoint-panel"
import { GoalPanel } from "../../component/goal-panel"
import { WorkflowPanel } from "../../component/workflow-panel"

export interface SidebarProps {
  sessionID: string
  overlay?: boolean
  onFileSelect?: (filePath: string) => void
  onFileDoubleClick?: (filePath: string) => void
}

type SidebarTab = "files" | "info" | "memory" | "evolution" | "checkpoint" | "goal" | "workflow"

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
            📋 信息
          </text>
          <text
            fg={activeTab() === "files" ? theme.primary : theme.textMuted}
            onMouseUp={() => setActiveTab("files")}
          >
            📁 文件
          </text>
          <text
            fg={activeTab() === "memory" ? theme.primary : theme.textMuted}
            onMouseUp={() => setActiveTab("memory")}
          >
            🧠 记忆
          </text>
          <text
            fg={activeTab() === "evolution" ? theme.primary : theme.textMuted}
            onMouseUp={() => setActiveTab("evolution")}
          >
            🧬 进化
          </text>
          <text
            fg={activeTab() === "checkpoint" ? theme.primary : theme.textMuted}
            onMouseUp={() => setActiveTab("checkpoint")}
          >
            📸 检查点
          </text>
          <text
            fg={activeTab() === "goal" ? theme.primary : theme.textMuted}
            onMouseUp={() => setActiveTab("goal")}
          >
            🎯 目标
          </text>
          <text
            fg={activeTab() === "workflow" ? theme.primary : theme.textMuted}
            onMouseUp={() => setActiveTab("workflow")}
          >
            🔄 工作流
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

        {/* 记忆标签页 */}
        <Show when={activeTab() === "memory"}>
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
              <MemoryPanel sessionID={props.sessionID} />
            </box>
          </scrollbox>
        </Show>

        {/* 进化标签页 */}
        <Show when={activeTab() === "evolution"}>
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
              <EvolutionPanel sessionID={props.sessionID} />
            </box>
          </scrollbox>
        </Show>

        {/* 检查点标签页 */}
        <Show when={activeTab() === "checkpoint"}>
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
              <CheckpointPanel sessionID={props.sessionID} />
            </box>
          </scrollbox>
        </Show>

        {/* 目标标签页 */}
        <Show when={activeTab() === "goal"}>
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
              <GoalPanel sessionID={props.sessionID} />
            </box>
          </scrollbox>
        </Show>

        {/* 工作流标签页 */}
        <Show when={activeTab() === "workflow"}>
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
              <WorkflowPanel sessionID={props.sessionID} />
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
