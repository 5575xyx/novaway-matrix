import { classifyError, type ErrorKind } from "./session-error"
import { workingActivity, type WorkingActivity } from "./working-status"
import { parseCommentNote, readCommentMetadata, type PromptComment } from "@/utils/comment-note"
import { AssistantMessage, Part, SessionStatus, SnapshotFileDiff, UserMessage } from "@novaway/sdk/v2"
import { groupParts, PartGroup, renderable } from "@novaway/ui/message-part"
import { Data, Equal } from "effect"
import { uniqueSummaryDiffs } from "./message-timeline.summary-diffs"
import { projectCitationText } from "./preview-card-extract"
import type { EvidenceImage } from "./message-timeline.evidence"

export type { EvidenceImage } from "./message-timeline.evidence"

export type SummaryDiff = SnapshotFileDiff & { file: string }

export interface PreviewTarget {
  /**
   * 打开方式:server/html → 浏览器标签的内置预览(iframe);
   * file(office/pdf/图片) → 文件标签(FileTabContent 走 Office 预览)。
   */
  kind: "server" | "html" | "file"
  /** 预览地址:server 为 http(s) URL;html/file 为 file:// URL */
  url: string
  /** 本地文件绝对路径(kind 为 html/file 时存在) */
  path?: string
  /** 主标题:文件名或 host:port */
  title: string
  /** 副标题:相对路径或完整 URL */
  subtitle: string
}

export type TimelineRowMap = {
  CommentStrip: {
    userMessageID: string
    previousUserMessage: boolean
  }
  UserMessage: {
    userMessageID: string
    anchor: boolean
    previousUserMessage: boolean
  }
  TurnDivider: {
    userMessageID: string
    label: "compaction" | "interrupted"
  }
  AssistantPart: {
    userMessageID: string
    group: PartGroup
    previousAssistantPart: boolean
    lastAssistantPart: boolean
  }
  Thinking: { userMessageID: string; reasoningHeading?: string }
  Retry: { userMessageID: string }
  DiffSummary: { userMessageID: string; diffs: SummaryDiff[] }
  /**
   * 轮尾操作行(复制/赞/踩/分叉/时间):一轮末尾只挂一条。
   * copyText 是本轮全部 assistant 正文合并后的文本;createdAt 为 assistant 消息创建时间。
   */
  TurnActions: { userMessageID: string; copyText: string; createdAt?: number }
  /**
   * 回答回执后的预览入口卡:这轮起了本地服务(bash 输出里的 localhost 地址)
   * 或写了 HTML 原型时,回复末尾给一张可点的小卡,点开在右侧面板预览。
   */
  PreviewCard: { userMessageID: string; targets: PreviewTarget[] }
  /** 工具产出的图片证据(浏览器截图):贴在轮尾,当作"验证结果"给用户看。 */
  ToolEvidence: { userMessageID: string; images: EvidenceImage[] }
  /**
   * 会话错误。
   *
   * - `kind`：归类后的种类，由文案层翻成人话（"模型服务暂时不可用"…）。
   * - `detail`：原始报错文本，折叠展示。上游返回的经常是一整段 JSON，
   *   直接铺在聊天区既是噪音又看不懂。
   */
  Error: { userMessageID: string; kind: ErrorKind; detail: string; resumable?: boolean }
  BottomSpacer: {}
  /**
   * 待办清单总览卡:清单本体(进度 + 全部待办项,已开始的项可原地展开细节)。
   * sections 是各待办的执行区间(分组算法产出),渲染时按标题匹配到清单项;
   * 不再单独渲染分区卡 —— 清单就是唯一入口,避免标题重复显示。
   */
  TodoOverview: {
    anchorPartID: string
    done: number
    total: number
    sections: import("./message-timeline.data").TimelineRow.TodoSection[]
  }
  /**
   * 单个待办的执行区间(rows 是该区间内的原有时间线行)。
   * 只作为 TodoOverview.sections 的数据载体嵌入,不再作为独立行渲染。
   */
  TodoSection: {
    todoID: string
    segment: number
    title: string
    status: string
    rows: import("./message-timeline.data").TimelineRow.TimelineRow[]
    durationMs?: number
    outputCount: number
  }
}

