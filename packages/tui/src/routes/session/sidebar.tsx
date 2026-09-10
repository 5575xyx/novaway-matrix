import { useProject } from "../../context/project"
import { useSync } from "../../context/sync"
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js"
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
import { GitPanel } from "../../component/git-panel"
import { Locale } from "../../util/locale"
import { sidebarWidth } from "../../util/sidebar-width"

// 会话标题是模型生成的,没有长度和换行保证;侧栏这一格放不下多行。
const SESSION_TITLE_MAX = 60

export interface SidebarProps {
  // 首屏(还没有任何会话)也要显示同一条侧栏,所以 sessionID 允许缺席:
  // 缺席时只隐藏会话专属的那几块(标题、检查点/目标/工作流/编排),
  // 目录树、LSP、品牌页脚这些项目级信息照旧显示。
  sessionID?: string
  overlay?: boolean
  onFileSelect?: (filePath: string) => void
  /** Git 页点变更文件名:打开"改动差异"标签页(和文件树的整文件预览分开走) */
  onOpenDiff?: (filePath: string) => void
  onFileDoubleClick?: (filePath: string) => void
}

export type SidebarTab = "files" | "info" | "git"

export const SIDEBAR_TABS: Array<{ id: SidebarTab; text: string }> = [
  { id: "files", text: "文件" },
  { id: "info", text: "待办与统计" },
  { id: "git", text: "Git" },
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

  // 有了 todo 就自动跳到"待办与统计",用户手动切走后不再抢回。
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
      {/* 标签页栏。常驻只保留文件、待办与统计、Git。 */}
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

      {/* 待办与统计内容:上下文统计、消息列表和待办事项 */}
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
