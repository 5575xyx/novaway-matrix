import { useProject } from "../../context/project"
import { useSync } from "../../context/sync"
import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
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
import { GitPanel } from "../../component/git-panel"
import { DbPanel } from "../../component/db-panel"
import { Locale } from "../../util/locale"
import { sidebarWidth } from "../../util/sidebar-width"

// 会话标题是模型生成的,没有长度和换行保证;侧栏这一格放不下多行。
const SESSION_TITLE_MAX = 60

export interface SidebarProps {
  // 首屏(还没有任何会话)也要显示同一条侧栏,所以 sessionID 允许缺席:
  // 缺席时只隐藏会话专属的那几块(标题、检查点/目标/工作流/编排),
  // 目录树、MCP、LSP、品牌页脚这些项目级信息照旧显示。
  sessionID?: string
  overlay?: boolean
  onFileSelect?: (filePath: string) => void
  /** Git 页点变更文件名:打开"改动差异"标签页(和文件树的整文件预览分开走) */
  onOpenDiff?: (filePath: string) => void
  onFileDoubleClick?: (filePath: string) => void
}

export type SidebarTab = "files" | "info" | "git" | "db" | "hub"

export const SIDEBAR_TABS: Array<{ id: SidebarTab; text: string }> = [
  { id: "files", text: "文件" },
  { id: "info", text: "信息" },
  { id: "git", text: "Git" },
  { id: "db", text: "数据" },
  { id: "hub", text: "智能中枢" },
]

// 侧栏当前面板提到模块作用域:原来它是 Sidebar 内部的局部 signal,只有那三个
// onMouseUp 能改,所以一旦标签行没画出来(或者用户不用鼠标)就彻底没法切面板了。
// 提上来之后命令面板 / 键位也能切,不必再依赖能点到那一行。
// 默认停在"文件":文件树是进来第一眼最有用的;有了 todo 再自动跳到"信息"。
const [sidebarTab, setSidebarTab] = createSignal<SidebarTab>("files")
export { sidebarTab, setSidebarTab }

export function cycleSidebarTab(step = 1) {
  const index = SIDEBAR_TABS.findIndex((tab) => tab.id === sidebarTab())
  const next = (index + step + SIDEBAR_TABS.length) % SIDEBAR_TABS.length
  setSidebarTab(SIDEBAR_TABS[next]!.id)
}

// 智能中枢内的可折叠分区(记忆 / 进化 / 检查点 / 目标 / 工作流)
type HubSection = "memory" | "evolution" | "checkpoint" | "goal" | "workflow" | "orchestrator"