export namespace TimelineRow {
  export class CommentStrip extends Data.TaggedClass("CommentStrip")<{
    userMessageID: string
    previousUserMessage: boolean
  }> {}
  export class UserMessage extends Data.TaggedClass("UserMessage")<{
    userMessageID: string
    anchor: boolean
    previousUserMessage: boolean
  }> {}
  export class TurnDivider extends Data.TaggedClass("TurnDivider")<{
    userMessageID: string
    label: "compaction" | "interrupted"
  }> {}
  export class AssistantPart extends Data.TaggedClass("AssistantPart")<{
    userMessageID: string
    group: PartGroup
    previousAssistantPart: boolean
    lastAssistantPart: boolean
  }> {}
  export class Thinking extends Data.TaggedClass("Thinking")<{
    userMessageID: string
    reasoningHeading?: string
    /** 本轮开始时间(用户消息/首条助手消息),用于"正在执行中 · X"的实时计时。 */
    startedAt?: number
    /** 本轮此刻正在做的事(翻阅代码中 / 深入思考中…),由 workingActivity 从 parts 推导。 */
    activity?: WorkingActivity
  }> {}
  export class DiffSummary extends Data.TaggedClass("DiffSummary")<{
    userMessageID: string
    diffs: SummaryDiff[]
    /** 会话级兜底卡(挂在最底下、显示会话累计变更);轮次自己的 diff 卡为 false。 */
    fallback?: boolean
  }> {}
  export class PreviewCard extends Data.TaggedClass("PreviewCard")<{
    userMessageID: string
    targets: PreviewTarget[]
  }> {}
  /**
   * 验证结果卡:工具(目前是浏览器截图)产出的图片证据,固定在轮尾。
   * 过程行会被折进 TurnFold,截图若只挂在工具行上,用户就永远看不到验证结果 ——
   * 所以单独成行,留在折叠之外。
   */
  export class ToolEvidence extends Data.TaggedClass("ToolEvidence")<{
    userMessageID: string
    images: EvidenceImage[]
  }> {}
  export class Error extends Data.TaggedClass("Error")<{
    userMessageID: string
    kind: ErrorKind
    detail: string
    /**
     * 这一轮是「最后一轮」且因意外中断停在半路：渲染成橙色的「继续任务」面板。
     * 历史轮次的报错只作为普通错误卡保留（没有继续入口），已经续跑完成的轮次也不再出现。
     */
    resumable?: boolean
  }> {}
  export class Retry extends Data.TaggedClass("Retry")<{
    userMessageID: string
  }> {}
  export class BottomSpacer extends Data.TaggedClass("BottomSpacer")<{}> {}
  export class TodoOverview extends Data.TaggedClass("TodoOverview")<{
    anchorPartID: string
    done: number
    total: number
    sections: TodoSection[]
    /** 清单首次开始执行的时间(最早一条工具调用);头部总计时从它起算。 */
    startedAt?: number
    /** 执行中的实时状态(执行命令中/深入思考中…),运行中显示在卡头部。 */
    activity?: WorkingActivity
  }> {}
  export class TodoSection extends Data.TaggedClass("TodoSection")<{
    todoID: string
    segment: number
    title: string
    status: string
    rows: TimelineRow.TimelineRow[]
    durationMs?: number
    outputCount: number
    /** 本分区的工具起止时间:进行中的项用它算实时耗时。 */
    startedAt?: number
    endedAt?: number
  }> {}
  /** 按轮折叠的过程卡:折进去的过程行 + 该轮总耗时。 */
  export class TurnFold extends Data.TaggedClass("TurnFold")<{
    userMessageID: string
    rows: TimelineRow.TimelineRow[]
    durationMs?: number
    /**
     * 本段第一个过程行的稳定 key。一轮会被旁白切成多段,只用 userMessageID 会让段与段撞 key
     * (行表按 key 建 Map,撞了就直接丢行),所以锚在段首。
     */
    anchorKey?: string
    /** 本轮开始时间;运行中的折叠卡用它继续走"正在执行中 · X"的计时。 */
    startedAt?: number
    /** 该段仍在运行:容器默认展开、头部实时计时,模型开始讲正文后自动收成"已执行 X"。 */
    active?: boolean
    /** 运行中折叠卡底部那行思考摘要(原本挂在 Thinking 行上的标题)。 */
    reasoningHeading?: string
    /** 运行中折叠卡头部的实时状态(原本挂在 Thinking 行上的 activity)。 */
    activity?: WorkingActivity
    /**
     * 只有一行的收尾段:不给折叠头,直接把这一行显示在引导线上。
     * 一行也要点开才能看,太累。
     */
    bare?: boolean
    /**
     * 大容器头部那句"执行 N 步"的 N。容器里再按旁白切段后,`rows.length` 数的是子项
     * (段 + 正文),不再等于步数,所以步数单独带过来。
     */
    stepCount?: number
  }> {}
  /** 轮尾操作行。 */
  export class TurnActions extends Data.TaggedClass("TurnActions")<{
    userMessageID: string
    copyText: string
    createdAt?: number
  }> {}

  export type TimelineRow =
    | CommentStrip
    | UserMessage
    | TurnDivider
    | AssistantPart
    | Thinking
    | DiffSummary
    | PreviewCard
    | ToolEvidence
    | Error
    | Retry
    | BottomSpacer
    | TodoOverview
    | TodoSection
    | TurnFold
    | TurnActions

  export const key = (row: TimelineRow) => {
    switch (row._tag) {
      case "CommentStrip":
        return `comment-strip:${row.userMessageID}`
      case "UserMessage":
        return `user-message:${row.userMessageID}`
      case "TurnDivider":
        return `turn-divider:${row.userMessageID}:${row.label}`
      case "AssistantPart":
        return `assistant-part:${row.userMessageID}:${row.group.key}`
      case "Thinking":
        return `thinking:${row.userMessageID}`
      case "DiffSummary":
        return `diff-summary:${row.userMessageID}`
      case "PreviewCard":
        return `preview-card:${row.userMessageID}`
      case "ToolEvidence":
        return `tool-evidence:${row.userMessageID}`
      case "Error":
        return `error:${row.userMessageID}`
      case "Retry":
        return `retry:${row.userMessageID}`
      case "BottomSpacer":
        return "bottom-spacer"
      case "TodoOverview":
        return `todo-overview:${row.anchorPartID}`
      case "TodoSection":
        return `todo-section:${row.todoID}:${row.segment}`
      case "TurnFold":
        return `turn-fold:${row.userMessageID}:${row.anchorKey ?? "turn"}`
      case "TurnActions":
        return `turn-actions:${row.userMessageID}`
    }
  }

  export function equals(a: TimelineRow, b: TimelineRow) {
    return Equal.equals(a, b)
  }
}

