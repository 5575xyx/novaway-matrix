import { createEffect, createSignal, For, Match, on, onCleanup, onMount, Show, Switch, type JSX } from "solid-js"
import { animate, type AnimationPlaybackControls } from "motion"
import { useI18n } from "../context/i18n"
import { createStore } from "solid-js/store"
import { Collapsible } from "./collapsible"
import type { IconProps } from "./icon"
import { TextShimmer } from "./text-shimmer"
import { Tooltip } from "./tooltip"
import { IconButton } from "./icon-button"
import { writeClipboard } from "../util/clipboard"

export type TriggerTitle = {
  title: string
  titleClass?: string
  subtitle?: string
  subtitleClass?: string
  args?: string[]
  argsClass?: string
  /**
   * 标题右侧的**富内容**（对齐 ZCode ToolSummaryRow 的 `kindDetail`）。
   *
   * `subtitle` 只能是字符串（会被截断成一行），但有些摘要需要真实节点：
   * 例如"动了哪些文件"的 chip 列表（带文件图标）。两者的位置也不同 ——
   * subtitle 跟着标题、detail 在最外侧。
   */
  detail?: JSX.Element
  action?: JSX.Element
}

const isTriggerTitle = (val: any): val is TriggerTitle => {
  return (
    typeof val === "object" && val !== null && "title" in val && (typeof Node === "undefined" || !(val instanceof Node))
  )
}

export interface BasicToolProps {
  icon: IconProps["name"]
  trigger: TriggerTitle | JSX.Element
  children?: JSX.Element
  status?: string
  hideDetails?: boolean
  defaultOpen?: boolean
  forceOpen?: boolean
  defer?: boolean
  locked?: boolean
  animated?: boolean
  onSubtitleClick?: () => void
  onTriggerClick?: JSX.EventHandlerUnion<HTMLElement, MouseEvent>
  triggerHref?: string
  clickable?: boolean
  badge?: { color: string }
  /**
   * 展开态的持久化键（通常是工具调用的 part id）。
   *
   * 时间线会随消息更新重算分组，`BasicTool` 实例因此可能被重建；没有这个键的话
   * 用户展开一个工具、之后随内容更新就被收回去，读长输出时很烦。
   * ZCode 的 `ToolLayout` 也是模块级 Map 存 open 状态（`toolLayoutOpenState`）。
   */
  persistKey?: string

  /**
   * 工具行的状态词。
   *
   * ZCode 把状态从标题里拆出来单独放（`ToolLayout` 的 statusLabel / statusIndicator /
   * showStatusLabel / showFailureStatus）：标题说"做了什么"，状态词说"现在到哪一步了"。
   * 我们的标题原本用 `TextShimmer` 自己动，读者分不清"正在跑"和"刚跑完"。
   *
   * 不传则按 `status` 推导（见 resolveStatusLabel）：等待中 / 执行中 / 执行失败，
   * 完成态默认不显示 —— 每个成功调用都挂一个"已完成"会让时间线变成噪音，
   * 这也是 ZCode 里大多数渲染器只在失败时传 statusLabel 的原因。
   */
  statusLabel?: string
  /** 状态词之前的指示物（小圆点/圈/图标），与状态词同显同隐。 */
  statusIndicator?: JSX.Element
  /** 失败原因：挂在状态词的虚线下划线上，hover 展开并可一键复制。 */
  statusTooltip?: string
  /** 完成态也显示状态词。 */
  showStatus?: boolean

  /**
   * 运行结束的**那一刻**自动收起一次。
   *
   * 对齐 ZCode 的 `autoCollapseOnComplete`：只作用于 running → 完成 的边沿，
   * 不影响用户之后手动再展开。子智能体这类工具在运行中会摊开一大串子调用，
   * 完成后不收回来的话聊天流会被永久撑长，和"运行中展开、完成回到摘要"不一致。
   */
  autoCollapseOnComplete?: boolean
}

/**
 * 工具行的展开态。模块级 Map，键是 `persistKey`。
 *
 * 只增不减是刻意的：一次会话里工具行数量有限，而无脑清理反而会把
 * "刚展开、还没读" 的状态丢掉。切换会话时由 `clearToolOpenState` 整体清空。
 */
const toolOpenState = new Map<string, boolean>()

export function clearToolOpenState() {
  toolOpenState.clear()
}

