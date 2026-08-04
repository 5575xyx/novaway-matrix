import {
  AppBaseProviders,
  AssistantPanel,
  PlatformProvider,
  type AgentItem,
  type PetSkin,
  type PetNotification,
  type Task,
  type TaskEvent,
  type TaskGroup,
} from "@opencode-ai/app"
import { createEffect, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { render } from "solid-js/web"
import { initI18n, t } from "./i18n"
import { createPlatform, listenForDeepLinks } from "./platform"
import "@opencode-ai/app/index.css"
import "./styles.css"
import logoUrl from "./novaway-icon.svg"

const root = document.getElementById("root")
const query = new URLSearchParams(window.location.search)
const panelOnly = query.has("panel")
const skinOnly = query.has("skin")
const initialPanelTab = query.get("tab") === "notifications" ? "notifications" : "monitor"
if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error(t("error.dev.rootNotFound"))
}

void initI18n()
listenForDeepLinks()

const skinOptions: Array<{ id: PetSkin; label: string; color: string }> = [
  { id: "snow", label: "雪白", color: "#f8fafc" },
  { id: "honey", label: "金橙", color: "#f59e0b" },
  { id: "ash", label: "银灰", color: "#94a3b8" },
  { id: "aurora", label: "翡翠", color: "#34d399" },
  { id: "violet", label: "紫罗兰", color: "#a78bfa" },
  { id: "crimson", label: "绯红", color: "#fb7185" },
]

const SkinMenu = (props: { skin: PetSkin; onChange: (skin: PetSkin) => void }) => (
  <div
    class="h-full w-full border p-3 shadow-2xl"
    style={{
      "background-color": "light-dark(#f8fbff,#0b1020)",
      "border-color": "light-dark(rgba(8,145,178,.24),#263249)",
    }}
  >
    <div class="pb-2.5 mb-2 border-b" style={{ "border-color": "light-dark(rgba(8,145,178,.18),#263249)" }}>
      <div class="text-12-medium text-text-strong">外观配色</div>
      <div class="mt-0.5 text-10-regular text-text-weak">科技挂饰与核心光效</div>
    </div>
    <div class="grid grid-cols-3 gap-2">
      <For each={skinOptions}>
        {(skin) => (
          <button
            type="button"
            title={skin.label}
            class={`flex h-15 flex-col items-center justify-center gap-1 border text-10-medium transition-all ${props.skin === skin.id ? "border-cyan-400 bg-cyan-400/10 shadow-[0_0_10px_rgba(34,211,238,.16)]" : "border-border-weaker-base hover:border-cyan-400/60 hover:bg-surface-raised-base-hover"}`}
            onClick={() => props.onChange(skin.id)}
          >
            <span
              class="size-6 shrink-0 rounded-full border border-white/60"
              style={{ "background-color": skin.color, "box-shadow": `0 0 9px ${skin.color}` }}
            />
            <span class="max-w-full truncate px-1 text-text-base">{skin.label}</span>
          </button>
        )}
      </For>
      <label
        class="col-span-3 mt-1 flex h-10 items-center gap-3 border-t pt-2 text-11-medium text-text-strong cursor-pointer"
        style={{ "border-color": "light-dark(rgba(8,145,178,.18),#263249)" }}
      >
        <span class="flex-1">自定义颜色</span>
        <input
          type="color"
          class="size-8 shrink-0 cursor-pointer border border-white/50 bg-transparent p-0"
          value={props.skin.startsWith("#") ? props.skin : "#22d3ee"}
          onInput={(event) => props.onChange(event.currentTarget.value as PetSkin)}
        />
      </label>
    </div>
  </div>
)

