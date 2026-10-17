import { Component, For, Show } from "solid-js"
import { FileIcon } from "@novaway/ui/file-icon"
import { Icon } from "@novaway/ui/icon"
import { IconButton } from "@novaway/ui/icon-button"
import { Tooltip } from "@novaway/ui/tooltip"
import { getDirectory, getFilename, getFilenameTruncated } from "@novaway/core/util/path"
import type { ContextItem, FileContextItem } from "@/context/prompt"

type PromptContextItem = ContextItem & { key: string }

type ContextItemsProps = {
  items: PromptContextItem[]
  active: (item: PromptContextItem) => boolean
  openComment: (item: FileContextItem & { key: string }) => void
  remove: (item: PromptContextItem) => void
  t: (key: string) => string
}

export const PromptContextItems: Component<ContextItemsProps> = (props) => {
  return (
    <Show when={props.items.length > 0}>
      <div class="flex flex-nowrap items-start gap-2 p-2 overflow-x-auto no-scrollbar">
        <For each={props.items}>
          {(item) => {
            if (item.type === "quote") {
              return <QuoteChip item={item} remove={props.remove} t={props.t} />
            }
            const directory = getDirectory(item.path)
            const filename = getFilename(item.path)
            const label = getFilenameTruncated(item.path, 14)
            const selected = props.active(item)

            return (
              <Tooltip
                value={
                  <span class="flex max-w-[300px]">
                    <span class="text-foreground-inverse truncate-start [unicode-bidi:plaintext] min-w-0">
                      {directory}
                    </span>
                    <span class="shrink-0">{filename}</span>
                  </span>
                }
                placement="top"
                openDelay={2000}
              >
                <div
                  classList={{
                    "group shrink-0 flex flex-col rounded-[6px] pl-2 pr-1 py-1 max-w-[200px] h-12 cursor-default transition-all transition-transform shadow-xs-border hover:shadow-xs-border-hover": true,
                    "hover:bg-surface": !!item.commentID && !selected,
                    "bg-hover hover:bg-hover shadow-xs-border-hover": selected,
                    "bg-panel": !selected,
                  }}
                  onClick={() => props.openComment(item)}
                >
                  <div class="flex items-center gap-1.5">
                    <FileIcon node={{ path: item.path, type: "file" }} class="shrink-0 size-3.5" />
                    <div class="flex items-center text-11-regular min-w-0 font-medium">
                      <span class="text-foreground whitespace-nowrap">{label}</span>
                      <Show when={item.selection}>
                        {(sel) => (
                          <span class="text-foreground-subtle whitespace-nowrap shrink-0">
                            {sel().startLine === sel().endLine
                              ? `:${sel().startLine}`
                              : `:${sel().startLine}-${sel().endLine}`}
                          </span>
                        )}
                      </Show>
                    </div>
                    <IconButton
                      type="button"
                      icon="close-small"
                      variant="ghost"
                      class="ml-auto size-3.5 text-foreground-subtle hover:text-foreground transition-all"
                      onClick={(e) => {
                        e.stopPropagation()
                        props.remove(item)
                      }}
                      aria-label={props.t("prompt.context.removeFile")}
                    />
                  </div>
                  <Show when={item.comment}>
                    {(comment) => <div class="text-12-regular text-foreground ml-5 pr-1 truncate">{comment()}</div>}
                  </Show>
                </div>
              </Tooltip>
            )
          }}
        </For>
      </div>
    </Show>
  )
}

/**
 * 引用卡片（对齐 ZCode 的对话引用 pill）：
 * 左侧引号图标，右侧来源标签 + 两行内容预览，右上角删除。
 * 用 `title` 展示完整内容，避免长选区把输入框顶得太高。
 */
const QuoteChip: Component<{
  item: Extract<PromptContextItem, { type: "quote" }>
  remove: (item: PromptContextItem) => void
  t: (key: string) => string
}> = (props) => (
  <div
    data-component="prompt-quote-item"
    title={props.item.text}
    class="group flex h-12 max-w-[240px] shrink-0 flex-col gap-0.5 rounded-[6px] bg-panel py-1 pl-2 pr-1 shadow-xs-border transition-colors hover:bg-surface hover:shadow-xs-border-hover"
  >
    <div class="flex min-w-0 items-center gap-1.5">
      <Icon name="quote" size="small" class="shrink-0 text-foreground-subtle" />
      <span class="min-w-0 flex-1 truncate text-11-medium text-foreground">
        {props.item.label || props.t("prompt.context.quote")}
      </span>
      <IconButton
        type="button"
        icon="close-small"
        variant="ghost"
        class="size-3.5 text-foreground-subtle transition-all hover:text-foreground"
        onClick={() => props.remove(props.item)}
        aria-label={props.t("prompt.context.removeFile")}
      />
    </div>
    <div class="line-clamp-2 pr-1 text-11-regular text-foreground-subtle">
      {props.item.text.replace(/\s+/g, " ").trim()}
    </div>
  </div>
)
