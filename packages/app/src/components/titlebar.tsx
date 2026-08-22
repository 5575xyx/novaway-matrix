import { createEffect, createMemo, Show, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { useLocation, useNavigate } from "@solidjs/router"
import { IconButton } from "@novaway/ui/icon-button"
import { Icon } from "@novaway/ui/icon"
import { Button } from "@novaway/ui/button"
import { Tooltip, TooltipKeybind } from "@novaway/ui/tooltip"
import { useTheme } from "@novaway/ui/theme/context"

import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import { applyPath, backPath, forwardPath } from "./titlebar-history"
import { ModeSwitchButton } from "@/components/mode-switch"
import { MemoryEvolutionPanel } from "@/components/memory-evolution-panel"
import { CacheUsagePanel } from "@/components/cache-usage-panel"
import { ThemeSchemeToggle } from "@/components/theme-scheme-toggle"

type TauriDesktopWindow = {
  startDragging?: () => Promise<void>
  toggleMaximize?: () => Promise<void>
}

type TauriThemeWindow = {
  setTheme?: (theme?: "light" | "dark" | null) => Promise<void>
}

type TauriApi = {
  window?: {
    getCurrentWindow?: () => TauriDesktopWindow
  }
  webviewWindow?: {
    getCurrentWebviewWindow?: () => TauriThemeWindow
  }
}

const tauriApi = () => (window as unknown as { __TAURI__?: TauriApi }).__TAURI__
const currentDesktopWindow = () => tauriApi()?.window?.getCurrentWindow?.()
const currentThemeWindow = () => tauriApi()?.webviewWindow?.getCurrentWebviewWindow?.()
const titlebarHeight = 50
const minTitlebarZoom = 0.25
const windowsControlsBaseWidth = 138 // 3 native Windows caption buttons at 46px each.

export function Titlebar(props: { settingsOpen?: boolean; databaseOpen?: boolean }) {
  const layout = useLayout()
  const platform = usePlatform()
  const command = useCommand()
  const language = useLanguage()
  const theme = useTheme()
  const navigate = useNavigate()
  const location = useLocation()
  const settings = useSettings()

  const mac = createMemo(() => platform.platform === "desktop" && platform.os === "macos")
  const windows = createMemo(() => platform.platform === "desktop" && platform.os === "windows")
  const zoom = () => platform.webviewZoom?.() ?? 1
  const titlebarZoom = () => (windows() ? Math.max(zoom(), minTitlebarZoom) : zoom())
  const counterZoom = () => (windows() && titlebarZoom() < 1 ? 1 / titlebarZoom() : 1)
  const minHeight = () => {
    if (mac()) return `${titlebarHeight / zoom()}px`
    if (windows()) return `${titlebarHeight / Math.min(titlebarZoom(), 1)}px`
    return undefined
  }
  const windowsControlsWidth = () => `${windowsControlsBaseWidth / Math.max(titlebarZoom(), 1)}px`

  const [history, setHistory] = createStore({
    stack: [] as string[],
    index: 0,
    action: undefined as "back" | "forward" | undefined,
  })

  const path = () => `${location.pathname}${location.search}${location.hash}`
  const canBack = createMemo(() => history.index > 0)
  const canForward = createMemo(() => history.index < history.stack.length - 1)
  const nav = createMemo(() => settings.general.showNavigation())

  createEffect(() => {
    const current = path()

    untrack(() => {
      const next = applyPath(history, current)
      if (next === history) return
      setHistory(next)
    })
  })

  const back = () => {
    const next = backPath(history)
    if (!next) return
    setHistory(next.state)
    navigate(next.to)
  }

  const forward = () => {
    const next = forwardPath(history)
    if (!next) return
    setHistory(next.state)
    navigate(next.to)
  }

  const goModeHome = () => {
    layout.mode.reset()
    navigate("/")
  }

  command.register(() => [
    {
      id: "common.goBack",
      title: language.t("common.goBack"),
      category: language.t("command.category.view"),
      keybind: "mod+[",
      onSelect: back,
    },
    {
      id: "common.goForward",
      title: language.t("common.goForward"),
      category: language.t("command.category.view"),
      keybind: "mod+]",
      onSelect: forward,
    },
  ])

  const getWin = () => {
    if (platform.platform !== "desktop") return
    return currentDesktopWindow()
  }

  createEffect(() => {
    if (platform.platform !== "desktop") return

    const scheme = theme.colorScheme()
    const value = scheme === "system" ? null : scheme

    const win = currentThemeWindow()
    if (!win?.setTheme) return

    void win.setTheme(value).catch(() => undefined)
  })

  const interactive = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return false

    const selector =
      "button, a, input, textarea, select, option, [role='button'], [role='menuitem'], [contenteditable='true'], [contenteditable='']"

    return !!target.closest(selector)
  }

  const drag = (e: MouseEvent) => {
    if (platform.platform !== "desktop") return
    if (e.buttons !== 1) return
    if (interactive(e.target)) return

    const win = getWin()
    if (!win?.startDragging) return

    e.preventDefault()
    void win.startDragging().catch(() => undefined)
  }

  const maximize = (e: MouseEvent) => {
    if (platform.platform !== "desktop") return
    if (interactive(e.target)) return
    if (e.target instanceof Element && e.target.closest("[data-tauri-decorum-tb]")) return

    const win = getWin()
    if (!win?.toggleMaximize) return

    e.preventDefault()
    void win.toggleMaximize().catch(() => undefined)
  }

  const pageOpen = () => props.settingsOpen || props.databaseOpen

  return (
    <header
      class="h-[50px] shrink-0 bg-background-base/90 backdrop-blur-md relative overflow-hidden titlebar-gradient-border"
      style={{
        "min-height": minHeight(),
        "background-color": pageOpen() ? "var(--background-base)" : undefined,
        "border-bottom": pageOpen() ? "1px solid var(--border-weak-base)" : undefined,
      }}
      data-tauri-drag-region
      onMouseDown={drag}
      onDblClick={maximize}
    >
      <div
        class="grid h-full min-h-full w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center"
        style={{ zoom: counterZoom() }}
      >
        <div
          classList={{
            "flex items-center min-w-0": true,
            "pl-2": !mac(),
          }}
        >
          <Show when={mac()}>
            <div class="h-full shrink-0" style={{ width: `${72 / zoom()}px` }} />
            <Show when={layout.mode.hasSelected()}>
              <div class="xl:hidden w-10 shrink-0 flex items-center justify-center">
                <IconButton
                  icon="menu"
                  variant="ghost"
                  class="titlebar-icon rounded-lg hover:bg-surface-base-hover transition-all duration-150 hover:scale-105"
                  onClick={layout.mobileSidebar.toggle}
                  aria-label={language.t("sidebar.menu.toggle")}
                  aria-expanded={layout.mobileSidebar.opened()}
                />
              </div>
            </Show>
          </Show>
          <Show when={!mac() && layout.mode.hasSelected()}>
            <div class="xl:hidden w-[48px] shrink-0 flex items-center justify-center">
              <IconButton
                icon="menu"
                variant="ghost"
                class="titlebar-icon rounded-lg hover:bg-surface-base-hover transition-all duration-150 hover:scale-105"
                onClick={layout.mobileSidebar.toggle}
                aria-label={language.t("sidebar.menu.toggle")}
                aria-expanded={layout.mobileSidebar.opened()}
              />
            </div>
          </Show>
          <div class="flex items-center gap-1 min-w-0">
            <Show when={nav()}>
              <div class="flex items-center gap-0">
                <Tooltip placement="bottom" value={language.t("common.goBack")}>
                  <Button
                    variant="ghost"
                    class="titlebar-icon w-8 h-8 p-0 box-border rounded-xl text-icon-base hover:bg-surface-base-hover transition-all duration-150 hover:scale-105"
                    disabled={!canBack()}
                    onClick={back}
                    aria-label={language.t("common.goBack")}
                  >
                    <Icon size="small" name="chevron-left" />
                  </Button>
                </Tooltip>
                <Tooltip placement="bottom" value={language.t("common.goForward")}>
                  <Button
                    variant="ghost"
                    class="titlebar-icon w-8 h-8 p-0 box-border rounded-xl text-icon-base hover:bg-surface-base-hover transition-all duration-150 hover:scale-105"
                    disabled={!canForward()}
                    onClick={forward}
                    aria-label={language.t("common.goForward")}
                  >
                    <Icon size="small" name="chevron-right" />
                  </Button>
                </Tooltip>
              </div>
            </Show>
            <Tooltip placement="bottom" value="模式首页">
              <Button
                variant="ghost"
                class="titlebar-icon ml-2 w-8 h-8 p-0 box-border rounded-xl text-icon-base hover:bg-surface-base-hover transition-all duration-150 hover:scale-105"
                onClick={goModeHome}
                aria-label="模式首页"
                aria-current={!layout.mode.hasSelected() ? "page" : undefined}
              >
                <Icon size="small" name="home" />
              </Button>
            </Tooltip>
            <TooltipKeybind
              placement="bottom"
              title={language.t("command.settings.open")}
              keybind={command.keybind("settings.open")}
            >
              <Button
                variant="ghost"
                class="titlebar-icon w-8 h-8 p-0 box-border rounded-xl text-icon-base hover:bg-surface-base-hover transition-all duration-150 hover:scale-105"
                onClick={() => command.trigger("settings.open")}
                aria-label={language.t("command.settings.open")}
              >
                <Icon size="small" name="settings-gear" />
              </Button>
            </TooltipKeybind>
            <Show when={settings.general.showDatabase()}>
              <TooltipKeybind
                placement="bottom"
                title={language.t("command.database.open")}
                keybind={command.keybind("database.open")}
              >
                <Button
                  variant="ghost"
                  class="titlebar-icon w-8 h-8 p-0 box-border rounded-xl text-icon-base hover:bg-surface-base-hover transition-all duration-150 hover:scale-105"
                  onClick={() => command.trigger("database.open")}
                  aria-label={language.t("command.database.open")}
                >
                  <Icon size="small" name="database" />
                </Button>
              </TooltipKeybind>
            </Show>
            <div id="NovaWay-titlebar-session-actions" class="flex flex-row items-center gap-1 shrink-0" />
            <div id="NovaWay-titlebar-search" class="ml-2 hidden min-w-0 shrink md:flex" />
          </div>
        </div>

        <div class="min-w-0 flex items-center justify-center pointer-events-none">
          <Show when={layout.mode.hasSelected()}>
            <div class="pointer-events-auto min-w-0 flex justify-center w-fit max-w-full">
              <ModeSwitchButton
                current={layout.mode.current()}
                modes={layout.mode.all}
                expanded
                onSelect={(mode) => layout.mode.select(mode)}
              />
            </div>
          </Show>
        </div>

        <div
          classList={{
            "flex items-center min-w-0 justify-end": true,
            "pr-2": !windows(),
          }}
          data-tauri-drag-region
          onMouseDown={drag}
        >
          <div class="flex items-center gap-1 shrink-0 justify-end">
            <div id="NovaWay-titlebar-right" class="flex items-center gap-1 shrink-0 justify-end" />
            <CacheUsagePanel />
            <MemoryEvolutionPanel />
            <ThemeSchemeToggle />
          </div>
          <Show when={windows()}>
            {!tauriApi() && <div class="shrink-0" style={{ width: windowsControlsWidth() }} />}
            <div data-tauri-decorum-tb class="flex flex-row" />
          </Show>
        </div>
      </div>
    </header>
  )
}