render(() => {
  const platform = createPlatform()
  const [sidecar] = createResource(() => window.api.awaitInitialization(() => undefined))
  let panelVisible = false
  const [panelOpening, setPanelOpening] = createSignal(false)
  const [skinMenuOpening, setSkinMenuOpening] = createSignal(false)
  const [currentAgent, setCurrentAgent] = createSignal<string | undefined>(undefined)
  const [agents, setAgents] = createSignal<AgentItem[]>([])
  const [tasks, setTasks] = createSignal<Task[]>([])
  const [taskGroups, setTaskGroups] = createSignal<TaskGroup[]>([])
  const [currentTaskGroupID, setCurrentTaskGroupID] = createSignal<string | undefined>(undefined)
  const [taskEvents, setTaskEvents] = createSignal<TaskEvent[]>([])
  const [notifications, setNotifications] = createSignal<PetNotification[]>([])
  const [petSkin, setPetSkin] = createSignal<PetSkin>("snow")
  const [widgetVisible, setWidgetVisible] = createSignal(false)
  const [widgetListenersReady, setWidgetListenersReady] = createSignal(false)
  const [panelTab, setPanelTab] = createSignal<"monitor" | "notifications">(initialPanelTab)
  const [minimalMode, setMinimalMode] = createSignal<boolean>(false)

  let hasActiveTasks = false
  let userDismissedActiveTasks = false

  const applyState = (state: Awaited<ReturnType<typeof window.api.getFloatingAgentState>>) => {
    setCurrentAgent(state.current)
    setAgents(state.agents)
    setTasks((state.tasks as Task[] | undefined) ?? [])
    setTaskGroups((state.taskGroups as TaskGroup[] | undefined) ?? [])
    setCurrentTaskGroupID(state.currentTaskGroupID)
    setTaskEvents((state.taskEvents as TaskEvent[] | undefined) ?? [])
    setNotifications((state.notifications as PetNotification[] | undefined) ?? [])
    setPetSkin(state.petSkin ?? "snow")
    const activeTasks = ((state.taskGroups?.flatMap((group) => group.tasks) ?? state.tasks ?? []) as Task[]).some(
      (task) => task.status !== "completed" && task.status !== "cancelled",
    )
    if (!activeTasks) userDismissedActiveTasks = false
    if (!panelOnly && !skinOnly && activeTasks && !hasActiveTasks && !userDismissedActiveTasks) {
      panelVisible = true
      setPanelOpening(true)
      void window.api.setFloatingExpanded(true)
    }
    hasActiveTasks = activeTasks
  }

  const refreshState = async () => {
    applyState(await window.api.getFloatingAgentState())
  }

  onMount(() => {
    void refreshState()

    const cleanupAgent = window.api.onFloatingAgentChange?.((state) => {
      applyState(state)
    })
    const cleanupExpanded = window.api.onFloatingExpandedChange?.((expanded) => {
      if (panelOnly) return
      panelVisible = expanded
      if (!expanded && hasActiveTasks) userDismissedActiveTasks = true
      setPanelOpening(false)
    })
    const cleanupPanelTab = window.api.onFloatingPanelTabChange?.((tab) => {
      if (!panelOnly) return
      setPanelTab(tab)
    })
    const cleanupSkinMenu = window.api.onFloatingSkinMenuChange?.(() => {
      if (skinOnly) return
      setSkinMenuOpening(false)
    })
    const cleanupVisibility = window.api.onFloatingVisibilityChange?.((visible) => {
      if (panelOnly || skinOnly) return
      setWidgetVisible(visible)
    })
    const cleanupModeChange = window.api.onFloatingModeChange?.((mode: "full" | "minimal") => {
      if (panelOnly || skinOnly) return
      setMinimalMode(mode === "minimal")
    })
    setWidgetListenersReady(true)

    // 命中与穿透由主进程轮询；进入热区时切换抓取光标
    const applyCursor = (active: boolean) => {
      const value = active ? "grab" : ""
      document.documentElement.style.cursor = value
      document.body.style.cursor = value
      root?.style.setProperty("cursor", value)
    }
    const cleanupCursor = window.api.onFloatingCursorActive?.((active) => {
      applyCursor(active)
    })

    onCleanup(() => {
      cleanupAgent?.()
      cleanupExpanded?.()
      cleanupPanelTab?.()
      cleanupSkinMenu?.()
      cleanupVisibility?.()
      cleanupModeChange?.()
      cleanupCursor?.()
      applyCursor(false)
    })
  })

  createEffect(() => {
    if (panelOnly || skinOnly || !widgetListenersReady() || !sidecar()) return
    window.api.floatingWidgetReady?.()
  })

  const current = () => agents().find((item) => item.name === currentAgent())
  const orderedTaskGroups = () =>
    [...taskGroups()].sort(
      (a, b) =>
        Number(b.id === currentTaskGroupID()) - Number(a.id === currentTaskGroupID()) ||
        (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
    )
  const monitorSummary = () => {
    const activeGroups = orderedTaskGroups().filter((group) =>
      group.tasks.some((task) => task.status !== "completed" && task.status !== "cancelled"),
    )
    if (activeGroups.length === 0) return undefined
    const all = activeGroups.flatMap((group) => group.tasks)
    const active = all.filter((task) => task.status === "in_progress").length
    const pending = all.filter((task) => task.status === "pending").length
    const completed = all.filter((task) => task.status === "completed").length
    return t("assistant.thought.taskStatus", { active, pending, completed, total: all.length })
  }
  const applyPetSkin = (skin: PetSkin) => {
    setPetSkin(skin)
    void window.api.setFloatingPetSkin(skin)
  }
  const unreadNotifications = () => notifications().filter((notification) => !notification.read).length
  const markNotificationsRead = (ids?: string[]) => {
    void window.api.markFloatingNotificationsRead?.(ids)
  }
  const clearReadNotifications = () => {
    void window.api.clearFloatingNotifications()
  }
  const openNotification = (notification: PetNotification) => {
    void window.api.openFloatingNotification(notification.id)
  }

  const handleMinimalClick = () => {
    if (!minimalMode()) return
    void window.api.setFloatingExpanded(true)
  }

  const toggleExpand = () => {
    if (panelOnly) {
      void window.api.setFloatingExpanded(false)
      return
    }

    panelVisible = !panelVisible
    if (!panelVisible && hasActiveTasks) userDismissedActiveTasks = true
    if (panelVisible) userDismissedActiveTasks = false
    setPanelOpening(panelVisible)
    void window.api.setFloatingExpanded(panelVisible)
  }

  return (
    <PlatformProvider value={platform}>
      <AppBaseProviders>
        <Show when={sidecar()}>
          <Show when={minimalMode()}>
            <div
              class="w-full h-full flex items-center justify-center"
              onClick={handleMinimalClick}
              title="打开 NovaWay"
            >
              <div class="size-10 rounded-full bg-cyan-500/20 border border-cyan-400/40 flex items-center justify-center hover:bg-cyan-500/30 transition-colors">
                <img src={logoUrl} alt="NovaWay" class="size-7 object-contain" draggable={false} />
              </div>
            </div>
          </Show>
          <Show when={!minimalMode()}>
            <div
              class={
                skinOnly || panelOnly
                  ? "w-full h-full"
                  : `w-full h-full bg-transparent flex items-end justify-center p-4 ${
                      widgetVisible() ? "nova-floating-widget-enter" : "nova-floating-widget-pending"
                    }`
              }
            >
              <Show
                when={skinOnly}
                fallback={
                  <AssistantPanel
                    class={panelOnly ? "" : "relative"}
                    currentAgent={current()}
                    agents={agents()}
                    tasks={tasks()}
                    taskGroups={orderedTaskGroups()}
                    currentTaskGroupID={currentTaskGroupID()}
                    monitorSummary={monitorSummary()}
                    taskEvents={taskEvents()}
                    notifications={notifications()}
                    onNotificationsRead={markNotificationsRead}
                    onNotificationsClearRead={clearReadNotifications}
                    onNotificationOpen={openNotification}
                    initialTab={panelOnly ? panelTab() : undefined}
                    expanded={panelOnly}
                    onExpandToggle={toggleExpand}
                    onAgentChange={(name) => {
                      void window.api.setFloatingAgent(name)
                      setCurrentAgent(name)
                    }}
                    petSkin={petSkin()}
                    onPetSkinChange={applyPetSkin}
                    onSkinMenuToggle={() => {
                      setSkinMenuOpening(true)
                      void window.api.toggleFloatingSkinMenu()
                    }}
                    opening={panelOpening() || skinMenuOpening()}
                    onDragStart={(pointerX, pointerY) => {
                      if (panelOnly) return
                      window.api.beginFloatingWidgetDrag?.(pointerX, pointerY)
                    }}
                    onDragMove={(pointerX, pointerY) => {
                      if (panelOnly) return
                      if (!("beginFloatingWidgetDrag" in window.api)) return
                      window.api.moveFloatingWidget(pointerX, pointerY)
                    }}
                    onDragEnd={() => {
                      if (panelOnly) return
                      void window.api.saveFloatingWidgetBounds()
                    }}
                    title={t("assistant.title")}
                    hasInProgressTask={hasActiveTasks}
                    unreadNotifications={unreadNotifications()}
                    draggable={!panelOnly}
                    panelOnly={panelOnly}
                  />
                }
              >
                <SkinMenu skin={petSkin()} onChange={applyPetSkin} />
              </Show>
            </div>
          </Show>
        </Show>
      </AppBaseProviders>
    </PlatformProvider>
  )
}, root!)
