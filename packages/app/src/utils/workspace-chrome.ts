import type { Platform } from "@/context/platform"

/**
 * 布局面板圆角（侧栏 / 会话 / 终端 / Side Pane 四帧共用一格同心圆）。
 *
 * 取值来源：ZCode `docs/design/workspace-independent-panels.md` —— Windows 5px、
 * macOS Sequoia(15) 及更早 6px、Tahoe(26)+ 12px、Linux 与 Web 用 xl（12px）。
 *
 * 已知限制：ZCode 通过 `IPlatformService.getDesktopWindowChromeState` 查询 macOS 系统版本，
 * NovaWay 的 `Platform` 只有 `os`，拿不到系统版本，所以 macOS 一律走「旧系统」分支的 6px。
 * Tahoe 的 12px 需要先给 preload 加窗口状态查询，留待后续轮次。
 */
export function workspacePanelRadiusPx(os: Platform["os"]): number {
  if (os === "windows") return 5
  if (os === "macos") return 6
  return 12
}
