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
  onMount,
  Show,
  mapArray,
  untrack,
  type Accessor,
  type JSX,
} from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { SelectionActionMenu } from "@/pages/session/selection-action-menu"
import { useSideChat } from "@/pages/session/use-side-chat"
import "@/components/session/knowledge-tool"
import { useNavigate } from "@solidjs/router"
import { useMutation, useQueryClient } from "@tanstack/solid-query"
import { Virtualizer, type VirtualizerHandle } from "virtua/solid"
import { Button } from "@novaway/ui/button"
import { Card } from "@novaway/ui/card"
import { SessionErrorCard } from "@/components/session/session-error-card"
import {
  ContextToolGroup,
  Message,
  MessageDivider,
  mergeReasoningParts,
  Part as MessagePart,
  partDefaultOpen,
  type UserActions,
} from "@novaway/ui/message-part"
import { DiffChanges } from "@novaway/ui/diff-changes"
import { FileIcon } from "@novaway/ui/file-icon"
import { Icon } from "@novaway/ui/icon"
import { IconButton } from "@novaway/ui/icon-button"
import { ImagePreview } from "@novaway/ui/image-preview"
import { Tooltip } from "@novaway/ui/tooltip"
import { DropdownMenu } from "@novaway/ui/dropdown-menu"
import { Dialog } from "@novaway/ui/dialog"
import { InlineInput } from "@novaway/ui/inline-input"
import { SessionRetry } from "@novaway/ui/session-retry"
import { ScrollView } from "@novaway/ui/scroll-view"
import { TextReveal } from "@novaway/ui/text-reveal"
import { TextShimmer } from "@novaway/ui/text-shimmer"
import type {
  AssistantMessage,
  Message as MessageType,
  Part as PartType,
  ReasoningPart,
  ToolPart,
  UserMessage,
} from "@novaway/sdk/v2"
import { showToast } from "@novaway/ui/toast"
import { writeClipboard } from "@novaway/ui/util/clipboard"
import { Binary } from "@novaway/core/util/binary"
import { getDirectory, getFilename } from "@novaway/core/util/path"
import { shouldMarkBoundaryGesture, normalizeWheelDelta } from "@/pages/session/message-gesture"
import { useDialog } from "@novaway/ui/context/dialog"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useSessionLayout } from "@/pages/session/session-layout"
import { useGlobalSDK } from "@/context/global-sdk"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useGlobalSync } from "@/context/global-sync"
import { useFile } from "@/context/file"
import { messageAgentColor } from "@/utils/agent"
import { sessionTitle } from "@/utils/session-title"
import { LOCAL_URL, normalizeLocalUrl, stripAnsi } from "@/utils/dev-server-detect"
import { isExcludedPath, relativeToWorkspace, resolveWorkspacePath } from "@/utils/preview-sources"
import { uniqueSummaryDiffs } from "@/pages/session/message-timeline.summary-diffs"
import { collectTurnWrittenPaths } from "./written-files"
import {
  buildPreviewCardCandidates,
  normalizePathForCompare,
  PREVIEW_CARD_VISIBLE_LIMIT,
  projectCitationText,
  type PreviewCardCandidate,
} from "./preview-card-extract"
import { usePreview } from "@/context/preview"
import { makeTimer } from "@solid-primitives/timer"
import {
  MessageComment,
  SummaryDiff,
  Timeline,
  TodoGrouping,
  TurnFold,
  TimelineRow,
  TimelineRowMap,
} from "./message-timeline.data"
import type { EvidenceImage, PreviewTarget } from "./message-timeline.data"
import { useOfficeAgent } from "./office-agent-context"
import { isTodoDone } from "./status-panel/todo-section"
import { extractOfficeArtifact, visibleOfficeMessage, type OfficeArtifact, type OfficeSlide } from "./office-artifact"
import {
  bytesToBase64,
  createCustomPptTemplate,
  createOfficeExportFile,
  createOfficeHtmlExportFile,
  isRealPptxTemplate,
  officeArtifactKind,
  officePptTemplateDescription,
  officePptTemplateName,
  officePptTemplates,
  type OfficePptTemplateChoice,
} from "./office-export"
import { createOfficeExportFileFromPptxTemplate } from "./office-ppt-template-fill"
import { evaluateOfficeArtifactQuality } from "./office-quality"
import {
  fillOfficePptxTemplate,
  officePptxFillPlanFromArtifact,
  officePptxFillPlanSummary,
  officePptxTemplateFillFilename,
} from "./office-template-fill"
import { OfficeSlideEditor } from "./office-slide-editor"
import { createOfficeSlideRevisionPrompt } from "./office-slide-revise"
import { OfficeDataEditor } from "./office-data-editor"
import { OfficeDesignEditor } from "./office-design-editor"
import { OfficeWebEditor } from "./office-web-editor"

const emptyMessages: MessageType[] = []
const emptyParts: PartType[] = []
const emptyTools: ToolPart[] = []
const emptyAssistantMessages: AssistantMessage[] = []
const idle = { type: "idle" as const }

// ===== 轮尾操作行的时间标签(ZCode messageTimeLabel 同款规则)=====
type MessageTimeKind = "time" | "monthDayTime" | "yearMonthDayTime"
const messageTimeFormatterCache = new Map<string, Intl.DateTimeFormat>()

function messageTimeFormatter(locale: string, kind: MessageTimeKind) {
  const key = `${locale}:${kind}`
  const cached = messageTimeFormatterCache.get(key)
  if (cached) return cached
  const formatter = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    ...(kind === "time"
      ? {}
      : kind === "monthDayTime"
        ? { month: "numeric", day: "numeric" }
        : { year: "numeric", month: "numeric", day: "numeric" }),
  })
  messageTimeFormatterCache.set(key, formatter)
  return formatter
}

function sameDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  )
}

/** 消息创建时间标签:当天只显时分;昨天加"昨天";同年月日时分;跨年补年份;无效时间不显示。 */
function formatMessageTimeLabel(timestamp: number | undefined, locale: string, yesterdayLabel: string) {
  if (!Number.isFinite(timestamp) || !timestamp || timestamp <= 0) return undefined
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) return undefined
  const now = new Date()
  const time = messageTimeFormatter(locale, "time").format(date)
  if (sameDay(date, now)) return time
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (sameDay(date, yesterday)) return `${yesterdayLabel} ${time}`
  if (date.getFullYear() === now.getFullYear()) return messageTimeFormatter(locale, "monthDayTime").format(date)
  return messageTimeFormatter(locale, "yearMonthDayTime").format(date)
}

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

/** 正文渲染前的文本投影:office 记忆段裁剪 + citation 指令隐藏(卡片已代替它展示)。 */
const visiblePart = (part: PartType, message: MessageType): PartType => {
  const projected = visibleOfficePart(part)
  if (projected.type !== "text") return projected
  const streaming = message.role === "assistant" && typeof message.time.completed !== "number"
  const text = projectCitationText(projected.text ?? "", { streaming })
  if (text === projected.text) return projected
  return { ...projected, text }
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

/** 轮首工作指示:流式期间一直显示,头部同步走实时耗时("工作中 · X 秒")。
 * 计时用 1s 间隔的定时器,只在本行挂载期间运行;轮次结束后由 TurnFold
 * 折叠成"已工作 X",所以这里不做"到点停止"的截断。 */
function TimelineThinkingRow(props: {
  reasoningHeading?: string
  showReasoningSummaries: boolean
  startedAt?: number
}) {
  const language = useLanguage()
  const mountedAt = Date.now()
  const [now, setNow] = createSignal(mountedAt)
  onMount(() => {
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => clearInterval(timer))
  })

  const elapsed = createMemo(() => {
    const start = typeof props.startedAt === "number" ? props.startedAt : mountedAt
    return Math.max(0, Math.floor((now() - start) / 1000))
  })
  const label = createMemo(() => {
    if (elapsed() < 60) return language.t("session.turn.fold.workingSec", { seconds: elapsed() })
    return language.t("session.turn.fold.workingMinSec", {
      minutes: Math.floor(elapsed() / 60),
      seconds: elapsed() % 60,
    })
  })

  return (
    <div data-slot="session-turn-thinking" class="flex items-center gap-1.5">
      <span class="shrink-0 text-foreground-subtle">
        <Icon name="lu-loader" size="small" class="animate-spin" />
      </span>
      <TextShimmer text={label()} class="text-foreground-subtle" />
      <Show when={!props.showReasoningSummaries}>
        <TextReveal text={props.reasoningHeading} class="session-turn-thinking-heading" travel={25} duration={700} />
      </Show>
    </div>
  )
}

function TimelineDiffSummaryRow(props: {
  diffs: SummaryDiff[]
  fallback: boolean
  onOpen?: (path: string) => void
}): JSX.Element {
  const language = useLanguage()
  const maxFiles = 10
  const [state, setState] = createStore({
    showAll: false,
    // 会话级兜底卡默认只显示标题行,点击可展开文件清单;轮次卡保持常展开。
    collapsed: props.fallback,
  })
  const toggleCollapsed = () => {
    if (props.fallback) setState("collapsed", !state.collapsed)
  }
  const totalChanges = createMemo(() =>
    props.diffs.reduce(
      (acc, diff) => ({
        additions: acc.additions + (diff.additions ?? 0),
        deletions: acc.deletions + (diff.deletions ?? 0),
      }),
      { additions: 0, deletions: 0 },
    ),
  )
  const showAll = () => state.showAll
  // 列出来的文件已经在数据层滤过应用自己的产物（见 uniqueSummaryDiffs）。
  const files = () => props.diffs
  const overflow = createMemo(() => Math.max(0, files().length - maxFiles))
  const visible = createMemo(() => (showAll() ? files() : files().slice(0, maxFiles)))

  return (
    <div
      data-slot="session-turn-diffs"
      data-component="session-turn-diffs-group"
      data-show-all={showAll() || undefined}
      data-fallback={props.fallback || undefined}
      data-collapsed={state.collapsed || undefined}
    >
      <div data-slot="session-turn-diffs-header" onClick={toggleCollapsed} role={props.fallback ? "button" : undefined}>
        <span
          data-slot="session-turn-diffs-indicator"
          class="inline-flex size-3.5 align-middle text-[var(--syntax-diff-add)]"
        >
          <Icon name="lu-file-output" size="small" />
        </span>
        <span data-slot="session-turn-diffs-label">
          {language.t(props.fallback ? "ui.sessionTurn.diffs.session" : "ui.sessionTurn.diffs.thisTurn", {
            count: String(files().length),
          })}
        </span>
        <Show when={totalChanges().additions > 0 || totalChanges().deletions > 0}>
          <span data-slot="session-turn-diffs-total">
            <span data-slot="session-turn-diffs-total-add">{`+${totalChanges().additions}`}</span>
            <span data-slot="session-turn-diffs-total-del">{`-${totalChanges().deletions}`}</span>
          </span>
        </Show>
        <Show when={props.fallback}>
          <span data-slot="session-turn-diffs-chevron">
            <Icon name="chevron-down" size="small" />
          </span>
        </Show>
      </div>
      <Show when={!state.collapsed}>
        <div data-component="session-turn-diffs-content">
          {/* 每一行是一个"入口"，不是折叠面板：点开去右侧面板看这个文件的改动
              （和用户在编辑器/IDE 里的习惯一致）。之前是在聊天流里就地展开整段 diff，
              一条长改动会把对话顶上去几百行，而且和右侧审查面板显示的是两套东西。 */}
          <For each={visible()}>
            {(diff) => (
              <button
                type="button"
                data-slot="session-turn-diff-trigger"
                data-file={diff.file}
                class="w-full text-left transition-colors hover:bg-hover"
                onClick={() => props.onOpen?.(diff.file)}
              >
                <span data-slot="session-turn-diff-path">
                  <Show when={diff.file.includes("/")}>
                    <span data-slot="session-turn-diff-directory">{`‪${getDirectory(diff.file)}‬`}</span>
                  </Show>
                  <span data-slot="session-turn-diff-filename">{getFilename(diff.file)}</span>
                </span>
                <div data-slot="session-turn-diff-meta">
                  <span data-slot="session-turn-diff-changes">
                    <DiffChanges changes={diff} />
                  </span>
                  <span data-slot="session-turn-diff-chevron">
                    {/* 这一行不再就地展开，箭头只表示"点开去别处看"：
                        CSS 把 chevron-down 旋转 -90°，落成朝右。 */}
                    <Icon name="chevron-down" size="small" />
                  </span>
                </div>
              </button>
            )}
          </For>
          <Show when={!showAll() && overflow() > 0}>
            <div data-slot="session-turn-diffs-more" onClick={() => setState("showAll", true)}>
              {language.t("ui.sessionTurn.diffs.more", { count: String(overflow()) })}
            </div>
          </Show>
        </div>
      </Show>
    </div>
  )
}

/**
 * 回答回执后的产物预览卡(对齐 ZCode AssistantPreviewCards + OpenSplitButton):
 * 左侧类型图标 + 标题 + 「类型 · 扩展名」副标题,右侧「打开 ▾」分裂按钮收次级操作;
 * 列表占满消息列宽、左对齐,不再居中限宽。路径不直接外显,收进菜单里复制。
 * 打开分流:本地服务与 HTML 原型 → 右侧「浏览器」标签的内置预览;
 * Office/PDF/图片 → 右侧「文件」标签按文件方式预览。
 */