const SPRING = { type: "spring" as const, visualDuration: 0.35, bounce: 0 }
const deferredMounts: Array<{ active: boolean; fn: () => void }> = []
let deferredFrame: number | undefined

function flushDeferredMounts() {
  while (deferredMounts.length > 0) {
    // Timeline tools are mounted top-to-bottom, but the viewport starts at the latest turn.
    // Pop from the end so heavy default-open bodies near the bottom become interactive first.
    const item = deferredMounts.pop()!
    if (item.active) {
      deferredFrame = deferredMounts.length > 0 ? requestAnimationFrame(flushDeferredMounts) : undefined
      item.fn()
      return
    }
  }
  deferredFrame = undefined
}

function scheduleDeferredFlush() {
  if (deferredFrame !== undefined) return
  deferredFrame = requestAnimationFrame(() => {
    deferredFrame = requestAnimationFrame(flushDeferredMounts)
  })
}

function scheduleDeferredMount(fn: () => void) {
  const item = { active: true, fn }
  deferredMounts.push(item)
  scheduleDeferredFlush()
  return () => {
    item.active = false
  }
}

function scheduleFrameMount(fn: () => void) {
  const frame = requestAnimationFrame(fn)
  return () => cancelAnimationFrame(frame)
}

/**
 * 运行中的指示物：一个脉动的小圆点。
 *
 * 之前它内联在标题后面、只靠 `pending()` 控制显隐；现在收敛成状态节点的一部分，
 * 和状态词一起在摘要右侧，语义更清楚（"● 执行中"）。
 */
function defaultStatusIndicator() {
  return (
    <svg
      viewBox="0 0 12 12"
      width="12"
      height="12"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      class="block shrink-0"
    >
      <circle
        cx="6"
        cy="6"
        r="3"
        style={{
          animation: "var(--animate-pulse-scale)",
          "transform-origin": "center",
          "transform-box": "fill-box",
        }}
      />
    </svg>
  )
}

/**
 * 状态词节点：`● 执行中` / `执行失败`（带虚线下划线 + 悬停详情）。
 *
 * 对齐 ZCode `ToolLayout` 的 statusNode：指示物与状态词包在一个 `inline-flex` 里
 * 同显同隐，指示物不参与下划线与 hover 命中 —— 它只是"正在跑"的一个视觉提示，
 * 不该变成第二个悬停目标。
 */
