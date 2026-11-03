// 聊天区里挂在用户消息上方的「备注卡片」（行级评论 / 预览选元素 / PPT 点形状）。
//
// 只展示：文件名（+ 行号）、挂靠的元素标签、用户自己写的那一句。
// 备注正文里拼给模型的元素细节（CSS 路径、计算样式、源码）不进卡片 ——
// 之前整段铺开，一条消息就在聊天区撑出好几列源码墙，一屏就被占满了。
// 完整正文留在 `title` 上，想看原文时悬停可见。

import { Show, createMemo } from "solid-js"
import { FileIcon } from "@novaway/ui/file-icon"
import { getFilename } from "@novaway/core/util/path"
import { commentSummary } from "@/utils/comment-note"

/** 卡片需要的最小数据面（结构上兼容 MessageComment.MessageComment）。 */
export type MessageCommentCardData = {
  path: string
  comment: string
  preview?: string
  selection?: { startLine: number; endLine: number }
}

export function MessageCommentCard(props: { comment: MessageCommentCardData }) {
  const summary = createMemo(() => commentSummary(props.comment.comment))
  const target = createMemo(() => props.comment.preview?.trim())
  return (
    <div
      data-slot="message-comment-card"
      class="w-[200px] shrink-0 rounded-[6px] bg-panel px-2 py-1.5 shadow-xs-border"
      title={props.comment.comment}
    >
      <div class="flex min-w-0 items-center gap-1.5 text-11-regular text-foreground-subtle">
        <FileIcon node={{ path: props.comment.path, type: "file" }} class="size-3.5 shrink-0" />
        <span class="truncate">{getFilename(props.comment.path)}</span>
        <Show when={props.comment.selection}>
          {(selection) => (
            <span class="shrink-0">
              {selection().startLine === selection().endLine
                ? `:${selection().startLine}`
                : `:${selection().startLine}-${selection().endLine}`}
            </span>
          )}
        </Show>
      </div>
      <Show when={target()}>
        {(label) => (
          <div class="truncate pt-0.5 text-11-medium text-foreground" title={label()}>
            {label()}
          </div>
        )}
      </Show>
      <Show when={summary()}>
        {(text) => (
          <div
            data-slot="message-comment-summary"
            class="line-clamp-2 whitespace-pre-wrap break-words pt-0.5 text-11-regular text-foreground-subtle"
          >
            {text()}
          </div>
        )}
      </Show>
    </div>
  )
}