function TimelinePreviewCardRow(props: { targets: PreviewTarget[] }) {
  const language = useLanguage()
  const layout = useLayout()
  const preview = usePreview()
  const file = useFile()
  const platform = usePlatform()
  const { tabs } = useSessionLayout()

  const open = (target: PreviewTarget) => {
    if (target.kind === "file" && target.path) {
      const normalized = file.normalize(target.path)
      if (!normalized) return
      void file.load(normalized).then(() => {
        if (file.get(normalized)?.error) return
        const tab = file.tab(normalized)
        void tabs().open(tab)
        tabs().setActive(tab)
        layout.sidePane.add("preview")
      })
      return
    }
    if (!preview.setUrl(target.url)) return
    layout.sidePane.add("browser")
  }

  const copy = (text: string) => {
    // 统一走 writeClipboard：桌面端经主进程写剪贴板，WebView 里 navigator.clipboard
    // 常常因为缺少焦点/安全上下文静默失败。
    void writeClipboard(text).then((copied) => {
      showToast(
        copied
          ? { variant: "success", icon: "circle-check", title: language.t("common.copied") }
          : { variant: "error", title: language.t("toast.copyFailed.title"), description: text },
      )
    })
  }

  // bind 拿到稳定引用:能力存在才渲染「在资源管理器中显示」,也避开 unbound-method 告警。
  const revealInExplorer = platform.showItemInFolder?.bind(platform)

  // 副标题用 ZCode 同款「类型 · 扩展名」标签;server 预览的 title 是 host:port(无扩展名)。
  const subtitle = (target: PreviewTarget) => {
    if (target.kind === "server") return language.t("session.previewCard.website")
    if (target.kind === "html") return language.t("session.previewCard.htmlWebsite")
    const ext = target.title.match(/\.([a-z0-9]{1,6})$/i)?.[1]?.toUpperCase()
    if (!ext) return language.t("session.filePreview.file")
    if (/^(MD|MARKDOWN)$/.test(ext)) return language.t("session.previewCard.markdown")
    if (/^(DOCX?|ODT|RTF)$/.test(ext)) return language.t("session.previewCard.docx")
    if (/^PPTX?$/.test(ext)) return language.t("session.previewCard.pptx")
    if (/^(XLSX?|CSV|TSV)$/.test(ext)) return language.t("session.previewCard.xlsx")
    if (ext === "PDF") return language.t("session.previewCard.pdf")
    return language.t("session.previewCard.image", { ext })
  }

  /**
   * 产物卡配色：按类型给一个色相（CSS 里用 `--preview-tone` 派生图标底色、
   * 边框、打开按钮）。灰白一片时用户扫不出"这是什么文件"，颜色是最省事的分类器。
   */
  const tone = (target: PreviewTarget) => {
    if (target.kind === "server") return "web"
    if (target.kind === "html") return "html"
    const ext = target.title.match(/\.([a-z0-9]{1,6})$/i)?.[1]?.toUpperCase() ?? ""
    if (/^(DOCX?|ODT|RTF|MD|MARKDOWN|TXT)$/.test(ext)) return "doc"
    if (/^(XLSX?|CSV|TSV)$/.test(ext)) return "sheet"
    if (/^PPTX?$/.test(ext)) return "slides"
    if (ext === "PDF") return "pdf"
    if (/^(PNG|JPE?G|GIF|WEBP|SVG|BMP|AVIF|ICO)$/.test(ext)) return "image"
    return "file"
  }

  // 本地服务可能已经停了（前台命令超时被回收 / 用户手动停了任务）。
  // 探测一次给卡片打个"服务已停止"的标签，避免用户点开才发现是死链。
  const [offline, setOffline] = createSignal<Record<string, boolean>>({})
  createEffect(() => {
    for (const target of props.targets) {
      if (target.kind !== "server") continue
      const url = target.url
      if (offline()[url] !== undefined) continue
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 2500)
      void fetch(url, { method: "HEAD", mode: "no-cors", signal: controller.signal })
        .then(() => setOffline((prev) => ({ ...prev, [url]: false })))
        .catch(() => setOffline((prev) => ({ ...prev, [url]: true })))
        .finally(() => clearTimeout(timer))
    }
  })

  return (
    <div data-slot="session-turn-preview" data-component="session-turn-preview" class="flex w-full flex-col gap-3">
      <For each={props.targets}>
        {(target) => (
          <div
            data-preview-kind={target.kind}
            data-preview-tone={target.kind === "server" && offline()[target.url] ? "offline" : tone(target)}
            aria-label={`${language.t("sidePane.tab.preview")} ${target.title}`}
            title={target.kind === "server" ? target.url : target.path}
            class="group flex w-full cursor-pointer items-center gap-3 rounded-xl border border-border bg-surface p-3 pr-3.5 text-foreground transition-all duration-150 hover:-translate-y-px hover:border-border-hover"
            onClick={() => open(target)}
          >
            <span
              data-slot="preview-card-icon"
              class="flex size-11 shrink-0 items-center justify-center rounded-[10px]"
            >
              <Show
                when={target.kind === "server"}
                fallback={
                  <FileIcon node={{ path: target.title, type: "file" }} style={{ width: "24px", height: "24px" }} />
                }
              >
                <Icon name="globe" size="medium" />
              </Show>
            </span>
            <span class="flex min-w-0 flex-1 flex-col gap-1">
              <span class="truncate text-ui-base font-medium leading-5">{target.title}</span>
              <span class="flex min-w-0 items-center gap-2">
                <span data-slot="preview-card-subtitle" class="truncate text-ui-base leading-5">
                  {subtitle(target)}
                </span>
                <Show when={target.kind === "server" && offline()[target.url]}>
                  <span data-slot="preview-card-offline">{language.t("session.previewCard.offline")}</span>
                </Show>
              </span>
            </span>
            <div
              data-slot="preview-card-open"
              class="flex h-8 shrink-0 items-center overflow-hidden rounded-lg border transition-colors"
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                class="flex h-full cursor-pointer items-center rounded-none border-0 bg-transparent py-0 pl-3 pr-2 text-ui-base font-medium"
                onClick={() => open(target)}
              >
                {language.t("common.open")}
              </button>
              <span data-slot="preview-card-open-divider" class="h-4 w-px shrink-0" />
              <DropdownMenu placement="top" gutter={6}>
                <DropdownMenu.Trigger
                  class="flex h-full !w-6 cursor-pointer items-center justify-center rounded-none border-0 bg-transparent p-0"
                  aria-label={language.t("session.previewCard.openOptions")}
                  title={language.t("session.previewCard.openOptions")}
                >
                  <Icon name="chevron-down" size="small" />
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content class="w-44">
                    <Show
                      when={target.kind !== "file"}
                      fallback={
                        <Show when={target.path}>
                          {(path) => (
                            <>
                              <Show when={revealInExplorer}>
                                <DropdownMenu.Item onSelect={() => void revealInExplorer?.(path())}>
                                  <Icon name="folder" size="small" />
                                  <span>{language.t("session.filePreview.revealInExplorer")}</span>
                                </DropdownMenu.Item>
                              </Show>
                              <DropdownMenu.Item onSelect={() => copy(path())}>
                                <Icon name="copy" size="small" />
                                <span>{language.t("session.filePreview.copyAbsolutePath")}</span>
                              </DropdownMenu.Item>
                            </>
                          )}
                        </Show>
                      }
                    >
                      <DropdownMenu.Item onSelect={() => platform.openLink(target.url)}>
                        <Icon name="square-arrow-top-right" size="small" />
                        <span>{language.t("preview.openExternal")}</span>
                      </DropdownMenu.Item>
                      <DropdownMenu.Item onSelect={() => copy(target.url)}>
                        <Icon name="copy" size="small" />
                        <span>{language.t("session.previewCard.copyLink")}</span>
                      </DropdownMenu.Item>
                    </Show>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu>
            </div>
          </div>
        )}
      </For>
    </div>
  )
}

/**
 * 验证结果行:工具产出的图片证据(浏览器截图)贴在轮尾。
 *
 * 过程行会被折进「已工作 X」的折叠卡里,截图若只挂在工具行内部,用户看到的
 * 永远只有一句"已验证"。这里把截图直接铺在回复最下面(对齐 ZCode),点开可放大。
 *
 * 展示上只占一张:一次修改往往会产生好几张(改前/改后/交互后),平铺会变成图墙。
 * 默认第一张,左右箭头切换,切换时有短暂淡入过渡;数量与序号写在标题行里。
 *
 * 尺寸固定成缩略图(320×180,约为聊天列的四分之一)并靠左:
 * 1. 截图原尺寸铺满整行时,一条回复里半屏都是图,正文被挤得看不见;
 * 2. 之前每张图按自身比例撑高,切换时行高变化 → 虚拟列表重新量高 → 整段聊天区闪一下。
 *    外框固定后高度不再随图变化,过渡动画只发生在框内。
 */
