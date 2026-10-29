import { Show, createMemo } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { IconButton } from "@novaway/ui/icon-button"
import { Mark } from "@novaway/ui/logo"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { WindowControls } from "@/components/window-controls"

/**
 * 首页顶部条。
 *
 * 桌面端移除了全局标题栏（`layout.tsx:2782`），窗体身份全靠两条顶带承载：
 *  - `sidebar-top-band`（`layout.tsx:2337`）：NovaWay 品牌 + 折叠按钮，**在侧栏里**
 *  - `WorkspaceHeader`（会话页）：展开侧栏 + NovaWay 品牌（折叠态）+ 自绘 `WindowControls`
 *
 * 首页（TaskCenterPage / OfficeHomeWorkspace）原本**没有任何**顶部条 —— 展开态下
 * sidebar-top-band 只显示品牌+折叠，窗控完全没有；折叠态下 sidebar-top-band 宽度归 0，
 * 品牌+折叠+窗控全部消失，用户失去「回首页 / 展开侧栏 / 关掉窗口」的所有入口。
 *
 * 这个组件补齐那两块：
 *  - 展开态：只显示 `WindowControls`（左侧内容被 sidebar-top-band 遮住也无所谓，因为
 *    sidebar 是 `absolute` 定位盖在 main 之上）
 *  - 折叠态：显示 NovaWay 品牌（点击 `navigate("/")` 保持「品牌即回首页」的语义）
 *    + `chevron-right` 展开按钮 + `WindowControls`
 */
export function HomeHeader() {
  const layout = useLayout()
  const language = useLanguage()
  const platform = usePlatform()
  const navigate = useNavigate()
  const isMacDesktop = createMemo(() => platform.platform === "desktop" && platform.os === "macos")
  const collapsed = () => !layout.sidebar.expanded()

  return (
    <div
      data-component="home-header"
      classList={{
        "flex h-12 shrink-0 items-center gap-2 border-b border-border px-2 select-none": true,
        // macOS 红绿灯在左上角。左侧图标条（48px）常驻后，主区从 48px 开始，
        // 只需再让出红绿灯剩下的那段。
        "pl-[30px]": isMacDesktop() && collapsed(),
      }}
      data-window-drag
    >
      <Show when={collapsed()}>
        {/* 品牌字标不再重复：侧栏收起后 logo 仍留在最左侧图标条顶端（rail 常驻），
            这里只保留展开入口，避免同屏出现两个 NovaWay 字标。 */}
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
      {/* 窄视口（<xl）时侧栏整体隐藏，汉堡入口跟 WorkspaceHeader 一致落在这里。 */}
      <IconButton
        icon="menu"
        variant="ghost"
        class="xl:hidden shrink-0"
        aria-label={language.t("sidebar.menu.toggle")}
        aria-expanded={layout.mobileSidebar.opened()}
        onClick={layout.mobileSidebar.toggle}
      />
      <div class="flex-1" />
      <WindowControls />
    </div>
  )
}
