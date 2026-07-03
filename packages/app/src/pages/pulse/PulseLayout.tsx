import { createMemo, onMount, Show, createSignal, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useLayout, appModeConfig } from "@/context/layout"
import { PlatformAccountsProvider, usePlatformAccounts } from "@/context/platform-accounts"
import { persisted } from "@/utils/persist"
import { PulseSidebar } from "./PulseSidebar"
import { PulseMain } from "./PulseMain"
import { PulseAssistant } from "./PulseAssistant"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"

function PulseLayoutInner() {
  const layout = useLayout()
  const modeColor = createMemo(() => appModeConfig(layout.mode.current())?.color ?? "#FF6B6B")
  const platform = usePlatformAccounts()
  const [mounted, setMounted] = createSignal(false)

  // AI运营助手面板状态
  const [assistant, setAssistant, _, assistantReady] = persisted(
    "pulse.assistant",
    createStore({
      width: 480,
      collapsed: false,
    }),
  )

  const assistantWidth = () => assistant.width
  const assistantCollapsed = () => assistant.collapsed

  const handleCollapse = () => {
    setAssistant({ width: 480, collapsed: true })
  }

  const handleExpand = () => {
    setAssistant({ width: assistant.width, collapsed: false })
  }

  const handleResize = (width: number) => {
    setAssistant({ width, collapsed: assistant.collapsed })
  }

  onMount(() => {
    platform.refreshAccounts()
    platform.refreshGroups()
    requestAnimationFrame(() => setMounted(true))
  })

  return (
    <div class="flex h-full w-full bg-background-base transition-opacity duration-300"
      style={{
        "opacity": mounted() ? "1" : "0",
        "--novaway-mode-color": modeColor(),
      } as any}>
      <div class="w-64 shrink-0 border-r border-border-weak-base bg-background-weak/60">
        <PulseSidebar />
      </div>
      <div class="flex-1 min-w-0 overflow-auto">
        <PulseMain />
      </div>
      <Show when={!assistantCollapsed()}>
        <div 
          class="shrink-0 border-l border-border-weak-base bg-background-weak/60 relative"
          style={{ width: `${assistantWidth()}px` }}
        >
          <PulseAssistant />
          <ResizeHandle
            direction="horizontal"
            edge="start"
            size={assistantWidth()}
            min={200}
            max={600}
            collapseThreshold={480}
            onResize={handleResize}
            onCollapse={handleCollapse}
            class="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-border-interactive-base transition-colors"
          />
        </div>
      </Show>
      <Show when={assistantCollapsed()}>
        <div 
          class="shrink-0 border-l border-border-weak-base bg-background-weak/60 flex items-center justify-center cursor-pointer hover:bg-background-weak/80 transition-colors"
          style={{ width: "24px" }}
          onClick={handleExpand}
        >
          <svg class="w-4 h-4 text-text-weak" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
        </div>
      </Show>
    </div>
  )
}

export default function PulseLayout() {
  return (
    <PlatformAccountsProvider>
      <PulseLayoutInner />
    </PlatformAccountsProvider>
  )
}
