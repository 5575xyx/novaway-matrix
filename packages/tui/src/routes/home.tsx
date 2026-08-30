import { Prompt, type PromptRef } from "../component/prompt"
import { batch, createEffect, createMemo, createSignal, Match, onMount, Show, Switch } from "solid-js"
import { RGBA } from "@opentui/core"
import path from "node:path"
import { EmptySessionHero } from "../component/empty-session-hero"
import { TabBar, type TabItem } from "../component/tab-bar"
import { FilePreview } from "../component/file-preview"
import { useSync } from "../context/sync"
import { Toast } from "../ui/toast"
import { useArgs } from "../context/args"
import { useRouteData } from "../context/route"
import { usePromptRef } from "../context/prompt"
import { useLocal } from "../context/local"
import { usePluginRuntime } from "../plugin/runtime"
import { useEditorContext } from "../context/editor"
import { useTerminalDimensions } from "@opentui/solid"
import { useTuiConfig } from "../config"
import { useKV } from "../context/kv.tsx"
import { useDialog } from "../ui/dialog"
import { useTheme } from "../context/theme"
import { useTuiPaths } from "../context/runtime"
import { NovaWay_BASE_MODE, useBindings } from "../keymap"
import { Sidebar, SIDEBAR_TABS, cycleSidebarTab, setSidebarTab } from "./session/sidebar"
import { getScrollAcceleration } from "../util/scroll"
import { HomeSessionDestinationProvider, useHomeSessionDestination } from "./home/session-destination"

let once = false
const placeholder = {
  normal: ["修复代码库中的 TODO", "这个项目的技术栈是什么？", "修复失败的测试"],
  shell: ["ls -la", "git status", "pwd"],
}

const homeSidebarBindingCommands = ["session.sidebar.toggle"] as const

export function Home() {
  return (
    <HomeSessionDestinationProvider>
      <HomeBody />
    </HomeSessionDestinationProvider>
  )
}

