import { createEffect, createMemo, createSignal, For, onCleanup, Show, type Accessor } from "solid-js"
import { HoverCard } from "@novaway/ui/hover-card"
import type { AssistantMessage, Part as PartType, UserMessage } from "@novaway/sdk/v2"
import { useSync } from "@/context/sync"

const PREVIEW_CHARS = 220
const PREVIEW_PARAGRAPHS = 2
const emptyParts: PartType[] = []

function collapseWhitespace(text: string) {
  return text.replace(/\s+/gu, " ").trim()
}

function previewText(texts: string[], fallback: string) {
  const joined = texts.filter(Boolean).join("\n\n").trim()
  if (!joined) return fallback
  const text = joined
    .split(/\n\s*\n/u)
    .map(collapseWhitespace)
    .filter(Boolean)
    .slice(0, PREVIEW_PARAGRAPHS)
    .join("\n")
  return text.length <= PREVIEW_CHARS ? text : `${text.slice(0, PREVIEW_CHARS - 3).trimEnd()}...`
}

// 对齐 ZCode Turn Navigator 的视觉:悬停条区时按与聚焦条的距离衰减宽度/透明度;
// 未悬停时全部保持短条,只有当前激活条稍深,方便定位。
// 伸长封顶 2 倍(24px):条区落在聊天列与状态卡片的空隙里,伸长后不压聊天正文。
function barVisual(distance: number, extended: boolean, isActive: boolean) {
  if (!extended) return { opacity: isActive ? 0.85 : 0.45, scaleX: 1 }
  if (distance === 0) return { opacity: 1, scaleX: 2 }
  if (distance === 1) return { opacity: 0.86, scaleX: 1.6 }
  return { opacity: 0.6, scaleX: 1.3 }
}

export function TurnNavigator(props: {
  sessionID: Accessor<string | undefined>
  userMessages: UserMessage[]
  scrollRoot: Accessor<HTMLDivElement | undefined>
  // 状态面板打开时,聊天列右侧留了 344px(卡片 320px + 24px 空隙),条区落在空隙里。
  // 注意:组件必须挂在 session.tsx 的 conv 内容行那一层 —— 时间线内部有 overflow-hidden
  // 祖先(边界在聊天列内容边缘),条区伸进空隙的部分会被整段裁掉、一根条都看不见。
  statusPanelReserved: boolean
  onJumpToMessage: (message: UserMessage, behavior: ScrollBehavior) => void
}) {
  const sync = useSync()
  const getMsgParts = (messageID: string) => sync.data.part[messageID] ?? emptyParts

  // 只展示真正会在时间线渲染出一行的提问(纯 synthetic 输入没有可跳转的行)。
  const items = createMemo(() =>
    props.userMessages.filter((message) =>
      getMsgParts(message.id).some((part) => {
        if (part.type === "text") return !part.synthetic && !part.ignored && part.text.trim().length > 0
        return part.type === "file" || part.type === "agent" || part.type === "compaction"
      }),
    ),
  )

  const busy = createMemo(() => {
    const id = props.sessionID()
    if (!id) return false
    return (sync.data.session_status[id]?.type ?? "idle") !== "idle"
  })

  const [activeId, setActiveId] = createSignal<string | undefined>()
  const [hovered, setHovered] = createSignal<number>()
  const [stripHover, setStripHover] = createSignal(false)
  const activeIndex = createMemo(() => {
    const id = activeId()
    if (!id) return -1
    return items().findIndex((message) => message.id === id)
  })
  const focusIndex = createMemo(() => hovered() ?? activeIndex())
  // 鼠标指上条区才伸长,平时保持短条不占视觉。
  const extended = createMemo(() => stripHover() || hovered() !== undefined)

  const computeActive = () => {
    const root = props.scrollRoot()
    const list = items()
    if (!root || list.length === 0) {
      setActiveId(undefined)
      return
    }

    const ids = new Set(list.map((message) => message.id))
    const positions = new Map<string, { top: number; bottom: number }>()
    for (const el of root.querySelectorAll<HTMLElement>("[data-message-id]")) {
      const id = el.dataset.messageId
      if (!id || !ids.has(id)) continue
      const rect = el.getBoundingClientRect()
      const prev = positions.get(id)
      positions.set(id, {
        top: Math.min(prev?.top ?? rect.top, rect.top),
        bottom: Math.max(prev?.bottom ?? rect.bottom, rect.bottom),
      })
    }

    const box = root.getBoundingClientRect()
    const line = box.top + 100
    const ordered = list.flatMap((message) => {
      const position = positions.get(message.id)
      return position ? [{ id: message.id, top: position.top, bottom: position.bottom }] : []
    })
    const visible = ordered.filter((item) => item.bottom > box.top && item.top < box.bottom)
    const hit = visible.find((item) => item.top <= line && item.bottom >= line)
    const next =
      hit?.id ??
      [...visible].sort((a, b) => Math.abs(a.top - line) - Math.abs(b.top - line))[0]?.id ??
      ordered.filter((item) => item.top <= line).at(-1)?.id ??
      ordered[0]?.id
    setActiveId(next)
  }

  createEffect(() => {
    const root = props.scrollRoot()
    if (!root) return
    let frame: number | undefined
    const schedule = () => {
      if (frame !== undefined) return
      frame = requestAnimationFrame(() => {
        frame = undefined
        computeActive()
      })
    }
    schedule()
    root.addEventListener("scroll", schedule, { passive: true })
    onCleanup(() => {
      root.removeEventListener("scroll", schedule)
      if (frame !== undefined) cancelAnimationFrame(frame)
    })
  })

  createEffect(() => {
    void items()
    computeActive()
  })

  let strip: HTMLDivElement | undefined
  createEffect(() => {
    const index = activeIndex()
    if (index < 0 || !strip) return
    const el = strip.querySelector<HTMLElement>(`[data-bar-index="${index}"]`)
    if (!el) return
    const rect = el.getBoundingClientRect()
    const box = strip.getBoundingClientRect()
    if (rect.top < box.top) strip.scrollTop += rect.top - box.top
    else if (rect.bottom > box.bottom) strip.scrollTop += rect.bottom - box.bottom
  })

  return (
    <Show when={items().length >= 1}>
      <nav
        data-component="turn-navigator"
        aria-label="对话问题导航"
        class="pointer-events-none absolute inset-y-0 right-0 z-20 hidden w-12 @min-[768px]:block"
      >
        <div
          ref={(el) => {
            strip = el
          }}
          class="pointer-events-auto absolute top-1/2 max-h-[calc(100%-6rem)] w-6 -translate-y-1/2 overflow-x-hidden overflow-y-auto py-1"
          classList={{
            "right-[322px]": props.statusPanelReserved,
            "right-3": !props.statusPanelReserved,
          }}
          style={{ "scrollbar-width": "none" }}
          onPointerEnter={() => setStripHover(true)}
          onPointerLeave={() => {
            setStripHover(false)
            setHovered(undefined)
          }}
          onScroll={() => setHovered(undefined)}
        >
          <div class="relative w-6">
            <For each={items()}>
              {(message, index) => (
                <TurnNavigatorBar
                  message={message}
                  sessionID={props.sessionID}
                  index={index()}
                  setSize={items().length}
                  isActive={activeIndex() === index()}
                  isRunning={busy() && index() === items().length - 1}
                  extended={extended()}
                  focusIndex={focusIndex}
                  onHover={setHovered}
                  onJump={() =>
                    props.onJumpToMessage(
                      message,
                      window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
                    )
                  }
                />
              )}
            </For>
          </div>
        </div>
      </nav>
    </Show>
  )
}