export namespace Timeline {
  export function constructMessageRows(
    userMessage: UserMessage,
    getMessageParts: (messageID: string) => Part[],
    assistantMessages: AssistantMessage[],
    index: number,
    showReasoning: boolean,
    status: SessionStatus["type"],
    isActive: boolean,
    /** 是否是会话里的最后一轮：只有最后一轮的中断才提供「继续」。 */
    isLastTurn = false,
  ) {
    const rows: TimelineRow.TimelineRow[] = []

    const previousUserMessage = index > 0
    const userParts = getMessageParts(userMessage.id)
    const comments = userParts.flatMap((p) => MessageComment.fromPart(p) ?? [])
    const visibleUserContent = userParts.some((part) => {
      if (part.type === "text") return !part.synthetic && !part.ignored && part.text.trim().length > 0
      return part.type === "file" || part.type === "agent"
    })
    const compaction = userParts.some((p) => p.type === "compaction")
    const interruptedMessageIndex = assistantMessages.findIndex((m) => m.error?.name === "MessageAbortedError")
    const interrupted = interruptedMessageIndex !== -1
    // 只看**最后一次尝试**的报错：续跑之后前面的失败尝试属于过程，不该再挂一张错误卡
    // （否则续跑成功了却一直显示"出了点问题"，折叠也永远触发不了）。
    const latestAssistant = assistantMessages[assistantMessages.length - 1]
    const error =
      latestAssistant?.error && latestAssistant.error.name !== "MessageAbortedError" ? latestAssistant.error : undefined

    const assistantPartRefs = assistantMessages.flatMap((message, messageIndex) =>
      getMessageParts(message.id)
        .filter((part) => renderable(part, showReasoning))
        .map((part) => ({ messageID: message.id, messageIndex, part })),
    )
    const assistantItems =
      interrupted && !compaction
        ? [
            ...groupParts(assistantPartRefs.filter((ref) => ref.messageIndex <= interruptedMessageIndex)).map(
              (group) => ({
                type: "part" as const,
                group,
              }),
            ),
            { type: "interrupted" as const },
            ...groupParts(assistantPartRefs.filter((ref) => ref.messageIndex > interruptedMessageIndex)).map(
              (group) => ({
                type: "part" as const,
                group,
              }),
            ),
          ]
        : groupParts(assistantPartRefs).map((group) => ({ type: "part" as const, group }))
    const assistantGroupCount = assistantItems.filter((item) => item.type === "part").length

    if (comments.length > 0)
      rows.push(
        new TimelineRow.CommentStrip({
          userMessageID: userMessage.id,
          previousUserMessage,
        }),
      )

    if (visibleUserContent || comments.length > 0 || compaction) {
      rows.push(
        new TimelineRow.UserMessage({
          userMessageID: userMessage.id,
          anchor: comments.length === 0,
          previousUserMessage: comments.length === 0 && previousUserMessage,
        }),
      )
    }

    if (compaction) {
      rows.push(
        new TimelineRow.TurnDivider({
          userMessageID: userMessage.id,
          label: "compaction",
        }),
      )
    }

    // 运行中的轮次始终在顶部挂一条工作指示:还没有过程行可折时,由它单独显示进度
    // ("正在执行中 · X 秒");一旦有工具行折进容器,这一行的标题和起始时间会被提升到
    // 容器里(TurnFold.active),进度改由容器头部计时,避免同一屏出现两个计时。
    if (isActive && status === "busy" && !error) {
      const turnParts = assistantMessages.flatMap((message) => getMessageParts(message.id))
      const heading = turnParts
        .map((part) => (part.type === "reasoning" && part.text ? reasoningHeading(part.text) : undefined))
        .find((value): value is string => !!value)
      const startedAt = [userMessage.time?.created, ...assistantMessages.map((message) => message.time?.created)]
        .filter((value): value is number => typeof value === "number")
        .reduce<number | undefined>((min, value) => (min === undefined ? value : Math.min(min, value)), undefined)

      rows.push(
        new TimelineRow.Thinking({
          userMessageID: userMessage.id,
          reasoningHeading: heading,
          startedAt,
          activity: workingActivity({ status: undefined, parts: turnParts }),
        }),
      )
    }

    let assistantGroupIndex = 0
    assistantItems.forEach((item) => {
      if (item.type === "interrupted") {
        rows.push(
          new TimelineRow.TurnDivider({
            userMessageID: userMessage.id,
            label: "interrupted",
          }),
        )
        return
      }

      rows.push(
        new TimelineRow.AssistantPart({
          userMessageID: userMessage.id,
          group: item.group,
          previousAssistantPart: assistantGroupIndex > 0,
          lastAssistantPart: assistantGroupIndex === assistantGroupCount - 1,
        }),
      )
      assistantGroupIndex += 1
    })

    if (isActive && status === "retry") rows.push(new TimelineRow.Retry({ userMessageID: userMessage.id }))

    const diffs = uniqueSummaryDiffs(userMessage.summary?.diffs)
    if (diffs.length > 0 && (status === "idle" || !isActive)) {
      rows.push(
        new TimelineRow.DiffSummary({
          userMessageID: userMessage.id,
          diffs,
        }),
      )
    }

    // 正在续跑（本轮 active 且仍在运行）时不显示上一轮的报错：界面上应当看到"任务正在进行",
    // 而不是一张和当前状态矛盾的错误卡。
    if (error && !(isActive && status !== "idle")) {
      const data = error.data?.message
      const raw = typeof data === "string" ? data : data === undefined || data === null ? "" : String(data)
      rows.push(
        new TimelineRow.Error({
          userMessageID: userMessage.id,
          kind: classifyError(raw, error.name),
          detail: raw,
          resumable: isLastTurn && status === "idle",
        }),
      )
    }

    // 轮尾操作行:本轮已有完成的 assistant 正文、没有出错/中断且已经收尾才挂上。
    const hasAssistantText = assistantMessages.some((message) =>
      getMessageParts(message.id).some(
        (part) => part.type === "text" && !part.synthetic && part.text.trim().length > 0,
      ),
    )
    if (hasAssistantText && !interrupted && !error && (status === "idle" || !isActive)) {
      const copyText = assistantMessages
        .flatMap((message) => getMessageParts(message.id))
        .filter((part) => part.type === "text" && !part.synthetic && !(part as { ignored?: boolean }).ignored)
        .map((part) => projectCitationText((part as { text: string }).text.trim(), { streaming: false }))
        .map((text) => text.trim())
        .filter(Boolean)
        .join("\n\n")
      const createdAt = assistantMessages
        .flatMap((message) => [message.time?.created] as const)
        .find((value): value is number => typeof value === "number" && value > 0)
      if (copyText) rows.push(new TimelineRow.TurnActions({ userMessageID: userMessage.id, copyText, createdAt }))
    }

    return rows
  }

