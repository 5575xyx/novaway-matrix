import { classifyError, type ErrorKind } from "./session-error"
import { parseCommentNote, readCommentMetadata } from "@/utils/comment-note"
import { AssistantMessage, Part, SessionStatus, SnapshotFileDiff, UserMessage } from "@novaway/sdk/v2"
import { groupParts, PartGroup, renderable } from "@novaway/ui/message-part"
import { Data, Equal } from "effect"
import { uniqueSummaryDiffs } from "./message-timeline.summary-diffs"
import { projectCitationText } from "./preview-card-extract"

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

export interface EvidenceImage {
  /** 可直接给 `<img src>` 用的地址(data URL 或 file:// 路径)。 */
  url: string
  name?: string
  /** 产生这张图的工具名,用来在卡片上标注来源(browser_screenshot 等)。 */
  tool: string
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
   * 轮尾操作行(复制/赞/踩/分叉/时间):一轮末尾只挂一条,ZCode 同款。
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
    /** 本轮开始时间(用户消息/首条助手消息),用于"工作中 · X"的实时计时。 */
    startedAt?: number
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
    /** 本轮开始时间;运行中的折叠卡用它继续走"工作中 · X"的计时。 */
    startedAt?: number
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
        return `turn-fold:${row.userMessageID}`
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

    // 运行中的轮次始终在顶部挂一条工作指示:即使已经有工具卡/正文也保留,
    // 头部实时显示"工作中 · X 秒",轮次完成后再由 TurnFold 折叠成"已工作 X"。
    if (isActive && status === "busy" && !error) {
      const heading = assistantMessages
        .flatMap((message) => getMessageParts(message.id))
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
    selection?: {
      startLine: number
      endLine: number
    }
  }

  export const fromPart = (part: Part): MessageComment | undefined => {
    if (part.type !== "text" || !part.synthetic) return
    const next = readCommentMetadata(part.metadata) ?? parseCommentNote(part.text)
    if (!next) return
    return {
      path: next.path,
      comment: next.comment,
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
 * 按轮折叠过程:当一轮的"最终结果文本"开始流式输出时,把此前全部过程行(思考、工具、
 * 待办清单卡、中间旁白)折成一张 TurnFold 卡,外面只留收尾文本和产物卡(文件变更/预览)。
 * 之后若继续调工具(结果文本不再是末尾),折叠卡自然消失、回到展开;下一轮收尾文本
 * 出现时再折叠。出错、被中断、无收尾文本或无过程行的轮次不折叠。
 */
export namespace TurnFold {
  export type FoldOptions = {
    getPart: (messageID: string, partID: string) => Part | undefined
    /** 该轮的起止时间,取自助手消息的 time.created / time.completed;缺一项就出不了耗时。 */
    turnTime: (userMessageID: string) => { start?: number; end?: number }
  }

  /** 属于"过程"的行:可被折进 TurnFold 卡。 */
  const PROCESS_TAGS = new Set(["AssistantPart", "Thinking", "Retry", "TodoOverview"])
  /** 永远留在折叠卡之外的行:产物卡与兜底件。 */
  const TAIL_TAGS = new Set(["DiffSummary", "PreviewCard", "ToolEvidence", "Error", "BottomSpacer", "TurnActions"])

  const partsOf = (group: PartGroup, options: FoldOptions): Part[] => {
    const refs = group.type === "part" ? [group.ref] : group.refs
    return refs.map((ref) => options.getPart(ref.messageID, ref.partID)).filter((part): part is Part => !!part)
  }

  export function fold(rows: TimelineRow.TimelineRow[], options: FoldOptions): TimelineRow.TimelineRow[] {
    // 先按轮分桶:userMessageID 变化即开新桶;没有 id 的行(TodoOverview/BottomSpacer)跟着当前桶。
    type Bucket = { id: string | undefined; rows: TimelineRow.TimelineRow[] }
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
      if (bucket.id === undefined) return body
      // 出错或被中断/压缩的轮次:保持原样,让用户看得到发生了什么。
      if (body.some((row) => row._tag === "Error" || row._tag === "TurnDivider")) return body

      // 结尾的产物卡留在外面。
      let cut = body.length
      let endIndex = cut
      while (endIndex > 0 && TAIL_TAGS.has(body[endIndex - 1]!._tag)) endIndex -= 1
      cut = endIndex
      // 再往前的连续"纯文本"组就是最终结果。
      while (endIndex > 0) {
        const row = body[endIndex - 1]!
        if (row._tag !== "AssistantPart") break
        const parts = partsOf(row.group, options)
        if (parts.length === 0 || !parts.every((part) => part.type === "text")) break
        endIndex -= 1
      }
      const finalRun = body.slice(endIndex, cut)
      const processRows = body.slice(0, endIndex).filter((row) => PROCESS_TAGS.has(row._tag))
      if (finalRun.length === 0 || processRows.length === 0) return body

      const time = options.turnTime(bucket.id)
      const durationMs =
        time.start !== undefined && time.end !== undefined && time.end >= time.start ? time.end - time.start : undefined

      let folded = false
      const out: TimelineRow.TimelineRow[] = []
      for (const row of body) {
        if (PROCESS_TAGS.has(row._tag) && !finalRun.includes(row)) {
          if (!folded) {
            folded = true
            out.push(
              new TimelineRow.TurnFold({
                userMessageID: bucket.id!,
                rows: processRows,
                durationMs,
                startedAt: time.start,
              }),
            )
          }
          continue
        }
        out.push(row)
      }
      return out
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
        // question 是面向用户的交互点:永远渲染在聊天区顶层,绝不能被吸进
        // 折叠的待办区间(否则被卡住时提问会被藏起来)。它像用户消息一样断开区间。
        if (parts.some((part) => part.type === "tool" && part.tool === "question")) {
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
      out[overviewIndex] = new TimelineRow.TodoOverview({
        anchorPartID: overviewAnchor,
        done: overviewDone,
        total: overviewTotal,
        sections,
        startedAt: starts.length > 0 ? Math.min(...starts) : undefined,
      })
    }
    return out
  }
}
