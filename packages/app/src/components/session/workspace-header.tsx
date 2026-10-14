import { Show, createMemo } from "solid-js"
import { useParams } from "@solidjs/router"
import { Button } from "@novaway/ui/button"
import { DropdownMenu } from "@novaway/ui/dropdown-menu"
import { Icon } from "@novaway/ui/icon"
import { IconButton } from "@novaway/ui/icon-button"
import { Select } from "@novaway/ui/select"
import { ModelSelectorPopover } from "@/components/dialog-select-model"
import { SessionHeader } from "@/components/session/session-header"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useLocal } from "@/context/local"
import { useModels } from "@/context/models"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"
import { useSessionLayout } from "@/pages/session/session-layout"
import { decode64 } from "@/utils/base64"
import { displaySessionTitle } from "@/utils/session-title"

export function WorkspaceHeader() {
  const params = useParams()
  const language = useLanguage()
  const layout = useLayout()
  const globalSync = useGlobalSync()
  const modelsCtx = useModels()
  const local = useLocal()
  const sessionLayout = useSessionLayout()
  const settings = useSettings()
  // 运行平台（"desktop" = Electron 壳），不是视口宽度。会话页里那个 `isDesktop()` 是
  // createMediaQuery("(min-width: 768px)")，两者含义完全不同，别混用。
  const platform = usePlatform()
  const isWindowsDesktop = createMemo(() => platform.platform === "desktop" && platform.os === "windows")
  const isMacDesktop = createMemo(() => platform.platform === "desktop" && platform.os === "macos")
  // 侧栏收起时，macOS 的红绿灯 / Windows 的原生窗控会压到会话帧这一行上，需要让出安全区。
  const reserveWindowControls = createMemo(() => !layout.sidebar.expanded())
  const directory = createMemo(() => decode64(params.dir) ?? "")
  const sessionStore = createMemo(() => (directory() ? globalSync.child(directory())[0] : undefined))
  const session = createMemo(() => sessionStore()?.session.find((s) => s.id === params.id))
  const variants = createMemo(() => ["default", ...local.model.variant.list()])
  const working = createMemo(() => {
    const id = session()?.id
    const store = sessionStore()
    return id && store ? store.session_working(id) : false
  })
  const dirName = createMemo(() => directory().split(/[\\/]/).filter(Boolean).pop() ?? directory())
  const branch = createMemo(() => sessionStore()?.vcs?.branch ?? "")

  return (
    <div
      data-component="workspace-header"
      // 对齐 ZCode WorkspaceHeader：h-12、border-b border-border/50、左侧标题区 + 右侧操作区，
      // 整条 header 自己就是窗口拖拽区（子元素靠 data-window-drag 的 CSS 规则自动排除拖拽）。
      // 桌面端不再有全局标题栏，这个 header 就是窗口顶部的唯一可拖动区域。
      classList={{
        "flex h-12 shrink-0 items-center gap-2 border-b border-border-weaker-base px-2 select-none": true,
        // Windows 原生 titleBarOverlay 占右上角 138px（3 × 46px），不预留会盖住操作区。
        "pr-[138px]": isWindowsDesktop() && reserveWindowControls(),
        // macOS 红绿灯在左上角，侧栏收起时它压在会话帧这一行上。
        "pl-[78px]": isMacDesktop() && reserveWindowControls(),
      }}
      data-window-drag
    >
      {/* 侧栏收起时，展开入口归 Header（对齐 ZCode：收起态由 Header 承载展开按钮，
          展开态收起入口在侧栏顶带）。放在 Header 行内而不是浮层，才不会压住标题、
          也有 32px 的正常点击区。 */}
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
        aria-expanded={layout.mobileSidebar.opened()}
        onClick={layout.mobileSidebar.toggle}
      />
      <Show when={working()}>
        <span class="size-2 rounded-full bg-[var(--border-success-selected)] animate-pulse shrink-0" />
      </Show>
      <span class="text-ui-base font-medium text-text-strong truncate max-w-[240px]">
        {displaySessionTitle(session()?.title, language.t("workspace.header.untitled"))}
      </span>
      <span class="text-ui-xs text-text-weak truncate max-w-[180px] hidden md:block border border-border-weak-base rounded-md px-1.5 py-0.5">
        {branch() ? language.t("workspace.header.projectBranch", { project: dirName(), branch: branch() }) : dirName()}
      </span>
      <Show when={modelsCtx.autoMode() || local.model.current()}>
        <div data-component="workspace-model" class="min-w-0">
          <ModelSelectorPopover
            model={local.model}
            triggerAs={Button}
            triggerProps={{
              variant: "ghost",
              size: "normal",
              class: "text-ui-caption text-text-strong max-w-[150px] min-w-0 truncate",
            }}
          >
            <span class="truncate">
              {modelsCtx.autoMode() ? "Auto" : (local.model.current()?.name ?? language.t("dialog.model.select.title"))}
            </span>
            <Icon name="chevron-down" size="small" class="shrink-0" />
          </ModelSelectorPopover>
        </div>
      </Show>
      <Show when={!modelsCtx.autoMode() && variants().length > 2}>
        <Select
          size="small"
          options={variants()}
          current={local.model.variant.current() ?? "default"}
          label={(x) => language.t("workspace.header.variant." + x)}
          onSelect={(value) => local.model.variant.set(value === "default" ? undefined : value)}
          variant="ghost"
          class="text-ui-caption max-w-[120px]"
        />
      </Show>
      <div class="flex-1" />
      <Show when={settings.general.showTerminal()}>
        <IconButton
          icon="terminal"
          title={language.t("workspace.header.terminal")}
          variant="ghost"
          aria-expanded={sessionLayout.view().terminal.opened()}
          onClick={() => sessionLayout.view().terminal.toggle()}
          class={sessionLayout.view().terminal.opened() ? "text-text-interactive-base" : ""}
        />
      </Show>
      {/* 搜索、连接状态、在编辑器中打开、Side Pane 开关原先被 Portal 塞进全局标题栏，
          现在就地渲染在这里（同样对齐 ZCode：操作都在会话帧的 Header 里）。 */}
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
    </div>
  )
}