  function reasoningHeading(text: string) {
    const markdown = text.replace(/\r\n?/g, "\n")
    const html = markdown.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i)
    if (html?.[1]) {
      const value = cleanHeading(html[1].replace(/<[^>]+>/g, " "))
      if (value) return value
    }

    const atx = markdown.match(/^\s{0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+[ \t]*)?$/m)
    if (atx?.[1]) {
      const value = cleanHeading(atx[1])
      if (value) return value
    }

    const setext = markdown.match(/^([^\n]+)\n(?:=+|-+)\s*$/m)
    if (setext?.[1]) {
      const value = cleanHeading(setext[1])
      if (value) return value
    }

    const strong = markdown.match(/^\s*(?:\*\*|__)(.+?)(?:\*\*|__)\s*$/m)
    if (strong?.[1]) {
      const value = cleanHeading(strong[1])
      if (value) return value
    }
  }

  function cleanHeading(value: string) {
    return value
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[*_~]+/g, "")
      .trim()
  }

  function record(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value)
  }
}

export namespace MessageComment {
  export type MessageComment = {
    path: string
    comment: string
    /** 元素/页面标签（「div.user-card」「第 5 页 · 形状「标题」」）；行级评论没有。 */
    preview?: string
    selection?: {
      startLine: number
      endLine: number
    }
  }

  export const fromPart = (part: Part): MessageComment | undefined => {
    if (part.type !== "text" || !part.synthetic) return
    // 元数据优先（带 preview/origin）；老消息只有正文，就按英文注释格式反解。
    const next: PromptComment | undefined = readCommentMetadata(part.metadata) ?? parseCommentNote(part.text)
    if (!next) return
    return {
      path: next.path,
      comment: next.comment,
      preview: next.preview,
      selection: next.selection
        ? {
            startLine: next.selection.startLine,
            endLine: next.selection.endLine,
          }
        : undefined,
    }
  }
}

/**
 * 按轮折叠过程,两种形态:
 * - 运行中:按"连续过程行"切段,一段一张容器,与正文一一对应 —— 模型"调工具 → 讲一段 →
 *   再调工具"时,讲正文那一刻前一段收尾,后面新开一段;只有末段是常驻容器(展开 + 实时计时)。
 * - 跑完:整轮过程(思考、工具、中间旁白)收成**一张**大容器,头部"已执行 X",
 *   外面只留收尾正文、提问/评审卡和产物卡 —— 用户要的是"执行完就收起来"。
 * 出错、被中断的轮次不折叠;跑完却没有收尾正文的轮次保持原样,让用户看到最后一次动作。
 * 待办清单卡留在大容器外当进度面板,分区内部走同一套折叠(见 foldSections)。
 */
export namespace TurnFold {
  export type FoldOptions = {
    getPart: (messageID: string, partID: string) => Part | undefined
    /** 该轮的起止时间,取自助手消息的 time.created / time.completed;缺一项就出不了耗时。 */
    turnTime: (userMessageID: string) => { start?: number; end?: number }
    /**
     * 该轮是否仍在运行。运行中把末段留成常驻容器(默认展开、头部实时计时),
     * 前面的段按已收尾折叠。
     */
    isTurnActive?: (userMessageID: string) => boolean
  }

  /** 属于"过程"的行:可被折进 TurnFold 容器。 */
  const PROCESS_TAGS = new Set(["AssistantPart", "Thinking", "Retry", "TodoOverview"])
  /**
   * 运行中的轮次只折真正在跑的过程行:工具调用组、重试。
   * 待办清单卡是用户盯着看的进度面板,轮次跑完再折进去。
   */
  const ACTIVE_PROCESS_TAGS = new Set(["AssistantPart", "Retry"])
  /** 产物卡与兜底件:始终在正文之后,实时工作指示也别插到它们下面。 */
  const TAIL_TAGS = new Set(["DiffSummary", "PreviewCard", "ToolEvidence", "Error", "BottomSpacer", "TurnActions"])

  const partsOf = (group: PartGroup, options: FoldOptions): Part[] => {
    const refs = group.type === "part" ? [group.ref] : group.refs
    return refs.map((ref) => options.getPart(ref.messageID, ref.partID)).filter((part): part is Part => !!part)
  }

  /** 面向用户的交互卡（提问 / 文档评审）始终留在折叠区外，用户随时能点。 */
  const interactive = (row: TimelineRow.TimelineRow, options: FoldOptions) => {
    if (row._tag !== "AssistantPart") return false
    return partsOf(row.group, options).some(
      (part) => part.type === "tool" && (part.tool === "question" || part.tool === "review_document"),
    )
  }