// 首屏和会话页共用同一套骨架:顶部标签条、中间消息区(空会话时是 Logo + 智能体特征行)、
// 输入框贴底、右侧同一条 42 列侧栏。这样从首屏发出第一条消息进入会话页时,
// 画面结构完全不变,不会跳变。
function HomeBody() {
  const pluginRuntime = usePluginRuntime()
  const sync = useSync()
  const route = useRouteData("home")
  const promptRef = usePromptRef()
  const [ref, setRef] = createSignal<PromptRef | undefined>()
  const args = useArgs()
  const local = useLocal()
  const editor = useEditorContext()
  const dimensions = useTerminalDimensions()
  const tuiConfig = useTuiConfig()
  const kv = useKV()
  const dialog = useDialog()
  const { theme } = useTheme()
  const paths = useTuiPaths()
  const destination = useHomeSessionDestination()
  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))

  // 侧栏可见性完全照会话页的规则(共用同一个 kv 键),所以两边同宽同时出现/隐藏。
  const [sidebar, setSidebar] = kv.signal<"auto" | "hide">("sidebar", "auto")
  const [sidebarOpen, setSidebarOpen] = createSignal(false)
  const [showScrollbar] = kv.signal("scrollbar_visible", false)
  // 预览标签页:和会话页同一套逻辑(单击文件 → 开预览标签,双击 → 引用到输入框)
  const [tabs, setTabs] = createSignal<TabItem[]>([{ id: "chat", title: "聊天", type: "chat", closable: false }])
  const [activeTabId, setActiveTabId] = createSignal<string>("chat")
  const [selectedFile, setSelectedFile] = createSignal<string | null>(null)

  const openPreviewTab = (filePath: string) => {
    const fileName = filePath.split(/[\\/]/).pop() || filePath
    const tabId = `preview-${filePath}`
    if (tabs().some((tab) => tab.id === tabId)) {
      setActiveTabId(tabId)
      setSelectedFile(filePath)
      return
    }
    setTabs((prev) => [...prev, { id: tabId, title: fileName, type: "preview", closable: true, filePath }])
    setActiveTabId(tabId)
    setSelectedFile(filePath)
  }
  const closeTab = (tabId: string) => {
    if (tabId === "chat") return
    setTabs((prev) => prev.filter((tab) => tab.id !== tabId))
    if (activeTabId() === tabId) {
      setActiveTabId("chat")
      setSelectedFile(null)
    }
  }
  const switchTab = (tabId: string) => {
    setActiveTabId(tabId)
    setSelectedFile(tabId === "chat" ? null : (tabs().find((tab) => tab.id === tabId)?.filePath ?? null))
  }

  const wide = createMemo(() => dimensions().width > 120)
  const sidebarVisible = createMemo(() => {
    if (sidebarOpen()) return true
    if (sidebar() === "auto" && wide()) return true
    return false
  })
  const showSidebar = () => {
    if (sidebarVisible()) return
    batch(() => {
      setSidebar(() => "auto")
      setSidebarOpen(true)
    })
  }
  // 输入框宽度默认跟会话页一样占满内容列(不再钉 75 列),只有用户显式配了
  // prompt.max_width 才收窄 —— 否则首屏和会话页的输入框宽度会不一样,一发消息就跳变。
  const promptMaxWidth = createMemo(() => {
    const configured = tuiConfig.prompt?.max_width
    if (configured === undefined) return undefined
    if (configured === "auto") return Math.max(75, Math.floor(dimensions().width * 0.7))
    return configured
  })

  // 输入框下方那行提示:会话页显示会话目录,首屏显示将要建会话的目录,保持一致。
  const directory = createMemo(() => {
    const target = destination?.destination()
    if (target?.type === "directory") return target.directory
    return sync.path.directory || paths.cwd
  })

  // 侧栏文件树双击 → 插到输入框(和会话页同样的行为,只是根目录取首屏的目标目录)
  const insertFileReference = (filePath: string) => {
    const r = promptRef.current
    if (!r) return
    const relative = path.relative(directory(), filePath)
    r.insertText(`@${relative || filePath} `)
    r.focus()
  }

  const sidebarCommands = createMemo(() => [
    {
      namespace: "palette" as const,
      name: "session.sidebar.toggle",
      title: sidebarVisible() ? "隐藏侧边栏" : "显示侧边栏",
      category: "会话",
      run: () => {
        batch(() => {
          const isVisible = sidebarVisible()
          setSidebar(() => (isVisible ? "hide" : "auto"))
          setSidebarOpen(!isVisible)
        })
        dialog.clear()
      },
    },
    {
      namespace: "palette" as const,
      name: "session.sidebar.cycle",
      title: "侧边栏:切换到下一个面板",
      category: "会话",
      slashName: "sidebar",
      slashAliases: ["侧边栏"],
      run: () => {
        showSidebar()
        cycleSidebarTab()
        dialog.clear()
      },
    },
    ...SIDEBAR_TABS.map((tab) => ({
      namespace: "palette" as const,
      name: `session.sidebar.${tab.id}`,
      title: `侧边栏:${tab.text}`,
      category: "会话",
      run: () => {
        showSidebar()
        setSidebarTab(tab.id)
        dialog.clear()
      },
    })),
  ])

  useBindings(() => ({
    commands: sidebarCommands(),
  }))

  useBindings(() => ({
    mode: NovaWay_BASE_MODE,
    bindings: tuiConfig.keybinds.gather("home", homeSidebarBindingCommands),
  }))

  let sent = false

  onMount(() => {
    editor.clearSelection()
  })

  const bind = (r: PromptRef | undefined) => {
    setRef(r)
    promptRef.set(r)
    if (once || !r) return
    if (route.prompt) {
      r.set(route.prompt)
      once = true
      return
    }
    if (!args.prompt) return
    r.set({ input: args.prompt, parts: [] })
    once = true
  }

  // Wait for sync and model store to be ready before auto-submitting --prompt
  createEffect(() => {
    const r = ref()
    if (sent) return
    if (!r) return
    if (!sync.ready || !local.model.ready) return
    if (!args.prompt) return
    if (r.current.input !== args.prompt) return
    sent = true
    r.submit()
  })

  return (
    <>
      <box flexDirection="row" flexGrow={1} minHeight={0}>
        <Show when={sidebarVisible()}>
          <Switch>
            <Match when={wide()}>
              <Sidebar onFileSelect={openPreviewTab} onFileDoubleClick={insertFileReference} />
            </Match>
            <Match when={!wide()}>
              <box
                position="absolute"
                top={0}
                left={0}
                right={0}
                bottom={0}
                alignItems="flex-start"
                backgroundColor={RGBA.fromInts(0, 0, 0, 70)}
              >
                <Sidebar onFileSelect={openPreviewTab} onFileDoubleClick={insertFileReference} />
              </box>
            </Match>
          </Switch>
        </Show>
        <box flexGrow={1} minHeight={0} flexDirection="column">
          <TabBar tabs={tabs()} activeTabId={activeTabId()} onTabClick={switchTab} onTabClose={closeTab} />
          <box flexGrow={1} minHeight={0} paddingBottom={1} paddingLeft={2} paddingRight={2} gap={1}>
            {/* 消息区(首屏为空):滚动容器的参数和会话页一致,内容是共用的空会话首屏 */}
            <Show when={activeTabId() === "chat"}>
              <scrollbox
                viewportOptions={{ paddingRight: showScrollbar() ? 1 : 0 }}
                verticalScrollbarOptions={{
                  paddingLeft: 1,
                  visible: showScrollbar(),
                  trackOptions: {
                    backgroundColor: theme.backgroundElement,
                    foregroundColor: theme.border,
                  },
                }}
                stickyScroll={true}
                stickyStart="bottom"
                flexGrow={1}
                scrollAcceleration={scrollAcceleration()}
              >
                <box height={1} />
                <pluginRuntime.Slot name="home_logo" mode="replace">
                  <EmptySessionHero />
                </pluginRuntime.Slot>
              </scrollbox>
            </Show>
            <Show when={activeTabId() !== "chat" && selectedFile()}>
              <FilePreview filePath={selectedFile()} onClose={() => closeTab(activeTabId())} />
            </Show>
            <Show when={activeTabId() === "chat"}>
              <box flexShrink={0}>
                <pluginRuntime.Slot name="home_bottom" />
              </box>
              <box flexShrink={0} maxWidth={promptMaxWidth()}>
                <pluginRuntime.Slot name="home_prompt" mode="replace" ref={bind}>
                  <Prompt
                    ref={bind}
                    hint={
                      <box marginLeft={1}>
                        <text fg={theme.textMuted}>{directory()}</text>
                      </box>
                    }
                    right={<pluginRuntime.Slot name="home_prompt_right" />}
                    placeholders={placeholder}
                  />
                </pluginRuntime.Slot>
              </box>
            </Show>
            <Toast />
          </box>
        </box>
      </box>
      {/* 侧栏藏起来的时候(窄屏或手动隐藏)才留这条底栏,否则目录/MCP/版本就全看不到了;
          侧栏一出现,这些信息在侧栏里,底栏就撤掉 —— 和会话页的底部一致。 */}
      <Show when={!sidebarVisible()}>
        <box width="100%" flexShrink={0}>
          <pluginRuntime.Slot name="home_footer" mode="single_winner" />
        </box>
      </Show>
    </>
  )
}
