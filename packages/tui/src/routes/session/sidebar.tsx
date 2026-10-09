import { useProject } from "../../context/project"
import { useSync } from "../../context/sync"
import { createEffect, createMemo, createSignal, on, Show } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import path from "node:path"
import { useTheme } from "../../context/theme"
import { useKV } from "../../context/kv"
import { useTuiConfig } from "../../config"
import { InstallationChannel, InstallationVersion } from "@novaway/core/installation/version"
import { usePluginRuntime } from "../../plugin/runtime"

import { getScrollAcceleration } from "../../util/scroll"
import { icon } from "../../util/panel-icons"
import { WorkspaceLabel } from "../../component/workspace-label"
import { TUI_BRAND } from "../../brand"
import { FileTree } from "../../component/file-tree"
import { QuickPreviewCard } from "../../component/quick-preview-card"
import { GitPanel } from "../../component/git-panel"
import { SegmentTabs, type SegmentTab } from "../../component/segment-tabs"
import { PANEL_CARD_ALPHA, SidebarCard } from "../../component/sidebar-card"
import { Locale } from "../../util/locale"
import { sidebarWidth } from "../../util/sidebar-width"
import "../../ui/card"
import { calmStops } from "../../ui/neon"

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
  /** Git 页点提交行:在主区打开"提交详情"标签页(不再弹窗) */
  onOpenCommit?: (hash: string) => void
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
  const kv = useKV()
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

  // 标签的字形跟着 icons 风格走(见 util/panel-icons):/icon 切过风格之后这一行要立刻重排,
  // 所以 glyph 在**渲染期**由 icon() 现取,不是模块加载时抄一份。字形的列数一变,
  // 后面每一段的起点跟着变,指示条也就跟着变(见 component/segment-tabs 的 slots)。
  const tabs = createMemo<SegmentTab<SidebarTab>[]>(() =>
    SIDEBAR_TABS.map((tab) => ({ id: tab.id, text: tab.text, glyph: icon(tab.id) })),
  )

  // 文件树与 Git 页共用同一个根目录:会话目录优先,没有会话才落回实例目录。
  const rootDir = createMemo(() => session()?.directory ?? project.instance.directory())
  // 徽标只取目录名那一段(path.basename 对 Windows 的反斜杠路径同样有效)。
  const rootDirName = createMemo(() => path.basename(rootDir()))

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
    <neonbox
      backgroundColor={theme.backgroundPanel}
      /* 常驻流动的那一族走 `calmStops`(两段青蓝)而不是 `neonStops`(三段全霓虹):
         这张卡是整列最高的表面,三段彩虹沿着它一圈一圈地跑,色相跨度 152° ——
         原型对应的那根 `.sidebar::after` 只有 1px 宽、色相从青到粉而且两端透明,
         靠的就是「窄」而不是「全」。收窄之后 38°,理由与取值见 ui/neon 的 calmStops。 */
      gradientStops={calmStops(theme)}
      /* 叠色档与分区卡同一档(见 component/sidebar-card 的 PANEL_CARD_ALPHA):这张根卡
         是整列的容器,比任何一张分区卡都大,若比它们更实就会变成屏幕上最重的一条边。
         叠色底不用给 —— 它自己有 backgroundColor,那就是边框格背后的实色;那一档若是
         全透明(主题声明 transparent,见 ui/neon 的 softenOver),折算自动退成不折算。 */
      borderAlpha={PANEL_CARD_ALPHA}
      /* 常驻流动 —— 保留,理由与代价都在这里。
         原型那边侧栏右缘那根 1px 流光轨是 `.sidebar::after { animation: railV 9s linear
         infinite }`(card-design-v7.html:109-115),**从不间歇**;它是 `top/right/bottom: 0`
         贴在侧栏右边的那一条,而原型侧栏自己并不带描边 —— 那一列的轮廓就是这根轨。
         终端里侧栏根卡有描边,所以它的右边框正是这块表面,这一档就是那根轨的对应物。
         (另一条常驻轨 `railFlow 7s` 在标题栏,终端里是标签栏底下那条 NeonRail,
          见 component/tab-bar.tsx。面板卡/分区卡**不**在这一档:原型 `.card` 底态不流,
          gbFlow 挂在 :hover 上,所以它们只给 animated —— 见 component/sidebar-card.tsx。)

         **这一档的代价写在这里,别当成 bug 顺手加门控**:
           · 每张在流的卡各挂**自己**的 80ms 表(见 ui/card 的 syncPhaseTimer),每拍只做
             两件事:相位走一格 + requestRender()。没有布局计算,没有几何改动。
           · 帧率封顶 12.5/s:相位只有 100 格,每拍一格,再密也只是在同一批格子里换颜色,
             整圈是 8 秒(原型那根是 9 秒,差的那 1 秒共用同一张相位表,肉眼读不出来)。
           · **代价是真的**:这一版 opentui 没有消费 Renderable 的 `_dirty` 标志
             (node_modules/@opentui/core 里 isDirty/markClean 无人读),所以一次
             requestRender 会把整棵渲染列表重画一遍 —— 于是「只看侧栏、什么都不干」时
             CPU 一直在转、终端也一直在收输出。侧栏这一列现在只有这一张卡在流
             (分区卡同屏七八张那一档已经交回给悬停),量级就是一张。
           · 唯一的开关是 `animations_enabled = false`(就折在这一行):关掉是 setter 停表,
             打开是 setter 起表,两边对称。要省电只能用它,或者把 flow 摘掉 —— 别在渲染层
             加一个「不可见的卡就别走」的拉式门控:那是只能停不能恢复的坑(见 ui/card 的 flow)。 */
      flow={kv.get("animations_enabled", true)}
      /* 侧栏根卡既不悬停也不入场:它是整列的容器,鼠标几乎永远在它范围内 ——
         「悬停才提亮」在这里等于「一直亮着」,这条视觉信号就废了;入场同理,
         它比里面任何一张分区卡都活得久。分区卡自己那层才有悬停动效(见 sidebar-card.tsx)。 */
      width={sidebarWidth(dimensions().width)}
      height="100%"
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
      /* overflow="hidden":这一列是固定高度,子内容(预览卡 + scrollbox + 页脚)一旦超过
         terminalHeight,没有裁剪的话最后几行会画到**下一行**去 —— 品牌页脚先被顶出去。
         预览卡已经按可用高度封顶(quick-preview-card 的 previewMaxLines),这一层是兜底:
         终端再矮也不该看到溢出到面板外面的内容。 */
      overflow="hidden"
      position={props.overlay ? "absolute" : "relative"}
      flexDirection="column"
    >
      {/* 标签页栏。常驻只保留文件、待办与统计、Git。
          指示条会从当前段**滑**到新点的那一段(原型 `.seg .seg-ind` 的
          `transition: transform .42s`,card-design-v7.html:127-135),几何与
          animations_enabled 的处理都在 component/segment-tabs 里。 */}
      <SegmentTabs
        tabs={tabs()}
        active={activeTab()}
        onSelect={setActiveTab}
        animate={kv.get("animations_enabled", true)}
      />
      {/* 文件树标签页 = 可滚动的文件树卡 + 「快速预览」卡。
          预览卡读的是文件树写进模块级 selectedPath 的那一个文件(见 component/file-tree 与
          component/quick-preview-card);没选中文件时它整张不出现(空态)。

          **它是树下面那张**(原型 :795-817 也是这个顺序)。两张卡都待在 scrollbox **外面** ——
          这才是它们能同时在屏内的真正原因:侧栏文件页整列只有一个 scrollbox,列里的内容高度
          是自适应的,于是 flexShrink 永不生效,行数不封顶的文件树会把同列后面任何一张卡挤出
          可视区(实测 40 个文件时树正好占满)。树待在 scrollbox 里自己滚、预览卡在它下面按
          内容高站住,预览该让位的是**行数**(previewMaxLines 已经按这个顺序把「树至少要留的行数」
          当硬预算先扣掉),不是位置。 */}
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
          <SidebarCard title="资源管理器" icon={icon("files")} badge={rootDirName()} page="files">
            <FileTree
              rootPath={rootDir()}
              onFileSelect={(filePath) => {
                props.onFileSelect?.(filePath)
              }}
              onFileDoubleClick={(filePath) => {
                props.onFileDoubleClick?.(filePath)
              }}
            />
          </SidebarCard>
        </scrollbox>
        <QuickPreviewCard />
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
              rootPath={rootDir()}
              onOpenDiff={(filePath) => {
                props.onOpenDiff?.(filePath)
              }}
              onOpenCommit={(hash) => {
                props.onOpenCommit?.(hash)
              }}
            />
          </box>
        </scrollbox>
      </Show>

      {/* 页脚。**只有品牌落款,没有目录** —— 目录由会话页底栏(routes/session/footer.tsx)
          独家显示,那一行还带着 abbreviateHome 过的路径与 `⑂ 分支`。侧栏这一份曾经也印一遍,
          于是屏幕底部上下叠着两条一样的路径(与输入卡状态行那次重复是同一件事,见
          component/prompt/index.tsx 里对应的注释)。
          生产里这个槽永远由内置插件占住(mode="single_winner",注册方是
          feature-plugins/sidebar/footer.tsx),下面这段只是插件缺席时的兜底;两边同规格 ——
          兜底里若加回目录,就会出现「插件打了一份、兜底打了一份」的第二真相。 */}
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
    </neonbox>
  )
}