  /** 只有正文的组 = 模型在说话，不属于"过程"，运行中的轮次要留在容器外。 */
  const narration = (row: TimelineRow.TimelineRow, options: FoldOptions) => {
    if (row._tag !== "AssistantPart") return false
    const parts = partsOf(row.group, options)
    return parts.length > 0 && parts.every((part) => part.type === "text")
  }

  /** 分桶结果:同一轮的行 + 该轮的 userMessageID(结构性行可能没有 id)。 */
  type Bucket = { id: string | undefined; rows: TimelineRow.TimelineRow[] }

  /** 切段结果:一段连续的过程行(折成容器),或一行留在容器外的内容。 */
  type Piece = { _tag: "Process"; rows: TimelineRow.TimelineRow[] } | { _tag: "Outside"; row: TimelineRow.TimelineRow }

  /** 部件自己的起止时间:工具看 state.time,正文/思考看 time;pending 的工具还没开始。 */
  const partTime = (part: Part): { start?: number; end?: number } => {
    if (part.type === "tool") {
      const state = part.state
      if (state.status === "pending") return {}
      if (state.status === "running") return { start: state.time.start }
      return { start: state.time.start, end: state.time.end }
    }
    if (part.type === "text" || part.type === "reasoning") return { start: part.time?.start, end: part.time?.end }
    return {}
  }

  /**
   * 一段过程行自己的耗时:段内最早的开始到最晚的结束,折叠头部报"已执行 X"用的是它,
   * 不是整轮耗时 —— 一轮里有好几段,只有最后一段该用整轮时间。
   * 只要有一行还没跑完或没带时间就出不了耗时,渲染层退到"已完成"。
   */
  const segmentDuration = (rows: TimelineRow.TimelineRow[], options: FoldOptions) => {
    let start: number | undefined
    let end: number | undefined
    for (const row of rows) {
      if (row._tag !== "AssistantPart") return undefined
      for (const part of partsOf(row.group, options)) {
        const time = partTime(part)
        if (time.start === undefined || time.end === undefined) return undefined
        start = start === undefined ? time.start : Math.min(start, time.start)
        end = end === undefined ? time.end : Math.max(end, time.end)
      }
    }
    return start !== undefined && end !== undefined && end >= start ? end - start : undefined
  }

  /** 按"容器外的行收尾"切段:连续过程行合成一段,旁白/提问卡/产物卡/结构行各自独立。 */
  const splitPieces = (
    body: TimelineRow.TimelineRow[],
    isProcess: (row: TimelineRow.TimelineRow) => boolean,
  ): Piece[] => {
    const pieces: Piece[] = []
    let process: TimelineRow.TimelineRow[] | undefined
    for (const row of body) {
      if (!isProcess(row)) {
        process = undefined
        pieces.push({ _tag: "Outside", row })
        continue
      }
      if (!process) {
        process = []
        pieces.push({ _tag: "Process", rows: process })
      }
      process.push(row)
    }
    return pieces
  }

  /**
   * 跑完的轮次:外面收成**一张**大容器("执行 N 步 · 用时 X"),但容器里面仍按旁白切段。
   * 两层都要有,不是二选一:大容器管"这轮跑完了没",里面的段管"哪句正文对应哪段过程"。
   * 只有一段(中间没插正文)时不再套第二层折叠头,直接平铺。
   * 提问/评审卡始终露在外面(用户随时要点),待办清单卡也留在外面当进度面板。
   * `undefined` = 保持原样:没有收尾正文(最后一次动作露出来更有用),或压根没有过程可折。
   */
  const foldCompletedRows = (
    rows: TimelineRow.TimelineRow[],
    userMessageID: string,
    options: FoldOptions,
  ): TimelineRow.TimelineRow[] | undefined => {
    let cut = rows.length
    while (cut > 0 && TAIL_TAGS.has(rows[cut - 1]!._tag)) cut -= 1
    // 再往前的连续纯文本组 = 这一轮给用户看的那句结论。
    let start = cut
    while (start > 0 && narration(rows[start - 1]!, options)) start -= 1
    if (start === cut) return undefined

    const isInside = (row: TimelineRow.TimelineRow) =>
      PROCESS_TAGS.has(row._tag) && row._tag !== "TodoOverview" && !interactive(row, options)
    const inside = rows.slice(0, start).filter(isInside)
    if (inside.length === 0) return undefined

    // 容器内部:纯文本旁白收尾上一段,过程行开新段。
    const pieces = splitPieces(inside, (row) => !narration(row, options))
    const segmented = pieces.length > 1 || pieces[0]?._tag === "Outside"
    const body = segmented
      ? pieces.map((piece) =>
          piece._tag === "Outside"
            ? piece.row
            : new TimelineRow.TurnFold({
                userMessageID,
                rows: piece.rows,
                anchorKey: TimelineRow.key(piece.rows[0]!),
                durationMs: segmentDuration(piece.rows, options),
                // 一行的段不挂折叠头:点开才能看见一步,比不折还累。
                bare: piece.rows.length === 1 ? true : undefined,
              }),
        )
      : inside

    const time = options.turnTime(userMessageID)
    const turnMs =
      time.start !== undefined && time.end !== undefined && time.end >= time.start ? time.end - time.start : undefined
    // 大容器头部报的是"步数",切段后容器里的子项数量不再等于步数,单独数一遍过程行。
    const steps = inside.reduce((count, row) => count + (narration(row, options) ? 0 : 1), 0)

    const out: TimelineRow.TimelineRow[] = []
    let folded = false
    rows.forEach((row, index) => {
      // 过程行在第一个位置合成一张容器,其余从流里拿走 —— 它们已经在那张容器里了。
      if (index < start && isInside(row)) {
        if (folded) return
        folded = true
        out.push(
          new TimelineRow.TurnFold({
            userMessageID,
            rows: body,
            durationMs: turnMs ?? segmentDuration(inside, options),
            stepCount: steps,
          }),
        )
        return
      }
      out.push(row)
    })
    return out
  }

