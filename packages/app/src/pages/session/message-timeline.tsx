import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Index,
  Match,
  Switch,
  on,
  onCleanup,
  Show,
  mapArray,
  untrack,
  type Accessor,
  type JSX,
} from "solid-js"
import { createStore, produce } from "solid-js/store"
import { Dynamic } from "solid-js/web"
import { useNavigate } from "@solidjs/router"
import { useMutation, useQueryClient } from "@tanstack/solid-query"
import { Virtualizer, type VirtualizerHandle } from "virtua/solid"
import { Accordion } from "@opencode-ai/ui/accordion"
import { Button } from "@opencode-ai/ui/button"
import { Card } from "@opencode-ai/ui/card"
import {
  ContextToolGroup,
  Message,
  MessageDivider,
  Part as MessagePart,
  partDefaultOpen,
  type UserActions,
} from "@opencode-ai/ui/message-part"
import { DiffChanges } from "@opencode-ai/ui/diff-changes"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Icon } from "@opencode-ai/ui/icon"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Dialog } from "@opencode-ai/ui/dialog"
import { InlineInput } from "@opencode-ai/ui/inline-input"
import { SessionRetry } from "@opencode-ai/ui/session-retry"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { StickyAccordionHeader } from "@opencode-ai/ui/sticky-accordion-header"
import { TextReveal } from "@opencode-ai/ui/text-reveal"
import { TextShimmer } from "@opencode-ai/ui/text-shimmer"
import type {
  AssistantMessage,
  Message as MessageType,
  Part as PartType,
  ToolPart,
  UserMessage,
} from "@opencode-ai/sdk/v2"
import { showToast } from "@opencode-ai/ui/toast"
import { Binary } from "@opencode-ai/core/util/binary"
import { getDirectory, getFilename } from "@opencode-ai/core/util/path"
import { normalize } from "@opencode-ai/ui/session-diff"
import { useFileComponent } from "@opencode-ai/ui/context/file"
import { shouldMarkBoundaryGesture, normalizeWheelDelta } from "@/pages/session/message-gesture"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { useLanguage } from "@/context/language"
import { useSessionLayout } from "@/pages/session/session-layout"
import { useGlobalSDK } from "@/context/global-sdk"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useFile } from "@/context/file"
import { messageAgentColor } from "@/utils/agent"
import { sessionTitle } from "@/utils/session-title"
import { makeTimer } from "@solid-primitives/timer"
import { MessageComment, SummaryDiff, Timeline, TimelineRow, TimelineRowMap } from "./message-timeline.data"
import { useOfficeAgent } from "./office-agent-context"
import { extractOfficeArtifact, visibleOfficeMessage, type OfficeArtifact, type OfficeSlide } from "./office-artifact"
import {
  bytesToBase64,
  createCustomPptTemplate,
  createOfficeExportFile,
  createOfficeHtmlExportFile,
  officeArtifactKind,
  officePptTemplateDescription,
  officePptTemplateName,
  officePptTemplates,
  type OfficePptTemplateChoice,
} from "./office-export"
import { evaluateOfficeArtifactQuality } from "./office-quality"
import {
  fillOfficePptxTemplate,
  officePptxFillPlanFromArtifact,
  officePptxFillPlanSummary,
  officePptxTemplateFillFilename,
} from "./office-template-fill"

const emptyMessages: MessageType[] = []
const emptyParts: PartType[] = []
const emptyTools: ToolPart[] = []
const emptyAssistantMessages: AssistantMessage[] = []
const idle = { type: "idle" as const }

type FramedTimelineRow = Exclude<TimelineRow.TimelineRow, { _tag: "BottomSpacer" }>
type TimelineRowByTag<T extends TimelineRow.TimelineRow["_tag"]> = Extract<TimelineRow.TimelineRow, { _tag: T }>

function sameKeys(a: readonly string[] | undefined, b: readonly string[] | undefined) {
  if (a === b) return true
  if (!a || !b) return false
  if (a.length !== b.length) return false
  return a.every((key, index) => key === b[index])
}

const timelineCacheLimit = 16
const timelineFallbackItemSize = 60
const timelineCache = new Map<string, { keys: readonly string[]; cache: VirtualizerHandle["cache"] }>()

function readTimelineCache(id: string, keys: readonly string[]) {
  const entry = timelineCache.get(id)
  if (!entry) return
  if (sameKeys(entry.keys, keys)) return entry.cache
  timelineCache.delete(id)
}

function writeTimelineCache(id: string, keys: readonly string[], handle: VirtualizerHandle | undefined) {
  if (!handle || keys.length === 0) return
  timelineCache.delete(id)
  timelineCache.set(id, { keys: keys.slice(), cache: handle.cache })
  while (timelineCache.size > timelineCacheLimit) timelineCache.delete(timelineCache.keys().next().value!)
}

function reuseTimelineRows(previous: TimelineRow.TimelineRow[] | undefined, rows: TimelineRow.TimelineRow[]) {
  if (!previous?.length) return rows
  const byKey = new Map(previous.map((row) => [TimelineRow.key(row), row] as const))
  return rows.map((row) => {
    const existing = byKey.get(TimelineRow.key(row))
    if (!existing) return row
    return TimelineRow.equals(existing, row) ? existing : row
  })
}

const taskDescription = (part: PartType, sessionID: string) => {
  if (part.type !== "tool" || part.tool !== "task") return
  const metadata = "metadata" in part.state ? part.state.metadata : undefined
  if (metadata?.sessionId !== sessionID) return
  const value = part.state.input?.description
  if (typeof value === "string" && value) return value
}

const officeArtifact = (part: PartType) => {
  if (part.type !== "text") return
  return extractOfficeArtifact(part.text ?? "")
}

const visibleOfficePart = (part: PartType): PartType => {
  if (part.type !== "text" || !part.text?.includes("可沉淀记忆/可进化建议")) return part
  return { ...part, text: visibleOfficeMessage(part.text) }
}

const pace = (width: number) => Math.round(Math.max(1200, Math.min(3200, (Math.max(width, 360) * 2000) / 900)))

const boundaryTarget = (root: HTMLElement, target: EventTarget | null) => {
  const current = target instanceof Element ? target : undefined
  const nested = current?.closest("[data-scrollable]")
  if (!nested || nested === root) return root
  if (!(nested instanceof HTMLElement)) return root
  return nested
}

const markBoundaryGesture = (input: {
  root: HTMLDivElement
  target: EventTarget | null
  delta: number
  onMarkScrollGesture: (target?: EventTarget | null) => void
}) => {
  const target = boundaryTarget(input.root, input.target)
  if (target === input.root) {
    input.onMarkScrollGesture(input.root)
    return
  }
  if (
    shouldMarkBoundaryGesture({
      delta: input.delta,
      scrollTop: target.scrollTop,
      scrollHeight: target.scrollHeight,
      clientHeight: target.clientHeight,
    })
  ) {
    input.onMarkScrollGesture(input.root)
  }
}

function TimelineThinkingRow(props: { reasoningHeading?: string; showReasoningSummaries: boolean }) {
  const language = useLanguage()

  return (
    <div data-slot="session-turn-thinking">
      <TextShimmer text={language.t("ui.sessionTurn.status.thinking")} />
      <Show when={!props.showReasoningSummaries}>
        <TextReveal text={props.reasoningHeading} class="session-turn-thinking-heading" travel={25} duration={700} />
      </Show>
    </div>
  )
}

