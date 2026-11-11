import { For, Show, type Component } from "solid-js"

export type TextFindOption = {
  id: "case" | "regex" | "word"
  label: string
  title: string
  active: () => boolean
  toggle: (value: boolean) => void
}

export const FilePreviewTextFindBar: Component<{
  inputRef: (element: HTMLInputElement) => void
  query: string
  onQueryInput: (value: string) => void
  onQueryKeyDown: (event: KeyboardEvent) => void
  invalid: boolean
  matchCount: number
  matchIndex: number
  onStep: (direction: 1 | -1) => void
  options: TextFindOption[]
  replaceOpen: boolean
  replacement: string
  onReplacementInput: (value: string) => void
  onReplacementKeyDown: (event: KeyboardEvent) => void
  onReplaceCurrent: () => void
  onReplaceAll: () => void
  onToggleReplace: () => void
  onClose: () => void
}> = (props) => {
  return (
    <div class="flex shrink-0 flex-wrap items-center gap-1 border-b border-border bg-background-weak px-3 py-1.5">
      <input
        ref={props.inputRef}
        type="text"
        data-action="text-find-query"
        placeholder="查找"
        class="h-6 w-44 rounded border border-border bg-background px-1.5 text-11-regular text-foreground outline-none focus:border-border-hover"
        value={props.query}
        onInput={(event) => props.onQueryInput(event.currentTarget.value)}
        onKeyDown={props.onQueryKeyDown}
      />
      <span class="min-w-12 text-11-regular text-foreground-subtlest">
        {props.invalid
          ? "正则无效"
          : props.query
            ? props.matchCount === 0
              ? "无结果"
              : `${props.matchIndex + 1}/${props.matchCount}`
            : ""}
      </span>
      <button
        type="button"
        data-action="text-find-prev"
        title="上一个（Shift+Enter）"
        class="rounded px-1.5 py-0.5 text-11-regular text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground disabled:opacity-40"
        disabled={props.matchCount === 0}
        onClick={() => props.onStep(-1)}
      >
        上一个
      </button>
      <button
        type="button"
        data-action="text-find-next"
        title="下一个（Enter）"
        class="rounded px-1.5 py-0.5 text-11-regular text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground disabled:opacity-40"
        disabled={props.matchCount === 0}
        onClick={() => props.onStep(1)}
      >
        下一个
      </button>
      <span class="mx-0.5 h-4 w-px bg-border" />
      <For each={props.options}>
        {(item) => (
          <button
            type="button"
            data-action={`text-find-${item.id}`}
            title={item.title}
            class={[
              "rounded border px-1.5 py-0.5 text-11-medium transition-colors",
              item.active()
                ? "border-border bg-hover text-foreground"
                : "border-transparent text-foreground-subtlest hover:bg-hover hover:text-foreground",
            ].join(" ")}
            onClick={() => item.toggle(!item.active())}
          >
            {item.label}
          </button>
        )}
      </For>
      <span class="mx-0.5 h-4 w-px bg-border" />
      <Show when={props.replaceOpen}>
        <input
          type="text"
          data-action="text-find-replacement"
          placeholder="替换为"
          class="h-6 w-40 rounded border border-border bg-background px-1.5 text-11-regular text-foreground outline-none focus:border-border-hover"
          value={props.replacement}
          onInput={(event) => props.onReplacementInput(event.currentTarget.value)}
          onKeyDown={props.onReplacementKeyDown}
        />
        <button
          type="button"
          data-action="text-find-replace"
          class="rounded px-1.5 py-0.5 text-11-regular text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground disabled:opacity-40"
          disabled={props.matchCount === 0}
          onClick={props.onReplaceCurrent}
        >
          替换
        </button>
        <button
          type="button"
          data-action="text-find-replace-all"
          class="rounded px-1.5 py-0.5 text-11-regular text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground disabled:opacity-40"
          disabled={props.matchCount === 0}
          onClick={props.onReplaceAll}
        >
          全部替换
        </button>
      </Show>
      <span class="ml-auto flex items-center gap-1">
        <button
          type="button"
          data-action="text-find-toggle-replace"
          class="rounded px-1.5 py-0.5 text-11-regular text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
          onClick={props.onToggleReplace}
        >
          {props.replaceOpen ? "收起替换" : "替换…"}
        </button>
        <button
          type="button"
          data-action="text-find-close"
          class="rounded px-1.5 py-0.5 text-11-regular text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
          onClick={props.onClose}
        >
          关闭
        </button>
      </span>
    </div>
  )
}