  /**
   * 运行中的轮次:按"连续过程行"切段,一段一张容器 —— 正文一出现就收尾上一段,
   * 只有末段是常驻展开的实时容器。
   */
  const foldActiveRows = (
    rows: TimelineRow.TimelineRow[],
    userMessageID: string,
    options: FoldOptions,
    thinking?: TimelineRow.Thinking,
  ): TimelineRow.TimelineRow[] | undefined => {
    const isProcess = (row: TimelineRow.TimelineRow) => {
      // 纯文本旁白 = 模型在说话,永远留在容器外,并由它收尾前一段。
      if (narration(row, options) || interactive(row, options)) return false
      // 运行中只折真正在跑的行;待办清单卡是进度面板,跑完再折进去。
      return ACTIVE_PROCESS_TAGS.has(row._tag)
    }
    const pieces = splitPieces(
      rows.filter((row) => row._tag !== "Thinking"),
      isProcess,
    )
    if (!pieces.some((piece) => piece._tag === "Process")) return undefined

    const last = pieces[pieces.length - 1]!
    // 还在跑且末段是过程行:那一段就是当前动作,收成常驻容器(展开 + 实时计时)。
    const live = last._tag === "Process"

    const time = options.turnTime(userMessageID)
    const out: TimelineRow.TimelineRow[] = []
    for (const piece of pieces) {
      if (piece._tag === "Outside") {
        out.push(piece.row)
        continue
      }
      const isLive = piece === last && live
      out.push(
        new TimelineRow.TurnFold({
          userMessageID,
          rows: piece.rows,
          anchorKey: TimelineRow.key(piece.rows[0]!),
          durationMs: segmentDuration(piece.rows, options),
          startedAt: isLive ? (time.start ?? thinking?.startedAt) : undefined,
          active: isLive || undefined,
          reasoningHeading: isLive ? thinking?.reasoningHeading : undefined,
          activity: isLive ? thinking?.activity : undefined,
          bare: !isLive && piece.rows.length === 1 ? true : undefined,
        }),
      )
    }
    // 模型正在写正文、没有常驻容器接走计时时,工作指示还得留在外面,否则运行中没人报进度。
    // 插在最后一句正文之后、产物卡之前:进度跟着用户正在看的那段走,不会掉到预览卡下面。
    if (!live && thinking) {
      const at = out.findIndex((row) => TAIL_TAGS.has(row._tag))
      out.splice(at === -1 ? out.length : at, 0, thinking)
    }
    return out
  }

  const foldRows = (
    rows: TimelineRow.TimelineRow[],
    userMessageID: string,
    active: boolean,
    options: FoldOptions,
    thinking?: TimelineRow.Thinking,
  ): TimelineRow.TimelineRow[] | undefined =>
    active ? foldActiveRows(rows, userMessageID, options, thinking) : foldCompletedRows(rows, userMessageID, options)

  /**
   * 待办分区内部走同一套切段:讲一句、跑一段,正文和过程一一对应,而不是整段过程堆在清单项里。
   * 分区永远不当"运行中的末段" —— 清单卡本身就是进度面板,计时由它自己负责。
   */
  const foldSections = (
    overview: TimelineRow.TodoOverview,
    userMessageID: string,
    options: FoldOptions,
  ): TimelineRow.TodoOverview => {
    let changed = false
    const sections = overview.sections.map((section) => {
      const rows = foldRows(section.rows, userMessageID, false, options)
      if (!rows) return section
      changed = true
      return new TimelineRow.TodoSection({
        todoID: section.todoID,
        segment: section.segment,
        title: section.title,
        status: section.status,
        rows,
        durationMs: section.durationMs,
        outputCount: section.outputCount,
        startedAt: section.startedAt,
        endedAt: section.endedAt,
      })
    })
    if (!changed) return overview
    return new TimelineRow.TodoOverview({
      anchorPartID: overview.anchorPartID,
      done: overview.done,
      total: overview.total,
      sections,
      startedAt: overview.startedAt,
      activity: overview.activity,
    })
  }

  export function fold(rows: TimelineRow.TimelineRow[], options: FoldOptions): TimelineRow.TimelineRow[] {
    // 先按轮分桶:userMessageID 变化即开新桶;没有 id 的行(TodoOverview/BottomSpacer)跟着当前桶。
    const buckets: Bucket[] = []
    let current: Bucket | undefined
    for (const row of rows) {
      const id = "userMessageID" in row ? row.userMessageID : undefined
      if (!current || (id !== undefined && id !== current.id)) {
        current = { id, rows: [row] }
        buckets.push(current)
        continue
      }
      current.rows.push(row)
    }

    const foldBucket = (bucket: Bucket): TimelineRow.TimelineRow[] => {
      const body = bucket.rows
      const userMessageID = bucket.id
      if (userMessageID === undefined) return body
      // 出错或被中断/压缩的轮次:保持原样,让用户看得到发生了什么。
      if (body.some((row) => row._tag === "Error" || row._tag === "TurnDivider")) return body

      const active = options.isTurnActive?.(userMessageID) === true
      // 轮首那条实时工作指示不进容器:它的标题/起始时间提升到常驻容器里,
      // 由渲染层画成容器底部的一行,避免容器头部和它各显示一个计时。
      const thinking = body.find((row): row is TimelineRow.Thinking => row._tag === "Thinking")
      // 清单分区先各自切段,再随整轮一起切:分区内外都是"讲一句、跑一段"。
      const rows = body.map((row) => (row._tag === "TodoOverview" ? foldSections(row, userMessageID, options) : row))
      return foldRows(rows, userMessageID, active, options, thinking) ?? rows
    }

    return buckets.flatMap((bucket) => foldBucket(bucket))
  }
}