function ToolStatusNode(props: {
  text: string | undefined
  tone: "active" | "idle" | "error"
  indicator?: JSX.Element
  tooltip?: string
}) {
  const i18n = useI18n()
  const [copied, setCopied] = createSignal(false)

  const copy = async (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (!props.tooltip) return
    if (await writeClipboard(props.tooltip)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  const word = () =>
    props.tooltip ? (
      <Tooltip
        value={
          <div data-slot="tool-status-tooltip">
            <span data-slot="tool-status-tooltip-text">{props.tooltip}</span>
            <IconButton
              icon={copied() ? "check" : "copy"}
              variant="ghost"
              size="small"
              class="shrink-0"
              aria-label={i18n.t(copied() ? "ui.tool.copied" : "ui.tool.copyError")}
              onClick={copy}
            />
          </div>
        }
      >
        <span data-slot="tool-status-word" data-underline="true">
          {props.text}
        </span>
      </Tooltip>
    ) : (
      <span data-slot="tool-status-word">{props.text}</span>
    )

  return (
    <Show when={props.text}>
      <span data-slot="basic-tool-tool-status" data-tone={props.tone}>
        <Show when={props.indicator}>{props.indicator}</Show>
        {word()}
      </span>
    </Show>
  )
}

export function BasicTool(props: BasicToolProps) {
  const i18n = useI18n()
  const persisted = props.persistKey ? toolOpenState.get(props.persistKey) : undefined
  const [state, setState] = createStore({
    open: persisted ?? props.defaultOpen ?? false,
    ready: !props.defer && (persisted ?? props.defaultOpen ?? false),
  })
  const open = () => state.open
  const ready = () => state.ready
  const pending = () => props.status === "pending" || props.status === "running"
  const hasChildren = () => (props.defer ? "children" in props : props.children)

  /**
   * 状态词。显式传入优先；否则按 status 推导。
   *
   * 完成态默认返回 undefined（不显示）—— 每个成功调用都挂一句"已完成"，
   * 一轮里几十个工具行会让时间线看不到重点。要显示就传 `showStatus`。
   */
  const statusText = () => {
    if (props.statusLabel !== undefined) return props.statusLabel || undefined
    if (props.status === "pending") return i18n.t("ui.tool.status.pending")
    if (props.status === "running") return i18n.t("ui.tool.status.running")
    if (props.status === "error") return i18n.t("ui.tool.status.failed")
    return props.showStatus ? i18n.t("ui.tool.status.completed") : undefined
  }

  const statusTone = () =>
    props.status === "error" ? "error" : pending() ? "active" : "idle"

  let cancelReady: (() => void) | undefined

  const cancel = () => {
    cancelReady?.()
    cancelReady = undefined
  }

  const scheduleReady = (initial = false) => {
    cancel()
    cancelReady = (initial ? scheduleDeferredMount : scheduleFrameMount)(() => {
      cancelReady = undefined
      if (!open()) return
      setState("ready", true)
    })
  }

  onCleanup(cancel)

  onMount(() => {
    if (props.defer && open()) scheduleReady(true)
  })

  createEffect(() => {
    if (props.forceOpen) setState("open", true)
  })

  // 只在「运行中 → 完成」的边沿收起一次。
  // 用 `on(pending, ...)` 拿前后值而不是读 `state.open`：后者会让这个 effect
  // 依赖自身写入的 open，收起后立刻又被自己触发一遍。
  createEffect(
    on(
      pending,
      (running, wasRunning) => {
        if (!props.autoCollapseOnComplete) return
        if (wasRunning !== true || running) return
        setState("open", false)
      },
      { defer: true },
    ),
  )

  // 把展开态写回模块级 Map，供重建后的实例恢复。
  createEffect(() => {
    if (!props.persistKey) return
    toolOpenState.set(props.persistKey, state.open)
  })

  createEffect(
    on(
      open,
      (value) => {
        if (!props.defer) return
        if (!value) {
          cancel()
          setState("ready", false)
          return
        }

        scheduleReady()
      },
      { defer: true },
    ),
  )

  // Animated height for collapsible open/close
  let contentRef: HTMLDivElement | undefined
  let heightAnim: AnimationPlaybackControls | undefined
  const initialOpen = open()

  createEffect(
    on(
      open,
      (isOpen) => {
        if (!props.animated || !contentRef) return
        heightAnim?.stop()
        if (isOpen) {
          contentRef.style.overflow = "hidden"
          heightAnim = animate(contentRef, { height: "auto" }, SPRING)
          void heightAnim.finished.then(() => {
            if (!contentRef || !open()) return
            contentRef.style.overflow = "visible"
            contentRef.style.height = "auto"
          })
        } else {
          contentRef.style.overflow = "hidden"
          heightAnim = animate(contentRef, { height: "0px" }, SPRING)
        }
      },
      { defer: true },
    ),
  )

  onCleanup(() => {
    heightAnim?.stop()
  })

  const handleOpenChange = (value: boolean) => {
    if (pending()) return
    if (props.locked && !value) return
    setState("open", value)
  }

  const trigger = () => (
    <div
      data-component="tool-trigger"
      data-clickable={props.clickable ? "true" : undefined}
      data-hide-details={props.hideDetails ? "true" : undefined}
      data-badge={props.badge?.color}
    >
      <div data-slot="basic-tool-tool-trigger-content">
        <div data-slot="basic-tool-tool-info">
          <Switch>
            <Match when={isTriggerTitle(props.trigger) && props.trigger}>
              {(title) => (
                <div data-slot="basic-tool-tool-info-structured">
                  <div data-slot="basic-tool-tool-info-main">
                    <span
                      data-slot="basic-tool-tool-title"
                      classList={{
                        [title().titleClass ?? ""]: !!title().titleClass,
                      }}
                    >
                      <TextShimmer text={title().title} active={pending()} />
                    </span>
                    <Show when={title().detail}>
                      <span data-slot="basic-tool-tool-detail">{title().detail}</span>
                    </Show>
                    <Show when={!pending()}>
                      <Show when={title().subtitle}>
                        <span
                          data-slot="basic-tool-tool-subtitle"
                          classList={{
                            [title().subtitleClass ?? ""]: !!title().subtitleClass,
                            clickable: !!props.onSubtitleClick,
                          }}
                          onClick={(e) => {
                            if (props.onSubtitleClick) {
                              e.stopPropagation()
                              props.onSubtitleClick()
                            }
                          }}
                        >
                          {title().subtitle}
                        </span>
                      </Show>
                      <Show when={title().args?.length}>
                        <For each={title().args}>
                          {(arg) => (
                            <span
                              data-slot="basic-tool-tool-arg"
                              classList={{
                                [title().argsClass ?? ""]: !!title().argsClass,
                              }}
                            >
                              {arg}
                            </span>
                          )}
                        </For>
                      </Show>
                    </Show>
                  </div>
                  {/* `action` 不再按 pending 隐藏：它现在承载「改了哪些文件 / 增删多少」
                      这类**运行中也需要看**的信息（对齐 ZCode 的 diffCount，
                      编辑过程中 `+N` 会随着改动长大）。各渲染器若只想在结束时显示，
                      自己在 action 里加 `<Show when={!pending()}>`。 */}
                  <Show when={title().action}>
                    <span data-slot="basic-tool-tool-action">{title().action}</span>
                  </Show>
                </div>
              )}
            </Match>
            <Match when={true}>{props.trigger as JSX.Element}</Match>
          </Switch>
          {/* 状态词放在摘要最右侧（ZCode 的 statusNode 位置）：标题说"做了什么"，
              状态说"到哪一步了"。跟在长副标题后面会被挤到看不见。 */}
          <ToolStatusNode
            text={statusText()}
            tone={statusTone()}
            // 默认指示物只在运行中出现：给"执行失败"配一个脉动圆点会读成
            // "还在跑"，和状态词自相矛盾。
            indicator={props.statusIndicator ?? (pending() ? defaultStatusIndicator() : undefined)}
            tooltip={props.statusTooltip}
          />
        </div>
      </div>
      <Show when={hasChildren() && !props.hideDetails && !props.locked && !pending()}>
        <Collapsible.Arrow />
      </Show>
    </div>
  )

  return (
    <Collapsible open={open()} onOpenChange={handleOpenChange} class="tool-collapsible">
      <Show
        when={props.triggerHref}
        fallback={
          <Collapsible.Trigger
            data-hide-details={props.hideDetails ? "true" : undefined}
            onClick={props.onTriggerClick}
          >
            {trigger()}
          </Collapsible.Trigger>
        }
      >
        {(href) => (
          <Collapsible.Trigger
            as="a"
            href={href()}
            data-hide-details={props.hideDetails ? "true" : undefined}
            onClick={props.onTriggerClick}
          >
            {trigger()}
          </Collapsible.Trigger>
        )}
      </Show>
      <Show when={props.animated && hasChildren() && !props.hideDetails}>
        <div
          ref={contentRef}
          data-slot="collapsible-content"
          data-animated
          style={{
            height: initialOpen ? "auto" : "0px",
            overflow: initialOpen ? "visible" : "hidden",
          }}
        >
          <Show when={!props.defer || ready()}>{props.children}</Show>
        </div>
      </Show>
      <Show when={!props.animated && hasChildren() && !props.hideDetails}>
        <Collapsible.Content>
          <Show when={!props.defer || ready()}>{props.children}</Show>
        </Collapsible.Content>
      </Show>
    </Collapsible>
  )
}

function label(input: Record<string, unknown> | undefined) {
  const keys = ["description", "query", "url", "filePath", "path", "pattern", "name"]
  return keys.map((key) => input?.[key]).find((value): value is string => typeof value === "string" && value.length > 0)
}

function args(input: Record<string, unknown> | undefined) {
  if (!input) return []
  const skip = new Set(["description", "query", "url", "filePath", "path", "pattern", "name"])
  return Object.entries(input)
    .filter(([key]) => !skip.has(key))
    .flatMap(([key, value]) => {
      if (typeof value === "string") return [`${key}=${value}`]
      if (typeof value === "number") return [`${key}=${value}`]
      if (typeof value === "boolean") return [`${key}=${value}`]
      return []
    })
    .slice(0, 3)
}

export function GenericTool(props: {
  tool: string
  status?: string
  hideDetails?: boolean
  input?: Record<string, unknown>
  statusTooltip?: string
  persistKey?: string
}) {
  const i18n = useI18n()

  return (
    <BasicTool
      icon="mcp"
      status={props.status}
      trigger={{
        title: i18n.t("ui.basicTool.called", { tool: props.tool }),
        subtitle: label(props.input),
        args: args(props.input),
      }}
      hideDetails={props.hideDetails}
      statusTooltip={props.statusTooltip}
      persistKey={props.persistKey}
    />
  )
}
