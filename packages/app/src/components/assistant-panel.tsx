import { Show, For, createSignal, createEffect, onCleanup, onMount, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon } from "@novaway/ui/icon"
import { useSpring } from "@novaway/ui/motion-spring"
import { useLanguage } from "@/context/language"
import { agentColor, agentDisplayName } from "@/utils/agent"

const DRAG_THRESHOLD = 4
const PET_ACTIVITY_RANGE = 80

export type TaskStatus = "pending" | "in_progress" | "completed" | "cancelled"

export type Task = {
  id?: string
  content: string
  status: TaskStatus
  priority: "high" | "medium" | "low"
  startedAt?: number
  completedAt?: number
  durationMs?: number
}

export type TaskGroup = {
  id: string
  label: string
  sessionID: string
  tasks: Task[]
  updatedAt?: number
}

export type TaskEvent = {
  id: string
  groupID: string
  groupLabel: string
  taskContent: string
  status: TaskStatus
  at: number
  durationMs?: number
}

export type PetNotification = {
  id: string
  title: string
  body?: string
  href?: string
  sessionID?: string
  requestID?: string
  status?: "replied" | "dismissed"
  at: number
  read: boolean
}

export type AgentItem = {
  name: string
  mode: string
  hidden?: boolean
  options?: Record<string, unknown>
}

const statusColor = (status: TaskStatus) => {
  switch (status) {
    case "completed":
      return "text-green-500"
    case "in_progress":
      return "text-orange-500"
    case "cancelled":
      return "text-gray-400"
    default:
      return "text-gray-300"
  }
}

const StatusIcon = (props: { status: TaskStatus; class?: string }) => {
  const color = statusColor(props.status)
  const baseClass = `shrink-0 mt-0.5 ${color} ${props.class ?? ""}`

  switch (props.status) {
    case "completed":
      return <Icon name="circle-check" size="small" class={baseClass} />
    case "in_progress":
      return (
        <svg
          class={baseClass}
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="4" />
        </svg>
      )
    case "cancelled":
      return <Icon name="circle-x" size="small" class={baseClass} />
    default:
      return (
        <svg
          class={baseClass}
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
        </svg>
      )
  }
}

type MascotMood = "idle" | "hover" | "active" | "busy"
export type PetSkin = "snow" | "honey" | "ash" | "aurora" | "violet" | "crimson" | `#${string}`
type MascotActivity =
  | "idle"
  | "look"
  | "blink"
  | "ears"
  | "pant"
  | "groom"
  | "tail"
  | "stand"
  | "sit"
  | "walk"
  | "run"
  | "side-walk"
  | "side-run"
  | "scan"

const PET_SKINS: Array<{ id: PetSkin; color: string; filter: string }> = [
  { id: "snow", color: "#f8fafc", filter: "" },
  { id: "honey", color: "#f59e0b", filter: "hue-rotate(180deg) saturate(1.45)" },
  { id: "ash", color: "#94a3b8", filter: "saturate(.12) contrast(1.05)" },
  { id: "aurora", color: "#34d399", filter: "hue-rotate(292deg) saturate(1.35)" },
  { id: "violet", color: "#a78bfa", filter: "hue-rotate(60deg) saturate(1.35)" },
  { id: "crimson", color: "#fb7185", filter: "hue-rotate(150deg) saturate(1.35)" },
]