/**
 * 按待办清单分组聊天时间线。
 *
 * 规则(与原型一致):
 * - todowrite / todoedit 出现**之前**的一切行保持原有流式;
 * - 第一次 todowrite 后插入待办总览卡,从此后续行按"当前 in_progress 的待办"归入分区;
 * - 快照里没有 in_progress 时(列表刚开始/全部完成)收起当前分区,后续行走原有流式;
 * - 用户消息、轮次分隔等结构性行始终在分区外,并把当前分区断开
 *   (同一待办被用户消息打断后,下一段以新的 segment 重新开卡)。
 * - 分区内的行就是原时间线行,渲染层原样复用消息流组件。
 */
export namespace TodoGrouping {
  const TODO_TOOL_IDS = new Set(["todowrite", "todoedit"])
  // 计入"产出"的工具:写文件类。按去重后的 filePath 计数。
  const OUTPUT_TOOLS = new Set(["write", "edit", "multiedit", "patch"])

  type SnapshotTodo = { id: string; content: string; status: string }

  const isTodoToolPart = (part: Part): part is Extract<Part, { type: "tool" }> =>
    part.type === "tool" && TODO_TOOL_IDS.has(part.tool)

  /** 从 todowrite/todoedit 的工具部件提取完整待办快照(优先 metadata 里的服务端列表,带 id)。 */
  export function snapshotOf(part: Part): SnapshotTodo[] {
    if (!isTodoToolPart(part)) return []
    const state: any = part.state
    const collect = (value: unknown): SnapshotTodo[] | undefined => {
      if (!Array.isArray(value)) return undefined
      const list = value
        .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
        .map((item, index) => {
          const content = typeof item.content === "string" ? item.content : ""
          // 服务端列表带 id;输入快照没有,按内容合成,保证跨快照稳定。
          const id = typeof item.id === "string" && item.id ? item.id : `content:${content || index}`
          return {
            id,
            content,
            status: typeof item.status === "string" ? item.status : "pending",
          }
        })
      return list
    }
    const fromMetadata = collect(state.metadata?.todos)
    if (fromMetadata && fromMetadata.length > 0) return fromMetadata
    const fromInput = collect(state.input?.todos)
    if (fromInput) return fromInput
    return []
  }

  const groupPartsOf = (group: PartGroup, getPart: (messageID: string, partID: string) => Part | undefined): Part[] => {
    const refs =
      group.type === "part" ? [group.ref] : group.type === "context" || group.type === "reasoning" ? group.refs : []
    return refs.map((ref) => getPart(ref.messageID, ref.partID)).filter((part): part is Part => !!part)
  }

  const partTime = (part: Part): { start?: number; end?: number } => {
    if (part.type !== "tool") return {}
    const time: any = (part.state as any).time
    if (!time || typeof time !== "object") return {}
    return {
      start: typeof time.start === "number" ? time.start : undefined,
      end: typeof time.end === "number" ? time.end : undefined,
    }
  }

  export type GroupOptions = {
    getPart: (messageID: string, partID: string) => Part | undefined
    /**
     * 全局 session_todo 的实时状态。服务端的待办没有稳定 id,按 content 匹配;
     * 分区头部状态优先取实时值,取不到(未加载/已清空)回落到快照状态。
     */
    liveStatus?: (content: string) => string | undefined
  }