const HUB_SECTIONS: Array<{ id: HubSection; text: string }> = [
  { id: "memory", text: "持久记忆" },
  { id: "evolution", text: "自我进化" },
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
  const dimensions = useTerminalDimensions()
  const session = createMemo(() => (props.sessionID ? sync.session.get(props.sessionID) : undefined))
  // 会话专属面板要用的 id;没有会话时给空串,插件槽里的 state 查询对未知 id 都返回空值。
  const sessionID = createMemo(() => props.sessionID ?? "")
  const workspace = () => {
    const workspaceID = session()?.workspaceID
    if (!workspaceID) return
    return project.workspace.get(workspaceID)
  }
  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))

  const activeTab = sidebarTab
  const setActiveTab = setSidebarTab

  // 折叠状态:记录被折叠的分区;默认全部展开(集合为空)
  const [collapsed, setCollapsed] = createSignal<Set<HubSection>>(new Set())
  const toggleSection = (id: HubSection) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // 有了 todo 就自动跳到"信息"(todo 列表在那边):默认的"文件"页没有 todo,
  // 只有从空到有的那一刻跳一次,用户手动切走后不再抢。
  const todos = createMemo(() => sync.data.todo[props.sessionID ?? ""] ?? [])
  createEffect(
    on(
      todos,
      (list, prev) => {
        if (list.length > 0 && (prev?.length ?? 0) === 0) setSidebarTab("info")
      },
      { defer: true },
    ),
  )

  return (
    <box
      backgroundColor={theme.backgroundPanel}
      width={sidebarWidth(dimensions().width)}
      height="100%"
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
      position={props.overlay ? "absolute" : "relative"}
      flexDirection="column"
    >
      {/* 标签页栏。flexShrink={0}:这一行是唯一的切换入口,任何情况下都不许被下面的
            面板内容挤掉高度,否则就变成"看得见面板、切不动面板"。
            gap 随宽度收:窄侧栏(44 列)五个标签靠 gap=1 才排得下。 */}
      <box flexDirection="row" gap={dimensions().width > 160 ? 2 : 1} paddingBottom={1} flexShrink={0}>
        <For each={SIDEBAR_TABS}>
          {(tab) => (
            <text fg={activeTab() === tab.id ? theme.primary : theme.textMuted} onMouseUp={() => setActiveTab(tab.id)}>
              {icon(tab.id)} {tab.text}
            </text>
          )}
        </For>
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
            rootPath={session()?.directory ?? project.instance.directory()}
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
            {/* 标题块是会话专属的:首屏没有会话就整块跳过,下面的项目级内容照旧 */}
            <Show when={session()}>
              {(item) => (
                <pluginRuntime.Slot
                  name="sidebar_title"
                  mode="single_winner"
                  session_id={sessionID()}
                  title={item().title}
                  share_url={item().share?.url}
                >
                  <box paddingRight={1}>
                    <text fg={theme.text}>
                      <b>{Locale.oneLine(item().title, SESSION_TITLE_MAX)}</b>
                    </text>
                    <Show when={InstallationChannel !== "latest"}>
                      <text fg={theme.textMuted}>{sessionID()}</text>
                    </Show>
                    <Show when={item().workspaceID}>
                      <text fg={theme.textMuted}>
                        <Show
                          when={workspace()}
                          fallback={<WorkspaceLabel type="unknown" name={item().workspaceID!} status="error" icon />}
                        >
                          {(ws) => (
                            <WorkspaceLabel
                              type={ws().type}
                              name={ws().name}
                              status={project.workspace.status(ws().id) ?? "error"}
                              icon
                            />
                          )}
                        </Show>
                      </text>
                    </Show>
                    <Show when={item().share?.url}>
                      <text fg={theme.textMuted}>{item().share!.url}</text>
                    </Show>
                  </box>
                </pluginRuntime.Slot>
              )}
            </Show>
            <pluginRuntime.Slot name="sidebar_content" session_id={sessionID()} />
          </box>
        </scrollbox>
      </Show>
      {/* Git 标签页:分支/变更文件/分支列表/贮藏/最近提交。变更文件单击开"改动差异"标签页。 */}
      <Show when={activeTab() === "git"}>
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
            <GitPanel
              rootPath={session()?.directory ?? project.instance.directory()}
              onOpenDiff={(filePath) => {
                props.onOpenDiff?.(filePath)
              }}
            />
          </box>
        </scrollbox>
      </Show>

      {/* 数据标签页:数据库连接管理(功能对齐桌面端"数据库"页) */}
      <Show when={activeTab() === "db"}>
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
            <DbPanel directory={session()?.directory ?? project.instance.directory()} />
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
                    <b>
                      {icon(section.id)} {section.text}
                    </b>
                  </text>
                  {/* 分区内容:未折叠时渲染对应面板。检查点/目标/工作流/编排要按会话查询,
                      首屏还没有会话,直接给一行说明,不去用空 id 打接口。 */}
                  <Show when={!collapsed().has(section.id)}>
                    <Switch>
                      <Match when={section.id === "memory"}>
                        <MemoryPanel sessionID={sessionID()} />
                      </Match>
                      <Match when={section.id === "evolution"}>
                        <EvolutionPanel sessionID={sessionID()} />
                      </Match>
                      <Match when={!props.sessionID}>
                        <text fg={theme.textMuted}>开始对话后可用</text>
                      </Match>
                      <Match when={section.id === "checkpoint"}>
                        <CheckpointPanel sessionID={sessionID()} />
                      </Match>
                      <Match when={section.id === "goal"}>
                        <GoalPanel sessionID={sessionID()} />
                      </Match>
                      <Match when={section.id === "workflow"}>
                        <WorkflowPanel sessionID={sessionID()} />
                      </Match>
                      <Match when={section.id === "orchestrator"}>
                        <OrchestratorPanel sessionID={sessionID()} />
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
        <pluginRuntime.Slot name="sidebar_footer" mode="single_winner" session_id={sessionID()}>
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
  )
}
