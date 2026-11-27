import { Show, createMemo } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { DropdownMenu } from "@novaway/ui/dropdown-menu"
import { IconButton } from "@novaway/ui/icon-button"
import { Mark } from "@novaway/ui/logo"
import { WindowControls } from "@/components/window-controls"
import { SessionHeader } from "@/components/session/session-header"
import { WorkflowStatus } from "@/components/session/workflow-status"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"
import { useSDK } from "@/context/sdk"
import { useSessionLayout } from "@/pages/session/session-layout"
import { decode64 } from "@/utils/base64"
import { displaySessionTitle } from "@/utils/session-title"

export function WorkspaceHeader() {
  const params = useParams()
  const navigate = useNavigate()
  const language = useLanguage()
  const layout = useLayout()
  const globalSync = useGlobalSync()
  const sessionLayout = useSessionLayout()
  const settings = useSettings()
  const sdk = useSDK()
  const workspaceAvailable = createMemo(() => sdk.directory !== "global-chat")
  // 运行平台（"desktop" = Electron 壳），不是视口宽度。会话页里那个 `isDesktop()` 是
  // createMediaQuery("(min-width: 768px)")，两者含义完全不同，别混用。
  const platform = usePlatform()
  const isMacDesktop = createMemo(() => platform.platform === "desktop" && platform.os === "macos")
  // 侧栏收起时，macOS 的红绿灯 / Windows 的原生窗控会压到会话帧这一行上，需要让出安全区。
  const reserveWindowControls = createMemo(() => !layout.sidebar.expanded())
  const directory = createMemo(() => (workspaceAvailable() ? (decode64(params.dir) ?? "") : "global-chat"))
  const sessionStore = createMemo(() => globalSync.child(directory())[0])
  const session = createMemo(() => sessionStore()?.session.find((s) => s.id === params.id))
  const working = createMemo(() => {
    const id = session()?.id
    const store = sessionStore()
    return id && store ? store.session_working(id) : false
  })
  const dirName = createMemo(() =>
    workspaceAvailable()
      ? (directory().split(/[\\/]/).filter(Boolean).pop() ?? directory())
      : language.t("sidebar.globalChat.title"),
  )
  const branch = createMemo(() => sessionStore()?.vcs?.branch ?? "")
  // 子会话的父会话（同一个 directory 的会话列表里找），用于顶部面包屑。
  const parentSession = createMemo(() => {
    const parentID = session()?.parentID
    if (!parentID) return
    return sessionStore()?.session.find((item) => item.id === parentID)
  })
  const openParentSession = () => {
    const parentID = session()?.parentID
    if (!parentID) return
    navigate(`/${params.dir}/session/${parentID}`)
  }

  return (
    <div
      data-component="workspace-header"
      // h-12、border-b border-border/50、左侧标题区 + 右侧操作区，
      // 整条 header 自己就是窗口拖拽区（子元素靠 data-window-drag 的 CSS 规则自动排除拖拽）。
      // 桌面端不再有全局标题栏，这个 header 就是窗口顶部的唯一可拖动区域。
      classList={{
        "flex h-12 shrink-0 items-center gap-2 border-b border-border px-2 select-none": true,
        // Windows 原生 titleBarOverlay 已关闭（改由 WindowControls 自绘），不再需要预留 138px。
        // macOS 红绿灯在左上角。左侧图标条（48px）常驻后，主区从 48px 开始，
        // 只需再让出红绿灯剩下的那段，不再按整组窗控宽度预留。
        "pl-[30px]": isMacDesktop() && reserveWindowControls(),
      }}
      data-window-drag
    >
      {/* 侧栏收起时，展开入口归 Header（收起态由 Header 承载展开按钮，
          展开态收起入口在侧栏顶带）。品牌字标不再重复一份 —— logo 常驻在最左侧图标条
          顶端（rail 不随折叠消失），这里只放展开按钮。 */}
      <Show when={!layout.sidebar.expanded()}>
        <IconButton
          icon="chevron-right"
          variant="ghost"
          size="normal"
          class="hidden xl:flex shrink-0"
          title={language.t("sidebar.workspaceSidebar.expand")}
          aria-label={language.t("sidebar.workspaceSidebar.expand")}
          onClick={() => layout.sidebar.setExpanded(true)}
        />
      </Show>
      {/* 窄视口（<xl）时侧栏整体隐藏，汉堡入口原来在全局标题栏里，随标题栏一起移除后落在这里。 */}
      <IconButton
        icon="menu"
        variant="ghost"
        class="xl:hidden shrink-0"
        aria-label={language.t("sidebar.menu.toggle")}
        aria-controls="workspace-mobile-sidebar"
        aria-expanded={layout.mobileSidebar.opened()}
        onClick={layout.mobileSidebar.toggle}
      />
      <Show when={working()}>
        <span class="size-2 rounded-full bg-[var(--surface-success-base)] novaway-breathe-dot shrink-0" />
      </Show>
      {/* 子智能体会话的面包屑：`父会话标题 › 本会话标题`。
          子会话从父会话派生而来，只给标题看不出它是谁的子任务
          （侧栏的树能看出来，但会话页本身此前只有在输入框被禁用时才有一个"回到父会话"）。 */}
      <Show when={parentSession()}>
        {(parent) => (
          <>
            <button
              type="button"
              class="max-w-[160px] shrink truncate text-ui-caption text-foreground-subtle transition-colors hover:text-foreground"
              title={displaySessionTitle(parent().title, language.t("workspace.header.untitled"))}
              onClick={openParentSession}
            >
              {displaySessionTitle(parent().title, language.t("workspace.header.untitled"))}
            </button>
            <span class="shrink-0 text-foreground-subtlest" aria-hidden="true">
              ›
            </span>
          </>
        )}
      </Show>
      <span class="text-ui-base font-medium text-foreground truncate max-w-[240px]">
        {workspaceAvailable() || params.id
          ? displaySessionTitle(session()?.title, language.t("workspace.header.untitled"))
          : language.t("sidebar.globalChat.title")}
      </span>
      <Show when={workspaceAvailable()}>
        <span class="text-ui-xs text-foreground-subtle truncate max-w-[180px] hidden md:block border border-border rounded-md px-1.5 py-0.5">
          {branch()
            ? language.t("workspace.header.projectBranch", { project: dirName(), branch: branch() })
            : dirName()}
        </span>
      </Show>
      {/* 模型名与思考强度不再显示在这里：输入框底栏已经有同一组控件，
          而且那才是真正能改的地方 —— 顶栏这份是只读的重复信息，还挤占标题宽度。 */}
      <div class="flex-1" />
      <Show when={settings.general.showTerminal()}>
        <IconButton
          icon="terminal"
          title={language.t("workspace.header.terminal")}
          variant="ghost"
          disabled={!workspaceAvailable()}
          aria-expanded={sessionLayout.view().terminal.opened()}
          onClick={() => sessionLayout.view().terminal.toggle()}
          class={sessionLayout.view().terminal.opened() ? "text-interactive-base" : ""}
        />
      </Show>
      {/* 搜索、连接状态、在编辑器中打开、Side Pane 开关原先被 Portal 塞进全局标题栏，
          现在就地渲染在这里（操作都在会话帧的 Header 里）。 */}
      <WorkflowStatus />
      <SessionHeader />
      <DropdownMenu>
        <DropdownMenu.Trigger
          as={IconButton}
          icon="dot-grid"
          variant="ghost"
          aria-label={language.t("workspace.header.more")}
        />
        <DropdownMenu.Portal>
          <DropdownMenu.Content>
            <DropdownMenu.Item
              onSelect={() => {
                void navigator.clipboard.writeText(directory())
              }}
            >
              <DropdownMenu.ItemLabel>{language.t("workspace.header.copyPath")}</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
            <DropdownMenu.Item
              onSelect={() => {
                void navigator.clipboard.writeText(session()?.title ?? directory())
              }}
            >
              <DropdownMenu.ItemLabel>{language.t("workspace.header.copyTitle")}</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
      {/* 窗控归「最右侧面板」的 header，且必须是**最靠右**的一组图标按钮
          （用户明确要求）。Side Pane 展开时改由它的 header 承载，见 session-side-panel。 */}
      <Show when={!layout.sidePane.opened()}>
        <WindowControls />
      </Show>
    </div>
  )
}