  export function group(rows: TimelineRow.TimelineRow[], options: GroupOptions): TimelineRow.TimelineRow[] {
    const hasTodoTool = rows.some(
      (row) => row._tag === "AssistantPart" && groupPartsOf(row.group, options.getPart).some(isTodoToolPart),
    )
    // 快路径:整个会话没有用过待办工具,原样返回,零开销。
    if (!hasTodoTool) return rows

    const out: TimelineRow.TimelineRow[] = []
    const segments = new Map<string, number>()
    const titleByID = new Map<string, string>()
    const snapshotStatusByID = new Map<string, string>()
    let overviewInserted = false
    let overviewIndex = -1
    let overviewAnchor = ""
    let overviewDone = 0
    let overviewTotal = 0
    const sections: TimelineRow.TodoSection[] = []
    type Bucket = {
      todoID: string
      rows: TimelineRow.TimelineRow[]
      outputs: Set<string>
      start: number | undefined
      end: number | undefined
    }
    // 同一时刻可能有多个 in_progress(并行待办)。这里为每个进行中的项各记一份区间,
    // 并行期间产生的行同时归入每个项 —— 每一项都有自己的计时和可展开的过程。
    let current: Bucket[] = []

    const flush = () => {
      const buckets = current
      current = []
      for (const bucket of buckets) {
        // 没有执行行、也没有开始时间的项不产出区间(纯 pending 项会走这条路)。
        if (bucket.rows.length === 0 && bucket.start === undefined) continue
        const segment = segments.get(bucket.todoID) ?? 0
        segments.set(bucket.todoID, segment + 1)
        const title = titleByID.get(bucket.todoID) ?? ""
        sections.push(
          new TimelineRow.TodoSection({
            todoID: bucket.todoID,
            segment,
            title,
            status: options.liveStatus?.(title) ?? snapshotStatusByID.get(bucket.todoID) ?? "pending",
            rows: bucket.rows,
            durationMs:
              bucket.start !== undefined && bucket.end !== undefined && bucket.end >= bucket.start
                ? bucket.end - bucket.start
                : undefined,
            outputCount: bucket.outputs.size,
            startedAt: bucket.start,
            endedAt: bucket.end,
          }),
        )
      }
    }

    for (const row of rows) {
      if (row._tag === "AssistantPart") {
        const parts = groupPartsOf(row.group, options.getPart)
        // question / review_document 是面向用户的交互点:永远渲染在聊天区顶层,
        // 绝不能被吸进折叠的待办区间(否则被卡住等用户点时卡片会被藏起来)。
        // 它们像用户消息一样断开区间。
        if (
          parts.some((part) => part.type === "tool" && (part.tool === "question" || part.tool === "review_document"))
        ) {
          flush()
          out.push(row)
          continue
        }
        const todoCall = parts.find(isTodoToolPart)
        if (todoCall) {
          // 待办快照:解析并更新标题/状态映射后**再** flush —— 区间状态必须反映
          // 本次快照(否则上一个区间的完成态会被旧快照覆盖成 in_progress)。
          // todowrite/todoedit 的工具行本身不渲染,清单卡承担锚点视觉。
          const snapshot = snapshotOf(todoCall)
          for (const todo of snapshot) {
            titleByID.set(todo.id, todo.content)
            snapshotStatusByID.set(todo.id, todo.status)
          }
          // 清单卡计数跟随最新快照(渲染层有实时 session_todo 时优先实时值)。
          overviewDone = snapshot.filter((todo) => todo.status === "completed").length
          overviewTotal = snapshot.length
          flush()
          if (!overviewInserted) {
            overviewInserted = true
            overviewAnchor = todoCall.id
            overviewIndex = out.length
            // 占位:sections 在循环结束后回填(所有区间收集完毕才知道完整列表)。
            out.push(
              new TimelineRow.TodoOverview({
                anchorPartID: todoCall.id,
                done: overviewDone,
                total: overviewTotal,
                sections: [],
              }),
            )
          }
          // 计时从"被标记为 in_progress 的那一刻"开始，而不是等到第一行工具调用返回 ——
          // 并行时后面几个项往往先挂起再出活，没有这行时间它们就永远不跳秒。
          const activatedAt = partTime(todoCall).end ?? partTime(todoCall).start
          current = snapshot
            .filter((todo) => todo.status === "in_progress")
            .map((todo) => ({
              todoID: todo.id,
              rows: [],
              outputs: new Set<string>(),
              start: activatedAt,
              end: activatedAt,
            }))
          continue
        }
        if (current.length === 0) {
          out.push(row)
          continue
        }
        for (const bucket of current) {
          bucket.rows.push(row)
          for (const part of parts) {
            const time = partTime(part)
            if (time.start !== undefined) {
              bucket.start = bucket.start === undefined ? time.start : Math.min(bucket.start, time.start)
            }
            if (time.end !== undefined) {
              bucket.end = bucket.end === undefined ? time.end : Math.max(bucket.end, time.end)
            }
            if (part.type === "tool" && OUTPUT_TOOLS.has(part.tool)) {
              const filePath = (part.state as any).input?.filePath
              if (typeof filePath === "string") bucket.outputs.add(filePath)
            }
          }
        }
        continue
      }
      if (row._tag === "UserMessage" || row._tag === "TurnDivider" || row._tag === "CommentStrip") {
        // 结构性行不进区间:断开当前区间,保持原有流式语义。
        flush()
        out.push(row)
        continue
      }
      // 轮尾操作行同理:始终留在区间外,紧跟本轮收尾。
      if (row._tag === "TurnActions") {
        flush()
        out.push(row)
        continue
      }
      // 中断/报错面板也必须留在区间外:它是对整轮的提示(还要点「继续」),
      // 收进待办区间里会被折叠、还排在清单卡中间,用户根本看不出来任务断了。
      if (row._tag === "Error" || row._tag === "ToolEvidence") {
        flush()
        out.push(row)
        continue
      }
      if (current.length === 0) {
        out.push(row)
        continue
      }
      for (const bucket of current) bucket.rows.push(row)
    }
    flush()
    // 回填:清单卡是唯一入口,各待办的执行区间全部嵌进卡内(原地展开),不再单独成行。
    if (overviewIndex >= 0) {
      const starts = sections.flatMap((section) => (section.startedAt === undefined ? [] : [section.startedAt]))
      // 卡头部的实时状态:把各分区的 parts 按时间顺序并起来取「最后一个还在动的东西」。
      const sectionParts = sections.flatMap((section) =>
        section.rows.flatMap((row) => (row._tag === "AssistantPart" ? groupPartsOf(row.group, options.getPart) : [])),
      )
      out[overviewIndex] = new TimelineRow.TodoOverview({
        anchorPartID: overviewAnchor,
        done: overviewDone,
        total: overviewTotal,
        sections,
        startedAt: starts.length > 0 ? Math.min(...starts) : undefined,
        activity: sectionParts.length > 0 ? workingActivity({ status: undefined, parts: sectionParts }) : undefined,
      })
    }
    return out
  }
}