function TimelineDiffSummaryRow(props: { diffs: SummaryDiff[] }) {
  const language = useLanguage()
  const maxFiles = 10
  const [state, setState] = createStore({
    showAll: false,
    expanded: [] as string[],
  })
  const showAll = () => state.showAll
  const expanded = () => state.expanded
  const overflow = createMemo(() => Math.max(0, props.diffs.length - maxFiles))
  const visible = createMemo(() => (showAll() ? props.diffs : props.diffs.slice(0, maxFiles)))
  const changedLabel = createMemo(() =>
    language.t(
      props.diffs.length === 1 ? "ui.sessionTurn.diffs.changed.one" : "ui.sessionTurn.diffs.changed.other",
      { count: String(props.diffs.length) },
    ),
  )

  return (
    <div
      data-slot="session-turn-diffs"
      data-component="session-turn-diffs-group"
      data-show-all={showAll() || undefined}
    >
      <div data-slot="session-turn-diffs-header">
        <span data-slot="session-turn-diffs-label">{changedLabel()}</span>
        <DiffChanges changes={props.diffs} />
        <Show when={overflow() > 0}>
          <span data-slot="session-turn-diffs-toggle" onClick={() => setState("showAll", !showAll())}>
            {showAll() ? language.t("ui.sessionTurn.diffs.showLess") : language.t("ui.sessionTurn.diffs.showAll")}
          </span>
        </Show>
      </div>
      <div data-component="session-turn-diffs-content">
        <Accordion
          multiple
          style={{ "--sticky-accordion-offset": "44px" }}
          value={expanded()}
          onChange={(value) => setState("expanded", Array.isArray(value) ? value : value ? [value] : [])}
        >
          <For each={visible()}>
            {(diff) => {
              const opened = createMemo(() => expanded().includes(diff.file))

              return (
                <Accordion.Item value={diff.file}>
                  <StickyAccordionHeader>
                    <Accordion.Trigger>
                      <div data-slot="session-turn-diff-trigger">
                        <span data-slot="session-turn-diff-path">
                          <Show when={diff.file.includes("/")}>
                            <span data-slot="session-turn-diff-directory">{`\u202A${getDirectory(diff.file)}\u202C`}</span>
                          </Show>
                          <span data-slot="session-turn-diff-filename">{getFilename(diff.file)}</span>
                        </span>
                        <div data-slot="session-turn-diff-meta">
                          <span data-slot="session-turn-diff-changes">
                            <DiffChanges changes={diff} />
                          </span>
                          <span data-slot="session-turn-diff-chevron">
                            <Icon name="chevron-down" size="small" />
                          </span>
                        </div>
                      </div>
                    </Accordion.Trigger>
                  </StickyAccordionHeader>
                  <Accordion.Content>
                    <Show when={opened()}>
                      <TimelineDiffView diff={diff} />
                    </Show>
                  </Accordion.Content>
                </Accordion.Item>
              )
            }}
          </For>
        </Accordion>
        <Show when={!showAll() && overflow() > 0}>
          <div data-slot="session-turn-diffs-more" onClick={() => setState("showAll", true)}>
            {language.t("ui.sessionTurn.diffs.more", { count: String(overflow()) })}
          </div>
        </Show>
      </div>
    </div>
  )
}

function TimelineDiffView(props: { diff: SummaryDiff }) {
  const fileComponent = useFileComponent()
  const view = normalize(props.diff)

  return (
    <div data-slot="session-turn-diff-view" data-scrollable>
      <Dynamic component={fileComponent} mode="diff" virtualize={false} fileDiff={view.fileDiff} />
    </div>
  )
}