const customSkinFilter = (skin: PetSkin) => {
  if (!skin.startsWith("#") || !/^#[0-9a-f]{6}$/i.test(skin)) return ""
  const red = Number.parseInt(skin.slice(1, 3), 16) / 255
  const green = Number.parseInt(skin.slice(3, 5), 16) / 255
  const blue = Number.parseInt(skin.slice(5, 7), 16) / 255
  const maximum = Math.max(red, green, blue)
  const minimum = Math.min(red, green, blue)
  if (maximum === minimum) return "saturate(.12)"
  const hue =
    maximum === red
      ? ((green - blue) / (maximum - minimum)) * 60
      : maximum === green
        ? ((blue - red) / (maximum - minimum) + 2) * 60
        : ((red - green) / (maximum - minimum) + 4) * 60
  return `hue-rotate(${Math.round(((hue + 360) % 360) - 200)}deg) saturate(1.35)`
}

const MASCOT_THOUGHTS: Partial<Record<MascotActivity, string>> = {
  idle: "右键我，换个新配色",
  look: "看看四周有什么新鲜事",
  blink: "眨眨眼，继续陪着你",
  ears: "听到新动静啦",
  pant: "休息一下，呼呼",
  groom: "整理一下毛发",
  tail: "见到你真开心",
  stand: "伸个懒腰再出发",
  "side-walk": "散散步，换个心情",
  "side-run": "冲一小段！",
  scan: "正在留意任务状态",
}

const MascotIcon = (props: {
  class?: string
  mood: MascotMood
  skin: PetSkin
  opening?: boolean
  monitorSummary?: string
  unreadNotifications?: number
  completedTasks?: number
  totalTasks?: number
  taskGroups?: TaskGroup[]
}) => {
  const language = useLanguage()
  const core = () => (props.mood === "busy" ? "#fbbf24" : props.mood === "active" ? "#a3e635" : "#22d3ee")
  const shell = "light-dark(#f8fbff,#0b1830)"
  const shellEdge = "light-dark(rgba(14,116,144,.38),rgba(125,211,252,.48))"
  const ambientShadow = "light-dark(rgba(15,23,42,.2),rgba(2,6,23,.68))"
  const [activity, setActivity] = createStore<{
    current: MascotActivity
    frame: number
    facing: 1 | -1
    offsetX: number
  }>({
    current: "idle",
    frame: 0,
    facing: 1,
    offsetX: 0,
  })
  let nextActivity: ReturnType<typeof setTimeout> | undefined
  let activityStop: ReturnType<typeof setTimeout> | undefined
  let activityTransition: ReturnType<typeof setTimeout> | undefined
  let frameTimer: ReturnType<typeof setInterval> | undefined
  let motionFrame: number | undefined
  let monitorThoughtTimer: ReturnType<typeof setTimeout> | undefined
  const [showMonitorThought, setShowMonitorThought] = createSignal(false)
  const frameCounts = {
    blink: 6,
    ears: 6,
    pant: 8,
    groom: 8,
    tail: 8,
    stand: 4,
    sit: 2,
    walk: 8,
    run: 10,
    "side-walk": 8,
    "side-run": 8,
  } as const
  const frameDurations = {
    blink: 120,
    ears: 160,
    pant: 150,
    groom: 180,
    tail: 120,
    stand: 150,
    sit: 170,
    walk: 125,
    run: 83,
    "side-walk": 125,
    "side-run": 100,
  } as const

  const displayedActivity = (): MascotActivity => {
    return activity.current
  }

  const imageSource = () => {
    const current = displayedActivity()
    if (
      current === "blink" ||
      current === "ears" ||
      current === "pant" ||
      current === "groom" ||
      current === "tail" ||
      current === "stand" ||
      current === "walk" ||
      current === "run" ||
      current === "side-walk" ||
      current === "side-run"
    )
      return `/pets/${current}/${activity.frame + 1}.png`
    if (current === "sit") return `/pets/stand/${activity.frame + 5}.png`
    if (current === "scan") return "/pets/novaway-pet-busy.png"
    return "/pets/novaway-pet-idle.png"
  }

  const clearActivityTimers = () => {
    if (activityStop) clearTimeout(activityStop)
    if (activityTransition) clearTimeout(activityTransition)
    if (frameTimer) clearInterval(frameTimer)
    if (motionFrame !== undefined) cancelAnimationFrame(motionFrame)
    activityStop = undefined
    activityTransition = undefined
    frameTimer = undefined
    motionFrame = undefined
  }

  const moveWithinActivityRange = (target: number, duration: number) => {
    if (motionFrame !== undefined) cancelAnimationFrame(motionFrame)
    const start = performance.now()
    const origin = activity.offsetX
    const boundedTarget = Math.max(-PET_ACTIVITY_RANGE, Math.min(target, PET_ACTIVITY_RANGE))
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration)
      const eased = (1 - Math.cos(Math.PI * progress)) / 2
      setActivity("offsetX", origin + (boundedTarget - origin) * eased)
      if (progress < 1) {
        motionFrame = requestAnimationFrame(tick)
        return
      }
      motionFrame = undefined
    }
    motionFrame = requestAnimationFrame(tick)
  }

  const playFramedActivity = (next: keyof typeof frameCounts, settle = true, facing: 1 | -1 = 1) => {
    if (frameTimer) clearInterval(frameTimer)
    setActivity({ current: next, frame: 0, facing })
    const frameCount = frameCounts[next]
    const frameDuration = frameDurations[next]
    if (next === "side-walk" || next === "side-run") {
      moveWithinActivityRange(
        activity.offsetX + facing * (next === "side-run" ? PET_ACTIVITY_RANGE : PET_ACTIVITY_RANGE * 0.75),
        frameCount * frameDuration * 2,
      )
    }
    frameTimer = setInterval(() => setActivity("frame", (frame) => (frame + 1) % frameCount), frameDuration)
    if (!settle) return
    const loops = next === "blink" || next === "ears" || next === "stand" || next === "sit" ? 1 : 2
    activityStop = setTimeout(
      () => {
        if (frameTimer) clearInterval(frameTimer)
        frameTimer = undefined
        activityStop = undefined
        if (next === "stand" || next === "walk" || next === "run" || next === "side-walk" || next === "side-run") {
          playFramedActivity("sit", true, facing)
          return
        }
        setActivity({ current: "idle", frame: 0, facing })
      },
      frameCount * frameDuration * loops,
    )
  }

  const framedActivityDuration = (next: keyof typeof frameCounts) => {
    const loops = next === "blink" || next === "ears" || next === "stand" || next === "sit" ? 1 : 2
    return frameCounts[next] * frameDurations[next] * loops
  }

  const nextActivityDelay = () => 280 + Math.floor(Math.random() * 420)

  const scheduleActivity = () => {
    clearActivityTimers()
    const choices: Array<Exclude<MascotActivity, "idle" | "sit">> = [
      "look",
      "blink",
      "ears",
      "pant",
      "groom",
      "tail",
      "stand",
      "side-walk",
      "side-run",
      "scan",
    ]
    const next = choices[Math.floor(Math.random() * choices.length)]
    let duration = 2600
    if (next === "side-walk" || next === "side-run") {
      const facing =
        activity.offsetX >= PET_ACTIVITY_RANGE * 0.7
          ? -1
          : activity.offsetX <= -PET_ACTIVITY_RANGE * 0.7
            ? 1
            : Math.random() < 0.5
              ? -1
              : 1
      playFramedActivity("stand", false, facing)
      activityTransition = setTimeout(
        () => playFramedActivity(next, true, facing),
        frameCounts.stand * frameDurations.stand,
      )
      duration = framedActivityDuration("stand") + framedActivityDuration(next) + framedActivityDuration("sit")
    } else if (
      next === "blink" ||
      next === "ears" ||
      next === "pant" ||
      next === "groom" ||
      next === "tail" ||
      next === "stand"
    ) {
      playFramedActivity(next)
      duration = framedActivityDuration(next) + (next === "stand" ? framedActivityDuration("sit") : 0)
    } else {
      setActivity({ current: next, frame: 0, facing: 1 })
      activityStop = setTimeout(() => setActivity({ current: "idle", frame: 0, facing: 1 }), 2600)
    }
    nextActivity = setTimeout(scheduleActivity, duration + nextActivityDelay())
  }

  const playInteractionActivity = (next: "ears" | "tail") => {
    if (nextActivity) clearTimeout(nextActivity)
    clearActivityTimers()
    playFramedActivity(next)
    nextActivity = setTimeout(scheduleActivity, framedActivityDuration(next) + nextActivityDelay())
  }

  let previousMood = props.mood
  createEffect(() => {
    const mood = props.mood
    if (mood === previousMood) return
    previousMood = mood
    if (mood === "hover") {
      playInteractionActivity("ears")
      return
    }
    if (mood === "active") playInteractionActivity("tail")
  })

  onMount(() => {
    const assets = [
      "/pets/novaway-pet-idle.png",
      "/pets/novaway-pet-active.png",
      "/pets/novaway-pet-hover.png",
      "/pets/novaway-pet-busy.png",
      ...Object.entries(frameCounts).flatMap(([name, count]) => {
        if (name === "sit") return Array.from({ length: count }, (_, index) => `/pets/stand/${index + 5}.png`)
        return Array.from({ length: count }, (_, index) => `/pets/${name}/${index + 1}.png`)
      }),
    ]
    assets.forEach((source) => {
      const image = new Image()
      image.src = source
    })
    nextActivity = setTimeout(scheduleActivity, 300 + Math.floor(Math.random() * 400))
  })

  onCleanup(() => {
    if (nextActivity) clearTimeout(nextActivity)
    if (monitorThoughtTimer) clearTimeout(monitorThoughtTimer)
    clearActivityTimers()
  })
  const transform = () => {
    if (props.mood === "active") return "translateY(4px) scale(.93)"
    if (props.mood === "hover") return "translateY(-5px) scale(1.045)"
    return "translateY(0) scale(1)"
  }
  const animation = () =>
    props.mood === "busy" ? "nova-core-hover 1.15s ease-in-out infinite" : "nova-core-hover 3.2s ease-in-out infinite"
  const monitorThoughtDuration = () => 3000 + Math.floor(Math.random() * 2001)
  const scheduleMonitorThought = () => {
    setShowMonitorThought((visible) => !visible)
    monitorThoughtTimer = setTimeout(scheduleMonitorThought, monitorThoughtDuration())
  }
  createEffect(() => {
    const monitorSummary = props.monitorSummary
    if (monitorThoughtTimer) clearTimeout(monitorThoughtTimer)
    monitorThoughtTimer = undefined
    if (!monitorSummary) {
      setShowMonitorThought(false)
      return
    }
    setShowMonitorThought(true)
    monitorThoughtTimer = setTimeout(scheduleMonitorThought, monitorThoughtDuration())
  })
  const thought = () =>
    props.monitorSummary && showMonitorThought()
      ? props.monitorSummary
      : (MASCOT_THOUGHTS[displayedActivity()] ?? MASCOT_THOUGHTS.idle)
  const skinFilter = () => PET_SKINS.find((skin) => skin.id === props.skin)?.filter ?? customSkinFilter(props.skin)
  const taskSummaries = () => {
    const groups = (props.taskGroups ?? [])
      .filter((group) => group.tasks.some((task) => task.status !== "completed" && task.status !== "cancelled"))
      .slice(0, 3)
      .map((group) => {
        const project = group.label.split(" / ")[0] ?? group.label
        return {
          id: group.id,
          label: group.label,
          project: project.length > 8 ? project.slice(0, 8) : project,
          session: group.sessionID.slice(-4).toUpperCase(),
          completed: group.tasks.filter((task) => task.status === "completed").length,
          total: group.tasks.length,
        }
      })
    if (groups.length > 0) return groups
    if ((props.totalTasks ?? 0) === 0) return []
    return [
      {
        id: "all",
        label: language.t("assistant.badge.tasks"),
        project: language.t("assistant.badge.tasks"),
        session: undefined,
        completed: props.completedTasks ?? 0,
        total: props.totalTasks ?? 0,
      },
    ]
  }

  return (
    <div
      class={`nova-pet-image relative h-28 w-28 ${props.class ?? ""}`}
      aria-hidden="true"
      style={{ "pointer-events": "none" }}
    >
      <style>{`.nova-pet-image>span{display:none}`}</style>
      <style>{`.nova-pet-motion-side-walk,.nova-pet-motion-side-run{animation:none}.nova-pet-facing-left{transform:scaleX(-1)}`}</style>
      <Show when={props.opening}>
        <div
          class="absolute inset-3 z-50 rounded-full border-2 border-transparent border-t-cyan-300 border-r-cyan-500 animate-spin"
          style={{ "box-shadow": "0 0 12px rgba(34,211,238,.72)" }}
        />
      </Show>
      <Show when={thought()}>
        {(message) => (
          <div
            class="absolute bottom-[calc(100%-0.25rem)] left-1/2 z-40 w-36 whitespace-normal rounded-md px-2 py-1 text-center text-[10px] leading-4 shadow-sm"
            style={{
              "background-color": "light-dark(rgba(255,255,255,.96),rgba(15,23,42,.96))",
              color: "light-dark(#334155,#e2e8f0)",
              "box-shadow": "light-dark(0 3px 10px rgba(15,23,42,.16),0 3px 12px rgba(2,6,23,.58))",
              "word-break": "break-word",
              transform: `translateX(calc(-50% + ${activity.offsetX}px))`,
            }}
          >
            {message()}
            <div
              class="absolute -bottom-1 left-1/2 size-2 rotate-45"
              style={{ "background-color": "light-dark(rgba(255,255,255,.96),rgba(15,23,42,.96))" }}
            />
          </div>
        )}
      </Show>
      <span
        class="absolute bottom-1 left-1/2 h-3 w-12 -translate-x-1/2 rounded-full blur-[3px]"
        style={{ "background-color": "light-dark(rgba(15,23,42,.2),rgba(2,8,23,.72))" }}
      />
      <span
        class="absolute inset-1 rounded-full border"
        style={{
          animation: "nova-core-orbit 8s linear infinite",
          "border-color": "light-dark(rgba(8,145,178,.34),rgba(34,211,238,.36))",
          "box-shadow": "light-dark(inset 0 0 16px rgba(8,145,178,.14),0 0 22px rgba(8,145,178,.2))",
        }}
      >
        <span
          class="absolute -top-1 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full"
          style={{ "background-color": core(), "box-shadow": `0 0 13px ${core()}` }}
        />
        <span class="absolute -bottom-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-cyan-200" />
      </span>
      <span
        class="absolute inset-x-2 top-2 bottom-2 block transition-transform duration-200 ease-out"
        style={{ transform: transform(), animation: animation() }}
      >
        <span
          class="absolute left-2 top-2 h-5 w-3 -rotate-[26deg] rounded-tl-full rounded-br-full border"
          style={{ background: shell, "border-color": shellEdge, "box-shadow": `-3px 5px 9px ${ambientShadow}` }}
        />
        <span
          class="absolute right-2 top-2 h-5 w-3 rotate-[26deg] rounded-tr-full rounded-bl-full border"
          style={{ background: shell, "border-color": shellEdge, "box-shadow": `3px 5px 9px ${ambientShadow}` }}
        />
        <span
          class="absolute left-1/2 top-0 h-4 w-7 -translate-x-1/2 rounded-t-full border-x border-t"
          style={{ "border-color": "rgba(125, 211, 252, .82)" }}
        />
        <span
          class="absolute left-1/2 top-0 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ "background-color": core(), "box-shadow": `0 0 16px ${core()}` }}
        />
        <span
          class="absolute left-0 top-7 h-8 w-5 -rotate-[22deg] rounded-l-full"
          style={{
            background: "linear-gradient(90deg,#172554,#2563eb,#67e8f9)",
            "box-shadow": "0 5px 12px rgba(8,145,178,.42)",
          }}
        />
        <span
          class="absolute right-0 top-7 h-8 w-5 rotate-[22deg] rounded-r-full"
          style={{
            background: "linear-gradient(90deg,#67e8f9,#2563eb,#172554)",
            "box-shadow": "0 5px 12px rgba(8,145,178,.42)",
          }}
        />
        <span
          class="absolute left-1/2 top-4 h-12 w-12 -translate-x-1/2 rounded-[42%] border"
          style={{
            background: `radial-gradient(circle at 34% 24%,rgba(255,255,255,.9) 0%,rgba(103,232,249,.8) 12%,rgba(8,145,178,.8) 31%,${shell} 82%)`,
            "border-color": shellEdge,
            "box-shadow": `inset 5px 6px 10px rgba(255,255,255,.4), inset -8px -9px 14px ${ambientShadow}, 0 12px 22px ${ambientShadow}`,
          }}
        >
          <span
            class="absolute inset-2 rounded-full border"
            style={{
              "border-color": "rgba(207,250,254,.58)",
              "box-shadow": "inset 0 0 18px rgba(34,211,238,.46)",
            }}
          >
            <span
              class="absolute left-[23%] top-[31%] h-2.5 w-2.5 rounded-full bg-slate-950"
              style={{ "box-shadow": "0 0 7px #67e8f9" }}
            />
            <span
              class="absolute right-[23%] top-[31%] h-2.5 w-2.5 rounded-full bg-slate-950"
              style={{ "box-shadow": "0 0 7px #67e8f9" }}
            />
            <span
              class="absolute bottom-[14%] left-1/2 h-3.5 w-4 -translate-x-1/2 rounded-[48%]"
              style={{
                "background-color": core(),
                "box-shadow": `0 0 15px 3px ${core()}`,
                animation: "nova-core-pulse 1.8s ease-in-out infinite",
              }}
            />
          </span>
          <span
            class="absolute left-1/2 top-1/2 h-1 w-7 -translate-x-1/2 rounded-full"
            style={{
              animation:
                props.mood === "busy" || props.mood === "hover" ? "nova-core-scan 1.25s ease-in-out infinite" : "none",
              "background-color": "rgba(255,255,255,.86)",
              "box-shadow": "0 0 8px rgba(255,255,255,.9)",
            }}
          />
        </span>
      </span>
      <div
        class="absolute inset-0 z-20"
        style={{ transform: `translateX(${activity.offsetX}px)`, "will-change": "transform" }}
      >
        <img
          src={imageSource()}
          alt=""
          draggable={false}
          class={`absolute inset-0 h-full w-full object-contain nova-pet-motion-${displayedActivity()} ${activity.facing === -1 ? "nova-pet-facing-left" : ""}`}
          style={{
            filter: `${skinFilter()} drop-shadow(0 5px 5px rgba(2,6,23,.42))`.trim(),
          }}
        />
        <div class="absolute left-[calc(50%+2.5rem)] top-2 z-50 flex flex-col items-start gap-1 whitespace-nowrap">
          <Show when={(props.unreadNotifications ?? 0) > 0}>
            <div
              class="flex h-6 items-center gap-1 rounded-md border px-1.5 text-10-medium shadow-sm backdrop-blur-sm"
              style={{
                "background-color": "light-dark(rgba(255,241,242,.94),rgba(69,10,10,.62))",
                "border-color": "light-dark(rgba(225,29,72,.34),rgba(251,113,133,.55))",
                color: "light-dark(#be123c,#fecdd3)",
              }}
            >
              <Icon name="bubble-5" size="small" />
              <span>{language.t("assistant.badge.notifications")}</span>
              <span class="font-semibold">{props.unreadNotifications}</span>
            </div>
          </Show>
          <For each={taskSummaries()}>
            {(summary) => (
              <div
                class="flex h-6 max-w-44 items-center gap-1 rounded-md border px-1.5 text-10-medium shadow-sm backdrop-blur-sm"
                title={summary.label}
                style={{
                  "background-color": "light-dark(rgba(236,254,255,.94),rgba(8,47,73,.64))",
                  "border-color": "light-dark(rgba(8,145,178,.3),rgba(34,211,238,.5))",
                  color: "light-dark(#0e7490,#a5f3fc)",
                }}
              >
                <Icon name="checklist" size="small" />
                <span class="min-w-0 max-w-16 truncate">{summary.project}</span>
                <Show when={summary.session}>
                  <span class="shrink-0 rounded-sm bg-cyan-400/10 px-1 text-[9px] text-cyan-300">
                    #{summary.session}
                  </span>
                </Show>
                <span class="shrink-0 border-l border-cyan-400/30 pl-1 font-semibold">
                  {summary.completed}/{summary.total}
                </span>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  )
}

const AgentDot = (props: { name: string }) => (
  <div class="size-2 rounded-full" style={{ "background-color": agentColor(props.name) }} />
)

export type AssistantPanelProps = {
  currentAgent?: AgentItem
  agents: AgentItem[]
  tasks: Task[]
  taskGroups?: TaskGroup[]
  currentTaskGroupID?: string
  monitorSummary?: string
  taskEvents?: TaskEvent[]
  notifications?: PetNotification[]
  initialTab?: "monitor" | "notifications"
  onNotificationsRead?: (ids?: string[]) => void
  onNotificationsClearRead?: () => void
  onNotificationOpen?: (notification: PetNotification) => void
  expanded: boolean
  onExpandToggle: () => void
  onAgentChange: (name: string) => void
  petSkin?: PetSkin
  onPetSkinChange?: (skin: PetSkin) => void
  onSkinMenuToggle?: () => void
  opening?: boolean
  onDragStart?: (pointerX: number, pointerY: number) => void
  onDragMove?: (pointerX: number, pointerY: number) => void
  onDragEnd?: () => void
  title?: string
  draggable?: boolean
  hasInProgressTask?: boolean
  unreadNotifications?: number
  panelOnly?: boolean
  class?: string
  style?: JSX.CSSProperties
}

function AgentSwitch(props: {
  currentAgent?: AgentItem
  agents: AgentItem[]
  open: boolean
  onToggle: () => void
  onAgentChange: (name: string) => void
}) {
  const language = useLanguage()

  return (
    <div class="flex flex-col">
      <button
        type="button"
        data-no-drag
        class="flex items-center justify-between gap-2 w-full px-2 py-1.5 rounded-md hover:bg-surface-raised-base-hover transition-colors"
        onClick={() => props.onToggle()}
      >
        <div class="flex items-center gap-2 min-w-0">
          <Show
            when={props.currentAgent}
            fallback={<span class="text-12-regular text-text-weak">{language.t("settings.agents.empty")}</span>}
          >
            {(agent) => (
              <>
                <AgentDot name={agent().name} />
                <span class="text-12-medium text-text-strong truncate">
                  {agentDisplayName(agent().name, agent().options)}
                </span>
              </>
            )}
          </Show>
        </div>
        <span class="text-12-medium text-cyan-400 hover:text-cyan-300 shrink-0">
          {language.t("assistant.agent.switch")}
        </span>
      </button>
      <Show when={props.open}>
        <div class="mt-1 flex flex-col gap-0.5 px-1 py-1.5 rounded-md bg-surface-raised-base border border-border-weaker-base">
          <For each={props.agents}>
            {(agent) => (
              <button
                type="button"
                data-no-drag
                class={`flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors ${
                  props.currentAgent?.name === agent.name
                    ? "bg-surface-raised-base-hover"
                    : "hover:bg-surface-raised-base-hover"
                }`}
                onClick={() => props.onAgentChange(agent.name)}
              >
                <AgentDot name={agent.name} />
                <span class="text-12-regular text-text-base">{agentDisplayName(agent.name, agent.options)}</span>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}

function NotificationTab(props: {
  notifications: PetNotification[]
  onRead?: (ids?: string[]) => void
  onOpen?: (notification: PetNotification) => void
}) {
  const language = useLanguage()
  const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" })
  const kind = (notification: PetNotification) => {
    const title = notification.title.trim()
    if (title === language.t("notification.question.title") || title === "问题" || title === "Question")
      return "question"
    if (
      title === language.t("notification.permission.title") ||
      title === "需要权限" ||
      title === "Permission required"
    ) {
      return "permission"
    }
    if (title === language.t("notification.session.error.title") || title === "任务错误" || title === "Session error") {
      return "error"
    }
    return "info"
  }
  const title = (notification: PetNotification) =>
    kind(notification) === "question" ? language.t("notification.question.title") : notification.title
  const icon = (notification: PetNotification) => {
    if (kind(notification) === "question") return "bubble-5"
    if (kind(notification) === "permission") return "checklist"
    if (kind(notification) === "error") return "circle-x"
    return "status"
  }
  const color = (notification: PetNotification) => {
    if (kind(notification) === "question") return "text-amber-400"
    if (kind(notification) === "permission") return "text-cyan-400"
    if (kind(notification) === "error") return "text-red-400"
    return "text-blue-400"
  }
  const surface = (notification: PetNotification) => {
    if (kind(notification) === "question")
      return notification.read ? "border-border-weaker-base" : "border-amber-400/30 bg-amber-400/[.06]"
    if (kind(notification) === "permission")
      return notification.read ? "border-border-weaker-base" : "border-cyan-400/30 bg-cyan-400/[.06]"
    if (kind(notification) === "error")
      return notification.read ? "border-border-weaker-base" : "border-red-400/30 bg-red-400/[.06]"
    return notification.read ? "border-border-weaker-base" : "border-blue-400/30 bg-blue-400/[.06]"
  }
  const resolution = (notification: PetNotification) => {
    if (notification.status === "replied") return language.t("assistant.notifications.replied")
    if (notification.status === "dismissed") return language.t("assistant.notifications.dismissed")
    return undefined
  }

  return (
    <div class="flex-1 overflow-y-auto p-2">
      <Show
        when={props.notifications.length > 0}
        fallback={
          <div class="px-3 py-6 text-center">
            <div class="text-12-medium text-text-base">{language.t("assistant.monitor.notificationsEmpty")}</div>
            <div class="mt-1 text-11-regular text-text-weak">
              {language.t("assistant.monitor.notificationsEmptyDescription")}
            </div>
          </div>
        }
      >
        <For each={props.notifications}>
          {(notification) => (
            <article
              data-no-drag
              class={`group mb-2 flex items-start gap-2 rounded-md border p-2 last:mb-0 ${surface(notification)} ${
                notification.href ? "cursor-pointer transition-colors hover:bg-surface-raised-base-hover" : ""
              }`}
              onClick={() => notification.href && props.onOpen?.(notification)}
            >
              <div
                class={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-raised-base ${color(notification)}`}
              >
                <Icon name={icon(notification)} size="small" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <div class="min-w-0 flex-1 text-12-medium text-text-strong">{title(notification)}</div>
                  <Show
                    when={resolution(notification)}
                    fallback={
                      <Show when={!notification.read}>
                        <span class="shrink-0 rounded-sm bg-surface-raised-base px-1 py-0.5 text-10-medium text-text-weak">
                          {language.t("assistant.notifications.unread")}
                        </span>
                      </Show>
                    }
                  >
                    {(value) => (
                      <span class="shrink-0 rounded-sm bg-green-500/10 px-1 py-0.5 text-10-medium text-green-400">
                        {value()}
                      </span>
                    )}
                  </Show>
                </div>
                <Show when={notification.body}>
                  <div class="mt-1 whitespace-pre-wrap break-words text-11-regular leading-4 text-text-base">
                    {notification.body}
                  </div>
                </Show>
                <div class="mt-1 text-10-regular text-text-weak">{time.format(new Date(notification.at))}</div>
              </div>
              <Show when={!notification.read}>
                <button
                  type="button"
                  data-no-drag
                  class="mt-0.5 p-1 text-icon-weak-base hover:text-cyan-400 transition-colors"
                  title={language.t("assistant.monitor.markAllRead")}
                  aria-label={language.t("assistant.monitor.markAllRead")}
                  onClick={(event) => {
                    event.stopPropagation()
                    props.onRead?.([notification.id])
                  }}
                >
                  <Icon name="check" size="small" />
                </button>
              </Show>
            </article>
          )}
        </For>
      </Show>
    </div>
  )
}

function TodoTab(props: {
  tasks: Task[]
  initialTab?: "monitor" | "notifications"
  taskGroups?: TaskGroup[]
  currentTaskGroupID?: string
  taskEvents?: TaskEvent[]
  notifications?: PetNotification[]
  onNotificationsRead?: (ids?: string[]) => void
  onNotificationsClearRead?: () => void
  onNotificationOpen?: (notification: PetNotification) => void
}) {
  const language = useLanguage()
  const [now, setNow] = createSignal(Date.now())
  const [tab, setTab] = createSignal<"monitor" | "notifications">(props.initialTab ?? "monitor")

  createEffect(() => {
    if (props.initialTab) setTab(props.initialTab)
  })

  const taskCount = () => props.tasks.length
  const completedCount = () => props.tasks.filter((task) => task.status === "completed").length
  const groups = () => props.taskGroups?.filter((group) => group.tasks.length > 0) ?? []
  const [collapsedGroups, setCollapsedGroups] = createStore<Record<string, boolean>>({})
  const isGroupExpanded = (group: TaskGroup) => {
    const collapsed = collapsedGroups[group.id]
    if (collapsed !== undefined) return !collapsed
    return group.id === props.currentTaskGroupID || group.tasks.some((task) => task.status === "in_progress")
  }
  const toggleGroup = (group: TaskGroup) => setCollapsedGroups(group.id, isGroupExpanded(group))
  const activeCount = () => props.tasks.filter((task) => task.status === "in_progress").length
  const pendingCount = () => props.tasks.filter((task) => task.status === "pending").length
  const highPriorityCount = () =>
    props.tasks.filter((task) => task.priority === "high" && task.status !== "completed" && task.status !== "cancelled")
      .length
  const unreadNotificationCount = () => props.notifications?.filter((notification) => !notification.read).length ?? 0
  const readNotificationCount = () => props.notifications?.filter((notification) => notification.read).length ?? 0
  const longestRunning = () =>
    props.tasks
      .filter((task) => task.status === "in_progress" && task.startedAt)
      .sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))[0]
  const taskDuration = (task: Task) => {
    const value = task.durationMs ?? (task.startedAt ? Math.max(0, now() - task.startedAt) : undefined)
    if (value === undefined) return undefined
    const seconds = Math.floor(value / 1000)
    const minutes = Math.floor(seconds / 60)
    return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`
  }

  onMount(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => window.clearInterval(timer))
  })

  const TaskRow = (row: { task: Task }) => {
    const duration = () => taskDuration(row.task)
    const timing = () => {
      if (!duration()) return undefined
      if (row.task.status === "completed") return language.t("assistant.monitor.completedIn", { duration: duration()! })
      if (row.task.status === "cancelled") return language.t("assistant.monitor.cancelledIn", { duration: duration()! })
      if (row.task.status === "in_progress") return language.t("assistant.monitor.elapsed", { duration: duration()! })
      return undefined
    }
    return (
      <div class="flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-surface-raised-base-hover">
        <StatusIcon status={row.task.status} />
        <div class="min-w-0 flex-1">
          <span
            class={`block text-12-regular ${
              row.task.status === "completed"
                ? "line-through text-text-weak"
                : row.task.status === "in_progress"
                  ? "font-medium text-text-strong"
                  : "text-text-base"
            }`}
          >
            {row.task.content}
          </span>
          <Show when={timing()}>
            {(value) => <span class="block mt-0.5 text-10-regular text-text-weak">{value()}</span>}
          </Show>
        </div>
      </div>
    )
  }

  const eventLabel = (event: TaskEvent) => {
    if (event.status === "completed") return language.t("assistant.monitor.eventCompleted")
    if (event.status === "cancelled") return language.t("assistant.monitor.eventCancelled")
    if (event.status === "in_progress") return language.t("assistant.monitor.eventStarted")
    return language.t("assistant.monitor.eventUpdated")
  }

  return (
    <div class="flex flex-col h-full">
      <div class="flex items-center justify-between px-3 py-2 border-b border-border-weaker-base bg-surface-panel">
        <div class="flex items-center gap-1">
          <button
            type="button"
            data-no-drag
            class={`px-2 py-1 text-12-medium transition-colors ${
              tab() === "monitor" ? "text-text-strong bg-surface-raised-base" : "text-text-weak hover:text-text-base"
            }`}
            onClick={() => setTab("monitor")}
          >
            {language.t("assistant.monitor.title")}
          </button>
          <button
            type="button"
            data-no-drag
            class={`relative px-2 py-1 text-12-medium transition-colors ${
              tab() === "notifications"
                ? "text-text-strong bg-surface-raised-base"
                : "text-text-weak hover:text-text-base"
            }`}
            onClick={() => setTab("notifications")}
          >
            {language.t("assistant.tab.notifications")}
            <Show when={unreadNotificationCount() > 0}>
              <span
                class="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-10-medium text-white shadow-sm"
                style={{ "background-color": "#ef4444" }}
              >
                {unreadNotificationCount() > 99 ? "99+" : unreadNotificationCount()}
              </span>
            </Show>
          </button>
        </div>
        <Show
          when={tab() === "notifications"}
          fallback={
            <Show when={taskCount() > 0}>
              <span class="text-11-regular text-text-weak">
                {completedCount()}/{taskCount()}
              </span>
            </Show>
          }
        >
          <div class="flex items-center gap-1">
            <Show when={unreadNotificationCount() > 0}>
              <button
                type="button"
                data-no-drag
                class="p-1 text-icon-weak-base hover:text-cyan-400 transition-colors"
                title={language.t("assistant.monitor.markAllRead")}
                aria-label={language.t("assistant.monitor.markAllRead")}
                onClick={() => props.onNotificationsRead?.()}
              >
                <Icon name="check" size="small" />
              </button>
            </Show>
            <Show when={readNotificationCount() > 0}>
              <button
                type="button"
                data-no-drag
                class="p-1 text-icon-weak-base hover:text-red-400 transition-colors"
                title={language.t("assistant.notifications.clearRead")}
                aria-label={language.t("assistant.notifications.clearRead")}
                onClick={() => props.onNotificationsClearRead?.()}
              >
                <Icon name="trash" size="small" />
              </button>
            </Show>
          </div>
        </Show>
      </div>
      <Show
        when={tab() === "monitor"}
        fallback={
          <NotificationTab
            notifications={props.notifications ?? []}
            onRead={props.onNotificationsRead}
            onOpen={props.onNotificationOpen}
          />
        }
      >
        <Show when={taskCount() > 0}>
          <div class="grid grid-cols-3 border-b border-border-weaker-base text-center">
            <div class="py-2 border-r border-border-weaker-base">
              <div class="text-12-medium text-text-strong">{activeCount()}</div>
              <div class="text-10-regular text-text-weak">{language.t("assistant.monitor.running")}</div>
            </div>
            <div class="py-2 border-r border-border-weaker-base">
              <div class="text-12-medium text-text-strong">{pendingCount()}</div>
              <div class="text-10-regular text-text-weak">{language.t("assistant.monitor.pending")}</div>
            </div>
            <div class="py-2">
              <div class={`text-12-medium ${highPriorityCount() > 0 ? "text-orange-500" : "text-text-strong"}`}>
                {highPriorityCount()}
              </div>
              <div class="text-10-regular text-text-weak">{language.t("assistant.monitor.highPriority")}</div>
            </div>
          </div>
          <Show when={longestRunning()}>
            {(task) => (
              <div class="px-3 py-1.5 border-b border-border-weaker-base text-10-regular text-text-weak truncate">
                {language.t("assistant.monitor.longestRunning", {
                  task: task().content,
                  duration: taskDuration(task()) ?? "0s",
                })}
              </div>
            )}
          </Show>
        </Show>
        <div class="flex-1 overflow-y-auto p-2">
          <Show
            when={props.tasks.length > 0}
            fallback={
              <div class="px-3 py-6 text-center">
                <div class="text-12-medium text-text-base">{language.t("assistant.monitor.ready")}</div>
                <div class="mt-1 text-11-regular text-text-weak">{language.t("assistant.monitor.idleDescription")}</div>
              </div>
            }
          >
            <Show
              when={groups().length > 0}
              fallback={<For each={props.tasks}>{(task) => <TaskRow task={task} />}</For>}
            >
              <For each={groups()}>
                {(group) => {
                  const done = () => group.tasks.filter((task) => task.status === "completed").length
                  const percent = () => Math.round((done() / group.tasks.length) * 100)
                  return (
                    <section class="mb-2 overflow-hidden rounded-md border border-border-weaker-base last:mb-0">
                      <button
                        type="button"
                        data-no-drag
                        class="flex w-full items-center gap-2 px-2 py-2 text-left hover:bg-surface-raised-base-hover transition-colors"
                        aria-expanded={isGroupExpanded(group)}
                        onClick={() => toggleGroup(group)}
                      >
                        <Icon name={isGroupExpanded(group) ? "chevron-down" : "chevron-right"} size="small" />
                        <span class="min-w-0 flex-1 truncate text-11-medium text-text-base">{group.label}</span>
                        <span class="shrink-0 text-11-medium text-text-weak">
                          {done()}/{group.tasks.length} {percent()}%
                        </span>
                      </button>
                      <Show when={isGroupExpanded(group)}>
                        <div class="h-1 mx-2 mb-1 overflow-hidden bg-surface-raised-base rounded-full">
                          <div
                            class="h-full bg-cyan-500 transition-[width] duration-300"
                            style={{ width: `${percent()}%` }}
                          />
                        </div>
                        <div class="pb-1">
                          <For each={group.tasks}>{(task) => <TaskRow task={task} />}</For>
                        </div>
                      </Show>
                    </section>
                  )
                }}
              </For>
            </Show>
          </Show>
          <Show when={props.taskEvents && props.taskEvents.length > 0}>
            <section class="mt-3 pt-2 border-t border-border-weaker-base">
              <div class="px-2 pb-1 text-11-medium text-text-weak">{language.t("assistant.monitor.recentEvents")}</div>
              <For each={props.taskEvents?.slice(0, 4) ?? []}>
                {(event) => (
                  <div class="flex items-center gap-2 px-2 py-1 text-10-regular text-text-weak">
                    <StatusIcon status={event.status} class="mt-0" />
                    <span class="min-w-0 flex-1 truncate">{event.taskContent}</span>
                    <span class="shrink-0">{eventLabel(event)}</span>
                  </div>
                )}
              </For>
            </section>
          </Show>
        </div>
      </Show>
    </div>
  )
}

export function AssistantPanel(props: AssistantPanelProps) {
  const language = useLanguage()
  const [mascot, setMascot] = createStore({ hover: false, pressed: false })
  const panelBase = "light-dark(#f8fbff,#0b1020)"
  const panelHeader = "light-dark(#edf4fa,#172033)"
  const panelBorder = "light-dark(rgba(8,145,178,.24),#263249)"

  const spring = useSpring(() => (props.expanded ? 1 : 0), { visualDuration: 0.3, bounce: 0 })
  const scale = () => spring()
  const [showAgentSwitch, setShowAgentSwitch] = createSignal(false)

  let dragging = false
  let moved = false
  let startX = 0
  let startY = 0
  let pendingPointerX = 0
  let pendingPointerY = 0
  let rafId: number | null = null
  let suppressClick = false

  const flushDragMove = () => {
    rafId = null
    if (!dragging) return
    props.onDragMove?.(pendingPointerX, pendingPointerY)
  }

  const scheduleFlush = () => {
    if (rafId !== null) return
    rafId = requestAnimationFrame(flushDragMove)
  }

  const handlePointerMove = (e: PointerEvent) => {
    if (!dragging) return
    const totalDx = e.screenX - startX
    const totalDy = e.screenY - startY
    pendingPointerX = e.screenX
    pendingPointerY = e.screenY
    if (!moved) {
      if (Math.abs(totalDx) + Math.abs(totalDy) <= DRAG_THRESHOLD) return
      moved = true
      scheduleFlush()
      return
    }
    scheduleFlush()
  }

  const handlePointerUp = () => {
    flushDragMove()
    dragging = false
    setMascot("pressed", false)
    window.removeEventListener("pointermove", handlePointerMove)
    window.removeEventListener("pointerup", handlePointerUp)
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    if (moved) suppressClick = true
    props.onDragEnd?.()
  }

  const handlePointerDown = (e: PointerEvent) => {
    if (!props.draggable) return
    e.preventDefault()
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    dragging = true
    moved = false
    startX = e.screenX
    startY = e.screenY
    pendingPointerX = e.screenX
    pendingPointerY = e.screenY
    props.onDragStart?.(e.screenX, e.screenY)
    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", handlePointerUp)
  }

  const handlePanelPointerDown = (e: PointerEvent) => {
    if (!props.draggable) return
    const target = e.target
    if (!(target instanceof HTMLElement)) return
    if (target.closest("button,a,input,textarea,select,[role='button'],[role='tab'],[data-no-drag]")) {
      return
    }
    handlePointerDown(e)
  }

  const handleClick = (e: MouseEvent) => {
    if (suppressClick) {
      suppressClick = false
      e.preventDefault()
      e.stopPropagation()
      return
    }
    props.onExpandToggle()
  }

  if (props.panelOnly) {
    return (
      <div
        class="h-full w-full border rounded-xl shadow-2xl flex flex-col overflow-hidden"
        style={{ background: panelBase, "border-color": panelBorder }}
      >
        <div
          class="px-3 py-2 border-b shrink-0"
          style={{ "background-color": panelHeader, "border-color": panelBorder }}
        >
          <AgentSwitch
            currentAgent={props.currentAgent}
            agents={props.agents}
            open={showAgentSwitch()}
            onToggle={() => setShowAgentSwitch((v) => !v)}
            onAgentChange={(name) => {
              props.onAgentChange(name)
              setShowAgentSwitch(false)
            }}
          />
        </div>
        <div class="flex-1 min-h-0 overflow-hidden" style={{ "background-color": panelBase }}>
          <TodoTab
            tasks={props.tasks}
            initialTab={props.initialTab}
            taskGroups={props.taskGroups}
            currentTaskGroupID={props.currentTaskGroupID}
            taskEvents={props.taskEvents}
            notifications={props.notifications}
            onNotificationsRead={props.onNotificationsRead}
            onNotificationsClearRead={props.onNotificationsClearRead}
            onNotificationOpen={props.onNotificationOpen}
          />
        </div>
      </div>
    )
  }

  return (
    <div class={`z-50 h-[152px] w-[152px] overflow-visible ${props.class ?? ""}`} style={props.style}>
      <Show when={props.expanded}>
        <div
          class={`absolute right-0 bottom-[120px] w-80 max-h-96 border rounded-xl shadow-2xl flex flex-col overflow-hidden ${
            props.draggable ? "cursor-grab active:cursor-grabbing" : ""
          }`}
          style={{
            transform: `translateY(${scale() > 0.01 ? 0 : 10}px)`,
            background: panelBase,
            "border-color": panelBorder,
          }}
          onPointerDown={handlePanelPointerDown}
        >
          <div
            class="px-3 py-2 border-b shrink-0"
            style={{ "background-color": panelHeader, "border-color": panelBorder }}
          >
            <AgentSwitch
              currentAgent={props.currentAgent}
              agents={props.agents}
              open={showAgentSwitch()}
              onToggle={() => setShowAgentSwitch((v) => !v)}
              onAgentChange={(name) => {
                props.onAgentChange(name)
                setShowAgentSwitch(false)
              }}
            />
          </div>
          <div class="flex-1 min-h-0 overflow-hidden" style={{ "background-color": panelBase }}>
            <TodoTab
              tasks={props.tasks}
              initialTab={props.initialTab}
              taskGroups={props.taskGroups}
              currentTaskGroupID={props.currentTaskGroupID}
              taskEvents={props.taskEvents}
              notifications={props.notifications}
              onNotificationsRead={props.onNotificationsRead}
              onNotificationsClearRead={props.onNotificationsClearRead}
              onNotificationOpen={props.onNotificationOpen}
            />
          </div>
        </div>
      </Show>

      <button
        type="button"
        data-floating-hit="pet"
        title="拖动移动 · 单击打开面板 · 右键换装"
        style={{
          "touch-action": "none",
          background: "transparent",
          "border-color": "transparent",
          "box-shadow": "none",
          cursor: "grab",
        }}
        class={`absolute inset-0 flex h-[152px] w-[152px] cursor-grab items-center justify-center overflow-visible text-icon-base transition-transform active:cursor-grabbing ${
          props.hasInProgressTask ? "animate-pulse" : ""
        }`}
        onPointerEnter={() => setMascot("hover", true)}
        onPointerLeave={() => {
          setMascot("hover", false)
          setMascot("pressed", false)
        }}
        onPointerDown={(event) => {
          setMascot("pressed", true)
          if (event.currentTarget instanceof HTMLElement) {
            event.currentTarget.style.cursor = "grabbing"
            document.body.style.cursor = "grabbing"
          }
          handlePointerDown(event)
        }}
        onPointerUp={(event) => {
          setMascot("pressed", false)
          if (event.currentTarget instanceof HTMLElement) {
            event.currentTarget.style.cursor = "grab"
          }
          document.body.style.cursor = "grab"
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
          props.onSkinMenuToggle?.()
        }}
        onClick={handleClick}
        aria-label={props.title ?? language.t("assistant.title")}
      >
        <MascotIcon
          mood={mascot.pressed ? "active" : mascot.hover ? "hover" : props.hasInProgressTask ? "busy" : "idle"}
          skin={props.petSkin ?? "snow"}
          opening={props.opening}
          monitorSummary={
            props.monitorSummary ??
            (props.tasks.some((task) => task.status !== "completed" && task.status !== "cancelled")
              ? language.t("assistant.thought.taskStatus", {
                  active: props.tasks.filter((task) => task.status === "in_progress").length,
                  pending: props.tasks.filter((task) => task.status === "pending").length,
                  completed: props.tasks.filter((task) => task.status === "completed").length,
                  total: props.tasks.length,
                })
              : undefined)
          }
          unreadNotifications={props.unreadNotifications}
          completedTasks={props.tasks.filter((task) => task.status === "completed").length}
          totalTasks={props.tasks.length}
          taskGroups={props.taskGroups}
        />
      </button>
    </div>
  )
}