function TimelineToolEvidenceRow(props: { images: EvidenceImage[] }) {
  const language = useLanguage()
  const dialog = useDialog()
  const [index, setIndex] = createSignal(0)

  // 附件可能是 data URL(截图走这条)或本地路径;后者在桌面端要换成受信任的协议地址。
  const source = (url: string) => {
    if (/^(data:|blob:|https?:)/i.test(url)) return url
    const absolute = url.startsWith("file:") ? url : `file:///${url.replace(/\\/g, "/").replace(/^\/+/, "")}`
    return window.api?.toPreviewUrl?.(absolute) ?? absolute
  }

  const total = () => props.images.length
  const current = () => props.images[Math.min(index(), total() - 1)]
  const step = (delta: number) => setIndex((value) => (value + delta + total()) % total())

  return (
    <div data-component="tool-evidence" class="flex w-full min-w-0 flex-col items-start gap-2">
      <div class="flex min-w-0 items-center gap-1.5 text-12-medium text-foreground-subtle">
        <Icon name="lu-image" size="small" class="text-foreground-subtlest" />
        <span>{language.t("session.evidence.title")}</span>
        <Show when={total() > 1}>
          <span class="ml-1 tabular-nums text-foreground-subtlest">
            {index() + 1}/{total()}
          </span>
          <IconButton
            icon="chevron-left"
            variant="ghost"
            size="small"
            class="ml-1"
            onClick={() => step(-1)}
            aria-label={language.t("session.evidence.previous")}
            title={language.t("session.evidence.previous")}
          />
          <IconButton
            icon="chevron-right"
            variant="ghost"
            size="small"
            onClick={() => step(1)}
            aria-label={language.t("session.evidence.next")}
            title={language.t("session.evidence.next")}
          />
        </Show>
      </div>
      <Show when={current()}>
        {(image) => (
          <div class="relative h-[180px] w-[320px] max-w-full overflow-hidden rounded-xl border border-border bg-surface">
            <Show keyed when={{ url: source(image().url), name: image().name, tool: image().tool, index: index() }}>
              {(frame) => (
                <button
                  type="button"
                  class="evidence-in absolute inset-0 block h-full w-full cursor-zoom-in"
                  title={frame.name ?? frame.tool}
                  onClick={() => dialog.show(() => <ImagePreview src={frame.url} alt={frame.name} />)}
                >
                  <img
                    src={frame.url}
                    alt={frame.name ?? frame.tool}
                    class="block h-full w-full object-cover"
                    loading="lazy"
                  />
                </button>
              )}
            </Show>
          </div>
        )}
      </Show>
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
  const globalSync = useGlobalSync()
  const queryClient = useQueryClient()
  const settings = useSettings()
  const dialog = useDialog()
  const language = useLanguage()
  const { params, sessionKey, tabs } = useSessionLayout()
  const layout = useLayout()
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

  createEffect(() => {
    const id = sessionID()
    if (!id || sync.data.session_diff[id] !== undefined) return
    void sync.session.diff(id)
  })

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
  const getMsgPart = (messageID: string, partID: string) => getMsgParts(messageID).find((part) => part.id === partID)

  const latestUserPrompt = createMemo(() => {
    const messages = sessionMessages()
      .filter((message) => message.role === "user")
      .slice(-3)
    return messages
      .map((message) =>
        getMsgParts(message.id)
          .filter(
            (part): part is Extract<PartType, { type: "text" }> =>
              part.type === "text" && !part.synthetic && !part.ignored,
          )
          .map((part) => part.text)
          .filter(Boolean)
          .join("\n"),
      )
      .filter(Boolean)
      .join("\n\n")
      .trim()
  })
  const latestWorkflowScene = createMemo(() => {
    const last = sessionMessages()
      .filter((message) => message.role === "assistant")
      .at(-1)
    const agent = last?.agent
    if (agent?.startsWith("office-")) return agent.slice("office-".length)
    return "document"
  })
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
  // 桌面端不渲染 sticky 标题栏(标题改名、父会话跳转、存为工作流都在这行),聊天内容顶到最上;
  // 网页端/移动端照旧。--session-title-height/--sticky-accordion-top 已随 showHeader() 一并归零。
  const showHeader = createMemo(() => platform.platform !== "desktop" && !!(titleValue() || parentID()))

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
            indexAccessor() === props.userMessages.length - 1,
          )

          return reuseTimelineRows(previous, rows)
        })
      },
    ),
  )

  // 产物卡素材:对齐 ZCode 的「正文为主、写盘为证」——素材来自 AI 回答正文的分层提取
  // (引用指令 > markdown 链接 > file:// > 定界/裸路径),md/html 引用必须命中本轮写盘证明,
  // office/pdf/图片不需要;bash 输出里的本地服务地址作兜底来源。
  // 写盘证明 = 本轮 diff ∪ 工具调用自报的写入目标(见 written-files.ts):只信 diff 的话,
  // 非 git 工作区拿不到证明,同一个原型就会"这次出卡、下次不出"。只扫已完成的轮次。
  const previewCandidatesByUserMessage = createMemo(() => {
    const directory = sdk.directory
    const result = new Map<string, { signature: string; candidates: PreviewCardCandidate[] }>()
    for (const message of props.userMessages) {
      const assistants = assistantMessagesByParent().get(message.id)
      if (!assistants || assistants.length === 0) continue
      if (!assistants.every((item) => typeof item.time.completed === "number")) continue

      const turnText = assistants
        .flatMap((item) => getMsgParts(item.id))
        .filter(
          (part): part is Extract<PartType, { type: "text" }> =>
            part.type === "text" && !part.synthetic && !part.ignored,
        )
        .map((part) => part.text)
        .filter(Boolean)
        .join("\n\n")

      const turnParts = assistants.flatMap((item) => getMsgParts(item.id))

      // 写盘证明 = 本轮 diff ∪ 工具调用自报的写入目标。只有 diff 的话，
      // 非 git 工作区（快照不可用）会永远拿不到证明，产物卡就时有时无。
      const changedFilePaths = [
        ...new Set([
          ...uniqueSummaryDiffs(message.summary?.diffs).map((diff) => resolveWorkspacePath(diff.file, directory)),
          ...collectTurnWrittenPaths(turnParts, directory),
        ]),
      ].filter((path) => !!path && !isExcludedPath(path))

      // bash 输出扫本地服务地址(兜底:服务起了但回答正文里没写 URL)
      const bashUrls: string[] = []
      for (const part of turnParts) {
        if (part.type !== "tool") continue
        const output = "output" in part.state && typeof part.state.output === "string" ? part.state.output : ""
        if (!output) continue
        for (const match of stripAnsi(output).matchAll(LOCAL_URL)) {
          const url = normalizeLocalUrl(match[0])
          if (!url || bashUrls.includes(url)) continue
          bashUrls.push(url)
        }
      }

      const candidates = buildPreviewCardCandidates({
        turnText,
        workspacePath: directory,
        changedFilePaths,
        bashUrls,
      }).filter((candidate) => !candidate.path || !isExcludedPath(candidate.path))
      if (candidates.length === 0) continue
      const signature = JSON.stringify(candidates)
      result.set(message.id, { signature, candidates })
    }
    return result
  })

  // 存在性校验:文件卡必须确认文件真的存在才出(对齐 ZCode 的 stat 校验,防止死卡),
  // server 卡无需落盘校验。按候选签名缓存;按父目录分组 list,全部算完后一次性发布,
  // 避免历史会话切换时卡片先闪一批再被替换。
  const previewStatCache = new Map<string, Set<string>>()
  const previewStatInflight = new Set<string>()
  const [validatedPreviewPaths, setValidatedPreviewPaths] = createSignal<Record<string, readonly string[]>>({})

  createEffect(() => {
    const byMessage = previewCandidatesByUserMessage()
    const resolved: Record<string, readonly string[]> = {}
    const pending: Array<{ id: string; signature: string; paths: string[] }> = []
    for (const [id, entry] of byMessage) {
      const cached = previewStatCache.get(entry.signature)
      if (cached) {
        resolved[id] = [...cached]
        continue
      }
      if (previewStatInflight.has(entry.signature)) continue
      const paths = [
        ...new Set(entry.candidates.map((candidate) => candidate.path).filter((path): path is string => !!path)),
      ]
      if (paths.length === 0) {
        previewStatCache.set(entry.signature, new Set())
        resolved[id] = []
        continue
      }
      pending.push({ id, signature: entry.signature, paths })
    }
    setValidatedPreviewPaths(reconcile(resolved))
    if (pending.length === 0) return
    for (const item of pending) previewStatInflight.add(item.signature)
    void (async () => {
      const directory = sdk.directory
      const dirCache = new Map<string, Set<string>>()
      for (const item of pending) {
        const existing = new Set<string>()
        // file.list 只接受工作区相对路径(绝对路径服务端会 500),先转相对再按父目录分组
        const byDir = new Map<string, string[]>()
        for (const path of item.paths) {
          const relative = relativeToWorkspace(path, directory)
          const dir = getDirectory(relative)
          const paths = byDir.get(dir) ?? []
          paths.push(path)
          byDir.set(dir, paths)
        }
        for (const [dir, dirPaths] of byDir) {
          let names = dirCache.get(dir)
          if (!names) {
            try {
              const response = await sdk.client.file.list({ path: dir })
              names = new Set((response.data ?? []).map((node) => normalizePathForCompare(node.absolute || node.path)))
            } catch {
              // 目录读不到(工作区外/已删除)按不存在处理,对应的卡直接不出
              names = new Set()
            }
            dirCache.set(dir, names)
          }
          for (const path of dirPaths) {
            if (names.has(normalizePathForCompare(path))) existing.add(path)
          }
        }
        previewStatCache.set(item.signature, existing)
      }
      setValidatedPreviewPaths((prev) => {
        const next = { ...prev }
        for (const item of pending) {
          const cached = previewStatCache.get(item.signature)
          if (cached) next[item.id] = [...cached]
        }
        return next
      })
      for (const item of pending) previewStatInflight.delete(item.signature)
    })()
  })

  const previewTargetsByUserMessage = createMemo(() => {
    const byMessage = previewCandidatesByUserMessage()
    const validated = validatedPreviewPaths()
    const result = new Map<string, PreviewTarget[]>()
    for (const [id, entry] of byMessage) {
      const existing = validated[id]
      const targets = entry.candidates
        .filter((candidate) => !candidate.path || (existing !== undefined && existing.includes(candidate.path)))
        .slice(0, PREVIEW_CARD_VISIBLE_LIMIT)
        .map(
          (candidate): PreviewTarget => ({
            kind: candidate.kind,
            url: candidate.url,
            path: candidate.path,
            title: candidate.title,
            subtitle: candidate.subtitle,
          }),
        )
      if (targets.length > 0) result.set(id, targets)
    }
    return result
  })

  // 会话级文件变更兜底:最后一轮自己的 summary.diffs 缺失(比如文件是经 bash 间接写入的)
  // 时,用会话维度的 diff 在最底下补一张"文件更改"卡,对齐 ZCode 的底部 Changed files。
  const sessionDiffFallback = createMemo(() => {
    const id = sessionID()
    const last = props.userMessages.at(-1)
    if (!id || !last) return []
    if (sessionStatus().type !== "idle" && activeMessageID() === last.id) return []
    const turnRows = messageRowMemos().at(-1)?.() ?? []
    if (turnRows.some((row) => row._tag === "DiffSummary")) return []
    return uniqueSummaryDiffs(sync.data.session_diff[id]).slice(0, 20)
  })

  // 全局待办清单实时状态:分区头部的状态标签优先读它。服务端待办没有稳定 id,
  // 按 content(标题)匹配。
  const liveTodoStatusByContent = createMemo(() => {
    const id = sessionID()
    if (!id) return undefined
    const todos = globalSync.data.session_todo[id]
    if (!todos || todos.length === 0) return undefined
    return new Map(todos.map((todo) => [todo.content, todo.status] as const))
  })

  // 每轮的起止时间(用户消息/首条助手消息 time.created → 最后 completed),
  // 给按轮折叠的"已工作 X"和运行中的实时计时用。
  const turnTimeByUserMessage = createMemo(() => {
    const result = new Map<string, { start?: number; end?: number }>()
    for (const [userMessageID, messages] of assistantMessagesByParent()) {
      if (messages.length === 0) continue
      let start: number | undefined
      let end: number | undefined
      const userCreated = messageByID().get(userMessageID)?.time?.created
      if (typeof userCreated === "number") start = userCreated
      for (const message of messages) {
        if (typeof message.time.created === "number")
          start = start === undefined ? message.time.created : Math.min(start, message.time.created)
        if (typeof message.time.completed === "number")
          end = end === undefined ? message.time.completed : Math.max(end, message.time.completed)
      }
      result.set(userMessageID, { start, end: end ?? undefined })
    }
    return result
  })

  /**
   * 每轮的工具图片证据(浏览器截图):挂在轮尾当作"验证结果"。
   *
   * 之前这类附件只写进 part.state.attachments,界面上完全不渲染 —— 模型说"已验证",
   * 用户却看不到任何画面。这里按轮收集,轮尾单独成行(不折进过程卡),对齐 ZCode
   * 的"验证完把截图贴在回复最下面"。只留最近几张,避免长会话底部堆成图墙。
   */
  const toolEvidenceByUserMessage = createMemo(() => {
    // 单轮上限放宽到 12：一组验证可能是「改前 / 改后 / 交互后」几张，
    // 界面上只展示一张（轮播），所以不需要再用 3 张强行截断。
    const limit = 12
    const result = new Map<string, EvidenceImage[]>()
    for (const [userMessageID, messages] of assistantMessagesByParent()) {
      const images: EvidenceImage[] = []
      for (const message of messages) {
        for (const part of getMsgParts(message.id)) {
          if (part.type !== "tool") continue
          const attachments = (part.state as { attachments?: unknown }).attachments
          if (!Array.isArray(attachments)) continue
          for (const item of attachments) {
            if (!item || typeof item !== "object") continue
            const file = item as { mime?: unknown; url?: unknown; filename?: unknown }
            if (typeof file.mime !== "string" || !file.mime.startsWith("image/")) continue
            if (typeof file.url !== "string" || !file.url) continue
            images.push({
              url: file.url,
              name: typeof file.filename === "string" ? file.filename : undefined,
              tool: part.tool,
            })
          }
        }
      }
      if (images.length > 0) result.set(userMessageID, images.slice(-limit))
    }
    return result
  })

  const timelineRows = createMemo((previous: TimelineRow.TimelineRow[] | undefined) => {
    const rows = messageRowMemos().flatMap((memo, index) => {
      const turnRows = memo()
      const id = props.userMessages[index]?.id
      if (!id) return turnRows
      const targets = previewTargetsByUserMessage().get(id)
      const images = toolEvidenceByUserMessage().get(id)
      if (!targets && !images) return turnRows
      return [
        ...turnRows,
        ...(targets ? [new TimelineRow.PreviewCard({ userMessageID: id, targets })] : []),
        // 验证截图放在最后:用户看到的是"回复 → 产物 → 验证结果",与 ZCode 一致。
        ...(images ? [new TimelineRow.ToolEvidence({ userMessageID: id, images })] : []),
      ]
    })
    const last = props.userMessages.at(-1)
    const fallback = sessionDiffFallback()
    if (last && fallback.length > 0) {
      rows.push(new TimelineRow.DiffSummary({ userMessageID: last.id, diffs: fallback, fallback: true }))
    }
    if (rows.length === 0) return rows
    // 按待办清单分组:待办工具出现前的行走原有流式;之后的行按 in_progress 待办归入分区。
    const grouped = TodoGrouping.group(rows, {
      getPart: getMsgPart,
      liveStatus: (content) => liveTodoStatusByContent()?.get(content),
    })
    // 按轮折叠过程:跑完的轮次把过程折成一张卡,只留最终结果。
    const folded = TurnFold.fold(grouped, {
      getPart: getMsgPart,
      turnTime: (id) => turnTimeByUserMessage().get(id) ?? {},
    })
    return reuseTimelineRows(previous, [...folded, new TimelineRow.BottomSpacer()])
  })
  const timelineRowByKey = createMemo(() => new Map(timelineRows().map((row) => [TimelineRow.key(row), row] as const)))
  const timelineRowKeys = createMemo(() => [...timelineRowByKey().keys()], [] as string[], { equals: sameKeys })
  createEffect(
    on(sessionKey, () => {
      setVirtualFallback(false)
      recoverAttempts = 0
    }),
  )

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
  // 虚拟列表的强制重建计数：见 nudgeViewport 的说明。
  const [virtualGeneration, setVirtualGeneration] = createSignal(0)
  // virtua 在极端情况下（首次测量时容器不可见）会一直渲染 0 行。
  // 自动恢复多次仍失败就降级为「不虚拟化」直接渲染，先保证内容可见；
  // 切换会话时重置，下次回到正常的虚拟列表。
  const [virtualFallback, setVirtualFallback] = createSignal(false)
  let recoverAttempts = 0
  let recovering = false
  const sideChat = useSideChat()

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

  /**
   * 让 virtua 重新测一次视口。
   *
   * 症状：聊天区有数据但一行都不渲染（滚动也不一定马上恢复），
   * 打开设置/数据库覆盖层再回来、或打开右侧面板后最容易出现。
   * 根因是 virtua 的 ResizeObserver 首次回调时元素还在 `display:none`
   * 的子树里（`offsetParent` 为空被跳过），之后尺寸没再变化就不会重测，
   * `_isViewportMeasured` 一直是 false，可见区间始终是空。
   *
   * 解决办法：轻微改变滚动容器尺寸再还原，强制触发一次尺寸回调。
   * 只在「一行都没渲染」时做，避免打断正常滚动。
   */
  /**
   * 视口里是否真的有可见的行。
   *
   * 之前只判断「DOM 里有没有行」，但 virtua 在列宽变化（开/关右侧面板）后
   * 会出现另一种坏状态：行都在 DOM 里，却被旧的偏移量整体推到视口之外。
   * 这时列表看起来是全白的，滚一下才恢复，而 `querySelector` 的检查会
   * 误判为「已经正常」，恢复链直接退出。必须按实际矩形判断。
   */
  const hasVisibleRow = () => {
    const root = listRoot
    if (!root || root.clientHeight <= 0) return false
    const viewport = root.getBoundingClientRect()
    const rows = root.querySelectorAll<HTMLElement>("[data-timeline-row]")
    for (const row of rows) {
      const rect = row.getBoundingClientRect()
      if (rect.height <= 0) continue
      if (rect.bottom > viewport.top + 1 && rect.top < viewport.bottom - 1) return true
    }
    return false
  }

  const rowsMounted = () => !!listRoot?.querySelector("[data-timeline-row]")

  /** 列表空白时按记录下来的锚点滚回去（底部跟随时回到底部）。 */
  const restoreAfterBlank = () => {
    const handle = virtualizer
    const keys = timelineRowKeys()
    if (!handle || keys.length === 0) return
    const anchor = widthAnchor
    if (anchor) {
      const index = Math.min(anchor.index, keys.length - 1)
      handle.scrollTo(handle.getItemOffset(index) + anchor.fraction)
      return
    }
    if (measuredBottomAnchored || props.shouldAnchorBottom()) {
      handle.scrollToIndex(keys.length - 1, { align: "end" })
    }
  }

  const nudgeViewport = () => {
    const root = listRoot
    if (!root || !root.isConnected || recovering) return
    if (hasVisibleRow()) {
      recoverAttempts = 0
      return
    }
    if (timelineRowKeys().length === 0) return
    // 行都在、只是被旧偏移量推出视口：先按锚点滚回去，多数情况一步到位。
    if (rowsMounted()) {
      restoreAfterBlank()
      if (hasVisibleRow()) {
        recoverAttempts = 0
        return
      }
    }
    ;(window as any).__nudgeInfo = {
      rows: root.querySelectorAll("[data-timeline-row]").length,
      attempts: recoverAttempts,
    }
    if (recoverAttempts >= 3) return
    recovering = true
    // 先轻微改尺寸逼 ResizeObserver 回调；多数情况到这一步就恢复了。
    // 用 setTimeout 而不是 rAF：窗口被遮挡/最小化时 rAF 会被节流，
    // 恢复链会停在中途（这正是面板在后台变空白的原因之一）。
    root.style.paddingBottom = "1px"
    setTimeout(() => {
      if (!root.isConnected) {
        recovering = false
        return
      }
      root.style.paddingBottom = ""
      setTimeout(() => {
        recovering = false
        if (hasVisibleRow()) {
          recoverAttempts = 0
          if (measuredBottomAnchored) root.scrollTop = root.scrollHeight
          return
        }
        // 还没渲染出来：virtua 内部状态已经坏了（首次测量时元素不可见），
        // 先把 Virtualizer 重建一次；多次仍失败就降级为直接渲染，保证内容可见。
        recoverAttempts += 1
        if (recoverAttempts >= 3) {
          setVirtualFallback(true)
          return
        }
        restoreAfterBlank()
        setVirtualGeneration((value) => value + 1)
      }, 32)
    }, 32)
  }

  const recoverViewport = () => {
    queueMicrotask(nudgeViewport)
  }

  createEffect(() => {
    if (typeof window === "undefined") return
    const onOverlayClosed = () => {
      recoverViewport()
      // 动画结束后再校验一次：面板卸载/布局回稳是两帧之后的事。
      setTimeout(recoverViewport, 120)
      setTimeout(recoverViewport, 1100)
    }
    const onVisibility = () => {
      if (document.visibilityState === "visible") onOverlayClosed()
    }
    window.addEventListener("focus", onOverlayClosed)
    window.addEventListener("novaway:overlay-closed", onOverlayClosed)
    document.addEventListener("visibilitychange", onVisibility)
    onCleanup(() => {
      window.removeEventListener("focus", onOverlayClosed)
      window.removeEventListener("novaway:overlay-closed", onOverlayClosed)
      document.removeEventListener("visibilitychange", onVisibility)
    })
  })

  // 侧栏开/关与文件标签切换会让聊天列在 320ms 过渡里逐帧变宽变窄——virtua 的
  // ResizeObserver 在这个窗口里最容易丢测量（症状见 nudgeViewport 注释），而上面
  // 的恢复触发点只覆盖覆盖层/focus，不含侧栏。开、关、换激活标签各拉起一次恢复链。
  //
  // 同时预记录滚动锚点：0 行空白时 scrollTop 会被浏览器钳到 0，等恢复后再想找回
  // 位置就晚了——必须在宽度还没开始变（effect 同步于 store 变化，早于 CSS 过渡）
  // 时把「视口顶部是哪一行」记下来，交给 widthAnchorTick 在布局回稳后滚回原位。
  createEffect(() => {
    layout.sidePane.opened()
    layout.sidePane.activeTab()
    if (typeof window === "undefined") return
    const handle = virtualizer
    // 过渡开始前记下"是否跟随底部"：动画期间 scrollTop 可能被钳到 0，
    // 之后再读 measuredBottomAnchored 已经不可信了。
    const followBottom = measuredBottomAnchored || props.shouldAnchorBottom()
    if (handle && !followBottom) {
      const offset = handle.scrollOffset
      if (offset > 0) {
        const index = handle.findItemIndex(offset + 1)
        if (index > 0) {
          widthAnchor = { index, fraction: offset - handle.getItemOffset(index) }
          // 覆盖 320ms 过渡 + virtua 恢复（1px nudge 两轮 32ms，最坏重建一轮）还有富余。
          widthAnchorFrames = 60
          widthAnchorTicks = 0
          if (widthAnchorFrame === undefined) widthAnchorFrame = requestAnimationFrame(widthAnchorTick)
        }
      }
    }
    recoverViewport()
    // 跟随底部时，过渡期间就可能被钳到顶部：尽早、多次把视口锁回底部。
    // 用户一旦自己滚过（scrollGesture），就不再抢滚动权。
    const anchorBottom = () => {
      if (!followBottom || props.hasScrollGesture()) return
      const keys = timelineRowKeys()
      if (!handle || keys.length === 0) return
      handle.scrollToIndex(keys.length - 1, { align: "end" })
      measuredBottomAnchored = true
    }
    const timers = [
      setTimeout(recoverViewport, 120),
      setTimeout(recoverViewport, 400),
      setTimeout(recoverViewport, 1100),
      setTimeout(anchorBottom, 90),
      setTimeout(anchorBottom, 260),
      // 320ms 宽度过渡结束后再校一次位置：跟底部就回到底部，否则回到锚点行。
      // 这一步专治"开关右栏后被甩回第一条问题"——空白期间浏览器把 scrollTop
      // 钳成 0，virtua 恢复后不会自己滚回原来的位置。
      setTimeout(() => {
        if (followBottom) {
          anchorBottom()
          scheduleMeasuredBottomAnchor()
          return
        }
        recoverViewport()
        if (!hasVisibleRow()) restoreAfterBlank()
      }, 460),
    ]
    onCleanup(() => timers.forEach(clearTimeout))
  })

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

  // 聊天列宽变化后的滚动补偿:开/关右侧面板、居中模式切换都会改列宽,行高随之重排。
  // virtua 对未挂载行沿用旧尺寸缓存,极端情况下(如 Virtualizer 重建、缓存失效)首屏
  // 内容会整体漂移,长会话能一路漂回第一条。记录视口顶部行,列宽变化稳定后若首屏行
  // 已经漂走再把它滚回原位;virtua 自身校正成功时这里不动作。
  let lastListWidth = 0
  let widthAnchor: { index: number; fraction: number } | undefined
  let widthAnchorFrame: number | undefined
  let widthAnchorFrames = 0
  // tick 总帧数上限：blank 期间不递减 widthAnchorFrames（见下），靠它兜底防止死循环。
  let widthAnchorTicks = 0

  const listIsBlank = () => !hasVisibleRow()

  const widthAnchorTick = () => {
    widthAnchorFrame = undefined
    const handle = virtualizer
    const anchor = widthAnchor
    if (!handle || !anchor) return
    const keys = timelineRowKeys()
    if (keys.length === 0 || anchor.index >= keys.length) {
      widthAnchor = undefined
      return
    }
    // 列表正处在 0 行空白（virtua 测量丢失待恢复）：此时滚动位置是被钳到 0 的垃圾，
    // 既不能据此判断"漂了"去 scrollTo，也不消耗帧数——等行渲染回来再纠偏。
    widthAnchorTicks += 1
    if (listIsBlank() && widthAnchorTicks < 180) {
      widthAnchorFrame = requestAnimationFrame(widthAnchorTick)
      return
    }
    const topIndex = handle.findItemIndex(handle.scrollOffset + 1)
    if (topIndex !== anchor.index) {
      handle.scrollTo(handle.getItemOffset(anchor.index) + anchor.fraction)
      widthAnchor = undefined
      return
    }
    widthAnchorFrames -= 1
    if (widthAnchorFrames <= 0) {
      widthAnchor = undefined
      return
    }
    widthAnchorFrame = requestAnimationFrame(widthAnchorTick)
  }

  createResizeObserver(
    () => scrollRoot(),
    (rect) => {
      const handle = virtualizer
      if (!handle) return
      if (lastListWidth === 0) {
        lastListWidth = rect.width
        return
      }
      if (Math.abs(rect.width - lastListWidth) < 1) return
      lastListWidth = rect.width
      // 列宽变化后如果列表已经白了，立刻拉恢复链，别等下一次 focus/面板事件。
      if (listIsBlank()) recoverViewport()
      // 底部锁定交给底部锚定逻辑接管,不重复纠偏。
      if (measuredBottomAnchored || props.shouldAnchorBottom()) return
      // 空白列表的 scrollOffset 已被钳到 0，据此记锚点会把好锚点覆盖成"回到顶部"。
      // 侧栏过渡开始前已经预记录了锚点（见侧栏 effect），这里保住它。
      if (listIsBlank()) return
      const offset = handle.scrollOffset
      const index = handle.findItemIndex(offset + 1)
      widthAnchor = { index, fraction: offset - handle.getItemOffset(index) }
      widthAnchorFrames = 12
      if (widthAnchorFrame === undefined) widthAnchorFrame = requestAnimationFrame(widthAnchorTick)
    },
  )

  onCleanup(() => {
    if (listFrame !== undefined) cancelAnimationFrame(listFrame)
    if (contentFrame !== undefined) cancelAnimationFrame(contentFrame)
    if (bottomAnchorFrame !== undefined) cancelAnimationFrame(bottomAnchorFrame)
    if (widthAnchorFrame !== undefined) cancelAnimationFrame(widthAnchorFrame)
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

  const saveConversationWorkflow = useMutation(() => ({
    mutationFn: async () => {
      const id = sessionID()
      const prompt = latestUserPrompt()
      if (!id || !prompt) throw new Error("当前对话还没有可保存的需求")
      const result = await globalSDK.client.office.platform.workflow.create({
        title: titleLabel() || "自定义工作流",
        scene: latestWorkflowScene(),
        prompt,
        connectors: [],
        browser: { enabled: false },
        sourceSessionId: id,
      })
      return result.data
    },
    onSuccess: (result) => {
      showToast({ title: "已存为工作流", description: result?.title ?? "可在办公平台中再次运行" })
    },
    onError: () => {
      showToast({ title: "保存工作流失败", description: "请先在对话中描述办公需求。" })
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
            <span class="text-14-regular text-foreground">
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

  /**
   * 点开消息里的文件链接。
   *
   * 除了开标签，还必须**把右侧面板切到预览并展开** —— 只 `tabs().open()` 的话，
   * 面板如果停在「审查 / 终端」或者干脆没开，用户点完什么也看不见
   * （这正是"点了文件名没反应"的原因）。
   */
  const openOutputFile = (path: string) => {
    const normalized = file.normalize(path)
    if (!normalized) return
    void file.load(normalized).then(() => {
      // 链接识别只能靠"看起来像路径"，目录也会被标成可点（`/e/AImoney/PowersNexus`
      // 这种没有扩展名的绝对路径）。读失败就当它不是一个文件：不开标签、不报错，
      // 否则会打开一个内容为空的假标签（而且会把真正的预览挤掉）。
      if (file.get(normalized)?.error) return
      const tab = file.tab(normalized)
      void tabs().open(tab)
      tabs().setActive(tab)
      layout.sidePane.add("preview")
    })
  }

  /**
   * 在右侧面板打开某个文件的**改动**。
   *
   * 和 `openOutputFile` 的区别：这里不等文件读成功。被删掉的文件读一定失败，
   * 但"整段删除"恰恰是最该看的；预览面板的 diff 来自会话快照，不依赖当前文件内容。
   */
  const openDiffFile = (path: string) => {
    const normalized = file.normalize(path)
    if (!normalized) return
    void file.load(normalized)
    const tab = file.tab(normalized)
    void tabs().open(tab)
    tabs().setActive(tab)
    layout.sidePane.add("preview")
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

    if (untrack(row).group.type === "reasoning") {
      const message = createMemo(() => {
        const group = row().group
        if (group.type !== "reasoning") return
        return messageByID().get(group.refs[0]?.messageID ?? "")
      })
      const part = createMemo(() => {
        const group = row().group
        if (group.type !== "reasoning") return
        return mergeReasoningParts(
          group.refs
            .map((ref) => getMsgPart(ref.messageID, ref.partID))
            .filter((part): part is ReasoningPart => part?.type === "reasoning"),
        )
      })

      return (
        <Show when={message()}>
          {(message) => (
            <Show when={part()}>
              {(part) => (
                <MessagePart
                  part={part()}
                  message={message()}
                  showAssistantCopyPartID={assistantCopyPartID(row().userMessageID)}
                  turnDurationMs={turnDurationMs(row().userMessageID)}
                  deferToolContent={false}
                  onFileOpen={openOutputFile}
                />
              )}
            </Show>
          )}
        </Show>
      )
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
                  part={visiblePart(part(), message())}
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
    const [savedPath, setSavedPath] = createSignal("")
    const actionButton =
      "group inline-flex items-center gap-1.5 rounded-[8px] border border-border bg-background px-2.5 py-1.5 text-12-medium text-foreground-subtle shadow-[0_0_0_0_rgba(16,185,129,0)] outline-none transition-all duration-150 hover:-translate-y-px hover:border-emerald-300/55 hover:bg-emerald-300/[0.08] hover:text-emerald-100 hover:shadow-[0_8px_22px_rgba(16,185,129,0.12)] active:translate-y-0 active:scale-[0.98] active:border-emerald-300/70 active:bg-emerald-300/[0.14] focus-visible:border-emerald-300/70 focus-visible:ring-2 focus-visible:ring-emerald-300/25"
    const primaryActionButton =
      "group inline-flex items-center gap-1.5 rounded-[8px] border border-emerald-300/40 bg-emerald-300/10 px-2.5 py-1.5 text-12-medium text-emerald-100 shadow-[0_0_0_0_rgba(16,185,129,0)] outline-none transition-all duration-150 hover:-translate-y-px hover:border-emerald-300/70 hover:bg-emerald-300/18 hover:shadow-[0_8px_24px_rgba(16,185,129,0.16)] active:translate-y-0 active:scale-[0.98] active:bg-emerald-300/22 focus-visible:border-emerald-300/80 focus-visible:ring-2 focus-visible:ring-emerald-300/30 disabled:cursor-not-allowed disabled:translate-y-0 disabled:scale-100 disabled:opacity-60 disabled:shadow-none"
    const save = useMutation(() => ({
      mutationFn: async () => {
        const file =
          pptTemplate() && isRealPptxTemplate(pptTemplate())
            ? await createOfficeExportFileFromPptxTemplate(input.artifact, pptTemplate(), {
                includeAnimations: office.pptAnimationEnabled(),
                includeNarration: office.pptNarrationEnabled(),
                readAsset: readOfficeAssetForExport,
              })
            : createOfficeExportFile(input.artifact, { pptTemplate: pptTemplate() })
        const result = await globalSDK.client.office.artifact.save({
          directory: sdk.directory,
          kind: kind() === "design" ? "ppt" : kind(),
          filename: file.filename,
          mime: file.mime,
          contentBase64: bytesToBase64(file.bytes),
        })
        return result.data
      },
      onSuccess: (result) => {
        setSavedPath(result?.path ?? "")
        void queryClient.invalidateQueries({ queryKey: ["office-artifacts", sdk.directory] })
        showToast({ title: "办公文件已保存", description: result?.path ?? ".novaway/office" })
      },
      onError: () => showToast({ title: "保存失败", description: "当前办公产物无法写入项目文件夹。" }),
    }))

    const saveWorkflow = useMutation(() => ({
      mutationFn: async () => {
        const scene =
          kind() === "ppt"
            ? "office-ppt"
            : kind() === "data"
              ? "office-data"
              : kind() === "design"
                ? "office-design"
                : kind() === "web"
                  ? "office-web"
                  : "office-document"
        const result = await globalSDK.client.office.platform.workflow.create({
          title: input.artifact.title,
          scene,
          prompt: `继续处理并完善以下办公产物，按需生成最终交付文件：\n\n${input.artifact.body}`,
          connectors: [],
          browser: { enabled: false },
          sourceSessionId: sessionID(),
        })
        return result.data
      },
      onSuccess: (result) => {
        showToast({ title: "已存为工作流", description: result?.title ?? "可在办公平台中再次运行" })
      },
      onError: () => showToast({ title: "保存工作流失败", description: "当前会话无法沉淀为工作流。" }),
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
              <div class="text-13-medium text-foreground">模板设计提示词</div>
              <div class="mt-1 text-12-regular leading-relaxed text-foreground-subtle">
                请描述你想要的 PPT 风格、主题、配色、行业气质和页面感觉，例如“科技蓝、赛博霓虹、适合 AI 产品发布”。
              </div>
            </div>
            <textarea
              value={draft()}
              onInput={(event) => setDraft(event.currentTarget.value)}
              class="min-h-[128px] w-full resize-y rounded-[8px] border border-border bg-background p-3 text-13-regular leading-relaxed text-foreground outline-none transition-colors focus:border-emerald-300/70 focus:ring-2 focus:ring-emerald-300/25"
            />
            <div class="grid gap-3 rounded-[8px] border border-border bg-surface/70 p-3">
              <div class="flex items-center justify-between gap-3">
                <div class="min-w-0">
                  <div class="truncate text-13-medium text-foreground">{preview().name}</div>
                  <div class="mt-1 line-clamp-2 text-12-regular text-foreground-subtle">{preview().description}</div>
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
                        class="size-5 rounded-[6px] border border-border"
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

    function openArtifactEditor() {
      const kindValue = kind()
      if (kindValue === "data") {
        dialog.show(
          () => (
            <Dialog title="表格编辑" class="w-full max-w-4xl mx-auto">
              <OfficeDataEditor artifact={input.artifact} onClose={() => dialog.close()} />
            </Dialog>
          ),
          () => dialog.close(),
        )
        return
      }
      if (kindValue === "design") {
        dialog.show(
          () => (
            <Dialog title="视觉设计画布" class="w-full max-w-4xl mx-auto">
              <OfficeDesignEditor artifact={input.artifact} onClose={() => dialog.close()} />
            </Dialog>
          ),
          () => dialog.close(),
        )
        return
      }
      if (kindValue === "web") {
        dialog.show(
          () => (
            <Dialog title="网页看板预览" class="w-full max-w-5xl mx-auto">
              <OfficeWebEditor artifact={input.artifact} onClose={() => dialog.close()} />
            </Dialog>
          ),
          () => dialog.close(),
        )
      }
    }

    function openArtifactHistory() {
      if (!savedPath()) {
        showToast({ title: "暂无可查看版本", description: "请先保存到项目后再查看历史版本。" })
        return
      }
      void globalSDK.client.office.platform.artifact.list().then((result) => {
        const versions = (result.data ?? [])
          .filter((artifact) => artifact.path === savedPath())
          .sort((a, b) => Number(a.version) - Number(b.version))
        dialog.show(
          () => (
            <Dialog title={`产物版本：${input.artifact.title}`} class="w-full max-w-[620px] mx-auto">
              <div class="flex flex-col gap-2 px-6 pb-5">
                <Show
                  when={versions.length > 0}
                  fallback={<div class="text-12-regular text-foreground-subtle">当前文件还没有可恢复的历史版本。</div>}
                >
                  <For each={versions}>
                    {(artifact) => (
                      <div class="flex items-center justify-between gap-3 rounded-[8px] border border-border bg-background p-3">
                        <div class="min-w-0">
                          <div class="text-12-medium text-foreground">v{artifact.version}</div>
                          <div class="mt-0.5 truncate text-11-regular text-foreground-subtle">{artifact.path}</div>
                        </div>
                        <button
                          type="button"
                          class="h-8 shrink-0 rounded-[7px] border border-border px-2.5 text-11-medium text-foreground-subtle hover:text-emerald-200"
                          onClick={() => void restoreArtifactVersion(artifact.id)}
                        >
                          恢复
                        </button>
                      </div>
                    )}
                  </For>
                </Show>
              </div>
            </Dialog>
          ),
          () => dialog.close(),
        )
      })
    }

    async function restoreArtifactVersion(id: string) {
      await globalSDK.client.office.platform.artifact.restore({ id })
      dialog.close()
      showToast({ title: "已恢复版本", description: "历史版本已复制回工作区。" })
    }

    return (
      <div class="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-emerald-300/20 bg-emerald-300/[0.06] px-3 py-2.5">
        <div class="flex min-w-0 items-center gap-2">
          <div class="grid size-7 shrink-0 place-items-center rounded-[8px] border border-emerald-300/25 bg-emerald-300/10 text-emerald-200">
            <Icon name="pencil-line" size="small" />
          </div>
          <div class="min-w-0">
            <div class="truncate text-12-medium text-foreground">{input.artifact.title}</div>
            <div class="text-11-regular text-foreground-subtle">
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
              <span class="truncate text-10-regular text-foreground-subtle" title={quality().summary}>
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
                class="group inline-flex min-w-[164px] items-center justify-between gap-2 rounded-[8px] border border-border bg-background px-2.5 py-1.5 text-12-medium text-foreground outline-none transition-colors hover:border-emerald-300/55 hover:bg-emerald-300/[0.08] focus-visible:border-emerald-300/70 focus-visible:ring-2 focus-visible:ring-emerald-300/25"
                title={officePptTemplateDescription(pptTemplate())}
              >
                <span class="text-11-regular text-foreground-subtle">模板</span>
                <span class="min-w-0 flex-1 truncate text-left">{officePptTemplateName(pptTemplate())}</span>
                <Icon
                  name="chevron-down"
                  size="small"
                  class="shrink-0 text-foreground-subtlest transition-transform group-data-[expanded]:rotate-180"
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
          <Show when={input.artifact.slides.length > 0}>
            <button type="button" class={actionButton} onClick={() => editOfficeSlides(input.artifact)}>
              <Icon name="pencil-line" size="small" class="transition-transform duration-150 group-hover:scale-110" />
              <span>编辑页</span>
            </button>
          </Show>
          <Show when={kind() === "data" || kind() === "design" || kind() === "web"}>
            <button type="button" class={actionButton} onClick={openArtifactEditor}>
              <Icon name="edit" size="small" />
              <span>{kind() === "data" ? "编辑表格" : kind() === "design" ? "编辑设计" : "预览网页"}</span>
            </button>
          </Show>
          <button type="button" class={actionButton} onClick={() => copyOfficeArtifact(input.artifact)}>
            <Icon name="copy" size="small" class="transition-transform duration-150 group-hover:scale-110" />
            <span>复制产物</span>
          </button>
          <button
            type="button"
            class={actionButton}
            disabled={!savedPath()}
            onClick={openArtifactHistory}
            title={savedPath() ? "查看并恢复历史版本" : "请先保存到项目"}
          >
            <Icon name="archive" size="small" />
            <span>历史版本</span>
          </button>
          <button
            type="button"
            class={actionButton}
            classList={{
              "border-emerald-300/55 bg-emerald-300/[0.08] text-emerald-100": office.pptAnimationEnabled(),
            }}
            onClick={() => office.setPptAnimationEnabled(!office.pptAnimationEnabled())}
            title={office.pptAnimationEnabled() ? "当前导出会写入对象级动画" : "当前导出不会写入对象级动画"}
          >
            <Icon name="sliders" size="small" />
            <span>{office.pptAnimationEnabled() ? "动画开" : "动画关"}</span>
          </button>
          <button
            type="button"
            class={actionButton}
            classList={{
              "border-emerald-300/55 bg-emerald-300/[0.08] text-emerald-100": office.pptNarrationEnabled(),
            }}
            onClick={() => office.setPptNarrationEnabled(!office.pptNarrationEnabled())}
            title={office.pptNarrationEnabled() ? "已生成旁白会嵌入导出 PPTX" : "当前导出不嵌入旁白"}
          >
            <Icon name="bubble-5" size="small" />
            <span>{office.pptNarrationEnabled() ? "旁白开" : "旁白关"}</span>
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
          <button
            type="button"
            class={actionButton}
            disabled={saveWorkflow.isPending}
            onClick={() => saveWorkflow.mutate()}
          >
            <Icon name="branch" size="small" />
            <span>{saveWorkflow.isPending ? "保存中" : "存为工作流"}</span>
          </button>
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

  async function downloadOfficeArtifact(artifact: OfficeArtifact, pptTemplate?: OfficePptTemplateChoice) {
    const office = useOfficeAgent()
    if (typeof document === "undefined" || typeof URL === "undefined" || typeof Blob === "undefined") {
      showToast({ title: "导出失败", description: "当前环境无法创建办公文件。" })
      return
    }

    let file
    try {
      file =
        pptTemplate && isRealPptxTemplate(pptTemplate)
          ? await createOfficeExportFileFromPptxTemplate(artifact, pptTemplate, {
              includeAnimations: office.pptAnimationEnabled(),
              includeNarration: office.pptNarrationEnabled(),
              readAsset: readOfficeAssetForExport,
            })
          : createOfficeExportFile(artifact, { pptTemplate })
    } catch (error) {
      showToast({ title: "导出失败", description: error instanceof Error ? error.message : "模板填充失败。" })
      return
    }
    const body = file.bytes.buffer.slice(
      file.bytes.byteOffset,
      file.bytes.byteOffset + file.bytes.byteLength,
    ) as ArrayBuffer
    const url = URL.createObjectURL(new Blob([body], { type: file.mime }))
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = file.filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
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
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
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
                <div class="rounded-[8px] border border-border bg-surface/70 p-4">
                  <div class="flex items-start justify-between gap-3 border-b border-border pb-3">
                    <div class="min-w-0">
                      <div class="text-11-medium text-emerald-200">第 {slide.index} 页</div>
                      <div class="mt-1 truncate text-15-medium text-foreground">{slide.title}</div>
                    </div>
                    <Icon name="layout-bottom" size="small" class="shrink-0 text-foreground-subtlest" />
                  </div>
                  <div class="mt-3 flex flex-col gap-1.5">
                    <For each={slidePreviewLines(slide)}>
                      {(line) => <div class="text-12-regular leading-relaxed text-foreground-subtle">{line}</div>}
                    </For>
                    <Show when={slidePreviewLines(slide).length === 0}>
                      <div class="text-12-regular text-foreground-subtle">
                        暂无页面正文，建议继续让 AI 补充页面文案。
                      </div>
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

  function editOfficeSlides(artifact: OfficeArtifact) {
    const office = useOfficeAgent()
    const template = office.pptTemplate()
    void dialog.show(() => (
      <OfficeSlideEditor
        artifact={artifact}
        template={template}
        assets={office.launchConfig()?.assets ?? []}
        readAsset={readOfficeAssetForExport}
        onCopy={(next) => copyOfficeArtifact(next)}
        onExport={(next) => void downloadOfficeArtifact(next, template)}
        onSave={(next) => void saveEditedOfficeArtifact(next)}
        onRevise={(slide, mode) => requestOfficeSlideRevision(slide, mode)}
      />
    ))
  }

  async function readOfficeAssetForExport(file: string) {
    const isXlsx = /\.xlsx?$/i.test(file)
    const isImage = /\.(png|jpe?g|webp|gif)$/i.test(file)
    const isAudio = /\.(mp3|wav|m4a|aac)$/i.test(file)
    const needsBase64 = isXlsx || isImage || isAudio
    const result = await sdk.client.file.read({
      path: file,
      ...(needsBase64 ? { encoding: "base64" as const } : {}),
    })
    const data = result.data
    if (needsBase64 && data && typeof (data as { content?: unknown }).content === "string") {
      return { content: (data as { content: string }).content, encoding: "base64" as const }
    }
    if (typeof data === "string") return data
    if (data && typeof (data as { content?: unknown }).content === "string")
      return (data as { content: string }).content
    throw new Error(`无法读取素材：${file}`)
  }

  function requestOfficeSlideRevision(slide: OfficeSlide, mode: "polish" | "regenerate") {
    const prompt = createOfficeSlideRevisionPrompt(slide, mode)
    dialog.close()
    navigate(`/${params.dir}/session/${sessionID() ?? ""}?prompt=${encodeURIComponent(prompt)}&submit=1`)
  }

  async function saveEditedOfficeArtifact(artifact: OfficeArtifact) {
    const office = useOfficeAgent()
    const template = office.pptTemplate()
    try {
      const file =
        template && isRealPptxTemplate(template)
          ? await createOfficeExportFileFromPptxTemplate(artifact, template, {
              includeAnimations: office.pptAnimationEnabled(),
              includeNarration: office.pptNarrationEnabled(),
              readAsset: readOfficeAssetForExport,
            })
          : createOfficeExportFile(artifact, { pptTemplate: template })
      const result = await globalSDK.client.office.artifact.save({
        directory: sdk.directory,
        kind: officeArtifactKind(artifact, undefined) === "design" ? "ppt" : officeArtifactKind(artifact, undefined),
        filename: file.filename,
        mime: file.mime,
        contentBase64: bytesToBase64(file.bytes),
      })
      void queryClient.invalidateQueries({ queryKey: ["office-artifacts", sdk.directory] })
      showToast({ title: "修改已保存", description: result.data?.path ?? ".novaway/office" })
    } catch (error) {
      showToast({
        title: "保存修改失败",
        description: error instanceof Error ? error.message : "当前修改无法写入项目文件夹。",
      })
    }
  }

  function slidePreviewLines(slide: OfficeSlide) {
    return slide.content
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 8)
  }

  function TimelineRowFrame(input: { row: Accessor<FramedTimelineRow>; children: JSX.Element }) {
    // 「每个助手块 = 一张贴内容的小卡片」（原型 A1）：正文 / 思考 / 工具 / 变更摘要
    // 各自成块、各自留 8px 行距。这里不再给连续工具调用画整段外框，避免整屏横线。
    const replyBlock = () => {
      const tag = input.row()._tag
      return tag === "AssistantPart" || tag === "Thinking" || tag === "DiffSummary" || tag === "PreviewCard"
    }
    const anchor = () => {
      const row = input.row()
      return row._tag === "CommentStrip" || (row._tag === "UserMessage" && row.anchor)
    }
    const previousUserMessage = () => {
      const row = input.row()
      return (row._tag === "CommentStrip" || row._tag === "UserMessage") && row.previousUserMessage
    }

    // TodoOverview 行按 partID 锚定,没有 userMessageID:取字段前先收窄,不挂 data-message-id。
    const messageID = () => {
      const row = input.row()
      return "userMessageID" in row ? row.userMessageID : undefined
    }

    return (
      <div
        id={anchor() && messageID() ? props.anchor(messageID()!) : undefined}
        data-message-id={messageID()}
        data-timeline-row={input.row()._tag}
        class="group/turn"
        classList={{
          "min-w-0 w-full max-w-full": true,
          "md:max-w-200 2xl:max-w-[1000px]": props.centered,
          "md:mx-auto": props.centered,
          // 卡片块之间靠行的 py-1 留缝：虚拟滚动按行高(offsetHeight)测量，padding 算进高度，
          // margin 会溢出到行框之外不被计入。
          "py-1": replyBlock(),
          "pt-6": previousUserMessage(),
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
                      <div class="shrink-0 max-w-[260px] rounded-[6px] border border-border bg-panel px-2.5 py-2">
                        <div class="flex items-center gap-1.5 min-w-0 text-11-medium text-foreground">
                          <FileIcon node={{ path: comment().path, type: "file" }} class="size-3.5 shrink-0" />
                          <span class="truncate">{getFilename(comment().path)}</span>
                          <Show when={comment().selection}>
                            {(selection) => (
                              <span class="shrink-0 text-foreground-subtle">
                                {selection().startLine === selection().endLine
                                  ? `:${selection().startLine}`
                                  : `:${selection().startLine}-${selection().endLine}`}
                              </span>
                            )}
                          </Show>
                        </div>
                        <div class="pt-1 text-12-regular text-foreground whitespace-pre-wrap break-words">
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
                startedAt={thinkingRow().startedAt}
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
              <TimelineDiffSummaryRow
                diffs={diffSummaryRow().diffs}
                fallback={!!diffSummaryRow().fallback}
                onOpen={openDiffFile}
              />
            </div>
          </TimelineRowFrame>
        )
      }
      case "ToolEvidence": {
        const evidenceRow = row as Accessor<TimelineRowByTag<"ToolEvidence">>
        return (
          <TimelineRowFrame row={evidenceRow}>
            <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
              <TimelineToolEvidenceRow images={evidenceRow().images} />
            </div>
          </TimelineRowFrame>
        )
      }
      case "PreviewCard": {
        const previewRow = row as Accessor<TimelineRowByTag<"PreviewCard">>
        return (
          <TimelineRowFrame row={previewRow}>
            <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
              <TimelinePreviewCardRow targets={previewRow().targets} />
            </div>
          </TimelineRowFrame>
        )
      }
      case "Error": {
        const errorRow = row as Accessor<TimelineRowByTag<"Error">>
        // 意外中断也要把报错原样留在聊天区：输入框上方的琥珀色提示条只说"中断了 + 继续"，
        // 用户还需要看到**到底报了什么错**（可展开原始详情、可复制排查）。
        // 两者职责不同，同时出现是有意的。
        //
        // 清掉是自动的：续跑会新建一条 assistant 消息，而 error 只取**最后一次尝试**，
        // 新消息没有 error，这张卡自然消失；正在续跑时上层也已经不再产出行。
        return (
          <TimelineRowFrame row={errorRow}>
            <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
              <Card variant="error" class="error-card">
                <SessionErrorCard kind={errorRow().kind} detail={errorRow().detail} />
              </Card>
            </div>
          </TimelineRowFrame>
        )
      }
      case "BottomSpacer":
        return <div data-timeline-row="bottom-spacer" aria-hidden="true" class="h-16" />
      case "TodoOverview": {
        const overviewRow = row as Accessor<TimelineRowByTag<"TodoOverview">>
        return (
          <TimelineRowFrame row={overviewRow}>
            <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
              <TimelineTodoOverview row={overviewRow} />
            </div>
          </TimelineRowFrame>
        )
      }
      case "TurnFold": {
        const foldRow = row as Accessor<TimelineRowByTag<"TurnFold">>
        return (
          <TimelineRowFrame row={foldRow}>
            <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
              <TimelineTurnFold row={foldRow} />
            </div>
          </TimelineRowFrame>
        )
      }
      case "TurnActions": {
        const actionsRow = row as Accessor<TimelineRowByTag<"TurnActions">>
        return (
          <TimelineRowFrame row={actionsRow}>
            <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
              <TimelineTurnActions row={actionsRow} />
            </div>
          </TimelineRowFrame>
        )
      }
      // TodoSection 不再作为独立行输出:分组算法把它嵌进 TodoOverview.sections,
      // 清单项原地展开。此分支只为类型闭合,正常不会走到。
      case "TodoSection":
        return null
    }
  }

  function TimelineRowView(props: { rowKey: string }) {
    return <Show when={timelineRowByKey().get(props.rowKey)}>{(item) => renderTimelineRow(item)}</Show>
  }

  // 清单项的展开状态:按 todoID 记录用户的手动选择;未动过的默认折叠
  // (与原型一致 —— 用户只看主干,想看细节再点开)。
  // 轮次结束(idle)时把用户没手动操作过的项收拢成"结果视图";
  // 用户点过(开或关)的项尊重手动选择,不被自动折叠打扰。
  const [todoSectionOpen, setTodoSectionOpen] = createStore<Record<string, boolean>>({})
  const [todoSectionTouched, setTodoSectionTouched] = createStore<Record<string, boolean>>({})
  const [todoAutoCollapsed, setTodoAutoCollapsed] = createStore<Record<string, boolean>>({})

  const formatTodoDuration = (ms: number | undefined) => {
    if (ms === undefined || ms < 0) return undefined
    const seconds = Math.round(ms / 1000)
    if (seconds < 60) return `${seconds}s`
    return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`
  }

  /** 最近的可滚动祖先：聊天区是 ScrollView 的 viewport，别的容器（如折叠卡）不是。 */
  const scrollParentOf = (element: HTMLElement) => {
    let node = element.parentElement
    while (node) {
      const overflow = getComputedStyle(node).overflowY
      if (overflow === "auto" || overflow === "scroll") return node
      node = node.parentElement
    }
    return undefined
  }

  function TimelineTodoOverview(props: { row: Accessor<TimelineRowByTag<"TodoOverview">> }) {
    // 清单是唯一入口:全部待办项铺在卡里,已开始/已完成的项可原地展开看细节。
    // 项与状态优先实时 session_todo;打开 idle 会话时用最新快照兜底。
    const liveTodos = createMemo(() => {
      const id = sessionID()
      if (!id) return []
      return globalSync.data.session_todo[id] ?? []
    })
    const snapshotRows = createMemo(() => {
      let result: { id: string; content: string; status: string }[] | undefined
      for (const message of sessionMessages()) {
        for (const part of getMsgParts(message.id)) {
          if (part.type !== "tool") continue
          if (part.tool !== "todowrite" && part.tool !== "todoedit") continue
          const snapshot = TodoGrouping.snapshotOf(part)
          if (snapshot.length === 0) continue
          result = snapshot
        }
      }
      return result ?? []
    })
    const items = createMemo(() => {
      const live = liveTodos()
      if (live.length > 0) {
        return live.map((todo, index) => ({
          id: String((todo as { id?: string }).id ?? index),
          content: todo.content,
          status: todo.status,
        }))
      }
      return snapshotRows()
    })
    const done = createMemo(
      () => items().filter((item) => item.status === "completed" || item.status === "cancelled").length,
    )
    const total = createMemo(() => items().length)
    // 同一待办的多段区间合并;耗时取并集(最早 start → 最晚 end),产出数取并集。
    // 起止时间同时带出来:进行中的项要用"现在 - 开始"实时跳秒。
    const sectionByTitle = createMemo(() => {
      const map = new Map<
        string,
        {
          rows: TimelineRow.TimelineRow[]
          durationMs?: number
          outputCount: number
          started: boolean
          startedAt?: number
          endedAt?: number
        }
      >()
      const mergeStart = (a: number | undefined, b: number | undefined) =>
        a === undefined ? b : b === undefined ? a : Math.min(a, b)
      const mergeEnd = (a: number | undefined, b: number | undefined) =>
        a === undefined ? b : b === undefined ? a : Math.max(a, b)
      for (const section of props.row().sections) {
        const existing = map.get(section.title)
        if (existing) {
          existing.rows.push(...section.rows)
          if (section.durationMs !== undefined) {
            const base = existing.durationMs ?? 0
            existing.durationMs = base + section.durationMs
          }
          existing.outputCount += section.outputCount
          existing.startedAt = mergeStart(existing.startedAt, section.startedAt)
          existing.endedAt = mergeEnd(existing.endedAt, section.endedAt)
          continue
        }
        map.set(section.title, {
          rows: [...section.rows],
          durationMs: section.durationMs,
          outputCount: section.outputCount,
          started: true,
          startedAt: section.startedAt,
          endedAt: section.endedAt,
        })
      }
      return map
    })
    // 「过程/结果」总开关:轮次结束后清单卡收拢成结果视图,这个开关一键
    // 展开全部过程(所有已开始项);用户单独点某项仍按单项手动状态走。
    const anyDetail = createMemo(() => props.row().sections.some((section) => section.rows.length > 0))
    const allOpen = createMemo(() => {
      const keys = items().map((item) => `${item.status}:${item.id}`)
      return keys.length > 0 && keys.every((key) => (todoSectionTouched[key] ? todoSectionOpen[key] : true))
    })
    const toggleAll = () => {
      const next = !allOpen()
      for (const item of items()) {
        const key = `${item.status}:${item.id}`
        if (!sectionByTitle().get(item.content)) continue
        setTodoSectionTouched(key, true)
        setTodoSectionOpen(key, next)
      }
    }
    // 头部总计时：清单里还有未完成的项且会话在跑时按秒跳动，全部收敛后定格成总用时。
    const unfinished = createMemo(() =>
      items().some((item) => item.status === "in_progress" || item.status === "pending"),
    )
    const live = createMemo(() => working() && unfinished() && props.row().startedAt !== undefined)
    // 会话停下来的时刻(最后一条 assistant 的完成时间)：任务被中断时用它给进行中的项定格，
    // 而不是拿"现在"一直往前算(截图里的 110m08s 就是没停下来)。
    const stoppedAt = createMemo(() => {
      let latest: number | undefined
      for (const message of sessionMessages()) {
        if (message.role !== "assistant") continue
        const at = message.time.completed ?? message.time.created
        if (typeof at === "number" && (latest === undefined || at > latest)) latest = at
      }
      return latest
    })
    const [now, setNow] = createSignal(Date.now())
    createEffect(
      on(live, (running) => {
        if (!running) return
        setNow(Date.now())
        const timer = setInterval(() => setNow(Date.now()), 1000)
        onCleanup(() => clearInterval(timer))
      }),
    )
    /**
     * 展开某一项后把它顶到可视区上部。
     *
     * 清单卡的明细是整段长在点击行下面的：最后一项展开后，明细全部落在视口之外
     * （往往还被输入框挡住），滚动条却还没变长，看起来就像「点了没反应 / 展不开」。
     * 第一项在卡片上部，明细正好落在可见区域，所以只有「最后一条展不开」。
     * 这里等 grid 过渡（300ms）把行高撑开后再校正一次位置：过渡中途 scrollHeight
     * 还是旧值，会把 scrollTop 钳住。
     */
    let revealTimer: number | undefined
    onCleanup(() => window.clearTimeout(revealTimer))
    const revealItem = (element: HTMLElement | undefined) => {
      if (!element) return
      const container = scrollParentOf(element)
      if (!container) return
      const headerOffset = 56 // 顶部 sticky 会话标题，别让明细盖住它
      const target = () =>
        element.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - headerOffset
      const apply = () => {
        if (!element.isConnected) return
        const max = Math.max(0, container.scrollHeight - container.clientHeight)
        container.scrollTop = Math.min(Math.max(0, target()), max)
      }
      apply()
      requestAnimationFrame(apply)
      // 过渡中途 scrollHeight 还是旧值，会把 scrollTop 钳住；等行高撑开后再校正一次。
      window.clearTimeout(revealTimer)
      revealTimer = window.setTimeout(apply, 340)
    }
    const totalDuration = createMemo(() => {
      const start = props.row().startedAt
      if (start === undefined) return undefined
      if (live()) return Math.max(0, now() - start)
      // 已结束：取所有分区里最晚的结束时间；有分区没跑完（被中断）就宁可不出数字，
      // 也不要用"现在"把等待时间算进去。
      const ends = props.row().sections.flatMap((section) => (section.endedAt === undefined ? [] : [section.endedAt]))
      if (ends.length === 0) return undefined
      return Math.max(0, Math.max(...ends) - start)
    })
    const totalLabel = createMemo(() => {
      const ms = totalDuration()
      if (ms === undefined) return undefined
      if (live()) {
        const seconds = Math.floor(ms / 1000)
        if (seconds < 60) return language.t("session.turn.fold.workingSec", { seconds })
        return language.t("session.turn.fold.workingMinSec", {
          minutes: Math.floor(seconds / 60),
          seconds: seconds % 60,
        })
      }
      return language.t("session.turn.fold.summary", { duration: formatTodoDuration(ms) ?? "" })
    })
    return (
      <Show when={total() > 0}>
        <div data-component="todo-grouped-overview" class="w-full rounded-xl border border-border bg-panel px-4 py-3.5">
          <div class="flex items-start gap-2.5">
            <span class="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-[color-mix(in_srgb,var(--icon-blue)_14%,var(--background))] text-[var(--icon-blue)]">
              <Icon name="lu-list-checks" size="normal" />
            </span>
            <div class="min-w-0 flex-1">
              <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span class="min-w-0 truncate text-16-semibold tracking-[-0.01em] text-foreground">
                  {language.t("session.todo.grouped.overview")}
                </span>
                <Show when={totalLabel()}>
                  {(label) => (
                    <span
                      class="flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-12-medium tabular-nums"
                      classList={{
                        "bg-[color-mix(in_srgb,var(--icon-blue)_12%,var(--background))] text-[var(--icon-blue)]":
                          live(),
                        "bg-surface text-foreground-subtle": !live(),
                      }}
                    >
                      <Icon
                        name={live() ? "lu-loader" : "lu-clock"}
                        size="small"
                        class={live() ? "novaway-spinner" : "text-foreground-subtlest"}
                      />
                      <span classList={{ "novaway-breathe": live() }}>{label()}</span>
                    </span>
                  )}
                </Show>
                <Show when={anyDetail()}>
                  <button
                    type="button"
                    class="ml-auto flex shrink-0 items-center gap-1 rounded-full border border-border px-2 py-0.5 text-12-regular text-foreground-subtle transition-colors hover:border-border-hover hover:text-foreground"
                    aria-pressed={allOpen()}
                    onClick={toggleAll}
                  >
                    <Icon name={allOpen() ? "collapse" : "expand"} size="small" />
                    {language.t(allOpen() ? "session.todo.grouped.hideProcess" : "session.todo.grouped.showProcess")}
                  </button>
                </Show>
              </div>
              <div class="mt-1.5 flex items-center gap-2.5">
                <span class="shrink-0 text-12-regular tabular-nums text-foreground-subtle">
                  {language.t("session.todo.grouped.counts", { done: done(), total: total() })}
                </span>
                <div class="h-[5px] min-w-0 flex-1 overflow-hidden rounded-full bg-surface">
                  <div
                    class="h-full rounded-full bg-icon-blue transition-[width] duration-500"
                    style={{ width: `${total() > 0 ? (done() / total()) * 100 : 0}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
          <div class="mt-1.5 flex flex-col">
            <For each={items()}>
              {(item) => (
                <TimelineTodoItem
                  id={item.id}
                  content={item.content}
                  status={item.status}
                  now={now}
                  live={live()}
                  stoppedAt={stoppedAt()}
                  reveal={revealItem}
                  detail={sectionByTitle().get(item.content)}
                />
              )}
            </For>
          </div>
        </div>
      </Show>
    )
  }

  // 轮次过程折叠的展开状态:按 userMessageID 记录手动选择;默认收起(完成态的轮次
  // 折叠成"已完成 · 用时"一行)。运行中的轮次不会出现折叠卡,天然保持展开。
  const [turnFoldOpen, setTurnFoldOpen] = createStore<Record<string, boolean>>({})
  const [turnFoldTouched, setTurnFoldTouched] = createStore<Record<string, boolean>>({})

  const formatTurnDuration = (ms: number | undefined) => {
    if (ms === undefined || ms < 0) return undefined
    const seconds = Math.round(ms / 1000)
    if (seconds < 60) return language.t("session.turn.fold.durationSec", { seconds })
    return language.t("session.turn.fold.durationMinSec", { minutes: Math.floor(seconds / 60), seconds: seconds % 60 })
  }

  /** 轮次过程折叠卡:运行中显示"工作中 · X",完成后折叠成"已工作 X"(对齐 ZCode)。
   * 点击展开/收起全部过程行。 */
  function TimelineTurnFold(props: { row: Accessor<TimelineRowByTag<"TurnFold">> }) {
    const foldKey = createMemo(() => props.row().userMessageID)
    const open = createMemo(() => (turnFoldTouched[foldKey()] ? (turnFoldOpen[foldKey()] ?? false) : false))
    const toggle = () => {
      setTurnFoldTouched(foldKey(), true)
      setTurnFoldOpen(foldKey(), !open())
    }
    // 这轮还在跑(结果文本正在流式输出)时显示实时"工作中 · X";跑完后是"已工作 X"。
    const stillWorking = createMemo(() => working() && activeMessageID() === foldKey())
    const [now, setNow] = createSignal(Date.now())
    createEffect(
      on(stillWorking, (running) => {
        if (!running) return
        setNow(Date.now())
        const timer = setInterval(() => setNow(Date.now()), 1000)
        onCleanup(() => clearInterval(timer))
      }),
    )
    const liveDuration = createMemo(() => {
      const start = props.row().startedAt
      if (typeof start !== "number") return undefined
      return Math.max(0, now() - start)
    })
    const duration = createMemo(() =>
      stillWorking() ? formatTurnDuration(liveDuration()) : formatTurnDuration(props.row().durationMs),
    )
    const label = createMemo(() => {
      if (stillWorking()) {
        const ms = liveDuration()
        if (ms === undefined) return language.t("session.turn.fold.working")
        const seconds = Math.floor(ms / 1000)
        if (seconds < 60) return language.t("session.turn.fold.workingSec", { seconds })
        return language.t("session.turn.fold.workingMinSec", {
          minutes: Math.floor(seconds / 60),
          seconds: seconds % 60,
        })
      }
      const completed = duration()
      return completed
        ? language.t("session.turn.fold.summary", { duration: completed })
        : language.t("session.turn.fold.done")
    })
    return (
      <div data-component="turn-fold" data-open={open()} class="w-full">
        <button
          type="button"
          data-component="turn-fold-trigger"
          class="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-hover"
          aria-expanded={open()}
          data-working={stillWorking() ? "true" : undefined}
          onClick={toggle}
        >
          <Show when={stillWorking()}>
            <span class="grid size-4 shrink-0 place-items-center text-foreground-subtle">
              <Icon name="lu-loader" size="small" class="animate-spin" />
            </span>
          </Show>
          <span class="min-w-0 truncate text-13-regular text-foreground-subtle">{label()}</span>
          <span
            class="grid size-4 shrink-0 place-items-center text-foreground-subtlest transition-transform duration-200"
            classList={{ "rotate-180": open() }}
          >
            <Icon name="lu-chevron-down" size="small" />
          </span>
        </button>
        <div
          data-component="turn-fold-detail"
          class="grid transition-[grid-template-rows] duration-300 ease-out"
          style={{ "grid-template-rows": open() ? "1fr" : "0fr" }}
          aria-hidden={!open()}
        >
          <div class="overflow-hidden">
            <div class="mb-1.5 flex flex-col gap-1 rounded-lg border border-border bg-background px-3 py-3">
              <Index each={props.row().rows}>
                {(row) => <div class="min-w-0 w-full">{renderTimelineRow(row)}</div>}
              </Index>
            </div>
          </div>
        </div>
      </div>
    )
  }

  /** 轮尾操作行:复制整轮正文 / 赞 / 踩 / 分叉 / 消息创建时间。
   * 整轮 hover 或焦点停留时淡入(对齐 ZCode 的 assistant 行操作区)。
   * 赞踩是纯本地反馈,组件重挂/刷新即清空,不落库、不进 prompt。 */
  function TimelineTurnActions(props: { row: Accessor<TimelineRowByTag<"TurnActions">> }) {
    const userMessageID = createMemo(() => props.row().userMessageID)
    const copyText = createMemo(() => props.row().copyText)
    const [copied, setCopied] = createSignal(false)
    const [feedback, setFeedback] = createSignal<"like" | "dislike" | undefined>(undefined)
    let copyTimer: number | undefined
    onCleanup(() => window.clearTimeout(copyTimer))

    const timeLabel = createMemo(() =>
      formatMessageTimeLabel(props.row().createdAt, language.intl(), language.t("session.turn.actions.yesterday")),
    )

    const handleCopy = () => {
      const text = copyText()
      if (!text || !navigator.clipboard) return
      void navigator.clipboard.writeText(text).then(() => {
        setCopied(true)
        window.clearTimeout(copyTimer)
        copyTimer = window.setTimeout(() => setCopied(false), 1200)
      })
    }

    const toggleFeedback = (next: "like" | "dislike") => {
      setFeedback(feedback() === next ? undefined : next)
    }

    const handleFork = () => {
      void import("@/components/dialog-fork").then((x) => dialog.show(() => <x.DialogFork />))
    }

    const copyLabel = () => language.t(copied() ? "session.turn.actions.copied" : "session.turn.actions.copy")
    const likeLabel = () =>
      language.t(feedback() === "like" ? "session.turn.actions.liked" : "session.turn.actions.like")
    const dislikeLabel = () =>
      language.t(feedback() === "dislike" ? "session.turn.actions.disliked" : "session.turn.actions.dislike")

    return (
      <div
        data-component="turn-actions"
        data-turn-actions={userMessageID()}
        class="flex items-center gap-2 py-0.5 pl-1 opacity-0 transition-opacity duration-150 group-hover/turn:opacity-100 focus-within:opacity-100"
      >
        <Tooltip value={copyLabel()} placement="top" gutter={4}>
          <IconButton
            icon={copied() ? "check" : "copy"}
            size="large"
            iconSize="normal"
            variant="ghost"
            onMouseDown={(event) => event.preventDefault()}
            onClick={handleCopy}
            aria-label={copyLabel()}
            data-copied={copied() ? "true" : undefined}
          />
        </Tooltip>
        <Tooltip value={likeLabel()} placement="top" gutter={4}>
          <IconButton
            icon="lu-thumbs-up"
            size="large"
            iconSize="normal"
            variant="ghost"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => toggleFeedback("like")}
            aria-label={likeLabel()}
            aria-pressed={feedback() === "like"}
          />
        </Tooltip>
        <Tooltip value={dislikeLabel()} placement="top" gutter={4}>
          <IconButton
            icon="lu-thumbs-down"
            size="large"
            iconSize="normal"
            variant="ghost"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => toggleFeedback("dislike")}
            aria-label={dislikeLabel()}
            aria-pressed={feedback() === "dislike"}
          />
        </Tooltip>
        <Tooltip value={language.t("session.turn.actions.fork")} placement="top" gutter={4}>
          <IconButton
            icon="branch"
            size="large"
            iconSize="normal"
            variant="ghost"
            onMouseDown={(event) => event.preventDefault()}
            onClick={handleFork}
            aria-label={language.t("session.turn.actions.fork")}
          />
        </Tooltip>
        <Show when={timeLabel()}>
          <span class="select-none pl-1 text-12-regular tabular-nums text-foreground-subtlest">{timeLabel()}</span>
        </Show>
      </div>
    )
  }

  /** 单个清单项:状态图标 + 标题 + 耗时/产出 + 展开箭头;有执行内容的项可原地展开细节。
   * 展开优先级:用户手动选择 > 自动规则(进行中展开,轮次结束收拢成结果视图)。
   * 自动规则由 effect 统一写 store,memo 只读。
   */
  function TimelineTodoItem(props: {
    id: string
    content: string
    status: string
    /** 清单头部的秒表时钟；进行中的项据此实时跳秒。 */
    now?: Accessor<number>
    /** 清单整体是否仍在执行：false 时计时定格，不回落到"现在"。 */
    live?: boolean
    /** 会话停下来的时刻(最后一条 assistant 完成时间)；中断时用来定格进行中的项。 */
    stoppedAt?: number
    /** 展开后把这一项滚进可视区；最后一项的明细整段长在视口之外，不滚就等于没展开。 */
    reveal?: (element: HTMLElement | undefined) => void
    detail?: {
      rows: TimelineRow.TimelineRow[]
      durationMs?: number
      outputCount: number
      started: boolean
      startedAt?: number
      endedAt?: number
    }
  }) {
    const started = createMemo(() => !!props.detail && props.detail.rows.length > 0)
    let root: HTMLDivElement | undefined
    const openKey = createMemo(() => `${props.status}:${props.id}`)
    const open = createMemo(() => {
      if (todoSectionTouched[openKey()]) return todoSectionOpen[openKey()] ?? false
      // 「进行中保持展开」只在会话真的在跑时生效;打开历史会话(idle)时
      // 即使快照状态是 in_progress 也收拢成结果视图。
      if (props.status === "in_progress" && working()) return true
      if (started()) return false
      return todoSectionOpen[openKey()] ?? false
    })
    // 进行中的项按"现在 - 开始"实时跳秒；其余项用区间耗时定格。
    // 关键：只有整张清单还在跑(live())时才走实时时钟 —— 任务被中断/报错之后
    // 会话已经停止，再用"现在"去减开始时间，计时会永远往前走（截图里的 110m08s 就是这么来的）。
    // 停止后定格到"会话停下来的那一刻"，没有这个时间(打开历史会话)才回落到区间耗时。
    const duration = createMemo(() => {
      const detail = props.detail
      if (!detail) return undefined
      if (props.status === "in_progress" && detail.startedAt !== undefined) {
        if (props.live) return formatTodoDuration(Math.max(0, (props.now?.() ?? Date.now()) - detail.startedAt))
        const stopped = props.stoppedAt ?? detail.endedAt
        if (stopped !== undefined) return formatTodoDuration(Math.max(0, stopped - detail.startedAt))
      }
      const span =
        detail.durationMs ??
        (detail.startedAt !== undefined && detail.endedAt !== undefined
          ? Math.max(0, detail.endedAt - detail.startedAt)
          : undefined)
      return formatTodoDuration(span)
    })
    const statusIcon = createMemo(() => {
      if (props.status === "completed") return "lu-check" as const
      if (props.status === "in_progress") return "lu-loader" as const
      return "lu-circle" as const
    })
    const body = (
      <>
        <span
          class="grid size-4 shrink-0 place-items-center"
          classList={{
            "text-[var(--diff-added)]": props.status === "completed",
            // 只有真的在跑才转圈；中断后保持静态，避免"看起来还在执行"。
            "text-icon-blue": props.status === "in_progress",
            "novaway-spinner": props.status === "in_progress" && !!props.live,
            "text-border-hover": props.status === "pending" || props.status === "cancelled",
          }}
        >
          <Icon name={statusIcon()} size="small" />
        </span>
        <span
          class="min-w-0 flex-1 truncate text-13-regular"
          classList={{
            "text-foreground-subtle line-through decoration-foreground-subtlest":
              props.status === "completed" || props.status === "cancelled",
            "text-foreground font-medium": props.status === "in_progress",
            "novaway-breathe": props.status === "in_progress" && !!props.live,
            "text-foreground": props.status === "pending",
          }}
        >
          {props.content}
        </span>
        <Show when={duration()}>
          {(value) => (
            <span class="flex shrink-0 items-center gap-1 text-12-regular tabular-nums text-foreground-subtle">
              <Icon name="lu-clock" size="small" class="text-foreground-subtlest" />
              {value()}
            </span>
          )}
        </Show>
        <Show when={(props.detail?.outputCount ?? 0) > 0}>
          <span class="flex shrink-0 items-center gap-1 text-12-regular tabular-nums text-foreground-subtle">
            <Icon name="lu-file-output" size="small" class="text-foreground-subtlest" />
            {language.t("session.todo.grouped.outputs", { count: props.detail!.outputCount })}
          </span>
        </Show>
        <Show when={started()}>
          <span
            class="grid size-4 shrink-0 place-items-center text-foreground-subtlest transition-transform duration-200"
            classList={{ "rotate-180": open() }}
          >
            <Icon name="lu-chevron-down" size="small" />
          </span>
        </Show>
      </>
    )
    return (
      <div ref={(el) => (root = el)} data-component="todo-grouped-item" data-status={props.status} class="min-w-0">
        <Show
          when={started()}
          fallback={<div class="flex w-full min-w-0 items-center gap-2.5 rounded-lg px-1.5 py-1.5">{body}</div>}
        >
          <button
            type="button"
            class="flex w-full min-w-0 items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-hover"
            aria-expanded={open()}
            onClick={() => {
              // 手动点击优先生效(此后不被自动规则覆盖)。
              const next = !open()
              setTodoSectionTouched(openKey(), true)
              setTodoSectionOpen(openKey(), next)
              if (next) props.reveal?.(root)
            }}
          >
            {body}
          </button>
        </Show>
        <Show when={started()}>
          <div
            data-component="todo-grouped-detail"
            class="grid transition-[grid-template-rows] duration-300 ease-out"
            style={{ "grid-template-rows": open() ? "1fr" : "0fr" }}
            aria-hidden={!open()}
          >
            <div class="overflow-hidden">
              <div class="mb-1.5 ml-6 flex flex-col gap-1 rounded-lg border border-border bg-background px-3 py-3">
                <Index each={props.detail!.rows}>
                  {(row) => <div class="min-w-0 w-full">{renderTimelineRow(row)}</div>}
                </Index>
              </div>
            </div>
          </div>
        </Show>
      </div>
    )
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
            class="flex items-center justify-center w-8 h-6 rounded-[6px] border border-border bg-[color-mix(in_srgb,var(--popover)_80%,transparent)] backdrop-blur-[0.75px] transition-colors group-hover:border-[var(--border)] group-hover:[--icon-base:var(--foreground)]"
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
              "sticky top-0 z-30 bg-[linear-gradient(to_bottom,var(--panel)_48px,transparent)]": true,
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
                      class="min-w-0 max-w-[40%] truncate text-14-medium text-foreground-subtle transition-colors hover:text-foreground"
                      onClick={navigateParent}
                    >
                      {parentTitle()}
                    </button>
                    <span
                      data-slot="session-title-separator"
                      class="px-2 text-14-medium text-foreground-subtle"
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
                          <div class="absolute inset-0 rounded-full border-[1.5px] border-icon-blue animate-[ping_1.5s_cubic-bezier(0,0,0.2,1)_infinite] opacity-75" />
                          <div class="size-1.5 rounded-full bg-icon-blue" />
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
                          class="text-14-medium text-foreground truncate grow-1 min-w-0"
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
                        class="text-14-medium text-foreground grow-1 min-w-0 rounded-[6px] pl-1 -ml-1"
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
                {(id) => (
                  <div class="shrink-0 flex items-center gap-3">
                    <button
                      type="button"
                      class="hidden h-8 items-center gap-1.5 rounded-[7px] border border-border bg-background px-2.5 text-11-medium text-foreground-subtle outline-none transition-colors hover:border-emerald-300/50 hover:text-emerald-100 md:inline-flex"
                      title="把当前对话需求保存为可复用工作流"
                      disabled={saveConversationWorkflow.isPending || !latestUserPrompt()}
                      onClick={() => saveConversationWorkflow.mutate()}
                    >
                      <Icon name="branch" size="small" />
                      <span>{saveConversationWorkflow.isPending ? "保存中" : "存为工作流"}</span>
                    </button>
                  </div>
                )}
              </Show>
            </div>
          </div>
        </Show>
        <Show
          when={!virtualFallback()}
          fallback={
            <div class="flex flex-col">
              <For each={timelineRowKeys()}>{(key) => <TimelineRowView rowKey={key} />}</For>
            </div>
          }
        >
          <Show when={scrollRoot() ? virtualGeneration() + 1 : undefined} keyed>
            {(_generation) => {
              const root = () => scrollRoot()!
              return (
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
                    // 首次挂载时容器可能还在隐藏的过渡层里，virtua 收不到尺寸回调。
                    // 这里在几帧之后补一次强制测量，否则会出现「有数据但空白」。
                    setTimeout(nudgeViewport, 0)
                    setTimeout(nudgeViewport, 250)
                  }}
                >
                  {(key) => <TimelineRowView rowKey={key} />}
                </Virtualizer>
              )
            }}
          </Show>
        </Show>
      </ScrollView>
      {/* 选中聊天内容后的浮动动作菜单（对齐 ZCode 的 SelectionActionMenu）：
          「添加到当前任务」接着主线问；「在辅助对话中提问」开一条不打断主线的小会话。 */}
      <SelectionActionMenu
        container={scrollRoot}
        onAskSideChat={(text) =>
          void sideChat.open({ quote: { text, label: language.t("session.selection.quoteLabel") } })
        }
      />
    </div>
  )
}