function TurnNavigatorBar(props: {
  message: UserMessage
  sessionID: Accessor<string | undefined>
  index: number
  setSize: number
  isActive: boolean
  isRunning: boolean
  extended: boolean
  focusIndex: Accessor<number>
  onHover: (index: number | undefined) => void
  onJump: () => void
}) {
  const sync = useSync()
  const getMsgParts = (messageID: string) => sync.data.part[messageID] ?? emptyParts

  const userPreview = createMemo(() =>
    previewText(
      getMsgParts(props.message.id)
        .filter(
          (part): part is Extract<PartType, { type: "text" }> =>
            part.type === "text" && !part.synthetic && !part.ignored,
        )
        .map((part) => part.text),
      "用户输入",
    ),
  )

  const assistantPreview = createMemo(() => {
    const id = props.sessionID()
    const texts = id
      ? (sync.data.message[id] ?? [])
          .filter((message): message is AssistantMessage => message.role === "assistant" && message.parentID === props.message.id)
          .flatMap((message) => getMsgParts(message.id))
          .filter((part): part is Extract<PartType, { type: "text" }> => part.type === "text" && !part.synthetic)
          .map((part) => part.text)
      : []
    if (texts.some(Boolean)) return { kind: "text" as const, text: previewText(texts, "") }
    if (props.isRunning) return { kind: "running" as const, text: "助手仍在回复中…" }
    return { kind: "empty" as const, text: "暂无回复内容" }
  })

  const distance = createMemo(() => Math.abs(props.index - props.focusIndex()))
  const visual = createMemo(() => barVisual(distance(), props.extended, props.isActive))

  return (
    <div class="h-2.5 w-6" data-bar-index={props.index}>
      <HoverCard
        placement="left"
        gutter={8}
        openDelay={120}
        closeDelay={80}
        trigger={
          <button
            type="button"
            aria-label={`跳转到第 ${props.index + 1} 条提问`}
            aria-posinset={props.index + 1}
            aria-setsize={props.setSize}
            aria-current={props.isActive ? "location" : undefined}
            data-bar-active={props.isActive ? "true" : "false"}
            class="flex h-2.5 w-6 cursor-pointer items-center justify-end rounded-sm border-none bg-transparent p-0 outline-none"
            onPointerEnter={() => props.onHover(props.index)}
            onPointerLeave={() => props.onHover(undefined)}
            onFocus={() => props.onHover(props.index)}
            onBlur={() => props.onHover(undefined)}
            onClick={props.onJump}
          >
            <span
              class="block h-0.5 w-3 origin-right rounded-full transition-[opacity,transform,background-color] duration-150 ease-out"
              classList={{
                "bg-foreground": distance() === 0,
                "bg-foreground-subtlest": distance() !== 0,
              }}
              style={{ opacity: visual().opacity, transform: `scaleX(${visual().scaleX})` }}
            />
          </button>
        }
      >
        <div class="w-72 px-2.5 py-2">
          <p class="line-clamp-2 whitespace-pre-line text-12-medium leading-5 text-foreground">{userPreview()}</p>
          <p
            classList={{
              "mt-1.5 line-clamp-3 whitespace-pre-line text-12-regular leading-5": true,
              "text-foreground-subtle": assistantPreview().kind === "text",
              "text-foreground-subtlest": assistantPreview().kind !== "text",
            }}
          >
            {assistantPreview().text}
          </p>
        </div>
      </HoverCard>
    </div>
  )
}
