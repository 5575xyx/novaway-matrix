import { Show } from "solid-js"
import { ScrollView } from "@novaway/ui/scroll-view"
import type { FrontMatterValue } from "@novaway/core/office/text/front-matter"
import { Markdown } from "@novaway/ui/markdown"
import { MarkdownLive } from "@/pages/session/markdown-live"

type MarkdownProperties = {
  open: () => boolean
  rows: () => { key: string; value: FrontMatterValue }[]
  newKey: () => string | undefined
  newValue: () => string | undefined
  setOpen: (open: boolean) => void
  setNewKey: (value: string) => void
  setNewValue: (value: string) => void
  setText: (key: string, value: string) => void
  remove: (key: string) => void
  add: () => void
  formatValue: (value: FrontMatterValue) => string
}

export function FilePreviewMarkdownLiveContent(props: {
  text: () => string
  onChange: (text: string) => void
  onFileOpen: (path: string) => void
  onWikiLink: (target: string) => void
  properties: MarkdownProperties
}) {
  return (
    <ScrollView class="h-full">
      <div class="mx-auto w-full max-w-3xl px-6 py-5">
        <Show when={props.properties.open()}>
          <div
            class="mb-3 rounded-lg border border-border bg-panel/60 px-3 py-2"
            data-action="markdown-properties-panel"
          >
            <div class="mb-1.5 flex items-center justify-between">
              <span class="text-11-regular text-foreground-subtlest">
                属性{props.properties.rows().length ? `（${props.properties.rows().length}）` : ""}
              </span>
              <button
                type="button"
                data-action="markdown-properties-close"
                class="rounded px-1.5 py-0.5 text-11-regular text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
                onClick={() => props.properties.setOpen(false)}
              >
                收起
              </button>
            </div>
            <Show
              when={props.properties.rows().length > 0}
              fallback={
                <div class="py-1 text-11-regular text-foreground-subtlest">
                  还没有属性。在下面加一个，会写进文件头的 --- 区。
                </div>
              }
            >
              {props.properties.rows().map((entry) => (
                <div class="flex items-center gap-2 py-0.5" data-action="markdown-property-row">
                  <span class="w-28 shrink-0 truncate text-11-regular text-foreground-subtle" title={entry.key}>
                    {entry.key}
                  </span>
                  <input
                    type="text"
                    data-action="markdown-property-value"
                    class="h-6 min-w-0 flex-1 rounded border border-border bg-background px-1.5 text-11-regular text-foreground outline-none focus:border-border-hover"
                    value={props.properties.formatValue(entry.value)}
                    onChange={(event) => props.properties.setText(entry.key, event.currentTarget.value)}
                  />
                  <button
                    type="button"
                    data-action="markdown-property-remove"
                    title="删除这个属性"
                    class="shrink-0 rounded px-1.5 py-0.5 text-11-regular text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
                    onClick={() => props.properties.remove(entry.key)}
                  >
                    删除
                  </button>
                </div>
              ))}
            </Show>
            <div class="mt-1.5 flex items-center gap-2 border-t border-border pt-1.5">
              <input
                type="text"
                data-action="markdown-property-new-key"
                placeholder="属性名"
                class="h-6 w-28 shrink-0 rounded border border-border bg-background px-1.5 text-11-regular text-foreground outline-none focus:border-border-hover"
                value={props.properties.newKey()}
                onInput={(event) => props.properties.setNewKey(event.currentTarget.value)}
              />
              <input
                type="text"
                data-action="markdown-property-new-value"
                placeholder="值（a, b 会写成列表）"
                class="h-6 min-w-0 flex-1 rounded border border-border bg-background px-1.5 text-11-regular text-foreground outline-none focus:border-border-hover"
                value={props.properties.newValue()}
                onInput={(event) => props.properties.setNewValue(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault()
                    props.properties.add()
                  }
                }}
              />
              <button
                type="button"
                data-action="markdown-property-add"
                disabled={!props.properties.newKey()?.trim()}
                class="shrink-0 rounded px-1.5 py-0.5 text-11-regular text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground disabled:opacity-40"
                onClick={() => props.properties.add()}
              >
                添加
              </button>
            </div>
          </div>
        </Show>
        <div class="mb-2 text-11-regular text-foreground-subtlest" data-action="markdown-live-hint" data-print-hide>
          双击任意段落直接改 · Esc 取消 · ⌘/Ctrl+Enter 保存
        </div>
        <MarkdownLive
          text={props.text()}
          onFileOpen={props.onFileOpen}
          onWikiLink={props.onWikiLink}
          onChange={props.onChange}
        />
      </div>
    </ScrollView>
  )
}

export function FilePreviewMarkdownReadContent(props: {
  text: string
  cacheKey: string
  onFileOpen: (path: string) => void
  onWikiLink: (target: string) => void
  onTaskToggle: (index: number) => void
}) {
  return (
    <ScrollView class="h-full">
      <div class="mx-auto w-full max-w-3xl px-6 py-5">
        <Markdown
          text={props.text}
          cacheKey={props.cacheKey}
          onFileOpen={props.onFileOpen}
          onWikiLink={props.onWikiLink}
          onTaskToggle={props.onTaskToggle}
        />
      </div>
    </ScrollView>
  )
}