export function MessageTimeline(props: {
  actions?: UserActions
  scroll: { overflow: boolean; bottom: boolean; jump: boolean }
  onResumeScroll: () => void
  setScrollRef: (el: HTMLDivElement | undefined) => void
  onScheduleScrollState: (el: HTMLDivElement) => void
  onAutoScrollHandleScroll: () => void
  onMarkScrollGesture: (target?: EventTarget | null) => void
  hasScrollGesture: () => boolean
  onUserScroll: () => void
  onHistoryScroll: () => void
  onAutoScrollInteraction: (event: MouseEvent) => void
  shouldAnchorBottom: () => boolean
  centered: boolean
  setContentRef: (el: HTMLDivElement) => void
  historyShift: boolean
  userMessages: UserMessage[]
  anchor: (id: string) => string
  setRevealMessage?: (fn: (id: string) => void) => void
}) {
  let touchGesture: number | undefined

  const navigate = useNavigate()
  const globalSDK = useGlobalSDK()
  const sdk = useSDK()
  const sync = useSync()
  const queryClient = useQueryClient()
  const settings = useSettings()
  const dialog = useDialog()
  const language = useLanguage()
  const { params, sessionKey, tabs } = useSessionLayout()
  const file = useFile()
  const platform = usePlatform()

  let virtualizer: VirtualizerHandle | undefined
  const sessionID = createMemo(() => params.id)
  const sessionMessages = createMemo(() => {
    const id = sessionID()
    if (!id) return emptyMessages
    return sync.data.message[id] ?? emptyMessages
  })
  const messageByID = createMemo(() => new Map(sessionMessages().map((message) => [message.id, message] as const)))
  const assistantMessagesByParent = createMemo(() => {
    const result = new Map<string, AssistantMessage[]>()
    for (const message of sessionMessages()) {
      if (message.role !== "assistant") continue
      const messages = result.get(message.parentID)
      if (messages) {
        messages.push(message)
        continue
      }
      result.set(message.parentID, [message])
    }
    return result
  })
  const pending = createMemo(() =>
    sessionMessages().findLast(
      (item): item is AssistantMessage => item.role === "assistant" && typeof item.time.completed !== "number",
    ),
  )
  const sessionStatus = createMemo(() => {
    const id = sessionID()
    if (!id) return idle
    return sync.data.session_status[id] ?? idle
  })
  const working = createMemo(() => sessionStatus().type !== "idle")
  const tint = createMemo(() => messageAgentColor(sessionMessages(), sync.data.agent))

  const [timeoutDone, setTimeoutDone] = createSignal(true)

  const workingStatus = createMemo<"hidden" | "showing" | "hiding">((prev) => {
    if (working()) return "showing"
    if (prev === "showing" || !timeoutDone()) return "hiding"
    return "hidden"
  })

  createEffect(() => {
    if (workingStatus() !== "hiding") return

    setTimeoutDone(false)
    makeTimer(() => setTimeoutDone(true), 260, setTimeout)
  })

  const activeMessageID = createMemo(() => {
    const parentID = pending()?.parentID
    if (parentID) {
      const messages = sessionMessages()
      const result = Binary.search(messages, parentID, (message) => message.id)
      const message = result.found ? messages[result.index] : messages.find((item) => item.id === parentID)
      if (message && message.role === "user") return message.id
    }

    const status = sessionStatus()
    if (status.type !== "idle") {
      const messages = sessionMessages()
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "user") return messages[i].id
      }
    }

    return undefined
  })
  const info = createMemo(() => {
    const id = sessionID()
    if (!id) return
    return sync.session.get(id)
  })
  const titleValue = createMemo(() => info()?.title)
  const titleLabel = createMemo(() => sessionTitle(titleValue()))
  const parentID = createMemo(() => info()?.parentID)
  const parent = createMemo(() => {
    const id = parentID()
    if (!id) return
    return sync.session.get(id)
  })
  const parentMessages = createMemo(() => {
    const id = parentID()
    if (!id) return emptyMessages
    return sync.data.message[id] ?? emptyMessages
  })
  const parentTitle = createMemo(() => sessionTitle(parent()?.title) ?? language.t("command.session.new"))
  const getMsgParts = (msgId: string) => sync.data.part[msgId] ?? emptyParts
  const childTaskDescription = createMemo(() => {
    const id = sessionID()
    if (!id) return
    return parentMessages()
      .flatMap((message) => getMsgParts(message.id))
      .map((part) => taskDescription(part, id))
      .findLast((value): value is string => !!value)
  })
  const childTitle = createMemo(() => {
    if (!parentID()) return titleLabel() ?? ""
    if (childTaskDescription()) return childTaskDescription()
    const value = titleLabel()?.replace(/\s+\(@[^)]+ subagent\)$/, "")
    if (value) return value
    return language.t("command.session.new")
  })
  const showHeader = createMemo(() => !!(titleValue() || parentID()))

  const messageRowMemos = createMemo(
    mapArray(
      () => props.userMessages,
      (userMessage, indexAccessor) => {
        return createMemo((previous: TimelineRow.TimelineRow[] | undefined) => {
          const rows = Timeline.constructMessageRows(
            userMessage,
            getMsgParts,
            assistantMessagesByParent().get(userMessage.id) ?? emptyAssistantMessages,
            indexAccessor(),
            settings.general.showReasoningSummaries(),
            sessionStatus().type,
            activeMessageID() === userMessage.id,
          )

          return reuseTimelineRows(previous, rows)
        })
      },
    ),
  )

  const timelineRows = createMemo((previous: TimelineRow.TimelineRow[] | undefined) => {
    const rows = messageRowMemos().flatMap((memo) => memo())
    if (rows.length === 0) return rows
    return reuseTimelineRows(previous, [...rows, new TimelineRow.BottomSpacer()])
  })
  const timelineRowByKey = createMemo(() => new Map(timelineRows().map((row) => [TimelineRow.key(row), row] as const)))
  const timelineRowKeys = createMemo(() => [...timelineRowByKey().keys()], [] as string[], { equals: sameKeys })
  const virtualCache = createMemo(() => readTimelineCache(sessionKey(), timelineRowKeys()))
  const messageRowIndex = createMemo(() => {
    const result = new Map<string, number>()
    timelineRows().forEach((row, index) => {
      if (!("userMessageID" in row)) return
      if (result.has(row.userMessageID)) return
      result.set(row.userMessageID, index)
    })
    return result
  })
  const keepMounted = createMemo(() => {
    const id = activeMessageID()
    if (!id) return
    const rows = timelineRows()
    const index = rows.findLastIndex((row) => "userMessageID" in row && row.userMessageID === id)
    if (index < 0) return
    return [index]
  })
  const activeAssistantMessages = createMemo(() => {
    const id = activeMessageID() ?? props.userMessages[props.userMessages.length - 1]?.id
    if (!id) return emptyAssistantMessages
    return assistantMessagesByParent().get(id) ?? emptyAssistantMessages
  })
  const activeAssistantContentVersion = createMemo(() =>
    activeAssistantMessages()
      .flatMap((message) => [
        `${message.id}:${message.time.completed ?? ""}:${message.error?.name ?? ""}`,
        ...getMsgParts(message.id).map((part) => {
          if (part.type === "text" || part.type === "reasoning") return `${part.id}:${part.type}:${part.text.length}`
          if (part.type === "tool") {
            const metadata = "metadata" in part.state ? part.state.metadata : undefined
            const output =
              "output" in part.state && typeof part.state.output === "string" ? part.state.output.length : 0
            const metadataOutput =
              metadata && typeof metadata === "object" && "output" in metadata && typeof metadata.output === "string"
                ? metadata.output.length
                : 0
            return `${part.id}:${part.tool}:${part.state.status}:${output}:${metadataOutput}`
          }
          return `${part.id}:${part.type}`
        }),
      ])
      .join("|"),
  )

  createEffect(
    on(
      () => [timelineRowKeys(), activeAssistantContentVersion(), sessionStatus().type] as const,
      () => {
        if (!virtualizer) return
        if (!props.shouldAnchorBottom() && !measuredBottomAnchored) return
        const keys = timelineRowKeys()
        if (keys.length === 0) return
        virtualizer.scrollToIndex(keys.length - 1, { align: "end" })
        scheduleMeasuredBottomAnchor()
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    props.setRevealMessage?.((id) => {
      const index = messageRowIndex().get(id)
      if (index === undefined) return
      virtualizer?.scrollToIndex(index, { align: "center" })
    })
  })

  let cacheSessionKey = sessionKey()
  let cacheRowKeys = timelineRowKeys()
  let virtualizerSessionKey = cacheSessionKey
  let virtualizerRowKeys = cacheRowKeys
  let bottomAnchorSessionKey = ""

  const maybeAnchorBottom = () => {
    const key = sessionKey()
    if (bottomAnchorSessionKey === key) return
    if (!virtualizer) return
    const keys = timelineRowKeys()
    if (keys.length === 0) return
    bottomAnchorSessionKey = key
    if (!props.shouldAnchorBottom()) return
    virtualizer.scrollToIndex(keys.length - 1, { align: "end" })
  }

  createEffect(
    on(
      () => [sessionKey(), timelineRowKeys()] as const,
      (next, prev) => {
        if (prev && prev[0] !== next[0]) writeTimelineCache(prev[0], prev[1], virtualizer)
        cacheSessionKey = next[0]
        cacheRowKeys = next[1]
        if (virtualizer) {
          virtualizerSessionKey = cacheSessionKey
          virtualizerRowKeys = cacheRowKeys
          maybeAnchorBottom()
        }
      },
      { defer: true },
    ),
  )

  onCleanup(() => {
    writeTimelineCache(virtualizerSessionKey, virtualizerRowKeys, virtualizer)
    props.setRevealMessage?.(() => {})
  })

  const [title, setTitle] = createStore({
    draft: "",
    editing: false,
  })
  let titleRef: HTMLInputElement | undefined
  const [bar, setBar] = createStore({
    ms: pace(640),
  })

  let head: HTMLDivElement | undefined
  let listRoot: HTMLDivElement | undefined
  let listFrame: number | undefined
  let contentFrame: number | undefined
  let bottomAnchorFrame: number | undefined
  let bottomAnchorFrames = 0
  let measuredBottomAnchored = true
  const [scrollRoot, setScrollRoot] = createSignal<HTMLDivElement>()

  const updateTitleMetrics = () => {
    if (!head || head.clientWidth <= 0) return
    setBar("ms", pace(head.clientWidth))
  }

  createResizeObserver(() => head, updateTitleMetrics)

  const isMeasuredBottom = (root: HTMLDivElement) => root.scrollHeight - root.clientHeight - root.scrollTop <= 4

  function anchorMeasuredBottom() {
    if (!listRoot) return false
    if (!measuredBottomAnchored) return false
    listRoot.scrollTop = listRoot.scrollHeight
    return true
  }

  function scheduleMeasuredBottomAnchor() {
    // Workaround for virtua issue #301: virtua does not expose a synchronous item-resize hook for
    // "stay at bottom if already at bottom". Tool rows can briefly outgrow the measured virtual
    // height, so keep the scroll container bottom-locked for a few frames while measurement settles.
    bottomAnchorFrames = 90
    if (bottomAnchorFrame !== undefined) return

    const tick = () => {
      bottomAnchorFrame = undefined
      if (!anchorMeasuredBottom()) {
        bottomAnchorFrames = 0
        return
      }

      bottomAnchorFrames = working() ? 12 : bottomAnchorFrames - 1
      if (bottomAnchorFrames <= 0) return
      bottomAnchorFrame = requestAnimationFrame(tick)
    }

    bottomAnchorFrame = requestAnimationFrame(tick)
  }

  const bindContentRoot = (root: HTMLDivElement) => {
    const child = root.firstElementChild
    props.setContentRef(child instanceof HTMLDivElement ? child : root)
  }

  const scheduleContentRoot = (root: HTMLDivElement) => {
    if (contentFrame !== undefined) cancelAnimationFrame(contentFrame)
    contentFrame = requestAnimationFrame(() => {
      contentFrame = undefined
      if (listRoot !== root) return
      bindContentRoot(root)
    })
  }

  const connectListRoot = (root: HTMLDivElement) => {
    if (listRoot !== root) return
    if (!root.isConnected || !root.ownerDocument.defaultView) {
      listFrame = requestAnimationFrame(() => {
        listFrame = undefined
        connectListRoot(root)
      })
      return
    }

    props.setScrollRef(root)
    measuredBottomAnchored = isMeasuredBottom(root)
    setScrollRoot(root)
    scheduleContentRoot(root)
  }

  const bindListRoot = (root: HTMLDivElement) => {
    if (root === listRoot) return

    if (listFrame !== undefined) cancelAnimationFrame(listFrame)
    if (contentFrame !== undefined) cancelAnimationFrame(contentFrame)
    listRoot = root
    setScrollRoot(undefined)
    connectListRoot(root)
  }

  const handleListWheel = (event: WheelEvent & { currentTarget: HTMLDivElement }) => {
    const root = event.currentTarget
    const delta = normalizeWheelDelta({
      deltaY: event.deltaY,
      deltaMode: event.deltaMode,
      rootHeight: root.clientHeight,
    })
    if (!delta) return
    markBoundaryGesture({ root, target: event.target, delta, onMarkScrollGesture: props.onMarkScrollGesture })
  }

  const handleListTouchStart = (event: TouchEvent) => {
    touchGesture = event.touches[0]?.clientY
  }

  const handleListTouchMove = (event: TouchEvent & { currentTarget: HTMLDivElement }) => {
    const next = event.touches[0]?.clientY
    const prev = touchGesture
    touchGesture = next
    if (next === undefined || prev === undefined) return

    const delta = prev - next
    if (!delta) return

    markBoundaryGesture({
      root: event.currentTarget,
      target: event.target,
      delta,
      onMarkScrollGesture: props.onMarkScrollGesture,
    })
  }

  const handleListTouchEnd = () => {
    touchGesture = undefined
  }

  const handleListPointerDown = (event: PointerEvent & { currentTarget: HTMLDivElement }) => {
    if (event.target !== event.currentTarget) return
    props.onMarkScrollGesture(event.currentTarget)
  }

  const handleListScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    measuredBottomAnchored = isMeasuredBottom(event.currentTarget)
    props.onScheduleScrollState(event.currentTarget)
    props.onHistoryScroll()
    if (!props.hasScrollGesture()) return
    props.onUserScroll()
    props.onAutoScrollHandleScroll()
    props.onMarkScrollGesture(event.currentTarget)
  }

  onCleanup(() => {
    if (listFrame !== undefined) cancelAnimationFrame(listFrame)
    if (contentFrame !== undefined) cancelAnimationFrame(contentFrame)
    if (bottomAnchorFrame !== undefined) cancelAnimationFrame(bottomAnchorFrame)
    setScrollRoot(undefined)
    props.setScrollRef(undefined)
  })

  const errorMessage = (err: unknown) => {
    if (err && typeof err === "object" && "data" in err) {
      const data = (err as { data?: { message?: string } }).data
      if (data?.message) return data.message
    }
    if (err instanceof Error) return err.message
    return language.t("common.requestFailed")
  }

  const titleMutation = useMutation(() => ({
    mutationFn: (input: { id: string; title: string }) =>
      sdk.client.session.update({ sessionID: input.id, title: input.title }),
    onSuccess: (_, input) => {
      sync.set(
        produce((draft) => {
          const index = draft.session.findIndex((s) => s.id === input.id)
          if (index !== -1) draft.session[index].title = input.title
        }),
      )
      setTitle("editing", false)
    },
    onError: (err) => {
      showToast({
        title: language.t("common.requestFailed"),
        description: errorMessage(err),
      })
    },
  }))

  createEffect(
    on(
      sessionKey,
      () =>
        setTitle({
          draft: "",
          editing: false,
        }),
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => [parentID(), childTaskDescription()] as const,
      ([id, description]) => {
        if (!id || description) return
        if (sync.data.message[id] !== undefined) return
        void sync.session.sync(id)
      },
      { defer: true },
    ),
  )

  const openTitleEditor = () => {
    if (!sessionID() || parentID()) return
    setTitle({ editing: true, draft: titleLabel() ?? "" })
    requestAnimationFrame(() => {
      titleRef?.focus()
      titleRef?.select()
    })
  }

  const closeTitleEditor = () => {
    if (titleMutation.isPending) return
    setTitle("editing", false)
  }

  const saveTitleEditor = () => {
    const id = sessionID()
    if (!id) return
    if (titleMutation.isPending) return

    const next = title.draft.trim()
    if (!next || next === (titleLabel() ?? "")) {
      setTitle("editing", false)
      return
    }

    titleMutation.mutate({ id, title: next })
  }

  const navigateAfterSessionRemoval = (sessionID: string, parentID?: string, nextSessionID?: string) => {
    if (params.id !== sessionID) return
    if (parentID) {
      navigate(`/${params.dir}/session/${parentID}`)
      return
    }
    if (nextSessionID) {
      navigate(`/${params.dir}/session/${nextSessionID}`)
      return
    }
    navigate(`/${params.dir}/session`)
  }

  const deleteSession = async (sessionID: string) => {
    const session = sync.session.get(sessionID)
    if (!session) return false

    const sessions = (sync.data.session ?? []).filter((s) => !s.parentID && !s.time?.archived)
    const index = sessions.findIndex((s) => s.id === sessionID)
    const nextSession = index === -1 ? undefined : (sessions[index + 1] ?? sessions[index - 1])

    const result = await sdk.client.session
      .delete({ sessionID })
      .then((x) => x.data)
      .catch((err) => {
        showToast({
          title: language.t("session.delete.failed.title"),
          description: errorMessage(err),
        })
        return false
      })

    if (!result) return false

    sync.set(
      produce((draft) => {
        const removed = new Set<string>([sessionID])

        const byParent = new Map<string, string[]>()
        for (const item of draft.session) {
          const parentID = item.parentID
          if (!parentID) continue
          const existing = byParent.get(parentID)
          if (existing) {
            existing.push(item.id)
            continue
          }
          byParent.set(parentID, [item.id])
        }

        const stack = [sessionID]
        while (stack.length) {
          const parentID = stack.pop()
          if (!parentID) continue

          const children = byParent.get(parentID)
          if (!children) continue

          for (const child of children) {
            if (removed.has(child)) continue
            removed.add(child)
            stack.push(child)
          }
        }

        draft.session = draft.session.filter((s) => !removed.has(s.id))
      }),
    )

    navigateAfterSessionRemoval(sessionID, session.parentID, nextSession?.id)
    return true
  }

  const navigateParent = () => {
    const id = parentID()
    if (!id) return
    navigate(`/${params.dir}/session/${id}`)
  }

  function DialogDeleteSession(props: { sessionID: string }) {
    const name = createMemo(
      () => sessionTitle(sync.session.get(props.sessionID)?.title) ?? language.t("command.session.new"),
    )
    const handleDelete = async () => {
      await deleteSession(props.sessionID)
      dialog.close()
    }

    return (
      <Dialog title={language.t("session.delete.title")} fit>
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
          <div class="flex flex-col gap-1">
            <span class="text-14-regular text-text-strong">
              {language.t("session.delete.confirm", { name: name() })}
            </span>
          </div>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button variant="primary" size="large" onClick={handleDelete}>
              {language.t("session.delete.button")}
            </Button>
          </div>
        </div>
      </Dialog>
    )
  }

  const workingTurn = (userMessageID: string) => sessionStatus().type !== "idle" && activeMessageID() === userMessageID

  const turnDurationMs = (userMessageID: string) => {
    const message = messageByID().get(userMessageID)
    if (!message || message.role !== "user") return
    const end = (assistantMessagesByParent().get(userMessageID) ?? emptyAssistantMessages).reduce<number | undefined>(
      (max, item) => {
        const completed = item.time.completed
        if (typeof completed !== "number") return max
        if (max === undefined) return completed
        return Math.max(max, completed)
      },
      undefined,
    )
    if (typeof end !== "number") return
    if (end < message.time.created) return
    return end - message.time.created
  }

  const assistantCopyPartID = (userMessageID: string) => {
    if (workingTurn(userMessageID)) return null
    const messages = assistantMessagesByParent().get(userMessageID) ?? emptyAssistantMessages

    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]
      if (!message) continue

      const parts = getMsgParts(message.id)
      for (let j = parts.length - 1; j >= 0; j--) {
        const part = parts[j]
        if (!part || part.type !== "text" || !part.text?.trim()) continue
        return part.id
      }
    }
  }

  const getMsgPart = (messageID: string, partID: string) => getMsgParts(messageID).find((part) => part.id === partID)
  const openOutputFile = (path: string) => {
    const normalized = file.normalize(path)
    if (!normalized) return
    void file.load(normalized)
    const tab = file.tab(normalized)
    void tabs().open(tab)
    tabs().setActive(tab)
  }

  const renderAssistantPartGroup = (row: Accessor<TimelineRowMap["AssistantPart"]>) => {
    if (untrack(row).group.type === "context") {
      const parts = createMemo(() => {
        const group = row().group
        if (group.type !== "context") return emptyTools
        return group.refs
          .map((ref) => getMsgPart(ref.messageID, ref.partID))
          .filter((part): part is ToolPart => part?.type === "tool")
      })

      return <ContextToolGroup parts={parts()} busy={workingTurn(row().userMessageID) && row().lastAssistantPart} />
    }

    const message = createMemo(() => {
      const group = row().group
      if (group.type !== "part") return
      return messageByID().get(group.ref.messageID)
    })
    const part = createMemo(() => {
      const group = row().group
      if (group.type !== "part") return
      return getMsgPart(group.ref.messageID, group.ref.partID)
    })

    return (
      <Show when={message()}>
        {(message) => (
          <Show when={part()}>
            {(part) => (
              <>
                <MessagePart
                  part={visibleOfficePart(part())}
                  message={message()}
                  showAssistantCopyPartID={assistantCopyPartID(row().userMessageID)}
                  turnDurationMs={turnDurationMs(row().userMessageID)}
                  defaultOpen={partDefaultOpen(
                    part(),
                    settings.general.shellToolPartsExpanded(),
                    settings.general.editToolPartsExpanded(),
                  )}
                  deferToolContent={false}
                  onFileOpen={openOutputFile}
                />
                <Show when={officeArtifact(part())}>
                  {(artifact) => <OfficeArtifactActions artifact={artifact()} agent={message().agent} />}
                </Show>
              </>
            )}
          </Show>
        )}
      </Show>
    )
  }

  function OfficeArtifactActions(input: { artifact: OfficeArtifact; agent?: string }) {
    const office = useOfficeAgent()
    const kind = () => officeArtifactKind(input.artifact, input.agent)
    const quality = () => evaluateOfficeArtifactQuality(input.artifact, kind())
    const pptTemplate = () => office.pptTemplate()
    const setPptTemplate = (template: OfficePptTemplateChoice) => office.selectPptTemplate(template)
    const selectedCustomTemplate = createMemo(() => {
      const template = office.pptTemplate()
      return typeof template === "object" ? template : undefined
    })
    const fillPlan = createMemo(() => officePptxFillPlanFromArtifact(input.artifact))
    const fillSummary = createMemo(() => officePptxFillPlanSummary(fillPlan()))
    const actionButton =
      "group inline-flex items-center gap-1.5 rounded-[8px] border border-border-weak-base bg-background-base px-2.5 py-1.5 text-12-medium text-text-weak shadow-[0_0_0_0_rgba(16,185,129,0)] outline-none transition-all duration-150 hover:-translate-y-px hover:border-emerald-300/55 hover:bg-emerald-300/[0.08] hover:text-emerald-100 hover:shadow-[0_8px_22px_rgba(16,185,129,0.12)] active:translate-y-0 active:scale-[0.98] active:border-emerald-300/70 active:bg-emerald-300/[0.14] focus-visible:border-emerald-300/70 focus-visible:ring-2 focus-visible:ring-emerald-300/25"
    const primaryActionButton =
      "group inline-flex items-center gap-1.5 rounded-[8px] border border-emerald-300/40 bg-emerald-300/10 px-2.5 py-1.5 text-12-medium text-emerald-100 shadow-[0_0_0_0_rgba(16,185,129,0)] outline-none transition-all duration-150 hover:-translate-y-px hover:border-emerald-300/70 hover:bg-emerald-300/18 hover:shadow-[0_8px_24px_rgba(16,185,129,0.16)] active:translate-y-0 active:scale-[0.98] active:bg-emerald-300/22 focus-visible:border-emerald-300/80 focus-visible:ring-2 focus-visible:ring-emerald-300/30 disabled:cursor-not-allowed disabled:translate-y-0 disabled:scale-100 disabled:opacity-60 disabled:shadow-none"
    const save = useMutation(() => ({
      mutationFn: async () => {
        const file = createOfficeExportFile(input.artifact, { pptTemplate: pptTemplate() })
        const result = await globalSDK.client.office.artifact.save({
          directory: sdk.directory,
          kind: kind(),
          filename: file.filename,
          mime: file.mime,
          contentBase64: bytesToBase64(file.bytes),
        })
        return result.data
      },
      onSuccess: (result) => {
        void queryClient.invalidateQueries({ queryKey: ["office-artifacts", sdk.directory] })
        showToast({ title: "办公文件已保存", description: result?.path ?? ".novaway/office" })
      },
      onError: () => showToast({ title: "保存失败", description: "当前办公产物无法写入项目文件夹。" }),
    }))

    const fillTemplate = useMutation(() => ({
      mutationFn: async (file: File) => {
        const slides = fillPlan()
        const result = await fillOfficePptxTemplate({
          client: globalSDK.client,
          directory: sdk.directory,
          filename: officePptxTemplateFillFilename(input.artifact),
          templateBytes: new Uint8Array(await file.arrayBuffer()),
          slides,
        })
        return { data: result.data, slides }
      },
      onSuccess: (result) => {
        void queryClient.invalidateQueries({ queryKey: ["office-artifacts", sdk.directory] })
        openSavedOfficeArtifact(result.data?.path)
        showToast({
          title: "PPTX 模板已套用",
          description: `${officePptxFillPlanSummary(result.slides)} · ${result.data?.path ?? ".novaway/office/ppt"}`,
        })
      },
      onError: () => showToast({ title: "套用模板失败", description: "请选择有效的 PPTX 模板文件后重试。" }),
    }))

    function openSavedOfficeArtifact(relativePath: string | undefined) {
      if (!relativePath || !platform.openPath) return
      void platform.openPath(`${sdk.directory.replace(/[\\/]+$/, "")}/${relativePath}`).catch(() => undefined)
    }

    function selectPptxTemplateFile() {
      if (typeof document === "undefined") return
      const inputElement = document.createElement("input")
      inputElement.type = "file"
      inputElement.accept = ".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
      inputElement.addEventListener("change", () => {
        const file = inputElement.files?.[0]
        if (file) fillTemplate.mutate(file)
      })
      inputElement.click()
    }

    function openCustomTemplateDialog() {
      const [draft, setDraft] = createSignal("高端黑金商务风，深色封面，金色强调，页面简洁、有留白，适合正式汇报。")
      const preview = createMemo(() => createCustomPptTemplate(draft(), input.artifact.title))
      const apply = () => {
        const template = preview()
        office.selectPptTemplate(template)
        dialog.close()
        showToast({ title: "自定义模板已生成", description: template.name })
      }

      dialog.show(() => (
        <Dialog title="自定义 PPT 模板" class="w-full max-w-[680px] mx-auto">
          <div class="flex flex-col gap-4 px-6 pb-5">
            <div class="rounded-[8px] border border-cyan-300/20 bg-cyan-300/[0.06] p-3">
              <div class="text-13-medium text-text-strong">模板设计提示词</div>
              <div class="mt-1 text-12-regular leading-relaxed text-text-weak">
                请描述你想要的 PPT 风格、主题、配色、行业气质和页面感觉，例如“科技蓝、赛博霓虹、适合 AI 产品发布”。
              </div>
            </div>
            <textarea
              value={draft()}
              onInput={(event) => setDraft(event.currentTarget.value)}
              class="min-h-[128px] w-full resize-y rounded-[8px] border border-border-weak-base bg-background-base p-3 text-13-regular leading-relaxed text-text-strong outline-none transition-colors focus:border-emerald-300/70 focus:ring-2 focus:ring-emerald-300/25"
            />
            <div class="grid gap-3 rounded-[8px] border border-border-weak-base bg-surface-raised-base/70 p-3">
              <div class="flex items-center justify-between gap-3">
                <div class="min-w-0">
                  <div class="truncate text-13-medium text-text-strong">{preview().name}</div>
                  <div class="mt-1 line-clamp-2 text-12-regular text-text-weak">{preview().description}</div>
                </div>
                <div class="flex shrink-0 items-center gap-1.5">
                  <For
                    each={[
                      preview().visual.coverBg,
                      preview().visual.accent,
                      preview().visual.accent2,
                      preview().visual.pageBg,
                    ]}
                  >
                    {(color) => (
                      <span
                        class="size-5 rounded-[6px] border border-border-weak-base"
                        style={{ "background-color": `#${color}` }}
                      />
                    )}
                  </For>
                </div>
              </div>
            </div>
            <div class="flex justify-end gap-2">
              <Button variant="ghost" size="large" onClick={() => dialog.close()}>
                取消
              </Button>
              <button
                type="button"
                class="rounded-[8px] border border-emerald-300/45 bg-emerald-300 px-4 py-2 text-13-medium text-black shadow-[0_10px_26px_rgba(16,185,129,0.18)] transition-all hover:-translate-y-px hover:bg-emerald-200 active:translate-y-0 active:scale-[0.98]"
                onClick={apply}
              >
                生成并使用
              </button>
            </div>
          </div>
        </Dialog>
      ))
    }

    return (
      <div class="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-emerald-300/20 bg-emerald-300/[0.06] px-3 py-2.5">
        <div class="flex min-w-0 items-center gap-2">
          <div class="grid size-7 shrink-0 place-items-center rounded-[8px] border border-emerald-300/25 bg-emerald-300/10 text-emerald-200">
            <Icon name="pencil-line" size="small" />
          </div>
          <div class="min-w-0">
            <div class="truncate text-12-medium text-text-strong">{input.artifact.title}</div>
            <div class="text-11-regular text-text-weak">
              {input.artifact.slides.length > 0
                ? `已识别 ${input.artifact.slides.length} 页 PPT 大纲，可预览、复制或导出 PPTX`
                : "已识别为办公产物，可单独复制或导出 DOCX"}
            </div>
            <div class="mt-1 flex min-w-0 items-center gap-1.5">
              <span
                class="shrink-0 rounded-[6px] border px-1.5 py-0.5 text-10-medium"
                classList={{
                  "border-emerald-300/30 bg-emerald-300/10 text-emerald-100": quality().status === "ready",
                  "border-amber-300/35 bg-amber-300/10 text-amber-100": quality().status === "review",
                }}
              >
                质量：{quality().label}
              </span>
              <span class="truncate text-10-regular text-text-weak" title={quality().summary}>
                {quality().summary}
              </span>
            </div>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <Show when={input.artifact.slides.length > 0}>
            <DropdownMenu placement="top-start" gutter={6}>
              <DropdownMenu.Trigger
                as="button"
                type="button"
                class="group inline-flex min-w-[164px] items-center justify-between gap-2 rounded-[8px] border border-border-weak-base bg-background-base px-2.5 py-1.5 text-12-medium text-text-strong outline-none transition-colors hover:border-emerald-300/55 hover:bg-emerald-300/[0.08] focus-visible:border-emerald-300/70 focus-visible:ring-2 focus-visible:ring-emerald-300/25"
                title={officePptTemplateDescription(pptTemplate())}
              >
                <span class="text-11-regular text-text-muted">模板</span>
                <span class="min-w-0 flex-1 truncate text-left">{officePptTemplateName(pptTemplate())}</span>
                <Icon
                  name="chevron-down"
                  size="small"
                  class="shrink-0 text-icon-weak transition-transform group-data-[expanded]:rotate-180"
                />
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content class="max-h-[320px] overflow-y-auto" style={{ "min-width": "220px" }}>
                  <DropdownMenu.Item onSelect={() => setPptTemplate("auto")}>
                    <DropdownMenu.ItemLabel>自动匹配</DropdownMenu.ItemLabel>
                    <DropdownMenu.ItemDescription>根据当前 PPT 主题自动选择模板</DropdownMenu.ItemDescription>
                  </DropdownMenu.Item>
                  <DropdownMenu.Item onSelect={openCustomTemplateDialog}>
                    <DropdownMenu.ItemLabel>自定义模板</DropdownMenu.ItemLabel>
                    <DropdownMenu.ItemDescription>根据风格、主题和样式描述生成模板</DropdownMenu.ItemDescription>
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator />
                  <Show when={selectedCustomTemplate()}>
                    {(template) => (
                      <>
                        <DropdownMenu.Item onSelect={() => setPptTemplate(template())}>
                          <DropdownMenu.ItemLabel>{template().name}</DropdownMenu.ItemLabel>
                          <DropdownMenu.ItemDescription>{template().description}</DropdownMenu.ItemDescription>
                        </DropdownMenu.Item>
                        <DropdownMenu.Separator />
                      </>
                    )}
                  </Show>
                  <For each={officePptTemplates}>
                    {(template) => (
                      <DropdownMenu.Item onSelect={() => setPptTemplate(template.id)}>
                        <DropdownMenu.ItemLabel>{template.name}</DropdownMenu.ItemLabel>
                        <DropdownMenu.ItemDescription>{template.description}</DropdownMenu.ItemDescription>
                      </DropdownMenu.Item>
                    )}
                  </For>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu>
          </Show>
          <Show when={input.artifact.slides.length > 0}>
            <button type="button" class={actionButton} onClick={() => previewOfficeSlides(input.artifact)}>
              <Icon name="layout-bottom" size="small" class="transition-transform duration-150 group-hover:scale-110" />
              <span>预览页</span>
            </button>
          </Show>
          <button type="button" class={actionButton} onClick={() => copyOfficeArtifact(input.artifact)}>
            <Icon name="copy" size="small" class="transition-transform duration-150 group-hover:scale-110" />
            <span>复制产物</span>
          </button>
          <button
            type="button"
            class={actionButton}
            onClick={() => downloadOfficeArtifact(input.artifact, pptTemplate())}
          >
            <Icon name="download" size="small" class="transition-transform duration-150 group-hover:translate-y-0.5" />
            <span>{input.artifact.slides.length > 0 ? "导出 PPTX" : "导出 DOCX"}</span>
          </button>
          <Show when={input.artifact.slides.length === 0}>
            <button type="button" class={actionButton} onClick={() => downloadOfficeHtmlArtifact(input.artifact)}>
              <Icon name="code" size="small" class="transition-transform duration-150 group-hover:scale-110" />
              <span>导出 HTML</span>
            </button>
          </Show>
          <Show when={input.artifact.slides.length > 0}>
            <button
              type="button"
              class={actionButton}
              disabled={fillTemplate.isPending}
              onClick={selectPptxTemplateFile}
              title={fillSummary()}
            >
              <Icon
                name={fillTemplate.isPending ? "status" : "layout-bottom"}
                size="small"
                class="transition-transform duration-150 group-hover:scale-110"
              />
              <span>{fillTemplate.isPending ? "套版中" : "套用PPTX模板"}</span>
            </button>
          </Show>
          <button type="button" class={primaryActionButton} disabled={save.isPending} onClick={() => save.mutate()}>
            <Icon
              name={save.isPending ? "status" : "check"}
              size="small"
              class="transition-transform duration-150 group-hover:scale-110"
            />
            <span>{save.isPending ? "保存中" : "保存到项目"}</span>
          </button>
        </div>
      </div>
    )
  }

  function copyOfficeArtifact(artifact: OfficeArtifact) {
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard
    if (!clipboard?.writeText) {
      showToast({ title: "复制失败", description: "当前环境无法写入剪贴板。" })
      return
    }

    void clipboard.writeText(artifact.body).then(
      () => showToast({ title: "办公产物已复制", description: "已复制不含记忆与进化建议的 Markdown 正文。" }),
      () => showToast({ title: "复制失败", description: "当前环境无法写入剪贴板。" }),
    )
  }

  function downloadOfficeArtifact(artifact: OfficeArtifact, pptTemplate?: OfficePptTemplateChoice) {
    if (typeof document === "undefined" || typeof URL === "undefined" || typeof Blob === "undefined") {
      showToast({ title: "导出失败", description: "当前环境无法创建办公文件。" })
      return
    }

    const file = createOfficeExportFile(artifact, { pptTemplate })
    const body = file.bytes.buffer.slice(
      file.bytes.byteOffset,
      file.bytes.byteOffset + file.bytes.byteLength,
    ) as ArrayBuffer
    const url = URL.createObjectURL(new Blob([body], { type: file.mime }))
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = file.filename
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
    showToast({ title: "办公文件已导出", description: file.filename })
  }

  async function downloadOfficeHtmlArtifact(artifact: OfficeArtifact) {
    if (typeof document === "undefined" || typeof URL === "undefined" || typeof Blob === "undefined") {
      showToast({ title: "导出失败", description: "当前环境无法创建办公文件。" })
      return
    }

    const file = await createOfficeHtmlExportFile(artifact)
    const body = file.bytes.buffer.slice(
      file.bytes.byteOffset,
      file.bytes.byteOffset + file.bytes.byteLength,
    ) as ArrayBuffer
    const url = URL.createObjectURL(new Blob([body], { type: file.mime }))
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = file.filename
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
    showToast({ title: "办公文件已导出", description: file.filename })
  }

  function previewOfficeSlides(artifact: OfficeArtifact) {
    dialog.show(() => (
      <Dialog title={`PPT 页级预览：${artifact.title}`} class="w-full max-w-[860px] mx-auto">
        <div class="max-h-[72vh] overflow-auto p-6 pt-0">
          <div class="grid gap-3 md:grid-cols-2">
            <For each={artifact.slides}>
              {(slide) => (
                <div class="rounded-[8px] border border-border-weak-base bg-surface-raised-base/70 p-4">
                  <div class="flex items-start justify-between gap-3 border-b border-border-weaker-base pb-3">
                    <div class="min-w-0">
                      <div class="text-11-medium text-emerald-200">第 {slide.index} 页</div>
                      <div class="mt-1 truncate text-15-medium text-text-strong">{slide.title}</div>
                    </div>
                    <Icon name="layout-bottom" size="small" class="shrink-0 text-icon-weak" />
                  </div>
                  <div class="mt-3 flex flex-col gap-1.5">
                    <For each={slidePreviewLines(slide)}>
                      {(line) => <div class="text-12-regular leading-relaxed text-text-weak">{line}</div>}
                    </For>
                    <Show when={slidePreviewLines(slide).length === 0}>
                      <div class="text-12-regular text-text-muted">暂无页面正文，建议继续让 AI 补充页面文案。</div>
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
      </Dialog>
    ))
  }

  function slidePreviewLines(slide: OfficeSlide) {
    return slide.content
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 8)
  }

  function TimelineRowFrame(input: { row: Accessor<FramedTimelineRow>; children: JSX.Element }) {
    const anchor = () => {
      const row = input.row()
      return row._tag === "CommentStrip" || (row._tag === "UserMessage" && row.anchor)
    }
    const previousUserMessage = () => {
      const row = input.row()
      return (row._tag === "CommentStrip" || row._tag === "UserMessage") && row.previousUserMessage
    }
    const previousAssistantPart = () => {
      const row = input.row()
      return row._tag === "AssistantPart" && row.previousAssistantPart
    }

    return (
      <div
        id={anchor() ? props.anchor(input.row().userMessageID) : undefined}
        data-message-id={input.row().userMessageID}
        data-timeline-row={input.row()._tag}
        classList={{
          "min-w-0 w-full max-w-full": true,
          "md:max-w-200 2xl:max-w-[1000px]": props.centered,
          "md:mx-auto": props.centered,
          "pt-6": previousUserMessage(),
          "pt-3": previousAssistantPart(),
        }}
      >
        <div data-component="session-turn" class="min-w-0 w-full relative" style={{ height: "auto" }}>
          {input.children}
        </div>
      </div>
    )
  }

  const renderTimelineRow = (row: Accessor<TimelineRow.TimelineRow>) => {
    switch (row()._tag) {
      case "CommentStrip": {
        const commentStripRow = row as Accessor<TimelineRowByTag<"CommentStrip">>
        const comments = createMemo(() =>
          getMsgParts(commentStripRow().userMessageID).flatMap((part) => MessageComment.fromPart(part) ?? []),
        )
        return (
          <TimelineRowFrame row={commentStripRow}>
            <div class="w-full px-4 md:px-5 pb-2">
              <div class="ml-auto max-w-[82%] overflow-x-auto no-scrollbar">
                <div class="flex w-max min-w-full justify-end gap-2">
                  <Index each={comments()}>
                    {(comment) => (
                      <div class="shrink-0 max-w-[260px] rounded-[6px] border border-border-weak-base bg-background-stronger px-2.5 py-2">
                        <div class="flex items-center gap-1.5 min-w-0 text-11-medium text-text-strong">
                          <FileIcon node={{ path: comment().path, type: "file" }} class="size-3.5 shrink-0" />
                          <span class="truncate">{getFilename(comment().path)}</span>
                          <Show when={comment().selection}>
                            {(selection) => (
                              <span class="shrink-0 text-text-weak">
                                {selection().startLine === selection().endLine
                                  ? `:${selection().startLine}`
                                  : `:${selection().startLine}-${selection().endLine}`}
                              </span>
                            )}
                          </Show>
                        </div>
                        <div class="pt-1 text-12-regular text-text-strong whitespace-pre-wrap break-words">
                          {comment().comment}
                        </div>
                      </div>
                    )}
                  </Index>
                </div>
              </div>
            </div>
          </TimelineRowFrame>
        )
      }
      case "UserMessage": {
        const userMessageRow = row as Accessor<TimelineRowByTag<"UserMessage">>
        const message = createMemo(() => {
          const m = messageByID().get(userMessageRow().userMessageID)
          if (m?.role === "user") return m
        })
        return (
          <TimelineRowFrame row={userMessageRow}>
            <Show when={message()}>
              {(message) => (
                <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
                  <div data-slot="session-turn-message-content" aria-live="off">
                    <Message
                      message={message()}
                      parts={getMsgParts(userMessageRow().userMessageID)}
                      actions={props.actions}
                    />
                  </div>
                </div>
              )}
            </Show>
          </TimelineRowFrame>
        )
      }
      case "TurnDivider": {
        const turnDividerRow = row as Accessor<TimelineRowByTag<"TurnDivider">>
        return (
          <TimelineRowFrame row={turnDividerRow}>
            <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
              <div data-slot="session-turn-compaction">
                <MessageDivider
                  label={language.t(
                    turnDividerRow().label === "compaction" ? "ui.messagePart.compaction" : "ui.message.interrupted",
                  )}
                />
              </div>
            </div>
          </TimelineRowFrame>
        )
      }
      case "AssistantPart": {
        const assistantPartRow = row as Accessor<TimelineRowByTag<"AssistantPart">>
        return (
          <TimelineRowFrame row={assistantPartRow}>
            <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
              <div
                data-slot="session-turn-assistant-content"
                aria-hidden={workingTurn(assistantPartRow().userMessageID)}
              >
                {renderAssistantPartGroup(assistantPartRow)}
              </div>
            </div>
          </TimelineRowFrame>
        )
      }
      case "Thinking": {
        const thinkingRow = row as Accessor<TimelineRowByTag<"Thinking">>
        return (
          <TimelineRowFrame row={thinkingRow}>
            <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
              <TimelineThinkingRow
                reasoningHeading={thinkingRow().reasoningHeading}
                showReasoningSummaries={settings.general.showReasoningSummaries()}
              />
            </div>
          </TimelineRowFrame>
        )
      }
      case "Retry": {
        const retryRow = row as Accessor<TimelineRowByTag<"Retry">>
        return (
          <TimelineRowFrame row={retryRow}>
            <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
              <SessionRetry status={sessionStatus()} show={activeMessageID() === retryRow().userMessageID} />
            </div>
          </TimelineRowFrame>
        )
      }
      case "DiffSummary": {
        const diffSummaryRow = row as Accessor<TimelineRowByTag<"DiffSummary">>
        return (
          <TimelineRowFrame row={diffSummaryRow}>
            <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
              <TimelineDiffSummaryRow diffs={diffSummaryRow().diffs} />
            </div>
          </TimelineRowFrame>
        )
      }
      case "Error": {
        const errorRow = row as Accessor<TimelineRowByTag<"Error">>
        return (
          <TimelineRowFrame row={errorRow}>
            <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
              <Card variant="error" class="error-card">
                {errorRow().text}
              </Card>
            </div>
          </TimelineRowFrame>
        )
      }
      case "BottomSpacer":
        return <div data-timeline-row="bottom-spacer" aria-hidden="true" class="h-16" />
    }
  }

  function TimelineRowView(props: { rowKey: string }) {
    return <Show when={timelineRowByKey().get(props.rowKey)}>{(item) => renderTimelineRow(item)}</Show>
  }

  return (
    <div class="relative w-full h-full min-w-0">
      <div
        class="absolute left-1/2 -translate-x-1/2 bottom-6 z-[60] pointer-events-none transition-all duration-200 ease-out"
        classList={{
          "opacity-100 translate-y-0 scale-100": props.scroll.overflow && props.scroll.jump,
          "opacity-0 translate-y-2 scale-95 pointer-events-none": !props.scroll.overflow || !props.scroll.jump,
        }}
      >
        <button
          class="pointer-events-auto flex items-center justify-center w-10 h-8 bg-transparent border-none cursor-pointer p-0 group"
          onClick={props.onResumeScroll}
        >
          <div
            class="flex items-center justify-center w-8 h-6 rounded-[6px] border border-border-weaker-base bg-[color-mix(in_srgb,var(--surface-raised-stronger-non-alpha)_80%,transparent)] backdrop-blur-[0.75px] transition-colors group-hover:border-[var(--border-weak-base)] group-hover:[--icon-base:var(--icon-hover)]"
            style={{
              "box-shadow":
                "0 51px 60px 0 rgba(0,0,0,0.10), 0 15px 18px 0 rgba(0,0,0,0.12), 0 6.386px 7.513px 0 rgba(0,0,0,0.12), 0 2.31px 2.717px 0 rgba(0,0,0,0.20)",
            }}
          >
            <Icon name="arrow-down-to-line" size="small" />
          </div>
        </button>
      </div>
      <ScrollView
        viewportRef={bindListRoot}
        onWheel={handleListWheel}
        onTouchStart={handleListTouchStart}
        onTouchMove={handleListTouchMove}
        onTouchEnd={handleListTouchEnd}
        onTouchCancel={handleListTouchEnd}
        onPointerDown={handleListPointerDown}
        onScroll={handleListScroll}
        onClick={props.onAutoScrollInteraction}
        class="relative min-w-0 w-full h-full"
        style={{
          "--session-title-height": showHeader() ? "40px" : "0px",
          "--sticky-accordion-top": showHeader() ? "48px" : "0px",
        }}
      >
        <Show when={showHeader()}>
          <div
            ref={(el) => {
              head = el
              updateTitleMetrics()
            }}
            data-session-title
            classList={{
              "sticky top-0 z-30 bg-[linear-gradient(to_bottom,var(--background-stronger)_48px,transparent)]": true,
              "w-full": true,
              "pb-4": true,
              "pl-2 pr-3 md:pl-4 md:pr-3": true,
            }}
          >
            <div class="h-12 w-full flex items-center justify-between gap-2">
              <div class="flex items-center gap-1 min-w-0 flex-1 pr-3">
                <div class="flex items-center min-w-0 grow-1">
                  <Show when={parentID()}>
                    <button
                      type="button"
                      data-slot="session-title-parent"
                      class="min-w-0 max-w-[40%] truncate text-14-medium text-text-weak transition-colors hover:text-text-base"
                      onClick={navigateParent}
                    >
                      {parentTitle()}
                    </button>
                    <span
                      data-slot="session-title-separator"
                      class="px-2 text-14-medium text-text-weak"
                      aria-hidden="true"
                    >
                      /
                    </span>
                  </Show>
                  <div
                    class="shrink-0 flex items-center justify-center overflow-hidden transition-[width,margin] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                    style={{
                      width: working() ? "16px" : "0px",
                      "margin-right": working() ? "8px" : "0px",
                    }}
                    aria-hidden="true"
                  >
                    <Show when={workingStatus() !== "hidden"}>
                      <div
                        class="transition-opacity duration-200 ease-out"
                        classList={{ "opacity-0": workingStatus() === "hiding" }}
                      >
                        <div class="relative size-4 flex items-center justify-center">
                          <div class="absolute inset-0 rounded-full border-[1.5px] border-text-interactive-base animate-[ping_1.5s_cubic-bezier(0,0,0.2,1)_infinite] opacity-75" />
                          <div class="size-1.5 rounded-full bg-text-interactive-base" />
                        </div>
                      </div>
                    </Show>
                  </div>
                  <Show when={childTitle() || title.editing}>
                    <Show
                      when={title.editing}
                      fallback={
                        <h1
                          data-slot="session-title-child"
                          class="text-14-medium text-text-strong truncate grow-1 min-w-0"
                          onDblClick={openTitleEditor}
                        >
                          {childTitle()}
                        </h1>
                      }
                    >
                      <InlineInput
                        ref={(el) => {
                          titleRef = el
                        }}
                        data-slot="session-title-child"
                        value={title.draft}
                        disabled={titleMutation.isPending}
                        class="text-14-medium text-text-strong grow-1 min-w-0 rounded-[6px] pl-1 -ml-1"
                        style={{ "--inline-input-shadow": "var(--shadow-xs-border-select)" }}
                        onInput={(event) => setTitle("draft", event.currentTarget.value)}
                        onKeyDown={(event) => {
                          event.stopPropagation()
                          if (event.key === "Enter") {
                            event.preventDefault()
                            void saveTitleEditor()
                            return
                          }
                          if (event.key === "Escape") {
                            event.preventDefault()
                            closeTitleEditor()
                          }
                        }}
                        onBlur={closeTitleEditor}
                      />
                    </Show>
                  </Show>
                </div>
              </div>
              <Show when={sessionID()} keyed>
                {(id) => <div class="shrink-0 flex items-center gap-3" />}
              </Show>
            </div>
          </div>
        </Show>
        <Show when={scrollRoot()}>
          {(root) => (
            <Virtualizer
              data={timelineRowKeys()}
              cache={virtualCache()}
              itemSize={virtualCache() ? undefined : timelineFallbackItemSize}
              scrollRef={root()}
              shift={props.historyShift}
              keepMounted={keepMounted()}
              startMargin={64}
              ref={(handle) => {
                if (!handle) {
                  writeTimelineCache(virtualizerSessionKey, virtualizerRowKeys, virtualizer)
                  virtualizer = undefined
                  return
                }
                virtualizer = handle
                virtualizerSessionKey = cacheSessionKey
                virtualizerRowKeys = cacheRowKeys
                maybeAnchorBottom()
                scheduleContentRoot(root())
              }}
            >
              {(key) => <TimelineRowView rowKey={key} />}
            </Virtualizer>
          )}
        </Show>
      </ScrollView>
    </div>
  )
}
